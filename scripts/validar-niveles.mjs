/**
 * Ejecuta el test de Osler sobre el historico largo y presenta el resultado.
 *
 *   node scripts/validar-niveles.mjs
 *   node scripts/validar-niveles.mjs --repeticiones 10000
 */
import { readFileSync, existsSync } from 'node:fs';
import { testOsler } from '../lib/validacion.mjs';
import { RUTA_LARGO_PLAZO } from '../lib/rutas.mjs';

const args = process.argv.slice(2);
const leerArg = (nombre, pordefecto) => {
  const i = args.indexOf('--' + nombre);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : pordefecto;
};

if (!existsSync(RUTA_LARGO_PLAZO)) {
  console.error('Falta data/ohlcv-largo.json. Ejecuta antes:\n  node scripts/fetch-historico.mjs');
  process.exit(1);
}

const datos = JSON.parse(readFileSync(RUTA_LARGO_PLAZO, 'utf8'));
const velas = datos.series['1d'].velas;
const repeticiones = leerArg('repeticiones', 2000);

console.log('='.repeat(72));
console.log('  TEST DE OSLER — nuestros niveles baten al azar?');
console.log('='.repeat(72));
console.log('\n  Serie: BTCUSDT 1d, ' + velas.length + ' velas ('
  + velas[0].fecha.slice(0, 10) + ' a ' + velas[velas.length - 1].fecha.slice(0, 10) + ')');
console.log('  Ejecutando ' + repeticiones.toLocaleString('en-US') + ' simulaciones...\n');

const t0 = Date.now();
const r = testOsler(velas, { repeticiones });
const segundos = ((Date.now() - t0) / 1000).toFixed(1);

const pct = (x) => (x * 100).toFixed(2) + '%';

console.log('  DISENO DEL TEST');
console.log('    ventana de construccion   ' + r.parametros.ventanaConstruccion + ' velas');
console.log('    ventana de prueba         ' + r.parametros.ventanaPrueba + ' velas');
console.log('    seguimiento tras contacto ' + r.parametros.velasSeguimiento + ' velas');
console.log('    banda de contacto         ' + r.parametros.toleranciaToque + ' ATR');
console.log('    umbral de rebote          ' + r.parametros.umbralRebote + ' ATR');
console.log('    umbral de ruptura         ' + r.parametros.umbralRuptura + ' ATR (por cierre)');
console.log('    ventanas walk-forward     ' + r.ventanas);
console.log('    periodo evaluado          ' + r.periodo.desde.slice(0, 10)
  + ' a ' + r.periodo.hasta.slice(0, 10));

console.log('\n  NUESTROS NIVELES');
console.log('    contactos totales   ' + r.real.contactos);
console.log('    rebotes             ' + r.real.rebotes);
console.log('    rupturas            ' + r.real.rupturas);
console.log('    indefinidos         ' + r.real.indefinidos + '  (descartados)');
console.log('    TASA DE REBOTE      ' + pct(r.real.tasaRebote));

console.log('\n  NIVELES ALEATORIOS  (' + r.azar.repeticiones.toLocaleString('en-US') + ' conjuntos)');
console.log('    media               ' + pct(r.azar.media));
console.log('    desviacion tipica   ' + pct(r.azar.desviacion));
console.log('    percentil 5         ' + pct(r.azar.p05));
console.log('    mediana             ' + pct(r.azar.p50));
console.log('    percentil 95        ' + pct(r.azar.p95));
console.log('    percentil 99        ' + pct(r.azar.p99));
console.log('    maximo observado    ' + pct(r.azar.maximo));

// Histograma de la distribucion del azar con la marca de lo real.
console.log('\n  DISTRIBUCION');
const min = Math.min(r.azar.p05 - r.azar.desviacion * 2, r.real.tasaRebote) - 0.01;
const max = Math.max(r.azar.maximo, r.real.tasaRebote) + 0.01;
const cubos = 40;
const ancho = (max - min) / cubos;
const hist = new Array(cubos).fill(0);
// Reconstruimos una aproximacion visual a partir de media y desviacion
// (la distribucion completa no se guarda para no inflar la memoria).
for (let i = 0; i < cubos; i++) {
  const x = min + ancho * (i + 0.5);
  const z = (x - r.azar.media) / (r.azar.desviacion || 1);
  hist[i] = Math.exp(-0.5 * z * z);
}
const maxH = Math.max(...hist);
const posReal = Math.floor((r.real.tasaRebote - min) / ancho);
for (let i = 0; i < cubos; i++) {
  const altura = Math.round((hist[i] / maxH) * 30);
  const marca = i === posReal ? '  <== NUESTROS NIVELES' : '';
  console.log('    ' + pct(min + ancho * i).padStart(7) + ' ' + '#'.repeat(altura) + marca);
}

console.log('\n' + '='.repeat(72));
console.log('  RESULTADO');
console.log('='.repeat(72));
console.log('    tasa real           ' + pct(r.real.tasaRebote));
console.log('    tasa media del azar ' + pct(r.azar.media));
console.log('    diferencia          ' + pct(r.real.tasaRebote - r.azar.media));
console.log('    z-score             ' + r.zScore.toFixed(2) + ' desviaciones tipicas');
console.log('    p-valor             ' + r.pValor.toFixed(4));
console.log('');

if (r.significativo) {
  console.log('    Los niveles baten al azar con p < 0,05.');
  console.log('    De cada 100 conjuntos aleatorios, menos de 5 igualan este');
  console.log('    resultado. Hay senal, no solo casualidad.');
} else {
  console.log('    NO se bate al azar de forma significativa (p >= 0,05).');
  console.log('    Un conjunto de lineas puestas al alzar consigue este resultado');
  console.log('    con demasiada frecuencia como para atribuirlo al metodo.');
}

console.log('\n    Calculado en ' + segundos + ' s.');
console.log('\n  QUE NO DEMUESTRA ESTE TEST');
console.log('    Que se pueda ganar dinero. Mide si el precio reacciona en');
console.log('    nuestros niveles mas que en lineas arbitrarias, nada mas.');
console.log('    Comisiones, deslizamiento, tamano de posicion y disciplina');
console.log('    quedan fuera por completo.');
console.log('='.repeat(72));
