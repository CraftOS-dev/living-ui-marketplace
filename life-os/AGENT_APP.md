# Life OS

> Per-project plan, context and index. Keep it current with every change.

## What this app does

A life on one screen, not a database to fill in. Home shows today: the
weather where the person lives (on the landscape and by the hour and week),
your AI agent's note, nudges (birthdays, people not heard from, bills, rain,
trips, chores), the list for today with a big add, habit buttons, the mood,
water glasses, money left with a quick spend, people to reach, what is
coming and the news. Home is five rows of one to three panels (Today,
Habits and you, Goals and money, Coming up/people/weather, News); the person
drags a row by its handle (or arrow keys on it) to reorder, kept in
`settings.home_rows`. The Board holds every card like a pinboard (Inbox,
Today, Coming up, Later, Done; drag and drop; the next seven days with their
weather). Habits is a tracker. My life is a balance (spider) chart of the
eight parts of life, each scored 0 to 1 from real activity (`score` in
`life.overview`, null when there is not enough yet), beside a list of each
part. Each part has its own tool (Health, Money, Friends and family, Work,
Growth, Fun, Home, Mind) with its goals, cards and habits. Fun's trips are
tickets counting down; a ticket opens to its packing list.
Friends and family is a connection map: you in the middle, partner, family
and friends on rings, lines showing who is due a call, and thin lines
between people who know each other (`people.link`). Goals count by
themselves where they can (a jar, books finished, weigh-ins, habits kept).
Projects are journeys of stepping stones. The journal is a page of paper.

Revamped 2026-10-24 (the first version was rejected as boxes and forms):
values, reviews, captures, insights, experiments, imports and the separate
Goals, Areas, Today, Week and Tasks pages were removed, and the old data
was reset (backup in the CraftBot repo's `_agentapp_migration_backup/`).
Later the same day Family was folded into Friends and family (one area,
three circles) and the data was reset again (backup
`life_os_before_family_merge_2026-10-24`; the person's settings, habits,
project and mood were put back by hand). Then Community (and the work and
community circles) was removed: the live data was moved to
`life_os_before_community_removal_2026-10-24` and every row the new schema
allows was copied into a fresh database (scratchpad `copy_rows.py`, ids and
links kept; only the Community area row was left out).

Your AI agent operates the same operations through the `agent-app` CLI. It
adds cards, logs and notes freely; new goals, habits, people and projects,
deletions and day plans arrive as **proposals** the person keeps item by
item; small field ideas arrive as dashed **suggestions**. Journal pages are
the person's: it reads only shared pages and never writes them. The UI says
"your AI agent" and never names a product.

**Start every agent session with `agent-app run <project> app.guide`**: the
conventions, today's date, what the agent may do, the error codes and the
recipes (`app.guide --topic day_plan|inbox|breakdown|habit_help|recap|morning_note|question|evening_checkin|logging`,
`app.guide --part arts` for habit drawings). `agent.brief` is the state of
today in one call (cards, inbox, habits, body, money, people, birthdays,
coming up, goals, weather).

## Requirements

See `reference/requirements.md` (binding).

Verified 2026-10-24: backend end to end on a fresh database (141 checks:
every part-of-life tool, goals that count themselves, the board, habits,
journal privacy, agent permissions and proposals, undo, guards, person
links, Home row order, balance scores, and the agent surface below); all 62
read operations as person and agent; every page seeded and empty (first run
walked through the UI), at 320, 390, 768, 1024, 1280, 1440 and 1920 px for
overflow, pointer cursors (drag handles use grab), the type scale and
banned text; dragging Home rows (mouse and keys, kept after reload);
contrast in all 16 theme packs, light and dark; every page as a 390 px
touch phone (tap areas, nothing hidden behind hover, no sideways scroll);
and an agent doing everyday jobs through the CLI alone on a scratch copy.

## Your AI agent through the CLI

Built so an agent works as fast as the person taps, from `app.guide` and
`agent.brief` (one call: today's open cards with ids, inbox, coming up in
date order, habits with ids, chores due, nudges with the records they point
at, people to reach, birthdays, goals, money with `_text` amounts).
- Writes are safe to repeat: `habits.log` sets done (use it, not
  `habits.tap`, which flips); `trips.pack` with `--item` needs exactly one
  of `--done`, `--text` (rename) or `--remove`, and never guesses.
- One call for several things: `tasks.add-many` (one batch, one undo),
  `trips.add --packing`, `trips.pack --text` and `shopping.add` one per line,
  `people.create --links`, `board.plan` new cards with `person`.
- One number per fact: a habit with `source` water or mind_min counts
  itself from the body log (`health.log`), so the glasses on Home and the
  habit always agree; logging either writes the body log, and undo restores
  both.
- Errors point the way: a name passed for an id answers with that name's
  id; a wrong id lists some real ones; a second active goal with the same
  title is refused (`duplicate`, with its id).
- Parity with the person: what the person defined (goals, habits, people,
  projects, settings including Home's row order, switching or ordering the
  parts of life, a day plan) arrives as a proposal they keep; the journal
  and the mood stay the person's, and `journal.list` gives the agent only
  `private_days` for pages kept private.
- Lean reads: `habits.get --days`, `journal.heat --days`; `life.overview`
  has `needs_attention` and scores rounded to two places.

## Instant screens and motion

- A tap changes the screen first and tells the server behind it.
  `act(changes, run, reads)` in `frontend/src/app/lib/live.ts` lays edits
  over every live view at once (`patch` a record by id, `patchWhere` for
  objects without one, `drop`, `insert` into the lists it belongs in,
  `reorder`, `reshape`), runs the operation, then reloads the views it
  names at once (own actions skip the old 270 ms of debounce). An edit
  keeps applying to data fetched before the server had the change, so a
  reload that started early never flickers back. On a refusal the edits go
  and the operation's message shows; add lines get their words back.
  Undo (and Ctrl Z) waits for writes still on their way (`idle()`).
- Things made here show with a temporary id; the server's copy arrives
  quietly (no second animation).
- Each view remembers what it last loaded, so a page you come back to shows
  at once and refreshes behind; every page's code is fetched in the
  background after start, and moving between pages is a React transition
  (the old page stays until the new one is ready, no loading flash).
- Motion (`lib/motion.ts`, `theme.css`): panels rise in, lower ones a little
  later; a row that arrives later slides in once (`enter(id)`); a row that
  goes folds away first (`vanish`, which brings it back if the server
  refuses); a ticked card shows its tick, then folds out of its list;
  drawers slide, dialogs and the dimmed page ease in and out, the phone
  menu slides from the left, snacks rise, glasses and mood stickers bounce,
  rings and bars fill smoothly. Animations keep nothing when they end (no
  lasting transform or stacking context) and none play with reduced motion.
- Tests (scratchpad, scratch only): `snappy.mjs` and `snappy2.mjs` time 18
  taps from click to screen (26 to 120 ms; removals about 300 ms with their
  fold) and check the server and that no row is left folded or doubled;
  `snappy_fail.mjs` refuses writes and checks every screen goes back.

## Phones and touch

- Controls that appear on hover (remove, open a habit) are always shown on
  touch screens; the star on every card stays in the card's drawer there.
- `.hit` / `.hit-y` (theme.css) give small controls a tap area of about
  44 px on touch without changing their look (tick circles, water glasses,
  bill ticks, icon buttons, remove buttons).
- iPhone Safari zooms into any field under 16 px, so fields are 16 px there
  (only there; the type scale holds everywhere else).
- Home rows are rearranged with "Arrange Home" (up and down) on phones; the
  Board's lists snap one by one when swiped; banner badges sit under the
  title; the phone menu leaves the weather to Home; sliders save on pointer
  up (mouse, touch and pen).

## Entities

Every collection's API rules are null: everything goes through
`/api/ops/*` (record hooks refuse direct writes). Schema:
`pb/pb_migrations/1700000100_life_schema.js`; seed (settings, the eight parts
of life switched on, three routines off): `1700000200_life_seed.js`. Days
are `YYYY-MM-DD` in the person's calendar; a day starts at
`day_starts_hour` (4:00). Money is in minor units.

| Collection | Purpose |
|------------|---------|
| settings | Name, onboarded, day start, week start, units, currency, monthly budget, place (city, region, country, lat, lon, timezone), news topics, daily aims (water, sleep, steps), what the agent may read, autonomy, quiet hours, calendar, the order of Home's rows (`home_rows`) |
| areas | The eight fixed parts of life (`kind`: health, money, relationships, work, home, growth, fun, mind), on or off, order |
| goals | Title, area, state, measure (number_up, number_down, milestones, tasks, habits, pot, books, weight, none), target, baseline, unit, pot, milestones, dates, purpose; computed progress, pace, pace_state, current |
| goal_checkins | A number goal's values by day |
| money_pots | Savings jars (a pot goal makes its own) |
| people, interactions, events | People by circle (partner, family, friends: all in Friends and family) with keep-in-touch days, birthday, look, and `links` (who knows whom, kept on both people); times in touch; plans |
| projects, tasks | Projects (area, goal, state); cards (dates, time, length, someday, top three, stage, repeat, checklist, area, project, goal, person) |
| habits, habit_logs | Schedule (daily, weekdays, per_week), target and unit, time of day, cue, drawing; one log per habit and day (done or skipped, value) |
| days | Mood, energy and your AI agent's note per day |
| health_logs, workouts | Water, sleep, steps, weight, calm minutes per day; workouts by kind |
| money_entries, bills | Spends and income by category; monthly bills with paid month |
| books, learning | Books (want, reading, done, pages); things being learned with practice minutes |
| bucket_items, trips | Bucket list; trips with packing lists |
| chores, shopping_items | Chores by room with how often; the shopping list |
| focus_sessions, wins | Focus minutes; wins |
| journal_entries, recaps | Pages (body, mood, weather, tags, photo, privacy); the agent's paragraph per week |
| routines, routine_runs | Morning note, evening check-in, weekly recap |
| suggestions, proposals, asks, activity | What the agent hands back, questions to it, who did what with undo |
| calendar_events | The read-only Google Calendar mirror |

## Operations

171 operations in `operations.json` (plus two system ones), generated from `pb/pb_hooks/cat_core.js`,
`cat_life.js` and `cat_areas.js` by `node tools/gen.mjs` (writes
`pb_hooks/routes.pb.js`, `operations.json` and
`frontend/src/app/lib/ops.gen.ts`); `node tools/gen_triggers.mjs` writes
`triggers.json` from `lib_guide.RECIPES`. Areas: `app.*`, `home.summary`,
`find.all`, `settings.*`, `onboarding.complete`, `activity.*`, `export.json`,
`calendar.*`, `routines.*`, `world.*` (place, places, set-place, weather,
news), `agent.*`, `asks.*`, `proposals.*`, `suggestions.*`, `life.*`,
`areas.*`, `goals.*`, `board.*` (get, week, plan), `tasks.*`, `projects.*`,
`habits.*`, `days.*`, `journal.*`, `recap.*`, `people.*`, `events.*`,
`health.*`, `workouts.*`, `money.*`, `pots.*`, `bills.*`, `books.*`,
`learning.*`, `bucket.*`, `trips.*`, `chores.*`, `shopping.*`, `focus.*`,
`wins.*`.

The dispatcher (`lib_ops.js`) tells the agent (`X-A2App-Token`) from the
person (the page session cookie). Effect classes (read, capture, plan,
shape, reflect, confirm, admin) and `agent: allow|deny|propose` decide what
the agent may do; `propose` turns its call into a proposal with a preview.

## Agent triggers

| Trigger | Fired when | What the agent does |
|---------|------------|--------------------|
| `day_plan_requested` | "Plan my day with your AI agent" on the Board | Proposes moves, the top three, new cards and a note (`board.plan`) |
| `inbox_sort_requested` | "Sort with your AI agent" on the Inbox list | Suggests a day, area, goal or person per inbox card (`suggestions.create`) |
| `breakdown_requested` | "Ask your AI agent for steps" in a goal | Proposes cards, habits, milestones or a project (`goals.breakdown`) |
| `habit_help_requested` | "Not sticking? Ask your AI agent" in a habit | Suggests a smaller version, a cue, a time |
| `recap_requested` | The weekly routine, or the button in the journal's week | Writes its paragraph (`recap.write`) |
| `morning_note_due` | The morning routine | Writes today's note on Home (`days.note`) |
| `question_asked` | A question on the agent page | `asks.working`, then `asks.answer` or `asks.fail` |
| `evening_checkin` | The evening routine | One short message about the day; offers to move what is left |
| `proposal_returned` | A proposal sent back with a note | Proposes again with the change |

## External data

| Source | Used for | Auth | Called from |
|--------|----------|------|-------------|
| `api.open-meteo.com` | Weather now, by the hour and seven days (cached 20 minutes) | None | `lib_world.js` |
| `geocoding-api.open-meteo.com` | Finding a town by name | None | `lib_world.js` |
| `ipwho.is` | Guessing where the person is on first run (once) | None | `lib_world.js` |
| `news.google.com` (RSS) | Headlines by topic for the person's country (cached 30 minutes) | None | `lib_world.js` |
| Google Calendar through the host (`callAction('list_google_calendar_events')`) | A read-only mirror of events | The host's connected account | `lib_calendar.js` |

When a source cannot be reached the page says so and keeps the last copy.

## Background jobs

- `lo_tick` (every minute): runs routines that came due (quiet hours
  respected), the day job once a day (recompute goals, tidy bought shopping
  older than a week, prune routine runs), the calendar mirror every 15
  minutes while on, keeps the weather and news warm, and flushes live
  updates.

## Gotchas

- Hooks do not hot-reload (`--hooksWatch=false`): restart the app after any hook change.
- Goja is slow at `require()` and `Date`: modules cache their requires (`let u_ = null; function u() {...}`), dates are day numbers (`lib_core.dnum/dstr`), reads share a memo keyed by `lo_v`.
- `lib_rec.crud` runs at module load, so `tools/gen.mjs` sets `globalThis.__hooks` before loading the catalog.
- `goals.*` take `purpose` (`why` is reserved for proposals).
- Colors: `lib/themeColors.ts` derives every `--lo-*` color from the kit tokens; the drawings use `--lo-art-*` (natural hues, gray in ink packs) and each part of life `--lo-k-<kind>`, `-soft`, `-text`. Never a hex color in a component; runtime colors go in inline styles.
- The realtime topic `lo` carries collection names only; `lib/live.ts` subscribes once at startup.
- One type scale: 12, 13, 14, 15, 26 px. No emoji (names refuse them).

## Ownership map

- Editable: `frontend/src/app/`, `pb/pb_migrations/` (the schema files are the standard: change them in place, back up the data and start it fresh, no conversion code), `pb/pb_hooks/*.pb.js`, `lib_*.js` and `cat_*.js` (not the `_*.js` system files), `tools/`, `operations.json` and `triggers.json` (generated), this file, `reference/`.
- System-managed (never edit): `frontend/src/kit/`, `frontend/src/main.tsx`, `frontend/src/config.gen.ts`, the underscore hooks (`pb/pb_hooks/_*.js`), `manifest.json`.
