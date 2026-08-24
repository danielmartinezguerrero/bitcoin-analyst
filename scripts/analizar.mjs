#!/usr/bin/env node
/**
 * CLI del analizador. Este es el programa que se usa desde el terminal.
 *
 *   node scripts/analizar.mjs              analiza con los datos que haya en disco
 *   node scripts/analizar.mjs --refrescar  descarga datos nuevos antes de analizar
 *   node scripts/analizar.mjs --json       vuelca el dossier en JSON (para la Skill)
 *
 * Produce un DOSSIER: hechos tecnicos medidos, con el desglose de como se
 * llego a cada uno. No emite recomendaciones de compra ni de venta.
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { analizarTemporalidad, sintetizar, mapaDeNiveles } from '../lib/analisis.mjs';
import { construirEscenarios } from '../lib/escenarios.mjs';
import { recolectar } from './fetch-ohlcv.mjs';
import { RUTA_OHLCV, RUTA_DOSSIER, DIR_HISTORICO, asegurarDirDatos, asegurarDirHistorico, nombreHistorico } from '../lib/rutas.mjs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const quiereJson = args.includes('--json');
const quiereRefrescar = args.includes('--refrescar');
const RUTA = RUTA_OHLCV;

// ---------------------------------------------------------------- datos

if (quiereRefrescar || !existsSync(RUTA)) {
  if (!quiereJson) console.log('Descargando datos actualizados...\n');
  await recolectar({ silencioso: quiereJson });
}

const datos = JSON.parse(readFileSync(RUTA, 'utf8'));
const antiguedadMin = (Date.now() - new Date(datos.generadoEn).getTime()) / 60000;

const tfEscenario = (() => { const i = args.indexOf('--escenario'); return i >= 0 && args[i+1] ? args[i+1] : '1d'; })();

const analisis = ['1d', '4h', '1h', '15m']
  .filter((tf) => datos.series[tf])
  .map((tf) => analizarTemporalidad(datos.series[tf]));

const sintesis = sintetizar(analisis);
const mapa = mapaDeNiveles(analisis, '1d');
const escenarios = construirEscenarios(analisis.find((a) => a.temporalidad === tfEscenario) ?? analisis[0], sintesis);

const dossier = {
  generadoEn: new Date().toISOString(),
  datosDe: datos.generadoEn,
  antiguedadDatosMin: Number(antiguedadMin.toFixed(1)),
  simbolo: datos.simbolo,
  precioActual: analisis[0].precio,
  sintesis,
  mapa,
  escenarios,
  temporalidades: analisis,
};

// -------------------------------------------------------------- historico

/**
 * Cada ejecucion se archiva con su fecha, SIEMPRE, antes de imprimir nada.
 *
 * Sin esto el dossier anterior se sobrescribe y el sistema no tiene memoria.
 * Y sin memoria no hay forma de responder "esto funciona?": la unica defensa
 * contra el sesgo retrospectivo es un registro escrito ANTES de conocer el
 * resultado. Cuando ya sabes como acabo, recuerdas haberlo visto venir tanto
 * si acertaste como si no, y las dos veces con la misma seguridad.
 */
asegurarDirHistorico();
const rutaArchivo = join(DIR_HISTORICO, nombreHistorico(dossier.generadoEn));
writeFileSync(rutaArchivo, JSON.stringify(dossier, null, 2));

// ---------------------------------------------------- salida JSON (Skill)

if (quiereJson) {
  asegurarDirDatos();
  writeFileSync(RUTA_DOSSIER, JSON.stringify(dossier, null, 2));
  console.log(JSON.stringify(dossier, null, 2));
  process.exit(0);
}

// ------------------------------------------------ salida legible (humano)

const usd = (x) => (x === null || x === undefined ? 'n/d' : Math.round(x).toLocaleString('en-US'));
const linea = (c = '-') => console.log(c.repeat(74));
const signo = (v) => (v > 0 ? '+' : v < 0 ? '-' : '=');

linea('=');
console.log('  DOSSIER TECNICO  ' + dossier.simbolo + '   ' + usd(dossier.precioActual) + ' USDT');
console.log('  ' + new Date(dossier.generadoEn).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
  + '   datos de hace ' + dossier.antiguedadDatosMin.toFixed(0) + ' min');
linea('=');

if (antiguedadMin > 60) {
  console.log('\n  AVISO: los datos tienen mas de una hora. Usa --refrescar.');
}

console.log('\n  archivado en historico/' + nombreHistorico(dossier.generadoEn));

// --- 1. Sintesis
console.log('\n1. SESGO TECNICO AGREGADO\n');
console.log('   ' + sintesis.sesgo.toUpperCase()
  + '   (' + sintesis.votoPonderado + ' de ' + sintesis.votoMaximo + ' puntos posibles'
  + ', acuerdo ' + sintesis.acuerdo + '%)');
const ancho = 50;
const pos = Math.round(((sintesis.puntuacion + 1) / 2) * ancho);
console.log('\n   bajista [' + '-'.repeat(pos) + 'O' + '-'.repeat(ancho - pos) + '] alcista');

// --- 2. Desglose por temporalidad
console.log('\n\n2. DESGLOSE DE SENALES  (cada una vale -1, 0 o +1)\n');
for (const a of analisis) {
  console.log('   ' + a.temporalidad + '  peso x' + a.peso
    + '   voto ' + (a.voto > 0 ? '+' : '') + a.voto + '/4'
    + '   ultima vela cerrada ' + a.ultimaVelaCerrada.slice(0, 16).replace('T', ' '));
  for (const s of a.senales) {
    console.log('      ' + signo(s.voto) + ' ' + s.nombre.padEnd(24) + s.lectura);
    console.log('        ' + s.porque);
  }
  console.log('      contexto: RSI ' + (a.indicadores.rsi14?.toFixed(0) ?? 'n/d')
    + '   ATR ' + usd(a.indicadores.atr14)
    + ' (' + ((a.indicadores.atr14 / a.precio) * 100).toFixed(1) + '% del precio)'
    + '   volumen ' + (a.indicadores.volRel?.toFixed(2) ?? 'n/d') + 'x'
    + '   rango ' + (a.rango.posicion * 100).toFixed(0) + '%');
  console.log('');
}

// --- 3. Acuerdo y desacuerdo
console.log('\n3. CONFLUENCIAS Y CONFLICTOS ENTRE TEMPORALIDADES\n');
if (sintesis.confluencias.length) {
  console.log('   De acuerdo en las tres temporalidades:');
  for (const c of sintesis.confluencias) {
    console.log('      = ' + c.senal + ' (' + c.direccion + ')');
    console.log('        ' + c.detalle);
  }
}
if (sintesis.conflictos.length) {
  console.log('\n   EN DESACUERDO  <- esto es informacion, no ruido a promediar:');
  for (const c of sintesis.conflictos) {
    console.log('      ! ' + c.senal);
    console.log('        alcista en ' + c.alcistaEn.join(', ') + '   bajista en ' + c.bajistaEn.join(', '));
    console.log('        ' + c.detalle);
  }
} else {
  console.log('\n   Sin conflictos entre temporalidades.');
}

// --- 4. Mapa del terreno
console.log('\n\n4. MAPA DEL TERRENO  (referencia ' + mapa.temporalidad + ')\n');
if (mapa.resistenciaInmediata) {
  const r = mapa.resistenciaInmediata;
  console.log('   resistencia inmediata   ' + usd(r.precio).padStart(8)
    + '   +' + r.distanciaPct + '%   ' + r.distanciaATR + ' ATR   fuerza ' + r.fuerza);
} else {
  console.log('   resistencia inmediata   ninguna en la ventana analizada');
}
console.log('   PRECIO                  ' + usd(mapa.precio).padStart(8)
  + '        ATR(14) ' + usd(mapa.atr));
if (mapa.soporteInmediato) {
  const s = mapa.soporteInmediato;
  console.log('   soporte inmediato       ' + usd(s.precio).padStart(8)
    + '   ' + s.distanciaPct + '%   ' + s.distanciaATR + ' ATR   fuerza ' + s.fuerza);
}
if (mapa.invalidacionEstructural) {
  const d = (((mapa.invalidacionEstructural - mapa.precio) / mapa.precio) * 100).toFixed(1);
  console.log('\n   La lectura estructural dejaria de sostenerse si el precio pierde '
    + usd(mapa.invalidacionEstructural) + ' (' + d + '%).');
}
if (mapa.simetria !== null) {
  console.log('   Recorrido hasta la primera zona: ' + mapa.recorridoArribaATR + ' ATR arriba, '
    + mapa.recorridoAbajoATR + ' ATR abajo.');
  console.log('   Descripcion geometrica del grafico, no una relacion riesgo/beneficio.');
}

// --- 5. Lo que contradice
console.log('\n\n5. EVIDENCIA EN CONTRA DE LA LECTURA DOMINANTE\n');
if (sintesis.enContra.length) {
  for (const e of sintesis.enContra) console.log('   - ' + e);
} else {
  console.log('   Ninguna senal relevante contradice la lectura.');
}

// --- 6. Escenarios operativos
console.log('\n\n6. ESCENARIOS TECNICOS  (referencia ' + escenarios.temporalidad
  + ', ATR ' + usd(escenarios.atr) + ')\n');
console.log('   Geometria condicional del grafico. Describen DONDE se rompe cada');
console.log('   lectura y DONDE estan las siguientes zonas, no que vaya a ocurrir.\n');

for (const e of escenarios.escenarios) {
  const marca = e.alineadoConSesgo ? '>> A FAVOR del sesgo' : '   EN CONTRA del sesgo';
  linea();
  console.log('   ESCENARIO ' + e.direccion.toUpperCase() + '   ' + marca);
  linea();
  console.log('   activacion    ' + e.activacion);
  console.log('   invalidacion  ' + usd(e.invalidacion.precio)
    + '   (' + e.invalidacion.distanciaPct + '%, ' + e.invalidacion.distanciaATR + ' ATR)');
  console.log('                 base: ' + e.invalidacion.base
    + (e.invalidacion.nivelOrigen ? '   nivel de origen ' + usd(e.invalidacion.nivelOrigen) : ''));
  console.log('   riesgo (1R)   ' + usd(e.riesgoUnitario) + ' USDT  =  ' + e.riesgoATR + ' ATR\n');
  console.log('   objetivo      precio      R:R    acierto minimo   origen');
  for (const o of e.objetivos) {
    console.log('   ' + ('TP' + (e.objetivos.indexOf(o) + 1)).padEnd(13)
      + usd(o.precio).padStart(8)
      + '   ' + (o.rr + ':1').padStart(6)
      + '   ' + (o.winRateMinimoPct + '%').padStart(9) + '        '
      + o.origen);
  }
  if (e.advertencias.length) {
    console.log('');
    for (const a of e.advertencias) console.log('   (!) ' + a);
  }
  console.log('');
}

console.log('   COMO SE LEE LA COLUMNA "acierto minimo":');
console.log('   es 1 / (1 + R:R). Un escenario de 3:1 pierde dinero a largo plazo si');
console.log('   se acierta menos del 25% de las veces, por bien que se vea el grafico.');
console.log('   Un R:R alto no compensa nada por si solo.\n');
console.log('   LIMITE: ' + escenarios.limitacion);

// Estado de la validacion estadistica, si se ha ejecutado.
try {
  const val = JSON.parse(readFileSync(join(RUTA_OHLCV, '..', 'validacion.json'), 'utf8'));
  console.log('');
  linea();
  console.log('   VALIDACION ESTADISTICA DE LOS NIVELES  (test tipo Osler)');
  linea();
  for (const i of val.intentos) {
    console.log('   intento ' + i.n + ' — ' + i.metrica);
    console.log('     real ' + i.real.toFixed(4) + '   azar ' + i.azar.toFixed(4)
      + '   z ' + i.z.toFixed(2) + '   p ' + i.p.toFixed(4)
      + '   ' + (i.significativo ? 'SIGNIFICATIVO' : 'no significativo'));
  }
  console.log('');
  console.log('   ' + val.conclusion);
  console.log('   Los niveles que sostienen los escenarios de arriba NO tienen');
  console.log('   respaldo empirico. Tenlo presente al leer cualquier objetivo.');
} catch { /* aun no se ha ejecutado la validacion */ }

linea();
console.log('Dossier tecnico con fines educativos y de investigacion. Describe el');
console.log('estado del grafico y escenarios condicionales derivados de el. No es');
console.log('asesoramiento financiero, no conoce tu situacion ni tu capital, y no');
console.log('afirma que ningun escenario vaya a cumplirse. La decision, el criterio');
console.log('y el riesgo son enteramente tuyos.');
linea();
