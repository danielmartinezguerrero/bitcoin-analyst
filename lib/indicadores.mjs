/**
 * MODULO 2 - Indicadores tecnicos, implementados desde cero.
 *
 * REGLA DE DISENO: todas son FUNCIONES PURAS.
 *   - entran arrays de numeros, salen arrays de numeros
 *   - no leen ficheros, no hacen fetch, no guardan estado
 *   - la misma entrada siempre da la misma salida
 * Eso las hace verificables una por una.
 *
 * REGLA DE ALINEACION: toda funcion devuelve un array de la MISMA longitud
 * que la entrada, con null donde el indicador aun no tiene suficientes
 * datos. Asi indicadores[i] siempre corresponde a velas[i]. Si en su lugar
 * devolvieramos arrays cortos, tendriamos que ir restando offsets a mano en
 * cada uso y tarde o temprano leeriamos el RSI de la vela equivocada.
 */

/** Media movil simple: la media aritmetica de las ultimas N barras. */
export function sma(valores, periodo) {
  const salida = new Array(valores.length).fill(null);
  let suma = 0;
  for (let i = 0; i < valores.length; i++) {
    suma += valores[i];
    if (i >= periodo) suma -= valores[i - periodo]; // ventana deslizante: O(n) total
    if (i >= periodo - 1) salida[i] = suma / periodo;
  }
  return salida;
}

/**
 * Media movil exponencial. Pondera mas las barras recientes.
 *   EMA[i] = precio[i] * k + EMA[i-1] * (1 - k),  con k = 2 / (periodo + 1)
 *
 * El factor 2/(n+1) no es arbitrario: hace que el "centro de masa" de los
 * pesos de la EMA coincida con el de una SMA del mismo periodo. Por eso una
 * EMA(20) y una SMA(20) son comparables entre si.
 *
 * SEMILLA: hay que arrancar la recursion con algo. Usamos la SMA de las
 * primeras N barras (convencion de Wilder y de TradingView). Arrancar con el
 * primer precio suelto tambien "funciona", pero contamina el resultado
 * durante decenas de barras.
 */
export function ema(valores, periodo) {
  const salida = new Array(valores.length).fill(null);
  if (valores.length < periodo) return salida;

  const k = 2 / (periodo + 1);

  let semilla = 0;
  for (let i = 0; i < periodo; i++) semilla += valores[i];
  salida[periodo - 1] = semilla / periodo;

  for (let i = periodo; i < valores.length; i++) {
    salida[i] = valores[i] * k + salida[i - 1] * (1 - k);
  }
  return salida;
}

/**
 * Suavizado de Wilder. Es una EMA con alpha = 1/n en vez de 2/(n+1).
 *   W[i] = (W[i-1] * (n - 1) + valor[i]) / n
 *
 * ESTE ES EL DETALLE QUE HACE QUE DOS PLATAFORMAS DEN RSI DISTINTOS.
 * Wilder (1978) definio su propio suavizado, mas lento que una EMA normal.
 * Un suavizado de Wilder de periodo n equivale a una EMA de periodo 2n-1:
 * el "RSI de 14" de Wilder reacciona como una EMA de 27, no de 14.
 * Quien implementa el RSI con una EMA estandar obtiene otro numero.
 */
function suavizadoWilder(valores, periodo) {
  const salida = new Array(valores.length).fill(null);
  if (valores.length < periodo) return salida;

  let semilla = 0;
  for (let i = 0; i < periodo; i++) semilla += valores[i];
  salida[periodo - 1] = semilla / periodo;

  for (let i = periodo; i < valores.length; i++) {
    salida[i] = (salida[i - 1] * (periodo - 1) + valores[i]) / periodo;
  }
  return salida;
}

/**
 * RSI (Relative Strength Index), Wilder 1978. Rango 0-100.
 *
 *   RS  = media de subidas / media de bajadas   (ambas suavizadas a la Wilder)
 *   RSI = 100 - 100 / (1 + RS)
 *
 * Mide la PROPORCION entre fuerza alcista y bajista reciente, no la
 * velocidad ni la magnitud absoluta del movimiento.
 *
 * OJO con la lectura tipica "RSI > 70 = sobrecompra = vender": en una
 * tendencia fuerte el RSI puede quedarse sobre 70 durante semanas mientras
 * el precio sigue subiendo. Es un indicador de CONTEXTO, no una senal.
 */
export function rsi(cierres, periodo = 14) {
  const salida = new Array(cierres.length).fill(null);
  if (cierres.length < periodo + 1) return salida;

  // Los cambios tienen longitud len-1: el primer cierre no tiene anterior.
  const subidas = [];
  const bajadas = [];
  for (let i = 1; i < cierres.length; i++) {
    const delta = cierres[i] - cierres[i - 1];
    subidas.push(delta > 0 ? delta : 0);
    bajadas.push(delta < 0 ? -delta : 0);
  }

  const mediaSubidas = suavizadoWilder(subidas, periodo);
  const mediaBajadas = suavizadoWilder(bajadas, periodo);

  // Reindexamos: subidas[j] corresponde a cierres[j+1].
  for (let j = 0; j < mediaSubidas.length; j++) {
    if (mediaSubidas[j] === null) continue;
    const ms = mediaSubidas[j];
    const mb = mediaBajadas[j];
    // Sin ninguna bajada en la ventana, RS es infinito -> RSI = 100.
    salida[j + 1] = mb === 0 ? 100 : 100 - 100 / (1 + ms / mb);
  }
  return salida;
}

/**
 * MACD (Moving Average Convergence Divergence), Appel.
 *   linea       = EMA(rapida) - EMA(lenta)
 *   senal       = EMA(periodoSenal) de la linea MACD
 *   histograma  = linea - senal
 *
 * Mide si las medias se estan separando o juntando, o sea la ACELERACION
 * de la tendencia. El histograma cruzando cero indica que el impulso cambia
 * de signo; la linea cruzando cero, que la tendencia corta cambia respecto
 * a la larga.
 *
 * SUTILEZA: la senal es una EMA de la LINEA MACD, no del precio. Y la linea
 * MACD no existe hasta la barra 25 (EMA lenta de 26). Hay que calcular la
 * senal solo sobre los valores reales y volver a alinearla, no sobre un
 * array lleno de nulls.
 */
export function macd(cierres, rapida = 12, lenta = 26, periodoSenal = 9) {
  const emaRapida = ema(cierres, rapida);
  const emaLenta = ema(cierres, lenta);

  const linea = cierres.map((_, i) =>
    emaRapida[i] === null || emaLenta[i] === null ? null : emaRapida[i] - emaLenta[i]
  );

  const primerValido = linea.findIndex((v) => v !== null);
  const senal = new Array(cierres.length).fill(null);
  const histograma = new Array(cierres.length).fill(null);

  if (primerValido !== -1) {
    const compacta = linea.slice(primerValido);
    const senalCompacta = ema(compacta, periodoSenal);
    for (let j = 0; j < senalCompacta.length; j++) {
      if (senalCompacta[j] === null) continue;
      const i = primerValido + j;
      senal[i] = senalCompacta[j];
      histograma[i] = linea[i] - senal[i];
    }
  }
  return { linea, senal, histograma };
}

/**
 * ATR (Average True Range), Wilder. Mide VOLATILIDAD en unidades de precio.
 *
 *   TR = max( maximo - minimo,
 *             |maximo - cierre_anterior|,
 *             |minimo  - cierre_anterior| )
 *
 * Los dos ultimos terminos existen para capturar los HUECOS de apertura:
 * si el precio abre muy por encima del cierre previo, el rango real del
 * movimiento es mayor que el alto-bajo de esa vela sola.
 *
 * El ATR no dice direccion. Sirve para dimensionar: cuanto se mueve BTC un
 * dia normal. Un movimiento de 500 USD significa algo muy distinto con
 * ATR=400 que con ATR=3000.
 */
export function atr(velas, periodo = 14) {
  const salida = new Array(velas.length).fill(null);
  if (velas.length < periodo + 1) return salida;

  const rangos = [];
  for (let i = 1; i < velas.length; i++) {
    const cierrePrevio = velas[i - 1].c;
    rangos.push(Math.max(
      velas[i].h - velas[i].l,
      Math.abs(velas[i].h - cierrePrevio),
      Math.abs(velas[i].l - cierrePrevio)
    ));
  }

  const suavizado = suavizadoWilder(rangos, periodo);
  for (let j = 0; j < suavizado.length; j++) {
    if (suavizado[j] !== null) salida[j + 1] = suavizado[j];
  }
  return salida;
}

/**
 * Volumen relativo: volumen actual dividido por su media de N barras.
 * 1.0 = volumen normal. 2.5 = dos veces y media lo habitual.
 *
 * Es la forma honesta de leer volumen: el numero crudo (miles de BTC) no
 * dice nada sin comparacion, porque la escala cambia con los anos.
 */
export function volumenRelativo(volumenes, periodo = 20) {
  const media = sma(volumenes, periodo);
  return volumenes.map((v, i) => (media[i] === null || media[i] === 0 ? null : v / media[i]));
}

/** Ultimo valor no-null de una serie. Atajo usado por el analizador. */
export function ultimo(serie) {
  for (let i = serie.length - 1; i >= 0; i--) if (serie[i] !== null) return serie[i];
  return null;
}
