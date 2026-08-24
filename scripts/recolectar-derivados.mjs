#!/usr/bin/env node
/**
 * Guarda una instantanea diaria del posicionamiento en derivados.
 *
 * POR QUE EXISTE: los ratios de top traders, el open interest y el taker
 * ratio solo guardan ~30 dias de historico en Binance. No se pueden
 * backtestear hoy. La unica forma de poder validarlos algun dia es empezar a
 * acumularlos ahora: cada dia que pasa sin recolectar es un dato perdido para
 * siempre. Es el mismo argumento del historico de dossiers.
 *
 * Con un ano de recoleccion habra ~365 puntos, suficiente para empezar a
 * medir si la divergencia entre grandes y minoristas anticipa algo.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { instantaneaDerivados } from '../lib/derivados.mjs';
import { DIR_DATOS, asegurarDirDatos } from '../lib/rutas.mjs';

const RUTA = join(DIR_DATOS, 'derivados-historico.json');

const snap = await instantaneaDerivados();
asegurarDirDatos();

const previo = existsSync(RUTA) ? JSON.parse(readFileSync(RUTA, 'utf8')) : { registros: [] };
previo.registros.push(snap);
previo.actualizado = new Date().toISOString();
writeFileSync(RUTA, JSON.stringify(previo, null, 2));

const f = (x) => (x === null ? 'n/d' : x);
console.log('POSICIONAMIENTO EN DERIVADOS  ' + snap.momento.slice(0, 16).replace('T', ' ') + ' UTC');
console.log('  top traders por posicion   ' + f(snap.topPosiciones) + '   <- donde esta el dinero grande');
console.log('  top traders por cuenta     ' + f(snap.topCuentas));
console.log('  todas las cuentas          ' + f(snap.todasLasCuentas) + '   <- minorista');
console.log('  divergencia grandes-retail ' + f(snap.divergenciaGrandesVsMinorista));
console.log('  open interest              ' + (snap.openInterestBTC ? Math.round(snap.openInterestBTC).toLocaleString('en-US') + ' BTC' : 'n/d'));
console.log('  taker compra/venta         ' + f(snap.takerBuySell));
console.log('');
console.log('  registros acumulados: ' + previo.registros.length
  + '   (hacen falta ~200 para empezar a medir si esto predice algo)');
