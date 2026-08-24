/**
 * MODULO 9 - Seleccion diaria.
 *
 * EL PROBLEMA QUE RESUELVE: hasta ahora habia que elegir a mano la
 * timeframe de referencia (--scenario 15m, 1h, 4h...). Eso es una
 * decision que el operador no deberia tomar por intuicion: la timeframe
 * adecuada es simplemente la que ese dia ofrece el best scenario NETO, y
 * eso se puede calcular.
 *
 * QUE HACE: evalua todas las temporalidades x ambas direcciones, descarta las
 * combinaciones que no superan los criteria minimos, y ordena el resto por
 * quality. Una operacion puede durar horas o dias: el horizonte lo fija la
 * geometria del scenario, no un marco temporal elegido de antemano.
 *
 * PRINCIPIO: todo descarte queda ESCRITO con su reason. Un selector que dice
 * "este" sin decir por que descarto los otros es una caja negra, y en ese caso
 * daria igual que eligiera al azar.
 */
import { buildScenarios } from './scenarios.mjs';

/**
 * Criterios minimos. Son thresholds explicitos y discutibles, no verdades.
 * Estan aqui arriba, juntos y visibles, para poder cambiarlos y volver a
 * medir su efecto en el backtest.
 */
export const CRITERIA = {
  // R:R NETO minimum. Por debajo de 1 harian falta mas aciertos que fallos
  // solo para empatar, y no tenemos ninguna evidencia de acertar tanto.
  minNetRR: 1.0,
  // Los costes no deben comerse mas de esta fraction del beneficio bruto.
  maxCostBite: 35,
  // Un stop mas alla de esto obliga a un risk desproporcionado.
  maxRiskATR: 3.0,
  // Recorrido minimum al target, en ATR de su propia timeframe: por
  // debajo de 1 ATR el target esta dentro del ruido de una sola vela.
  minMoveATR: 1.0,
  /**
   * TECHO DE RECORRIDO. Sin el, el selector elige SIEMPRE el target mas
   * lejano, why el R:R crece de forma mecanica con la distance: un
   * target a 10 ATR da un R:R espectacular y no se alcanza casi nunca.
   * El ratio por si solo no puede ordenar candidates — hay que acotar la
   * distance, o se convierte en un buscador de targets imposibles.
   */
  maxMoveATR: 3.0,
};

/**
 * De todos los targets de un scenario, el best candidato: el de mayor
 * R:R net entre los que son alcanzables. No siempre es el mas lejano — un
 * target lejanisimo tiene R:R alto pero se alcanza pocas veces.
 */
function bestTarget(scenario, criteria) {
  const viableOnes = scenario.targets.filter((o) =>
    o.viable !== false
    && o.netRR !== null
    && o.distanceATR <= criteria.maxMoveATR   // acotado, ver CRITERIA
    && o.distanceATR >= criteria.minMoveATR
  );
  if (!viableOnes.length) return null;
  return viableOnes.reduce((a, b) => (b.netRR > a.netRR ? b : a));
}

/** Evalua una combinacion timeframe x direction y devuelve su ficha. */
function evaluateCandidate(tfAnalysis, scenario, synthesis, criteria) {
  const target = bestTarget(scenario, criteria);
  const rejections = [];
  const penalties = [];

  if (!target) {
    const closest = scenario.targets[0];
    rejections.push(closest && closest.distanceATR > criteria.maxMoveATR
      ? 'All targets are beyond ' + criteria.maxMoveATR + ' ATR (closest at '
        + closest.distanceATR + '): unreachable within a tradable horizon.'
      : 'Ningun target cubre los costes o queda dentro del range operable.');
  } else {
    if (target.netRR < criteria.minNetRR) {
      rejections.push('R:R net ' + target.netRR + ':1, below del minimum de '
        + criteria.minNetRR + ':1 (would require a hit rate above '
        + target.netMinWinRatePct + '%).');
    }
    if (target.costBitePct > criteria.maxCostBite) {
      rejections.push('Los costes se comen el ' + target.costBitePct
        + '% del beneficio bruto (maximum ' + criteria.maxCostBite + '%).');
    }
  }

  if (scenario.riskATR > criteria.maxRiskATR) {
    rejections.push('Invalidation is at ' + scenario.riskATR
      + ' ATR: disproportionate risk for this chart.');
  }

  // Penalizaciones: no descartan, pero bajan la quality del candidato.
  if (!scenario.alignedWithBias) {
    penalties.push({ reason: 'runs against the aggregate technical bias', points: 25 });
  }
  if (scenario.invalidation.base.startsWith('suelo')) {
    penalties.push({ reason: 'the stop rests on the ATR floor, not on real structure', points: 20 });
  }
  if (target && target.origin.startsWith('projection')) {
    penalties.push({ reason: 'the target is a volatility projection, not an observed level', points: 15 });
  }
  if (tfAnalysis.indicators.volRel !== null && tfAnalysis.indicators.volRel < 0.7) {
    penalties.push({ reason: 'volume below del 70% de lo normal', points: 10 });
  }

  /**
   * CALIDAD. Parte de 100 y resta las penalties, mas un componente
   * proporcional al R:R net. No es una probabilidad ni pretende serlo: es
   * un orden de preferencia entre candidates del mismo dia, con todos sus
   * ingredientes a la vista.
   */
  const baseRR = target ? Math.min(40, target.netRR * 15) : 0;
  const deducted = penalties.reduce((s, p) => s + p.points, 0);
  const quality = Math.max(0, Math.min(100, 60 + baseRR - deducted));

  return {
    timeframe: tfAnalysis.timeframe,
    direction: scenario.direction,
    alignedWithBias: scenario.alignedWithBias,
    price: scenario.referencePrice,
    invalidation: scenario.invalidation,
    riskATR: scenario.riskATR,
    riskUnit: scenario.riskUnit,
    target,
    activation: scenario.activation,
    atr: tfAnalysis.indicators.atr14,
    rejections,
    penalties,
    quality: target ? Number(quality.toFixed(0)) : 0,
    eligible: rejections.length === 0,
  };
}

/**
 * Recorre todas las temporalidades disponibles y devuelve el ranking del dia.
 * `costes` es { profile, options } y se propaga a todos los scenarios.
 */
export function dailySelection(analysis, synthesis, costes, criteria = CRITERIA) {
  const candidates = [];

  for (const a of analysis) {
    const { scenarios } = buildScenarios(a, synthesis, costes);
    for (const esc of scenarios) {
      candidates.push(evaluateCandidate(a, esc, synthesis, criteria));
    }
  }

  const eligible = candidates.filter((c) => c.eligible).sort((a, b) => b.quality - a.quality);
  const rejected = candidates.filter((c) => !c.eligible).sort((a, b) => b.quality - a.quality);

  return {
    criteria,
    costes,
    evaluated: candidates.length,
    eligible,
    rejected,
    best: eligible[0] ?? null,
    /**
     * Que no haya ningun candidato eligible es un resultado legitimo y frecuente.
     * La mayoria de dias el grafico no ofrece nada con move suficiente
     * para cubrir costes con holgura. Forzar una operacion esos dias significa
     * pagar comision por operar ruido, y eso es una perdida garantizada a
     * cambio de una ganancia incierta.
     */
    hasEligible: eligible.length > 0,
    noneReason: eligible.length === 0
      ? 'None of the ' + candidates.length + ' combinaciones evaluadas supera los '
        + 'criteria minimos. Los motivos concretos de cada descarte estan abajo.'
      : null,
  };
}
