/**
 * MODULO DE FRESCURA. Cuanto vale un fichero de velas antes de caducar, y
 * cual es el precio de mercado ahora mismo.
 *
 * POR QUE EXISTE: analizar.mjs y operacion-del-dia.mjs decidian si descargar
 * con `if (--refrescar || !existsSync(ruta))`. Sin la bandera, un ohlcv.json
 * escrito hace una semana se reutilizaba entero: el programa no hacia una
 * sola peticion y sacaba el mismo dossier indefinidamente. La antiguedad se
 * calculaba, pero solo para avisar DESPUES de haber calculado todo sobre
 * datos viejos, que es avisar cuando ya no sirve de nada.
 *
 * Este modulo es el equivalente en lib/ de lo que en la app de escritorio
 * vive en BitcoinAnalyzer/core/data.mjs. Los dos motores son copias
 * paralelas; el arreglo tiene que estar en ambos o vuelve por el otro lado.
 */

const SIMBOLO = 'BTCUSDT';

/**
 * Un fichero de velas solo vale hasta que rueda la temporalidad mas rapida.
 * Con 15m como serie mas corta, 15 minutos es el limite natural: pasado eso
 * hay al menos una vela cerrada que el fichero no contiene.
 */
export const MINUTOS_CACHE_VALIDA = 15;

export function antiguedadMinutos(datos) {
  if (!datos || !datos.generadoEn) return Infinity;
  return (Date.now() - new Date(datos.generadoEn).getTime()) / 60000;
}

export function estaObsoleto(datos, minutos = MINUTOS_CACHE_VALIDA) {
  return antiguedadMinutos(datos) > minutos;
}

/**
 * Precio de mercado, SOLO PARA MOSTRAR.
 *
 * El analisis trabaja a proposito con velas cerradas, asi que el precio con
 * el que razona es el ultimo cierre: dentro del mismo dia no se mueve. Sacar
 * unicamente ese numero por pantalla hacia parecer que el programa estaba
 * colgado. Este es la cotizacion real, impresa AL LADO de la de referencia y
 * nunca metida en el analisis.
 *
 * Devuelve null si falla: un precio decorativo no debe tumbar un dossier.
 */
export async function traerPrecioEnVivo() {
  try {
    const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${SIMBOLO}`,
      { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    return parseFloat((await r.json()).price);
  } catch { return null; }
}

/**
 * Cuando puede cambiar la lectura. Los dias UTC caen en fronteras exactas de
 * epoch, asi que el proximo cierre diario es la siguiente frontera.
 */
export function proximoCierreDiario() {
  return new Date(Math.ceil(Date.now() / 86400000) * 86400000).toISOString();
}
