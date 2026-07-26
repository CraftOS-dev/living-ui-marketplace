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

- [x] Watchlist (add symbol with validation, remove, persisted, seeded with 5 tickers)
- [x] Live quotes for all watchlist symbols (60s auto-refresh, per-symbol error isolation)
- [x] Price + change badge (green/red, absolute and percent)
- [x] Candlestick chart (SVG, no chart library) with wick/body, grid, axis labels
- [x] Time ranges: 1D, 5D, 1M, 6M, 1Y, 5Y (interval matched per range)
- [x] Hover crosshair with OHLCV readout
- [x] Bars with missing prices dropped server-side (Yahoo serves null bars at times)

## Entities

| Collection | Purpose | Notes |
|------------|---------|-------|
| watchlist  | Tracked symbols | symbol (unique), name, position |

Quotes and candles are NOT stored — they are fetched on demand from the
`quotes` / `candles` ops (Yahoo Finance proxy in `pb_hooks/ops.pb.js`).

## Operations

Declared in `operations.json`; discoverable at `GET /api/_ops`.

- `quotes` — live quotes for comma-separated symbols.
- `candles` — OHLCV series for one symbol (range + interval params).

## Ownership map

- Editable: `frontend/src/app/`, `pb/pb_migrations/`, `pb/pb_hooks/ops.pb.js`,
  `operations.json` (non-system entries), this file.
- System-managed (never edit): `frontend/src/kit/`, `frontend/src/main.tsx`,
  `pb/pb_hooks/_system.pb.js`, `manifest.json`, build configs.
