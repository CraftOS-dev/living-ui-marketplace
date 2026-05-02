# Trading View

A TradingView-style trading dashboard powered entirely by **real market data**. Interactive `lightweight-charts` candlestick charts with lazy-loading historical data, technical indicators (SMA/EMA/RSI/MACD/BB/VWAP), real-time prices via Yahoo Finance, real news headlines, watchlist, screener, price alerts, and a draggable widget layout.

No fake/synthetic data anywhere — all stocks, prices, candles, sectors, and news come from live data sources.

## Overview

- **Project ID**: 7c3a8e2f
- **Frontend Port**: 3104
- **Backend Port**: 3105
- **Theme**: System (dark/light)
- **Auth**: None (single-user, local)

## Data sources

| Layer | Source | Notes |
|---|---|---|
| Symbol universe (~10k US-listed stocks) | [NASDAQ Trader](https://www.nasdaqtrader.com/dynamic/SymDir/) — `nasdaqlisted.txt` + `otherlisted.txt` | Free, no auth, refreshed daily by NASDAQ |
| Real-time prices (15-min delayed) | Yahoo Finance via `yfinance.Ticker.fast_info` | Free, no auth |
| Historical OHLCV candles | Yahoo Finance via `yfinance.Ticker.history` | 5y daily / 60d hourly / 7d 5-min initial; older data fetched on chart scroll |
| News headlines + URLs + timestamps | Yahoo Finance via `yfinance.Ticker.news` | Real headlines, real publishers, real links |
| Sectors / market cap | Yahoo Finance via `yfinance.Ticker.info` | Lazy-loaded per symbol on first interaction |

## Loading strategy

- On first launch, `seed_stocks` downloads the full ~10k symbol universe from NASDAQ Trader (one HTTP call, takes a few seconds, all symbols become searchable).
- A small `WARMUP_TICKERS` list (AAPL, MSFT, GOOGL, … ~30 large-cap tickers) gets prices and sectors fetched immediately so the dashboard has data to show on first paint.
- Every other symbol gets its price, sector, and candles **lazily**: the moment a user opens it (chart, watchlist add, alert), Yahoo Finance is called for that symbol only.
- The chart widget supports infinite-scroll left: when the user drags past the loaded data window, the backend pulls the next 365-day window from Yahoo and persists it. The frontend shows "Loading older candles…" while fetching and "Earliest data reached" when Yahoo has no more.
- Polled real-time prices only update for *active* stocks (those with a `StockPrice` row), which avoids hammering Yahoo with 10k requests every 30 seconds.

## Data Model

| Model | Purpose | Key Fields |
|---|---|---|
| `Stock` | One row per US-listed symbol from NASDAQ Trader | id, symbol, name, sector, market_cap, exchange |
| `StockPrice` | Current price snapshot per active stock | stock_id, price, open_price, high, low, prev_close, volume, change, change_pct |
| `Candle` | OHLCV candle for a stock + timeframe | stock_id, timeframe, timestamp, open_price, high, low, close_price, volume |
| `Watchlist` | User's watched stocks | stock_id, sort_order |
| `PriceAlert` | Above/below price triggers | stock_id, target_price, condition, active, triggered, triggered_at |
| `Drawing` | Chart annotations (trendlines, etc.) | stock_id, timeframe, tool_type, drawing_data, color |
| `WidgetLayout` | Saved react-grid-layout configuration | layout_data, chart_config |
| `MarketNews` | Cached Yahoo Finance news (5-min TTL) | stock_symbol, headline, summary, source, url, published_at |
| `SimulationState` | Throttle metadata for price ticking | last_tick_time, tick_count |

## API Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/api/stocks/seed` | Download symbol universe + warm up popular tickers (idempotent). Pass `?sync=true` for synchronous warmup candle fetch. |
| GET | `/api/stocks` | Paginated stock list. `?limit=N&offset=N&only_priced=true` |
| GET | `/api/stocks/search?q=…&limit=N` | Symbol/name search (exact → prefix → substring). |
| GET | `/api/stocks/prices` | Real-time price map for active stocks. |
| GET | `/api/stocks/{symbol}/price` | Single stock price (lazy-fetches from Yahoo on first call). |
| GET | `/api/stocks/{symbol}/candles` | OHLCV candles. `?timeframe=&limit=&since=&before=` — `before` triggers older-data fetch from Yahoo. |
| GET | `/api/stocks/{symbol}/indicators?type=SMA\|EMA\|RSI\|MACD\|BB\|VWAP` | Indicator data computed from candles. |
| GET, POST, PUT, DELETE | `/api/stocks/{symbol}/drawings`, `/api/drawings/{id}` | Chart drawings CRUD. |
| GET, POST | `/api/watchlist`, `/api/watchlist/reorder`, `/api/watchlist/{id}` | Watchlist CRUD. **Returns 404 if symbol unknown — no silent fallback.** |
| GET | `/api/screener` | Filter/sort priced stocks. |
| GET, POST, DELETE | `/api/alerts`, `/api/alerts/{id}`, `/api/alerts/triggered` | Price alerts. **Returns 404 if symbol unknown.** |
| GET, PUT | `/api/layout` | Save/load widget layout. |
| GET | `/api/news?symbol=…` | Real Yahoo Finance news (5-min DB cache). |
| GET, PUT | `/api/settings` | User settings — validated by `SettingsUpdate` Pydantic schema. |

Plus framework routes: `/api/state` (GET/PUT/POST/DELETE), `/api/action`, `/api/ui-snapshot`, `/api/ui-screenshot`, `/api/logs`.

## Frontend Components

| Component | Purpose |
|---|---|
| `App.tsx` | Root, mounts AppController + UICapture |
| `AppController.ts` | State management; auto-seeds the universe once per session in `initialize()` |
| `MainView.tsx` | Top-level layout, mobile responsive switching |
| `TopBar.tsx` | Search button (Ctrl+K), save/reset layout |
| `DashboardLayout.tsx` | react-grid-layout wrapper |
| `ChartWidget.tsx` | Interactive chart with lazy-load on left scroll, loading overlays, 6 chart types × 8 timeframes × 6 indicators |
| `WatchlistPanel.tsx` | Live-polled watchlist (3s interval) |
| `StockDetailsPanel.tsx` | Selected stock fundamentals |
| `NewsPanel.tsx` | Real Yahoo Finance news feed |
| `ScreenerPanel.tsx` | Filter/sort UI |
| `AlertsPanel.tsx` | Active alerts CRUD |
| `MarketOverviewPanel.tsx` | Index ETFs (SPY/QQQ/DIA) |
| `SearchModal.tsx` | Ctrl+K modal — searches the full ~10k symbol universe via `/api/stocks/search` |
| `MobileNavBar.tsx` | Bottom tab nav for `<768px` |
| `WidgetWrapper.tsx` | Drag handle + close UI |
| `ui/` | Preset UI components (Button, Modal, Input, etc.) |

## Polling cadence

- **Prices**: every 3 seconds in `AppController.startPolling()` (server throttles real Yahoo fetch to once per 30 seconds; in between, returns cached prices).
- **Triggered alerts**: every 5 seconds.
- **News**: fetched on view mount + manual refresh; backend caches each query for 5 minutes.

## Key files

| File | Purpose |
|---|---|
| `backend/simulation.py` | Symbol-universe download, yfinance wrappers, candle fetch (initial + lazy older), real news fetch, indicator math |
| `backend/routes.py` | All HTTP endpoints |
| `backend/models.py` | SQLAlchemy models |
| `frontend/AppController.ts` | API client + state + polling |
| `frontend/components/ChartWidget.tsx` | Chart with lazy-loading on horizontal scroll |
| `frontend/components/SearchModal.tsx` | Symbol search across the full universe |

## Testing

```bash
cd backend && py -m pytest tests/ -v --tb=short
```

42 unit tests, all passing. Tests use a manually-seeded fixture universe (no network). The real `/api/stocks/seed` endpoint, which calls NASDAQ Trader and Yahoo Finance, is exercised in the external smoke-test suite.

## Notes

- **No hardcoded stock list, no synthetic news, no placeholder OHLCV.** All data flows from public sources.
- yfinance is rate-limited but free; no API key required. If Yahoo is unreachable on first launch, the universe download fails gracefully and the UI will show the empty-state — re-running `/api/stocks/seed` recovers.
- Some symbols use share-class separator differences across data sources (NASDAQ uses `BRK.B`, Yahoo uses `BRK-B`). The backend normalises automatically.
- yfinance API limits: hourly history ~700 days, 5-min history ~60 days. The lazy-load logic respects these caps.
