/**
 * MODULO 4 - Motor de analysis. Funde indicators + structure y produce un
 * DOSSIER: el conjunto de hechos tecnicos medidos, con su desglose.
 *
 * PRINCIPIO RECTOR: nada de numeros magicos. Cada signal declara su reading,
 * su vote y su reason. El resultado final es la sum de votes visibles, no
 * una score out de una caja negra. Si el dossier dice "bias alcista
 * 62%", tiene que poderse reconstruir a mano a partir de la tabla de signals.
 *
 * LO QUE ESTE MODULO NO HACE: recomendar operar. Describe el estado tecnico,
 * su strength, y sobre todo la evidencia que lo contradice.
 */
import { ema, rsi, macd, atr, relativeVolume, last } from './indicators.mjs';
import { pivots, marketStructure, keyLevels, levelContext, rangePosition } from './structure.mjs';

/**
 * Peso de cada timeframe en el vote final.
 * El diario manda: sus signals tardan mas en formarse y mas en romperse.
 * El horario aporta timing, no direction. Ignorar esta jerarquia es la via
 * fast a operar ruido de 1h contra una trend diaria.
 */
/**
 * DIRECTIONAL WEIGHT per timeframe. Zero means the timeframe does not vote
 * on direction at all — it is still analysed and still shown, but only as
 * timing and momentum context.
 *
 * This used to read {1d:4, 4h:3, 1h:2, 15m:1}, which contradicted the comment
 * directly above it: the text said the hourly chart contributes timing and not
 * direction, and then the code let it push the headline. With a +3 vote the
 * hourly contributed as much as the 4h chart, so the noisiest timeframe moved
 * the verdict as hard as a real one — while the evidence AGAINST sat in 1d and
 * 4h, the ones that matter for a daily-referenced trade.
 *
 * Now only the daily and 4h vote. The shorter frames feed momentumCheck(),
 * where deterioration is what they are actually good at detecting.
 */
const WEIGHTS = { '1d': 4, '4h': 3, '1h': 0, '15m': 0 };

/** Analiza una timeframe y devuelve sus hechos medidos. */
export function analyzeTimeframe(serie) {
  // Solo candles CERRADAS: la viva repinta y cambiaria el dossier cada minuto.
  const candles = serie.lastIsOpen ? serie.candles.slice(0, -1) : serie.candles;
  const closes = candles.map((v) => v.c);
  const price = closes[closes.length - 1];

  const e20 = last(ema(closes, 20));
  const e50 = last(ema(closes, 50));
  const e200 = last(ema(closes, 200));
  const r14 = last(rsi(closes, 14));
  const m = macd(closes);
  const hist = last(m.histogram);
  const prevHist = m.histogram.filter((x) => x !== null).slice(-2)[0] ?? null;
  const atr14 = last(atr(candles, 14));
  const volRel = last(relativeVolume(candles.map((v) => v.v), 20));

  const p = pivots(candles, 5, 5);
  const est = marketStructure(p);
  const levels = keyLevels(candles, p, atr14, { toleranceATR: 0.5, maxLevels: 20, halfLife: 50 });
  const dias = Math.round((candles[candles.length - 1].t - candles[0].t) / 86400000);
  const ctx = levelContext(levels, price, 3, {
    bars: candles.length, dias,
    desde: candles[0].date.slice(0, 10),
    maximum: Math.max(...candles.map((v) => v.h)),
  });
  const range = rangePosition(candles, 60);

  /**
   * SENALES DIRECCIONALES. Cuatro, deliberadamente pocas y poco solapadas.
   * Meter quince indicators que miden lo mismo no aporta informacion: solo
   * multiplica la misma signal y produce una falsa sensacion de confluencia.
   */
  const signals = [
    {
      name: 'Pivot structure',
      reading: est.trend,
      vote: est.trend === 'bullish' ? 1 : est.trend === 'bearish' ? -1 : 0,
      why: 'Swing sequence ' + (est.recentSequence.join(' ') || 'insufficient')
        + '. Dow definition, no tunable parameters.',
    },
    {
      name: 'Price vs EMA200',
      reading: price > e200 ? 'above' : 'below',
      vote: e200 === null ? 0 : price > e200 ? 1 : -1,
      why: e200 === null ? 'Not enough data.'
        : 'Price ' + price.toFixed(0) + ' vs EMA200 ' + e200.toFixed(0)
          + ' (' + (((price - e200) / e200) * 100).toFixed(1) + '%).',
    },
    {
      name: 'EMA50 / EMA200 cross',
      reading: e50 === null || e200 === null ? 'no data' : e50 > e200 ? 'EMA50 above' : 'EMA50 below',
      vote: e50 === null || e200 === null ? 0 : e50 > e200 ? 1 : -1,
      why: e50 === null || e200 === null ? 'Not enough data.'
        : 'The intermediate average is ' + (e50 > e200 ? 'above' : 'below') + ' the slow one.',
    },
    {
      name: 'MACD momentum',
      reading: hist === null ? 'no data' : hist > 0 ? 'positive histogram' : 'negative histogram',
      vote: hist === null ? 0 : hist > 0 ? 1 : -1,
      why: hist === null ? 'Not enough data.'
        : 'Histogram ' + hist.toFixed(0)
          + (prevHist !== null
            ? ', ' + (Math.abs(hist) > Math.abs(prevHist) ? 'widening' : 'narrowing')
            : '') + '.',
    },
  ];

  const sum = signals.reduce((s, x) => s + x.vote, 0);

  /**
   * CONTEXTO NO DIRECCIONAL. Estas lecturas NO votan, y es a proposito.
   * Un RSI de 80 no es bajista: en trend fuerte puede quedarse ahi
   * semanas. Convertir "sobrecompra" en vote de venta es el error clasico
   * que hace que los sistemas se pongan shorts contra tendencias intactas.
   * Son moduladores del risk, no de la direction.
   */
  const context = {
    rsi: r14,
    rsiState: r14 === null ? 'no data'
      : r14 >= 70 ? 'extended to the upside' : r14 <= 30 ? 'extended to the downside' : 'neutral',
    atr: atr14,
    atrPctOfPrice: atr14 ? Number(((atr14 / price) * 100).toFixed(2)) : null,
    relativeVolume: volRel,
    volumeState: volRel === null ? 'no data'
      : volRel >= 1.5 ? 'above de lo normal' : volRel <= 0.6 ? 'weak' : 'normal',
    rangePosition: range.position,
    rangeWidthPct: range.amplitudPct,
  };

  return {
    timeframe: serie.interval,
    price,
    lastClosedCandle: candles[candles.length - 1].date,
    indicators: { ema20: e20, ema50: e50, ema200: e200, rsi14: r14, macdHist: hist, atr14, volRel },
    context,
    structure: est,
    levels: ctx,
    range,
    signals,
    vote: sum,
    weight: WEIGHTS[serie.interval] ?? 1,
  };
}

/**
 * Funde las temporalidades. Lo importante no es el numero final sino el
 * DESACUERDO: cuando el diario y el horario apuntan a lados distintos, esa
 * discrepancia es informacion de primer orden, no ruido que promediar.
 */
export function synthesize(analysis) {
  const maxVotePerTf = 4; // four signals from -1 to +1
  let weighted = 0;
  let maximum = 0;

  // Zero-weight timeframes are excluded entirely, not multiplied by zero:
  // leaving them in the denominator would understate the agreement figure.
  const voting = analysis.filter((a) => a.weight > 0);

  for (const a of voting) {
    weighted += a.vote * a.weight;
    maximum += maxVotePerTf * a.weight;
  }

  const normalized = maximum === 0 ? 0 : weighted / maximum; // -1 .. +1

  const bias =
    normalized >= 0.5 ? 'bullish'
    : normalized >= 0.15 ? 'moderately bullish'
    : normalized > -0.15 ? 'no clear bias'
    : normalized > -0.5 ? 'moderately bearish'
    : 'bearish';

  // Acuerdo entre temporalidades, signal a signal.
  const conflicts = [];
  const confluences = [];
  const names = voting[0]?.signals.map((s) => s.name) ?? [];

  for (const name of names) {
    const votes = voting.map((a) => ({
      tf: a.timeframe,
      vote: a.signals.find((s) => s.name === name).vote,
      reading: a.signals.find((s) => s.name === name).reading,
    }));
    const positives = votes.filter((v) => v.vote > 0);
    const negatives = votes.filter((v) => v.vote < 0);

    if (positives.length && negatives.length) {
      conflicts.push({
        signal: name,
        alcistaEn: positives.map((v) => v.tf),
        bajistaEn: negatives.map((v) => v.tf),
        detail: votes.map((v) => v.tf + ': ' + v.reading).join('  |  '),
      });
    } else if (positives.length === voting.length || negatives.length === voting.length) {
      confluences.push({
        signal: name,
        direction: positives.length ? 'bullish' : 'bearish',
        detail: votes.map((v) => v.tf + ': ' + v.reading).join('  |  '),
      });
    }
  }

  /**
   * EVIDENCIA EN CONTRA. La parte que casi ningun sistema muestra y la que
   * mas falta hace para decidir. Recoge todo lo que debilita la reading
   * dominante, para que quien lee no tenga que buscarlo por su cuenta.
   */
  const against = [];

  for (const a of analysis) {
    const dir = normalized > 0 ? 1 : normalized < 0 ? -1 : 0;
    if (dir !== 0) {
      for (const s of a.signals) {
        if (s.vote !== 0 && Math.sign(s.vote) !== dir) {
          against.push('[' + a.timeframe + '] ' + s.name + ': ' + s.reading + '. ' + s.why);
        }
      }
    }
  }

  for (const a of analysis) {
    const r = a.indicators.rsi14;
    if (normalized > 0 && r !== null && r >= 70) {
      against.push('[' + a.timeframe + '] RSI at ' + r.toFixed(0)
        + ': the move is already extended, remaining upside may be smaller.');
    }
    if (normalized < 0 && r !== null && r <= 30) {
      against.push('[' + a.timeframe + '] RSI at ' + r.toFixed(0)
        + ': the decline is already extended, remaining downside may be smaller.');
    }
    if (a.range.position >= 0.9 && normalized > 0) {
      against.push('[' + a.timeframe + '] Price al ' + (a.range.position * 100).toFixed(0)
        + '% of its 60-candle range: late in the move.');
    }
    if (a.indicators.volRel !== null && a.indicators.volRel < 0.7) {
      against.push('[' + a.timeframe + '] Volume at ' + (a.indicators.volRel * 100).toFixed(0)
        + '% of normal: little participation behind the move.');
    }
  }

  return {
    bias,
    score: Number(normalized.toFixed(3)),
    weightedVote: weighted,
    maxVote: maximum,
    agreement: Number((Math.abs(normalized) * 100).toFixed(0)),
    confluences,
    conflicts,
    against,
  };
}

/**
 * Mapa del terreno: que hay encima y debajo del price, en ATR.
 * Describe distancias, no sugiere entradas ni salidas.
 */
export function levelMap(analysis, temporalidadReferencia = '1d') {
  const a = analysis.find((x) => x.timeframe === temporalidadReferencia) ?? analysis[0];
  const res = a.levels.nearestResistance;
  const sop = a.levels.nearestSupport;

  return {
    timeframe: a.timeframe,
    price: a.price,
    atr: a.indicators.atr14,
    nearestResistance: res,
    nearestSupport: sop,
    invalidacionEstructural: a.structure.invalidationLevel,
    // Cuanto move hay a cada lado hasta la primera zona relevante.
    // Es una description geometrica del grafico, no una relacion de risk
    // y beneficio de ninguna operacion concreta.
    recorridoArribaATR: res ? res.distanceATR : null,
    recorridoAbajoATR: sop ? sop.distanceATR : null,
    simetria: res && sop
      ? Number((res.distanceATR / sop.distanceATR).toFixed(2))
      : null,
  };
}
