/**
 * MODULO 11 - Deteccion de regimen de mercado.
 *
 * POR QUE: el backtest mostro que la expectativa de la estrategia NO es una
 * propiedad estable. Por anos: +0,28R en 2020 y -0,16R en 2021, 2022 y 2024.
 * El -0,03R agregado es el promedio de comportamientos opuestos, no un numero
 * que describa nada. Si la ventaja aparece y desaparece segun el estado del
 * mercado, detectar ese estado importa mas que cualquier indicador nuevo.
 *
 * QUE MIDE
 *
 *   EFFICIENCY RATIO (Kaufman, 1995)
 *     ER = |cambio neto en N barras| / suma de |cambios barra a barra|
 *
 *   Es una razon entre 0 y 1 con una lectura muy directa: cuanto del
 *   movimiento total se convirtio en avance real. Si el precio sube 100,
 *   baja 100 y vuelve a subir 100, el recorrido total es 300 y el neto 100:
 *   ER = 0,33. Si sube 100 de un tiron, ER = 1.
 *
 *   Frente al ADX tiene dos ventajas: no lleva retraso de suavizado, y no
 *   depende de ningun parametro mas que la ventana. Las fuentes consultadas
 *   lo describen como "puerta" (gate): los sistemas de tendencia solo operan
 *   mientras el ratio se mantiene por encima de un umbral.
 *
 *   PERCENTIL DE VOLATILIDAD
 *     donde cae el ATR actual dentro de su propia historia reciente.
 *   Un ATR de 2.000 USDT no dice nada por si mismo; que ese ATR este en el
 *   percentil 90 de su ultimo ano, si.
 *
 * LO QUE ESTE MODULO NO HACE: predecir. Describe el estado presente. Que ese
 * estado tenga valor para filtrar operaciones es una hipotesis que se mide
 * en el backtest, no algo que se da por hecho aqui.
 */

/**
 * Efficiency Ratio de Kaufman sobre los ultimos `periodo` cierres.
 * Devuelve { valor, direccion } — la direccion es el signo del cambio neto.
 */
export function efficiencyRatio(cierres, periodo = 20) {
  if (cierres.length < periodo + 1) return { valor: null, direccion: 0 };

  const ventana = cierres.slice(-(periodo + 1));
  const cambioNeto = ventana[ventana.length - 1] - ventana[0];

  let recorridoTotal = 0;
  for (let i = 1; i < ventana.length; i++) {
    recorridoTotal += Math.abs(ventana[i] - ventana[i - 1]);
  }

  // Sin movimiento no hay eficiencia que medir; 0 es la lectura honesta.
  if (recorridoTotal === 0) return { valor: 0, direccion: 0 };

  return {
    valor: Math.abs(cambioNeto) / recorridoTotal,
    direccion: Math.sign(cambioNeto),
    cambioNeto,
    recorridoTotal,
  };
}

/** Serie completa de ER, alineada con los cierres (null donde no hay datos). */
export function serieEfficiencyRatio(cierres, periodo = 20) {
  const salida = new Array(cierres.length).fill(null);
  for (let i = periodo; i < cierres.length; i++) {
    salida[i] = efficiencyRatio(cierres.slice(0, i + 1), periodo).valor;
  }
  return salida;
}

/**
 * Percentil del ultimo valor dentro de la ventana. 0 = el mas bajo de todos,
 * 1 = el mas alto. Es la forma de leer una magnitud sin escala fija.
 */
export function percentil(serie, ventana = 250) {
  const validos = serie.filter((x) => x !== null && x !== undefined).slice(-ventana);
  if (validos.length < 20) return null;
  const actual = validos[validos.length - 1];

  /**
   * PERCENTIL MEDIO (mid-rank): los empates cuentan la mitad.
   *
   * Contar solo los estrictamente menores rompe con valores repetidos: una
   * serie constante daria percentil 0 — es decir, "minimo historico" — cuando
   * en realidad no hay ni maximo ni minimo, todo es igual. En volatilidad eso
   * pasa de verdad: periodos largos de ATR practicamente identico existen, y
   * clasificarlos como volatilidad minima cambiaria el regimen detectado.
   * Repartir los empates devuelve 0,5 para una serie plana, que es la lectura
   * correcta.
   */
  const menores = validos.filter((x) => x < actual).length;
  const iguales = validos.filter((x) => x === actual).length;
  return (menores + iguales / 2) / validos.length;
}

/**
 * Umbrales de clasificacion. Explicitos y ajustables: su efecto real se mide
 * en el backtest, no se decide por intuicion.
 */
export const UMBRALES = {
  erTendencia: 0.35,   // por encima: el movimiento avanza de verdad
  erRango: 0.20,       // por debajo: el precio se mueve mucho y avanza poco
  volAlta: 0.80,       // percentil de ATR a partir del cual la vol es alta
  volBaja: 0.20,
  periodoER: 20,
  ventanaPercentil: 250,
};

/**
 * Clasifica el estado actual del mercado.
 *
 * Cuatro regimenes, y la distincion que importa: no es solo "tendencia si o
 * no", sino tambien si la volatilidad acompana. Una tendencia con volatilidad
 * en el percentil 95 se recorre en dias; la misma tendencia con volatilidad
 * en el percentil 10 tarda semanas, y los stops en ATR quedan diminutos.
 */
export function clasificarRegimen(velas, atrSerie, umbrales = UMBRALES) {
  const cierres = velas.map((v) => v.c);
  const er = efficiencyRatio(cierres, umbrales.periodoER);
  const volPct = percentil(atrSerie, umbrales.ventanaPercentil);

  if (er.valor === null) {
    return { tipo: 'indeterminado', motivo: 'Datos insuficientes para el Efficiency Ratio.' };
  }

  const esTendencia = er.valor >= umbrales.erTendencia;
  const esRango = er.valor < umbrales.erRango;
  const direccion = er.direccion > 0 ? 'alcista' : er.direccion < 0 ? 'bajista' : 'plana';

  let tipo, descripcion;
  if (esTendencia) {
    tipo = 'tendencia ' + direccion;
    descripcion = 'El precio convierte el ' + (er.valor * 100).toFixed(0)
      + '% de su recorrido en avance neto: se mueve en una direccion, no de ida y vuelta.';
  } else if (esRango) {
    tipo = 'rango';
    descripcion = 'Solo el ' + (er.valor * 100).toFixed(0)
      + '% del recorrido se convierte en avance: el precio se mueve mucho y llega poco.';
  } else {
    tipo = 'transicion';
    descripcion = 'Eficiencia intermedia (' + (er.valor * 100).toFixed(0)
      + '%): ni tendencia limpia ni rango claro.';
  }

  const volEstado =
    volPct === null ? 'desconocida'
    : volPct >= umbrales.volAlta ? 'alta'
    : volPct <= umbrales.volBaja ? 'baja'
    : 'normal';

  return {
    tipo,
    direccion,
    er: Number(er.valor.toFixed(3)),
    erUmbralTendencia: umbrales.erTendencia,
    volatilidadPercentil: volPct === null ? null : Number(volPct.toFixed(2)),
    volatilidadEstado: volEstado,
    esTendencia,
    esRango,
    descripcion,
    /**
     * `favorableParaTendencia` es la hipotesis a contrastar: que las
     * operaciones direccionales rinden mejor cuando el mercado avanza de
     * verdad. Se expone como campo para que el backtest pueda medirla,
     * no como una verdad asumida.
     */
    favorableParaTendencia: esTendencia,
  };
}
