/**
 * Verificacion de lib/recoleccion.mjs.
 *
 * ESTE MODULO SE EJECUTA SIN NADIE MIRANDO, en cada arranque de la app, y
 * escribe sobre una serie que no se puede reconstruir: Binance solo guarda 30
 * dias de estos ratios, asi que un dia mal recogido esta mal para siempre.
 * Eso invierte la prioridad habitual de los tests: aqui importa mas comprobar
 * lo que NO debe pasar —guardar un registro vacio, duplicar un dia, dejar el
 * fichero a medias— que el camino feliz.
 *
 * Ni un solo test toca la red ni el historico de verdad: la instantanea y la
 * ruta se inyectan.
 */
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  calidad, yaHayRegistroHoy, diaDe, conReintentos, guardarAtomico,
  leerHistorico, recolectarDerivados, saludSerie, METRICAS,
} from '../lib/recoleccion.mjs';

let pasados = 0, fallados = 0;
function comprobar(nombre, condicion, detalle = '') {
  if (condicion) { pasados++; console.log('  ok   ' + nombre); }
  else { fallados++; console.log('  FALLO ' + nombre + (detalle ? '  -> ' + detalle : '')); }
}

const dir = mkdtempSync(join(tmpdir(), 'btc-recoleccion-'));
const rutaTmp = (n) => join(dir, n + '.json');
/** Los tests no esperan de verdad: el retardo se inyecta. */
const sinEsperas = { dormir: async () => {} };

const VACIO = { topPosiciones: null, topCuentas: null, todasLasCuentas: null, openInterestBTC: null, takerBuySell: null };
const PARCIAL = { ...VACIO, topPosiciones: 2.0, todasLasCuentas: 0.9 };
const LLENO = { topPosiciones: 2, topCuentas: 1, todasLasCuentas: 0.9, openInterestBTC: 100, takerBuySell: 1.1 };

// ------------------------------------------------------------- calidad

console.log('\nCalidad de una instantanea');
{
  comprobar('cinco metricas declaradas', METRICAS.length === 5);
  comprobar('todo nulo -> 0 campos presentes', calidad(VACIO).presentes === 0);
  comprobar('todo nulo -> no completo', calidad(VACIO).completo === false);
  comprobar('parcial -> cuenta solo los presentes', calidad(PARCIAL).presentes === 2);
  comprobar('parcial -> no completo', calidad(PARCIAL).completo === false);
  comprobar('lleno -> completo', calidad(LLENO).completo === true);
  /** `undefined` cuenta como ausente igual que `null`: la API produce los dos. */
  comprobar('undefined cuenta como ausente igual que null',
    calidad({ ...LLENO, takerBuySell: undefined }).presentes === 4);
  comprobar('un cero es un valor, no una ausencia',
    calidad({ ...LLENO, takerBuySell: 0 }).presentes === 5);
}

// -------------------------------------------------------- idempotencia

console.log('\nIdempotencia por dia UTC');
{
  comprobar('el dia se extrae del ISO', diaDe('2026-08-24T21:30:00.000Z') === '2026-08-24');
  comprobar('un momento invalido no revienta', diaDe(undefined) === null);
  comprobar('detecta que ya hay registro de hoy',
    yaHayRegistroHoy([{ momento: '2026-08-24T03:00:00Z' }], '2026-08-24'));
  comprobar('no confunde el dia de ayer',
    !yaHayRegistroHoy([{ momento: '2026-08-23T23:59:59Z' }], '2026-08-24'));
  comprobar('historico vacio -> no hay registro de hoy',
    !yaHayRegistroHoy([], '2026-08-24'));
  /**
   * 23:59 UTC y 00:01 UTC son dias distintos aunque disten dos minutos. Es lo
   * correcto: las velas y el funding tambien van en UTC.
   */
  comprobar('la frontera de dia es UTC, no local',
    yaHayRegistroHoy([{ momento: '2026-08-24T23:59:00Z' }], '2026-08-24')
    && !yaHayRegistroHoy([{ momento: '2026-08-25T00:01:00Z' }], '2026-08-24'));
}

// ----------------------------------------------------------- reintentos

console.log('\nReintentos');
{
  let n = 0;
  let fallo = null;
  try {
    await conReintentos(async () => { n++; return VACIO; }, { intentos: 3, ...sinEsperas });
  } catch (e) { fallo = e; }
  comprobar('una instantanea vacia NO se acepta', fallo !== null);
  comprobar('y se reintenta el numero declarado de veces', n === 3, 'n=' + n);

  n = 0;
  const r = await conReintentos(async () => {
    n++;
    if (n < 3) throw new Error('ECONNRESET');
    return LLENO;
  }, { intentos: 4, ...sinEsperas });
  comprobar('se recupera de fallos transitorios', r.intento === 3, 'intento=' + r.intento);

  const p = await conReintentos(async () => PARCIAL, sinEsperas);
  comprobar('una instantanea PARCIAL si se acepta', p.q.presentes === 2);
  comprobar('y queda marcada como no completa', p.q.completo === false);

  const esperas = [];
  n = 0;
  try {
    await conReintentos(async () => { n++; throw new Error('x'); },
      { intentos: 4, esperaMs: 1000, dormir: async (ms) => esperas.push(ms) });
  } catch { /* esperado */ }
  comprobar('la espera crece entre intentos',
    esperas.length === 3 && esperas[0] < esperas[1] && esperas[1] < esperas[2],
    esperas.join(','));
  /** Se espera ENTRE intentos, nunca despues del ultimo: seria tiempo tirado. */
  comprobar('no espera despues del ultimo intento', esperas.length === 3);
}

// ------------------------------------------------- persistencia atomica

console.log('\nPersistencia');
{
  const r1 = rutaTmp('atomico');
  guardarAtomico(r1, { registros: [{ momento: '2026-08-01T00:00:00Z' }] });
  comprobar('escribe el fichero', existsSync(r1));
  comprobar('no deja el temporal atras', !existsSync(r1 + '.tmp'));
  comprobar('lo escrito se relee igual', leerHistorico(r1).registros.length === 1);

  comprobar('un fichero inexistente devuelve historico vacio',
    leerHistorico(rutaTmp('no-existe')).registros.length === 0);

  /**
   * UN HISTORICO CORRUPTO NO SE PISA. Sobrescribirlo convertiria un fichero
   * dañado —que aun se puede rescatar a mano— en uno perdido. Tiene que
   * fallar hacia arriba y dejarlo intacto.
   */
  const r2 = rutaTmp('corrupto');
  writeFileSync(r2, '{ esto no es json valido');
  let lanzo = false;
  try { leerHistorico(r2); } catch { lanzo = true; }
  comprobar('un historico ilegible lanza en vez de devolver vacio', lanzo);
  comprobar('y el fichero corrupto sigue ahi sin tocar',
    readFileSync(r2, 'utf8') === '{ esto no es json valido');

  const r3 = rutaTmp('sin-registros');
  writeFileSync(r3, JSON.stringify({ otraCosa: 1 }));
  comprobar('un JSON valido sin registros se trata como vacio',
    leerHistorico(r3).registros.length === 0);
}

// --------------------------------------------- recoleccion de punta a punta

console.log('\nRecoleccion completa (sin red)');
{
  const ruta = rutaTmp('serie');
  const hoy = new Date().toISOString().slice(0, 10);

  const a = await recolectarDerivados({ ruta, instantanea: async () => LLENO, ...sinEsperas });
  comprobar('primera recoleccion guarda', a.estado === 'guardado', a.estado);
  comprobar('marca el registro como completo', a.registro.completo === true);
  comprobar('anota cuantos campos traia', a.registro.camposPresentes === 5);
  /**
   * INVARIANTE DEL HISTORICO: todo registro guardado lleva `momento`, lo
   * traiga la instantanea o no. Sin el, la deteccion de "ya hay registro de
   * hoy" no reconoce la fila y el dia se duplica en cada arranque.
   */
  comprobar('un registro sin momento recibe uno al guardarse',
    typeof a.registro.momento === 'string' && a.registro.momento.length > 10,
    String(a.registro.momento));

  let llamadas = 0;
  const b = await recolectarDerivados({
    ruta, instantanea: async () => { llamadas++; return LLENO; }, ...sinEsperas,
  });
  comprobar('la segunda del mismo dia no guarda', b.estado === 'yaEstaba', b.estado);
  /** No basta con no guardar: no debe ni pedirlo, o gastaria cuota de la API. */
  comprobar('y ni siquiera llama a la API', llamadas === 0);
  comprobar('el historico sigue con un solo registro',
    leerHistorico(ruta).registros.length === 1);

  const c = await recolectarDerivados({
    ruta, forzar: true, instantanea: async () => LLENO, ...sinEsperas,
  });
  comprobar('--forzar si vuelve a guardar', c.estado === 'guardado' && c.total === 2);

  /**
   * EL CASO QUE MAS IMPORTA: si la API viene vacia, no se guarda NADA. Antes
   * se anadia un registro de nulos y la serie quedaba envenenada en silencio.
   */
  const ruta2 = rutaTmp('serie-vacia');
  const d = await recolectarDerivados({ ruta: ruta2, instantanea: async () => VACIO, ...sinEsperas });
  comprobar('una API que devuelve nulos NO ensucia la serie', d.estado === 'error', d.estado);
  comprobar('y no deja fichero a medias', leerHistorico(ruta2).registros.length === 0);

  const ruta3 = rutaTmp('serie-error');
  const e = await recolectarDerivados({
    ruta: ruta3, instantanea: async () => { throw new Error('sin red'); }, ...sinEsperas,
  });
  comprobar('un fallo de red devuelve estado error, no una excepcion', e.estado === 'error');
  comprobar('el mensaje del fallo se conserva', /sin red/.test(e.error), e.error);

  /**
   * NUNCA LANZA. La llama el arranque de la app: una excepcion aqui seria una
   * ventana que no abre por culpa de un dato accesorio.
   */
  const ruta4 = rutaTmp('corrupto-serie');
  writeFileSync(ruta4, 'no json');
  const f = await recolectarDerivados({ ruta: ruta4, instantanea: async () => LLENO, ...sinEsperas });
  comprobar('con historico corrupto devuelve error sin lanzar', f.estado === 'error');
  comprobar('y no destruye el fichero corrupto', readFileSync(ruta4, 'utf8') === 'no json');

  comprobar('el dia devuelto es el de hoy en UTC', a.dia === hoy, a.dia);
}

// ------------------------------------------------------- salud de la serie

console.log('\nSalud de la serie');
{
  const s = saludSerie({ registros: [
    { momento: '2026-08-01T00:00:00Z' },
    { momento: '2026-08-02T00:00:00Z' },
    { momento: '2026-08-05T00:00:00Z', completo: false },
  ] });
  comprobar('cuenta los registros', s.registros === 3);
  comprobar('cuenta los dias distintos', s.dias === 3);
  comprobar('detecta los huecos', s.huecos === 2, 'huecos=' + s.huecos);
  comprobar('cuenta los parciales', s.parciales === 1);
  comprobar('reporta el rango cubierto', s.desde === '2026-08-01' && s.hasta === '2026-08-05');

  const dup = saludSerie({ registros: [
    { momento: '2026-08-01T03:00:00Z' }, { momento: '2026-08-01T21:00:00Z' },
  ] });
  comprobar('dos registros del mismo dia cuentan como un dia',
    dup.registros === 2 && dup.dias === 1);
  comprobar('dias consecutivos no producen huecos', dup.huecos === 0);
  comprobar('una serie vacia no revienta', saludSerie({ registros: [] }).dias === 0);
}

rmSync(dir, { recursive: true, force: true });

console.log('\n' + '-'.repeat(52));
console.log('Pasados: ' + pasados + '   Fallados: ' + fallados);
process.exit(fallados === 0 ? 0 : 1);
