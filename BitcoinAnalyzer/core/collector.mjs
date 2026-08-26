/**
 * Unattended collection of the derivatives snapshot, run on every app start.
 *
 * WHY THIS RUNS AT STARTUP AND NOT ON A SCHEDULE. Binance keeps only ~30 days
 * of large-trader ratios, open interest and taker ratio, so they cannot be
 * backtested today and the only way to ever measure them is to start storing
 * them now. A day not collected is a day lost permanently.
 *
 * Tying that to app startup has a known cost, and it is worth stating rather
 * than hiding: a week without opening the app is a week-shaped hole in the
 * series. An OS-level scheduler would not have that gap. What startup
 * collection buys instead is that it works on any machine, needs no
 * privileges, cannot be silently disabled by a system that forgot the task,
 * and disappears cleanly when the app is uninstalled.
 *
 * WHAT MATTERS MOST HERE: this runs with nobody watching. A collector that
 * fails quietly does not leave a visible hole — it leaves a series that LOOKS
 * complete and is not, and the problem surfaces months later when the data is
 * unrecoverable. Every defence below exists for that reason.
 */
import { writeFileSync, readFileSync, existsSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { derivativesSnapshot } from './derivatives.mjs';
import { DATA_DIR, ensureDataDir } from './data.mjs';

export const HISTORY_PATH = () => join(DATA_DIR, 'derivatives-history.json');

/** The five values that make a record worth keeping. */
const METRICS = ['topPositions', 'topAccounts', 'allAccounts', 'openInterestBTC', 'takerBuySell'];

const utcDay = (iso) => (typeof iso === 'string' ? iso.slice(0, 10) : null);

/**
 * DEFENCE 1 — ONE RECORD PER UTC DAY.
 *
 * Opening the app three times in an afternoon is normal behaviour, so without
 * this the series stops being "one observation per day" with nothing marking
 * the change. Days are UTC, not local, because the candles and the funding
 * are UTC too; mixing zones would create 23- and 25-hour days twice a year.
 */
function alreadyHaveToday(records, today) {
  return records.some((r) => utcDay(r.timestamp) === today);
}

/**
 * DEFENCE 2 — AN EMPTY RECORD IS NOT A RECORD.
 *
 * `derivativesSnapshot()` returns null for every endpoint that answers
 * anything other than 200, and throws nothing. A 429 rate limit or a 451 geo
 * block therefore produces an all-null snapshot that the previous version
 * stored happily. Months later there would be dozens of poisoned days mixed
 * in with the good ones, with nothing to tell them apart.
 *
 * A PARTIAL failure is still stored, flagged `complete: false`. If open
 * interest and the taker ratio are missing but both sides of the divergence
 * are present, the record still carries information and discarding it would
 * throw away real data. What gets rejected is the snapshot with nothing in it.
 */
function quality(snap) {
  const present = METRICS.filter((k) => snap[k] !== null && snap[k] !== undefined);
  return { present: present.length, total: METRICS.length, complete: present.length === METRICS.length };
}

/**
 * DEFENCE 3 — RETRIES WITH GROWING BACKOFF.
 *
 * Today's reading cannot be fetched tomorrow: the 30-day window moves on. A
 * two-minute network drop must not cost a day of series.
 *
 * The wait GROWS rather than staying flat because the likeliest failure is a
 * rate limit, and retrying fast against a 429 is the most reliable way to
 * turn a transient failure into a permanent one.
 */
async function withRetries(fn, { attempts = 3, waitMs = 15000, onProgress = () => {} } = {}) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      const snap = await fn();
      const q = quality(snap);
      if (q.present > 0) return { snap, q, attempt: i };
      last = new Error(`every field came back empty (0 of ${q.total})`);
    } catch (e) {
      last = e;
    }
    if (i < attempts) {
      onProgress(`Derivatives attempt ${i} failed (${last.message}), retrying...`);
      await new Promise((r) => setTimeout(r, waitMs * i));
    }
  }
  throw last;
}

/**
 * ATOMIC WRITE. The file grows by one record a day for years. If the process
 * dies mid-write the JSON is truncated and the WHOLE history is lost, not just
 * today — and with collection tied to startup, closing the app two seconds
 * after opening it is an entirely normal thing to do. Write to a temp file and
 * rename, which is atomic within a volume.
 */
function saveAtomic(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2));
  renameSync(tmp, path);
}

function readHistory(path) {
  if (!existsSync(path)) return { records: [] };
  try {
    const h = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(h.records) ? h : { records: [] };
  } catch {
    /**
     * A corrupt history is NOT overwritten. Doing so would turn a damaged file
     * — recoverable by hand — into a lost one. Report upwards instead.
     */
    throw new Error('derivatives-history.json exists but cannot be parsed; leaving it untouched');
  }
}

/**
 * Collects today's snapshot if it is missing.
 *
 * NEVER THROWS. Its caller is app startup, where an uncaught rejection over an
 * ancillary dataset would be a window that does not open. Every outcome comes
 * back as a status: 'already' | 'saved' | 'error'.
 */
export async function collectDerivatives({ force = false, onProgress = () => {} } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const path = HISTORY_PATH();

  let history;
  try {
    ensureDataDir();
    history = readHistory(path);
  } catch (e) {
    return { status: 'error', error: e.message, day: today };
  }

  if (!force && alreadyHaveToday(history.records, today)) {
    return { status: 'already', day: today, total: history.records.length };
  }

  let res;
  try {
    res = await withRetries(() => derivativesSnapshot(), { onProgress });
  } catch (e) {
    return { status: 'error', error: e.message, day: today, total: history.records.length };
  }

  /**
   * THE TIMESTAMP IS GUARANTEED HERE rather than assumed.
   *
   * All of the once-per-day logic rests on `timestamp`: a record arriving
   * without one stops being recognised by alreadyHaveToday(), and that day
   * then duplicates on every single app start, unbounded and unannounced.
   * Trusting the snapshot to always carry it makes a detail of a neighbouring
   * module into this one's guarantee; setting it here makes it an invariant
   * of the history file.
   */
  const record = {
    ...res.snap,
    timestamp: res.snap.timestamp ?? new Date().toISOString(),
    complete: res.q.complete,
    fieldsPresent: res.q.present,
  };
  history.records.push(record);
  history.updatedAt = new Date().toISOString();

  try {
    saveAtomic(path, history);
  } catch (e) {
    return { status: 'error', error: `could not write: ${e.message}`, day: today };
  }

  return { status: 'saved', day: today, record, attempt: res.attempt, total: history.records.length };
}

/** Series health — what an unattended collector has to be able to show. */
export function seriesHealth() {
  let history;
  try {
    history = readHistory(HISTORY_PATH());
  } catch {
    return { records: 0, days: 0, partial: 0, gaps: 0, from: null, to: null, unreadable: true };
  }

  const records = history.records ?? [];
  const days = [...new Set(records.map((r) => utcDay(r.timestamp)).filter(Boolean))].sort();
  let gaps = 0;
  for (let i = 1; i < days.length; i++) {
    const d = (Date.parse(days[i]) - Date.parse(days[i - 1])) / 86400000;
    if (d > 1) gaps += d - 1;
  }

  return {
    records: records.length,
    days: days.length,
    partial: records.filter((r) => r.complete === false).length,
    gaps,
    from: days[0] ?? null,
    to: days[days.length - 1] ?? null,
  };
}
