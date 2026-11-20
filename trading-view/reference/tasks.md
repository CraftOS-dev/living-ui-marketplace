# Tasks: Trading View

Every task cites what it implements. These features already exist in the published app `trading-view` 2.0.0, so the build tasks are recorded as done.

## Build
- [x] T-1 (F-LOOK-1, F-LOOK-2, F-LOOK-4): the flat terminal look: one top bar, edge-to-edge panes on 1 px rules, 28 px headers, 26 px rows, tabular numbers, near-monochrome with color only for meaning, line icons and no emoji (`theme.css`, `components/ui.tsx`).
- [x] T-2 (F-LOOK-3, F-SET-1): `--tv-*` colors derived from the host theme tokens with contrast checks and re-derived on every theme or up/down palette change, including the chart's colors (`lib/themeColors.ts`).
- [x] T-3 (F-LOOK-5): popovers and menus in a portal, clamped inside the window (`Popover`, `ContextMenu` in `components/ui.tsx`).
- [x] T-4 (F-LOOK-6, F-MKT-5): the realtime hub subscribing to every collection once, the reload onto a newly deployed build, and the single market polling loop (`lib/live.ts`).
- [x] T-5 (F-WS-1, F-WS-2, F-WS-3): workspace tabs with rename, drag to reorder, the "+" templates and the tab menu (duplicate, lock, delete with confirmation, at least one kept); templates and first-use seeding in one transaction (`workspace/TopBar.tsx`, `lib_workspace.js`).
- [x] T-6 (F-WS-4, F-WS-6, F-WS-11): the 24 × 36 grid sized to the window with drag and three resize handles, per-frame following during a gesture, locked layouts, maximize and restore, and the phone stack below 720 px (`workspace/Grid.tsx`).
- [x] T-7 (F-WS-5, F-WS-7, F-WS-9, F-WS-10): the widget catalogue and registry with minimum sizes, the widget frame (header, focus line, menu with maximize, duplicate, remove) and the empty-workspace state (`workspace/registry.tsx`, `workspace/WidgetShell.tsx`).
- [x] T-8 (F-WS-8): link channels 1 to 6 with the channel menu, widgets following their channel, and unlinked widgets keeping their own symbol (`lib/store.tsx`, `workspaces.focus`).
- [x] T-9 (F-TOP-1, F-TOP-2, F-TOP-3, F-TOP-4, F-TOP-5): the top bar with search, Widget, undo and redo, the fired-alerts panel with its unseen badge, the AI agent panel with runs and revert, the data status, and settings (`workspace/TopBar.tsx`).
- [x] T-10 (F-PAL-1, F-PAL-2): the command palette with symbols and commands, and symbol search with live quotes, suggestions and typed-ticker fallback (`workspace/Palette.tsx`, `components/SymbolSearch.tsx`).
- [x] T-11 (F-MKT-1, F-MKT-2): Yahoo Finance and Binance clients, canonical symbols, the persistent bar cache with freshness windows, scroll-back history and 4h bars aligned to sessions (`lib_yahoo.js`, `lib_binance.js`, `lib_market.js`).
- [x] T-12 (F-MKT-3): per-provider token buckets, retries with backoff, cool-downs and health records; cached bars served marked stale (`lib_http.js`).
- [x] T-13 (F-MKT-4): pre/post-market bars as their own cache key, shaded in the exchange's time zone, and the extended-hours price (`lib_market.js`, `lib/time.ts`, `chart/primitives.ts`).
- [x] T-14 (F-CHT-1, F-CHT-2, F-CHT-3, F-CHT-7, F-CHT-12, F-CHT-13): the chart widget header and footer: symbol, interval favorites and list, chart type, scales, range presets, picture download, own interval on a linked chart (`chart/ChartWidget.tsx`).
- [x] T-15 (F-CHT-4): 31 indicators in one library shared by server and View, the searchable catalogue and per-indicator settings, at most 16 per chart (`lib_ta.js`, `lib/ta.js`, `components/IndicatorDialog.tsx`).
- [x] T-16 (F-CHT-5, F-CHT-6, F-CHT-8, F-CHT-9, F-CHT-10): comparisons, extended hours, the legend, price lines for alerts, the agent's levels and the extended-hours price, dividends and splits, the bar-close countdown, and the axis time zone (`chart/ChartView.tsx`, `chart/engine.ts`, `lib/time.ts`).
- [x] T-17 (F-CHT-11, F-CHT-14): the chart's context menu, keyboard (letters, digits, Alt keys, Escape, Delete), and its loading, empty, error and stale states (`chart/ChartView.tsx`).
- [x] T-18 (F-DRW-1, F-DRW-2, F-DRW-3, F-DRW-4): the drawing layer in time/price coordinates with 15 tools, selection, point and whole-drawing drags, the selected-drawing toolbar, magnet, lock and Delete; points validated per tool on the server (`chart/drawings.ts`, `lib_drawings.js`).
- [x] T-19 (F-DRW-5, F-ANL-4): the agent's drawings as markup, keep (`drawings.adopt`), clear (`drawings.clear`), and the markup switch.
- [x] T-20 (F-MTF-1, F-MTF-2): the multi-timeframe widget with six layouts, per-pane intervals and "Ask AI" across the intervals (`widgets/ChartGrid.tsx`).
- [x] T-21 (F-WL-1, F-WL-2, F-WL-3, F-WL-4, F-WL-5): the watchlist widget: lists, columns, sections, sorting, drag reorder, flags, notes, row menu, arrow keys and Delete; a symbol at most once per list (`widgets/Watchlist.tsx`, `ops_lists.pb.js`, `lib_watch.js`).
- [x] T-22 (F-WL-6, F-AGT-5): "Ask AI to review this list" queues a watchlist analysis; the agent's flags and notes appear on the rows (`analysis_requested` playbook).
- [x] T-23 (F-DET-1, F-DET-2): the Details widget with quote, market state, ranges, statistics from daily bars, performance, sessions, dividends and splits (`widgets/Details.tsx`, `market.info`).
- [x] T-24 (F-NEWS-1): the News widget for the symbol or the market, refreshed every 5 minutes (`widgets/News.tsx`, `market.news`).
- [x] T-25 (F-ALR-1, F-ALR-2, F-ALR-7): the alert dialog with left side, comparison, right side, interval, frequency, expiry, message and the condition in words; entry points across the widgets; immediate fire when the condition already holds (`components/AlertDialog.tsx`, `lib_alerts.js`).
- [x] T-26 (F-ALR-3, F-ALR-4, F-ALR-8): server-side checks every minute (`tv_alerts`) and on quote refresh (`market.live`), crossings against the previous check, expiry, paused alerts when the watched line is gone, and the in-app toast with beep (`lib_alerts.js`, `lib/store.tsx`).
- [x] T-27 (F-ALR-5, F-ALR-6, F-AGT-6): the Alerts widget (alerts and log, symbol filter, pause, edit, delete) and "Send to my AI agent" with the `alert_fired` trigger and its playbook (`widgets/Alerts.tsx`, `alerts.respond`).
- [x] T-28 (F-SCR-1, F-SCR-2, F-SCR-3): the screener over the ready-made universes, Yahoo market lists and watchlists, with quote and technical fields, presets, saved screens and results to a watchlist (`widgets/Screener.tsx`, `lib_screener.js`).
- [x] T-29 (F-HEAT-1): the squarified heatmap colored by change, equal or by traded value, grouped or not (`widgets/Heatmap.tsx`, `screener.heatmap`).
- [x] T-30 (F-TCK-1): the ticker strip with its symbol editor (`widgets/Ticker.tsx`).
- [x] T-31 (F-ANL-1, F-ANL-2, F-ANL-3, F-ANL-5): the AI analyst widget and the Ask AI dialog with presets; one analysis per target, cancel while waiting, analyses with bias, summary, levels, facts, notes on alerts and watchlist reviews (`widgets/Analyst.tsx`, `workspace/Dialogs.tsx`, `lib_agent.js`).
- [x] T-32 (F-AGT-7, F-AGT-8): the minute job `tv_agent` that re-asks waiting work and settles work the agent abandoned (4 quiet minutes, 25 minutes, one day for alert reactions) (`lib_agent.js`, `hooks.pb.js`).
- [x] T-33 (F-ACT-1, F-ACT-2, F-AGT-9): the activity log with undo and redo steps applied in one transaction, agent runs by call gaps under 10 minutes, run revert, and the Activity widget (`lib_activity.js`, `lib_util.actor`, `widgets/Activity.tsx`).
- [x] T-34 (F-SET-2, F-SET-3): the settings panel (palette, time zone, alert sound, AI markup, keyboard list) and `settings.update`.
- [x] T-35 (F-AGT-1, F-AGT-2, F-AGT-3, F-AGT-4, F-AGT-10): the 75 operations in `operations.json`, served to agents by `a2app_routes.pb.js` through the same handlers the View calls; `app.guide` and `app.context`; chart readings for the agent (`lib_chart.js`); destructive operations through the adapter's approval.

## Verification
- [x] Framework-files check (`validateFrameworkFiles` of the Agent App CLI) reports no problems for manifest.json, operations.json, AGENT_APP.md, reference/requirements.md and reference/tasks.md.
- [x] ## Operations Design in reference/requirements.md lists exactly the 75 operations of operations.json, each under its declared module.
- [ ] Agent App Framework gate (`agent-app <dir> validate`) passes, including the describe budget on a dev instance.
- [ ] Every declared operation answers through `a2app` on a live instance.
- [ ] The View renders identically to the published build (screenshot comparison).
