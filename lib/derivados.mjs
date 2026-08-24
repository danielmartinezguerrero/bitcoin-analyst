/**
 * MODULO 13 - Datos de derivados de Binance.
 *
 * QUE HAY DISPONIBLE GRATIS Y CUANTO HISTORICO GUARDA CADA COSA:
 *
 *   funding rate            desde 2019   -> BACKTESTEABLE
 *   top trader long/short   31 dias      -> solo en vivo
 *   open interest           31 dias      -> solo en vivo
 *   taker buy/sell ratio    32 dias      -> solo en vivo
 *
 * Esa asimetria manda: el funding es el unico con historia suficiente para
 * validar nada. Los ratios de grandes traders hay que empezar a acumularlos
 * hoy para poder medirlos dentro de unos meses.
 *
 * QUE ES EL FUNDING: el pago que cada 8 horas se hacen largos y cortos del
 * perpetuo para que su precio no se separe del spot. Positivo = los largos
 * pagan a los cortos, o sea hay mas presion compradora apalancada. Es el
 * mejor proxy gratuito del posicionamiento con dinero prestado.
 *
 * COMO SE LEE: en extremos funciona como indicador CONTRARIO. Un funding muy
 * alto significa largos hacinados pagando por seguir dentro, y esas
 * situaciones preceden a cascadas de liquidacion. La literatura lo describe
 * asi de forma consistente, pero si eso mejora la expectativa de ESTE sistema
 * es una hipotesis que se mide en el backtest, no algo que se de por hecho.
 */

/** Percentil del ultimo valor dentro de la ventana, con empates repartidos. */
function percentilMedio(valores, actual) {
  const menores = valores.filter((x) => x < actual).length;
  const iguales = valores.filter((x) => x === actual).length;
  return (menores + iguales / 2) / valores.length;
}

/**
 * Estado del funding en un instante dado, usando SOLO registros anteriores.
 * `hastaMs` es obligatorio en backtest: sin el, se colaria informacion futura.
 */
export function estadoFunding(registros, hastaMs, ventana = 360) {
  const pasados = registros.filter((f) => f.t <= hastaMs);
  if (pasados.length < 30) return null;

  const actual = pasados[pasados.length - 1];
  const ventanaTasas = pasados.slice(-ventana).map((f) => f.tasa);
  const pct = percentilMedio(ventanaTasas, actual.tasa);

  // Media de los ultimos 3 periodos = un dia completo de funding.
  const ultimoDia = pasados.slice(-3).reduce((s, f) => s + f.tasa, 0) / 3;

  return {
    tasa: actual.tasa,
    tasaPct: actual.tasa * 100,
    fecha: actual.fecha,
    mediaDiaria: ultimoDia,
    percentil: Number(pct.toFixed(3)),
    /**
     * Extremos definidos por percentil, no por un valor fijo: la escala del
     * funding cambia entre epocas de euforia y de calma, y un umbral absoluto
     * envejeceria mal.
     */
    extremoAlcista: pct >= 0.9,   // largos hacinados
    extremoBajista: pct <= 0.1,   // cortos hacinados
    descripcion: pct >= 0.9
      ? 'Funding en el percentil ' + (pct * 100).toFixed(0) + ': largos apalancados hacinados, pagando por mantenerse.'
      : pct <= 0.1
      ? 'Funding en el percentil ' + (pct * 100).toFixed(0) + ': cortos hacinados, los largos cobran por estar dentro.'
      : 'Funding en el percentil ' + (pct * 100).toFixed(0) + ': posicionamiento apalancado sin extremos.',
  };
}

/**
 * Instantanea en vivo del posicionamiento. Sin historico backtesteable, asi
 * que sirve para informar al lector, NO para decidir de forma automatica.
 * Se recolecta cada dia para poder validarlo en el futuro.
 */
export async function instantaneaDerivados(simbolo = 'BTCUSDT') {
  const base = 'https://fapi.binance.com/futures/data/';
  const pedir = async (ruta) => {
    const r = await fetch(base + ruta + `?symbol=${simbolo}&period=5m&limit=1`,
      { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const d = await r.json();
    return d[0] ?? null;
  };

  const [posiciones, cuentas, global, oi, taker] = await Promise.all([
    pedir('topLongShortPositionRatio'),
    pedir('topLongShortAccountRatio'),
    pedir('globalLongShortAccountRatio'),
    pedir('openInterestHist'),
    pedir('takerlongshortRatio'),
  ]);

  const num = (x) => (x === undefined || x === null ? null : Number(x));

  return {
    momento: new Date().toISOString(),
    // Ponderado por TAMANO de posicion: es el que refleja donde esta el dinero.
    topPosiciones: num(posiciones?.longShortRatio),
    topCuentas: num(cuentas?.longShortRatio),
    todasLasCuentas: num(global?.longShortRatio),
    openInterestBTC: num(oi?.sumOpenInterest),
    openInterestUSD: num(oi?.sumOpenInterestValue),
    takerBuySell: num(taker?.buySellRatio),
    /**
     * La DIVERGENCIA es lo interesante: cuando los grandes por tamano y el
     * conjunto de cuentas minoristas apuntan a lados distintos. Un numero
     * suelto dice poco; la diferencia entre los dos dice quien esta al otro
     * lado de quien.
     */
    divergenciaGrandesVsMinorista:
      posiciones && global
        ? Number((num(posiciones.longShortRatio) - num(global.longShortRatio)).toFixed(3))
        : null,
  };
}
