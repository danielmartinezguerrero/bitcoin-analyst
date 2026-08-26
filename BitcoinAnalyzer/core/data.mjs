/**
 * Market data collection from Binance public endpoints.
 * No API key, no registration, no cost.
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

export const ROOT = dirname(import.meta.dirname);

/**
 * Where market snapshots are written.
 *
 * Inside a packaged .exe the app directory is READ-ONLY, so writing next to
 * the code fails at runtime with no obvious cause. The main process passes a
 * writable per-user location through this variable; running from source with
 * no variable set falls back to the project folder.
 */
export const DATA_DIR = process.env.BTC_DATA_DIR || join(ROOT, 'data');

export function ensureDataDir() {
  mkdirSync(DATA_DIR, { recursive: true });
}

const SYMBOL = 'BTCUSDT';
const TIMEFRAMES = [
  { interval: '1d', candles: 400 },
  { interval: '4h', candles: 500 },
  { interval: '1h', candles: 500 },
  { interval: '15m', candles: 500 },
];

/**
 * Binance returns each candle as a 12-slot ARRAY, with prices as strings to
 * avoid precision loss. We convert to numbers here, at the system boundary,
 * so the rest of the code never sees a raw index.
 */
function normalizeCandle(k) {
  return {
    t: k[0],
    date: new Date(k[0]).toISOString(),
    o: parseFloat(k[1]), h: parseFloat(k[2]),
    l: parseFloat(k[3]), c: parseFloat(k[4]),
    v: parseFloat(k[5]), tClose: k[6], trades: k[8],
  };
}

export async function fetchMarketData(onProgress = () => {}) {
  const out = { generatedAt: new Date().toISOString(), symbol: SYMBOL, series: {} };

  for (const { interval, candles: n } of TIMEFRAMES) {
    onProgress(`Downloading ${SYMBOL} ${interval}...`);
    const url = `https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${interval}&limit=${n}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`Binance returned ${res.status} for ${interval}`);

    const candles = (await res.json()).map(normalizeCandle);
    const last = candles[candles.length - 1];
    // The last candle has not closed yet: its values still change every second.
    // Including it makes indicators repaint, so it is flagged, not deleted.
    last.isOpen = last.tClose > Date.now();

    out.series[interval] = {
      interval, count: candles.length,
      from: candles[0].date, to: last.date,
      lastIsOpen: last.isOpen, candles,
    };
  }

  ensureDataDir();
  writeFileSync(join(DATA_DIR, 'market.json'), JSON.stringify(out));
  return out;
}

export function loadMarketData() {
  const p = join(DATA_DIR, 'market.json');
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

/** Live positioning snapshot. Informational only: Binance keeps ~30 days. */
export async function fetchPositioning() {
  const base = 'https://fapi.binance.com/futures/data/';
  const ask = async (route) => {
    try {
      const r = await fetch(`${base}${route}?symbol=${SYMBOL}&period=5m&limit=1`,
        { signal: AbortSignal.timeout(12000) });
      if (!r.ok) return null;
      return (await r.json())[0] ?? null;
    } catch { return null; }
  };

  const [positions, accounts, global, oi, taker] = await Promise.all([
    ask('topLongShortPositionRatio'), ask('topLongShortAccountRatio'),
    ask('globalLongShortAccountRatio'), ask('openInterestHist'), ask('takerlongshortRatio'),
  ]);
  const num = (x) => (x == null ? null : Number(x));

  return {
    timestamp: new Date().toISOString(),
    topByPosition: num(positions?.longShortRatio),
    topByAccount: num(accounts?.longShortRatio),
    allAccounts: num(global?.longShortRatio),
    openInterestBTC: num(oi?.sumOpenInterest),
    takerBuySell: num(taker?.buySellRatio),
    whaleRetailGap: positions && global
      ? Number((num(positions.longShortRatio) - num(global.longShortRatio)).toFixed(3)) : null,
  };
}

/** Current funding rate. Positive means longs pay shorts. */
export async function fetchFunding() {
  try {
    const r = await fetch(
      `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${SYMBOL}&limit=30`,
      { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    const d = await r.json();
    const rates = d.map((f) => parseFloat(f.fundingRate));
    const current = rates[rates.length - 1];
    const below = rates.filter((x) => x < current).length;
    const equal = rates.filter((x) => x === current).length;
    return {
      rate: current,
      ratePct: current * 100,
      percentile30d: (below + equal / 2) / rates.length,
      average30d: rates.reduce((s, x) => s + x, 0) / rates.length,
    };
  } catch { return null; }
}

/**
 * CACHE EXPIRY.
 *
 * `loadMarketData()` had no notion of age, so a snapshot written once was
 * served forever: the "Analyze today" button issued no request for candles and
 * returned a byte-identical reading days later. The file is only good until
 * the fastest timeframe rolls over, which is what this encodes.
 */
export const CACHE_TTL_MINUTES = 15;

export function marketDataAgeMinutes(market) {
  if (!market || !market.generatedAt) return Infinity;
  return (Date.now() - new Date(market.generatedAt).getTime()) / 60000;
}

export function isMarketDataStale(market, ttlMinutes = CACHE_TTL_MINUTES) {
  return marketDataAgeMinutes(market) > ttlMinutes;
}

/**
 * Live spot price, for DISPLAY ONLY.
 *
 * The analysis deliberately runs on closed candles, so the price it reasons
 * with is yesterday's daily close. Showing that number alone in the sidebar
 * made the app look broken — it sat still while the market moved. This is the
 * real quote, shown next to the reference price, never fed into the analysis.
 */
export async function fetchSpotPrice() {
  try {
    const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${SYMBOL}`,
      { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    return parseFloat((await r.json()).price);
  } catch { return null; }
}
