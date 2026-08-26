# Bitcoin Analyst

Educational Bitcoin market analysis. Technical indicators, price structure, a
real Binance cost model, regime detection, walk-forward backtesting and
statistical validation — built from scratch in Node with no dependencies.

**Not financial advice.** It never connects to an account and never places orders.

---

## The headline result

This project validated itself, and the result is negative. It goes at the top
because it is the most valuable thing here:

| Test | Result |
|---|---|
| Support/resistance vs random lines | **p = 0.67** — they do not beat it |
| Backtest with random levels swapped in | **+0.1060R** — same or better than real ones |
| In-sample expectancy (2017-2022) | +0.1372R |
| **Out-of-sample** expectancy (2023-2026) | **+0.0359R** — 74% degradation |
| Out-of-sample 95% CI | **[−0.247 , +0.319]** — includes zero |
| Configurations tried | 15 → Bonferroni threshold p < 0.0033 |
| Learned model, out-of-sample AUC | **0.515** — p = 0.12 against a block permutation |
| Learned model vs the hand-written rules | 0.515 vs **0.517** — the model is not better |

**There is no evidence this system has positive expectancy.** Support and
resistance levels carry no information: replacing them with randomly drawn
lines produces the same results. The desktop app reports all of this on its own
screen rather than burying it.

A clean negative result is worth more than a positive one found by searching.

### "Maybe the rules are just too crude"

That is the reasonable objection to everything above, and `npm run validar:ml`
answers it. A logistic regression is trained on 19,458 labelled 4h candles —
triple-barrier labels at ±1 ATR over a 28-candle horizon — using the same nine
features the rule system already computes, with the same 2017-2022 / 2023-2026
split and the training rows whose outcome crosses the boundary purged out.

Out-of-sample AUC is **0.515**, where 0.5 is a coin. It does not beat the
hand-written rules (0.517). Walk-forward across six years, retraining annually,
gives 0.511. The learned coefficients are all near zero. The signal is not
hiding behind rules that are too simple: it is not there.

**The most instructive number in this repo is a p-value that was wrong.** The
naive permutation test — shuffling labels one by one — returns p = 0.01, which
reads as a real finding. It is an artefact: the labels overlap 28 candles, so
they come in long runs, and shuffling row by row destroys exactly the structure
that makes the null hard to beat. Permuting contiguous blocks instead returns
**p = 0.12**. Same data, same model, opposite conclusion.

The effective sample size tells the same story: 7,958 test rows overlapping 28
candles are worth roughly 284 independent observations, which puts the AUC
standard error at 0.059 — so 0.515 sits a quarter of a standard deviation from
chance. Both tests are printed side by side, the wrong one labelled as wrong,
because seeing them together teaches more than seeing only the correct one.

---

## Two projects in one repo

### `lib/` + `scripts/` — the engine

The analysis core and its command-line tools. Heavily commented: each module
explains **why** it is built the way it is and which alternatives were rejected
and on what evidence.

> **Note on language:** the engine's inline comments are in Spanish, as it was
> written as a teaching exercise. All code identifiers are in English, and the
> desktop app below is fully English. Comments are being migrated.

```bash
npm install          # no dependencies — Node 18+ only
npm test             # 267 property-based tests

npm run datos              # recent candles from Binance
npm run datos:historico    # 9 years of history (3.4 MB)
npm run datos:funding      # funding history since 2019

npm run hoy                # today's read
npm run backtest           # full backtest with costs
npm run validar            # Osler test on the levels
npm run validar:ml         # learned model against the rules and against chance
npm run derivados          # positioning snapshot
```

| Module | Contents |
|---|---|
| `lib/indicadores.mjs` | EMA, RSI, MACD, ATR — implemented from scratch |
| `lib/estructura.mjs` | Pivots, HH/HL structure, ATR-clustered levels |
| `lib/analisis.mjs` | Timeframe fusion, signals and disagreements |
| `lib/escenarios.mjs` | Conditional scenarios with stop and target |
| `lib/costes.mjs` | Binance fee model (spot and perpetuals) |
| `lib/seleccion.mjs` | Daily selection with explicit, auditable criteria |
| `lib/regimen.mjs` | Kaufman Efficiency Ratio, volatility percentile |
| `lib/gestion.mjs` | Break-even, trailing, partials, time stop |
| `lib/validacion.mjs` | Osler test against randomly drawn levels |
| `lib/backtest.mjs` | Walk-forward backtest with fees and funding |
| `lib/etiquetado.mjs` | Triple-barrier labelling, ATR-normalised feature matrix |
| `lib/modelo.mjs` | Logistic regression, AUC, log-loss, purged split, block permutation |
| `lib/recoleccion.mjs` | Unattended collection: idempotent per day, retries, atomic writes |

### `BitcoinAnalyzer/` — the desktop app

Electron. Buttons on the left, conversation on the right. **English by default**,
with a Spanish toggle that translates the interface and the analysis text.

**It collects on every start.** Binance keeps only ~30 days of large-trader
ratios, open interest and taker ratio, so that dataset can only ever be built
forwards — a day not collected is gone. Opening the app appends one record and
shows the running count in the sidebar. The honest cost of tying it to startup
rather than to a scheduled task: a week without opening the app is a
week-shaped hole, and the sidebar reports those gaps rather than hiding them.

```bash
cd BitcoinAnalyzer
npm install
npm start            # development
npm run build        # produces dist/BitcoinAnalyzer.exe (~71 MB, portable)
```

The executable is not versioned: GitHub rejects files over 100 MB and the
unpacked Electron binary is 180 MB. Rebuild it with `npm run build`.

---

## Data sources

All public, keyless and free:

- **Binance spot** — OHLCV candles (`/api/v3/klines`)
- **Binance futures** — funding rates since 2019, large-trader positioning
- **Coinbase** — to reconstruct the institutional premium

Large-trader ratios only keep ~30 days of history, so they **cannot be
backtested**. `npm run derivados` accumulates a daily snapshot so they can be
measured later.

---

## Design decisions worth reading

- **Closed candles only, never the live one** — the last candle repaints and
  changes every indicator minute by minute
- **`confirmedAt` on pivots** — a swing is not knowable until N candles later;
  ignoring that is look-ahead bias
- **Tolerance in ATR, not percent** — adapts to the volatility regime instead of
  needing manual retuning
- **Losing costs more than winning** — the target exits as a limit order (maker)
  while the stop is a market order (taker + slippage)
- **The stop wins ties** in the backtest — if one candle touches both stop and
  target, it counts as a stop
- **Testing stopped at two metrics** — trying more statistics until one comes out
  significant is p-hacking
- **A test that alters a future candle** and asserts no past feature moved — a
  look-ahead leak throws no exception and shows up nowhere else; it just makes
  the results better and untrue
- **Standardisation fitted on the training split only** — using the full
  dataset's mean leaks the test set into training, invisibly and in your favour
- **The barrier and the horizon were not searched** — ±1 ATR and 28 candles come
  from the risk the selection already uses and the backtest's median holding
  time; picking whichever pair scored best is the p-hacking this repo refuses
- **Statistical and economic significance are different things** — with a large
  enough sample the first arrives long before the second, and an AUC of 0.515
  is eaten whole by trading costs even where it is real
- **An all-null snapshot is refused, a partial one is kept and flagged** — the
  API returns nulls rather than errors when rate-limited, and storing those
  would poison a series that cannot be rebuilt
- **The collector's timestamp is set by the writer, not trusted from the
  reader** — every once-per-day guarantee rests on it, so it cannot depend on
  another module remembering to supply it
- **Collection never throws** — it returns a status, because its caller is app
  startup and an ancillary dataset must never be able to stop a window opening

---

## License

MIT — see [LICENSE](LICENSE).
