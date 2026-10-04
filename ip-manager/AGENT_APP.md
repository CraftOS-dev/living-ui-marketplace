# IP Manager

> Per-project plan / context / index. The building agent keeps this current
> (spec A3). Only agent-owned areas are listed under "Editable".

## What this app does

One register for everything an organization owns: patents, trademarks, designs, copyrights and creative works, inventions, and the agreements that license them. A rules-based deadline engine with explained dates, renewal decisions with multi-currency cost forecasts, rights availability with conflict checks, office data sync (USPTO, EPO, EUIPO, JPO) through a review inbox, and CraftBot reading documents and contracts into reviewable proposals.

General purpose by design: a vocabulary pack (general, entertainment, technology, consumer) only renames Property/Work (Franchise/Title, Product line/Asset, Brand/Creative asset) and switches rights dimensions on or off. Any team size (four-eyes review is a setting). Any currency (ECB reference rates plus manual rates). Office credentials are optional: every feature works by hand.

## Requirements

See `reference/requirements.md` (binding). Feature checklist:

- [x] Multi-user auth with roles (admin, manager, counsel, contributor, inventor, viewer); first account is admin; later sign-ups get the default role
- [x] Onboarding (organization, vocabulary pack, home currency, filing offices)
- [x] Today dashboard, Inbox (review door for all automated data), Deadlines (list, calendar, table, calendar feed)
- [x] Deadline engine: 59 shipped rules (US, EP, EM, JP, PCT, Madrid, US copyright/termination), office closure calendars, explain/extend/move/close with reasons
- [x] Portfolio (patents incl. utility models, trademarks, designs, copyrights), matter page, families/marks, national phase and continuations
- [x] Properties and works (vocabulary-driven), trademark coverage matrix, copyright terms, clearance and chain of title
- [x] Agreements with scope grants on hierarchical rights dimensions, conflict checks, obligations, royalty reports, product approvals
- [x] Rights explorer (availability by territory/media/language/time with reasons)
- [x] Renewals: decisions, instructions (letter + CSV), payments, multi-year forecast in home currency
- [x] Inventions: disclosure intake, scoring, pipeline, conversion to filings with grace-period deadlines
- [x] Watch hits triage and disputes
- [x] People and companies directory, reports with CSV export and saved/scheduled reports, daily digest and reminders
- [x] Settings: organization, people and access, office connections, rules, calendars, fees and currency, rights dimensions, invention scoring, CSV import, audit log, my account

## Entities

| Collection | Purpose | Notes |
|------------|---------|-------|
| users | Accounts | `role` select; users cannot change their own role; first user becomes admin |
| settings | Single organization settings row | vocab pack, home currency, reminders, digest, second reviewer, renewal default, prefixes, sync/fx |
| office_connections | One row per office API (uspto_odp, uspto_tsdr, epo_ops, euipo, jpo) | admin only; secrets hidden fields, never returned |
| properties | Franchises / brands / product lines | tree via `parent`; rights basis owned / acquired / mixed |
| works | Titles / creative assets | tree via `parent`; copyright term inputs |
| families | Patent/design families and trademark marks | mark image, strategy |
| matters | Registrations and applications | ref `P-0001-US` style; status + status_group; sync state |
| goods_services | Trademark classes per matter | use evidence files |
| parties / involvements | People and companies, and their roles on records | inventors, authors, owners, counsel |
| agreements / grants | Contracts and their scope | grants use dimension include/exclude specs |
| dimensions / dimension_values | Rights dimensions (territory, media, language, channel, category, field of use) | hierarchical codes |
| disclosures / disclosure_reviews / scoring_criteria | Invention intake and review | inventors see only their own |
| rules | Deadline rules as data | versioned (code + version unique) |
| office_calendars / calendar_years | Office closure days | computed lazily; JP refreshed from the Cabinet Office |
| deadlines | Every dated obligation | never deleted by users (admin only); closed with a reason |
| events | What happened on a matter/agreement/work | drives rule deadlines |
| renewals / fee_schedule / fx_rates | Renewal decisions, official fees, exchange rates | fees support cycle ranges, per class, class tiers and per claim; seeded for US, EP, UP, EM, JP, WO; rates per EUR |
| inbox_items | Proposals from office sync and CraftBot | decided only through `inbox/decide` |
| documents | Uploaded files linked to any record | docketing / extraction triggers |
| clearances | Clearance and chain-of-title checklist per work | |
| approvals / approval_rounds | Licensed product approvals | |
| royalty_reports | Expected and received royalty statements | |
| watch_hits / disputes | Watch report triage and proceedings | |
| saved_views | Saved searches and scheduled reports | |
| audit_log / notifications / sync_runs / ics_tokens | System records | audit is append only |

## Operations

Declared in `operations.json`; discoverable at `GET /api/_ops`. All are `POST /api/ops/<path>` except `meta` (GET), `calendar.ics` (GET `/api/ics/{token}`) and `session.check` (GET `/api/session/check`, token in `X-Session-Token`, always 200; App.tsx awaits it before the kit's login gate mounts so a session from another database is dropped without 401s).

- Portfolio: `meta`, `onboarding.complete`, `portfolio.summary`, `portfolio.search`, `properties.coverage`, `works.copyright-term`
- Matters: `matters.preview-event`, `matters.record-event`, `matters.regenerate`, `matters.info`, `matters.lookup`, `matters.import-office`, `matters.sync`, `matters.national-phase`
- Deadlines: `deadlines.close`, `deadlines.extend`, `deadlines.reassign`, `deadlines.move`, `deadlines.upcoming`, `deadlines.explain`, `rules.test`, `calendars.refresh`, `calendar.feed`, `calendar.ics`
- Inbox: `inbox.propose` (the only way automation adds dates), `inbox.preview`, `inbox.decide`
- Renewals: `renewals.decide` (destructive: lapse), `renewals.instruct`, `renewals.record-payment`, `renewals.forecast`, `renewals.refresh-costs`, `fx.refresh`
- Rights and deals: `rights.availability`, `agreements.check-conflicts`, `agreements.sync`, `approvals.decide`
- Inventions: `disclosures.submit`, `disclosures.move`, `disclosures.review`, `disclosures.convert`
- Offices: `offices.save`, `offices.test`, `offices.sync-all`
- Import, reports, digest: `import.matters`, `import.watch`, `reports.run`, `digest.preview`, `digest.send`

Role gates are enforced in the route handlers (`u.deny(e, level)`), not only in the UI.

## Triggers (app to CraftBot)

Declared in `triggers.json`. Every trigger tells CraftBot to propose through `inbox.propose` and never write deadlines directly.

| Trigger | Fired from | Result |
|---------|-----------|--------|
| document_docketing_requested | Inbox upload, document "Docket this" | Inbox proposal with event, dates and citations |
| agreement_extraction_requested | Agreements "Read a contract", document "Extract terms" | Inbox agreement draft with grants |
| renewal_instructions_requested | Renewals instruct dialog | Email draft only |
| portfolio_question_asked | Ask CraftBot (top bar) | Read-only answer |
| invention_assist_requested | Invention page | Writes only `answers.craftbot_draft` |

## External data

| Source | Used for | Auth | Called from |
|--------|----------|------|-------------|
| USPTO Open Data Portal `api.uspto.gov` | US patent application data and file wrapper events | API key (X-API-KEY) | lib_offices.js |
| USPTO TSDR `tsdrapi.uspto.gov` | US trademark status | API key (USPTO-API-KEY) | lib_offices.js |
| EPO OPS `ops.epo.org` | EP register, events, INPADOC family | OAuth client credentials | lib_offices.js |
| EUIPO API `api.euipo.europa.eu` (or sandbox) | EU trade marks and designs | OAuth client credentials + X-IBM-Client-Id | lib_offices.js |
| JPO API `ip-data.jpo.go.jp` | JP patents, designs, trademarks progress and registration | password grant; daily call budget | lib_offices.js |
| ECB `www.ecb.europa.eu` eurofxref-daily.xml | FX reference rates | none | lib_fx.js |
| Cabinet Office `www8.cao.go.jp` syukujitsu.csv | Official Japanese holidays | none | lib_calendar.js |
| CraftBot bridge `send_gmail`, `send_slack_message` | Digest delivery when the channel is email or Slack | CraftBot connections | lib_digest.js |

Rules: hooks only (never the frontend), always a `timeout`, non-200 is a clean error recorded on the connection and in `sync_runs`. Office changes never write directly: they become `office_change` inbox items. No generated data substitutes a real source.

## Live data (every view follows agent writes)

Anything written by anyone, including CraftBot or another agent through the REST API or the operations, shows on open pages without a refresh. `frontend/src/app/lib/live.ts` is the only way views load data:

- `useCollection` (import it from `lib/live.ts`, never from the kit directly): the kit's realtime list plus subscriptions to every collection its `expand` reads.
- `useLiveAsync(fn, deps, sources)`: computed views (Today summary, renewal forecast, coverage, matter info, copyright terms) re-run quietly when a source collection changes.
- `useLiveReload(sources, onChange, enabled)`: previews, the Rights explorer, the report on screen, search and the digest preview re-run on changes; previews keep the person's ticks (`mergeSelection`).
- `useLiveRecords(collection, snapshot)`: dialogs and drawers handed a record (deadline dialogs, Why this date) follow it live.

A new view that loads data must use one of these and list the collections it reads.

## Hooks layout

- `lib_util.js` dates, records, JSON field reads (`u.j`), roles, audit, notifications, refs
- `lib_calendar.js` office holiday calendars and roll forward
- `lib_fx.js` conversion through EUR rates
- `lib_engine.js` rule evaluation, proposals, commit, regenerate, close/extend, expiry, renewals, agreement obligations
- `lib_rights.js` dimension trees, availability, conflicts
- `lib_offices.js` office clients, snapshot diff, sync
- `lib_digest.js` digest, reminders, lapse sweep, ICS
- `lib_reports.js` summary, search, forecast, coverage, reports, CSV import
- `ip_system.pb.js` record hooks, audit hooks, crons (hourly reminders/digest, daily office sync, 3-hourly FX, monthly JP holidays + JPO keep-alive)
- `ops.pb.js` every declared operation
- `cache_control.pb.js` no-store on the SPA shell

Goja rules that bite here: require libs inside every callback; read JSON fields with `u.j(record, field, fallback)` (record.get returns bytes); no destructuring or `for..of Object.entries`; hooks must never mention the agent request queue collection by name.

## Ownership map

- Editable: `frontend/src/app/`, `pb/pb_migrations/`, `pb/pb_hooks/ops.pb.js`, `pb/pb_hooks/ip_system.pb.js`, `pb/pb_hooks/lib_*.js`, `pb/pb_hooks/cache_control.pb.js`,
  `operations.json` (non-system entries), `triggers.json`, this file, `reference/`.
- System-managed (never edit): `frontend/src/kit/`, `frontend/src/config.gen.ts`,
  the underscore hooks (`pb/pb_hooks/_*.js`), `manifest.json`.
