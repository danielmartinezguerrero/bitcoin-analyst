/**
 * MODULO 14 - Recoleccion desatendida de derivados.
 *
 * POR QUE ES UN MODULO Y NO CUATRO LINEAS DENTRO DEL SCRIPT.
 *
 * Desde que la app de escritorio recolecta en cada arranque, esto se ejecuta
 * sin nadie mirando, y ahi deja de valer que "casi siempre funcione". Un
 * recolector desatendido que falla en silencio no deja un hueco visible: deja
 * una serie que PARECE completa y no lo esta. El error se descubre meses
 * despues, al ir a medir, cuando ya no tiene arreglo porque la ventana de 30
 * dias de Binance hace mucho que paso por encima.
 *
 * Las tres defensas de abajo no estaban en la version original. Sin ellas,
 * automatizar la recoleccion habria corrompido el dataset en lugar de
 * construirlo, que es exactamente lo contrario de para lo que existe.
 */
import { writeFileSync, readFileSync, existsSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { instantaneaDerivados } from './derivados.mjs';
import { DIR_DATOS, asegurarDirDatos } from './rutas.mjs';

export const RUTA_DERIVADOS = join(DIR_DATOS, 'derivados-historico.json');

/** Los cinco valores que dan sentido a un registro. */
export const METRICAS = [
  'topPosiciones', 'topCuentas', 'todasLasCuentas', 'openInterestBTC', 'takerBuySell',
];

/**
 * DEFENSA 1 - IDEMPOTENCIA POR DIA UTC.
 *
 * Sin esto, dos ejecuciones el mismo dia dejan dos registros y la serie deja
 * de ser "una observacion diaria" sin que nada lo indique. Con la recoleccion
 * atada al arranque de la app, abrirla tres veces en una tarde es lo normal,
 * no un caso raro: la idempotencia pasa de deseable a imprescindible.
 *
 * Se compara por dia UTC y no local a proposito, porque las velas y el
 * funding tambien van en UTC; mezclar husos crearia dias de 23 y de 25 horas
 * en la serie dos veces al ano.
 */
export function diaDe(momentoISO) {
  return typeof momentoISO === 'string' ? momentoISO.slice(0, 10) : null;
}

export function yaHayRegistroHoy(registros, hoy = new Date().toISOString().slice(0, 10)) {
  return registros.some((r) => diaDe(r.momento) === hoy);
}

/**
 * DEFENSA 2 - UN REGISTRO VACIO NO ES UN REGISTRO.
 *
 * `instantaneaDerivados()` devuelve null en cada campo cuyo endpoint responda
 * algo distinto de 200, y NO lanza excepcion. Un 429 por limite de peticiones
 * o un 451 por bloqueo geografico producen por tanto una instantanea entera
 * de nulos, que la version anterior guardaba tan tranquila. Meses despues
 * habria decenas de dias envenenados mezclados con los buenos, sin ninguna
 * marca que los distinga salvo su propio contenido.
 *
 * Un fallo PARCIAL si se guarda, marcado con `completo: false`. Si faltan el
 * open interest y el taker ratio pero estan los dos lados de la divergencia,
 * el dato sigue sirviendo, y tirarlo seria perder informacion real. Lo que se
 * rechaza es la instantanea sin absolutamente nada dentro.
 */
export function calidad(snap) {
  const presentes = METRICAS.filter((k) => snap[k] !== null && snap[k] !== undefined);
  return {
    presentes: presentes.length,
    total: METRICAS.length,
    completo: presentes.length === METRICAS.length,
  };
}

/**
 * DEFENSA 3 - REINTENTOS CON ESPERA CRECIENTE.
 *
 * El dato de hoy no se puede recuperar manana: la ventana de 30 dias avanza y
 * lo que no se guardo se perdio. Un corte de red de dos minutos no puede
 * costar un dia de serie.
 *
 * La espera CRECE en vez de ser fija porque el fallo mas probable es un
 * limite de peticiones, y reintentar rapido contra un 429 es la forma mas
 * eficaz de convertir un fallo transitorio en uno permanente.
 */
export async function conReintentos(fn, { intentos = 3, esperaMs = 15000, alProgresar = () => {}, dormir } = {}) {
  const esperar = dormir ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let ultimo;

  for (let i = 1; i <= intentos; i++) {
    try {
      const snap = await fn();
      const q = calidad(snap);
      if (q.presentes > 0) return { snap, q, intento: i };
      ultimo = new Error('todos los campos vinieron vacios (0 de ' + q.total + ')');
    } catch (e) {
      ultimo = e;
    }
    if (i < intentos) {
      alProgresar('  intento ' + i + ' fallido (' + ultimo.message + '), reintentando en '
        + (esperaMs * i) / 1000 + ' s...');
      await esperar(esperaMs * i);
    }
  }
  throw ultimo;
}

/**
 * ESCRITURA ATOMICA. El fichero crece un registro al dia durante anos. Si el
 * proceso muere a mitad de un writeFileSync queda un JSON truncado y se
 * pierde TODO el historico, no solo el dia en curso — y con la recoleccion en
 * el arranque de la app, cerrarla a los dos segundos de abrirla es un gesto
 * completamente normal. Se escribe a un temporal y se renombra, que dentro
 * del mismo volumen es atomico.
 */
export function guardarAtomico(ruta, objeto) {
  mkdirSync(dirname(ruta), { recursive: true });
  const tmp = ruta + '.tmp';
  writeFileSync(tmp, JSON.stringify(objeto, null, 2));
  renameSync(tmp, ruta);
}

export function leerHistorico(ruta = RUTA_DERIVADOS) {
  if (!existsSync(ruta)) return { registros: [] };
  try {
    const h = JSON.parse(readFileSync(ruta, 'utf8'));
    return Array.isArray(h.registros) ? h : { registros: [] };
  } catch {
    /**
     * Un historico ilegible NO se sobrescribe alegremente: eso convertiria un
     * fichero corrupto (recuperable a mano) en uno perdido. Se avisa hacia
     * arriba y quien llame decide.
     */
    throw new Error('derivados-historico.json existe pero no se puede leer. '
      + 'No se toca para no perder lo que haya dentro.');
  }
}

/**
 * Recolecta el dia de hoy si falta. Nunca lanza: devuelve un estado, porque
 * quien mas lo llama es el arranque de la app, y ahi una excepcion no
 * capturada seria una ventana que no abre por culpa de un dato accesorio.
 *
 *   estado 'yaEstaba' | 'guardado' | 'error'
 *
 * `ruta` e `instantanea` se pueden sustituir. No es un adorno: sin poder
 * inyectarlos, probar esta funcion exigiria red de verdad y escribiria sobre
 * la serie real, es decir, el test contaminaria justo el dataset que este
 * modulo existe para proteger.
 */
export async function recolectarDerivados({
  forzar = false,
  alProgresar = () => {},
  ruta = RUTA_DERIVADOS,
  instantanea = instantaneaDerivados,
  ...opc
} = {}) {
  const hoy = new Date().toISOString().slice(0, 10);

  let previo;
  try {
    if (ruta === RUTA_DERIVADOS) asegurarDirDatos();
    previo = leerHistorico(ruta);
  } catch (e) {
    return { estado: 'error', error: e.message, dia: hoy };
  }

  if (!forzar && yaHayRegistroHoy(previo.registros, hoy)) {
    return { estado: 'yaEstaba', dia: hoy, total: previo.registros.length };
  }

  let res;
  try {
    res = await conReintentos(() => instantanea(), { alProgresar, ...opc });
  } catch (e) {
    return { estado: 'error', error: e.message, dia: hoy, total: previo.registros.length };
  }

  /**
   * EL SELLO DE TIEMPO SE GARANTIZA AQUI, no se da por supuesto.
   *
   * Toda la idempotencia se apoya en `momento`: si un registro entra sin el,
   * yaHayRegistroHoy() deja de reconocerlo y ese dia se duplica en cada
   * arranque, sin limite y sin aviso. Confiar en que la instantanea siempre
   * lo traiga convierte un detalle del modulo de al lado en la garantia de
   * este; ponerlo aqui lo vuelve una invariante del historico.
   */
  const registro = {
    ...res.snap,
    momento: res.snap.momento ?? new Date().toISOString(),
    completo: res.q.completo,
    camposPresentes: res.q.presentes,
  };
  previo.registros.push(registro);
  previo.actualizado = new Date().toISOString();

  try {
    guardarAtomico(ruta, previo);
  } catch (e) {
    return { estado: 'error', error: 'no se pudo escribir: ' + e.message, dia: hoy };
  }

  return {
    estado: 'guardado',
    dia: hoy,
    registro,
    intento: res.intento,
    total: previo.registros.length,
  };
}

/** Salud de la serie. Es lo que un recolector desatendido necesita enseñar. */
export function saludSerie(historico) {
  const registros = historico.registros ?? [];
  const dias = new Set(registros.map((r) => diaDe(r.momento)).filter(Boolean));
  const parciales = registros.filter((r) => r.completo === false).length;

  let huecos = 0;
  const ordenados = [...dias].sort();
  for (let i = 1; i < ordenados.length; i++) {
    const d = (Date.parse(ordenados[i]) - Date.parse(ordenados[i - 1])) / 86400000;
    if (d > 1) huecos += d - 1;
  }

  return {
    registros: registros.length,
    dias: dias.size,
    parciales,
    huecos,
    desde: ordenados[0] ?? null,
    hasta: ordenados[ordenados.length - 1] ?? null,
  };
}
