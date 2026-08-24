/**
 * MODULO 8 - Modelo de costes de Binance.
 *
 * POR QUE ES EL MODULO MAS IMPORTANTE DEL PROYECTO PARA OPERATIVA DIARIA:
 * en el escenario de 15m que seguimos, la comision se comia el 78% del
 * beneficio bruto del objetivo. Un R:R de 0,99:1 (acierto minimo 50%) pasaba
 * a 0,12:1 (acierto minimo 89%). Todo ratio calculado en bruto es ficcion.
 *
 * TRES COSTES, NO UNO:
 *   1. COMISION       porcentaje por operacion, distinto por producto y por
 *                     si pones liquidez (maker) o la quitas (taker)
 *   2. DESLIZAMIENTO  diferencia entre el precio que esperas y el que te dan
 *   3. FUNDING        solo en futuros perpetuos: pago cada 8 horas
 *
 * LA ASIMETRIA QUE CASI NADIE MODELA:
 * un objetivo se puede colocar como orden LIMIT, asi que paga tarifa maker.
 * Un stop, no: es una orden de mercado que se dispara sola, paga TAKER y
 * ademas desliza, justo en el momento de mayor movimiento. El coste de perder
 * es SIEMPRE mayor que el de ganar, y modelarlos iguales infla el resultado.
 *
 * Tarifas VIP0 verificadas en 2026. Cambian con el volumen y con BNB.
 */

export const PERFILES = {
  'spot': {
    nombre: 'Spot (VIP0, sin BNB)',
    comisionMaker: 0.0010,   // 0,1%
    comisionTaker: 0.0010,   // 0,1%
    deslizamiento: 0.0002,
    funding: null,           // el spot no paga funding
  },
  'spot-bnb': {
    nombre: 'Spot (VIP0, pagando con BNB, -25%)',
    comisionMaker: 0.00075,
    comisionTaker: 0.00075,
    deslizamiento: 0.0002,
    funding: null,
  },
  'futuros': {
    nombre: 'Futuros USD-M (VIP0, sin BNB)',
    comisionMaker: 0.0002,   // 0,02%
    comisionTaker: 0.0005,   // 0,05%
    deslizamiento: 0.0002,
    funding: 0.0001,         // 0,01% por periodo de 8h (tasa base)
  },
  'futuros-bnb': {
    nombre: 'Futuros USD-M (VIP0, pagando con BNB, -10%)',
    comisionMaker: 0.00018,
    comisionTaker: 0.00045,
    deslizamiento: 0.0002,
    funding: 0.0001,
  },
};

/**
 * Coste total de una operacion completa, en fraccion del precio de entrada.
 *
 * `entradaComoMaker`: si entras con orden LIMIT que espera a ser ejecutada
 * (maker) o cruzas el libro con MARKET (taker). Entrar como maker ahorra,
 * pero a cambio no garantiza que te ejecuten: el precio puede irse sin ti.
 * Es un coste real cambiado por otro riesgo real, no una mejora gratis.
 */
export function costesOperacion(perfil, { entradaComoMaker = false, horasEnPosicion = 0 } = {}) {
  const p = typeof perfil === 'string' ? PERFILES[perfil] : perfil;
  if (!p) throw new Error('Perfil de costes desconocido: ' + perfil);

  const entrada = entradaComoMaker ? p.comisionMaker : p.comisionTaker;

  // Salir en objetivo: orden LIMIT colocada de antemano -> maker.
  const salidaTP = p.comisionMaker;

  // Salir en stop: orden de mercado disparada automaticamente -> taker,
  // y ademas desliza. Es el peor momento posible para cruzar el libro.
  const salidaSL = p.comisionTaker + p.deslizamiento;

  /**
   * Funding: solo cuenta si la posicion esta abierta en el instante exacto de
   * liquidacion (00:00, 08:00 y 16:00 UTC). Una operacion de 2 minutos que
   * cruce las 08:00 paga un periodo entero; una de 7 horas que no cruce
   * ninguno, cero. Aqui se estima por duracion, que es el promedio razonable
   * sin saber la hora concreta de apertura.
   */
  const periodos = p.funding ? Math.floor(horasEnPosicion / 8) : 0;
  const costeFunding = p.funding ? periodos * p.funding : 0;

  return {
    perfil: p.nombre,
    entrada,
    salidaTP,
    salidaSL,
    funding: costeFunding,
    periodosFunding: periodos,
    // Coste total segun como acabe la operacion.
    totalSiGana: entrada + salidaTP + costeFunding,
    totalSiPierde: entrada + salidaSL + costeFunding,
    // El deslizamiento tambien afecta a la entrada si es a mercado.
    deslizamientoEntrada: entradaComoMaker ? 0 : p.deslizamiento,
  };
}

/**
 * Convierte un escenario bruto (entrada, stop, objetivo) en sus cifras NETAS.
 * Esta es la unica version de un R:R que significa algo para quien opera.
 */
export function escenarioNeto(entrada, stop, objetivo, perfil, opciones = {}) {
  const c = costesOperacion(perfil, opciones);
  const esLargo = objetivo > entrada;

  const brutoGanancia = Math.abs(objetivo - entrada) / entrada;
  const brutoPerdida = Math.abs(entrada - stop) / entrada;

  // El deslizamiento de entrada empeora las dos ramas por igual.
  const netoGanancia = brutoGanancia - c.totalSiGana - c.deslizamientoEntrada;
  const netoPerdida = brutoPerdida + c.totalSiPierde + c.deslizamientoEntrada;

  const rrBruto = brutoPerdida > 0 ? brutoGanancia / brutoPerdida : 0;
  const rrNeto = netoPerdida > 0 ? netoGanancia / netoPerdida : 0;

  return {
    esLargo,
    costes: c,
    brutoGananciaPct: brutoGanancia * 100,
    brutoPerdidaPct: brutoPerdida * 100,
    netoGananciaPct: netoGanancia * 100,
    netoPerdidaPct: netoPerdida * 100,
    rrBruto: Number(rrBruto.toFixed(3)),
    rrNeto: Number(rrNeto.toFixed(3)),
    winRateMinimoBruto: rrBruto > 0 ? 100 / (1 + rrBruto) : 100,
    winRateMinimoNeto: rrNeto > 0 ? 100 / (1 + rrNeto) : 100,
    // Que fraccion del beneficio bruto se lleva el coste.
    mordidaPct: brutoGanancia > 0 ? ((brutoGanancia - netoGanancia) / brutoGanancia) * 100 : 100,
    // Si el objetivo no cubre ni los costes, la operacion pierde aunque acierte.
    viable: netoGanancia > 0,
  };
}

/**
 * Recorrido minimo (en fraccion del precio) para que los costes no se coman
 * mas de `mordidaMaxima` del beneficio bruto. Sirve para descartar horizontes
 * enteros: si el ATR de una temporalidad no llega a este numero, esa
 * temporalidad no da para operar con este perfil de costes, y no hay
 * indicador que lo arregle.
 */
export function recorridoMinimo(perfil, mordidaMaxima = 0.2, opciones = {}) {
  const c = costesOperacion(perfil, opciones);
  return (c.totalSiGana + c.deslizamientoEntrada) / mordidaMaxima;
}

/** Expectativa neta por operacion, en unidades de riesgo (R). */
export function expectativaNeta(rrNeto, tasaAcierto) {
  return tasaAcierto * rrNeto - (1 - tasaAcierto);
}
