# Bitcoin Analyzer

Educational Bitcoin market analysis. Reads public Binance data, builds a
technical scenario with stop loss and take profit, and explains the reasoning
— including the evidence against its own reading.

**Not financial advice.** It never connects to an account and never places orders.

## Running it

Double-click `BitcoinAnalyzer.exe`. No installation, no configuration, no API keys.

## What the buttons do

| Button | What it does |
|---|---|
| **Analyze today** | Reads the market and, if conditions are met, suggests a scenario with entry, stop and target |
| **Refresh market data** | Downloads fresh candles from Binance before analyzing |
| **Whale positioning** | Shows how large traders are positioned versus retail |
| **How reliable is this?** | Backtest results, including what failed |

Set your **capital** on the left to see exactly how much you would gain at the
target and lose at the stop, with Binance fees already deducted.

## How it decides

1. Downloads candles for 4 timeframes (1d, 4h, 1h, 15m) from public endpoints
2. Computes indicators (EMA, RSI, MACD, ATR) and market structure (pivots, levels)
3. Classifies the market regime with Kaufman's Efficiency Ratio
4. Builds scenarios in both directions and scores them by **net** risk/reward
5. Only suggests a trade running with the regime — outside a trend it says so

## Honest limitations

Measured on 503 backtested trades (2018–2026, walk-forward, real fees):

- Expectancy **without** the regime filter: **−0.031R** per trade
- Expectancy **with** the filter: **+0.124R** — but **p = 0.23**, not significant
- Support/resistance levels **do not beat random lines** (p = 0.67)

Two statistical tests were run and stopped there deliberately. Trying more
until one comes out significant is p-hacking.

Treat every suggestion as an unproven hypothesis.

## Building from source

```
npm install
npm start          # run in development
npm run build      # produce dist/BitcoinAnalyzer.exe
```

Requires Node.js 18+. Data sources are all public and keyless: Binance spot
klines, Binance futures positioning, and funding rates.

## Language

The app ships in **English**. The **Idioma** switch in the sidebar toggles the
whole interface — including the analysis text — to Spanish, and remembers your
choice between sessions.

The heading stays "Idioma" in Spanish on purpose: someone who cannot read the
English interface still recognises that word, which is the point of a language
selector.
