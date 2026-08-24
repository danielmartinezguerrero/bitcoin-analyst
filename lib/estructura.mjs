/**
 * MODULO 3 - Estructura de mercado.
 *
 * Los indicadores del modulo 2 son transformaciones matematicas del precio.
 * Este modulo hace algo distinto: identifica DONDE ocurrieron las cosas.
 * Un RSI de 80 pegado a una resistencia tocada cinco veces no significa lo
 * mismo que un RSI de 80 en aire libre. El contexto lo aporta la estructura.
 *
 * Tres capas, cada una construida sobre la anterior:
 *   1. pivotes            -> los giros del precio
 *   2. estructuraMercado  -> la secuencia de esos giros (tendencia)
 *   3. nivelesClave       -> los pivotes agrupados en zonas de precio
 */

/**
 * PIVOTES (swing points). Un maximo local es una vela cuyo maximo supera al
 * de las `izq` velas anteriores y las `der` posteriores.
 *
 * EL SESGO DE ANTICIPACION (look-ahead bias):
 * un pivote en el indice i NO SE PUEDE CONOCER hasta el indice i + der,
 * porque hacen falta las velas de la derecha para confirmarlo. Por eso cada
 * pivote lleva `confirmadoEn`. Si haces un backtest usando pivotes sin
 * respetar ese campo, estas mirando el futuro y tus resultados seran
 * fantasticos e imposibles de reproducir en vivo.
 *
 * ELECCION DE izq/der: es el clasico compromiso ruido/retraso.
 *   valores bajos (2-3)  -> muchos pivotes, mucho ruido, confirmacion rapida
 *   valores altos (8-10) -> solo giros importantes, pero tardas 10 velas en verlos
 * Usamos 5 por defecto: en diario detecta giros de aproximadamente una semana.
 */
export function pivotes(velas, izq = 5, der = 5) {
  const salida = [];

  for (let i = izq; i < velas.length - der; i++) {
    let esAlto = true;
    let esBajo = true;

    for (let j = i - izq; j <= i + der; j++) {
      if (j === i) continue;
      if (velas[j].h >= velas[i].h) esAlto = false;
      if (velas[j].l <= velas[i].l) esBajo = false;
      if (!esAlto && !esBajo) break;
    }

    // Una misma vela podria ser ambas cosas en datos degenerados; la
    // registramos por separado, no la descartamos.
    // Guardamos el volumen del giro: la evidencia dice que importa mas que
    // el numero de toques a la hora de medir la fuerza de una zona.
    const base = { i, precio: 0, fecha: velas[i].fecha, volumen: velas[i].v, confirmadoEn: i + der };
    if (esAlto) salida.push({ ...base, tipo: 'alto', precio: velas[i].h });
    if (esBajo) salida.push({ ...base, tipo: 'bajo', precio: velas[i].l });
  }

  return salida;
}

/**
 * ESTRUCTURA DE MERCADO. Lee la SECUENCIA de pivotes, no su valor absoluto.
 *
 *   HH (higher high)  maximo mas alto que el maximo anterior
 *   HL (higher low)   minimo mas alto que el minimo anterior
 *   LH (lower high)   maximo mas bajo que el maximo anterior
 *   LL (lower low)    minimo mas bajo que el minimo anterior
 *
 * Alcista  = HH + HL encadenados. Bajista = LH + LL. Mezcla = rango o giro.
 *
 * Esta es la definicion de tendencia mas antigua que existe (Dow, 1900) y
 * no depende de ningun parametro ajustable, a diferencia de "el precio esta
 * sobre la EMA200". Por eso vale como contraste independiente.
 */
export function estructuraMercado(pivotesLista, toleranciaIgualdadPct = 0.15) {
  const altos = pivotesLista.filter((p) => p.tipo === 'alto');
  const bajos = pivotesLista.filter((p) => p.tipo === 'bajo');

  /**
   * TERCER CASO: LA IGUALDAD.
   * Comparar con `>` a secas obliga a que todo maximo sea HH o LH. Pero dos
   * maximos practicamente identicos (un doble techo, o el techo de un rango
   * lateral) no son ninguna de las dos cosas: son EQH (equal high).
   * Sin este caso, cualquier rango lateral se clasifica como tendencia
   * bajista, porque `precio > anterior` es falso cuando son iguales.
   *
   * La tolerancia es porcentual porque dos maximos que difieren en 5 USD son
   * "el mismo nivel" con BTC a 77.000, pero no con BTC a 300.
   */
  const etiquetar = (lista, etiquetaSube, etiquetaBaja, etiquetaIgual) =>
    lista.map((p, k) => {
      if (k === 0) return { ...p, etiqueta: null };
      const previo = lista[k - 1].precio;
      const difPct = ((p.precio - previo) / previo) * 100;
      const etiqueta =
        Math.abs(difPct) <= toleranciaIgualdadPct ? etiquetaIgual
        : difPct > 0 ? etiquetaSube
        : etiquetaBaja;
      return { ...p, etiqueta };
    });

  const altosEtiquetados = etiquetar(altos, 'HH', 'LH', 'EQH');
  const bajosEtiquetados = etiquetar(bajos, 'HL', 'LL', 'EQL');

  // Miramos los dos ultimos de cada tipo para juzgar la tendencia vigente.
  const ultimasEtiquetas = [...altosEtiquetados, ...bajosEtiquetados]
    .filter((p) => p.etiqueta !== null)
    .sort((a, b) => a.i - b.i)
    .slice(-4);

  const alcistas = ultimasEtiquetas.filter((p) => p.etiqueta === 'HH' || p.etiqueta === 'HL').length;
  const bajistas = ultimasEtiquetas.filter((p) => p.etiqueta === 'LH' || p.etiqueta === 'LL').length;
  const iguales = ultimasEtiquetas.filter((p) => p.etiqueta === 'EQH' || p.etiqueta === 'EQL').length;

  let tendencia;
  if (ultimasEtiquetas.length < 2) tendencia = 'indeterminada';
  else if (iguales >= ultimasEtiquetas.length / 2) tendencia = 'rango lateral';
  else if (alcistas >= 3 && bajistas <= 1) tendencia = 'alcista';
  else if (bajistas >= 3 && alcistas <= 1) tendencia = 'bajista';
  else tendencia = 'lateral o en transicion';

  const ultimoAlto = altosEtiquetados[altosEtiquetados.length - 1] ?? null;
  const ultimoBajo = bajosEtiquetados[bajosEtiquetados.length - 1] ?? null;

  return {
    tendencia,
    secuenciaReciente: ultimasEtiquetas.map((p) => p.etiqueta),
    ultimoAlto,
    ultimoBajo,
    totalAltos: altos.length,
    totalBajos: bajos.length,
    // Nivel cuya rotura invalidaria la lectura actual. Es informativo:
    // describe la condicion tecnica, no sugiere ninguna accion.
    nivelDeInvalidacion:
      tendencia === 'alcista' ? ultimoBajo?.precio ?? null
      : tendencia === 'bajista' ? ultimoAlto?.precio ?? null
      : null,
  };
}

/**
 * NIVELES CLAVE por agrupacion (clustering) de pivotes.
 *
 * Un pivote suelto es una anecdota. Cinco pivotes a menos de un 1% unos de
 * otros son una ZONA donde el mercado reacciono repetidamente. Eso es lo
 * que la gente llama soporte o resistencia.
 *
 * DECISION IMPORTANTE - la tolerancia se mide en ATR, no en porcentaje fijo:
 * con BTC a 20.000 USD un 1% eran 200 USD; a 100.000 son 1.000. Peor aun, la
 * volatilidad cambia sola: en calma el precio no recorre en una semana lo que
 * en panico recorre en una hora. Usar `toleranciaATR * ATR` hace que el
 * algoritmo se adapte al regimen de volatilidad en lugar de necesitar que le
 * ajustemos el numero a mano cada pocos meses.
 */
export function nivelesClave(velas, pivotesLista, atrActual, opciones = {}) {
  const {
    toleranciaATR = 0.5,
    maxNiveles = 10,
    semivida = 50,      // en barras: a las 50 barras un nivel pesa la mitad
    minToques = 2,
    ventanaVolumen = 20,
  } = opciones;

  if (!pivotesLista.length || !atrActual) return [];

  const tolerancia = atrActual * toleranciaATR;

  // Volumen relativo de cada barra: el volumen crudo no es comparable entre
  // epocas distintas, pero "3 veces lo normal de entonces" si lo es.
  const volRelPorBarra = velas.map((v, i) => {
    const desde = Math.max(0, i - ventanaVolumen + 1);
    const ventana = velas.slice(desde, i + 1);
    const media = ventana.reduce((s, x) => s + x.v, 0) / ventana.length;
    return media > 0 ? v.v / media : 1;
  });

  const ordenados = [...pivotesLista].sort((a, b) => a.precio - b.precio);

  // Agrupacion lineal: recorremos precios ascendentes y cerramos el grupo
  // en cuanto aparece un salto mayor que la tolerancia.
  const grupos = [];
  let actual = [ordenados[0]];

  for (let k = 1; k < ordenados.length; k++) {
    const medioActual = actual.reduce((s, p) => s + p.precio, 0) / actual.length;
    if (Math.abs(ordenados[k].precio - medioActual) <= tolerancia) {
      actual.push(ordenados[k]);
    } else {
      grupos.push(actual);
      actual = [ordenados[k]];
    }
  }
  grupos.push(actual);

  const ultimoIndice = velas.length - 1;
  const precioActual = velas[ultimoIndice].c;

  const niveles = grupos.map((grupo) => {
    const volumenes = grupo.map((p) => volRelPorBarra[p.i]);
    const volumenTotal = volumenes.reduce((s, x) => s + x, 0);

    /**
     * PRECIO PONDERADO POR VOLUMEN, no media aritmetica.
     * Si un cluster tiene un toque en 74.900 con volumen flojo y otro en
     * 75.100 con volumen enorme, el nivel real esta en 75.100: ahi es donde
     * se comprometio el capital. La media aritmetica lo situaria en 75.000,
     * un precio donde no ocurrio nada.
     */
    const precio = volumenTotal > 0
      ? grupo.reduce((s, p, k) => s + p.precio * volumenes[k], 0) / volumenTotal
      : grupo.reduce((s, p) => s + p.precio, 0) / grupo.length;

    const indiceMasReciente = Math.max(...grupo.map((p) => p.i));
    const antiguedadBarras = ultimoIndice - indiceMasReciente;
    const toques = grupo.length;

    /**
     * PUNTUACION DE FUERZA. Tres componentes, todos normalizados a [0,1]:
     *
     *  toquesNorm  satura a los 5 toques. El sexto rebote no aporta tanta
     *              informacion nueva como el segundo.
     *  volNorm     escala LOGARITMICA. Sin el log, una sola vela de capitulacion
     *              con volumen 20x dominaria la clasificacion entera.
     *  decaimiento SEMIVIDA exponencial: 0,5 elevado a (antiguedad/semivida).
     *              Un decaimiento lineal trata igual pasar de la barra 10 a la
     *              20 que de la 200 a la 210, y la relevancia no funciona asi.
     *
     * Los pesos 30/70 vienen de la practica documentada del sector: el volumen
     * informa mas que el recuento de toques. Estan aqui como constantes
     * visibles y ajustables, no escondidos en una formula.
     */
    const toquesNorm = Math.min(1, toques / 5);
    const volNorm = Math.min(1, Math.log1p(volumenTotal) / Math.log1p(10));
    const decaimiento = Math.pow(0.5, antiguedadBarras / semivida);
    const fuerza = (0.3 * toquesNorm + 0.7 * volNorm) * decaimiento * 100;

    return {
      precio,
      toques,
      volumenRelativoTotal: Number(volumenTotal.toFixed(2)),
      antiguedadBarras,
      decaimiento: Number(decaimiento.toFixed(3)),
      // FUERZA y DISTANCIA son ejes independientes a proposito. Un nivel no
      // es mas fuerte por estar cerca; simplemente es mas alcanzable. Fundirlos
      // en un solo numero destruiria informacion que el analisis necesita.
      fuerza: Number(fuerza.toFixed(1)),
      tipo: precio < precioActual ? 'soporte' : 'resistencia',
      distanciaPct: Number((((precio - precioActual) / precioActual) * 100).toFixed(2)),
      distanciaATR: Number(Math.abs((precio - precioActual) / atrActual).toFixed(2)),
      ultimoToque: velas[indiceMasReciente].fecha,
    };
  });

  return niveles
    .filter((n) => n.toques >= minToques) // un toque suelto es un punto, no una zona
    .sort((a, b) => b.fuerza - a.fuerza)
    .slice(0, maxNiveles);
}

/**
 * Selecciona los niveles CONTEXTUALMENTE relevantes: los que el precio tiene
 * inmediatamente encima y debajo.
 *
 * Va aparte de nivelesClave a proposito. Aquella responde "que zonas importan
 * en este grafico"; esta responde "con que se va a encontrar el precio si se
 * mueve". Son preguntas distintas y el analisis necesita las dos: la zona mas
 * fuerte puede estar a 10 ATR y no ser alcanzable en semanas.
 */
export function contextoNiveles(niveles, precioActual, porLado = 3, cobertura = null) {
  const resistencias = niveles
    .filter((n) => n.precio > precioActual)
    .sort((a, b) => a.precio - b.precio)
    .slice(0, porLado);

  const soportes = niveles
    .filter((n) => n.precio < precioActual)
    .sort((a, b) => b.precio - a.precio)
    .slice(0, porLado);

  return {
    precioActual,
    resistencias,                                   // de la mas cercana hacia arriba
    soportes,                                       // de la mas cercana hacia abajo
    resistenciaInmediata: resistencias[0] ?? null,
    soporteInmediato: soportes[0] ?? null,
    /**
     * No hay pivotes por encima. OJO: esto es SIEMPRE relativo a la ventana
     * de datos analizada, nunca absoluto. 500 velas de 4h son ~83 dias; el
     * precio puede no tener resistencias en esa ventana y tener de sobra en
     * el grafico diario, que cubre 13 meses. Por eso el campo viaja siempre
     * acompanado de la cobertura: afirmar "descubrimiento de precio" sin
     * decir sobre que periodo es una verdad a medias.
     */
    enDescubrimiento: resistencias.length === 0,
    cobertura,
  };
}

/**
 * Rango reciente: donde esta el precio dentro de su recorrido de las
 * ultimas N barras. 0 = en el minimo del periodo, 1 = en el maximo.
 * Sirve para responder "esta caro o barato respecto a si mismo" sin
 * necesidad de ningun indicador.
 */
export function posicionEnRango(velas, barras = 60) {
  const ventana = velas.slice(-barras);
  const maximo = Math.max(...ventana.map((v) => v.h));
  const minimo = Math.min(...ventana.map((v) => v.l));
  const cierre = velas[velas.length - 1].c;
  const amplitud = maximo - minimo;

  return {
    barras: ventana.length,
    maximo,
    minimo,
    cierre,
    posicion: amplitud === 0 ? 0.5 : Number(((cierre - minimo) / amplitud).toFixed(3)),
    amplitudPct: Number(((amplitud / minimo) * 100).toFixed(2)),
  };
}
