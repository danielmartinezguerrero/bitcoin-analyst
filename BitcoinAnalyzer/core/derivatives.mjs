/**
 * MODULO 13 - Datos de derivados de Binance.
 *
 * QUE HAY DISPONIBLE GRATIS Y CUANTO HISTORICO GUARDA CADA COSA:
 *
 *   funding rate            desde 2019   -> BACKTESTEABLE
 *   top trader long/short   31 dias      -> solo en vivo
 *   open interest           31 dias      -> solo en vivo
 *   taker buy/sell ratio    32 dias      -> solo en vivo
 *
 * Esa asimetria manda: el funding es el unico con historia suficiente para
 * validar nada. Los ratios de grandes traders hay que empezar a acumularlos
 * hoy para poder medirlos dentro de unos meses.
 *
 * QUE ES EL FUNDING: el pago que cada 8 horas se hacen longs y shorts del
 * perpetuo para que su price no se separe del spot. Positivo = los longs
 * pagan a los shorts, o sea hay mas presion compradora apalancada. Es el
 * best proxy gratuito del posicionamiento con dinero prestado.
 *
 * COMO SE LEE: en extremos funciona como indicador CONTRARIO. Un funding muy
 * alto significa longs hacinados pagando por seguir dentro, y esas
 * situaciones preceden a cascadas de liquidacion. La literatura lo describe
 * asi de forma consistente, pero si eso mejora la expectancy de ESTE sistema
 * es una hipotesis que se mide en el backtest, no algo que se de por hecho.
 */

/** Percentil del last value dentro de la window, con empates repartidos. */
function midRankPercentile(values, current) {
  const below = values.filter((x) => x < current).length;
  const equal = values.filter((x) => x === current).length;
  return (below + equal / 2) / values.length;
}

/**
 * Estado del funding en un instante dado, usando SOLO records anteriores.
 * `untilMs` es obligatorio en backtest: sin el, se colaria informacion futura.
 */
export function fundingState(records, untilMs, window = 360) {
  const past = records.filter((f) => f.t <= untilMs);
  if (past.length < 30) return null;

  const current = past[past.length - 1];
  const windowRates = past.slice(-window).map((f) => f.tasa);
  const pct = midRankPercentile(windowRates, current.tasa);

  // Media de los ultimos 3 periodos = un dia completo de funding.
  const lastDay = past.slice(-3).reduce((s, f) => s + f.tasa, 0) / 3;

  return {
    tasa: current.tasa,
    ratePct: current.tasa * 100,
    date: current.date,
    dailyAverage: lastDay,
    percentile: Number(pct.toFixed(3)),
    /**
     * Extremos definidos por percentile, no por un value fijo: la escala del
     * funding cambia entre epocas de euforia y de calma, y un umbral absoluto
     * envejeceria mal.
     */
    bullishExtreme: pct >= 0.9,   // longs hacinados
    bearishExtreme: pct <= 0.1,   // shorts hacinados
    description: pct >= 0.9
      ? 'Funding at percentile ' + (pct * 100).toFixed(0) + ': leveraged longs are crowded, paying to stay in.'
      : pct <= 0.1
      ? 'Funding at percentile ' + (pct * 100).toFixed(0) + ': shorts are crowded, longs get paid to stay in.'
      : 'Funding en el percentile ' + (pct * 100).toFixed(0) + ': leveraged positioning with no extremes.',
  };
}

/**
 * Instantanea en vivo del posicionamiento. Sin historico backtesteable, asi
 * que sirve para informar al lector, NO para decidir de forma automatica.
 * Se recolecta cada dia para poder validarlo en el futuro.
 */
export async function derivativesSnapshot(symbol = 'BTCUSDT') {
  const base = 'https://fapi.binance.com/futures/data/';
  const request = async (ruta) => {
    const r = await fetch(base + ruta + `?symbol=${symbol}&period=5m&limit=1`,
      { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const d = await r.json();
    return d[0] ?? null;
  };

  const [posiciones, cuentas, global, oi, taker] = await Promise.all([
    request('topLongShortPositionRatio'),
    request('topLongShortAccountRatio'),
    request('globalLongShortAccountRatio'),
    request('openInterestHist'),
    request('takerlongshortRatio'),
  ]);

  const num = (x) => (x === undefined || x === null ? null : Number(x));

  return {
    timestamp: new Date().toISOString(),
    // Ponderado por TAMANO de position: es el que refleja donde esta el dinero.
    topPositions: num(posiciones?.longShortRatio),
    topAccounts: num(cuentas?.longShortRatio),
    allAccounts: num(global?.longShortRatio),
    openInterestBTC: num(oi?.sumOpenInterest),
    openInterestUSD: num(oi?.sumOpenInterestValue),
    takerBuySell: num(taker?.buySellRatio),
    /**
     * La DIVERGENCIA es lo interesante: cuando los grandes por tamano y el
     * conjunto de cuentas minoristas apuntan a lados distintos. Un numero
     * suelto dice poco; la diferencia entre los dos dice quien esta al otro
     * lado de quien.
     */
    whaleRetailDivergence:
      posiciones && global
        ? Number((num(posiciones.longShortRatio) - num(global.longShortRatio)).toFixed(3))
        : null,
  };
}
