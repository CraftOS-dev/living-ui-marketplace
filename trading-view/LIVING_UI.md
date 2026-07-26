# {{PROJECT_NAME}}

> Per-project plan / context / index. The building agent keeps this current
> (spec A3). Only agent-owned areas are listed under "Editable".

## What this app does

{{PROJECT_DESCRIPTION}}

A stock market viewer: a persistent watchlist with live prices, and
candlestick charts with selectable time ranges. All market data is real
(Yahoo Finance), proxied live through the app's own ops — nothing is
scraped into the database, so stale/corrupt market data cannot break the
app. Requires internet access for quotes and charts.

## Requirements

Feature checklist:

- [x] Watchlist (search-to-add, remove, persisted, seeded with 5 tickers)
- [x] Symbol search (Yahoo search API via `search` op, debounced modal)
- [x] Live quotes for all watchlist symbols (60s auto-refresh, per-symbol error isolation)
- [x] Market overview strip (S&P 500, Dow, Nasdaq)
- [x] Price + change badge (green/red, absolute and percent)
- [x] Stock details row (day range, 52-week range, volume, exchange)
- [x] Candlestick chart (SVG, no chart library) with wick/body, grid, axis labels
- [x] Indicators: SMA20/50, EMA20, Bollinger Bands (20,2σ), VWAP overlays; RSI-14 and MACD(12,26,9) subcharts
- [x] Time ranges: 1D, 5D, 1M, 6M, 1Y, 5Y (interval matched per range)
- [x] Hover crosshair with OHLCV readout
- [x] Price alerts (above/below, checked on quote refresh, triggered history)
- [x] Per-symbol news headlines (`news` op, links out)
- [x] Bars with missing prices dropped server-side (Yahoo serves null bars at times)

- [x] Chart drawings: trendlines (2 clicks) and horizontal levels (1 click), stored in
      data coordinates per symbol, clearable
- [x] Screener over watchlist quotes (price / |change%| / volume filters)
- [x] Persisted layout preferences (default range, indicators, news visibility)
- [x] Rearrangeable widget layout (Details / Chart / RSI / MACD / News order, saved per app)

## Entities

| Collection | Purpose | Notes |
|------------|---------|-------|
| watchlist  | Tracked symbols | symbol (unique), name, position |
| alerts     | Price alerts | symbol, condition above/below, price, triggered, triggered_at |

Quotes and candles are NOT stored — they are fetched on demand from the
`quotes` / `candles` ops (Yahoo Finance proxy in `pb_hooks/ops.pb.js`).

## Operations

Declared in `operations.json`; discoverable at `GET /api/_ops`.

- `quotes` — live quotes for comma-separated symbols.
- `candles` — OHLCV series for one symbol (range + interval params).
- `search` — symbol lookup (Yahoo search API).
- `news` — latest headlines for a symbol.

## Ownership map

- Editable: `frontend/src/app/`, `pb/pb_migrations/`, `pb/pb_hooks/ops.pb.js`,
  `operations.json` (non-system entries), this file.
- System-managed (never edit): `frontend/src/kit/`, `frontend/src/main.tsx`,
  `pb/pb_hooks/_system.pb.js`, `manifest.json`, build configs.
