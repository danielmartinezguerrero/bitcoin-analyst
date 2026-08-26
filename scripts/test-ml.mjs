/**
 * Verificacion de lib/etiquetado.mjs y lib/modelo.mjs sobre series construidas
 * a mano, cuyo resultado correcto conocemos de antemano.
 *
 * EL TEST QUE MAS IMPORTA es el de causalidad: comprobar que cambiar una vela
 * FUTURA no altera ninguna caracteristica del presente. Una fuga de futuro no
 * rompe nada, no lanza excepciones y no aparece en ninguna otra prueba: solo
 * mejora los resultados y los vuelve mentira. Si algun dia alguien mete un
 * indicador centrado o una media que mira hacia adelante, este test lo caza.
 */
import {
  etiquetarTripleBarrera, construirCaracteristicas, construirDataset,
  puntuacionReglas, CARACTERISTICAS,
} from '../lib/etiquetado.mjs';
import {
  ajustarEscala, aplicarEscala, entrenarLogistica, predecir,
  auc, logLoss, tasaBase, particionTemporal, tomar,
  testPermutacion, testPermutacionBloques, muestraEfectiva, errorEstandarAUC,
} from '../lib/modelo.mjs';

let pasados = 0, fallados = 0;
function comprobar(nombre, condicion, detalle = '') {
  if (condicion) { pasados++; console.log('  ok   ' + nombre); }
  else { fallados++; console.log('  FALLO ' + nombre + (detalle ? '  -> ' + detalle : '')); }
}
const cerca = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

/** Generador reproducible: un test con Math.random dentro no es un test. */
function azarFijo(semilla = 12345) {
  let s = semilla;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

/** Vela sintetica. Por defecto sin mecha, para que el control sea exacto. */
const vela = (t, o, h, l, c, v = 100) => ({ t, fecha: new Date(t).toISOString(), o, h, l, c, v });
const H = 4 * 3600 * 1000;

// ------------------------------------------------------- triple barrera

console.log('\nEtiquetado de triple barrera');
{
  // Serie que sube en linea recta: desde cualquier vela se toca arriba antes.
  const sube = Array.from({ length: 60 }, (_, i) => vela(i * H, 100 + i, 100.5 + i, 99.5 + i, 100 + i));
  const atrFijo = new Array(60).fill(2);
  const r = etiquetarTripleBarrera(sube, atrFijo, { barreraATR: 1, maxVelas: 10 });
  const puestas = r.etiquetas.filter((e) => e !== null);
  comprobar('subida recta -> todas las etiquetas son 1',
    puestas.length > 0 && puestas.every((e) => e === 1), 'n=' + puestas.length);

  const baja = Array.from({ length: 60 }, (_, i) => vela(i * H, 200 - i, 200.5 - i, 199.5 - i, 200 - i));
  const rb = etiquetarTripleBarrera(baja, atrFijo, { barreraATR: 1, maxVelas: 10 });
  const puestasB = rb.etiquetas.filter((e) => e !== null);
  comprobar('bajada recta -> todas las etiquetas son 0',
    puestasB.length > 0 && puestasB.every((e) => e === 0), 'n=' + puestasB.length);

  /**
   * EL EMPATE. La vela siguiente abarca las dos barreras a la vez. Con datos
   * de vela no se sabe cual se toco primero, y suponer la favorable es como se
   * inflan los backtests. Tiene que contar como 0.
   */
  const empate = [vela(0, 100, 100, 100, 100), vela(H, 100, 110, 90, 100), vela(2 * H, 100, 100, 100, 100)];
  const re = etiquetarTripleBarrera(empate, [2, 2, 2], { barreraATR: 1, maxVelas: 1 });
  comprobar('si una vela toca las dos barreras, gana el stop (0)', re.etiquetas[0] === 0,
    String(re.etiquetas[0]));

  // Serie plana: no se toca nada dentro del horizonte -> se descarta y se cuenta.
  const plana = Array.from({ length: 30 }, (_, i) => vela(i * H, 100, 100, 100, 100));
  const rp = etiquetarTripleBarrera(plana, new Array(30).fill(5), { barreraATR: 1, maxVelas: 5 });
  comprobar('serie plana -> ninguna etiqueta puesta',
    rp.etiquetas.every((e) => e === null));
  comprobar('y los expirados se cuentan, no se ocultan', rp.expirados > 0, String(rp.expirados));

  // El final de la serie no tiene horizonte completo: no se puede etiquetar.
  const corta = Array.from({ length: 20 }, (_, i) => vela(i * H, 100 + i, 101 + i, 99 + i, 100 + i));
  const rc = etiquetarTripleBarrera(corta, new Array(20).fill(1), { barreraATR: 1, maxVelas: 5 });
  comprobar('las ultimas velas quedan sin etiqueta por horizonte incompleto',
    rc.etiquetas.slice(-5).every((e) => e === null));

  comprobar('sin ATR valido no se etiqueta',
    etiquetarTripleBarrera(sube, new Array(60).fill(null), {}).etiquetas.every((e) => e === null));
}

// ----------------------------------------------------------- causalidad

console.log('\nCausalidad: el futuro no puede tocar el presente');
{
  const azar = azarFijo(7);
  const base = [];
  let precio = 30000;
  for (let i = 0; i < 500; i++) {
    precio *= 1 + (azar() - 0.5) * 0.02;
    base.push(vela(i * H, precio, precio * 1.005, precio * 0.995, precio, 100 + azar() * 50));
  }

  const original = construirCaracteristicas(base);

  /**
   * Se destroza la ULTIMA vela. Si alguna caracteristica anterior cambia, es
   * que mira hacia adelante.
   */
  const tocado = base.map((v, i) => (i === base.length - 1
    ? vela(v.t, 1, 999999, 0.5, 1, 99999) : v));
  const despues = construirCaracteristicas(tocado);

  let iguales = true, comparadas = 0;
  for (let i = 0; i < base.length - 1; i++) {
    if (original[i] === null && despues[i] === null) continue;
    if (original[i] === null || despues[i] === null) { iguales = false; break; }
    comparadas++;
    for (let j = 0; j < original[i].length; j++) {
      if (!cerca(original[i][j], despues[i][j], 1e-12)) { iguales = false; break; }
    }
    if (!iguales) break;
  }
  comprobar('alterar la ultima vela no cambia ninguna caracteristica anterior',
    iguales && comparadas > 100, 'comparadas=' + comparadas);

  // Y el reverso: truncar la serie no cambia lo ya calculado.
  const truncada = construirCaracteristicas(base.slice(0, 400));
  let coinciden = true;
  for (let i = 0; i < 400; i++) {
    if (original[i] === null && truncada[i] === null) continue;
    if (original[i] === null || truncada[i] === null) { coinciden = false; break; }
    for (let j = 0; j < original[i].length; j++) {
      if (!cerca(original[i][j], truncada[i][j], 1e-9)) { coinciden = false; break; }
    }
    if (!coinciden) break;
  }
  comprobar('cortar la serie no cambia las caracteristicas ya calculadas', coinciden);

  comprobar('hay una columna por caracteristica declarada',
    original.find((f) => f !== null).length === CARACTERISTICAS.length);

  comprobar('todas las caracteristicas son finitas',
    original.filter((f) => f !== null).every((f) => f.every(Number.isFinite)));
}

// ------------------------------------------------------- reglas a mano

console.log('\nPuntuacion de las reglas');
{
  //            distEMA200, distEMA50, cruceEMA, rsi, macdHist, ...
  const alcista = [2, 1, 1.5, 0.6, 3, 0.5, 0.5, 0.8, 1];
  const bajista = [-2, -1, -1.5, 0.4, -3, 0.5, 0.5, 0.2, 1];
  const mixta = [2, 1, -1.5, 0.5, -3, 0.5, 0.5, 0.5, 1];
  comprobar('todo a favor -> +3', puntuacionReglas(alcista) === 3);
  comprobar('todo en contra -> -3', puntuacionReglas(bajista) === -3);
  comprobar('senales mezcladas -> -1', puntuacionReglas(mixta) === -1, String(puntuacionReglas(mixta)));
}

// -------------------------------------------------------------- metricas

console.log('\nAUC y log-loss');
{
  comprobar('separacion perfecta -> AUC = 1',
    cerca(auc([0, 0, 1, 1], [0.1, 0.2, 0.8, 0.9]), 1));
  comprobar('orden invertido -> AUC = 0',
    cerca(auc([1, 1, 0, 0], [0.1, 0.2, 0.8, 0.9]), 0));
  comprobar('todas las predicciones iguales -> AUC = 0,5',
    cerca(auc([0, 1, 0, 1], [0.5, 0.5, 0.5, 0.5]), 0.5));
  comprobar('un solo error de orden en 2x2 -> AUC = 0,75',
    cerca(auc([0, 1, 0, 1], [0.1, 0.2, 0.3, 0.4]), 0.75),
    String(auc([0, 1, 0, 1], [0.1, 0.2, 0.3, 0.4])));
  comprobar('una sola clase -> AUC no definido', auc([1, 1, 1], [0.2, 0.5, 0.9]) === null);

  comprobar('prediccion perfecta -> log-loss casi cero',
    logLoss([1, 0], [1 - 1e-12, 1e-12]) < 1e-6);
  comprobar('predecir 0,5 siempre -> log-loss = ln 2',
    cerca(logLoss([1, 0, 1, 0], [0.5, 0.5, 0.5, 0.5]), Math.log(2), 1e-12));
  comprobar('log-loss no explota con prediccion 0 en clase 1',
    Number.isFinite(logLoss([1], [0])));

  comprobar('tasa base cuenta bien los unos', cerca(tasaBase([1, 1, 0, 0, 1]), 0.6));
}

// -------------------------------------------------------- estandarizacion

console.log('\nEstandarizacion');
{
  const X = [[1, 10], [2, 20], [3, 30], [4, 40]];
  const esc = ajustarEscala(X);
  const Z = aplicarEscala(X, esc);
  const media = Z.reduce((s, f) => s + f[0], 0) / Z.length;
  const desv = Math.sqrt(Z.reduce((s, f) => s + f[0] ** 2, 0) / Z.length);
  comprobar('el entrenamiento queda con media 0', cerca(media, 0, 1e-12));
  comprobar('y desviacion 1', cerca(desv, 1, 1e-12));

  /**
   * La prueba se transforma con la escala DEL ENTRENAMIENTO, asi que no tiene
   * por que quedar centrada. Si quedara centrada seria justo la senal de que
   * se ha usado su propia media, es decir, de que hay fuga.
   */
  const prueba = [[10, 100], [20, 200]];
  const Zp = aplicarEscala(prueba, esc);
  const mediaP = Zp.reduce((s, f) => s + f[0], 0) / Zp.length;
  comprobar('la prueba NO queda recentrada (senal de que no hay fuga)',
    Math.abs(mediaP) > 1, String(mediaP));

  const constante = ajustarEscala([[5, 1], [5, 2], [5, 3]]);
  comprobar('una columna constante no produce NaN',
    aplicarEscala([[5, 1]], constante).every((f) => f.every(Number.isFinite)));
}

// ---------------------------------------------------- regresion logistica

console.log('\nRegresion logistica');
{
  // Patron trivialmente separable: la clase es el signo de la primera columna.
  const azar = azarFijo(99);
  const X = [], y = [];
  for (let i = 0; i < 400; i++) {
    const x1 = azar() * 2 - 1;
    X.push([x1, azar() * 2 - 1]);
    y.push(x1 > 0 ? 1 : 0);
  }
  const esc = ajustarEscala(X);
  const m = entrenarLogistica(aplicarEscala(X, esc), y, { pasos: 2000, tasaAprendizaje: 0.5 });
  const p = predecir(m, aplicarEscala(X, esc));
  comprobar('aprende un patron separable (AUC > 0,99)', auc(y, p) > 0.99, String(auc(y, p)));
  comprobar('le da mucho mas peso a la columna informativa',
    Math.abs(m.pesos[0]) > 5 * Math.abs(m.pesos[1]),
    m.pesos.map((w) => w.toFixed(3)).join(' / '));
  comprobar('las probabilidades caen dentro de (0,1)',
    p.every((q) => q > 0 && q < 1));

  // Sin senal, no debe inventarsela.
  const Xr = [], yr = [];
  for (let i = 0; i < 400; i++) { Xr.push([azar(), azar()]); yr.push(azar() > 0.5 ? 1 : 0); }
  const escR = ajustarEscala(Xr);
  const mr = entrenarLogistica(aplicarEscala(Xr, escR), yr, { pasos: 2000, tasaAprendizaje: 0.5 });
  const pr = predecir(mr, aplicarEscala(Xr, escR));
  comprobar('con etiquetas al azar el AUC dentro de muestra se queda cerca de 0,5',
    Math.abs(auc(yr, pr) - 0.5) < 0.12, String(auc(yr, pr)));
}

// --------------------------------------------------- particion y purgado

console.log('\nParticion temporal con purgado');
{
  const datos = {
    X: Array.from({ length: 100 }, (_, i) => [i]),
    y: Array.from({ length: 100 }, (_, i) => i % 2),
    t: Array.from({ length: 100 }, (_, i) => i * H),
    reglas: new Array(100).fill(0),
  };
  const corte = 60 * H;
  const p = particionTemporal(datos, corte, 10);

  comprobar('la prueba empieza exactamente en el corte',
    datos.t[p.prueba[0]] === corte);
  comprobar('la prueba se queda intacta', p.prueba.length === 40);
  comprobar('del entrenamiento se purgan tantas filas como solapamiento',
    p.entreno.length === 50 && p.purgadas === 10,
    'entreno=' + p.entreno.length);
  comprobar('ninguna fila de entrenamiento tiene su desenlace dentro de la prueba',
    datos.t[p.entreno[p.entreno.length - 1]] + 10 * H <= corte);
  comprobar('tomar() respeta el orden de los indices',
    tomar(datos, [3, 1]).X[0][0] === 3 && tomar(datos, [3, 1]).X[1][0] === 1);
}

// ------------------------------------------------------- permutaciones

console.log('\nTests de permutacion');
{
  const azar = azarFijo(2024);
  const y = Array.from({ length: 400 }, (_, i) => (i % 2));
  const p = y.map(() => azar());   // predicciones sin relacion con y

  const t = testPermutacion(y, p, 300, azarFijo(1));
  comprobar('sin relacion, el p-valor no es significativo', t.pValor > 0.05, String(t.pValor));
  comprobar('el p-valor nunca vale 0 (correccion de continuidad)', t.pValor > 0);
  comprobar('el p-valor nunca pasa de 1', t.pValor <= 1);

  const tb = testPermutacionBloques(y, p, 20, 300, azarFijo(1));
  comprobar('la version por bloques trocea bien', tb.bloques === 20, String(tb.bloques));
  comprobar('y observa el mismo AUC que la version normal',
    cerca(tb.observado, t.observado));

  /**
   * CON BLOQUES DE TAMANO 1 las dos permutaciones son el mismo procedimiento:
   * una permutacion uniforme de todas las etiquetas. No se puede exigir que
   * salga el MISMO sorteo con la misma semilla, porque cada funcion consume
   * el generador en distinto orden; lo que tiene que coincidir es el p-valor
   * salvo error de muestreo. Comprobarlo asegura que la version por bloques
   * generaliza a la simple en lugar de ser otra cosa.
   */
  const tb1 = testPermutacionBloques(y, p, 1, 600, azarFijo(5));
  const t1 = testPermutacion(y, p, 600, azarFijo(11));
  comprobar('con bloques de 1 hay un bloque por fila', tb1.bloques === y.length,
    String(tb1.bloques));
  comprobar('y el p-valor coincide con el de la permutacion simple',
    Math.abs(tb1.pValor - t1.pValor) < 0.08,
    tb1.pValor.toFixed(4) + ' vs ' + t1.pValor.toFixed(4));

  /**
   * LO QUE JUSTIFICA TODO EL MODULO: con etiquetas que vienen en rachas, la
   * permutacion simple es demasiado permisiva y declara significativo lo que
   * no lo es. Se construye una serie con rachas largas de etiqueta y una
   * prediccion igual de suave, sin relacion causal entre ambas.
   */
  const rachas = [], suave = [];
  const az2 = azarFijo(31);
  for (let b = 0; b < 40; b++) {
    const etiqueta = az2() > 0.5 ? 1 : 0;
    const nivel = az2();
    for (let k = 0; k < 20; k++) { rachas.push(etiqueta); suave.push(nivel); }
  }
  const simple = testPermutacion(rachas, suave, 400, azarFijo(3));
  const bloques = testPermutacionBloques(rachas, suave, 20, 400, azarFijo(3));
  comprobar('con datos en rachas, la permutacion por bloques es mas conservadora',
    bloques.pValor > simple.pValor,
    'simple=' + simple.pValor.toFixed(4) + ' bloques=' + bloques.pValor.toFixed(4));
}

// ------------------------------------------------------ muestra efectiva

console.log('\nMuestra efectiva');
{
  comprobar('sin solapamiento la muestra efectiva es la nominal',
    muestraEfectiva(1000, 1) === 1000);
  comprobar('con solapamiento 28 se divide por 28',
    muestraEfectiva(2800, 28) === 100);
  comprobar('nunca baja de 1', muestraEfectiva(5, 100) === 1);
  comprobar('el error estandar crece al reducirse la muestra efectiva',
    errorEstandarAUC(7958, 28) > errorEstandarAUC(7958, 1));
  comprobar('un AUC de 0,515 con n efectivo 284 esta a menos de media sigma de 0,5',
    (0.515 - 0.5) / errorEstandarAUC(7958, 28) < 0.5,
    String((0.515 - 0.5) / errorEstandarAUC(7958, 28)));
}

// ------------------------------------------------ dataset de punta a punta

console.log('\nDataset completo');
{
  const azar = azarFijo(4242);
  const velas = [];
  let precio = 20000;
  for (let i = 0; i < 900; i++) {
    precio *= 1 + (azar() - 0.5) * 0.03;
    velas.push(vela(i * H, precio, precio * 1.01, precio * 0.99, precio, 50 + azar() * 100));
  }
  const d = construirDataset(velas);

  comprobar('produce filas', d.X.length > 200, 'filas=' + d.X.length);
  comprobar('X e y tienen la misma longitud', d.X.length === d.y.length);
  comprobar('t y fechas acompanan a cada fila',
    d.t.length === d.X.length && d.fechas.length === d.X.length);
  comprobar('las etiquetas son solo 0 o 1', d.y.every((v) => v === 0 || v === 1));
  comprobar('todos los valores son finitos', d.X.every((f) => f.every(Number.isFinite)));
  comprobar('las marcas de tiempo van en orden creciente',
    d.t.every((v, i) => i === 0 || v > d.t[i - 1]));
  comprobar('declara el solapamiento que necesita el purgado', d.solapamiento === 28);
  comprobar('la puntuacion de reglas cae en el rango -3..3',
    d.reglas.every((r) => r >= -3 && r <= 3));

  /**
   * Ninguna fila puede empezar antes de la vela 250: hace falta esa ventana
   * para el percentil de volatilidad. Si aparece una anterior es que alguna
   * caracteristica se esta calculando con menos datos de los que declara.
   */
  comprobar('ninguna fila usa una ventana mas corta de la declarada',
    d.t[0] >= velas[250].t, new Date(d.t[0]).toISOString());
}

console.log('\n' + '-'.repeat(52));
console.log('Pasados: ' + pasados + '   Fallados: ' + fallados);
process.exit(fallados === 0 ? 0 : 1);
