/**
 * Engine — orchestrates the whole analysis and returns plain objects ready
 * for the UI. Every number it produces can be traced back to a rule.
 *
 * WHAT THIS DOES NOT DO: give investment advice. It describes the chart,
 * builds conditional scenarios, and states the evidence against its own
 * reading. It knows nothing about the reader's capital or situation.
 */
import { analyzeTimeframe, synthesize } from './analysis.mjs';
import { dailySelection, CRITERIA } from './selection.mjs';
import { classifyRegime } from './regime.mjs';
import { atr } from './indicators.mjs';
import { FEE_PROFILES, tradeCosts } from './costs.mjs';
import { fetchMarketData, loadMarketData, fetchPositioning, fetchFunding,
  fetchSpotPrice, isMarketDataStale, marketDataAgeMinutes, CACHE_TTL_MINUTES } from './data.mjs';

export const TIMEFRAMES = ['1d', '4h', '1h', '15m'];

/**
 * What the backtest established, carried into the UI so the app never
 * presents itself as more reliable than it measured.
 */
export const VALIDATION = {
  trades: 163,
  expectancyNoFilter: -0.0313,
  expectancyWithFilter: +0.0980,   // funding now deducted; was +0.1270 without it
  pValue: 0.2712,
  ciLow: -0.0766,
  ciHigh: +0.2727,
  levelsPValue: 0.6675,
  randomLevelsExpectancy: +0.1060,
  randomLevelsBeatReal: '10 of 20',
  randomLevelsPValue: 0.524,
  winRateWithFilter: 0.429,
  configurationsTried: 15,
  /**
   * THE GATE. Everything else in this object is a measurement; this is the
   * decision that follows from them.
   *
   * The app used to headline "BULLISH", print a full trade plan, and bury the
   * statistics in a footnote. Nobody reads that and concludes "do not trade" —
   * the layout announced a conclusion and retracted it where it no longer
   * changed the decision. If the tool does not believe its own statistics, it
   * has no business emitting an actionable plan.
   *
   * While this is false the scenario is still shown — the geometry is real and
   * worth seeing — but labelled NOT ACTIONABLE, at the top, not the bottom.
   */
  hasProvenEdge: false,
  /**
   * OUT-OF-SAMPLE RESULT — the test that settles it.
   *
   * Configuration was fixed on 2017-2022 and then measured on 2023-2026,
   * data never used to choose anything. The filter keeps its sign but loses
   * 74% of its magnitude: +0.1372R in-sample against +0.0359R out. That is
   * the signature of a search winner, not of an edge.
   *
   * 63 trades with an interval from -0.247R to +0.319R is indistinguishable
   * from zero. This is the number that matters, not the in-sample one.
   */
  outOfSample: {
    period: '2023-01 to 2026-08',
    trades: 63,
    winRate: 0.381,
    expectancy: +0.0359,
    ciLow: -0.247,
    ciHigh: +0.319,
    inSampleExpectancy: +0.1372,
    degradation: 0.74,
  },
  /**
   * Sample size matters as much as the interval. With n = 163 and ~1R standard
   * deviation this is NOT an underpowered test: a large edge would show. So
   * the honest conclusion is not "we need more data" but "if an edge exists,
   * it is small" — and the optimistic upper bound is +0.27R, before correcting
   * for having picked the best of 15 configurations.
   */
  sampleSize: 163,
  bonferroniThreshold: 0.05 / 15,
  /**
   * WORDING MATTERS HERE. "It improved but is not significant" is wrong:
   * p = 0.27 means there is NO EVIDENCE that it improved at all. The
   * confidence interval spans from losing to winning. Saying otherwise
   * smuggles a conclusion the data does not support.
   */
  note: 'There is NO EVIDENCE that this system has positive expectancy '
    + '(p = 0.27, confidence interval from -0.08R to +0.27R, includes zero). '
    + 'Replacing the support/resistance levels with RANDOM lines produces the '
    + 'same or better results (10 of 20 random sets beat the real ones), so the '
    + 'levels contribute nothing. Around 15 configurations were tried, which '
    + 'makes the multiple-comparisons problem worse, not better.',
};

/** Runs the full analysis. `refresh` re-downloads market data first. */
export async function runAnalysis({ refresh = false, feeProfile = 'futures',
  entryAsMaker = true, capital = 0, onProgress = () => {} } = {}) {

  let market = refresh ? null : loadMarketData();
  /**
   * THE CACHE HAS TO EXPIRE.
   *
   * This used to be `if (!market)` alone, so the snapshot on disk was reused
   * for as long as it existed. `dataAge` was computed a few lines below and
   * never acted on, which meant "Analyze today" downloaded no candles at all
   * and reprinted the same scenario indefinitely. The app looked frozen
   * because it was.
   *
   * `refresh` still forces a download; this only stops a stale file from being
   * served in silence.
   */
  if (market && isMarketDataStale(market)) market = null;
  if (!market) {
    onProgress('Downloading market data from Binance...');
    market = await fetchMarketData(onProgress);
  }

  onProgress('Computing indicators and structure...');
  const analysis = TIMEFRAMES.filter((tf) => market.series[tf])
    .map((tf) => analyzeTimeframe(market.series[tf]));
  const synthesis = synthesize(analysis);

  const daily = market.series['1d'].candles.slice(0, -1);
  const regime = classifyRegime(daily, atr(daily, 14));
  const performance = performanceContext(daily);

  const costs = { profile: feeProfile, options: { entryAsMaker } };
  const selection = dailySelection(analysis, synthesis, costs, CRITERIA);

  /**
   * REGIME FILTER. Requiring the trade to run with the regime is the only
   * change that moved measured expectancy above zero (+0.098R vs -0.031R).
   *
   * It is applied, but NOT because it is proven: p = 0.27 means there is no
   * evidence it helps at all. It is kept because it is the least-bad option
   * measured, and because it cut maximum drawdown from -39.6R to -12.4R —
   * that part is a real, mechanical effect of trading less often.
   */
  const aligned = selection.eligible.filter((c) => c.direction === regime.direction);
  const proposal = regime.isTrending ? (aligned[0] ?? null) : null;

  onProgress('Reading derivatives positioning...');
  const [positioning, funding, livePrice] = await Promise.all([
    fetchPositioning(), fetchFunding(), fetchSpotPrice()]);

  /**
   * HONEST LABELS. The scenario used to say the stop rested on "structure" and
   * the target came from a "zone with 2 touches" — two lines after the report
   * demonstrated those levels do not beat random ones. That wording lends an
   * authority the test just withdrew. What they actually are is distances in
   * ATR, so that is what gets shown; the original label is kept beside it so
   * nothing is hidden.
   */
  if (proposal) {
    proposal.honestStopLabel = `${proposal.riskATR} ATR from entry`;
    proposal.honestTargetLabel = `${proposal.target.distanceATR} ATR from entry`;
    proposal.originalStopLabel = proposal.invalidation.base;
    proposal.originalTargetLabel = proposal.target.origin;
  }

  return {
    generatedAt: new Date().toISOString(),
    price: analysis[0].price,
    /**
     * The live quote travels BESIDE the reference price, not instead of it.
     * They answer different questions — what BTC is worth right now, and what
     * close this reading reasoned from — and collapsing them into one number
     * is how the reference price came to look like a stuck ticker.
     */
    livePrice,
    referenceCandleDate: daily[daily.length - 1].date,
    /** UTC days align with epoch day boundaries, so this is just the next one. */
    nextDailyCloseAt: new Date(Math.ceil(Date.now() / 86400000) * 86400000).toISOString(),
    dataAge: marketDataAgeMinutes(market),
    cacheTtlMinutes: CACHE_TTL_MINUTES,
    regime, performance, synthesis, analysis, selection, proposal,
    positioning, funding,
    sizing: capital > 0 && proposal ? computeSizing(proposal, capital, feeProfile, entryAsMaker) : null,
    costs: { profile: FEE_PROFILES[feeProfile].name, entryAsMaker },
    validation: VALIDATION,
  };
}

/**
 * Position sizing. Pure arithmetic on the scenario: how much the account
 * moves if price reaches the target and if it reaches the stop, with each
 * branch's costs already deducted. Losing costs more than winning because a
 * stop is a market order (taker + slippage) while a target is a limit order.
 */
export function computeSizing(proposal, capital, feeProfile, entryAsMaker, leverage = 1) {
  const t = proposal.target;
  const notional = capital * leverage;
  const btc = notional / proposal.price;
  const c = tradeCosts(feeProfile, { entryAsMaker });

  const grossWin = notional * (Math.abs(t.price - proposal.price) / proposal.price);
  const grossLoss = notional * (Math.abs(proposal.invalidation.price - proposal.price) / proposal.price);

  /**
   * Each side's fee is charged on THAT SIDE'S value, not on the entry notional.
   * Exiting at the target moves more value than entering; exiting at the stop
   * moves less. Charging both legs on the entry size mis-states each branch by
   * ~0.001 USDT at this scale — small, but wrong, and free to fix.
   */
  const exitValueWin = notional * (t.price / proposal.price);
  const exitValueLoss = notional * (proposal.invalidation.price / proposal.price);
  const feesWin = notional * (c.entry + c.entrySlippage) + exitValueWin * c.exitTP;
  const feesLoss = notional * (c.entry + c.entrySlippage) + exitValueLoss * c.exitSL;

  const netWin = grossWin - feesWin;
  const netLoss = grossLoss + feesLoss;

  /**
   * EXPECTED cost per trade, weighted by the measured hit rate. The "fees take
   * X% of gross profit" figure only describes the winning branch; this one
   * answers what an average trade actually pays.
   */
  const measuredWinRate = VALIDATION.winRateWithFilter;
  const expectedFees = measuredWinRate * feesWin + (1 - measuredWinRate) * feesLoss;

  /**
   * PRODUCT COHERENCE. The report used to charge futures maker/taker fees,
   * quote funding, and then describe the position as "no leverage" — three
   * statements pointing at two different products.
   *
   * The profile decides everything now: on spot there is no funding and no
   * maker/taker distinction at VIP0 (both legs 0.1%); on a perpetual the
   * funding is a real cost that belongs in the risk/reward, and "1x" is the
   * honest description, not "unleveraged".
   */
  const profile = FEE_PROFILES[feeProfile];
  const isPerpetual = profile.funding !== null;
  // Funding over the historical median holding time of the backtest (4.6 days).
  const fundingPeriods = isPerpetual ? Math.floor((4.6 * 24) / 8) : 0;
  const fundingCost = isPerpetual ? notional * fundingPeriods * profile.funding : 0;

  return {
    capital, leverage, notional, btc,
    netWin, netLoss, grossWin, grossLoss, feesWin, feesLoss,
    expectedFees,
    expectedFeesInR: expectedFees / netLoss,
    /** The hit rate baked into expectedFees — stated, not hidden inside a number. */
    assumedWinRate: measuredWinRate,
    isPerpetual,
    productLabel: isPerpetual ? 'USD-M perpetual at 1x' : 'Spot',
    fundingCost,
    fundingPeriods,
    fundingCostInR: netLoss > 0 ? fundingCost / netLoss : 0,
    netWinAfterFunding: netWin - fundingCost,
    winPctOfCapital: (netWin / capital) * 100,
    lossPctOfCapital: (netLoss / capital) * 100,
    realRatio: netWin / netLoss,
    tooSmall: notional < 100,
  };
}

/**
 * Multi-horizon performance context.
 *
 * WHY THIS EXISTS: the analysis reports "position 89% of range" — but that is
 * the range of the last 60 candles. A violent rebound inside a bear market
 * scores near the top of a 60-candle window while sitting near the bottom of
 * the yearly one. Without both numbers, a bounce reads as strength.
 */
export function performanceContext(dailyCandles) {
  const last = dailyCandles[dailyCandles.length - 1];
  const ago = (n) => dailyCandles[dailyCandles.length - 1 - n] ?? null;
  const pct = (a, b) => Number((((a - b) / b) * 100).toFixed(1));

  const year = dailyCandles.slice(-365);
  const yearHigh = Math.max(...year.map((c) => c.h));
  const yearLow = Math.min(...year.map((c) => c.l));

  const horizons = {};
  for (const [n, key] of [[7, 'week'], [30, 'month'], [90, 'quarter'], [365, 'year']]) {
    const ref = ago(n);
    if (ref) horizons[key] = pct(last.c, ref.c);
  }

  return {
    horizons,
    yearHigh, yearLow,
    fromYearHigh: pct(last.c, yearHigh),
    fromYearLow: pct(last.c, yearLow),
    positionInYearlyRange: Number((((last.c - yearLow) / (yearHigh - yearLow)) * 100).toFixed(0)),
    /**
     * A big weekly gain inside a negative year is a rebound, not an uptrend.
     * Flagged explicitly because every momentum signal reads bullish in it.
     */
    isReboundInDowntrend: (horizons.week ?? 0) > 10 && (horizons.year ?? 0) < -15,
  };
}

/**
 * MOMENTUM DETERIORATION.
 *
 * The signal votes are binary (+1 / 0 / -1), so a MACD histogram going from
 * -14 to -28 keeps voting -1 and the headline does not move. The system was
 * blind to MAGNITUDE and to ACCELERATION: it could describe a state but not
 * notice that the state was getting worse.
 *
 * This reads the direction of change rather than the sign, and it is surfaced
 * next to the headline instead of buried in the list, because a reading that
 * says BULLISH while short-term momentum expands to the downside is a
 * conflict, not a detail.
 */
export function momentumCheck(analysis, biasDirection) {
  const expanding = [];
  for (const a of analysis) {
    const h = a.indicators.macdHist;
    if (h === null || h === undefined) continue;
    const sig = a.signals.find((s) => s.name.includes('MACD'));
    const isWidening = sig && /widening|ampliándose/.test(sig.why);
    // Against the bias and growing = the move is accelerating the wrong way.
    const against = biasDirection > 0 ? h < 0 : h > 0;
    if (against && isWidening) expanding.push({ timeframe: a.timeframe, hist: Math.round(h) });
  }

  return {
    expandingAgainst: expanding,
    /** Two or more timeframes accelerating against the bias is a real conflict. */
    conflict: expanding.length >= 2,
    text: expanding.length
      ? `Short-term momentum is turning: MACD expanding AGAINST the reading on `
        + expanding.map((e) => `${e.timeframe} (${e.hist})`).join(', ')
        + '. The headline is binary and does not move when a histogram deepens, '
        + 'so this is flagged separately — it is the most actionable evidence against.'
      : null,
  };
}

/** Turns the analysis into the short plain-English explanation the UI shows. */
export function explain(result) {
  const { regime, synthesis, analysis } = result;
  const reasons = [];

  reasons.push(`Regime: ${regime.kind}. ${regime.description}`);

  /**
   * Performance context goes SECOND, right after the regime, because it
   * reframes everything below it. Burying it at the bottom would let the
   * momentum signals be read at face value.
   */
  const p = result.performance;
  if (p) {
    reasons.push(`Performance: ${p.horizons.week >= 0 ? '+' : ''}${p.horizons.week}% in 7 days, `
      + `${p.horizons.month >= 0 ? '+' : ''}${p.horizons.month}% in 30 days, `
      + `${p.horizons.year >= 0 ? '+' : ''}${p.horizons.year}% in 1 year. `
      + `Price sits at ${p.positionInYearlyRange}% of its yearly range, `
      + `${p.fromYearHigh}% below the 12-month high.`);
    if (p.isReboundInDowntrend) {
      /**
       * The Efficiency Ratio is listed here too, and not by accident.
       * A vertical rebound produces a high ER BY CONSTRUCTION — it is the same
       * information as "+22% in 7 days", restated. Warning about the EMA200
       * while leaving the regime line to be read at face value would have been
       * inconsistent: both are consequences of the bounce, not confirmations.
       */
      reasons.push('WARNING: a sharp weekly gain inside a negative year is a REBOUND '
        + 'within a downtrend, not a mature uptrend. Every momentum signal reads '
        + 'bullish in this setup — price above EMA200, and the high Efficiency Ratio '
        + 'of the regime line above — because a vertical bounce produces both by '
        + 'construction. They restate the weekly gain; they do not confirm it.');
    }
    /**
     * OVERHEAD SUPPLY. Sitting low in the yearly range is not just a statistic:
     * everyone who bought higher is underwater and tends to sell into rallies.
     * The old report printed the number and drew no conclusion from it.
     */
    if (p.positionInYearlyRange < 40 && p.fromYearHigh < -20) {
      reasons.push(`Overhead supply: price is ${p.fromYearHigh}% below the 12-month high `
        + `and at ${p.positionInYearlyRange}% of the yearly range. Everyone who bought `
        + 'higher is underwater, which historically means selling pressure into rallies — '
        + 'the least favourable backdrop for an upside target by extension.');
    }
  }

  const conf = synthesis.confluences.map((c) => `${c.signal} (${c.direction})`);
  if (conf.length) reasons.push(`All timeframes agree on: ${conf.join('; ')}.`);

  const votes = analysis.map((a) => `${a.timeframe} ${a.vote > 0 ? '+' : ''}${a.vote}`).join(', ');
  reasons.push(`Vote by timeframe: ${votes} — aggregate bias ${synthesis.bias} (${synthesis.agreement}% agreement).`);

  const volPct = regime.volatilityPercentile !== null
    ? Math.round(regime.volatilityPercentile * 100) : '?';
  reasons.push(`Volatility ${regime.volatilityState} (percentile ${volPct} of the last year). Daily ATR ${Math.round(analysis[0].indicators.atr14).toLocaleString('en-US')} USDT.`);

  if (result.positioning?.topByPosition && result.positioning?.allAccounts) {
    const p = result.positioning;
    /**
     * ONE DECIMAL, not four. Reporting 2.0852 on a ratio that drifts to 2.0848
     * between two reads is false precision: it implies a resolution the data
     * does not have. This series also mixes hedges and market-maker inventory,
     * so it is context, never a directional signal.
     */
    const r1 = (x) => Number(x).toFixed(1);
    reasons.push(`Positioning (context only, not a signal): large traders ${r1(p.topByPosition)} long/short vs ${r1(p.allAccounts)} for all accounts — ${p.whaleRetailGap > 0.3 ? 'big money is more long than retail' : p.whaleRetailGap < -0.3 ? 'big money is more short than retail' : 'no meaningful divergence'}. This ratio includes hedges and market-maker inventory.`);
  }
  if (result.funding) {
    reasons.push(`Funding ${result.funding.ratePct.toFixed(4)}% per 8h (percentile ${Math.round(result.funding.percentile30d * 100)} of last 30 days) — ${result.funding.rate > 0 ? 'longs are paying shorts' : 'shorts are paying longs'}.`);
  }

  const momentum = momentumCheck(analysis, synthesis.score);

  return {
    reading: regime.isTrending ? regime.direction.toUpperCase() : synthesis.bias.toUpperCase(),
    isTrending: regime.isTrending,
    /**
     * Qualifier shown right beside the headline. Without it the verdict reads
     * identical on a day when momentum is intact and on a day when it has
     * turned and is accelerating away.
     */
    qualifier: momentum.conflict ? 'momentum deteriorating' : null,
    momentum,
    reasons,
    against: synthesis.against.slice(0, 4),
  };
}
