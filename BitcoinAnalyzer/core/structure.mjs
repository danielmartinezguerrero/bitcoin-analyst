/**
 * MODULO 3 - Estructura de mercado.
 *
 * Los indicators del modulo 2 son transformaciones matematicas del price.
 * Este modulo hace algo distinto: identifica DONDE ocurrieron las cosas.
 * Un RSI de 80 pegado a una resistance tocada cinco veces no significa lo
 * mismo que un RSI de 80 en aire libre. El context lo aporta la structure.
 *
 * Tres capas, cada una construida sobre la anterior:
 *   1. pivots            -> los giros del price
 *   2. marketStructure  -> la secuencia de esos giros (trend)
 *   3. keyLevels       -> los pivots agrupados en zonas de price
 */

/**
 * PIVOTES (swing points). Un maximum local es una vela cuyo maximum supera al
 * de las `left` candles anteriores y las `right` posteriores.
 *
 * EL SESGO DE ANTICIPACION (look-ahead bias):
 * un pivote en el indice i NO SE PUEDE CONOCER hasta el indice i + right,
 * why hacen falta las candles de la derecha para confirmarlo. Por eso cada
 * pivote lleva `confirmedAt`. Si haces un backtest usando pivots sin
 * respetar ese campo, estas mirando el futuro y tus resultados seran
 * fantasticos e imposibles de reproducir en vivo.
 *
 * ELECCION DE left/right: es el clasico compromiso ruido/retraso.
 *   values lows (2-3)  -> muchos pivots, mucho ruido, confirmacion fast
 *   values highs (8-10) -> solo giros importantes, pero tardas 10 candles en verlos
 * Usamos 5 por defecto: en diario detecta giros de aproximadamente una semana.
 */
export function pivots(candles, left = 5, right = 5) {
  const out = [];

  for (let i = left; i < candles.length - right; i++) {
    let isHigh = true;
    let isLow = true;

    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (candles[j].h >= candles[i].h) isHigh = false;
      if (candles[j].l <= candles[i].l) isLow = false;
      if (!isHigh && !isLow) break;
    }

    // Una misma vela podria ser ambas cosas en datos degenerados; la
    // registramos por separado, no la descartamos.
    // Guardamos el volume del giro: la evidencia dice que importa mas que
    // el numero de touches a la hora de medir la strength de una zona.
    const base = { i, price: 0, date: candles[i].date, volume: candles[i].v, confirmedAt: i + right };
    if (isHigh) out.push({ ...base, kind: 'high', price: candles[i].h });
    if (isLow) out.push({ ...base, kind: 'low', price: candles[i].l });
  }

  return out;
}

/**
 * ESTRUCTURA DE MERCADO. Lee la SECUENCIA de pivots, no su value absoluto.
 *
 *   HH (higher high)  maximum mas alto que el maximum anterior
 *   HL (higher low)   minimum mas alto que el minimum anterior
 *   LH (lower high)   maximum mas bajo que el maximum anterior
 *   LL (lower low)    minimum mas bajo que el minimum anterior
 *
 * Alcista  = HH + HL encadenados. Bajista = LH + LL. Mezcla = range o giro.
 *
 * Esta es la definicion de trend mas antigua que existe (Dow, 1900) y
 * no depende de ningun parametro ajustable, a diferencia de "el price esta
 * sobre la EMA200". Por eso vale como contraste independiente.
 */
export function marketStructure(pivotesLista, toleranciaIgualdadPct = 0.15) {
  const highs = pivotesLista.filter((p) => p.kind === 'high');
  const lows = pivotesLista.filter((p) => p.kind === 'low');

  /**
   * TERCER CASO: LA IGUALDAD.
   * Comparar con `>` a secas obliga a que todo maximum sea HH o LH. Pero dos
   * maximos practicamente identicos (un doble techo, o el techo de un range
   * lateral) no son ninguna de las dos cosas: son EQH (equal high).
   * Sin este caso, cualquier range lateral se clasifica como trend
   * bajista, why `price > anterior` es falso cuando son equal.
   *
   * La tolerance es porcentual why dos maximos que difieren en 5 USD son
   * "el mismo nivel" con BTC a 77.000, pero no con BTC a 300.
   */
  const label = (lista, etiquetaSube, etiquetaBaja, etiquetaIgual) =>
    lista.map((p, k) => {
      if (k === 0) return { ...p, label: null };
      const previo = lista[k - 1].price;
      const difPct = ((p.price - previo) / previo) * 100;
      const label =
        Math.abs(difPct) <= toleranciaIgualdadPct ? etiquetaIgual
        : difPct > 0 ? etiquetaSube
        : etiquetaBaja;
      return { ...p, label };
    });

  const labeledHighs = label(highs, 'HH', 'LH', 'EQH');
  const labeledLows = label(lows, 'HL', 'LL', 'EQL');

  // Miramos los dos ultimos de cada kind para juzgar la trend vigente.
  const recentLabels = [...labeledHighs, ...labeledLows]
    .filter((p) => p.label !== null)
    .sort((a, b) => a.i - b.i)
    .slice(-4);

  const bullish = recentLabels.filter((p) => p.label === 'HH' || p.label === 'HL').length;
  const bearish = recentLabels.filter((p) => p.label === 'LH' || p.label === 'LL').length;
  const equal = recentLabels.filter((p) => p.label === 'EQH' || p.label === 'EQL').length;

  let trend;
  if (recentLabels.length < 2) trend = 'undetermined';
  else if (equal >= recentLabels.length / 2) trend = 'range lateral';
  else if (bullish >= 3 && bearish <= 1) trend = 'bullish';
  else if (bearish >= 3 && bullish <= 1) trend = 'bearish';
  else trend = 'sideways or transitioning';

  const lastHigh = labeledHighs[labeledHighs.length - 1] ?? null;
  const lastLow = labeledLows[labeledLows.length - 1] ?? null;

  return {
    trend,
    recentSequence: recentLabels.map((p) => p.label),
    lastHigh,
    lastLow,
    totalHighs: highs.length,
    totalLows: lows.length,
    // Nivel cuya rotura invalidaria la reading current. Es informativo:
    // describe la condicion tecnica, no sugiere ninguna accion.
    invalidationLevel:
      trend === 'bullish' ? lastLow?.price ?? null
      : trend === 'bearish' ? lastHigh?.price ?? null
      : null,
  };
}

/**
 * NIVELES CLAVE por agrupacion (clustering) de pivots.
 *
 * Un pivote suelto es una anecdota. Cinco pivots a menos de un 1% unos de
 * otros son una ZONA donde el mercado reacciono repetidamente. Eso es lo
 * que la gente llama support o resistance.
 *
 * DECISION IMPORTANTE - la tolerance se mide en ATR, no en porcentaje fijo:
 * con BTC a 20.000 USD un 1% eran 200 USD; a 100.000 son 1.000. Peor aun, la
 * volatilidad cambia sola: en calma el price no recorre en una semana lo que
 * en panico recorre en una hora. Usar `toleranceATR * ATR` hace que el
 * algoritmo se adapte al regimen de volatilidad en lugar de necesitar que le
 * ajustemos el numero a mano cada pocos meses.
 */
export function keyLevels(candles, pivotesLista, atrActual, options = {}) {
  const {
    toleranceATR = 0.5,
    maxLevels = 10,
    halfLife = 50,      // en bars: a las 50 bars un nivel pesa la mitad
    minTouches = 2,
    volumeWindow = 20,
  } = options;

  if (!pivotesLista.length || !atrActual) return [];

  const tolerance = atrActual * toleranceATR;

  // Volumen relativo de cada barra: el volume crudo no es comparable entre
  // epocas distintas, pero "3 veces lo normal de entonces" si lo es.
  const volRelPorBarra = candles.map((v, i) => {
    const desde = Math.max(0, i - volumeWindow + 1);
    const window = candles.slice(desde, i + 1);
    const mean = window.reduce((s, x) => s + x.v, 0) / window.length;
    return mean > 0 ? v.v / mean : 1;
  });

  const sorted = [...pivotesLista].sort((a, b) => a.price - b.price);

  // Agrupacion lineal: recorremos precios ascendentes y cerramos el group
  // en cuanto aparece un salto mayor que la tolerance.
  const groups = [];
  let current = [sorted[0]];

  for (let k = 1; k < sorted.length; k++) {
    const medioActual = current.reduce((s, p) => s + p.price, 0) / current.length;
    if (Math.abs(sorted[k].price - medioActual) <= tolerance) {
      current.push(sorted[k]);
    } else {
      groups.push(current);
      current = [sorted[k]];
    }
  }
  groups.push(current);

  const lastIndex = candles.length - 1;
  const currentPrice = candles[lastIndex].c;

  const levels = groups.map((group) => {
    const volumes = group.map((p) => volRelPorBarra[p.i]);
    const volumenTotal = volumes.reduce((s, x) => s + x, 0);

    /**
     * PRECIO PONDERADO POR VOLUMEN, no mean aritmetica.
     * Si un cluster tiene un toque en 74.900 con volume flojo y otro en
     * 75.100 con volume enorme, el nivel real esta en 75.100: ahi es donde
     * se comprometio el capital. La mean aritmetica lo situaria en 75.000,
     * un price donde no ocurrio nada.
     */
    const price = volumenTotal > 0
      ? group.reduce((s, p, k) => s + p.price * volumes[k], 0) / volumenTotal
      : group.reduce((s, p) => s + p.price, 0) / group.length;

    const mostRecentIndex = Math.max(...group.map((p) => p.i));
    const ageBars = lastIndex - mostRecentIndex;
    const touches = group.length;

    /**
     * PUNTUACION DE FUERZA. Tres componentes, todos normalizados a [0,1]:
     *
     *  touchesNorm  satura a los 5 touches. El sexto rebote no aporta tanta
     *              informacion nueva como el segundo.
     *  volNorm     escala LOGARITMICA. Sin el log, una sola vela de capitulacion
     *              con volume 20x dominaria la clasificacion entera.
     *  decay SEMIVIDA exponencial: 0,5 elevado a (antiguedad/halfLife).
     *              Un decay lineal trata igual pasar de la barra 10 a la
     *              20 que de la 200 a la 210, y la relevancia no funciona asi.
     *
     * Los pesos 30/70 vienen de la practica documentada del sector: el volume
     * informa mas que el recuento de touches. Estan aqui como constantes
     * visibles y ajustables, no escondidos en una formula.
     */
    const touchesNorm = Math.min(1, touches / 5);
    const volNorm = Math.min(1, Math.log1p(volumenTotal) / Math.log1p(10));
    const decay = Math.pow(0.5, ageBars / halfLife);
    const strength = (0.3 * touchesNorm + 0.7 * volNorm) * decay * 100;

    return {
      price,
      touches,
      totalRelativeVolume: Number(volumenTotal.toFixed(2)),
      ageBars,
      decay: Number(decay.toFixed(3)),
      // FUERZA y DISTANCIA son ejes independientes a proposito. Un nivel no
      // es mas fuerte por estar cerca; simplemente es mas alcanzable. Fundirlos
      // en un solo numero destruiria informacion que el analysis necesita.
      strength: Number(strength.toFixed(1)),
      kind: price < currentPrice ? 'support' : 'resistance',
      distancePct: Number((((price - currentPrice) / currentPrice) * 100).toFixed(2)),
      distanceATR: Number(Math.abs((price - currentPrice) / atrActual).toFixed(2)),
      lastTouch: candles[mostRecentIndex].date,
    };
  });

  return levels
    .filter((n) => n.touches >= minTouches) // un toque suelto es un punto, no una zona
    .sort((a, b) => b.strength - a.strength)
    .slice(0, maxLevels);
}

/**
 * Selecciona los levels CONTEXTUALMENTE relevantes: los que el price tiene
 * inmediatamente encima y debajo.
 *
 * Va aparte de keyLevels a proposito. Aquella responde "que zonas importan
 * en este grafico"; esta responde "con que se va a encontrar el price si se
 * mueve". Son preguntas distintas y el analysis necesita las dos: la zona mas
 * fuerte puede estar a 10 ATR y no ser alcanzable en semanas.
 */
export function levelContext(levels, currentPrice, perSide = 3, coverage = null) {
  const resistances = levels
    .filter((n) => n.price > currentPrice)
    .sort((a, b) => a.price - b.price)
    .slice(0, perSide);

  const supports = levels
    .filter((n) => n.price < currentPrice)
    .sort((a, b) => b.price - a.price)
    .slice(0, perSide);

  return {
    currentPrice,
    resistances,                                   // de la mas cercana hacia arriba
    supports,                                       // de la mas cercana hacia abajo
    nearestResistance: resistances[0] ?? null,
    nearestSupport: supports[0] ?? null,
    /**
     * No hay pivots above. OJO: esto es SIEMPRE relativo a la window
     * de datos analizada, nunca absoluto. 500 candles de 4h son ~83 dias; el
     * price puede no tener resistances en esa window y tener de sobra en
     * el grafico diario, que cubre 13 meses. Por eso el campo viaja siempre
     * acompanado de la coverage: afirmar "descubrimiento de price" sin
     * decir sobre que period es una verdad a medias.
     */
    inPriceDiscovery: resistances.length === 0,
    coverage,
  };
}

/**
 * Rango reciente: donde esta el price dentro de su move de las
 * ultimas N bars. 0 = en el minimum del period, 1 = en el maximum.
 * Sirve para responder "esta caro o barato respecto a si mismo" sin
 * necesidad de ningun indicador.
 */
export function rangePosition(candles, bars = 60) {
  const window = candles.slice(-bars);
  const maximum = Math.max(...window.map((v) => v.h));
  const minimum = Math.min(...window.map((v) => v.l));
  const close = candles[candles.length - 1].c;
  const width = maximum - minimum;

  return {
    bars: window.length,
    maximum,
    minimum,
    close,
    position: width === 0 ? 0.5 : Number(((close - minimum) / width).toFixed(3)),
    amplitudPct: Number(((width / minimum) * 100).toFixed(2)),
  };
}
