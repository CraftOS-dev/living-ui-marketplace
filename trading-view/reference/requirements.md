# Trading View: requirements

## Origin

The first Trading View (V1 Living UI, ported to PocketBase in 2026) was a
dashboard of draggable widgets: a candlestick chart from Yahoo Finance
with a few indicators, a watchlist, and widgets for quotes and news. It
fetched the provider on every render (throttled quickly, sometimes showed
the wrong symbol), had no drawings, no alerts, no saved layouts beyond one
grid, and the AI agent could do little more than read it. This rebuild
keeps the idea, a widget dashboard around charts, and makes it a
production trading terminal.

## Binding (asked for by the person on 2026-10-28)

1. Research first: the state-of-the-art platforms (TradingView, Bloomberg,
   thinkorswim, Koyfin, TrendSpider, TradingLite, Sierra Chart, cTrader,
   MetaTrader and others), their UI, UX, features and design, and the gaps
   of the old app (`../reports/Trading platform UI UX survey.md`).
2. Workspace: a drag-and-resize widget dashboard (Koyfin/Legend style)
   with link channels, named layouts in tabs and a widget catalogue.
3. Markets: stocks, ETFs, indices and forex through Yahoo, plus crypto
   through Binance. No broker or paid feed.
4. Heavy AI agent integration: the agent can do everything the person
   can, analyzes charts and watchlists on request, draws its levels as
   markup the person keeps or clears, sets and explains alerts, and every
   change it makes is grouped in a run that can be reverted.
5. Production level for a client who trades heavily: no placeholder copy,
   a control works end to end or is not shown; fast, dense, keyboard
   driven; correct data handling (caching, rate limits, sessions, time
   zones, delayed-data disclosure).
6. The look follows the Research Board rebuild: no backdrop or double
   background, no wasted padding, flat panes, high contrast, almost no
   color (color only for meaning), no emoji (line icons). Popovers stay
   inside the window.
7. Every UI action has an operation the AI agent can call.

## What was added

Persistent bar cache with incremental refresh and scroll-back history,
provider rate limiting and health; 4h bars aligned to sessions;
pre/post-market data; 31 indicators shared by server and chart; seven
chart types, four scales, comparisons; fifteen drawing tools; server-side
alerts on price, change, indicators and drawn lines; screener over seven
universes, Yahoo market lists and watchlists with technical fields;
heatmap; multi-timeframe grid; details with statistics and sessions; news;
command palette; time-zone choice; three up/down palettes; activity log
with undo, redo and AI run revert; AI analyst; templates and link channels.
