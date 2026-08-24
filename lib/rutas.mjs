/**
 * Rutas ancladas a la RAIZ DEL PROYECTO, no al directorio de trabajo.
 *
 * Sin esto, `node scripts/analizar.mjs` funciona desde la carpeta del
 * proyecto y falla desde cualquier otra, porque 'data/ohlcv.json' se
 * resuelve contra process.cwd(). En cuanto el programa se instala como
 * comando global (`npm link`) y se lanza desde el escritorio, deja de
 * encontrar sus propios datos.
 *
 * import.meta.dirname da la carpeta de ESTE archivo (lib/), asi que la
 * raiz es su padre. La ruta ya no depende de desde donde se invoque.
 */
import { join, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

export const RAIZ = dirname(import.meta.dirname);
export const DIR_DATOS = join(RAIZ, 'data');

export const RUTA_OHLCV = join(DIR_DATOS, 'ohlcv.json');
export const RUTA_DOSSIER = join(DIR_DATOS, 'dossier.json');
export const DIR_HISTORICO = join(DIR_DATOS, 'historico');
export const RUTA_LARGO_PLAZO = join(DIR_DATOS, 'ohlcv-largo.json');

/** Crea data/ si no existe. Idempotente. */
export function asegurarDirDatos() {
  mkdirSync(DIR_DATOS, { recursive: true });
}

/** Crea data/historico/ si no existe. Idempotente. */
export function asegurarDirHistorico() {
  mkdirSync(DIR_HISTORICO, { recursive: true });
}

/**
 * Nombre de archivo a partir de una fecha ISO, apto para Windows.
 * Los dos puntos de "12:56" son ilegales en nombres de fichero en NTFS,
 * asi que se sustituyen por guiones. El orden ano-mes-dia-hora hace que
 * el listado alfabetico coincida con el cronologico.
 */
export function nombreHistorico(fechaISO) {
  return fechaISO.slice(0, 16).replace(/:/g, '-') + '.json';
}
