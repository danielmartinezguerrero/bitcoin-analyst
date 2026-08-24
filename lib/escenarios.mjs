/**
 * MODULO 5 - Escenarios operativos.
 *
 * Construye escenarios CONDICIONALES a partir de la estructura del grafico:
 * donde estaria la invalidacion tecnica (stop), donde estan los objetivos
 * tecnicos (take profit), y que relacion riesgo/recorrido resulta.
 *
 * QUE ES Y QUE NO ES ESTE MODULO
 * Es una descripcion geometrica: "si alguien operara este escenario, la
 * estructura se romperia en X y las siguientes zonas estan en Y y Z".
 * No es una recomendacion de inversion: no sabe nada de quien lo lee, ni de
 * su capital, ni de su horizonte, y no afirma que el escenario vaya a ocurrir.
 *
 * TRES DECISIONES DE DISENO, TODAS CON FUNDAMENTO:
 *
 * 1. STOP HIBRIDO (estructura + suelo de ATR). La estructura dice donde deja
 *    de ser valida la lectura; el suelo de ATR impide que el stop quede tan
 *    pegado que lo barra el ruido normal del mercado. Los backtests publicados
 *    muestran que el stop puramente fijo consigue el mejor ratio y la PEOR
 *    tasa de acierto, justo por quedarse dentro del ruido.
 *
 * 2. SIEMPRE SE CONSTRUYEN LAS DOS DIRECCIONES. Generar solo el escenario que
 *    coincide con el sesgo dominante es sesgo de confirmacion instalado en el
 *    codigo. Se construyen los dos y se etiqueta cual va a favor y cual en
 *    contra de la estructura.
 *
 * 3. CADA OBJETIVO LLEVA SU TASA DE ACIERTO DE EQUILIBRIO. Un R:R de 3:1 no
 *    significa nada por si solo: con menos de un 25% de aciertos pierde dinero
 *    igual. La formula es winRateMinimo = 1 / (1 + R). Mostrar el R:R sin ese
 *    umbral al lado es la forma mas comun de enganarse con un grafico.
 */

import { escenarioNeto } from './costes.mjs';

/** Colchon mas alla del nivel estructural, en ATR. */
const COLCHON_ATR = 0.25;
/** Distancia minima del stop al precio, en ATR: por debajo es ruido. */
const SUELO_ATR = 1.0;
/** Por encima de esto el stop es tan amplio que el escenario pierde sentido. */
const TECHO_ATR = 4.0;

/**
 * Tasa de acierto minima para que un escenario con ratio R no pierda dinero.
 *   winRate * R = (1 - winRate) * 1   ->   winRate = 1 / (1 + R)
 * Es aritmetica de expectativa, no una estimacion ni una prediccion.
 */
export function winRateDeEquilibrio(rr) {
  return rr <= 0 ? 1 : 1 / (1 + rr);
}

/**
 * Expectativa por operacion en unidades de riesgo (R), dada una tasa de
 * acierto hipotetica. Positiva = ventaja; negativa = perdida a largo plazo.
 *   E = (p * R) - ((1 - p) * 1)
 */
export function expectativa(rr, tasaAcierto) {
  return tasaAcierto * rr - (1 - tasaAcierto) * 1;
}

/**
 * Situa la invalidacion combinando estructura y volatilidad.
 * Devuelve tambien EN QUE se baso, para que la cifra sea auditable.
 */
function calcularInvalidacion(direccion, precio, atr, nivelEstructural) {
  const esLargo = direccion === 'alcista';
  let base = 'estructura';
  let precioStop;

  if (nivelEstructural) {
    // Un colchon mas alla del nivel: los barridos suelen perforarlo
    // ligeramente antes de girar.
    precioStop = esLargo
      ? nivelEstructural.precio - atr * COLCHON_ATR
      : nivelEstructural.precio + atr * COLCHON_ATR;
  } else {
    // Sin referencia estructural, solo queda la volatilidad.
    precioStop = esLargo ? precio - atr * 1.5 : precio + atr * 1.5;
    base = 'volatilidad (sin nivel estructural en la ventana)';
  }

  // SUELO: si la estructura deja el stop dentro del ruido de una vela, se
  // aleja hasta 1 ATR. Un stop a 0,3 ATR salta por el movimiento normal del
  // dia, no porque la lectura fuera incorrecta.
  const distancia = Math.abs(precio - precioStop);
  if (distancia < atr * SUELO_ATR) {
    precioStop = esLargo ? precio - atr * SUELO_ATR : precio + atr * SUELO_ATR;
    base = 'suelo de 1 ATR (la estructura quedaba dentro del ruido)';
  }

  return {
    precio: precioStop,
    base,
    nivelOrigen: nivelEstructural ? nivelEstructural.precio : null,
    distanciaATR: Number((Math.abs(precio - precioStop) / atr).toFixed(2)),
    distanciaPct: Number((((precioStop - precio) / precio) * 100).toFixed(2)),
  };
}

/**
 * Objetivos tecnicos: las siguientes zonas en la direccion del movimiento.
 * Si no hay ninguna (descubrimiento de precio), se proyecta por multiplos de
 * ATR y se etiqueta claramente como proyeccion, no como nivel observado.
 */
function calcularObjetivos(direccion, precio, atr, niveles, riesgo, costes = null) {
  const esLargo = direccion === 'alcista';
  const enDireccion = niveles
    .filter((n) => (esLargo ? n.precio > precio : n.precio < precio))
    .sort((a, b) => (esLargo ? a.precio - b.precio : b.precio - a.precio))
    .slice(0, 3);

  const construir = (precioObjetivo, origen, fuerza = null) => {
    const recorrido = Math.abs(precioObjetivo - precio);
    // Se redondea PRIMERO y todo lo demas se deriva del valor redondeado.
    // Si publicaramos rr=1.71 pero calcularamos el umbral con 1.714285...,
    // quien rehiciera la cuenta a mano no obtendria nuestra cifra. Cada
    // numero del dossier tiene que poder reproducirse desde los que se ven.
    const rr = Number((riesgo > 0 ? recorrido / riesgo : 0).toFixed(2));
    const wr = winRateDeEquilibrio(rr);

    /**
     * CIFRAS NETAS. El R:R bruto es una propiedad del grafico; el neto es lo
     * unico que describe la operacion real. En horizontes cortos la diferencia
     * no es un matiz: un 0,99:1 bruto puede ser 0,12:1 neto.
     */
    const stopImplicito = esLargo ? precio - riesgo : precio + riesgo;
    const neto = costes
      ? escenarioNeto(precio, stopImplicito, precioObjetivo, costes.perfil, costes.opciones)
      : null;

    return {
      precio: precioObjetivo,
      origen,
      fuerzaDelNivel: fuerza,
      distanciaATR: Number((recorrido / atr).toFixed(2)),
      distanciaPct: Number((((precioObjetivo - precio) / precio) * 100).toFixed(2)),
      rr,
      winRateMinimoPct: Number((wr * 100).toFixed(1)),
      // Expectativa si el sistema acertara la mitad de las veces. Es un
      // supuesto ILUSTRATIVO: no hemos medido la tasa real de este sistema.
      expectativaSi50Pct: Number(expectativa(rr, 0.5).toFixed(2)),
      rrNeto: neto ? neto.rrNeto : null,
      winRateMinimoNetoPct: neto ? Number(neto.winRateMinimoNeto.toFixed(1)) : null,
      mordidaCostesPct: neto ? Number(neto.mordidaPct.toFixed(1)) : null,
      viable: neto ? neto.viable : null,
    };
  };

  if (enDireccion.length) {
    return enDireccion.map((n) =>
      construir(n.precio, 'zona de ' + n.toques + ' toques', n.fuerza)
    );
  }

  return [1.5, 2.5, 4].map((mult) =>
    construir(
      esLargo ? precio + atr * mult : precio - atr * mult,
      'proyeccion por volatilidad (' + mult + ' ATR) — sin nivel historico en la ventana',
      null
    )
  );
}

/**
 * Construye el escenario de una direccion.
 * `niveles` es la lista completa de zonas de la temporalidad de referencia.
 */
export function construirEscenario(direccion, precio, atr, niveles, sesgoDominante, costes = null) {
  const esLargo = direccion === 'alcista';

  // El nivel estructural relevante esta al otro lado del movimiento: para un
  // escenario alcista, el soporte que lo sostiene; para uno bajista, la
  // resistencia que lo tapa.
  const soporte = niveles
    .filter((n) => n.precio < precio)
    .sort((a, b) => b.precio - a.precio)[0] ?? null;
  const resistencia = niveles
    .filter((n) => n.precio > precio)
    .sort((a, b) => a.precio - b.precio)[0] ?? null;

  const invalidacion = calcularInvalidacion(direccion, precio, atr, esLargo ? soporte : resistencia);
  const riesgo = Math.abs(precio - invalidacion.precio);
  const objetivos = calcularObjetivos(direccion, precio, atr, niveles, riesgo, costes);

  const advertencias = [];

  if (invalidacion.distanciaATR > TECHO_ATR) {
    advertencias.push('La invalidacion queda a ' + invalidacion.distanciaATR
      + ' ATR: es un riesgo muy amplio para este grafico, y arrastra el ratio a la baja.');
  }
  if (invalidacion.base.startsWith('suelo')) {
    advertencias.push('El nivel estructural quedaba dentro del ruido de una vela; '
      + 'la invalidacion se alejo hasta 1 ATR. No coincide con un nivel del grafico.');
  }
  if (objetivos[0] && objetivos[0].origen.startsWith('proyeccion')) {
    advertencias.push('No hay zonas historicas en esa direccion dentro de la ventana: '
      + 'los objetivos son proyecciones de volatilidad, no niveles observados.');
  }
  if (objetivos[0] && objetivos[0].rr < 1) {
    advertencias.push('El primer objetivo esta mas cerca que la invalidacion (R:R menor que 1): '
      + 'habria que acertar mas de la mitad de las veces solo para no perder.');
  }

  const alineado =
    (esLargo && sesgoDominante > 0) || (!esLargo && sesgoDominante < 0);

  if (!alineado) {
    advertencias.push('Este escenario va EN CONTRA del sesgo tecnico agregado. '
      + 'Se incluye para no mirar solo el lado que confirma la lectura.');
  }

  return {
    direccion,
    alineadoConSesgo: alineado,
    precioReferencia: precio,
    invalidacion,
    riesgoUnitario: Number(riesgo.toFixed(2)),
    riesgoATR: Number((riesgo / atr).toFixed(2)),
    objetivos,
    advertencias,
    /**
     * La condicion que tendria que cumplirse para considerar el escenario
     * vigente. Sin activacion, un escenario es solo geometria sobre el
     * grafico: no describe nada que este ocurriendo.
     */
    activacion: esLargo
      ? 'Cierre confirmado por encima de ' + precio.toFixed(0)
        + ' manteniendose sobre ' + invalidacion.precio.toFixed(0) + '.'
      : 'Cierre confirmado por debajo de ' + precio.toFixed(0)
        + ' manteniendose bajo ' + invalidacion.precio.toFixed(0) + '.',
  };
}

/** Construye los dos escenarios y los devuelve juntos, nunca uno solo. */
export function construirEscenarios(analisisRef, sintesis, costes = null) {
  const precio = analisisRef.precio;
  const atr = analisisRef.indicadores.atr14;
  const niveles = [
    ...analisisRef.niveles.resistencias,
    ...analisisRef.niveles.soportes,
  ];

  return {
    temporalidad: analisisRef.temporalidad,
    precio,
    atr,
    escenarios: [
      construirEscenario('alcista', precio, atr, niveles, sintesis.puntuacion, costes),
      construirEscenario('bajista', precio, atr, niveles, sintesis.puntuacion, costes),
    ],
    /**
     * EL LIMITE MAS IMPORTANTE DE TODO ESTE MODULO.
     * Los ratios y los umbrales de equilibrio son aritmetica exacta. Pero si
     * este sistema alcanza esos umbrales en la practica NO SE HA MEDIDO: hace
     * falta la validacion estadistica sobre historico. Hasta entonces, un R:R
     * de 3:1 dice cuanto se arriesga por cuanto se busca, y nada mas.
     */
    limitacion: 'Los umbrales de acierto son matematicos, no empiricos. La tasa de '
      + 'acierto real de estos escenarios no ha sido medida sobre historico todavia.',
  };
}
