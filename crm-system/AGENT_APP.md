# CRM System

> Per-project plan, context and index. Keep it current with every change.

## What this app does

A relationship CRM for a founder or a small team, kept together with an AI
agent: people, companies and deals in pipelines (sales, fundraising, hiring,
partnerships), every interaction on one timeline, relationship strength and
keep-in-touch reminders. The AI agent researches people, reviews meetings,
drafts follow-ups and answers questions; what it would change in the
person's own data waits in Review as a proposal unless the policy lets it
act directly, and every change by anyone can be undone.

- **Home** (the landing page): a dashboard for the chosen range (this
  month, last month, this quarter, year to date, 12 months) against the
  period before: open pipeline, weighted forecast, won, win rate, average
  deal and sales cycle. These money numbers count revenue pipelines only
  (every kind but fundraising and hiring). Panels: a revenue pipeline by
  stage (value and weighted, rotting counts), what needs attention
  (proposals, overdue tasks, stale deals, deals without a next step, people
  to get back in touch with, birthdays), the forecast for 6 months (won,
  weighted, best case), won and lost by month, one panel per fundraising
  pipeline (committed against the round target, weighted in talks, stages)
  and hiring pipeline (hired, in process, candidates by stage),
  interactions per week by kind, relationships (strength mix, going cold,
  strongest), deal sources, coming up, and the AI agent's latest runs.
  Every panel opens where the work is.
- **Today**: overdue, today, upcoming and done tasks with J/K, X (done),
  S (snooze), Enter (open), N (new); a side panel with stale deals, deals
  without a next step and people due a touch.
- **People** and **Companies**: tables with presets (keep in touch, going
  cold, birthdays, recently added, with open deals), lists, saved views,
  filters (field, operator, value; all or any), column chooser, inline cell
  editing, bulk actions, CSV import (columns matched for you, fill-only
  unless overwrite) and export.
- **Record pages** (people, companies, deals; also as a 520px peek):
  highlights, the focus (pinned notes, the next task), a note box, the
  timeline (interactions, notes, tasks, emails, stage moves, changes),
  details with field provenance (who set a value and from where), lists,
  work history, deals, people at the company and alumni. Keys: L log,
  T task, E email, N note. Deals add the stage bar (days per stage), Won /
  Lost and their people with roles.
- **Deals**: a board per pipeline (drag between stages, drop on won or
  lost), cards with value, close date, days in stage against the stage
  target, rotting edge, next step; or a table with totals.
- **Review**: the AI agent's proposals grouped by record, each with the
  change (old to new), its evidence quote, source, reason and confidence;
  accept, edit then accept, reject, or accept every high-confidence one;
  queued and failed emails; history and acceptance rate per kind.
- **Reports**: pipeline, conversion, forecast, won and lost (with lost
  reasons), time in stage, sources, activity, relationships; each with a
  chart, the formula behind every number, click-through to the deals, CSV
  export and Explain with AI.
- **Activity**: every change with undo and redo; the AI agent's runs, each
  revertible as a whole.
- **Setup**: workspace and home currency, pipelines and stages
  (probability, rotting days, target days, a fundraising round target),
  custom fields, lists, the AI agent's policy (per kind of change: propose
  or act; auto research, meeting review, daily brief, house rules),
  currencies (European Central Bank rates), import and export, duplicates
  (merge, reversible), trash (90 days).
- **Onboarding** on a fresh install: workspace, owner, currency and which
  pipelines to track; then fill from email and calendar through the AI
  agent, import a CSV or add someone by hand.
- **Keyboard**: Ctrl K palette, Ctrl Z / Ctrl Y undo and redo, P new
  person, D new deal, L log, T task (off on record pages, which own their
  single keys).

The look follows CAD Workshop: a 52px icon rail (new button, badges), a
title bar with status chips (agent work queued, emails not sent, overdue),
then the view edge to edge; flat panels split by hairlines, compact rows,
tabular numbers; near-monochrome, color only for meaning (won, lost,
overdue, rotting, stage colors) and the accent for the selection and
everything the AI agent proposes. Charts are small SVGs in
`components/charts.tsx` (grouped bars with a line, stacked bars, donut,
stack bar, meter, count-up) with hover values; an all-zero chart says so
instead of drawing an empty axis. Motion is light and once only: views fade
in, Home panels rise, bars grow, headline numbers count up (theme.css
`cr-*` classes, off under reduced motion). Line icons only, no emoji.
Colors are derived from the host theme (`lib/themeColors.ts`), light and
dark. Phone layout with a bottom bar.

**Start every agent session with `agent-app run <project> app.guide`**: it
returns the workspace, the policy and house rules, conventions (money in
answers is in minor units, money sent is a decimal; revenue numbers leave
out fundraising and hiring unless you pass `--pipeline`), what is on screen
and recipes.

## Requirements

See `reference/requirements.md` and the research behind the design in
`../reports/CRM software UI UX survey.md`.

## Entities

- `settings` (one row): workspace, owner, home currency, `policy`
  (autonomy per kind: update, stage, close, deal_value, merge, delete,
  email; auto_research, meeting_review, daily_brief, brief_hour,
  house_rules), setup_done.
- `people`, `companies`, `deals`: built-in fields plus `custom` (json, keyed
  by `fields`), `prov` (field provenance: by, at, run, source), tags, soft
  delete (`deleted`, `merged_into`), `agent_state` (working, waiting).
  People: emails (primary first), phones, strength (0 to 100),
  last_interaction, touches, keep_in_touch (days) and next_touch. Deals:
  value and currency in minor units, home_value frozen at close, stage,
  stage_entered, prob_override, expected_close, next step, lost reason.
- `employments` (work history), `deal_people` (roles), `pipelines`
  (kind, currency, target), `stages` (kind open/won/lost, probability,
  rot_days, target_days, color), `stage_events`.
- `interactions` (email, call, meeting, message; direction, people,
  company, deal, ext_id for dedupe), `notes` (pinned), `tasks`, `emails`
  (draft, queued, sending, sent, failed).
- `proposals` (kind, target, changes, payload, evidence, source, reason,
  confidence, status), `lists`, `list_entries`, `views`, `fields`,
  `aliases` (merged ids), `dupe_ignores`, `fx_rates`, `asks`, `activity`
  (undo/redo steps).

## Operations

131 operations in `operations.json` (generated from the routes; every UI
action is an op). Groups: app, search, setup, settings, policy, activity,
asks, fx, people, companies, deals, timeline, dupes, trash, pipelines,
stages, notes, interactions, tasks, emails, research, meetings, proposals,
lists, views, fields, import, reports.
`app.dashboard` (range, pipeline) returns everything Home shows in one call
(`lib_reports.dashboard`, deal rows built once). `people.upsert` /
`companies.upsert` find by normalized email or root domain and refuse with
the candidates (409) when it is ambiguous.
Mutating ops run through `lib_activity.run`: one transaction with a
tracked app handle that records every save and delete, so each change is
undone as a unit (refused when something it touched changed later).

## How the AI agent's changes land

- Written directly (tagged as the agent's, revertible): empty fields,
  values it set itself, new records, notes, interactions, tasks, list
  additions.
- Proposed unless the policy says act (`lib_setup.mustPropose`): changing a
  value the person entered, stage moves, won/lost/reopen, deal value,
  currency, close date or probability, merges, deletes, sending email.
- Accepting applies the change as the person; undoing the accept puts the
  proposal back to pending. The agent cannot decide proposals, change its
  policy or delete fields.

## Agent triggers

- `agent_asked`: questions and jobs from Ask AI, onboarding and the daily
  brief; `asks.start`, `asks.answer` / `asks.fail`.
- `research_requested`: people and companies to research (new person with
  Research on, the Research button, auto research); `research.queue`,
  then updates and `research.done` / `research.fail`.
- `interaction_logged`: meetings and calls logged with notes (meeting
  review on); `meetings.queue`, proposals and follow-up tasks or drafts,
  `meetings.done`.
- `emails_queued`: emails sent from the CRM; `emails.start`, send through
  the person's email account, `emails.sent` (logs the interaction) or
  `emails.fail`.

Each queue drains in one run; a fire refused by the cooldown is retried by
the minute cron; work the agent took and left is handed back after 4
quiet minutes or 25 minutes (`lib_agent.js`).

## External data

- European Central Bank reference rates (`www.ecb.europa.eu`) on request
  (`fx.fetch`). Nothing else leaves the machine.

## Relationships, money and identity

- Strength: meeting 3, call 2, email in 1.5, email out or message 1, each
  halving over 60 days; shown as 100 x (1 - e^(-s/3)); 60 and up strong,
  30 and up good (`lib_interactions.js`).
- Keep in touch: next touch = last interaction + cadence.
- Money: integers in minor units; other currencies value at the latest rate
  (`lib_fx.js`); a closed deal keeps the home value from its close.
- Identity: people by lowercased email, companies by root domain;
  free-mail domains never make a company (`lib_norm.js`).
  Merges keep the left record's values, fill blanks from the right, move
  every link and leave an alias; undo restores both.

## Background jobs

- `cr_agent` (every minute): re-asks the agent about waiting work, hands
  back work left busy, recomputes relationships once after a boot, and
  sends the daily brief at the chosen hour.
- `cr_nightly` (03:23): recomputes relationship strength, empties the
  trash after 90 days, prunes activity and answered questions older than a
  year.

## Upgrading from the earlier version

The schema migration converts the earlier CRM's data in place when it finds
the old `people` collection: companies (with tags), people (names split,
email and phone lists, employment), people and company lists, deal lists
and stages into pipelines, deals with all their people, notes, tasks, calls,
meetings and sent emails as interactions, and custom attributes as custom
fields with their values. The old collections are then removed (in
whatever order their references allow). Duplicates the earlier version
allowed show up in Setup > Duplicates.

## Gotchas

- Hooks do not hot-reload: restart the app after any hook change.
- Handlers run in isolated VMs: no helpers at file scope in `*.pb.js`;
  `require()` costs about 1.6 ms per call, so serializers take the modules
  once per call (`lib_query.mods()`), never per row.
- `--source` on agent ops is provenance (where the agent learned it); the
  lead-source field is `--lead_source` (or `values`).
- Revenue reports (`forecast`, `winloss`, `sources`, the dashboard) leave
  out fundraising and hiring pipelines unless one is passed.
- Inside `lib_activity.run` use the tracked handle (`t`) for every write,
  or the change is not undoable.
- What is on screen (`app.ui`) is kept in server memory, not in the
  database, so it does not churn realtime.
- Dialogs are non-modal Radix dialogs with their own overlay; popovers
  carry `data-cr-popover` so clicks in them do not close the dialog.
- `exactOptionalPropertyTypes` is on: optional props are typed
  `?: T | undefined`.
- Colors come only from `--cr-*` tokens; `--cr-c1..c8` only tell
  categories apart.

## Ownership map

- Editable: `frontend/src/app/`, `pb/pb_migrations/` (new files only),
  `pb/pb_hooks/*.pb.js` and `lib_*.js` (not the `_*.js` system files),
  `operations.json` (non-system entries), `triggers.json`, this file,
  `reference/`.
- System-managed (never edit): `frontend/src/kit/`,
  `frontend/src/main.tsx`, `frontend/src/config.gen.ts`, the underscore
  hooks (`pb/pb_hooks/_*.js`), `manifest.json` (capabilities are written by
  the gate).
