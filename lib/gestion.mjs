/**
 * MODULO 12 - Gestion de la posicion abierta.
 *
 * De donde sale: el analisis de MFE/MAE de las 163 operaciones del backtest.
 *   - el 47,8% de las PERDEDORAS llegaron a estar en +0,50R antes de caer al stop
 *   - pero el 35,2% de las GANADORAS bajaron a -0,50R antes de acabar ganando
 *
 * Esas dos cifras juntas son la razon de que la gestion no se pueda decidir
 * "a ojo": cualquier regla que rescate perdedoras mata tambien ganadoras. La
 * unica pregunta valida es cual de los dos efectos pesa mas, y eso se simula.
 *
 * CUATRO REGLAS, todas opcionales y combinables:
 *
 *   BREAK-EVEN   mover el stop al precio de entrada cuando se alcanza N R.
 *                Convierte perdidas en empates... y ganadoras en empates.
 *
 *   TRAILING     arrastrar el stop a N ATR por detras del maximo favorable.
 *                Protege beneficio a cambio de salir antes de tiempo.
 *
 *   PARCIAL      cerrar una fraccion en N R y dejar correr el resto.
 *                Baja la varianza; baja tambien la ganancia media.
 *
 *   TIME STOP    cerrar si en N dias no ha pasado nada. El capital inmovilizado
 *                tiene coste de oportunidad aunque la operacion no pierda.
 *
 * IMPORTANTE: el orden de comprobacion dentro de cada vela es siempre el
 * mismo — primero lo que perjudica (stop), despues lo que beneficia. En una
 * vela que toca ambos no sabemos el orden real, y suponer lo favorable es
 * como se fabrican los backtests que brillan y luego pierden.
 */

/**
 * GESTION POR DEFECTO, elegida por medicion y no por intuicion.
 * Cierre parcial del 50% en +1R: mantiene la expectativa (+0,127R frente a
 * +0,129R sin gestion) y reduce el drawdown maximo de -12,5R a -7,9R, un 37%
 * menos. Es la unica variante probada que mejora algo sin pagar por ello.
 *
 * Descartadas y por que:
 *   break-even en +0,5R  el acierto cae del 43,6% al 22,1%. El 35% de las
 *                        ganadoras pasan por -0,5R antes de girar.
 *   parcial + break-even sube el acierto al 55,4% y BAJA la expectativa a
 *                        +0,098R. Mas aciertos, menos dinero.
 *   time stop            empeora en todas las duraciones probadas.
 */
export const GESTION_POR_DEFECTO = {
  breakEvenEnR: null,
  trailingATR: null,
  parcial: { enR: 1.0, fraccion: 0.5 },
  timeStopDias: null,
};

export const SIN_GESTION = {
  breakEvenEnR: null,
  trailingATR: null,
  parcial: null,      // { enR: 1.0, fraccion: 0.5 }
  timeStopDias: null,
};

/**
 * Simula una operacion vela a vela aplicando las reglas de gestion.
 *
 * `op` necesita: direccion, entrada, stop, objetivo, atr.
 * Devuelve el resultado en unidades de R BRUTAS (los costes se aplican fuera,
 * porque dependen del perfil y de si la salida fue maker o taker).
 */
export function simularConGestion(velas, desdeMs, op, maxMs, gestion = SIN_GESTION) {
  const esLargo = op.direccion === 'alcista';
  const riesgo = Math.abs(op.entrada - op.stop);
  if (riesgo === 0) return null;

  /** Beneficio en R en un precio dado. */
  const enR = (p) => (esLargo ? p - op.entrada : op.entrada - p) / riesgo;

  let stopActual = op.stop;
  let mfeR = 0, maeR = 0;
  let cerradoParcial = null;   // { fraccion, enR }
  let movidoABreakEven = false;

  for (const v of velas) {
    if (v.t < desdeMs) continue;

    const vencido = v.t - desdeMs > maxMs
      || (gestion.timeStopDias !== null && v.t - desdeMs > gestion.timeStopDias * 86400000);
    if (vencido) {
      return cerrar('tiempo', v.c, v.t);
    }

    const favorable = enR(esLargo ? v.h : v.l);
    const adverso = enR(esLargo ? v.l : v.h);
    if (favorable > mfeR) mfeR = favorable;
    if (adverso < maeR) maeR = adverso;

    // --- 1. Lo que perjudica primero: el stop vigente ---
    const tocaStop = esLargo ? v.l <= stopActual : v.h >= stopActual;
    if (tocaStop) return cerrar(movidoABreakEven ? 'break-even' : 'stop', stopActual, v.t);

    // --- 2. Objetivo ---
    const tocaObjetivo = esLargo ? v.h >= op.objetivo : v.l <= op.objetivo;
    if (tocaObjetivo) return cerrar('objetivo', op.objetivo, v.t);

    // --- 3. Cierre parcial ---
    if (gestion.parcial && !cerradoParcial) {
      const precioParcial = esLargo
        ? op.entrada + riesgo * gestion.parcial.enR
        : op.entrada - riesgo * gestion.parcial.enR;
      const alcanzado = esLargo ? v.h >= precioParcial : v.l <= precioParcial;
      if (alcanzado) {
        cerradoParcial = { fraccion: gestion.parcial.fraccion, enR: gestion.parcial.enR };
      }
    }

    // --- 4. Break-even: solo despues de comprobar stop y objetivo ---
    if (gestion.breakEvenEnR !== null && !movidoABreakEven && favorable >= gestion.breakEvenEnR) {
      stopActual = op.entrada;
      movidoABreakEven = true;
    }

    // --- 5. Trailing: nunca retrocede, solo se aprieta ---
    if (gestion.trailingATR !== null && op.atr) {
      const extremo = esLargo ? v.h : v.l;
      const nuevo = esLargo ? extremo - op.atr * gestion.trailingATR
                            : extremo + op.atr * gestion.trailingATR;
      if (esLargo ? nuevo > stopActual : nuevo < stopActual) stopActual = nuevo;
    }
  }

  return null; // sigue abierta al final de la serie

  function cerrar(motivo, precio, ms) {
    const rResto = enR(precio);
    // Con cierre parcial, el resultado es la media ponderada de las dos salidas.
    const r = cerradoParcial
      ? cerradoParcial.enR * cerradoParcial.fraccion + rResto * (1 - cerradoParcial.fraccion)
      : rResto;
    return {
      motivo, precioSalida: precio, cerradoEnMs: ms,
      resultadoRBruto: r, mfeR, maeR,
      huboParcial: !!cerradoParcial,
      stopFinal: stopActual,
    };
  }
}

/**
 * Catalogo de configuraciones a comparar. Cada una es una hipotesis distinta
 * sobre que hacer con una posicion abierta; el backtest decide.
 */
export const VARIANTES = [
  { nombre: 'sin gestion (referencia)', gestion: SIN_GESTION },
  { nombre: 'break-even en +0,5R', gestion: { ...SIN_GESTION, breakEvenEnR: 0.5 } },
  { nombre: 'break-even en +1,0R', gestion: { ...SIN_GESTION, breakEvenEnR: 1.0 } },
  { nombre: 'break-even en +1,5R', gestion: { ...SIN_GESTION, breakEvenEnR: 1.5 } },
  { nombre: 'trailing 2 ATR', gestion: { ...SIN_GESTION, trailingATR: 2 } },
  { nombre: 'trailing 3 ATR', gestion: { ...SIN_GESTION, trailingATR: 3 } },
  { nombre: 'parcial 50% en +1R', gestion: { ...SIN_GESTION, parcial: { enR: 1.0, fraccion: 0.5 } } },
  { nombre: 'parcial 50% en +1R + BE', gestion: { ...SIN_GESTION, parcial: { enR: 1.0, fraccion: 0.5 }, breakEvenEnR: 1.0 } },
  { nombre: 'time stop 10 dias', gestion: { ...SIN_GESTION, timeStopDias: 10 } },
  { nombre: 'time stop 5 dias', gestion: { ...SIN_GESTION, timeStopDias: 5 } },
];
