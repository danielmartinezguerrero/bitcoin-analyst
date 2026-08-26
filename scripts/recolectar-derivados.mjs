#!/usr/bin/env node
/**
 * Guarda una instantanea diaria del posicionamiento en derivados.
 *
 *   npm run derivados                                   recolecta el dia de hoy
 *   node scripts/recolectar-derivados.mjs --forzar      aunque ya haya registro
 *   node scripts/recolectar-derivados.mjs --silencioso  solo errores
 *
 * POR QUE EXISTE: los ratios de top traders, el open interest y el taker
 * ratio solo guardan ~30 dias de historico en Binance. No se pueden
 * backtestear hoy. La unica forma de poder validarlos algun dia es empezar a
 * acumularlos ahora: cada dia que pasa sin recolectar es un dato perdido para
 * siempre. Es el mismo argumento del historico de dossiers.
 *
 * Con un ano de recoleccion habra ~365 puntos, suficiente para empezar a
 * medir si la divergencia entre grandes y minoristas anticipa algo.
 *
 * La logica vive en lib/recoleccion.mjs porque la app de escritorio la llama
 * tambien, en cada arranque. Este fichero solo es su cara de terminal.
 */
import { recolectarDerivados, leerHistorico, saludSerie } from '../lib/recoleccion.mjs';

const args = process.argv.slice(2);
const silencioso = args.includes('--silencioso');
const log = silencioso ? () => {} : (...a) => console.log(...a);

const r = await recolectarDerivados({
  forzar: args.includes('--forzar'),
  alProgresar: log,
});

if (r.estado === 'error') {
  /**
   * SALIR CON CODIGO 1 ES PARTE DEL DISENO. Quien invoque esto —tu mirando el
   * terminal, un programador de tareas, un pipeline— registra el codigo de
   * salida, asi que un fallo real queda anotado en lugar de desaparecer.
   * Fallar ruidosamente es la unica forma de que un hueco sea detectable.
   */
  console.error('ERROR: no se pudo recolectar derivados: ' + r.error);
  console.error('  El dato de hoy se ha perdido: la ventana de 30 dias de Binance no lo recupera.');
  process.exit(1);
}

if (r.estado === 'yaEstaba') {
  log('Ya hay un registro de hoy (' + r.dia + '). Nada que hacer.');
} else {
  const s = r.registro;
  const f = (x) => (x === null || x === undefined ? 'n/d' : x);
  log('POSICIONAMIENTO EN DERIVADOS  ' + s.momento.slice(0, 16).replace('T', ' ') + ' UTC');
  log('  top traders por posicion   ' + f(s.topPosiciones) + '   <- donde esta el dinero grande');
  log('  top traders por cuenta     ' + f(s.topCuentas));
  log('  todas las cuentas          ' + f(s.todasLasCuentas) + '   <- minorista');
  log('  divergencia grandes-retail ' + f(s.divergenciaGrandesVsMinorista));
  log('  open interest              ' + (s.openInterestBTC ? Math.round(s.openInterestBTC).toLocaleString('en-US') + ' BTC' : 'n/d'));
  log('  taker compra/venta         ' + f(s.takerBuySell));
  log('');
  if (!s.completo) log('  AVISO: registro PARCIAL, ' + s.camposPresentes + ' de 5 metricas.');
  if (r.intento > 1) log('  (recolectado al intento ' + r.intento + ')');
}

/** Salud de la serie: lo que hay que mirar cuando nadie vigila la recoleccion. */
const salud = saludSerie(leerHistorico());
log('  registros acumulados: ' + salud.registros
  + '   (hacen falta ~200 para empezar a medir si esto predice algo)');
log('  dias cubiertos: ' + salud.dias
  + (salud.desde ? '   del ' + salud.desde + ' al ' + salud.hasta : '')
  + (salud.huecos ? '   HUECOS: ' + salud.huecos + ' dias' : '')
  + (salud.parciales ? '   parciales: ' + salud.parciales : ''));
