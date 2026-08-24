#!/usr/bin/env node
/**
 * MODULO 7 - Seguimiento de escenarios en tiempo real.
 *
 *   node scripts/seguir.mjs --abrir <alcista|bajista>   registra un escenario
 *   node scripts/seguir.mjs                             comprueba como va
 *   node scripts/seguir.mjs --cerrar                    lo cierra a mercado
 *
 * QUE HACE: registra un escenario con su entrada, su invalidacion y sus
 * objetivos, y despues comprueba contra las velas de 1 minuto si el precio
 * alcanzo alguno de esos niveles. El registro se escribe ANTES de conocer el
 * resultado, que es la unica forma de que el seguimiento signifique algo.
 *
 * QUE NO HACE: operar. No hay conexion con ninguna cuenta ni orden de ningun
 * tipo. Es un cuaderno de observacion.
 *
 * ADVERTENCIA ESTADISTICA: seguir UNA operacion no valida nada. Con n = 1 el
 * resultado es indistinguible del azar gane o pierda, y lo que ocurra dira
 * mas de la suerte que del metodo. Sirve para ver el mecanismo funcionando,
 * no para concluir si el sistema sirve.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DIR_DATOS, RUTA_DOSSIER, asegurarDirDatos } from '../lib/rutas.mjs';

const RUTA_SEG = join(DIR_DATOS, 'seguimiento.json');
const args = process.argv.slice(2);

const usd = (x) => Math.round(x).toLocaleString('en-US');
const linea = (c = '-') => console.log(c.repeat(74));

/** Velas de 1 minuto desde un instante dado. Detecta toques intermedios que
 *  una simple consulta del precio actual se perderia. */
async function velasDesde(inicioMs) {
  const todas = [];
  let desde = inicioMs;
  while (true) {
    const url = 'https://api.binance.com/api/v3/klines'
      + `?symbol=BTCUSDT&interval=1m&startTime=${desde}&limit=1000`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error('Binance ' + res.status);
    const b = await res.json();
    if (!b.length) break;
    todas.push(...b.map((k) => ({ t: k[0], h: +k[2], l: +k[3], c: +k[4] })));
    if (b.length < 1000) break;
    desde = b[b.length - 1][6] + 1;
  }
  return todas;
}

async function precioActual() {
  const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT',
    { signal: AbortSignal.timeout(15000) });
  return Number((await res.json()).price);
}

// ------------------------------------------------------------------ abrir

if (args.includes('--abrir')) {
  const direccion = args[args.indexOf('--abrir') + 1];
  if (!['alcista', 'bajista'].includes(direccion)) {
    console.error('Uso: --abrir <alcista|bajista>');
    process.exit(1);
  }
  if (!existsSync(RUTA_DOSSIER)) {
    console.error('Falta data/dossier.json. Ejecuta antes:\n  npm run btc:json');
    process.exit(1);
  }

  const dossier = JSON.parse(readFileSync(RUTA_DOSSIER, 'utf8'));
  const esc = dossier.escenarios.escenarios.find((e) => e.direccion === direccion);
  if (!esc) { console.error('No hay escenario ' + direccion); process.exit(1); }

  const entrada = await precioActual();
  const riesgo = Math.abs(entrada - esc.invalidacion.precio);

  const op = {
    id: new Date().toISOString(),
    abiertoEnMs: Date.now(),
    temporalidad: dossier.escenarios.temporalidad,
    direccion,
    alineadoConSesgo: esc.alineadoConSesgo,
    sesgoEnApertura: dossier.sintesis.sesgo,
    puntuacionEnApertura: dossier.sintesis.puntuacion,
    // Precio real en el momento de registrar, no el del dossier: entre generar
    // el analisis y registrarlo el mercado se ha movido, y anotar el precio
    // viejo seria falsear el punto de partida.
    entrada,
    invalidacion: esc.invalidacion.precio,
    baseInvalidacion: esc.invalidacion.base,
    riesgoUnitario: riesgo,
    atrEnApertura: dossier.escenarios.atr,
    objetivos: esc.objetivos.map((o, i) => ({
      nombre: 'TP' + (i + 1), precio: o.precio, rr: o.rr,
      winRateMinimoPct: o.winRateMinimoPct, alcanzado: false, alcanzadoEn: null,
    })),
    advertenciasEnApertura: esc.advertencias,
    estado: 'abierto',
    resultadoR: null,
    mfeR: 0,  // maxima excursion favorable, en unidades de riesgo
    maeR: 0,  // maxima excursion adversa
    comprobaciones: [],
  };

  asegurarDirDatos();
  writeFileSync(RUTA_SEG, JSON.stringify(op, null, 2));

  linea('=');
  console.log('  ESCENARIO REGISTRADO — ' + direccion.toUpperCase() + '  (' + op.temporalidad + ')');
  linea('=');
  console.log('  registrado a las ' + new Date(op.abiertoEnMs).toISOString().slice(11, 16) + ' UTC');
  console.log('  entrada        ' + usd(entrada));
  console.log('  invalidacion   ' + usd(op.invalidacion)
    + '   (' + (((op.invalidacion - entrada) / entrada) * 100).toFixed(2) + '%)');
  console.log('  riesgo 1R      ' + usd(riesgo) + ' USDT');
  for (const o of op.objetivos) {
    console.log('  ' + o.nombre + '            ' + usd(o.precio)
      + '   R:R ' + o.rr + ':1   exige acertar >' + o.winRateMinimoPct + '%');
  }
  console.log('\n  Registro escrito ANTES de conocer el resultado. Comprueba con:');
  console.log('    node scripts/seguir.mjs');
  linea();
}

if (!args.includes('--abrir')) {
  await comprobar();
}

// --------------------------------------------------------------- comprobar

async function comprobar() {

// ------------------------------------------------------------- comprobar

if (!existsSync(RUTA_SEG)) {
  console.error('No hay ningun escenario en seguimiento.\n'
    + 'Abre uno con: node scripts/seguir.mjs --abrir <alcista|bajista>');
  process.exit(1);
}

const op = JSON.parse(readFileSync(RUTA_SEG, 'utf8'));
const velas = await velasDesde(op.abiertoEnMs);
const ahora = await precioActual();
const esLargo = op.direccion === 'alcista';

/** Beneficio o perdida en unidades de riesgo (R). Es la forma correcta de
 *  medir: independiente del capital y comparable entre operaciones. */
const enR = (precio) => (esLargo ? precio - op.entrada : op.entrada - precio) / op.riesgoUnitario;

// Recorremos minuto a minuto para saber que se toco primero.
let mfeR = op.mfeR, maeR = op.maeR, cerradoPor = null, cerradoEn = null;

for (const v of velas) {
  const favorable = enR(esLargo ? v.h : v.l);
  const adverso = enR(esLargo ? v.l : v.h);
  if (favorable > mfeR) mfeR = favorable;
  if (adverso < maeR) maeR = adverso;

  // La invalidacion se comprueba PRIMERO: si en el mismo minuto se tocaron
  // stop y objetivo, no sabemos el orden dentro de la vela. Asumir lo peor es
  // la unica opcion honesta; asumir lo mejor infla cualquier resultado.
  if (!cerradoPor) {
    const tocaStop = esLargo ? v.l <= op.invalidacion : v.h >= op.invalidacion;
    if (tocaStop) { cerradoPor = 'invalidacion'; cerradoEn = v.t; }
  }
  for (const o of op.objetivos) {
    if (o.alcanzado) continue;
    const toca = esLargo ? v.h >= o.precio : v.l <= o.precio;
    if (toca && !cerradoPor) { o.alcanzado = true; o.alcanzadoEn = new Date(v.t).toISOString(); }
  }
}

op.mfeR = mfeR;
op.maeR = maeR;

if (cerradoPor === 'invalidacion' && op.estado === 'abierto') {
  op.estado = 'invalidado';
  op.resultadoR = -1;
  op.cerradoEn = new Date(cerradoEn).toISOString();
}
const alcanzados = op.objetivos.filter((o) => o.alcanzado);
if (alcanzados.length && op.estado === 'abierto') {
  const ultimo = alcanzados[alcanzados.length - 1];
  op.estado = 'objetivo alcanzado: ' + ultimo.nombre;
  op.resultadoR = ultimo.rr;
}

op.comprobaciones.push({
  momento: new Date().toISOString(),
  precio: ahora,
  enR: Number(enR(ahora).toFixed(3)),
});
writeFileSync(RUTA_SEG, JSON.stringify(op, null, 2));

// ------------------------------------------------------------------ salida

const minutos = Math.round((Date.now() - op.abiertoEnMs) / 60000);
const rActual = enR(ahora);

linea('=');
console.log('  SEGUIMIENTO — escenario ' + op.direccion.toUpperCase()
  + ' (' + op.temporalidad + ')   ' + minutos + ' min transcurridos');
linea('=');
console.log('  registrado    ' + op.id.slice(11, 16) + ' UTC   a ' + usd(op.entrada));
console.log('  precio ahora  ' + usd(ahora)
  + '   (' + (((ahora - op.entrada) / op.entrada) * 100).toFixed(2) + '%)');
console.log('  en unidades R ' + (rActual >= 0 ? '+' : '') + rActual.toFixed(2) + 'R');
console.log('');

// Barra visual entre invalidacion y ultimo objetivo.
const ultimoTP = op.objetivos[op.objetivos.length - 1].precio;
const min = Math.min(op.invalidacion, ultimoTP, ahora);
const max = Math.max(op.invalidacion, ultimoTP, ahora);
const marca = (p) => Math.round(((p - min) / (max - min)) * 56);
const barra = new Array(57).fill('-');
barra[marca(op.invalidacion)] = 'X';
for (const o of op.objetivos) barra[marca(o.precio)] = 'T';
barra[marca(op.entrada)] = 'E';
barra[marca(ahora)] = 'O';
console.log('  ' + usd(min).padStart(7) + ' [' + barra.join('') + '] ' + usd(max));
console.log('           X=invalidacion  E=entrada  O=ahora  T=objetivo\n');

console.log('  invalidacion  ' + usd(op.invalidacion) + (op.estado === 'invalidado' ? '   <-- TOCADA' : ''));
for (const o of op.objetivos) {
  console.log('  ' + o.nombre + '           ' + usd(o.precio) + '   R:R ' + o.rr + ':1'
    + (o.alcanzado ? '   <-- ALCANZADO ' + o.alcanzadoEn.slice(11, 16) : ''));
}

console.log('\n  excursion maxima favorable  +' + op.mfeR.toFixed(2) + 'R');
console.log('  excursion maxima adversa    ' + op.maeR.toFixed(2) + 'R');
console.log('  velas de 1m analizadas      ' + velas.length);
console.log('  comprobaciones registradas  ' + op.comprobaciones.length);

console.log('\n  ESTADO: ' + op.estado.toUpperCase()
  + (op.resultadoR !== null ? '   resultado ' + (op.resultadoR > 0 ? '+' : '') + op.resultadoR + 'R' : ''));

linea();
console.log('  Observacion con fines educativos. n = 1: el resultado de una sola');
console.log('  operacion no distingue el metodo de la suerte, gane o pierda.');
linea();
}
