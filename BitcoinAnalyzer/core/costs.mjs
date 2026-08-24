/**
 * MODULO 8 - Modelo de costes de Binance.
 *
 * POR QUE ES EL MODULO MAS IMPORTANTE DEL PROYECTO PARA OPERATIVA DIARIA:
 * en el scenario de 15m que seguimos, la comision se comia el 78% del
 * beneficio bruto del target. Un R:R de 0,99:1 (acierto minimum 50%) pasaba
 * a 0,12:1 (acierto minimum 89%). Todo ratio calculado en bruto es ficcion.
 *
 * TRES COSTES, NO UNO:
 *   1. COMISION       porcentaje por operacion, distinto por producto y por
 *                     si pones liquidez (maker) o la quitas (taker)
 *   2. DESLIZAMIENTO  diferencia entre el price que esperas y el que te dan
 *   3. FUNDING        solo en futuros perpetuos: pago cada 8 horas
 *
 * LA ASIMETRIA QUE CASI NADIE MODELA:
 * un target se puede colocar como orden LIMIT, asi que paga tarifa maker.
 * Un stop, no: es una orden de mercado que se dispara sola, paga TAKER y
 * ademas desliza, justo en el timestamp de mayor movimiento. El coste de perder
 * es SIEMPRE mayor que el de ganar, y modelarlos equal infla el resultado.
 *
 * Tarifas VIP0 verificadas en 2026. Cambian con el volume y con BNB.
 */

export const FEE_PROFILES = {
  'spot': {
    name: 'Spot (VIP0, no BNB)',
    makerFee: 0.0010,   // 0,1%
    takerFee: 0.0010,   // 0,1%
    slippage: 0.0002,
    funding: null,           // el spot no paga funding
  },
  'spot-bnb': {
    name: 'Spot (VIP0, paying with BNB, -25%)',
    makerFee: 0.00075,
    takerFee: 0.00075,
    slippage: 0.0002,
    funding: null,
  },
  'futures': {
    name: 'USD-M Futures (VIP0, no BNB)',
    makerFee: 0.0002,   // 0,02%
    takerFee: 0.0005,   // 0,05%
    slippage: 0.0002,
    funding: 0.0001,         // 0,01% por period de 8h (tasa base)
  },
  'futures-bnb': {
    name: 'USD-M Futures (VIP0, paying with BNB, -10%)',
    makerFee: 0.00018,
    takerFee: 0.00045,
    slippage: 0.0002,
    funding: 0.0001,
  },
};

/**
 * Coste total de una operacion completa, en fraction del price de entry.
 *
 * `entryAsMaker`: si entras con orden LIMIT que espera a ser ejecutada
 * (maker) o cruzas el libro con MARKET (taker). Entrar como maker ahorra,
 * pero a cambio no garantiza que te ejecuten: el price puede irse sin ti.
 * Es un coste real cambiado por otro risk real, no una mejora gratis.
 */
export function tradeCosts(profile, { entryAsMaker = false, hoursInPosition = 0 } = {}) {
  const p = typeof profile === 'string' ? FEE_PROFILES[profile] : profile;
  if (!p) throw new Error('Unknown fee profile: ' + profile);

  const entry = entryAsMaker ? p.makerFee : p.takerFee;

  // Salir en target: orden LIMIT colocada de antemano -> maker.
  const exitTP = p.makerFee;

  // Salir en stop: orden de mercado disparada automaticamente -> taker,
  // y ademas desliza. Es el peor timestamp posible para cruzar el libro.
  const exitSL = p.takerFee + p.slippage;

  /**
   * Funding: solo cuenta si la position esta abierta en el instante exacto de
   * liquidacion (00:00, 08:00 y 16:00 UTC). Una operacion de 2 minutos que
   * cruce las 08:00 paga un period entero; una de 7 horas que no cruce
   * ninguno, cero. Aqui se estima por duracion, que es el promedio razonable
   * sin saber la hora concreta de apertura.
   */
  const periodos = p.funding ? Math.floor(hoursInPosition / 8) : 0;
  const costeFunding = p.funding ? periodos * p.funding : 0;

  return {
    profile: p.name,
    entry,
    exitTP,
    exitSL,
    funding: costeFunding,
    fundingPeriods: periodos,
    // Coste total segun como acabe la operacion.
    totalIfWin: entry + exitTP + costeFunding,
    totalIfLoss: entry + exitSL + costeFunding,
    // El slippage tambien afecta a la entry si es a mercado.
    entrySlippage: entryAsMaker ? 0 : p.slippage,
  };
}

/**
 * Convierte un scenario bruto (entry, stop, target) en sus cifras NETAS.
 * Esta es la unica version de un R:R que significa algo para quien opera.
 */
export function netScenario(entry, stop, target, profile, options = {}) {
  const c = tradeCosts(profile, options);
  const isLong = target > entry;

  const brutoGanancia = Math.abs(target - entry) / entry;
  const brutoPerdida = Math.abs(entry - stop) / entry;

  // El slippage de entry empeora las dos ramas por igual.
  const netoGanancia = brutoGanancia - c.totalIfWin - c.entrySlippage;
  const netoPerdida = brutoPerdida + c.totalIfLoss + c.entrySlippage;

  const grossRR = brutoPerdida > 0 ? brutoGanancia / brutoPerdida : 0;
  const netRR = netoPerdida > 0 ? netoGanancia / netoPerdida : 0;

  return {
    isLong,
    costes: c,
    grossGainPct: brutoGanancia * 100,
    grossLossPct: brutoPerdida * 100,
    netGainPct: netoGanancia * 100,
    netLossPct: netoPerdida * 100,
    grossRR: Number(grossRR.toFixed(3)),
    netRR: Number(netRR.toFixed(3)),
    grossMinWinRate: grossRR > 0 ? 100 / (1 + grossRR) : 100,
    netMinWinRate: netRR > 0 ? 100 / (1 + netRR) : 100,
    // Que fraction del beneficio bruto se lleva el coste.
    costBitePct: brutoGanancia > 0 ? ((brutoGanancia - netoGanancia) / brutoGanancia) * 100 : 100,
    // Si el target no cubre ni los costes, la operacion pierde aunque acierte.
    viable: netoGanancia > 0,
  };
}

/**
 * Recorrido minimum (en fraction del price) para que los costes no se coman
 * mas de `maxCostBite` del beneficio bruto. Sirve para descartar horizontes
 * enteros: si el ATR de una timeframe no llega a este numero, esa
 * timeframe no da para operar con este profile de costes, y no hay
 * indicador que lo arregle.
 */
export function minimumMove(profile, maxCostBite = 0.2, options = {}) {
  const c = tradeCosts(profile, options);
  return (c.totalIfWin + c.entrySlippage) / maxCostBite;
}

/** Expectativa neta por operacion, en unidades de risk (R). */
export function netExpectancy(netRR, winRate) {
  return winRate * netRR - (1 - winRate);
}
