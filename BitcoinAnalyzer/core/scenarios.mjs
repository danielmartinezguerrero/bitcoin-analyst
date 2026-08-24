/**
 * MODULO 5 - Escenarios operativos.
 *
 * Construye scenarios CONDICIONALES a partir de la structure del grafico:
 * donde estaria la invalidation tecnica (stop), donde estan los targets
 * tecnicos (take profit), y que relacion risk/move resulta.
 *
 * QUE ES Y QUE NO ES ESTE MODULO
 * Es una description geometrica: "si alguien operara este scenario, la
 * structure se romperia en X y las siguientes zonas estan en Y y Z".
 * No es una recomendacion de inversion: no sabe nada de quien lo lee, ni de
 * su capital, ni de su horizonte, y no afirma que el scenario vaya a ocurrir.
 *
 * TRES DECISIONES DE DISENO, TODAS CON FUNDAMENTO:
 *
 * 1. STOP HIBRIDO (structure + suelo de ATR). La structure dice donde deja
 *    de ser valida la reading; el suelo de ATR impide que el stop quede tan
 *    pegado que lo barra el ruido normal del mercado. Los backtests publicados
 *    muestran que el stop puramente fijo consigue el best ratio y la PEOR
 *    tasa de acierto, justo por quedarse dentro del ruido.
 *
 * 2. SIEMPRE SE CONSTRUYEN LAS DOS DIRECCIONES. Generar solo el scenario que
 *    coincide con el bias dominante es bias de confirmacion instalado en el
 *    codigo. Se construyen los dos y se label cual va a favor y cual en
 *    contra de la structure.
 *
 * 3. CADA OBJETIVO LLEVA SU TASA DE ACIERTO DE EQUILIBRIO. Un R:R de 3:1 no
 *    significa nada por si solo: con menos de un 25% de aciertos pierde dinero
 *    igual. La formula es winRateMinimo = 1 / (1 + R). Mostrar el R:R sin ese
 *    umbral al lado es la forma mas comun de enganarse con un grafico.
 */

import { netScenario } from './costs.mjs';

/** Colchon mas alla del nivel estructural, en ATR. */
const BUFFER_ATR = 0.25;
/** Distancia minima del stop al price, en ATR: below es ruido. */
const FLOOR_ATR = 1.0;
/** Por encima de esto el stop es tan amplio que el scenario pierde sentido. */
const CEILING_ATR = 4.0;

/**
 * Tasa de acierto minima para que un scenario con ratio R no pierda dinero.
 *   winRate * R = (1 - winRate) * 1   ->   winRate = 1 / (1 + R)
 * Es aritmetica de expectancy, no una estimacion ni una prediccion.
 */
export function breakEvenWinRate(rr) {
  return rr <= 0 ? 1 : 1 / (1 + rr);
}

/**
 * Expectativa por operacion en unidades de risk (R), dada una tasa de
 * acierto hipotetica. Positiva = ventaja; negativa = perdida a largo plazo.
 *   E = (p * R) - ((1 - p) * 1)
 */
export function expectancy(rr, winRate) {
  return winRate * rr - (1 - winRate) * 1;
}

/**
 * Situa la invalidation combinando structure y volatilidad.
 * Devuelve tambien EN QUE se baso, para que la cifra sea auditable.
 */
function computeInvalidation(direction, price, atr, structuralLevel) {
  const isLong = direction === 'bullish';
  let base = 'structure';
  let stopPrice;

  if (structuralLevel) {
    // Un colchon mas alla del nivel: los barridos suelen perforarlo
    // ligeramente antes de girar.
    stopPrice = isLong
      ? structuralLevel.price - atr * BUFFER_ATR
      : structuralLevel.price + atr * BUFFER_ATR;
  } else {
    // Sin referencia estructural, solo queda la volatilidad.
    stopPrice = isLong ? price - atr * 1.5 : price + atr * 1.5;
    base = 'volatility (no structural level in window)';
  }

  // SUELO: si la structure deja el stop dentro del ruido de una vela, se
  // aleja hasta 1 ATR. Un stop a 0,3 ATR salta por el movimiento normal del
  // dia, no why la reading fuera incorrecta.
  const distance = Math.abs(price - stopPrice);
  if (distance < atr * FLOOR_ATR) {
    stopPrice = isLong ? price - atr * FLOOR_ATR : price + atr * FLOOR_ATR;
    base = '1 ATR floor (structure was inside the noise)';
  }

  return {
    price: stopPrice,
    base,
    sourceLevel: structuralLevel ? structuralLevel.price : null,
    distanceATR: Number((Math.abs(price - stopPrice) / atr).toFixed(2)),
    distancePct: Number((((stopPrice - price) / price) * 100).toFixed(2)),
  };
}

/**
 * Objetivos tecnicos: las siguientes zonas en la direction del movimiento.
 * Si no hay ninguna (descubrimiento de price), se proyecta por multiplos de
 * ATR y se label claramente como projection, no como nivel observado.
 */
function computeTargets(direction, price, atr, levels, risk, costes = null) {
  const isLong = direction === 'bullish';
  const inDirection = levels
    .filter((n) => (isLong ? n.price > price : n.price < price))
    .sort((a, b) => (isLong ? a.price - b.price : b.price - a.price))
    .slice(0, 3);

  const build = (precioObjetivo, origin, strength = null) => {
    const move = Math.abs(precioObjetivo - price);
    // Se redondea PRIMERO y todo lo demas se deriva del value redondeado.
    // Si publicaramos rr=1.71 pero calcularamos el umbral con 1.714285...,
    // quien rehiciera la cuenta a mano no obtendria nuestra cifra. Cada
    // numero del dossier tiene que poder reproducirse desde los que se ven.
    const rr = Number((risk > 0 ? move / risk : 0).toFixed(2));
    const wr = breakEvenWinRate(rr);

    /**
     * CIFRAS NETAS. El R:R bruto es una propiedad del grafico; el net es lo
     * unico que describe la operacion real. En horizontes shorts la diferencia
     * no es un matiz: un 0,99:1 bruto puede ser 0,12:1 net.
     */
    const impliedStop = isLong ? price - risk : price + risk;
    const net = costes
      ? netScenario(price, impliedStop, precioObjetivo, costes.profile, costes.options)
      : null;

    return {
      price: precioObjetivo,
      origin,
      levelStrength: strength,
      distanceATR: Number((move / atr).toFixed(2)),
      distancePct: Number((((precioObjetivo - price) / price) * 100).toFixed(2)),
      rr,
      minWinRatePct: Number((wr * 100).toFixed(1)),
      // Expectativa si el sistema acertara la mitad de las veces. Es un
      // supuesto ILUSTRATIVO: no hemos medido la tasa real de este sistema.
      expectancyAt50Pct: Number(expectancy(rr, 0.5).toFixed(2)),
      netRR: net ? net.netRR : null,
      netMinWinRatePct: net ? Number(net.netMinWinRate.toFixed(1)) : null,
      costBitePct: net ? Number(net.costBitePct.toFixed(1)) : null,
      viable: net ? net.viable : null,
    };
  };

  if (inDirection.length) {
    return inDirection.map((n) =>
      build(n.price, 'zone with ' + n.touches + ' touches', n.strength)
    );
  }

  return [1.5, 2.5, 4].map((mult) =>
    build(
      isLong ? price + atr * mult : price - atr * mult,
      'volatility projection (' + mult + ' ATR) — no historical level in window',
      null
    )
  );
}

/**
 * Construye el scenario de una direction.
 * `levels` es la lista completa de zonas de la timeframe de referencia.
 */
export function buildScenario(direction, price, atr, levels, dominantBias, costes = null) {
  const isLong = direction === 'bullish';

  // El nivel estructural relevante esta al otro lado del movimiento: para un
  // scenario alcista, el support que lo sostiene; para uno bajista, la
  // resistance que lo tapa.
  const support = levels
    .filter((n) => n.price < price)
    .sort((a, b) => b.price - a.price)[0] ?? null;
  const resistance = levels
    .filter((n) => n.price > price)
    .sort((a, b) => a.price - b.price)[0] ?? null;

  const invalidation = computeInvalidation(direction, price, atr, isLong ? support : resistance);
  const risk = Math.abs(price - invalidation.price);
  const targets = computeTargets(direction, price, atr, levels, risk, costes);

  const warnings = [];

  if (invalidation.distanceATR > CEILING_ATR) {
    warnings.push('Invalidation sits at ' + invalidation.distanceATR
      + ' ATR: very wide risk for this chart, and it drags the ratio down.');
  }
  if (invalidation.base.startsWith('suelo')) {
    warnings.push('El nivel estructural quedaba dentro del ruido de una vela; '
      + 'la invalidation se alejo hasta 1 ATR. No coincide con un nivel del grafico.');
  }
  if (targets[0] && targets[0].origin.startsWith('projection')) {
    warnings.push('No hay zonas historicas en esa direction dentro de la window: '
      + 'los targets son proyecciones de volatilidad, no levels observados.');
  }
  if (targets[0] && targets[0].rr < 1) {
    warnings.push('El primer target esta mas cerca que la invalidation (R:R menor que 1): '
      + 'habria que acertar mas de la mitad de las veces solo para no perder.');
  }

  const aligned =
    (isLong && dominantBias > 0) || (!isLong && dominantBias < 0);

  if (!aligned) {
    warnings.push('Este scenario va EN CONTRA del bias tecnico agregado. '
      + 'Se incluye para no mirar solo el lado que confirma la reading.');
  }

  return {
    direction,
    alignedWithBias: aligned,
    referencePrice: price,
    invalidation,
    riskUnit: Number(risk.toFixed(2)),
    riskATR: Number((risk / atr).toFixed(2)),
    targets,
    warnings,
    /**
     * La condicion que tendria que cumplirse para considerar el scenario
     * vigente. Sin activation, un scenario es solo geometria sobre el
     * grafico: no describe nada que este ocurriendo.
     */
    activation: isLong
      ? 'Cierre confirmado above de ' + price.toFixed(0)
        + ' holding above ' + invalidation.price.toFixed(0) + '.'
      : 'Cierre confirmado below de ' + price.toFixed(0)
        + ' holding below ' + invalidation.price.toFixed(0) + '.',
  };
}

/** Construye los dos scenarios y los devuelve juntos, nunca uno solo. */
export function buildScenarios(refAnalysis, synthesis, costes = null) {
  const price = refAnalysis.price;
  const atr = refAnalysis.indicators.atr14;
  const levels = [
    ...refAnalysis.levels.resistances,
    ...refAnalysis.levels.supports,
  ];

  return {
    timeframe: refAnalysis.timeframe,
    price,
    atr,
    scenarios: [
      buildScenario('bullish', price, atr, levels, synthesis.score, costes),
      buildScenario('bearish', price, atr, levels, synthesis.score, costes),
    ],
    /**
     * EL LIMITE MAS IMPORTANTE DE TODO ESTE MODULO.
     * Los ratios y los thresholds de equilibrio son aritmetica exacta. Pero si
     * este sistema alcanza esos thresholds en la practica NO SE HA MEDIDO: hace
     * falta la validacion estadistica sobre historico. Hasta entonces, un R:R
     * de 3:1 dice cuanto se arriesga por cuanto se busca, y nada mas.
     */
    limitation: 'Los thresholds de acierto son matematicos, no empiricos. La tasa de '
      + 'acierto real de estos scenarios no ha sido medida sobre historico todavia.',
  };
}
