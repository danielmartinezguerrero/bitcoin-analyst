#!/usr/bin/env node
/**
 * Ejecuta el backtest de la estrategia completa sobre el historico largo.
 *
 *   node scripts/backtest.mjs
 *   node scripts/backtest.mjs --perfil spot
 *   node scripts/backtest.mjs --taker
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { backtest } from '../lib/backtest.mjs';
import { PERFILES } from '../lib/costes.mjs';
import { RUTA_LARGO_PLAZO, DIR_DATOS } from '../lib/rutas.mjs';

const args = process.argv.slice(2);
const leer = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const perfil = leer('perfil', 'futuros');
const entradaComoMaker = !args.includes('--taker');

if (!existsSync(RUTA_LARGO_PLAZO)) {
  console.error('Falta data/ohlcv-largo.json. Ejecuta antes:\n  npm run datos:historico');
  process.exit(1);
}

const datos = JSON.parse(readFileSync(RUTA_LARGO_PLAZO, 'utf8'));
const v1d = datos.series['1d'].velas;
const v4h = datos.series['4h'].velas;

const linea = (c = '-') => console.log(c.repeat(74));
linea('=');
console.log('  BACKTEST DE LA ESTRATEGIA COMPLETA');
linea('=');
console.log('  ' + v1d.length + ' velas diarias, ' + v4h.length + ' velas de 4h');
console.log('  ' + PERFILES[perfil].nombre + ', entrada como '
  + (entradaComoMaker ? 'maker' : 'taker'));
console.log('  Calculando...\n');

const t0 = Date.now();
const r = backtest(v1d, v4h, { costes: { perfil, opciones: { entradaComoMaker } } });
const seg = ((Date.now() - t0) / 1000).toFixed(1);

if (r.sinDatos) {
  console.log('  El sistema no genero ni una sola operacion en todo el historico.');
  console.log('  Dias evaluados sin senal: ' + r.diasSinSenal);
  console.log('\n  Eso significa que los criterios son tan estrictos que la');
  console.log('  estrategia no es operable, o que hay un fallo en la cadena.');
  process.exit(0);
}

const pct = (x) => (x * 100).toFixed(1) + '%';

console.log('  PERIODO');
console.log('    ' + r.periodo.desde + ' a ' + r.periodo.hasta + '   (' + r.periodo.dias + ' dias)');
console.log('');
console.log('  ACTIVIDAD');
console.log('    operaciones            ' + r.total);
console.log('    dias evaluados sin senal ' + r.diasSinSenal);
console.log('    frecuencia             ' + r.frecuencia + ' operaciones al mes');
console.log('    duracion media         ' + r.diasMediosEnPosicion + ' dias en posicion');
console.log('');
console.log('  RESULTADOS');
console.log('    ganadoras              ' + r.ganadoras + '   (' + pct(r.tasaAcierto) + ')');
console.log('    perdedoras             ' + r.perdedoras);
console.log('    cerradas en objetivo   ' + r.cierres.objetivo);
console.log('    cerradas en stop       ' + r.cierres.stop);
console.log('    cerradas por tiempo    ' + r.cierres.tiempo);
console.log('');
console.log('    ganancia media         +' + r.mediaGanancia + 'R');
console.log('    perdida media          -' + r.mediaPerdida + 'R');
console.log('    acierto necesario      ' + pct(r.winRateNecesario) + '  (para empatar)');
console.log('    acierto real           ' + pct(r.tasaAcierto));
console.log('');
linea('=');
console.log('    EXPECTATIVA            ' + (r.expectativaR >= 0 ? '+' : '') + r.expectativaR + 'R por operacion');
console.log('    resultado acumulado    ' + (r.totalR >= 0 ? '+' : '') + r.totalR + 'R');
console.log('    drawdown maximo        -' + r.drawdownMaxR + 'R');
console.log('    peor racha perdedora   ' + r.peorRachaPerdedora + ' operaciones seguidas');
linea('=');

// Curva de resultados acumulados.
console.log('\n  CURVA ACUMULADA (en R)');
const alto = 14, ancho = Math.min(66, r.curva.length);
const paso = r.curva.length / ancho;
const muestra = Array.from({ length: ancho }, (_, i) => r.curva[Math.floor(i * paso)]);
const maxC = Math.max(...muestra, 0), minC = Math.min(...muestra, 0);
for (let fila = alto; fila >= 0; fila--) {
  const nivel = minC + ((maxC - minC) * fila) / alto;
  let s = '  ' + nivel.toFixed(1).padStart(7) + ' |';
  for (const v of muestra) s += v >= nivel ? '#' : (nivel <= 0 && v <= nivel ? '.' : ' ');
  console.log(s);
}
console.log('          +' + '-'.repeat(ancho));
console.log('           ' + r.periodo.desde + ' '.repeat(Math.max(1, ancho - 21)) + r.periodo.hasta);

console.log('\n  VEREDICTO');
if (r.expectativaR > 0) {
  console.log('    Expectativa POSITIVA: +' + r.expectativaR + 'R por operacion.');
  console.log('    Con ' + r.total + ' operaciones la muestra ' + (r.total >= 100 ? 'es razonable' : 'es PEQUENA')
    + '; conviene comprobar');
  console.log('    la estabilidad por subperiodos antes de fiarse.');
} else {
  console.log('    Expectativa NEGATIVA: ' + r.expectativaR + 'R por operacion.');
  console.log('    La estrategia pierde dinero de forma sistematica con estos');
  console.log('    costes. Ni la gestion del riesgo ni el tamano de posicion');
  console.log('    arreglan una expectativa negativa: solo cambian la velocidad');
  console.log('    a la que se pierde.');
}

writeFileSync(join(DIR_DATOS, 'backtest.json'), JSON.stringify({
  ...r, operaciones: r.operaciones.slice(-200),
}, null, 2));

console.log('\n  Calculado en ' + seg + ' s. Detalle en data/backtest.json');
linea();
