/**
 * MODULO 11 - Deteccion de regimen de mercado.
 *
 * POR QUE: el backtest mostro que la expectancy de la estrategia NO es una
 * propiedad estable. Por anos: +0,28R en 2020 y -0,16R en 2021, 2022 y 2024.
 * El -0,03R agregado es el promedio de comportamientos opuestos, no un numero
 * que describa nada. Si la ventaja aparece y desaparece segun el estado del
 * mercado, detectar ese estado importa mas que cualquier indicador updated.
 *
 * QUE MIDE
 *
 *   EFFICIENCY RATIO (Kaufman, 1995)
 *     ER = |cambio net en N bars| / sum de |cambios barra a barra|
 *
 *   Es una razon entre 0 y 1 con una reading muy directa: cuanto del
 *   movimiento total se convirtio en avance real. Si el price sube 100,
 *   baja 100 y vuelve a subir 100, el move total es 300 y el net 100:
 *   ER = 0,33. Si sube 100 de un tiron, ER = 1.
 *
 *   Frente al ADX tiene dos ventajas: no lleva retraso de smoothed, y no
 *   depende de ningun parametro mas que la window. Las fuentes consultadas
 *   lo describen como "puerta" (gate): los sistemas de trend solo operan
 *   mientras el ratio se mantiene above de un umbral.
 *
 *   PERCENTIL DE VOLATILIDAD
 *     donde cae el ATR current dentro de su propia historia reciente.
 *   Un ATR de 2.000 USDT no dice nada por si mismo; que ese ATR este en el
 *   percentile 90 de su last ano, si.
 *
 * LO QUE ESTE MODULO NO HACE: predecir. Describe el estado presente. Que ese
 * estado tenga value para filtrar operaciones es una hipotesis que se mide
 * en el backtest, no algo que se da por hecho aqui.
 */

/**
 * Efficiency Ratio de Kaufman sobre los ultimos `period` closes.
 * Devuelve { value, direction } — la direction es el signo del cambio net.
 */
export function efficiencyRatio(closes, period = 20) {
  if (closes.length < period + 1) return { value: null, direction: 0 };

  const window = closes.slice(-(period + 1));
  const netChange = window[window.length - 1] - window[0];

  let totalPath = 0;
  for (let i = 1; i < window.length; i++) {
    totalPath += Math.abs(window[i] - window[i - 1]);
  }

  // Sin movimiento no hay eficiencia que medir; 0 es la reading honesta.
  if (totalPath === 0) return { value: 0, direction: 0 };

  return {
    value: Math.abs(netChange) / totalPath,
    direction: Math.sign(netChange),
    netChange,
    totalPath,
  };
}

/** Serie completa de ER, alineada con los closes (null donde no hay datos). */
export function efficiencyRatioSeries(closes, period = 20) {
  const out = new Array(closes.length).fill(null);
  for (let i = period; i < closes.length; i++) {
    out[i] = efficiencyRatio(closes.slice(0, i + 1), period).value;
  }
  return out;
}

/**
 * Percentil del last value dentro de la window. 0 = el mas bajo de todos,
 * 1 = el mas alto. Es la forma de leer una magnitud sin escala fija.
 */
export function percentile(serie, window = 250) {
  const validos = serie.filter((x) => x !== null && x !== undefined).slice(-window);
  if (validos.length < 20) return null;
  const current = validos[validos.length - 1];

  /**
   * PERCENTIL MEDIO (mid-rank): los empates cuentan la mitad.
   *
   * Contar solo los estrictamente below rompe con values repetidos: una
   * serie constante daria percentile 0 — es decir, "minimum historico" — cuando
   * en realidad no hay ni maximum ni minimum, todo es igual. En volatilidad eso
   * pasa de verdad: periodos longs de ATR practicamente identico existen, y
   * clasificarlos como volatilidad minima cambiaria el regimen detectado.
   * Repartir los empates devuelve 0,5 para una serie plana, que es la reading
   * correcta.
   */
  const below = validos.filter((x) => x < current).length;
  const equal = validos.filter((x) => x === current).length;
  return (below + equal / 2) / validos.length;
}

/**
 * Umbrales de clasificacion. Explicitos y ajustables: su efecto real se mide
 * en el backtest, no se decide por intuicion.
 */
export const THRESHOLDS = {
  erTrend: 0.35,   // above: el movimiento avanza de verdad
  erRange: 0.20,       // below: el price se mueve mucho y avanza poco
  volHigh: 0.80,       // percentile de ATR a partir del cual la vol es alta
  volLow: 0.20,
  erPeriod: 20,
  percentileWindow: 250,
};

/**
 * Clasifica el estado current del mercado.
 *
 * Cuatro regimenes, y la distincion que importa: no es solo "trend si o
 * no", sino tambien si la volatilidad acompana. Una trend con volatilidad
 * en el percentile 95 se recorre en dias; la misma trend con volatilidad
 * en el percentile 10 tarda semanas, y los stops en ATR quedan diminutos.
 */
export function classifyRegime(candles, atrSeries, thresholds = THRESHOLDS) {
  const closes = candles.map((v) => v.c);
  const er = efficiencyRatio(closes, thresholds.erPeriod);
  const volPct = percentile(atrSeries, thresholds.percentileWindow);

  if (er.value === null) {
    return { kind: 'undetermined', reason: 'Not enough data for the Efficiency Ratio.' };
  }

  const isTrending = er.value >= thresholds.erTrend;
  const isRanging = er.value < thresholds.erRange;
  const direction = er.direction > 0 ? 'bullish' : er.direction < 0 ? 'bearish' : 'flat';

  let kind, description;
  if (isTrending) {
    kind = direction === 'bullish' ? 'uptrend' : 'downtrend';
    description = 'Price converts ' + (er.value * 100).toFixed(0)
      + '% of its total path into net progress: it moves one way, not back and forth.';
  } else if (isRanging) {
    kind = 'ranging';
    description = 'Only ' + (er.value * 100).toFixed(0)
      + '% of the path becomes net progress: price moves a lot and gets nowhere.';
  } else {
    kind = 'transition';
    description = 'Intermediate efficiency (' + (er.value * 100).toFixed(0)
      + '%): neither a clean trend nor a clear range.';
  }

  const volState =
    volPct === null ? 'unknown'
    : volPct >= thresholds.volHigh ? 'high'
    : volPct <= thresholds.volLow ? 'low'
    : 'normal';

  return {
    kind,
    direction,
    er: Number(er.value.toFixed(3)),
    erTrendThreshold: thresholds.erTrend,
    volatilityPercentile: volPct === null ? null : Number(volPct.toFixed(2)),
    volatilityState: volState,
    isTrending,
    isRanging,
    description,
    /**
     * `favorableForTrend` es la hipotesis a contrastar: que las
     * operaciones direccionales rinden best cuando el mercado avanza de
     * verdad. Se expone como campo para que el backtest pueda medirla,
     * no como una verdad asumida.
     */
    favorableForTrend: isTrending,
  };
}
