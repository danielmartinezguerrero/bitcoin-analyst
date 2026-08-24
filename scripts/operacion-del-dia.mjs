#!/usr/bin/env node
/**
 * LA PANTALLA DEL DIA. Una lectura del mercado, una operacion sugerida con
 * stop y objetivo, y el porque en cuatro lineas.
 *
 *   npm run hoy
 *   node scripts/operacion-del-dia.mjs --perfil spot --taker
 *   node scripts/operacion-del-dia.mjs --detalle     (descartes y criterios)
 *
 * No ejecuta ordenes ni se conecta a ninguna cuenta.
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analizarTemporalidad, sintetizar } from '../lib/analisis.mjs';
import { seleccionDiaria, CRITERIOS } from '../lib/seleccion.mjs';
import { clasificarRegimen } from '../lib/regimen.mjs';
import { atr } from '../lib/indicadores.mjs';
import { PERFILES, costesOperacion } from '../lib/costes.mjs';
import { recolectar } from './fetch-ohlcv.mjs';
import { RUTA_OHLCV, DIR_DATOS, DIR_HISTORICO, asegurarDirHistorico, nombreHistorico } from '../lib/rutas.mjs';

const args = process.argv.slice(2);
const leer = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const perfil = leer('perfil', 'futuros');
const entradaComoMaker = !args.includes('--taker');
const detalle = args.includes('--detalle');
const capital = Number(leer('capital', 0));
const apalancamiento = Number(leer('apalancamiento', 1));
const costes = { perfil, opciones: { entradaComoMaker } };

if (!PERFILES[perfil]) {
  console.error('Perfil desconocido. Disponibles: ' + Object.keys(PERFILES).join(', '));
  process.exit(1);
}
if (args.includes('--refrescar') || !existsSync(RUTA_OHLCV)) await recolectar({ silencioso: true });

const datos = JSON.parse(readFileSync(RUTA_OHLCV, 'utf8'));
const analisis = ['1d', '4h', '1h', '15m'].filter((tf) => datos.series[tf])
  .map((tf) => analizarTemporalidad(datos.series[tf]));
const sintesis = sintetizar(analisis);

const velas1d = datos.series['1d'].velas.slice(0, -1);
const regimen = clasificarRegimen(velas1d, atr(velas1d, 14));
const sel = seleccionDiaria(analisis, sintesis, costes);

/**
 * FILTRO DE REGIMEN. En el backtest, exigir que la operacion vaya en la
 * direccion del regimen fue lo unico que llevo la expectativa a positivo
 * (+0,124R frente a -0,031R sin filtro). La mejora NO es estadisticamente
 * significativa todavia (p = 0,23), asi que se aplica pero se avisa.
 */
const alineados = sel.aptos.filter((c) => c.direccion === regimen.direccion);
const propuesta = regimen.esTendencia ? (alineados[0] ?? null) : null;

const usd = (x) => Math.round(x).toLocaleString('en-US');
const linea = (c = '-') => console.log(c.repeat(70));
const pctStr = (x) => (x > 0 ? '+' : '') + x.toFixed(2) + '%';

linea('=');
console.log('  BTCUSDT   ' + usd(analisis[0].precio) + ' USDT'
  + '        ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC');
linea('=');

// ------------------------------------------------------- lectura del dia

const lectura = regimen.esTendencia
  ? regimen.direccion.toUpperCase()
  : sintesis.sesgo.toUpperCase();

console.log('\n  LECTURA DEL DIA:  ' + lectura
  + (regimen.esTendencia ? '' : '   (sin tendencia clara)'));
console.log('');
console.log('  POR QUE:');

const razones = [];
razones.push('Regimen: ' + regimen.tipo + '. ' + regimen.descripcion);

const conf = sintesis.confluencias.map((c) => c.senal + ' (' + c.direccion + ')');
if (conf.length) razones.push('Coinciden las 4 temporalidades en: ' + conf.join('; ') + '.');

const votos = analisis.map((a) => a.temporalidad + ' ' + (a.voto > 0 ? '+' : '') + a.voto).join('  ');
razones.push('Voto por temporalidad: ' + votos
  + '   -> sesgo agregado ' + sintesis.sesgo + ' (' + sintesis.acuerdo + '% de acuerdo).');

razones.push('Volatilidad ' + regimen.volatilidadEstado
  + ' (percentil ' + (regimen.volatilidadPercentil !== null ? (regimen.volatilidadPercentil * 100).toFixed(0) : '?')
  + ' de su ultimo ano). ATR diario ' + usd(analisis[0].indicadores.atr14) + ' USDT.');

for (const r of razones) {
  const palabras = r.split(' ');
  let l = '   . ';
  for (const p of palabras) {
    if ((l + p).length > 68) { console.log(l); l = '     ' + p; }
    else l += (l.endsWith('. ') || l.endsWith('     ') ? '' : ' ') + p;
  }
  console.log(l);
}

if (sintesis.enContra.length) {
  console.log('\n  EN CONTRA:');
  // Se corta por palabra, no por caracter: truncar a medias es ilegible.
  for (const e of sintesis.enContra.slice(0, 3)) {
    let l = '';
    for (const p of e.split(' ')) {
      if ((l + ' ' + p).length > 64) break;
      l += (l ? ' ' : '') + p;
    }
    console.log('   ! ' + l + (l.length < e.length ? '...' : ''));
  }
}

// ---------------------------------------------------- operacion sugerida

console.log('');
linea('=');
if (propuesta) {
  const o = propuesta.objetivo;
  console.log('  OPERACION SUGERIDA — ' + (propuesta.direccion === 'alcista' ? 'LARGO' : 'CORTO')
    + ' con referencia ' + propuesta.temporalidad + '   (calidad ' + propuesta.calidad + '/100)');
  linea('=');
  console.log('    ENTRADA        ' + usd(propuesta.precio).padStart(9));
  console.log('    STOP LOSS      ' + usd(propuesta.invalidacion.precio).padStart(9)
    + '   ' + pctStr(propuesta.invalidacion.distanciaPct) + '   (' + propuesta.riesgoATR + ' ATR)');
  console.log('    TAKE PROFIT    ' + usd(o.precio).padStart(9)
    + '   ' + pctStr(o.distanciaPct) + '   (' + o.distanciaATR + ' ATR)');
  console.log('');
  console.log('    R:R neto ' + o.rrNeto + ':1   -> hay que acertar mas del '
    + o.winRateMinimoNetoPct + '% de las veces para no perder');
  console.log('    costes: ' + o.mordidaCostesPct + '% del beneficio   |   '
    + PERFILES[perfil].nombre + ', entrada ' + (entradaComoMaker ? 'limit' : 'market'));
  console.log('');
  console.log('    stop apoyado en: ' + propuesta.invalidacion.base);
  console.log('    objetivo en: ' + o.origen);
  /**
   * DIMENSIONADO. Aritmetica pura sobre el escenario: cuanto se mueve la
   * cuenta si el precio llega al objetivo y cuanto si llega al stop, con los
   * costes de cada rama ya descontados. No sabe nada de la situacion de quien
   * lo lee ni sugiere que cantidad usar.
   */
  if (capital > 0) {
    const nominal = capital * apalancamiento;
    const btc = nominal / propuesta.precio;
    const c = costesOperacion(perfil, { entradaComoMaker });

    const brutoGana = nominal * (Math.abs(o.precio - propuesta.precio) / propuesta.precio);
    const brutoPierde = nominal * (Math.abs(propuesta.invalidacion.precio - propuesta.precio) / propuesta.precio);
    const comisionGana = nominal * (c.totalSiGana + c.deslizamientoEntrada);
    const comisionPierde = nominal * (c.totalSiPierde + c.deslizamientoEntrada);
    const netoGana = brutoGana - comisionGana;
    const netoPierde = brutoPierde + comisionPierde;

    console.log('');
    linea();
    console.log('  CON ' + capital + ' USDT'
      + (apalancamiento > 1 ? ' y apalancamiento x' + apalancamiento : ' SIN APALANCAR (x1)')
      + '   ->   posicion de ' + nominal.toFixed(2) + ' USDT = ' + btc.toFixed(6) + ' BTC');
    linea();
    console.log('    si toca TAKE PROFIT   +' + netoGana.toFixed(2) + ' USDT'
      + '   (bruto +' + brutoGana.toFixed(2) + ', comisiones -' + comisionGana.toFixed(2) + ')');
    console.log('    si toca STOP LOSS     -' + netoPierde.toFixed(2) + ' USDT'
      + '   (bruto -' + brutoPierde.toFixed(2) + ', comisiones -' + comisionPierde.toFixed(2) + ')');
    console.log('');
    console.log('    sobre el capital      +' + ((netoGana/capital)*100).toFixed(2) + '%  /  -'
      + ((netoPierde/capital)*100).toFixed(2) + '%');
    console.log('    ratio real            ' + (netoGana/netoPierde).toFixed(2) + ':1');
    if (nominal < 100) {
      console.log('');
      console.log('    (!) Posicion pequena: comprueba el minimo de orden de Binance y el');
      console.log('        redondeo de cantidad, que a este tamano alteran las cifras.');
    }
  }

  if (propuesta.penalizaciones.length) {
    console.log('');
    for (const p of propuesta.penalizaciones) console.log('    (!) ' + p.motivo);
  }
} else {
  console.log('  HOY NO HAY OPERACION SUGERIDA');
  linea('=');
  if (!regimen.esTendencia) {
    console.log('    El mercado no esta en tendencia (ER ' + regimen.er
      + ', umbral ' + regimen.erUmbralTendencia + ').');
    console.log('    ' + regimen.descripcion);
    console.log('');
    console.log('    En el backtest, operar fuera de tendencia dio expectativa');
    console.log('    negativa. No operar es una decision con datos detras, no');
    console.log('    una falta de senal.');
  } else if (!alineados.length) {
    console.log('    Hay tendencia ' + regimen.direccion + ', pero ningun escenario en esa');
    console.log('    direccion supera los minimos de R:R neto y riesgo.');
    if (sel.aptos.length) {
      console.log('    (Si hay ' + sel.aptos.length + ' escenario(s) apto(s) a contratendencia,');
      console.log('     descartados por ir contra el regimen.)');
    }
  }
}

// ------------------------------------------------------------- detalle

if (detalle) {
  console.log('\n');
  linea();
  console.log('  DESCARTADOS');
  linea();
  for (const c of sel.rechazados.slice(0, 6)) {
    console.log('  ' + (c.direccion + ' ' + c.temporalidad).padEnd(16)
      + (c.objetivo ? 'R:R neto ' + c.objetivo.rrNeto + ':1' : 'sin objetivo viable'));
    for (const d of c.descartes) console.log('      x ' + d);
  }
  console.log('\n  CRITERIOS: R:R neto >= ' + CRITERIOS.rrNetoMinimo
    + '   costes <= ' + CRITERIOS.mordidaMaxima + '%'
    + '   riesgo <= ' + CRITERIOS.riesgoMaximoATR + ' ATR'
    + '   objetivo ' + CRITERIOS.recorridoMinimoATR + '-' + CRITERIOS.recorridoMaximoATR + ' ATR');
}

// --------------------------------------------------- estado de validacion

console.log('');
linea();
try {
  const bt = JSON.parse(readFileSync(join(DIR_DATOS, 'backtest.json'), 'utf8'));
  console.log('  QUE SABEMOS DE ESTE SISTEMA (backtest 2018-2026, 503 operaciones)');
  console.log('    sin filtro de regimen   expectativa -0,031R por operacion');
  console.log('    con filtro alineado     expectativa +0,124R  (p = 0,23, NO significativa)');
  console.log('    los niveles de soporte/resistencia no baten al azar (p = 0,67)');
  console.log('    -> la mejora del filtro es prometedora pero NO esta demostrada.');
} catch { /* sin backtest aun */ }
console.log('  Analisis tecnico educativo. No es asesoramiento financiero ni una');
console.log('  prediccion. La decision y el riesgo son tuyos.');
linea();

// Archivado: la propuesta queda escrita antes de saber como acaba.
asegurarDirHistorico();
const ahora = new Date().toISOString();
writeFileSync(join(DIR_HISTORICO, 'dia-' + nombreHistorico(ahora)), JSON.stringify({
  generadoEn: ahora, precio: analisis[0].precio, regimen, sintesis, propuesta,
  aptos: sel.aptos.length, rechazados: sel.rechazados.length,
}, null, 2));
