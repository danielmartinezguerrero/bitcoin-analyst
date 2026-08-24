/**
 * MODULO 12 - Gestion de la position abierta.
 *
 * De donde sale: el analysis de MFE/MAE de las 163 operaciones del backtest.
 *   - el 47,8% de las PERDEDORAS llegaron a estar en +0,50R antes de caer al stop
 *   - pero el 35,2% de las GANADORAS bajaron a -0,50R antes de acabar ganando
 *
 * Esas dos cifras juntas son la razon de que la management no se pueda decidir
 * "a ojo": cualquier regla que rescate perdedoras mata tambien ganadoras. La
 * unica pregunta valida es cual de los dos efectos pesa mas, y eso se simula.
 *
 * CUATRO REGLAS, todas opcionales y combinables:
 *
 *   BREAK-EVEN   mover el stop al price de entrada cuando se alcanza N R.
 *                Convierte perdidas en empates... y ganadoras en empates.
 *
 *   TRAILING     arrastrar el stop a N ATR por detras del maximum favorable.
 *                Protege beneficio a cambio de salir antes de tiempo.
 *
 *   PARCIAL      close_ una fraction en N R y dejar correr el resto.
 *                Baja la varianza; baja tambien la ganancia mean.
 *
 *   TIME STOP    close_ si en N dias no ha past nada. El capital inmovilizado
 *                tiene coste de oportunidad aunque la operacion no pierda.
 *
 * IMPORTANTE: el orden de comprobacion dentro de cada vela es siempre el
 * mismo — primero lo que perjudica (stop), despues lo que beneficia. En una
 * vela que toca ambos no sabemos el orden real, y suponer lo favorable es
 * como se fabrican los backtests que brillan y luego pierden.
 */

/**
 * GESTION POR DEFECTO, elegida por medicion y no por intuicion.
 * Cierre parcial del 50% en +1R: mantiene la expectancy (+0,127R frente a
 * +0,129R sin management) y reduce el drawdown maximum de -12,5R a -7,9R, un 37%
 * menos. Es la unica variante probada que mejora algo sin pagar por ello.
 *
 * Descartadas y por que:
 *   break-even en +0,5R  el acierto cae del 43,6% al 22,1%. El 35% de las
 *                        ganadoras pasan por -0,5R antes de girar.
 *   parcial + break-even sube el acierto al 55,4% y BAJA la expectancy a
 *                        +0,098R. Mas aciertos, menos dinero.
 *   time stop            empeora en todas las duraciones probadas.
 */
export const DEFAULT_MANAGEMENT = {
  breakEvenAtR: null,
  trailingATR: null,
  parcial: { enR: 1.0, fraction: 0.5 },
  timeStopDays: null,
};

export const NO_MANAGEMENT = {
  breakEvenAtR: null,
  trailingATR: null,
  parcial: null,      // { enR: 1.0, fraction: 0.5 }
  timeStopDays: null,
};

/**
 * Simula una operacion vela a vela aplicando las reglas de management.
 *
 * `op` necesita: direction, entrada, stop, target, atr.
 * Devuelve el resultado en unidades de R BRUTAS (los costes se aplican fuera,
 * why dependen del profile y de si la out fue maker o taker).
 */
export function simulateWithManagement(candles, fromMs, op, maxMs, management = NO_MANAGEMENT) {
  const isLong = op.direction === 'bullish';
  const risk = Math.abs(op.entrada - op.stop);
  if (risk === 0) return null;

  /** Beneficio en R en un price dado. */
  const enR = (p) => (isLong ? p - op.entrada : op.entrada - p) / risk;

  let currentStop = op.stop;
  let mfeR = 0, maeR = 0;
  let partialClosed = null;   // { fraction, enR }
  let movedToBreakEven = false;

  for (const v of candles) {
    if (v.t < fromMs) continue;

    const expired = v.t - fromMs > maxMs
      || (management.timeStopDays !== null && v.t - fromMs > management.timeStopDays * 86400000);
    if (expired) {
      return close_('tiempo', v.c, v.t);
    }

    const favorable = enR(isLong ? v.h : v.l);
    const adverse = enR(isLong ? v.l : v.h);
    if (favorable > mfeR) mfeR = favorable;
    if (adverse < maeR) maeR = adverse;

    // --- 1. Lo que perjudica primero: el stop vigente ---
    const hitsStop = isLong ? v.l <= currentStop : v.h >= currentStop;
    if (hitsStop) return close_(movedToBreakEven ? 'break-even' : 'stop', currentStop, v.t);

    // --- 2. Objetivo ---
    const hitsTarget = isLong ? v.h >= op.target : v.l <= op.target;
    if (hitsTarget) return close_('target', op.target, v.t);

    // --- 3. Cierre parcial ---
    if (management.parcial && !partialClosed) {
      const partialPrice = isLong
        ? op.entrada + risk * management.parcial.enR
        : op.entrada - risk * management.parcial.enR;
      const reached = isLong ? v.h >= partialPrice : v.l <= partialPrice;
      if (reached) {
        partialClosed = { fraction: management.parcial.fraction, enR: management.parcial.enR };
      }
    }

    // --- 4. Break-even: solo despues de comprobar stop y target ---
    if (management.breakEvenAtR !== null && !movedToBreakEven && favorable >= management.breakEvenAtR) {
      currentStop = op.entrada;
      movedToBreakEven = true;
    }

    // --- 5. Trailing: nunca retrocede, solo se aprieta ---
    if (management.trailingATR !== null && op.atr) {
      const extreme = isLong ? v.h : v.l;
      const updated = isLong ? extreme - op.atr * management.trailingATR
                            : extreme + op.atr * management.trailingATR;
      if (isLong ? updated > currentStop : updated < currentStop) currentStop = updated;
    }
  }

  return null; // sigue abierta al final de la serie

  function close_(reason, price, ms) {
    const remainderR = enR(price);
    // Con close parcial, el resultado es la mean ponderada de las dos salidas.
    const r = partialClosed
      ? partialClosed.enR * partialClosed.fraction + remainderR * (1 - partialClosed.fraction)
      : remainderR;
    return {
      reason, exitPrice: price, cerradoEnMs: ms,
      grossResultR: r, mfeR, maeR,
      hadPartial: !!partialClosed,
      finalStop: currentStop,
    };
  }
}

/**
 * Catalogo de configuraciones a comparar. Cada una es una hipotesis distinta
 * sobre que hacer con una position abierta; el backtest decide.
 */
export const VARIANTS = [
  { name: 'sin management (referencia)', management: NO_MANAGEMENT },
  { name: 'break-even en +0,5R', management: { ...NO_MANAGEMENT, breakEvenAtR: 0.5 } },
  { name: 'break-even en +1,0R', management: { ...NO_MANAGEMENT, breakEvenAtR: 1.0 } },
  { name: 'break-even en +1,5R', management: { ...NO_MANAGEMENT, breakEvenAtR: 1.5 } },
  { name: 'trailing 2 ATR', management: { ...NO_MANAGEMENT, trailingATR: 2 } },
  { name: 'trailing 3 ATR', management: { ...NO_MANAGEMENT, trailingATR: 3 } },
  { name: 'parcial 50% en +1R', management: { ...NO_MANAGEMENT, parcial: { enR: 1.0, fraction: 0.5 } } },
  { name: 'parcial 50% en +1R + BE', management: { ...NO_MANAGEMENT, parcial: { enR: 1.0, fraction: 0.5 }, breakEvenAtR: 1.0 } },
  { name: 'time stop 10 dias', management: { ...NO_MANAGEMENT, timeStopDays: 10 } },
  { name: 'time stop 5 dias', management: { ...NO_MANAGEMENT, timeStopDays: 5 } },
];
