/**
 * MODULO 2 - Indicadores tecnicos, implementados desde cero.
 *
 * REGLA DE DISENO: todas son FUNCIONES PURAS.
 *   - entran arrays de numeros, salen arrays de numeros
 *   - no leen ficheros, no hacen fetch, no guardan estado
 *   - la misma entrada siempre da la misma out
 * Eso las hace verificables una por una.
 *
 * REGLA DE ALINEACION: toda funcion devuelve un array de la MISMA longitud
 * que la entrada, con null donde el indicador aun no tiene suficientes
 * datos. Asi indicators[i] siempre corresponde a candles[i]. Si en su lugar
 * devolvieramos arrays shorts, tendriamos que ir restando offsets a mano en
 * cada uso y tarde o temprano leeriamos el RSI de la vela equivocada.
 */

/** Media movil simple: la mean aritmetica de las ultimas N bars. */
export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period]; // window deslizante: O(n) total
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/**
 * Media movil exponencial. Pondera mas las bars recientes.
 *   EMA[i] = price[i] * k + EMA[i-1] * (1 - k),  con k = 2 / (period + 1)
 *
 * El factor 2/(n+1) no es arbitrario: hace que el "centro de masa" de los
 * pesos de la EMA coincida con el de una SMA del mismo period. Por eso una
 * EMA(20) y una SMA(20) son comparables entre si.
 *
 * SEMILLA: hay que arrancar la recursion con algo. Usamos la SMA de las
 * primeras N bars (convencion de Wilder y de TradingView). Arrancar con el
 * primer price suelto tambien "funciona", pero contamina el resultado
 * durante decenas de bars.
 */
export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;

  const k = 2 / (period + 1);

  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  out[period - 1] = seed / period;

  for (let i = period; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

/**
 * Suavizado de Wilder. Es una EMA con alpha = 1/n en vez de 2/(n+1).
 *   W[i] = (W[i-1] * (n - 1) + value[i]) / n
 *
 * ESTE ES EL DETALLE QUE HACE QUE DOS PLATAFORMAS DEN RSI DISTINTOS.
 * Wilder (1978) definio su propio smoothed, mas lento que una EMA normal.
 * Un smoothed de Wilder de period n equivale a una EMA de period 2n-1:
 * el "RSI de 14" de Wilder reacciona como una EMA de 27, no de 14.
 * Quien implementa el RSI con una EMA estandar obtiene otro numero.
 */
function wilderSmoothing(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;

  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  out[period - 1] = seed / period;

  for (let i = period; i < values.length; i++) {
    out[i] = (out[i - 1] * (period - 1) + values[i]) / period;
  }
  return out;
}

/**
 * RSI (Relative Strength Index), Wilder 1978. Rango 0-100.
 *
 *   RS  = mean de gains / mean de losses   (ambas suavizadas a la Wilder)
 *   RSI = 100 - 100 / (1 + RS)
 *
 * Mide la PROPORCION entre strength alcista y bajista reciente, no la
 * velocidad ni la magnitud absoluta del movimiento.
 *
 * OJO con la reading tipica "RSI > 70 = sobrecompra = vender": en una
 * trend fuerte el RSI puede quedarse sobre 70 durante semanas mientras
 * el price sigue subiendo. Es un indicador de CONTEXTO, no una signal.
 */
export function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;

  // Los cambios tienen longitud len-1: el primer close no tiene anterior.
  const gains = [];
  const losses = [];
  for (let i = 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    gains.push(delta > 0 ? delta : 0);
    losses.push(delta < 0 ? -delta : 0);
  }

  const avgGains = wilderSmoothing(gains, period);
  const avgLosses = wilderSmoothing(losses, period);

  // Reindexamos: gains[j] corresponde a closes[j+1].
  for (let j = 0; j < avgGains.length; j++) {
    if (avgGains[j] === null) continue;
    const ms = avgGains[j];
    const mb = avgLosses[j];
    // Sin ninguna bajada en la window, RS es infinito -> RSI = 100.
    out[j + 1] = mb === 0 ? 100 : 100 - 100 / (1 + ms / mb);
  }
  return out;
}

/**
 * MACD (Moving Average Convergence Divergence), Appel.
 *   line       = EMA(fast) - EMA(slow)
 *   signal       = EMA(signalPeriod) de la line MACD
 *   histogram  = line - signal
 *
 * Mide si las medias se estan separando o juntando, o sea la ACELERACION
 * de la trend. El histogram cruzando cero indica que el impulso cambia
 * de signo; la line cruzando cero, que la trend corta cambia respecto
 * a la larga.
 *
 * SUTILEZA: la signal es una EMA de la LINEA MACD, no del price. Y la line
 * MACD no existe hasta la barra 25 (EMA slow de 26). Hay que calcular la
 * signal solo sobre los values reales y volver a alinearla, no sobre un
 * array lleno de nulls.
 */
export function macd(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);

  const line = closes.map((_, i) =>
    fastEma[i] === null || slowEma[i] === null ? null : fastEma[i] - slowEma[i]
  );

  const firstValid = line.findIndex((v) => v !== null);
  const signal = new Array(closes.length).fill(null);
  const histogram = new Array(closes.length).fill(null);

  if (firstValid !== -1) {
    const compact = line.slice(firstValid);
    const compactSignal = ema(compact, signalPeriod);
    for (let j = 0; j < compactSignal.length; j++) {
      if (compactSignal[j] === null) continue;
      const i = firstValid + j;
      signal[i] = compactSignal[j];
      histogram[i] = line[i] - signal[i];
    }
  }
  return { line, signal, histogram };
}

/**
 * ATR (Average True Range), Wilder. Mide VOLATILIDAD en unidades de price.
 *
 *   TR = max( maximum - minimum,
 *             |maximum - cierre_anterior|,
 *             |minimum  - cierre_anterior| )
 *
 * Los dos ultimos terminos existen para capturar los HUECOS de apertura:
 * si el price abre muy above del close previo, el range real del
 * movimiento es mayor que el alto-bajo de esa vela sola.
 *
 * El ATR no dice direction. Sirve para dimensionar: cuanto se mueve BTC un
 * dia normal. Un movimiento de 500 USD significa algo muy distinto con
 * ATR=400 que con ATR=3000.
 */
export function atr(candles, period = 14) {
  const out = new Array(candles.length).fill(null);
  if (candles.length < period + 1) return out;

  const ranges = [];
  for (let i = 1; i < candles.length; i++) {
    const prevClose = candles[i - 1].c;
    ranges.push(Math.max(
      candles[i].h - candles[i].l,
      Math.abs(candles[i].h - prevClose),
      Math.abs(candles[i].l - prevClose)
    ));
  }

  const smoothed = wilderSmoothing(ranges, period);
  for (let j = 0; j < smoothed.length; j++) {
    if (smoothed[j] !== null) out[j + 1] = smoothed[j];
  }
  return out;
}

/**
 * Volumen relativo: volume current dividido por su mean de N bars.
 * 1.0 = volume normal. 2.5 = dos veces y mean lo habitual.
 *
 * Es la forma honesta de leer volume: el numero crudo (miles de BTC) no
 * dice nada sin comparacion, why la escala cambia con los anos.
 */
export function relativeVolume(volumes, period = 20) {
  const mean = sma(volumes, period);
  return volumes.map((v, i) => (mean[i] === null || mean[i] === 0 ? null : v / mean[i]));
}

/** Ultimo value no-null de una serie. Atajo usado por el analizador. */
export function last(serie) {
  for (let i = serie.length - 1; i >= 0; i--) if (serie[i] !== null) return serie[i];
  return null;
}
