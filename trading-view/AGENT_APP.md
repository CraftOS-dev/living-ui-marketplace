# Trading View

> Per-project plan, context and index. Keep it current with every change.

## What this app does

A trading terminal for people who trade all day: workspaces (tabs) of
drag-and-resize widgets over live market data, with an AI agent that reads
charts, draws levels, sets alerts, reviews watchlists and explains alerts
when they fire.

- **Markets**: stocks, ETFs, indices, currencies and futures from Yahoo
  Finance (delayed up to 15 minutes for most exchanges) and crypto spot
  pairs from Binance (live), written `AAPL`, `^GSPC`, `EURUSD=X`, `GC=F`,
  `BINANCE:BTCUSDT`. No account or key.
- **Workspaces**: a 24-column by 36-row grid sized to the window; widgets
  are dragged by their header and resized from the right edge, bottom edge
  or corner; maximize (double-click a header), duplicate, remove, lock a
  layout. Templates: Markets, Crypto, Multi-timeframe, Research, Blank.
  Link channels 1 to 6 (colored dot on each widget): widgets on a channel
  follow one symbol and interval; a watchlist click or the command palette
  changes the channel.
- **Widgets**: chart, multi-timeframe grid (2 to 6 intervals), watchlist,
  details, AI analyst, news, alerts, screener, heatmap, ticker strip,
  activity.
- **Charts** (lightweight-charts 5.2): candles, hollow, Heikin Ashi, bars,
  line, area, baseline; normal, log, percent and indexed scales; 31
  indicators on the price or in their own panes (`lib/ta.js`); up to five
  comparison symbols; pre/post-market bars with shading; dividends and
  splits; bar-close countdown; alert lines, the AI agent's levels and the
  extended-hours price on the axis; older history loads while scrolling
  back; time zone of the exchange, the computer or UTC.
- **Drawings** in time/price coordinates (they stay put at every interval
  and show on every chart of the symbol): trend line, ray, horizontal line
  and ray, vertical line, rectangle, parallel channel, Fibonacci
  retracement, long and short position (R:R), text, arrows, measure.
  Select, drag points or the whole drawing, restyle, label, lock, delete,
  alert on a line. Magnet snaps to OHLC.
- **Alerts** checked by the server every minute (also with the window
  closed) and on every quote refresh while the app is open: price, today's
  change or any indicator against a value, another indicator or a drawn
  line; crosses, crosses up/down, above, below; once, once per bar or
  every time; expiry; message; sound and toast; optionally sent to the AI
  agent.
- **AI agent**: Ask AI on any chart (question or preset) or watchlist; the
  agent's analysis (bias, summary, levels, the numbers it used) shows in
  the AI analyst widget and its levels and drawings on the chart (accent,
  dashed) until the person keeps or clears them. Every change by the person
  or the agent is in the activity log with undo and redo; the agent's
  changes are grouped into runs that can be reverted as a whole.
- **Keyboard**: Ctrl K palette (symbols and commands), typing letters on a
  chart searches a symbol, digits change the interval, Alt T/H/V/F tools,
  Alt A alert, Alt R reset, Ctrl Z / Ctrl Y undo and redo, arrow keys in a
  watchlist.

The look: one top bar, then widgets edge to edge as flat panes split by
1px rules; 28px headers, 26px rows, 12 to 13px type with tabular numbers;
near-monochrome (ink on the card), color only for up/down (three
palettes), link channels, indicator lines and the accent for the selection
and the AI agent. No emoji, line icons only. Colors are derived from the
host theme (`lib/themeColors.ts`), light and dark.

**Start every agent session with `agent-app run <project> app.guide`**: it
returns what is on screen, the conventions and ready-to-run recipes.

## Requirements

See `reference/requirements.md` and the research behind the design in
`../reports/Trading platform UI UX survey.md`.

## Entities

| Collection | Purpose | Notes |
|------------|---------|-------|
| settings | One row: `palette`, `tz_mode`, `active_workspace`, `agent_markup`, `sound` | Seeded by the migration |
| workspaces | `name`, `sort`, `links` (channel -> {symbol, interval}), `locked` | Seeded on first use from templates (`lib_workspace.ensureSeed`, inside a transaction) |
| widgets | `workspace`, `type`, `link` (channel or empty), `x`/`y`/`w`/`h` (grid cells), `config` (per type) | Cascade with the workspace |
| symbols | Cached instrument details: name, exchange, type, currency, tz, price hint, sessions (+ gmtoffset, first trade) | Refreshed after 24 hours |
| bars | OHLCV cache, one row per `key` (`SYMBOL\|interval[+x]`) and `t` | Unique (key, t); written with raw SQL upserts; no API rules |
| watchlists / watch_items | Lists; rows are symbols or section headers with `flag`, `note`, `sort` | Items cascade with the list |
| drawings | `symbol`, `tool`, `points` [{t, p}], `style`, `text`, `note`, `locked`, `hidden`, `added_by`, `run` | |
| alerts / alert_events | Condition JSON `{left, op, right}`, frequency, expiry, status, last check state; events with price, detail, `agent_state`, `agent_note` | Events cascade with the alert |
| analyses | Symbol (or watchlist) analyses: `state`, `focus`, `summary`, `bias`, `levels`, `facts` snapshot, `run` | |
| screens | Saved screener definitions | |
| activity | Every change: actor, run, op, summary, target, `undo` / `redo` steps, `undone` | Pruned after 90 days |

## Operations

77 operations in `operations.json` (generated with the route cross-check).
Groups: `app.guide|context`; `settings.*`;
`market.search|quotes|bars|info|news|events|health|live`;
`indicators.catalogue`; `chart.indicators|levels|explain`;
`workspaces.list|get|create|update|delete|duplicate|activate|reorder|focus`;
`widgets.add|update|layout|remove`; `charts.set|add_indicator|remove_indicator`;
`watchlists.list|get|create|update|delete|add|remove|move|item`;
`drawings.list|add|update|delete|clear|adopt`;
`alerts.list|create|update|delete|events|seen|check|respond`;
`analyses.request|list|get|start|complete|fail|cancel|delete`;
`screener.universes|fields|run|heatmap`; `screens.list|save|delete`;
`activity.list|undo|redo|runs|revert_run`.

Routes: `ops_market.pb.js` (guide, context, settings, market data, chart
readings), `ops_workspace.pb.js` (workspaces, widgets, charts),
`ops_lists.pb.js` (watchlists, drawings), `ops_agent.pb.js` (alerts,
analyses), `ops_screener.pb.js` (screener, screens, activity). Logic lives
in the `lib_*.js` modules, required inside each handler.

## Agent triggers

| Trigger | Fired when | What the agent does |
|---------|------------|--------------------|
| `analysis_requested` | Ask AI on a chart or a watchlist (`analyses.request`); the minute cron re-asks when a fire was refused by the cooldown or lost to a restart | `analyses.start`, reads `chart.explain` / `chart.levels` (and news), marks the chart with a few drawings, `analyses.complete` with bias, summary and levels (or `analyses.fail`); a watchlist review flags rows with `watchlists.item` |
| `alert_fired` | An alert with `notify_agent` fires | `alerts.events --agent waiting`, `chart.explain`, then `alerts.respond --note` |

Work the agent took and left is failed by `tv_agent` after 4 quiet minutes
or 25 minutes in any case; alert events nobody picked up close after a day
(`lib_agent.settleStale`). App hooks never read the `agent_requests` queue.

Agent calls carry the `x_a2app_agent` header; `lib_util.actor` groups them
into runs (gaps under 10 minutes), stamped on drawings, alerts, analyses,
screens and activity, so a run can be reviewed and reverted.

## External data

| Source | Used for | Called from |
|--------|----------|-------------|
| Yahoo Finance `query1.finance.yahoo.com` (v8 chart, v7 spark, v1 search, v1 predefined screeners) | Bars, instrument details and sessions, dividends and splits, batched quotes (and pre/post-market prices), symbol search, news, market lists | `lib_yahoo.js` through `lib_http.js` |
| Binance market data `data-api.binance.vision` (klines, 24h tickers, price list) | Crypto bars, quotes, pair search | `lib_binance.js` through `lib_http.js` |

`lib_http.js` rate-limits each provider (token bucket: Yahoo 3/s, Binance
12/s), retries 429/5xx with backoff, cools down for a minute after
throttling and records health; while a provider is down the app serves
cached bars marked stale ("Cached" in the chart legend, "Data delayed" in
the top bar).

## Market data pipeline (`lib_market.js`)

- `series(symbol, interval, {count, before, ext, force})`: refreshes the
  cached tail only when its freshness window passed (2 s to 30 s while the
  market trades, 15 to 30 minutes when it is closed, from the sessions),
  backfills older bars on demand (`before`), and marks history complete
  when the provider has no more. A provider's in-progress bar stamped with
  the current time is merged into its bar (`tidy`) and a refreshed tail
  replaces the cached one from its first bar.
- Yahoo 4h bars are built from 1h bars: a group starts at each session
  open (a break over 90 minutes) and spans up to 4 hours (US stocks: 09:30
  and 13:30); round-the-clock series align to 00:00 UTC.
- Pre/post-market bars are a separate cache key (`+x`); the browser shades
  them using the exchange's time zone (Intl), which handles daylight saving.
- Quotes are batched (20 symbols per Yahoo spark call, 50 per Binance
  call) and kept 9 s (Yahoo) or 2.5 s (Binance) in memory; one
  `market.live` call per refresh tick serves every widget.

## Background jobs

- `tv_alerts` (every minute): checks every active alert, grouped by symbol
  and interval.
- `tv_agent` (every minute): re-asks the agent about waiting analyses and
  alert reactions, settles work left busy.
- `tv_prune` (03:23 daily): drops 1m bars older than 35 days and 5m to 30m
  bars older than 120 days, and activity and seen alert events older than
  90 days.

## Gotchas

- Hooks do not hot-reload: restart the app after any hook change.
- Upgrading from the first Trading View: the schema migration keeps the
  old watchlist (as "My watchlist") and price alerts, then deletes the old
  `watchlist`, `alerts`, `drawings` and `prefs` collections (two names are
  reused; the old drawing data had no defined format). The default lists
  and workspaces are added next to it on first use.
- `frontend/src/app/lib/ta.js` is `pb/pb_hooks/lib_ta.js` with `export` in
  place of `module.exports`; keep the bodies identical (the agent quotes
  the numbers the chart shows). Check:
  `diff <(sed -n '10,$p' pb/pb_hooks/lib_ta.js | sed '/^module.exports = {/,$d') <(sed -n '10,$p' frontend/src/app/lib/ta.js | sed '/^export {/,$d')`.
- Handlers run in isolated VMs: no helpers at file scope in `*.pb.js`.
- `require()` costs about 1.6 ms per call: per-row code (bars, serializers)
  stays require-free.
- Yahoo refuses a request window wholly in the future ("Data doesn't
  exist"): `fetchYahoo` stops at now.
- Yahoo intraday reach: 1m about 30 days (7 per request), 5m to 30m about
  60 days, 1h about 2 years; `REACH` and `SPAN` in `lib_yahoo.js`.
- v7 quote and quoteSummary need a crumb: never used; open price and
  statistics come from bars, quotes from spark.
- The chart library draws its axis in UTC: bar times are shifted into the
  chart's zone (`lib/time.ts`); drawings and alerts keep real unix times and
  convert through fractional logical indexes (`engine.timeToX/xToTime`).
- The chart's pointer handler only takes presses on the plot's canvas, so
  the legend and the drawing toolbar keep their own clicks; while a tool is
  active the press is prevented so the chart does not pan.
- Primitives are detached before `chart.remove()` (the countdown's timer
  would otherwise touch a disposed chart).
- Popovers render in a portal and clamp to the window (widgets clip).
- react-grid-layout 2.3 re-renders a grid item only when its grid cell
  changes, so a dragged or resized widget would sit still and then jump a
  cell. `workspace/Grid.tsx` re-renders the grid once per animation frame
  during a gesture (`onDrag` / `onResize`); widget contents are memoized
  (`Body`) so that stays cheap. A press on a header or resize handle puts
  `tv-gesture` on `<html>` (no text selection, gesture cursor) and the
  started gesture adds `tv-gesture-on` (widgets take no hover). Switching
  off pointer events at the press itself would stop the drag from starting.
- The UI subscribes to all collections once at startup (`lib/live.ts`) and
  reloads itself when the served app script changes, waiting while a
  dialog is open or something is being typed.
- Colors come only from `--tv-*` tokens derived in `lib/themeColors.ts`
  (the chart canvas reads `chartColors()`); never hardcode a color in a
  component.

## Ownership map

- Editable: `frontend/src/app/`, `pb/pb_migrations/` (new files only),
  `pb/pb_hooks/*.pb.js` and `lib_*.js` (not the `_*.js` system files),
  `operations.json` (non-system entries), `triggers.json`, this file,
  `reference/`.
- System-managed (never edit): `frontend/src/kit/`,
  `frontend/src/main.tsx`, `frontend/src/config.gen.ts`, the underscore
  hooks (`pb/pb_hooks/_*.js`), `manifest.json` (capabilities are written by
  the gate).
