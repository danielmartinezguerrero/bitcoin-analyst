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

**There is no evidence this system has positive expectancy.** Support and
resistance levels carry no information: replacing them with randomly drawn
lines produces the same results. The desktop app reports all of this on its own
screen rather than burying it.

A clean negative result is worth more than a positive one found by searching.

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
npm test             # 158 property-based tests

npm run datos              # recent candles from Binance
npm run datos:historico    # 9 years of history (3.4 MB)
npm run datos:funding      # funding history since 2019

npm run hoy                # today's read
npm run backtest           # full backtest with costs
npm run validar            # Osler test on the levels
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

### `BitcoinAnalyzer/` — the desktop app

Electron. Buttons on the left, conversation on the right. **English by default**,
with a Spanish toggle that translates the interface and the analysis text.

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

---

## License

MIT — see [LICENSE](LICENSE).
