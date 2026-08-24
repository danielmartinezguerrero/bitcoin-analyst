/**
 * Descarga historica larga, paginando el endpoint de Binance.
 *
 * Binance devuelve como maximo 1000 velas por peticion. Para traer anos de
 * datos hay que encadenar peticiones usando startTime: se pide un bloque, se
 * toma el cierre de la ultima vela recibida, y se pide el siguiente bloque a
 * partir de ahi.
 *
 * Esto hace falta para la validacion estadistica: con 400 velas diarias, una
 * vez descontado el periodo de calentamiento que necesitan los indicadores,
 * quedan poquisimas ocasiones de prueba. Sin muestra no hay conclusion.
 *
 *   node scripts/fetch-historico.mjs
 */
import { writeFileSync } from 'node:fs';
import { normalizarVela } from './fetch-ohlcv.mjs';
import { RUTA_LARGO_PLAZO, asegurarDirDatos } from '../lib/rutas.mjs';

const SIMBOLO = 'BTCUSDT';
// BTCUSDT empezo a cotizar en Binance el 17 de agosto de 2017.
const INICIO = Date.UTC(2017, 7, 17);
const SERIES = ['1d', '4h'];
const LIMITE = 1000;

/** Pausa entre peticiones: cortesia con el endpoint publico, que es gratis. */
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function descargarSerie(intervalo) {
  const velas = [];
  let desde = INICIO;
  let peticiones = 0;

  while (true) {
    const url = 'https://api.binance.com/api/v3/klines'
      + `?symbol=${SIMBOLO}&interval=${intervalo}&startTime=${desde}&limit=${LIMITE}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Binance ${res.status}: ${await res.text()}`);

    const bloque = await res.json();
    peticiones++;
    if (!bloque.length) break;

    velas.push(...bloque.map(normalizarVela));
    process.stdout.write('\r  ' + intervalo + ': ' + velas.length + ' velas'
      + ' (' + peticiones + ' peticiones)   ');

    // Si el bloque viene incompleto, hemos llegado al presente.
    if (bloque.length < LIMITE) break;

    // Siguiente bloque: justo despues del cierre de la ultima vela recibida.
    desde = bloque[bloque.length - 1][6] + 1;

    await esperar(250);
  }

  // La ultima vela puede estar sin cerrar; se descarta para el analisis
  // historico, donde solo interesan velas completas.
  const ahora = Date.now();
  while (velas.length && velas[velas.length - 1].tCierre > ahora) velas.pop();

  // Deduplicado defensivo: si dos bloques se solapan por un error de limites,
  // acabariamos con velas repetidas y todos los indicadores saldrian mal.
  const vistos = new Set();
  const limpias = velas.filter((v) => {
    if (vistos.has(v.t)) return false;
    vistos.add(v.t);
    return true;
  });

  const duplicados = velas.length - limpias.length;
  console.log('\r  ' + intervalo + ': ' + limpias.length + ' velas'
    + ' (' + peticiones + ' peticiones'
    + (duplicados ? ', ' + duplicados + ' duplicados descartados' : '') + ')'
    + '   desde ' + limpias[0].fecha.slice(0, 10)
    + ' hasta ' + limpias[limpias.length - 1].fecha.slice(0, 10));

  return limpias;
}

/** Verifica que la serie no tiene huecos ni velas incoherentes. */
function validar(velas, intervalo) {
  const paso = velas[1].t - velas[0].t;
  const huecos = [];
  for (let i = 1; i < velas.length; i++) {
    if (velas[i].t - velas[i - 1].t !== paso) {
      huecos.push({ desde: velas[i - 1].fecha, hasta: velas[i].fecha });
    }
  }
  const incoherentes = velas.filter(
    (c) => c.h < Math.max(c.o, c.c) || c.l > Math.min(c.o, c.c) || c.h < c.l
  ).length;

  console.log('  ' + intervalo + ': ' + huecos.length + ' huecos, '
    + incoherentes + ' velas incoherentes');
  if (huecos.length) {
    for (const h of huecos.slice(0, 5)) {
      console.log('      hueco: ' + h.desde.slice(0, 16) + ' -> ' + h.hasta.slice(0, 16));
    }
    if (huecos.length > 5) console.log('      ... y ' + (huecos.length - 5) + ' mas');
  }
  return { huecos: huecos.length, incoherentes };
}

async function main() {
  console.log('Descargando historico completo de ' + SIMBOLO + ' desde '
    + new Date(INICIO).toISOString().slice(0, 10) + '\n');

  const salida = {
    generadoEn: new Date().toISOString(),
    simbolo: SIMBOLO,
    fuente: 'binance:/api/v3/klines (paginado)',
    series: {},
  };

  for (const intervalo of SERIES) {
    const velas = await descargarSerie(intervalo);
    const calidad = validar(velas, intervalo);
    salida.series[intervalo] = {
      intervalo,
      cantidad: velas.length,
      desde: velas[0].fecha,
      hasta: velas[velas.length - 1].fecha,
      calidad,
      velas,
    };
    console.log('');
  }

  asegurarDirDatos();
  writeFileSync(RUTA_LARGO_PLAZO, JSON.stringify(salida));

  const { statSync } = await import('node:fs');
  const mb = (statSync(RUTA_LARGO_PLAZO).size / 1048576).toFixed(1);
  console.log('Guardado en data/ohlcv-largo.json (' + mb + ' MB)');
}

main().catch((e) => {
  console.error('\nERROR:', e.message);
  process.exit(1);
});
