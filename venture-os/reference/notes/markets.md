# markets builder notes

Built 2026-11-12: sourcing radars under a thesis over keyless public sources, the candidates they bring (screened by your AI agent, one click to the Inbox), market maps with relations computed from the firm's deals and holdings, comparison grids from a map selection (diligence's grid), the Markets page, the Focus card for a radar run's candidates and the Sourcing settings section. 17 operations, 2 job kinds, 4 cron entries, 4 collections.

## Files (copied into APP)

- `pb/pb_migrations/1741008000_markets.js`: `radars, signals, maps, map_entries` (every rule null).
- `pb/pb_hooks/lib_markets.js` (radars, signals, Next, search, timeline, cron, contract), `lib_markets_maps.js` (maps), `lib_markets_pull.js` (the keyless sources: pure parsers and filters plus the `$http` pulls; Node-testable).
- `pb/pb_hooks/cat_markets_radar.js`, `cat_markets_maps.js`, `events_markets.js`, `cron_markets.js`, `guide_markets.js`.
- `frontend/src/app/pages/markets/` (`index.tsx`, `MarketsPage.tsx`) and `frontend/src/app/components/markets/` (ThesisTiles, ThesisSheet, ChipSet, RadarTab, SignalSheet, SourceLink, MapTab, MapBoard, GridTab, CandidatesCard, SourcingSettings, actions, pulling, types).
- `reference/tests/markets/` (t01 to t04, `run_all.mjs`, UI scripts `ui_seed.mjs`, `ui_shots.mjs`, `ui_flows.mjs`, `ui_hover.mjs`, `fixtures/` with saved SEC answers, `stubs/` test kit, README).

## Sources

| Source | Who pulls | How |
|---|---|---|
| `edgar_form_d` | Venture OS | SEC EDGAR latest-filings Atom feed (form D, D/A on request) and, when the feed does not reach back to the radar's cursor, the daily form index of up to 7 business days; then each new filing's `primary_doc.xml` (issuer, state, year of incorporation, industry group, offering and sold amounts, officers). Declared User-Agent (Settings, Sourcing; default the firm name and the owner's email), 150 ms between requests (under 10 a second). A document another radar already read is reused from its signal. |
| `hacker_news` | Venture OS | Hacker News API (Firebase): the Show HN list, each new item by id (no key, no rate limit). |
| `github` | Venture OS | GitHub repository search (unauthenticated), one search per run with the radar's query, created in the window, minimum stars. |
| `companies_house` | your AI agent | Needs a registered key (the API answers 401 without one), so the app never calls it; a radar that lists it asks your AI agent to search it with its own access (job payload `agent_sources`). |
| `jp_corporate` | your AI agent | Japan corporate number API and gBizINFO need an application id or token: as above. |

Product Hunt is not used (its API forbids commercial use). Hosts the gate derives from my code: www.sec.gov, hacker-news.firebaseio.com, api.github.com, news.ycombinator.com (the Show HN discussion link stored as each signal's source).

Every app-side filter is structured (Form D industry group enumeration, US state codes, amounts, years, points, stars); free text goes only to GitHub's own search and to your AI agent. Pooled investment funds never pass.

## Data model

- `radars` (one per thesis): thesis, name, sources, filters (per source), query, schedule `{every: daily|weekly, day, time}` in the firm's zone, status, next_run_at, last_run_at, runs, last_counts (per source: pulled, new, known, out, error, left), cursors, last_job, prov.
- `signals`: radar, thesis, run (0 = pulled between runs, delivered with the next run), source (`edgar_form_d, hacker_news, github, companies_house, jp_corporate, agent, person`), kind, ext_id (unique per radar and source), name, domain, website, company, title, summary (your AI agent's one line), source_url, payload, facts (thesis fact keys, graded), fit (the engine's tri-state result), context (`founders, hiring, connections, prior, traction, links`), licence (`public | internal_only`), status (`new, candidate, screened_out, known, dismissed, added`), reason, known_as, intake_item, decided_by.
- `maps`: name, thesis, segments `[{key, label}]` (at most 12), status, last_refresh_at.
- `map_entries`: map, company, segment, role (`tracked | competitor`), note, source_url, licence, status (`active | removed`), added_day, removed_day, moves `[{day, at, from, to, by}]` (the dated history; `maps.get --as_of` rebuilds any past day).

Rules applied by code only: a structured filter fails, or a required thesis criterion is unmet by structured facts (lib_theses.fit; unknown is never unmet): `screened_out`; the company is already in the firm's records (root domain or exact name key; intake and deals create their companies there): `known`; else `new`, waiting for your AI agent. Net-new = new + candidate. Signals screened out or known are deleted after 60 days.

## Operations (17) and agent rules

| Op | Perm | Your AI agent |
|---|---|---|
| theses.summary | markets:view | allow (one tile per thesis: net-new, weekly candidates for 12 weeks, maps, radar with its StepTrack) |
| radars.options | markets:view | allow |
| radars.list, radars.get | markets:view | allow |
| radars.save | markets:edit | propose (kind `radars`, always asks) |
| radars.run | markets:edit | allow (untracked: network; refused within a minute of the last run, `too_soon`) |
| signals.list | markets:view | allow (delivered signals only) |
| signals.add | markets:edit | allow (needs `source_url` and a one-line `summary` from your AI agent; repeats and known companies are answered, not added) |
| signals.screen | markets:edit | allow (batch verdicts on new signals) |
| signals.dismiss | markets:edit | deny |
| signals.to-inbox | markets:edit | deny (calls `lib_intake.add({channel: 'sourced', company, name, website, text, thesis, licence})`) |
| maps.list, maps.get | markets:view | allow |
| maps.save | markets:edit | propose (kind `maps`, always asks) |
| maps.place | markets:edit | deny (people: add, move, remove a tile) |
| maps.propose | markets:edit | propose (kind `map_entries`, promotable; needs `source_url`; a person's call applies directly) |
| maps.accept | markets:edit | deny (untracked; accepts the map's pending proposals, each its own undo unit) |

Counts: 11 allow, 3 propose, 3 deny (plus `theses.*` of kernel-records, used as is).

## Next, jobs, cron, settings, search, timeline

- Next kind `candidate`, card `candidates`, rank 60: one item per radar run with open signals, title "Fintech infra · 7 new", chips by source (and "n unscreened"), `data.candidates` (id, display, summary, title, source, source_label, source_url, kind, licence, status, fit), actions Add all (`signals.to-inbox`, primary) and Dismiss all. Unscreened signals of the newest run wait while the sweep job is open; after that (or for older runs) they show too, so a person can always do it by hand. Map proposals are kernel proposals (card `proposal`).
- Jobs: `radar_sweep` (ref radars:<id>; payload radar, thesis, run, new, query, agent_sources) and `map_refresh` (ref maps:<id>). Recipes in `guide_markets.js`.
- Cron (`cron_markets.js`): `radars` every minute (due radars, two per tick, the next run claimed before pulling), `prefetch` at :07, :22, :37, :52 (Form D and Show HN between runs, so a weekly radar misses nothing), `map_refresh` Monday 07:00 (catch-up), `cleanup` 03:47.
- `settingsKeys.markets`: `user_agent` (''), `edgar_limit` 25, `hn_limit` 30, `github_limit` 30.
- Search: theses (`#/markets/<thesis>`) and maps (`#/markets/<thesis>/map`). Timeline: a company (or a deal's company) gets "Sourced by the radar X (source)" and "On the map Y".
- `job.done` subscriber stamps a map's `last_refresh_at`.

## Contract

`lib_markets.candidatesFor(ctx, thesisId) -> signals` (the thesis's open candidates, `signalOut` shape), as SPEC 4.6.

## Frontend

- Routes `#/markets`, `#/markets/:thesis`, `#/markets/:thesis/:tab` (radar default, map, grid); nav Markets (lucide Radar, order 80); card `candidates` (`{ body, figures: false }`); settings section Sourcing (order 50); command New thesis.
- Markets page: thesis tiles (name, net-new in mono, last run relative, weekly sparkline; breathing dot while pulling or screening), then tabs. Radar: 36 px rows (company and one line, source chip linking the source, signal kind), Add to Inbox and Dismiss icons on each row (Undo in the toast), selection bar for both, the candidate in a sheet one click deeper; toolbar shows the StepTrack Pull, Screen, Ready while at work, else the schedule (Mon 08:00). Map: legend of the five relations, columns of tiles, drag to move, click for sources and Move to (touch), add slot per column, rename and add segments in place, Select then Compare (diligence's `compareCompanies` opens the grid), Last quarter view, your AI agent's dashed tiles with Accept and Dismiss and Accept all, Sparkle to ask a refresh. Grid: diligence's `CompareGrid` for the grids `compare.list --market_ref` returns for the thesis and its maps, with chips to switch.
- New thesis sheet: Name, Sector and Stage chips at rest; Geography, Round size (firm currency), Sources (toggles; registries marked as your AI agent's), Schedule chips and Keywords behind More; Create saves thesis and radar and runs the radar at once.

## Decisions

- One radar per thesis (unique), created with the thesis from the same sheet.
- Delivery is the schedule; pulling is continuous (prefetch with `run = 0`), so candidates arrive at a predictable time without gaps.
- No Show HN or Form D title parsing: names come from structured fields (Form D issuer, GitHub organisation) or from your AI agent.
- The radar run is synchronous (results shown in place); typical 5 to 25 seconds.
- Your AI agent screens; the app never auto-adds to the Inbox.

## Needs and requests (reported, not edited)

- kernel-frontend: `TileMap` lacks drag between segments (`onMove`), selection, proposed (ghost) tiles, an always-five legend and an add slot; markets draws them in its own `MapBoard` on the same tokens and tile style. `ChipPicker` lacks a multiple mode; markets has `ChipSet` with the same look. Both could move into the kernel.
- diligence (done in the fix round): the Grid tab asks `compare.list --market_ref '[thesis, ...maps]' --origin markets`.
- intake (done in the fix round): the candidate's licence goes in `lib_intake.add`'s `licence` field. Markets passes `company` as a company id (made with `lib_records.upsertCompany`, origin markets), or `name` when the company is unknown, `website` when known, `text` (with the source link) and `thesis`; the source link is never passed as `url` (intake would read its host as the company's website).
- portfolio (done in the fix round): map relations use `lib_portfolio.holdingsFor(ctx, {company})`, so a holding counts only for a reader whose fund scope includes it.

## Known gaps

- Companies House and the Japan registry are searched by your AI agent, not pulled by the app (keys).
- A map's `as_of` view uses today's relations (deal statuses are not replayed).
- Form D: when the app was off for more than 7 business days the gap beyond is not read.
- GitHub unauthenticated search allows 10 searches a minute; many radars with GitHub at the same minute may hit `rate_limited` (shown on the tile).

## Tests and gate

- `reference/tests/markets/run_all.mjs` on the scratch copy (port 3191, bridge 3291): t01 empty sweep 64 passed, t02 radar flow 69, t03 maps 40, t04 sources 39 (offline parsers on saved SEC answers plus a live pull of Form D, Show HN and GitHub). 212 passed, 0 failed. Fix round, on a fresh copy of APP with every module (real intake, portfolio and diligence; only `lib_zz_markets.js` and its stub ops added): t01 64, t02 73 (intake items checked through `intake.get`: channel, company, thesis, licence public and internal_only), t03 42 (a holding imported through portfolio's importer; a partner scoped to another fund sees the tile as tracked), t04 39, `ui_flows.mjs` 19, shots of radar, map and grid clean; gate passes on that copy.
- UI: `ui_shots.mjs` 56 seeded and 8 empty screenshots (light and dark, 1440 and 390), no console errors or 5xx, one black primary per page, no sideways scroll; interface words at rest (data excluded): radar 7, map 18, grid 7, Focus card 18, Sourcing 19. `ui_flows.mjs` 19 passed (Add to Inbox with Undo, Dismiss and bulk, drag a tile, Accept all, Select then Compare to the grid, New thesis runs its radar, Focus card add, Sourcing read-only for a partner). `ui_hover.mjs`: every markets control changes on hover except selected tabs and chips and the kernel checkboxes (their box changes).
- `npm run build --prefix frontend` and `tsc` clean in scratch and in a merged copy of APP. Gate (`agent-app/tools/src/cli.ts validate`) passes on the scratch copy. `node tools/gen.mjs` passes in APP (341 operations).
- npm dependencies: none.

## Fix 3

### Contract `news.list` (for Home and the portfolio company page)

Op `news.list`, permission `markets:view` (every role that can read the app; your AI agent: allow). Read only, never pulls.

Params (all optional):

| Param | Values | Meaning |
|---|---|---|
| `scope` | `home` (default), `thesis`, `company` | `home`: the firm's news (portfolio companies, late-stage pipeline companies, thesis sectors), newest first. `thesis`: items about that thesis (its sector queries) plus items about companies on its maps or among its candidates. `company`: items about one company. |
| `ref` | thesis id or company id | Required for `thesis` and `company`; ignored for `home`. |
| `limit` | 1 to 50, default 12 | Rows returned. |

Answer `{ items: Row[], total: number }` (total = matching rows before the limit). Hidden items are never returned. Each row:

```ts
type NewsRow = {
  id: string;
  title: string;          // the headline
  url: string;            // the article (open in a new tab)
  source: string;         // publisher name, e.g. "Reuters"
  published_at: string;   // ISO UTC
  about: { kind: 'company' | 'sector' | 'thesis'; id: string; name: string }; // id: company id, thesis id ('' for a bare sector)
  summary: string;        // your AI agent's one sentence, '' when none yet
};
```

The frontend helper is `frontend/src/app/components/markets/news.ts` (`listNews(scope, ref, limit)` and the `NewsRow` type) and the list component `NewsList` in `frontend/src/app/components/markets/NewsList.tsx` (props `{ items: NewsRow[]; compact?: boolean }`), which other modules may import.

Other ops: `news.refresh` (pull now, people and your AI agent), `news.summarize` (your AI agent: `{items: [{id, summary}]}`), `news.hide` (people: `{id}`), `news.add` (people and the seed only).

### News: how it works

- Collection `news` (migration `1741009100_news.js`, every rule null): title, url (unique), source, source_url, published_at, summary, summarized_at, about_kind (`company | sector | thesis`), about_id, about_key (sector key), about_name, query, origin (`pull | person`), fetched_at, licence `public`, hidden, hidden_at, hidden_by, actor, member.
- Pull (`lib_markets_news.pullAll`, cron `news` at :11 every 2 hours with catch-up, and `news.refresh`): one Google News RSS search per query, US English edition, host literal `https://news.google.com/rss/search` (the gate declares `news.google.com`), parsed structurally (`<item>`, `<title>`, `<link>`, `<pubDate>`, `<source url>`), 400 ms between searches. Queries: each portfolio company (an active holding) and each deal-flow company open or on hold in Diligence, Partner meeting, IC or Term sheet, `"<name>" when:30d`, newest 5; each sector of an active thesis, `"<sector> startup" when:14d`, newest 8 (the phrase keeps it to startup news; plain `"Payments" startup funding` brought government payment stories). Companies first, so an article found by both keeps the company. Demo firm (`settings.mail.demo`): sector queries only.
- Kept: one row per url (Google's article link without `?oc=`), the headline without the " - Publisher" Google appends, articles of the last 60 days only; `news_cleanup` 03:53 deletes older ones.
- Order: `home` and `thesis` put first what matters (the last 7 days' items about the firm's companies or summarized by your AI agent), then the rest, newest first; `company` is newest first. Company items about a pipeline company are shown only to a reader who may see one of its deals (or a holding); a scout sees none.
- `news_digest` job (cron 07:30 with catch-up): the items fetched since the last digest, not summarized, not hidden (at most 60, in `payload.items`); one digest open at a time (a job without a ref is not deduped by lib_jobs). Recipe in `guide_markets.js`: read each article, summarize only the ones that matter (one sentence, at most 240 characters), never invent or add news.
- Ops: `news.list` (markets:view, agent allow), `news.refresh` (markets:view, agent allow, untracked, 409 `too_soon` within 2 minutes), `news.summarize` (your AI agent only: people get 403 `agent_only`), `news.hide` (markets:edit, agent deny; `--hidden false` shows it again; Undo through activity), `news.add` (markets:edit, agent deny; the seed's way in).
- Licence note: Google's feed carries a copyright line limiting it to personal, non-commercial feed readers. The brief names this source, so it is used as written; if the firm's counsel objects, swap `NEWS_SEARCH` and `parseRss` for a licensed news API (the rest is source-agnostic).

### Market map order

- `map_entries.position` (same migration): a tile's place in its segment, 0 first. `maps.place --position n` (and `maps.propose`) puts the tile at n in its segment (past the end = last) and numbers the segment 0..n; a tile added, moved to another segment or put back without a position goes last; a reorder in the same segment is "Reordered X in Payments" in the activity. `maps.get` answers entries by position, each with `position`. Every renumbering is part of the op's undo unit.

### Markets page (fix 3)

- `#/markets`: "News" (scope home, 6 items, Check now, Show more) beside "New companies found" (the newest 6 candidates across theses: name and website, one line, "Found on SEC filings" or "Found by your AI agent" linking the source, "for <thesis>", when, Add to Inbox and Dismiss with Undo); then "Your theses" as cards: name, criteria as plain chips (`criteriaChips`: sectors, "Seed to Series A", "US, Canada, UK and Germany", "SaaS or transactional", "Raising USD 2M to 10M"), "12 new companies to review", "Checked 2 hours ago from SEC filings, Show HN and GitHub". Empty: "Add a thesis to start finding companies" with New thesis.
- `#/markets/:thesis[/:tab]`: the thesis name as the page title (back to Markets), Check now, Edit, More (stop or start looking, archive); its chips and the review line; tabs New companies (`radar`), Market map (`map`), Compare (`grid`), News (`news`). Old links (`/map`, `/grid`) still work.
- Market map: legend of the five relations in words (In portfolio, In pipeline, Passed, Watching, Competitor; tooltips say what each means); the kernel `Board` (sort and move with the shadow placeholder, Move menu, Alt+Arrow; `onMove` saves `maps.place --segment --position`); tiles say the company and its relation ("In pipeline: Diligence") in the relation's colour; click a tile for the deal, source, last move, Watching or Competitor, Move to, Take off the map; toolbar Add company (segment chips, then search or a new name), Columns (rename, add), Compare companies (select, then Compare N companies), Ask your AI agent (Sparkle), Today or Last quarter; your AI agent's suggestions as a list above the board ("Add X to Payments: why", Source, Dismiss, Accept, Accept all).
- Shared for other modules: `components/markets/news.ts` (`NewsRow`, `NewsAnswer`, `NEWS_READS`, `newsParams`, `listNews`, `refreshNews`, `hideNews`) and `components/markets/NewsList.tsx` (`NewsList { items, compact?, onHide? }`, `NewsFeed { scope, refId?, limit?, empty, compact? }`, `NewsRefresh`).
- Removed: `components/markets/ThesisTiles.tsx` (replaced by `ThesisCards.tsx`).

### Fix 3 tests

- `reference/tests/markets/fix3_news.mjs` 32 passed, `fix3_ui_flows.mjs` 11 passed (with the shell agent's real Board), `t01_empty_sweep` 64 passed, `t03_maps` 42 passed (its proposal chip check now reads the kernel's "Market map" label); screenshots of every screen light and dark at 1440 and 390, seeded and empty, no console errors, no 5xx, no sideways scroll, no dashes, no "Unknown", one black primary at most.

## Fix 4

### Contracts for Home (published first; the home agent codes against these)

`news.list` (GET, `markets:view`, your AI agent allow; read only, never pulls). Params, all optional:

| Param | Values | Meaning |
|---|---|---|
| `scope` | `home` (default), `thesis`, `company`, `sector`, `all` | `home`: what matters to the firm first (last 7 days about its companies or summarized by your AI agent), then the rest, newest first. `all`: every item newest first. `thesis`: its sectors, its companies, and market items of its sectors. `company`: one company. `sector`: one thesis sector key (e.g. `fintech`). |
| `ref` | thesis id or name, company id, domain or name, sector key | Required for `thesis`, `company`, `sector`. |
| `category` | `portfolio`, `pipeline`, `competitors`, `funding`, `exits`, `macro`, `policy`, `sectors` (or `all`) | One category; omitted = all. |
| `limit` | 1 to 60, default 12 | Rows returned. |
| `cursor` | the `next_cursor` of the previous answer | The next page. |
| `sector`, `company`, `from`, `to`, `q`, `saved` | sector key; company ref; YYYY-MM-DD; YYYY-MM-DD; words in the headline or source; `true` | Dashboard filters (Markets uses them; Home does not need them). |

Answer `{ items: Row[], total, next_cursor: string | null, checked_at }`. Row:

```ts
type NewsRow = {
  id: string;
  title: string;
  url: string;                 // the article: open in a new tab
  source: string;              // publisher, e.g. "Reuters"
  published_at: string;        // ISO UTC
  image_url: string | null;    // served by the app itself (/api/ops/news/image?id=...&v=...), no sign-in header needed; null = no picture
  category: 'portfolio' | 'pipeline' | 'competitors' | 'funding' | 'exits' | 'macro' | 'policy' | 'sectors';
  category_label: string;      // "Exits and M&A", "Markets and macro", ...
  about: { kind: 'company' | 'sector' | 'thesis' | 'market'; id: string; name: string };
  summary: string;             // your AI agent's one sentence, '' when none
  snippet: string;             // the feed's own one or two lines, '' when none
  topic: string;               // what the search was about, e.g. "Fintech", "IPO market", a company name
  sector: string;              // sector key ('' for market-wide items)
  insight_ids: string[];       // active insights that cite this item
  saved: boolean;              // the caller saved it
};
```

`news.insights` (GET, `markets:view`, your AI agent allow). Params: `limit` (1 to 30, default 6), `ref` (optional: a company, thesis, fund, sector key or news item; only insights that affect or cite it). Answer `{ insights: Insight[], total }`, newest first, dismissed ones left out:

```ts
type Insight = {
  id: string;
  title: string;                              // the headline of the insight
  analysis: string;                           // two to four sentences
  impact: 'positive' | 'negative' | 'watch';
  affects: { kind: 'company' | 'fund' | 'thesis' | 'sector'; id: string; name: string }[]; // sector: id is the sector key
  news_ids: string[];                         // the items it rests on (at least one)
  news: { id: string; title: string; url: string; source: string; published_at: string }[];
  next_step: string;                          // a suggested next step, '' when none
  created_at: string;                         // ISO UTC
};
```

Frontend helpers (import them, do not copy): `frontend/src/app/components/markets/news.ts` exports `NewsRow`, `NewsAnswer`, `Insight`, `NEWS_CATEGORIES` (key, label in tab order), `listNews(scope, ref?, limit?, extra?)` (extra: `{ category, cursor, ... }`), `listInsights(limit?, ref?)`, `IMPACT_LABEL`. A card that shows an image uses `row.image_url` as `<img src>` directly (no header needed).

### News: what is pulled (fix 4)

- Categories are set by the search that found an item (never by its words), most specific first, one row per url: `portfolio` (each active holding, `"<name>"`), `pipeline` (deal-flow companies open or on hold in Diligence to Term sheet), `competitors` (competitor tiles on active maps), `policy` (each thesis sector, `<sector> regulation`), `exits` (`"venture-backed" IPO`, `startup "acquired by"`, `"secondary sale" startup shares`), `funding` (each sector `"<sector> startup" funding`, `"new venture fund"`, `"limited partners" venture capital`), `macro` (`"venture capital funding"`, `"IPO market"`, `"Federal Reserve" interest rates`, `"startup valuations"`, `Nasdaq tech stocks`), `sectors` (each sector `"<sector> startup"`). A demo firm runs macro, funding and sectors only. `topic` is what the search was about (trending topics); `sector` is the thesis sector key (company items take the company's sector).
- Feeds: Bing News RSS first (`https://www.bing.com/news/search?...&format=rss`, US English, last 30 days; the publisher's own link is the `url` parameter of Bing's click link; `<News:Source>`, `<description>` as the snippet, `<News:Image>` as the picture), Google News RSS when Bing answers nothing. Pictures: only `www.bing.com/th?id=...` is downloaded (640 x 360), at most 60 per pull, kept on the item's `image` file field and served by `news.image` (public op: an `<img>` sends no sign-in header; cached 30 days). `media:content`, `media:thumbnail` and image `enclosure` are parsed, but any other host is ignored. Long dashes in publisher text become commas or hyphens.
- Kept 60 days; Funding items that report a round (`round_company`, `round_amount_usd`, `round_stage`, set by a person, the seed or your AI agent in `news.summarize`) 400 days (the funding charts). The migration discards rows stored before the new schema: the next pull (catch-up at boot) refills them; reseed the demo for the fictional items.
- Hosts the gate derives: `www.bing.com`, `news.google.com` (the coordinator may add both to the AGENT_APP.md External data table; that file is not mine).

### Ops added in fix 4 (408 in the app)

| Op | Perm | Your AI agent |
|---|---|---|
| news.stats | markets:view | allow (categories, trending topics this week, publishers, sectors, companies, for the news.list filters) |
| news.image | public | deny (streams the picture) |
| news.save | markets:view | deny (per person; `news.list --saved true`) |
| news.set-image | markets:view | yours only (`--paths` with one local picture, `--source_url`) |
| news.insights | markets:view | allow |
| news.insight-save | markets:view | yours only (6 per job at most, cites at least one item, affects company, fund, thesis or sector) |
| news.insight-dismiss | markets:view | deny (Undo through activity) |
| news.insights-ask | markets:view | deny (one open job at a time) |
| markets.pulse | markets:view | allow |
| markets.sector | markets:view | allow |
| research.list, research.get | markets:view | allow |
| research.ask | markets:view | deny (stores the report, queues `market_brief`) |
| research.save | markets:view | yours only (seven sections with [n] marks that must exist in the citations; the size section must cite) |
| research.delete | markets:edit | deny (cancels a job not yet claimed; Undo) |

`news.list` gains `scope all|sector`, `category`, `cursor`, `sector`, `company`, `from`, `to`, `q`, `saved` and pages of up to 60. `news.summarize` items take an optional `round` on Funding items. `news.add` takes `about_kind market`, `category` (default from the company: an active holding is portfolio, a competitor tile competitors, a deal or another tile pipeline; a sector or thesis is sectors), `sector`, `topic`, `snippet` and a round.

### Jobs, cron, migration

- Jobs: `news_insights` (cron 08:15 with catch-up, and `news.insights-ask`; payload: the last 7 days' items, at most 60, the theses, funds and recent insight titles; skipped under 3 items) and `market_brief` (ref `research_reports:<id>`; payload report, topic, sector, thesis, firm, sections). `job.failed` of a brief marks it failed. Recipes in `guide_markets.js`; `news_digest` now passes category, topic and has_image and may add a round and a lead picture.
- Migration `1741009200_news_dashboard.js`: news + category, sector, topic, snippet, feed, image, image_source, image_by, round_company, round_amount_usd, round_stage, about_kind + market; `news_saves`; `news_insights` (refs holds " kind:id " tokens for `--ref`); `research_reports`. Every rule null.
- Funding by sector (`markets.pulse`, `markets.sector`): Funding items with a round in that sector plus SEC Form D signals of the theses that list the sector (the amount from `facts.raise_minor`); a signal counts under its company's sector, or under every sector of its thesis when the company has none.

### Markets page (fix 4)

- Tabs News, Overview, Sectors, Theses, Research (`#/markets` is News; `#/markets/<area>[/<sector key or brief id>]`); a thesis keeps `#/markets/:thesis[/:tab]` (back goes to Theses) and its News tab is the dashboard without the side card. The New thesis command opens Theses.
- News (`NewsDashboard`): category tabs with counts, one filter row (search, sector, company, 7, 30 or 60 days, All stories or Saved, Check now), the lead story (the first with a picture among the top 24), 3 featured, then 3 cards per category under its title with "See all N stories" (All) or the category's grid with Load more (cursor); side card Your AI agent's take / Trending topics / Sources. `?insight=<id>` (Home's link) opens that insight.
- Overview: Market pulse cards per sector (sector and thesis / News with an 8-week sparkline / Funding rounds found with a sparkline, rounds and dollars / New companies found / Latest take) and New companies found. Sectors: chips grouped by thesis, then `SectorView`: Funding activity (6 months: rounds per month, dollars per month, recent rounds), Market map (read only), News; side card Your AI agent's take / Key companies / Competitors of your portfolio. Theses: cards divided name / Looks for / to review. Research: Ask your AI agent (one field, sector chips, the one black button), Market briefs, a brief as a document (summary, seven sections, numbered sources; Export as Markdown, Print or PDF, Remove).
- Divider rule: every card touched is a stack of sections with full-width hairlines (`components/markets/Divided.tsx`: `DCard`, `DSection`, `FactGrid`).
- Shared for other modules: `components/markets/news.ts` (above), `NewsCards.tsx` (`StoryCard` lead, featured, card, row; `StoryGrid`; `NewsMeta`), `Insights.tsx` (`InsightCard`, `InsightList`, `ImpactChip`); `NewsList.tsx` is unchanged for the company page.

### Seed (new section "fix 4 (markets)")

Before "the end": fictional rounds in fictional companies per sector (rising over 8 weeks, older ones over 6 months), generic sector, policy, macro, exits, new-fund and LP headlines from fictional .example publications, competitor items for the fictional competitor tiles, 10 insights in two `news_insights` jobs (6 and 4) through `news.insight-save` as your AI agent, and 2 market briefs (asked by Mei Tanaka and Olivia Hart, written through `research.save`). The news sections run 218 ops, 0 failed. Alone on a seeded copy: `SCR/fix4-markets/seed_markets_only.mjs <app> <port>`.

### Fix 4 tests

- `reference/tests/markets/fix4_news.mjs <app> <port>`: 82 passed (filters, paging, categories, pictures served without sign-in, saves per person, your AI agent's picture, insights and their refs, dismiss and Undo, one take job at a time, pulse and sector, briefs: ask, validation, save, remove). `fix3_news.mjs` 32 passed (its limit check is now 60).
- Server time on the seeded copy: news.list 39 ms, news.stats 81 ms, news.insights 23 ms, markets.pulse 28 ms, markets.sector 16 ms.
- Screenshots of News (All, Funding, Saved), Overview, Sectors, Theses, Research, a brief and a thesis's News, light and dark, 1440 and 390: no console errors, no 5xx, no sideways scroll, no "Unknown", at most one black primary, no broken pictures, no long dashes. Gate passes.
