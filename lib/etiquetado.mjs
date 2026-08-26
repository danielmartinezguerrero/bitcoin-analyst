/**
 * MODULO 12 - Etiquetado de triple barrera y matriz de caracteristicas.
 *
 * PARA QUE: convertir una serie de velas en un problema de clasificacion
 * supervisada, para poder preguntar si un modelo APRENDIDO encuentra algo
 * que las reglas escritas a mano no encuentran. La respuesta esperada es que
 * no; el objetivo es medirlo, no ganarlo.
 *
 * POR QUE POR VELA Y NO POR OPERACION: el backtest produce 163 operaciones,
 * que es muy poco para ajustar nada. Pero esas 163 son el resultado de
 * FILTRAR: primero se exige tendencia, luego alineacion, luego criterios de
 * seleccion. La pregunta "desde este punto, sube 1 ATR antes de bajar 1 ATR?"
 * se puede hacer en TODAS las velas, y ahi hay decenas de miles. El filtro es
 * precisamente lo que queremos poner a prueba, asi que no puede formar parte
 * del etiquetado.
 *
 * LO QUE ESTE MODULO NO HACE: mirar al futuro para construir una
 * caracteristica. Cada fila usa exclusivamente informacion disponible al
 * cierre de su vela; el futuro solo entra en la ETIQUETA, que es lo que se
 * intenta predecir. Hay un test dedicado a esto porque es el error que
 * invalida silenciosamente cualquier resultado.
 */
import { ema, rsi, macd, atr, volumenRelativo } from './indicadores.mjs';
import { efficiencyRatio, percentil } from './regimen.mjs';

/**
 * BARRERAS SIMETRICAS A 1 ATR y horizonte de 28 velas de 4h.
 *
 * Las dos constantes salen del sistema que ya existe, no de una busqueda:
 * 1 ATR es el orden de magnitud del riesgo que usa la seleccion diaria
 * (riesgoMaximoATR va hasta 3, con stops tipicos por debajo), y 28 velas de
 * 4h son 4,7 dias, la mediana de retencion medida en el backtest.
 *
 * Elegirlas mirando cual da mejor resultado seria exactamente el p-hacking
 * que el resto del proyecto se niega a hacer.
 */
export const ETIQUETADO_POR_DEFECTO = {
  barreraATR: 1.0,
  maxVelas: 28,
  periodoATR: 14,
};

/** Nombres de las caracteristicas, en el mismo orden que las columnas de X. */
export const CARACTERISTICAS = [
  'distEMA200',    // (cierre - EMA200) / ATR
  'distEMA50',     // (cierre - EMA50)  / ATR
  'cruceEMA',      // (EMA50 - EMA200)  / ATR
  'rsi',           // RSI(14) / 100
  'macdHist',      // histograma MACD / ATR
  'er',            // Efficiency Ratio de Kaufman, 20 periodos
  'volPercentil',  // percentil del ATR en las ultimas 250 velas
  'posEnRango',    // posicion del cierre en el rango de las ultimas 60 velas
  'volRelativo',   // volumen / media de 20
];

/**
 * TODO NORMALIZADO POR ATR, no en dolares.
 *
 * La serie va de 4.000 a 100.000 USDT. Una caracteristica como "cierre menos
 * EMA200" vale 200 en 2018 y 4.000 en 2025 para el MISMO estado tecnico: el
 * modelo aprenderia a distinguir epocas, no situaciones. Dividir por ATR
 * convierte la distancia en "cuantas sesiones tipicas de movimiento", que es
 * comparable entre regimenes y entre anos.
 */
export function construirCaracteristicas(velas, opciones = {}) {
  const opc = { ...ETIQUETADO_POR_DEFECTO, ...opciones };
  const cierres = velas.map((v) => v.c);
  const volumenes = velas.map((v) => v.v);

  const e50 = ema(cierres, 50);
  const e200 = ema(cierres, 200);
  const r14 = rsi(cierres, 14);
  const m = macd(cierres);
  const serieATR = atr(velas, opc.periodoATR);
  const volRel = volumenRelativo(volumenes, 20);

  const filas = new Array(velas.length).fill(null);

  for (let i = 0; i < velas.length; i++) {
    const a = serieATR[i];
    // Sin ATR no hay forma de normalizar, y sin EMA200 no hay contexto mayor.
    if (!a || a <= 0 || e200[i] === null || e50[i] === null) continue;
    if (r14[i] === null || m.histograma[i] === null || volRel[i] === null) continue;
    if (i < 250) continue;   // percentil de volatilidad necesita ventana

    /**
     * VENTANAS RECORTADAS, NO LA SERIE ENTERA.
     *
     * percentil() y efficiencyRatio() reciben solo su ventana. Pasarles la
     * serie completa daria el mismo numero (ambas se quedan con la cola),
     * pero recorren todo el array en cada vela: con 19.752 velas eso es
     * cuadratico y el script tarda minutos en lugar de segundos.
     */
    const er = efficiencyRatio(cierres.slice(i - 20, i + 1), 20).valor;
    const volPct = percentil(serieATR.slice(i - 249, i + 1), 250);
    if (er === null || volPct === null) continue;

    const ventana60 = velas.slice(i - 59, i + 1);
    const min60 = Math.min(...ventana60.map((v) => v.l));
    const max60 = Math.max(...ventana60.map((v) => v.h));
    const rango = max60 - min60;

    filas[i] = [
      (velas[i].c - e200[i]) / a,
      (velas[i].c - e50[i]) / a,
      (e50[i] - e200[i]) / a,
      r14[i] / 100,
      m.histograma[i] / a,
      er,
      volPct,
      rango > 0 ? (velas[i].c - min60) / rango : 0.5,
      volRel[i],
    ];
  }

  return filas;
}

/**
 * PUNTUACION DE LAS REGLAS ESCRITAS A MANO, sobre las mismas caracteristicas.
 *
 * Es el rival del modelo. Sin esta linea base el experimento no responde a
 * nada: un AUC de 0,53 no significa nada en abstracto, solo comparado con lo
 * que ya consigue el sistema que tienes. Son tres de las cuatro senales
 * direccionales de analisis.mjs; la cuarta (estructura de pivotes) se queda
 * fuera porque necesita recalcular pivotes vela a vela y no aporta al
 * contraste.
 */
export function puntuacionReglas(fila) {
  const [distEMA200, , cruceEMA, , macdHist] = fila;
  return Math.sign(distEMA200) + Math.sign(cruceEMA) + Math.sign(macdHist);
}

/**
 * ETIQUETA DE TRIPLE BARRERA.
 *
 * Desde el cierre de la vela i, se mira hacia adelante hasta maxVelas velas:
 *
 *   1  el precio toca +barreraATR antes que -barreraATR
 *   0  toca -barreraATR primero
 *   null  no toca ninguna dentro del horizonte (se descarta y se cuenta)
 *
 * EL STOP GANA LOS EMPATES, igual que en backtest.mjs: si una misma vela toca
 * las dos barreras, con datos de vela no se puede saber cual llego primero, y
 * suponer la favorable es como se inflan los backtests. Se comprueba la
 * barrera inferior antes que la superior, asi que el empate cuenta como 0.
 *
 * Los tiempos de espera se DESCARTAN en lugar de contarse como perdida: son
 * un suceso distinto ("no paso nada") y meterlos en la clase 0 mezclaria
 * "bajo" con "se quedo quieto", que no es lo que se quiere predecir. Cuantos
 * hubo se reporta, porque descartar en silencio es media verdad.
 */
export function etiquetarTripleBarrera(velas, serieATR, opciones = {}) {
  const opc = { ...ETIQUETADO_POR_DEFECTO, ...opciones };
  const etiquetas = new Array(velas.length).fill(null);
  let expirados = 0;

  for (let i = 0; i < velas.length; i++) {
    const a = serieATR[i];
    if (!a || a <= 0) continue;

    const entrada = velas[i].c;
    const arriba = entrada + opc.barreraATR * a;
    const abajo = entrada - opc.barreraATR * a;
    const hasta = Math.min(i + opc.maxVelas, velas.length - 1);

    // Horizonte incompleto al final de la serie: no se puede etiquetar.
    if (i + opc.maxVelas > velas.length - 1) continue;

    let resultado = null;
    for (let j = i + 1; j <= hasta; j++) {
      if (velas[j].l <= abajo) { resultado = 0; break; }
      if (velas[j].h >= arriba) { resultado = 1; break; }
    }

    if (resultado === null) expirados++;
    else etiquetas[i] = resultado;
  }

  return { etiquetas, expirados };
}

/**
 * Une caracteristicas y etiquetas en un dataset utilizable, descartando las
 * filas incompletas. Devuelve tambien el indice original y la fecha de cada
 * fila: sin eso no se puede particionar por tiempo ni purgar solapamientos.
 */
export function construirDataset(velas, opciones = {}) {
  const opc = { ...ETIQUETADO_POR_DEFECTO, ...opciones };
  const serieATR = atr(velas, opc.periodoATR);
  const filas = construirCaracteristicas(velas, opc);
  const { etiquetas, expirados } = etiquetarTripleBarrera(velas, serieATR, opc);

  const X = [], y = [], t = [], fechas = [], reglas = [];
  for (let i = 0; i < velas.length; i++) {
    if (filas[i] === null || etiquetas[i] === null) continue;
    if (filas[i].some((v) => !Number.isFinite(v))) continue;
    X.push(filas[i]);
    y.push(etiquetas[i]);
    t.push(velas[i].t);
    fechas.push(velas[i].fecha);
    reglas.push(puntuacionReglas(filas[i]));
  }

  return {
    X, y, t, fechas, reglas,
    caracteristicas: CARACTERISTICAS,
    expirados,
    /** Velas que el horizonte de la etiqueta abarca. Lo necesita el purgado. */
    solapamiento: opc.maxVelas,
  };
}
