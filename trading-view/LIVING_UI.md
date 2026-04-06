# Trading View

A TradingView-like trading dashboard with interactive candlestick charts, technical indicators, real-time price simulation, and a fully customizable draggable widget layout. Designed for traders and market enthusiasts who want to monitor stocks, analyze charts, set price alerts, and screen stocks — all without executing trades.

## Overview

This app replicates the core TradingView experience: interactive multi-timeframe charts with 6 chart types, 6 technical indicators, extended drawing tools, a live watchlist, stock screener, market overview, news feed, and price alerts. Stock data is seeded from realistic base prices and simulated using Geometric Brownian Motion for real-time price updates. The layout is fully customizable with draggable/resizable widgets.

## Data Model

| Model | Fields | Description |
|-------|--------|-------------|
| Stock | symbol, name, sector, marketCap, exchange | Core stock/ticker entity (~30 stocks) |
| StockPrice | stockId, price, openPrice, high, low, prevClose, volume, change, changePct | Current price snapshot per stock |
| Candle | stockId, timeframe, timestamp, openPrice, high, low, closePrice, volume | Historical OHLCV candle data |
| Watchlist | stockId, sortOrder | User's watchlist entries |
| PriceAlert | stockId, targetPrice, condition, triggered, triggeredAt, active | Price level alerts |
| Drawing | stockId, timeframe, toolType, drawingData, color | Chart annotations/drawings |
| WidgetLayout | layoutName, layoutData, chartConfig | Saved dashboard layout |
| MarketNews | stockSymbol, headline, summary, source, publishedAt | Market news articles |
| SimulationState | lastTickTime, isRunning, tickCount | Simulation engine state |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /stocks/seed | Seed stock universe with initial data |
| GET | /stocks | List all stocks with prices |
| GET | /stocks/search?q= | Search stocks by symbol/name |
| GET | /stocks/prices | Bulk current prices (advances simulation) |
| GET | /stocks/{symbol}/price | Single stock current price |
| GET | /stocks/{symbol}/candles | OHLCV candle data with timeframe/limit/since |
| GET | /stocks/{symbol}/indicators | Computed technical indicators |
| GET | /stocks/{symbol}/drawings | Get drawings for a stock |
| POST | /stocks/{symbol}/drawings | Create a chart drawing |
| PUT | /drawings/{id} | Update a drawing |
| DELETE | /drawings/{id} | Delete a drawing |
| GET | /watchlist | Get watchlist with live prices |
| POST | /watchlist | Add stock to watchlist |
| PUT | /watchlist/reorder | Reorder watchlist items |
| DELETE | /watchlist/{id} | Remove from watchlist |
| GET | /screener | Filter/sort stocks by criteria |
| GET | /alerts | Get price alerts |
| POST | /alerts | Create a price alert |
| DELETE | /alerts/{id} | Delete an alert |
| GET | /alerts/triggered | Get recently triggered alerts |
| GET | /layout | Get saved widget layout |
| PUT | /layout | Save widget layout |
| GET | /news | Get market news |
| GET | /settings | Get user settings |
| PUT | /settings | Update user settings |

## Frontend Components

| Component | Description |
|-----------|-------------|
| MainView | Root orchestrator, manages state and renders layout |
| DashboardLayout | react-grid-layout wrapper with responsive breakpoints |
| WidgetWrapper | Widget container with title bar, drag handle, close/minimize |
| TopBar | Navigation bar with search, layout controls |
| ChartWidget | Interactive chart using lightweight-charts (6 chart types, indicators) |
| WatchlistPanel | Live price watchlist with add/remove/reorder |
| StockDetailsPanel | Detailed stock info with key statistics |
| ScreenerPanel | Stock screener with filters and sortable results table |
| NewsPanel | Market news feed with time-ago display |
| AlertsPanel | Create/manage price alerts with trigger history |
| MarketOverviewPanel | Index ETFs and sector performance overview |
| SearchModal | Global stock search (Ctrl+K) |
| MobileNavBar | Bottom tab navigation for mobile views |

## Key Files

| File | Purpose |
|------|---------|
| backend/models.py | 9 SQLAlchemy models |
| backend/routes.py | 25+ REST API endpoints |
| backend/simulation.py | GBM price simulation engine |
| frontend/types.ts | TypeScript interfaces |
| frontend/AppController.ts | API client, polling, state management |
| frontend/components/ChartWidget.tsx | lightweight-charts integration |
| frontend/components/DashboardLayout.tsx | react-grid-layout dashboard |
| frontend/styles/global.css | TradingView dark theme tokens |

## Technical Details

- **Chart Library:** lightweight-charts v4 (TradingView's open-source library)
- **Layout Library:** react-grid-layout with responsive breakpoints
- **Price Simulation:** Geometric Brownian Motion with sector correlation
- **Data Polling:** Prices every 3s, alerts every 5s, news every 60s
- **Theme:** Dark-only, matching TradingView's color scheme
- **Responsive:** Desktop (1280px+), tablet (768-1279px), mobile (<768px)
