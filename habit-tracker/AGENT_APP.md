# Habit Tracker

> Per-project plan, context and index. Keep it current with every change.

## Plan

A compact habit tracker for one person building daily habits. It has no accounts or sign-in. The front of the app is a today-focused habit list: each row has a check-in control, a 30-day strip and the current streak. A right-hand panel shows a dashboard of today and this week. When a habit is selected, the panel shows that habit's analytics instead: current and best streak, 30-day rate, total completions, a 365-day heatmap, a 30-day trend, and an editor for any day's value and note. The look is "Notion-monochrome": grey chrome, compact rows, and each habit's own colour as the only accent.

The View is the original V1 frontend running on a client-side shim, `frontend/src/app/services/apiAdapter.ts`. The shim turns the frontend's REST calls into PocketBase record calls, and computes streaks, rates, heatmap cells and the dashboard in the browser. The agent operations (`pb/pb_hooks/agent_ops.pb.js` routes, `lib_agent.js` logic) port those same functions to the server. So an agent writes the same records a person's clicks write, and reads the same numbers the screen shows.

**Objects.**
- **categories** group habits. Each has a name and a palette colour, and they show as filter chips in their saved order.
- **habits** belong to at most one category. A habit has a type, an optional per-day target and unit, a colour, an icon, a list position and an archived flag.
- **entries** hold one value (and an optional note) per habit per calendar day.
- **How they connect:** deleting a habit deletes its entries. Deleting a category leaves its habits uncategorized.
- **Seed:** the first start adds two categories (Health, Focus) and five habits (Exercise, Drink water 8 glasses, Sleep 8h, Deep work 4 hours, Read). No entries are seeded.

**Start every agent session with `a2app <app> app app.guide`.** It returns today's date as the app sees it, the habit types, the completion and streak rules, the valid colours and icons, and ready-to-run recipes.

**Common jobs.**
- **See what the person sees:**
  - `a2app <app> app app.state` returns today's done / total, this week's rate, active streaks, the top streak, the category chips, and every active habit with today's value and current streak.
  - `--search <text>` and `--category_id <id>` filter the list like the search box and a chip do. `--include_archived true` also lists archived habits.
  - Use it to find a habit's id by name.
- **Check in today:**
  - Binary or avoid habit: `a2app <app> entries entries.mark --habit_id <id> --done true`. `--done false` undoes it.
  - Count habit: `a2app <app> entries entries.add --habit_id <id> --amount 2`. A negative amount subtracts, and the value never goes below 0.
  - Exact value: `a2app <app> entries entries.set --habit_id <id> --value 6`.
- **Backfill a past day:** add `--day YYYY-MM-DD` to any of the three, e.g. `a2app <app> entries entries.mark --habit_id <id> --day 2026-11-09 --done true`.
- **Note on a day:** `a2app <app> entries entries.set --habit_id <id> --day <day> --note "felt strong"`. This keeps the value. An empty note clears it.
- **Streaks and history:**
  - `a2app <app> habits habits.get --habit_id <id>` gives the detail panel's tiles and the 30-day trend.
  - `a2app <app> habits habits.history --habit_id <id> --days 30` gives the logged days. Add `--all_days true` for the full grid, empty days included.
- **Manage habits:**
  - `a2app <app> habits habits.create --name Meditate --type duration --target 10 --icon Timer`.
  - `habits.update --habit_id <id> --target 12`. Only the params you pass change.
  - `habits.archive --habit_id <id>` archives a habit; `--archived false` brings it back.
  - `habits.reorder --habit_ids '["id1","id2",…]'`: pass every active habit, top first.
  - `habits.delete --habit_id <id>` deletes the habit with all its history. It asks the person first.
- **Manage categories:**
  - `a2app <app> categories categories.create --name Health --color "#10B981"`.
  - Rename or recolour with `a2app <app> data categories update <id> --name "…" --color "#…"`.
  - `categories.delete --category_id <id>` asks the person first. Its habits become Uncategorized.
- **Tell the person to reload:** after any change, tell them it shows in the open app once they reload it (see Gotchas).

## Modules

Every operation and every collection an agent can reach belongs to one module. `a2app <app>` lists them; `a2app <app> <module>` lists a module's operations.

| Module | Operations | Collections |
| --- | --- | --- |
| `habits` | 8 | `habits` |
| `app` | 2 | — |
| `entries` | 3 | `entries` |
| `categories` | 2 | `categories` |

## Entities

See `reference/requirements.md` § Data Requirements.

## Operations

Call an operation with `a2app <app> <module> <operation> --param value` (`<app>` is the app directory, its id or its name). A destructive one first answers `approval_required` with an approval key: ask the person, then repeat the call with `--approve <key>`. `a2app <app> --find <word>` locates an operation by name. Every operation below runs on the server in the app's own code: the handler its screens use where they call one, otherwise a server copy of exactly what the screens do.

### habits

- `habits.clear-entries` *(destructive)* — Delete ALL daily entries of one habit (its full history) and return how many were removed. Params: `habit_id` (string, required).
- `habits.get` *(read-only)* — One habit's detail panel: settings, today's entry, current and best streak, 30-day rate, total completions and the 30-day trend. Params: `habit_id` (string, required).
- `habits.history` *(read-only)* — One habit's heatmap: value, completed, intensity and note per day for the last N days. Lists only days with a value or note unless all_days. Params: `habit_id` (string, required), `days` (number), `all_days` (boolean).
- `habits.create` — Add a habit (the New habit form). count/duration need a target. The open app shows it after a reload; tell the person. Params: `name` (string, required), `type` (binary|count|duration|negative), `target` (number), `unit` (string), `description` (string), `color` (#EF4444|#F97316|#F59E0B|#EAB308|#84CC16|#22C55E|#10B981|#14B8A6|#06B6D4|#0EA5E9|#3B82F6|#6366F1|#8B5CF6|#A855F7|#D946EF|#EC4899|#F43F5E|#737373), `icon` (Activity|AlarmClock|Apple|Ban|Banana|Bath|Bed|BellRing|Bike|Book|Brain|Briefcase|Brush|Calendar|CheckCircle2|ChefHat|Cigarette|Circle|Coffee|Compass|Croissant|Crown|Dog|Droplet|Dumbbell|Edit3|Feather|Flame|Flower2|Footprints|Gamepad2|Gem|Gift|GlassWater|Globe2|GraduationCap|Guitar|Hammer|Hand|HandCoins|Headphones|Heart|HeartPulse|Home|IceCream|Languages|Laptop|Leaf|Lightbulb|MessagesSquare|Mic|Microscope|Moon|MountainSnow|Music|Notebook|Paintbrush|Palette|Pencil|Pizza|Plane|Plus|Salad|Scale|ScrollText|ShieldCheck|ShoppingBag|ShowerHead|Smile|Sofa|Sparkles|Sprout|Stethoscope|Sun|SunMedium|Target|Tent|Timer|ToyBrick|TreeDeciduous|Trophy|Tv|Umbrella|Wallet|Waves|Wifi|Wind|Wine|Zap), `category_id` (string).
- `habits.update` — Edit a habit (the Edit habit form); only the params you pass change. The open app shows it after a reload; tell the person. Params: `habit_id` (string, required), `name` (string), `type` (binary|count|duration|negative), `target` (number), `unit` (string), `description` (string), `color` (#EF4444|#F97316|#F59E0B|#EAB308|#84CC16|#22C55E|#10B981|#14B8A6|#06B6D4|#0EA5E9|#3B82F6|#6366F1|#8B5CF6|#A855F7|#D946EF|#EC4899|#F43F5E|#737373), `icon` (Activity|AlarmClock|Apple|Ban|Banana|Bath|Bed|BellRing|Bike|Book|Brain|Briefcase|Brush|Calendar|CheckCircle2|ChefHat|Cigarette|Circle|Coffee|Compass|Croissant|Crown|Dog|Droplet|Dumbbell|Edit3|Feather|Flame|Flower2|Footprints|Gamepad2|Gem|Gift|GlassWater|Globe2|GraduationCap|Guitar|Hammer|Hand|HandCoins|Headphones|Heart|HeartPulse|Home|IceCream|Languages|Laptop|Leaf|Lightbulb|MessagesSquare|Mic|Microscope|Moon|MountainSnow|Music|Notebook|Paintbrush|Palette|Pencil|Pizza|Plane|Plus|Salad|Scale|ScrollText|ShieldCheck|ShoppingBag|ShowerHead|Smile|Sofa|Sparkles|Sprout|Stethoscope|Sun|SunMedium|Target|Tent|Timer|ToyBrick|TreeDeciduous|Trophy|Tv|Umbrella|Wallet|Waves|Wifi|Wind|Wine|Zap), `category_id` (string).
- `habits.archive` — Archive a habit (hidden from list and dashboard, history kept) or bring it back with archived=false. Shows in the open app after a reload. Params: `habit_id` (string, required), `archived` (boolean).
- `habits.reorder` — Set the list order: habit ids top first (pass every active habit). The open app shows it after a reload; tell the person. Params: `habit_ids` (string, required).
- `habits.delete` *(destructive)* — Delete a habit and all of its history. Cannot be undone. The open app shows it after a reload; tell the person. Params: `habit_id` (string, required).

### app

- `app.guide` *(read-only)* — START HERE: what the app is, habit types, how days, completion and streaks work, valid colours and icons, and recipes for common jobs.
- `app.state` *(read-only)* — The main screen: done today, this week's rate, streaks of 7+ days, top streak, category chips, each habit with today's value and streak. Params: `search` (string), `category_id` (string), `include_archived` (boolean).

### entries

- `entries.set` — Set a day's value and/or note (default today; last 365 days). Binary takes 0 or 1. The open app shows it after a reload; tell the person. Params: `habit_id` (string, required), `day` (string), `value` (number), `note` (string).
- `entries.mark` — Mark a day done (binary 1, count/duration its target) or not done (0); default today. The open app shows it after a reload; tell the person. Params: `habit_id` (string, required), `done` (boolean, required), `day` (string).
- `entries.add` — Add to a count/duration habit's day value (negative subtracts, never below 0); default today. Shows in the open app after a reload. Params: `habit_id` (string, required), `amount` (number), `day` (string).

### categories

- `categories.create` — Add a category (name and palette colour); it goes last among the chips. The open app shows it after a reload; tell the person. Params: `name` (string, required), `color` (#EF4444|#F97316|#F59E0B|#EAB308|#84CC16|#22C55E|#10B981|#14B8A6|#06B6D4|#0EA5E9|#3B82F6|#6366F1|#8B5CF6|#A855F7|#D946EF|#EC4899|#F43F5E|#737373).
- `categories.delete` *(destructive)* — Delete a category; its habits become Uncategorized (they and their history are kept). Shows in the open app after a reload. Params: `category_id` (string, required).

## Conventions

### Rules

- **Days** are calendar days written `YYYY-MM-DD`; an entry is keyed by its day, never by an instant.
  - "Today" for the operations is the local date of the machine that runs the app. In the normal setup that is the person's own machine, the same date the screen shows. Every read and every entry write returns the `today` it used (`today_date` in `habits.get`, whose `today` is the day's entry), and there is no other date override.
  - `entries.set`, `entries.mark` and `entries.add` take `--day` (default today) within the last 365 days, today included. That is the range the detail panel's heatmap can edit. A future day, or one older than 364 days back, is refused.
- **Habit types:**

  | Type | Form label | Stored as (`type` / `kind`) | Day value |
  | --- | --- | --- | --- |
  | `binary` | Binary — done / not done | `binary` / `binary` | 0 or 1 |
  | `negative` | Avoid — habit to break | `binary` / `negative` | 0 or 1 |
  | `count` | Count — increment to a target | `quantity` / `count` | any number of 0 or more (decimals allowed), against a positive per-day target |
  | `duration` | Duration — minutes per day | `quantity` / `duration` | any number of 0 or more (decimals allowed), against a positive per-day target |

  - `type` decides when a day is done; `kind` keeps the form's exact choice, and the operations report it as `type` (`stored_type` is the record's `type`). A habit with no `kind` (saved before the field existed), or whose `kind` disagrees with its `type`, reads as `count` (quantity) or `binary`.
  - A binary or avoid day is done when its value is above 0. A count or duration day is done when it reaches the target ("partial" between 0 and the target).
  - An empty unit becomes `reps` (count) or `min` (duration).
  - `entries.add` refuses binary habits; use `entries.mark`.
- **Streaks and rates** follow the app's own rules:
  - **Current streak:** consecutive done days ending today, or ending yesterday while today is not done yet.
  - **Best streak:** the longest run ever.
  - **30-day rate:** done days in the last 30 (today included) ÷ 30.
  - **Weekly rate:** done habit-days in the last 7 ÷ (7 × active habits).
  - **Active streak:** a current streak of 7 days or more.
- **Colours** are the 18 palette values in the `color` enum (the only ones the app's pickers offer). New habits default to `#22C55E` and new categories to `#10B981`.
- **Icons** are the 89 lucide names in the `icon` enum, the app's icon picker. A new habit defaults to `CheckCircle2`, as in the form. The app draws an unknown icon as `Circle`.
- **Archived habits** are hidden from the app's list and dashboard; their history is kept.
  - Reads work on them, and `app.state --include_archived true` lists them.
  - Entry writes and `habits.update` on an archived habit answer `conflict`. Bring the habit back first with `habits.archive --archived false`.
- **Category order and list order:**
  - A new habit or category goes last: its position is the current count of habits or categories.
  - `habits.reorder` gives each listed habit its index; habits you leave out keep their old position.
- **Errors:**
  - A refused call answers `ok: false` with `code` (`rejected` 400, `not_found` 404, `conflict` 409) and a `message` that names the parameter and what it accepts.
  - The adapter rejects undeclared parameters, and enum values must match exactly (e.g. `#22C55E`, `Timer`).

### Gotchas

- **The open app does not refresh itself.** The View has no realtime subscription and no polling. It re-reads its list, categories, dashboard and 30-day strips only after the person's own changes, and when the date rolls over.
  - After you change anything, tell the person to reload the app. Every write result except `habits.clear-entries` carries a `screen` reminder.
  - Until they reload, a +/− or check press in the app starts from the value it last loaded, and can overwrite what you wrote.
- **Seeded habits carry emoji icons** (🏃, 💧, 😴, 🎯, 📚), which the app draws as a plain circle. Editing such a habit without passing `--icon` keeps the emoji.
- **Prefer the operations over raw `data` writes.** `data` skips the app's rules:
  - the end-of-list position;
  - the type, kind, target and unit coupling;
  - the palette and the 365-day window;
  - the one-entry-per-day upsert. A second `data entries create` for the same habit and day fails on the unique index.
  
  `data categories delete` is refused while any habit uses the category; use `categories.delete`. `data habits delete` runs without the person's approval, while `habits.delete` asks first. Plain `data` is fine for reading rows and for renaming or recolouring a category.
- **Reordering a filtered list.** The app reorders only the rows it shows, so with a search or chip active its positions can tie with hidden habits'. Pass every active habit to `habits.reorder`.
- **Unarchiving.** The app never lists archived habits, so a person cannot reach its Unarchive button. `habits.archive --archived false` is the only way back besides a raw `data` update.
- **`habits.clear-entries`** deletes a habit's whole history but keeps the habit. No screen calls it.
- **Hooks.** On a live instance hooks do not hot-reload (`pb-serve.mjs` passes `--hooksWatch=false` outside dev), so restart the app after a hook change. `require()` costs about a millisecond per call, so `lib_agent.js` is required once per handler, never inside loops. Query results are Go slices: they are copied with `Array.from()` before sorting.

### Ownership map

- **System-owned (hash-locked, from the `blueprint-pocketbase-kit` toolkit — never edit):** `manifest.json`, `pb-serve.mjs`, `pb-fetch.mjs`, `pb-check.mjs`, `pb-build.mjs`, `pb/pb_hooks/_a2app.pb.js`, `pb/pb_hooks/_a2app_impl.js`, `pb/pb_hooks/_a2app_rules.js`, `pb/pb_hooks/_compat_lib.js`, `pb/pb_hooks/_compat_rules.js`, `pb/pb_hooks/_compat_system.js`, `pb/pb_hooks/_system.pb.js`, `pb/pb_hooks/_triggers.pb.js`, `pb/pb_hooks/_triggers_lib.js`, `pb/pb_hooks/_craftbot_bridge.js`.
- **Agent-owned:** `operations.json`, `events.json`, `AGENT_APP.md`, `reference/`, `pb/pb_hooks/a2app_routes.pb.js` (regenerate with `tools/agent-app-migrate` rather than hand-edit), every other file under `pb/pb_hooks/` and `pb/pb_migrations/`, and `frontend/`.

## Checklist

Build and verification tasks live in `reference/tasks.md`.
