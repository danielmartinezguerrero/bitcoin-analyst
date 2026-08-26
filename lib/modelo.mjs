/**
 * MODULO 13 - Regresion logistica y metricas de clasificacion, a mano.
 *
 * POR QUE UN MODELO TAN SIMPLE: con 9 caracteristicas y una senal que el
 * resto del proyecto ya sospecha inexistente, un modelo con mas capacidad no
 * encontraria mas informacion, encontraria mas ruido. La regresion logistica
 * tiene un coeficiente por caracteristica y se pueden leer: si sale que la
 * unica variable con peso es el RSI, eso es una frase comprobable. Un
 * gradient boosting con 300 arboles daria un numero algo mejor dentro de
 * muestra y ninguna explicacion.
 *
 * POR QUE SIN DEPENDENCIAS: el resto del repo tambien. Un descenso de
 * gradiente son veinte lineas, y escribirlo obliga a entender la
 * regularizacion en vez de heredarla de un valor por defecto.
 */

/**
 * Media y desviacion de CADA COLUMNA, calculadas donde toca.
 *
 * FUGA DE INFORMACION CLASICA: estandarizar con la media de todo el dataset
 * mete en el conjunto de entrenamiento informacion del de prueba, aunque solo
 * sea la media. El resultado sale mejor de lo que es y nadie lo nota, porque
 * el codigo parece inocente. Estas estadisticas se calculan SOLO con
 * entrenamiento y luego se aplican tal cual a prueba.
 */
export function ajustarEscala(X) {
  const n = X.length, k = X[0].length;
  const media = new Array(k).fill(0);
  const desv = new Array(k).fill(0);

  for (const fila of X) for (let j = 0; j < k; j++) media[j] += fila[j] / n;
  for (const fila of X) for (let j = 0; j < k; j++) desv[j] += (fila[j] - media[j]) ** 2 / n;
  for (let j = 0; j < k; j++) {
    desv[j] = Math.sqrt(desv[j]);
    // Una columna constante no aporta nada; dividir por cero la volveria NaN.
    if (desv[j] < 1e-12) desv[j] = 1;
  }
  return { media, desv };
}

export function aplicarEscala(X, escala) {
  return X.map((fila) => fila.map((v, j) => (v - escala.media[j]) / escala.desv[j]));
}

const sigmoide = (z) => 1 / (1 + Math.exp(-z));

/**
 * Entrenamiento por descenso de gradiente por lotes completos.
 *
 * REGULARIZACION L2 SIEMPRE ACTIVA, y el sesgo NO se penaliza: penalizarlo
 * empuja la prediccion hacia 0,5 en lugar de hacia la tasa base, que es lo
 * que se quiere cuando las clases no estan equilibradas.
 */
export function entrenarLogistica(X, y, opciones = {}) {
  const { pasos = 2000, tasaAprendizaje = 0.1, l2 = 1e-3 } = opciones;
  const n = X.length, k = X[0].length;
  const pesos = new Array(k).fill(0);
  let sesgo = 0;

  for (let paso = 0; paso < pasos; paso++) {
    const gradPesos = new Array(k).fill(0);
    let gradSesgo = 0;

    for (let i = 0; i < n; i++) {
      let z = sesgo;
      for (let j = 0; j < k; j++) z += pesos[j] * X[i][j];
      const error = sigmoide(z) - y[i];
      for (let j = 0; j < k; j++) gradPesos[j] += (error * X[i][j]) / n;
      gradSesgo += error / n;
    }

    for (let j = 0; j < k; j++) pesos[j] -= tasaAprendizaje * (gradPesos[j] + l2 * pesos[j]);
    sesgo -= tasaAprendizaje * gradSesgo;
  }

  return { pesos, sesgo };
}

export function predecir(modelo, X) {
  return X.map((fila) => {
    let z = modelo.sesgo;
    for (let j = 0; j < fila.length; j++) z += modelo.pesos[j] * fila[j];
    return sigmoide(z);
  });
}

/**
 * AUC por el estadistico de Mann-Whitney, con rangos medios para los empates.
 *
 * SE USA AUC Y NO ACIERTO. Con clases desbalanceadas el acierto premia al
 * modelo que siempre dice lo mismo: si el 55% de las etiquetas son 1,
 * responder "1" a todo acierta un 55% y no ha aprendido nada. El AUC pregunta
 * otra cosa: tomada una muestra de cada clase, cuantas veces le da mas
 * probabilidad a la correcta. El azar es 0,5 por construccion.
 */
export function auc(y, p) {
  const n = y.length;
  const positivos = y.filter((v) => v === 1).length;
  const negativos = n - positivos;
  if (positivos === 0 || negativos === 0) return null;

  const orden = p.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const rangos = new Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && orden[j + 1].v === orden[i].v) j++;
    // Rango medio del bloque de empatados, en base 1.
    const rangoMedio = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) rangos[orden[k].i] = rangoMedio;
    i = j + 1;
  }

  let sumaPositivos = 0;
  for (let k = 0; k < n; k++) if (y[k] === 1) sumaPositivos += rangos[k];
  return (sumaPositivos - (positivos * (positivos + 1)) / 2) / (positivos * negativos);
}

/** Log-loss. Se recorta para que una prediccion de 0 o 1 no de infinito. */
export function logLoss(y, p) {
  const eps = 1e-15;
  let suma = 0;
  for (let i = 0; i < y.length; i++) {
    const q = Math.min(1 - eps, Math.max(eps, p[i]));
    suma += y[i] === 1 ? -Math.log(q) : -Math.log(1 - q);
  }
  return suma / y.length;
}

/** Proporcion de unos: la prediccion constante contra la que hay que ganar. */
export function tasaBase(y) {
  return y.reduce((s, v) => s + v, 0) / y.length;
}

/**
 * PARTICION TEMPORAL CON PURGADO.
 *
 * La etiqueta de la vela i mira hasta 28 velas hacia adelante. Las ultimas 28
 * filas de entrenamiento tienen por tanto su desenlace DENTRO del periodo de
 * prueba: entrenar con ellas es entrenar con datos del futuro, aunque la
 * fecha de la fila caiga del lado correcto de la linea.
 *
 * Es una fuga pequena, y por eso es peligrosa: no rompe nada, solo mejora un
 * poco el resultado. Se eliminan esas filas del entrenamiento; la prueba se
 * queda intacta.
 */
export function particionTemporal(datos, corteMs, solapamiento) {
  const idxEntreno = [], idxPrueba = [];
  for (let i = 0; i < datos.t.length; i++) {
    (datos.t[i] < corteMs ? idxEntreno : idxPrueba).push(i);
  }
  const purgadas = Math.min(solapamiento, idxEntreno.length);
  return {
    entreno: idxEntreno.slice(0, idxEntreno.length - purgadas),
    prueba: idxPrueba,
    purgadas,
  };
}

export function tomar(datos, indices) {
  return {
    X: indices.map((i) => datos.X[i]),
    y: indices.map((i) => datos.y[i]),
    t: indices.map((i) => datos.t[i]),
    reglas: indices.map((i) => datos.reglas[i]),
  };
}

/**
 * TEST DE PERMUTACION. El mismo razonamiento que el test de Osler sobre los
 * niveles: en lugar de fiarse de que 0,52 "parece poco", se baraja la etiqueta
 * muchas veces y se mira que AUC sale por puro azar. El p-valor es la
 * fraccion de barajadas que igualan o superan al modelo real.
 *
 * Se permutan las ETIQUETAS y se dejan quietas las predicciones: asi la
 * hipotesis nula es exactamente "las predicciones no guardan relacion con lo
 * que paso", que es lo que se quiere descartar.
 */
export function testPermutacion(y, p, repeticiones = 2000, aleatorio = Math.random) {
  const observado = auc(y, p);
  const barajado = y.slice();
  let igualesOMejores = 0;

  for (let r = 0; r < repeticiones; r++) {
    for (let i = barajado.length - 1; i > 0; i--) {
      const j = Math.floor(aleatorio() * (i + 1));
      [barajado[i], barajado[j]] = [barajado[j], barajado[i]];
    }
    if (auc(barajado, p) >= observado) igualesOMejores++;
  }

  return {
    observado,
    repeticiones,
    igualesOMejores,
    // Correccion de continuidad: con 0 exitos el p-valor no es 0, es "<1/n".
    pValor: (igualesOMejores + 1) / (repeticiones + 1),
  };
}

/**
 * TEST DE PERMUTACION POR BLOQUES. El anterior esta MAL para estos datos, y
 * merece la pena explicar por que en lugar de borrarlo.
 *
 * La etiqueta de la vela i mira 28 velas hacia adelante, igual que la de la
 * vela i+1. Dos filas consecutivas comparten casi todo su desenlace, asi que
 * las etiquetas vienen en rachas largas: no son 7.958 observaciones
 * independientes, son unas 280 tandas repetidas 28 veces cada una.
 *
 * Barajar fila a fila destruye esas rachas y produce una hipotesis nula
 * demasiado ordenada: cualquier prediccion que tambien venga en rachas —y la
 * de un modelo sobre indicadores suavizados viene en rachas— parece
 * significativa frente a ella. Es la forma silenciosa de sacar p = 0,008 de
 * un AUC de 0,515.
 *
 * Barajando BLOQUES contiguos del tamano del solapamiento, la autocorrelacion
 * sobrevive dentro de cada bloque y la nula pasa a ser comparable. Es el
 * mismo cuidado que el purgado de la particion, aplicado al contraste.
 */
export function testPermutacionBloques(y, p, tamBloque, repeticiones = 2000, aleatorio = Math.random) {
  const observado = auc(y, p);

  const bloques = [];
  for (let i = 0; i < y.length; i += tamBloque) bloques.push(y.slice(i, i + tamBloque));

  let igualesOMejores = 0;
  for (let r = 0; r < repeticiones; r++) {
    const orden = bloques.slice();
    for (let i = orden.length - 1; i > 0; i--) {
      const j = Math.floor(aleatorio() * (i + 1));
      [orden[i], orden[j]] = [orden[j], orden[i]];
    }
    const barajado = orden.flat();
    if (auc(barajado, p) >= observado) igualesOMejores++;
  }

  return {
    observado,
    tamBloque,
    bloques: bloques.length,
    repeticiones,
    igualesOMejores,
    pValor: (igualesOMejores + 1) / (repeticiones + 1),
  };
}

/**
 * TAMANO DE MUESTRA EFECTIVO. Con etiquetas que se solapan h velas, cada
 * observacion aporta aproximadamente 1/h de informacion nueva. Es una
 * aproximacion tosca y deliberadamente conservadora: sirve para recordar que
 * el n que hay que meter en cualquier error estandar no es el numero de filas.
 */
export function muestraEfectiva(n, solapamiento) {
  return Math.max(1, Math.round(n / solapamiento));
}

/**
 * Error estandar del AUC bajo la hipotesis nula (aproximacion de Hanley-McNeil
 * con clases equilibradas). Con el n efectivo, no con el nominal.
 */
export function errorEstandarAUC(n, solapamiento = 1) {
  const nef = muestraEfectiva(n, solapamiento);
  return 0.5 / Math.sqrt(nef / 4);
}
