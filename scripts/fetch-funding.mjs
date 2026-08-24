/**
 * Descarga el historico completo de funding rate de BTCUSDT perpetuo.
 *
 * El funding es el pago periodico (cada 8h) entre largos y cortos que ancla
 * el precio del perpetuo al spot. Es el mejor proxy GRATUITO de posicionamiento
 * apalancado que existe: cuando el funding se dispara, hay largos hacinados
 * pagando por mantenerse, y esas situaciones preceden a cascadas de liquidacion.
 *
 * Es ademas el UNICO dato de derivados de Binance con historico profundo
 * (desde 2019). Los ratios de top traders y el open interest solo guardan
 * 30 dias, asi que no se pueden backtestear: hay que empezar a acumularlos.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIR_DATOS, asegurarDirDatos } from '../lib/rutas.mjs';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('Descargando historico de funding rate de BTCUSDT...\n');
  const todos = [];
  let desde = Date.UTC(2019, 0, 1);

  while (true) {
    const url = 'https://fapi.binance.com/fapi/v1/fundingRate'
      + `?symbol=BTCUSDT&startTime=${desde}&limit=1000`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error('Binance ' + res.status + ': ' + await res.text());
    const bloque = await res.json();
    if (!bloque.length) break;

    todos.push(...bloque.map((f) => ({
      t: f.fundingTime,
      fecha: new Date(f.fundingTime).toISOString(),
      tasa: parseFloat(f.fundingRate),
      marca: parseFloat(f.markPrice ?? 0),
    })));
    process.stdout.write('\r  ' + todos.length + ' registros...');
    if (bloque.length < 1000) break;
    desde = bloque[bloque.length - 1].fundingTime + 1;
    await esperar(200);
  }

  // Deduplicado por si dos bloques se solapan.
  const vistos = new Set();
  const limpios = todos.filter((f) => (vistos.has(f.t) ? false : (vistos.add(f.t), true)));

  const tasas = limpios.map((f) => f.tasa);
  const media = tasas.reduce((s, x) => s + x, 0) / tasas.length;
  const ordenadas = [...tasas].sort((a, b) => a - b);
  const pct = (q) => ordenadas[Math.floor(q * ordenadas.length)];

  console.log('\r  ' + limpios.length + ' registros de funding'
    + '   desde ' + limpios[0].fecha.slice(0, 10)
    + ' hasta ' + limpios[limpios.length - 1].fecha.slice(0, 10));
  console.log('');
  console.log('  ESTADISTICAS (tasa por periodo de 8h)');
  console.log('    media          ' + (media * 100).toFixed(4) + '%');
  console.log('    percentil 1    ' + (pct(0.01) * 100).toFixed(4) + '%');
  console.log('    percentil 25   ' + (pct(0.25) * 100).toFixed(4) + '%');
  console.log('    mediana        ' + (pct(0.5) * 100).toFixed(4) + '%');
  console.log('    percentil 75   ' + (pct(0.75) * 100).toFixed(4) + '%');
  console.log('    percentil 99   ' + (pct(0.99) * 100).toFixed(4) + '%');
  console.log('    maximo         ' + (Math.max(...tasas) * 100).toFixed(4) + '%');
  console.log('    minimo         ' + (Math.min(...tasas) * 100).toFixed(4) + '%');
  console.log('');
  console.log('    positivos      ' + ((tasas.filter((x) => x > 0).length / tasas.length) * 100).toFixed(1)
    + '%  (los largos pagan a los cortos)');

  asegurarDirDatos();
  writeFileSync(join(DIR_DATOS, 'funding.json'), JSON.stringify({
    generadoEn: new Date().toISOString(), simbolo: 'BTCUSDT',
    cantidad: limpios.length, registros: limpios,
  }));
  console.log('\n  Guardado en data/funding.json');
}

main().catch((e) => { console.error('\nERROR:', e.message); process.exit(1); });
