# Trading View

A TradingView-style trading dashboard powered entirely by **real market data**. Interactive `lightweight-charts` candlestick charts, technical indicators (SMA/EMA/RSI/MACD/BB/VWAP), prices and news from Yahoo Finance, watchlist, screener, price alerts, chart drawings, and a draggable `react-grid-layout` widget canvas.

No fake/synthetic data anywhere — all quotes, candles, and news come from live sources.

## Overview

- **Platform**: Living UI V2 (PocketBase)
- **Port**: single port — PocketBase serves both the built frontend and the API
- **Theme**: System (dark/light), synced from the CraftBot shell via the kit's `ThemeBridge`
- **Auth**: None (`authMode: "none"`, `AUTH_MODE = 'none'` in `frontend/src/config.gen.ts`) — collection rules are open (`''`) and the app binds loopback

## Layout

```
manifest.json          livingUIVersion 2, pbVersion, and the install/build/start pipeline
operations.json        agent-discoverable verbs (served at GET /api/_ops)
pb/pb_migrations/      collection schema + seed data (JS migrations)
pb/pb_hooks/           ops.pb.js (market-data routes) + yahoo.js (fetch helpers)
                       _system.pb.js and _craftbot_bridge.js are system files
pb/pb_public/          Vite build output — generated, never edited by hand
frontend/src/kit/      vendored Living UI kit (system-managed, never edited by agents)
frontend/src/app/      the app itself — this is what you change
```

## Data sources

Market data is **not** stored in a symbol table — the PocketBase hooks in `pb/pb_hooks/yahoo.js` proxy `https://query1.finance.yahoo.com` on demand via `$http.send`, and only user-owned state (watchlist, alerts, drawings, prefs) is persisted.

| Data | Source |
|---|---|
| Quotes | Yahoo Finance quote API, per comma-separated symbol list |
| Candles (OHLCV) | Yahoo Finance chart API, by `range` + `interval` |
| Symbol search | Yahoo Finance search API |
| News headlines | Yahoo Finance news API |

A hosted deployment behind an egress allowlist must permit `finance.yahoo.com`, or every panel renders empty.

## Data Model

PocketBase collections:

| Collection | Migration | Fields |
|---|---|---|
| `watchlist` | `1700000000_init_watchlist.js` | `symbol`, `name`, `position`, `created`, `updated` |
| `alerts` | `1700000002_alerts.js` | `symbol`, `condition` (`above`\|`below`), `price`, `triggered`, `triggered_at`, `created`, `updated` |
| `drawings` | `1700000003_drawings_prefs.js` | `symbol`, `type` (`trendline`\|`hline`), `points` (json), `color`, `created` |
| `prefs` | `1700000003_drawings_prefs.js` | `range`, `sma20`, `sma50`, `ema20`, `bb`, `vwap`, `rsi`, `macd`, `show_news`, `layout` (json), `updated` |

`1700000001_seed_watchlist.js` seeds a starter watchlist so the dashboard is not empty on first open.

## API

CRUD for the four collections is PocketBase's REST API — `GET/POST/PATCH/DELETE /api/collections/{collection}/records` — used from the frontend through the kit's PocketBase client (`kit/pb/client.ts`, `useCollection` / `useRecord`).

Market data comes from custom routes in `pb/pb_hooks/ops.pb.js`, each mirrored in `operations.json`:

| Method | Path | Params | Description |
|---|---|---|---|
| GET | `/api/ops/quotes` | `symbols` (required, comma-separated) | Live quotes; per-symbol failures come back as `{symbol, error}` entries |
| GET | `/api/ops/search` | `q` (required) | Symbol lookup |
| GET | `/api/ops/news` | `symbol` (optional) | Headlines for a symbol, or the general market |
| GET | `/api/ops/candles` | `symbol` (required), `range`, `interval` | OHLCV series; bars with missing prices are dropped |

System routes from `pb/pb_hooks/_system.pb.js`: `GET /api/health` (PocketBase built-in), `GET /api/_ops` (operations manifest), `POST /api/_console` (frontend console relay).

Two hook gotchas worth keeping in mind when editing:

- `routerAdd` handlers run in **isolated** contexts, so shared helpers must be `require`d inside each handler — that is why `yahoo.js` exists as a separate module.
- Read a request body with `e.requestInfo().body`; `e.request.body` is a Go stream and reads as empty.

## Frontend Components

Under `frontend/src/app/components/`:

| Component | Purpose |
|---|---|
| MainView.tsx | Top-level layout, mobile responsive switching |
| TopBar.tsx | Search button (Ctrl+K), save/reset layout |
| DashboardLayout.tsx | `react-grid-layout` wrapper; the layout persists to `prefs.layout` |
| ChartWidget.tsx | Interactive chart — chart types × timeframes × indicators |
| WatchlistPanel.tsx | Polled watchlist |
| StockDetailsPanel.tsx | Selected stock detail |
| NewsPanel.tsx | Yahoo Finance news feed |
| ScreenerPanel.tsx | Filter/sort UI |
| AlertsPanel.tsx | Price alerts CRUD |
| MarketOverviewPanel.tsx | Index ETFs (SPY/QQQ/DIA) |
| SearchModal.tsx | Ctrl+K symbol search via `/api/ops/search` |
| MobileNavBar.tsx | Bottom tab nav for `<768px` |
| WidgetWrapper.tsx | Drag handle + close UI |
| ui/ | App-local presentational components |

`frontend/src/app/AppController.ts` holds dashboard state and the polling loops; `frontend/src/app/services/apiAdapter.ts` wraps the `/api/ops/*` calls.

## State Flow

```
User action → component → AppController ─┬→ PocketBase SDK → collections (watchlist/alerts/drawings/prefs)
                                         └→ /api/ops/* → yahoo.js → Yahoo Finance
```

## Local Development

```bash
npm install --prefix frontend
npm run build --prefix frontend      # emits into pb/pb_public
pocketbase serve --http=127.0.0.1:8090 \
  --dir pb/pb_data --hooksDir pb/pb_hooks \
  --migrationsDir pb/pb_migrations --publicDir pb/pb_public
```

`npm run typecheck --prefix frontend` runs `tsc` alone; the build runs it first and fails on any type error.

## Notes

- No hardcoded stock list, no synthetic news, no placeholder OHLCV.
- Yahoo's endpoints need no API key but are rate-limited; if a call fails the panel shows its empty state rather than fabricating data.
- Yahoo's history limits apply (hourly ≈ 730 days, 5-minute ≈ 60 days), so very long ranges only make sense at daily+ intervals.
