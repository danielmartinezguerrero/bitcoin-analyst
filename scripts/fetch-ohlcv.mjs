/**
 * MODULO 1 - Recolector de velas (OHLCV) desde Binance.
 *
 * Fuente: endpoint publico /api/v3/klines. No requiere registro ni API key.
 * Salida: data/ohlcv-<timeframe>.json
 *
 * Este script NO analiza nada. Solo trae datos crudos y los normaliza.
 * Separar "recolectar" de "analizar" es deliberado: si manana cambiamos
 * de fuente, solo se toca este archivo.
 */

import { pathToFileURL } from 'node:url';
import { RUTA_OHLCV, asegurarDirDatos } from '../lib/rutas.mjs';

const SIMBOLO = 'BTCUSDT';

// Que temporalidades queremos y cuantas velas de cada una.
// Binance permite maximo 1000 velas por peticion.
const TEMPORALIDADES = [
  { intervalo: '1d', velas: 400 },  // ~13 meses: tendencia mayor
  { intervalo: '4h', velas: 500 },  // ~83 dias: estructura intermedia
  { intervalo: '1h', velas: 500 },  // ~21 dias: contexto de entrada
  { intervalo: '15m', velas: 500 }, // ~5 dias: ejecucion intradia
];

/**
 * Binance devuelve cada vela como un ARRAY de 12 posiciones, no como objeto.
 * Posiciones que nos interesan:
 *   [0] tiempo de apertura (ms)   [4] cierre
 *   [1] apertura                   [5] volumen (en BTC)
 *   [2] maximo                     [6] tiempo de cierre (ms)
 *   [3] minimo                     [8] numero de operaciones
 * Los precios vienen como STRING para no perder precision. Los convertimos
 * a numero aqui, en el borde del sistema, para que el resto del codigo
 * trabaje siempre con numeros.
 */
export function normalizarVela(k) {
  return {
    t: k[0],                  // timestamp de apertura
    fecha: new Date(k[0]).toISOString(),
    o: parseFloat(k[1]),
    h: parseFloat(k[2]),
    l: parseFloat(k[3]),
    c: parseFloat(k[4]),
    v: parseFloat(k[5]),
    tCierre: k[6],
    ops: k[8],
  };
}

async function traerVelas(intervalo, limite) {
  const url = `https://api.binance.com/api/v3/klines`
    + `?symbol=${SIMBOLO}&interval=${intervalo}&limit=${limite}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) {
    throw new Error(`Binance respondio ${res.status} para ${intervalo}: ${await res.text()}`);
  }

  const crudo = await res.json();
  const velas = crudo.map(normalizarVela);

  // PUNTO CRITICO: la ULTIMA vela todavia no ha cerrado. Su maximo, minimo
  // y cierre siguen cambiando. Si calculas un RSI incluyendolo, el valor
  // cambia cada minuto (esto se llama "repintado" y arruina cualquier
  // backtest). La marcamos para que el analisis decida si usarla.
  const ahora = Date.now();
  const ultima = velas[velas.length - 1];
  ultima.enCurso = ultima.tCierre > ahora;

  return velas;
}

export async function recolectar({ silencioso = false } = {}) {
  const log = silencioso ? () => {} : (...a) => console.log(...a);
  const escribir = silencioso ? () => {} : (s) => process.stdout.write(s);
  const salida = {
    generadoEn: new Date().toISOString(),
    simbolo: SIMBOLO,
    fuente: 'binance:/api/v3/klines',
    series: {},
  };

  for (const { intervalo, velas: n } of TEMPORALIDADES) {
    escribir(`Descargando ${SIMBOLO} ${intervalo} (${n} velas)... `);
    const velas = await traerVelas(intervalo, n);
    const ultima = velas[velas.length - 1];

    salida.series[intervalo] = {
      intervalo,
      cantidad: velas.length,
      desde: velas[0].fecha,
      hasta: ultima.fecha,
      ultimaEnCurso: ultima.enCurso,
      velas,
    };

    log(`OK  ultimo cierre: ${ultima.c.toFixed(2)} USDT`
      + `${ultima.enCurso ? '  (vela EN CURSO, no cerrada)' : ''}`);
  }

  const { writeFile } = await import('node:fs/promises');
  asegurarDirDatos();
  const ruta = RUTA_OHLCV;
  await writeFile(ruta, JSON.stringify(salida, null, 2));

  const { statSync } = await import('node:fs');
  const kb = (statSync(ruta).size / 1024).toFixed(0);
  log(`\nGuardado en ${ruta} (${kb} KB)`);

  return salida;
}

// Solo se autoejecuta si lo invocan directamente; si otro modulo lo importa,
// se limita a exportar recolectar(). Es el equivalente en ESM del clasico
// `if __name__ == "__main__"`.
//
// SE USA pathToFileURL, NO CONCATENACION MANUAL. En Windows import.meta.url
// vale `file:///C:/Users/...` con TRES barras, mientras que construir
// 'file://' + ruta da solo dos: la comparacion falla siempre y el script se
// queda mudo sin dar ningun error. pathToFileURL genera la forma canonica en
// cualquier plataforma.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  recolectar().catch((e) => {
    console.error('ERROR:', e.message);
    process.exit(1);
  });
}
