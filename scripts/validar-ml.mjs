#!/usr/bin/env node
/**
 * CUARTA PRUEBA DE FALSACION: un modelo APRENDIDO, contra las reglas escritas
 * a mano y contra el azar.
 *
 *   npm run validar:ml
 *   node scripts/validar-ml.mjs --permutaciones 5000
 *
 * LA PREGUNTA. El proyecto ya midio que sus niveles no baten a lineas
 * aleatorias (p = 0,67) y que la expectativa fuera de muestra es
 * indistinguible de cero. Queda una objecion razonable: puede que la senal
 * este ahi y las reglas escritas a mano sean demasiado toscas para verla.
 *
 * Esto la responde. Mismas caracteristicas, mismo periodo, misma particion
 * 2017-2022 / 2023-2026 que el backtest, y una regresion logistica encima.
 * Si el modelo tampoco encuentra nada, la explicacion "es que el filtro es
 * malo" se queda sin sitio.
 *
 * NO ES UN MODELO PARA OPERAR. No se conecta a nada y su salida no entra en
 * la seleccion diaria. Es un instrumento de medida.
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { construirDataset } from '../lib/etiquetado.mjs';
import {
  ajustarEscala, aplicarEscala, entrenarLogistica, predecir,
  auc, logLoss, tasaBase, particionTemporal, tomar, testPermutacion,
  testPermutacionBloques, muestraEfectiva, errorEstandarAUC,
} from '../lib/modelo.mjs';
import { RUTA_LARGO_PLAZO, DIR_DATOS } from '../lib/rutas.mjs';

const args = process.argv.slice(2);
const leer = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const permutaciones = Number(leer('permutaciones', 2000));

if (!existsSync(RUTA_LARGO_PLAZO)) {
  console.error('Falta data/ohlcv-largo.json. Ejecuta antes:\n  npm run datos:historico');
  process.exit(1);
}

const linea = (c = '-') => console.log(c.repeat(74));
const p3 = (x) => (x === null ? 'n/d' : x.toFixed(3));
const p4 = (x) => (x === null ? 'n/d' : x.toFixed(4));

linea('=');
console.log('  MODELO APRENDIDO CONTRA REGLAS ESCRITAS A MANO');
linea('=');

// ------------------------------------------------------------- 1. dataset

const datos = JSON.parse(readFileSync(RUTA_LARGO_PLAZO, 'utf8'));
const velas = datos.series['4h'].velas;

/**
 * SE USA 4h, NO 1d. Es la temporalidad mas rapida con historico completo, y
 * la que da mas ejemplos: en diario habria unas 3.000 filas y aqui hay seis
 * veces mas. El sesgo de esa eleccion es conocido y va en contra de la
 * hipotesis nula, es decir, le pone las cosas FACILES al modelo.
 */
const d = construirDataset(velas);

console.log('  ' + velas.length.toLocaleString('es-ES') + ' velas de 4h  ->  '
  + d.X.length.toLocaleString('es-ES') + ' filas etiquetadas');
console.log('  ' + d.caracteristicas.length + ' caracteristicas, barrera 1 ATR, horizonte 28 velas (4,7 dias)');
console.log('  ' + d.expirados.toLocaleString('es-ES') + ' velas descartadas por no tocar ninguna barrera a tiempo');
console.log('  tasa base: ' + (tasaBase(d.y) * 100).toFixed(1) + '% de las filas tocan +1 ATR primero');

/**
 * LA TASA BASE NO ES 50%, y eso importa. Bitcoin subio mucho en nueve anos,
 * asi que la barrera de arriba se toca mas a menudo. Un modelo que aprenda
 * solo esa asimetria acertara mas de la mitad de las veces sin saber nada
 * del mercado. Por eso la metrica principal es el AUC y no el acierto.
 */

// --------------------------------------------- 2. particion 2017-22 / 23-26

const CORTE = Date.UTC(2023, 0, 1);
const part = particionTemporal(d, CORTE, d.solapamiento);
const entreno = tomar(d, part.entreno);
const prueba = tomar(d, part.prueba);

console.log('');
linea();
console.log('  PARTICION TEMPORAL (la misma del backtest)');
linea();
console.log('  entrenamiento  ' + entreno.y.length.toLocaleString('es-ES') + ' filas   '
  + new Date(entreno.t[0]).toISOString().slice(0, 10) + ' -> '
  + new Date(entreno.t[entreno.t.length - 1]).toISOString().slice(0, 10));
console.log('  prueba         ' + prueba.y.length.toLocaleString('es-ES') + ' filas   '
  + new Date(prueba.t[0]).toISOString().slice(0, 10) + ' -> '
  + new Date(prueba.t[prueba.t.length - 1]).toISOString().slice(0, 10));
console.log('  purgadas       ' + part.purgadas + ' filas cuyo desenlace caia dentro de la prueba');

// -------------------------------------------------------- 3. entrenamiento

const escala = ajustarEscala(entreno.X);        // SOLO con entrenamiento
const Xent = aplicarEscala(entreno.X, escala);
const Xpru = aplicarEscala(prueba.X, escala);

const modelo = entrenarLogistica(Xent, entreno.y, { pasos: 3000, tasaAprendizaje: 0.3, l2: 1e-3 });
const pEnt = predecir(modelo, Xent);
const pPru = predecir(modelo, Xpru);

const baseEnt = tasaBase(entreno.y);
const basePru = tasaBase(prueba.y);
const constEnt = new Array(entreno.y.length).fill(baseEnt);
const constPru = new Array(prueba.y.length).fill(baseEnt);   // la del entreno, no la del futuro

console.log('');
linea();
console.log('  RESULTADO');
linea();
console.log('                                    AUC      log-loss   tasa base');
console.log('  modelo, DENTRO de muestra       ' + p3(auc(entreno.y, pEnt))
  + '     ' + p4(logLoss(entreno.y, pEnt)) + '     ' + p3(baseEnt));
console.log('  modelo, FUERA de muestra        ' + p3(auc(prueba.y, pPru))
  + '     ' + p4(logLoss(prueba.y, pPru)) + '     ' + p3(basePru));
console.log('  prediccion constante (base)     ' + '0.500' + '     '
  + p4(logLoss(prueba.y, constPru)) + '     ' + p3(basePru));
console.log('  reglas a mano, fuera de muestra ' + p3(auc(prueba.y, prueba.reglas))
  + '     ' + '     n/d' + '     ' + p3(basePru));

/**
 * LAS REGLAS COMO PREDICTOR. Su "probabilidad" es la suma de votos (-3 a +3),
 * que no es una probabilidad y por eso no tiene log-loss. Para el AUC da
 * igual: solo cuenta el orden, y ordenar es justamente lo que hace un voto.
 */

// -------------------------------------------------- 4. test de permutacion

console.log('');
linea();
console.log('  ES DISTINGUIBLE DEL AZAR?');
linea();
console.log('  Barajando las etiquetas de prueba ' + permutaciones.toLocaleString('es-ES') + ' veces...');

const perm = testPermutacion(prueba.y, pPru, permutaciones);
const permB = testPermutacionBloques(prueba.y, pPru, d.solapamiento, permutaciones);

console.log('  AUC observado fuera de muestra:  ' + p3(perm.observado));
console.log('');
console.log('  barajando fila a fila     p = ' + p4(perm.pValor)
  + '   (' + perm.igualesOMejores + ' de ' + perm.repeticiones + ')   <- INVALIDO, ver abajo');
console.log('  barajando por bloques     p = ' + p4(permB.pValor)
  + '   (' + permB.igualesOMejores + ' de ' + permB.repeticiones + ')   <- el bueno');
console.log('');

/**
 * LA DIFERENCIA ENTRE ESOS DOS NUMEROS ES EL RESULTADO MAS IMPORTANTE DE
 * TODO ESTE SCRIPT.
 *
 * Barajar fila a fila da un p-valor pequeno y una conclusion falsa. Las
 * etiquetas se solapan 28 velas, asi que vienen en rachas; deshacer las
 * rachas al barajar crea una hipotesis nula demasiado tranquila contra la que
 * casi cualquier prediccion suavizada parece significativa.
 *
 * Es exactamente el error que convierte un AUC de 0,515 en un titular. Se
 * deja el test malo a la vista, al lado del bueno, porque ver los dos juntos
 * ensena mas que ver solo el correcto.
 */
const nef = muestraEfectiva(prueba.y.length, d.solapamiento);
const ee = errorEstandarAUC(prueba.y.length, d.solapamiento);
console.log('  filas de prueba: ' + prueba.y.length.toLocaleString('es-ES')
  + '   pero solapan ' + d.solapamiento + ' velas');
console.log('  muestra efectiva: ~' + nef.toLocaleString('es-ES') + ' observaciones independientes');
console.log('  error estandar del AUC bajo azar con ese n: ' + ee.toFixed(3));
console.log('  el AUC observado esta a ' + ((perm.observado - 0.5) / ee).toFixed(2)
  + ' desviaciones tipicas de 0,5');

// ----------------------------------------------- 5. walk-forward por anos

console.log('');
linea();
console.log('  WALK-FORWARD: reentrenar cada ano, predecir el siguiente');
linea();

const anos = [2021, 2022, 2023, 2024, 2025, 2026];
const acumulado = { y: [], p: [] };

for (const ano of anos) {
  const iniAno = Date.UTC(ano, 0, 1);
  const finAno = Date.UTC(ano + 1, 0, 1);
  const idxEnt = [], idxPru = [];
  for (let i = 0; i < d.t.length; i++) {
    if (d.t[i] < iniAno) idxEnt.push(i);
    else if (d.t[i] < finAno) idxPru.push(i);
  }
  // Mismo purgado que arriba: fuera las filas cuyo desenlace cruza la linea.
  const ent = tomar(d, idxEnt.slice(0, Math.max(0, idxEnt.length - d.solapamiento)));
  const pru = tomar(d, idxPru);
  if (ent.y.length < 500 || pru.y.length < 100) continue;

  const esc = ajustarEscala(ent.X);
  const mod = entrenarLogistica(aplicarEscala(ent.X, esc), ent.y,
    { pasos: 3000, tasaAprendizaje: 0.3, l2: 1e-3 });
  const pr = predecir(mod, aplicarEscala(pru.X, esc));

  acumulado.y.push(...pru.y);
  acumulado.p.push(...pr);

  console.log('  ' + ano + '   entreno ' + String(ent.y.length).padStart(6)
    + '   prueba ' + String(pru.y.length).padStart(5)
    + '   AUC ' + p3(auc(pru.y, pr))
    + '   reglas ' + p3(auc(pru.y, pru.reglas)));
}

console.log('  ' + '-'.repeat(70));
console.log('  TODOS los anos juntos, siempre fuera de muestra:   AUC '
  + p3(auc(acumulado.y, acumulado.p)));

// ------------------------------------------------------- 6. coeficientes

console.log('');
linea();
console.log('  QUE APRENDIO (coeficientes sobre caracteristicas estandarizadas)');
linea();
const coefs = d.caracteristicas
  .map((nombre, j) => ({ nombre, peso: modelo.pesos[j] }))
  .sort((a, b) => Math.abs(b.peso) - Math.abs(a.peso));
for (const c of coefs) {
  const barra = '#'.repeat(Math.min(40, Math.round(Math.abs(c.peso) * 200)));
  console.log('  ' + c.nombre.padEnd(14) + (c.peso >= 0 ? '+' : '-')
    + Math.abs(c.peso).toFixed(4) + '  ' + barra);
}

/**
 * COEFICIENTES DIMINUTOS SON EL RESULTADO, no un fallo del entrenamiento.
 * Con caracteristicas estandarizadas, un peso de 0,02 significa que mover esa
 * variable una desviacion tipica entera cambia la probabilidad en menos de
 * medio punto porcentual. Eso no es una senal debil: es ausencia de senal.
 */

// ------------------------------------------------------------ 7. veredicto

const aucFuera = auc(prueba.y, pPru);
const aucReglas = auc(prueba.y, prueba.reglas);
const aucWalk = auc(acumulado.y, acumulado.p);

console.log('');
linea('=');
console.log('  VEREDICTO');
linea('=');
const bateAlAzar = permB.pValor < 0.05;
const bateAReglas = aucFuera > aucReglas;
console.log('  El modelo ' + (bateAlAzar ? 'SI' : 'NO') + ' se distingue del azar fuera de muestra'
  + ' (p = ' + p4(permB.pValor) + ', permutacion por bloques).');
console.log('  El modelo ' + (bateAReglas ? 'SI' : 'NO') + ' supera a las reglas escritas a mano'
  + ' (' + p3(aucFuera) + ' contra ' + p3(aucReglas) + ').');
console.log('  Walk-forward sobre seis anos, siempre fuera de muestra: AUC ' + p3(aucWalk) + '.');
console.log('');
console.log('  Un AUC de 0,5 es el azar y 1,0 es la adivinacion perfecta. Aunque el');
console.log('  contraste saliera significativo, ' + p3(aucFuera) + ' no es un sistema: es una');
console.log('  moneda con un sesgo tan fino que los costes de operacion se lo comen');
console.log('  entero. Significacion estadistica y significacion economica no son');
console.log('  lo mismo, y con muestras grandes la primera llega mucho antes.');
linea('=');

const salida = {
  generadoEn: new Date().toISOString(),
  filas: d.X.length,
  caracteristicas: d.caracteristicas,
  expirados: d.expirados,
  tasaBase: tasaBase(d.y),
  corte: new Date(CORTE).toISOString(),
  purgadas: part.purgadas,
  aucDentro: auc(entreno.y, pEnt),
  aucFuera,
  aucReglas,
  aucWalkForward: aucWalk,
  logLossFuera: logLoss(prueba.y, pPru),
  logLossBase: logLoss(prueba.y, constPru),
  permutacion: perm,
  coeficientes: Object.fromEntries(d.caracteristicas.map((n, j) => [n, modelo.pesos[j]])),
  sesgo: modelo.sesgo,
};
writeFileSync(join(DIR_DATOS, 'validacion-ml.json'), JSON.stringify(salida, null, 2));
console.log('  Resultados en data/validacion-ml.json');
