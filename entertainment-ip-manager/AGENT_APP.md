# Entertainment IP Manager

> Per-project plan / context / index. The building agent keeps this current
> (spec A3). Only agent-owned areas are listed under "Editable".

## What this app does

One register for an entertainment company's IP: anime producers and licensors, VTuber and virtual-talent agencies, character and virtual-idol brands. Characters and their rights stacks (name, design sheet, outfits, Live2D and 3D models, voice, lore: who made each layer, how it was acquired, whether arts. 27 and 28 were named, moral-rights non-exercise), talents with lifecycle playbooks and a private identity vault, titles with copyright terms and clearances, music (composition, master, performance; JASRAC/NexTone registrations; Content ID), production committees with windows (窓口), consent requests and the full distribution waterfall, agreements with rights grants on hierarchical dimensions, third-party streaming permissions, licensed products with stage approvals (監修), seals (証紙) and royalty statements, trademarks and designs in JP, US, CN, KR, TW, EM and WO with renewals, and enforcement cases with evidence and notice drafts.

A rules-based deadline engine explains every date (steps in English and Japanese, business-day offsets on office calendars). The "Can we?" check answers a use per territory with eight checks and names who decides. External companies use the same app through scoped portals (licensee, committee member, outside reviewer). CraftBot only proposes (Inbox) or writes drafts; people decide.

English and Japanese throughout: per-person language (users.ui_language), organization default (settings.default_language), server-generated text stored in both languages, errors returned as `{ error, error_ja }`. No sample data ships; editable starter content does (rules, fees, holiday calendars, dimension trees, approval stage templates, guideline templates).

## Requirements

See `reference/requirements.md` (binding; it lists the eight decisions from the approved plan). Feature checklist:

- [x] Multi-user auth; roles admin, manager, rights, licensing, talent_manager, contributor, viewer; external licensee, committee_member, reviewer; first account is admin; nobody changes their own role
- [x] Onboarding: organization, business profiles (anime, talent, character) that switch modules on, home currency, default language, offices
- [x] Deadline engine: 77 shipped rules (trademarks and designs in JP, US, EM, WO, CN in two versions split at 2027-01-01, KR, TW; Paris priority; US copyright; Content ID; enforcement clocks; customs; talent playbooks), obligations generated from records (agreements, committees, products, approvals, permissions, society contracts and registrations, character assets, talents, cases, enrollments, fan permits, clearances), calendars for JP, US, EP, EM, WO, CN, KR, TW
- [x] Rights engine and "Can we?" (availability, who decides, original work, chain of title, performer consent, talent status, trademark cover by Nice class, copyright line)
- [x] Committees: members, windows, waterfall, distributions, recoupment, consent requests (art. 65)
- [x] Licensing desk: products, approvals with reviewer chains and business-day SLAs, seals, royalty statements with MG credit and late interest
- [x] Music: songs, recordings (ISRC per version), releases, society contracts and registrations, Content ID, setlist check, used-but-unregistered report
- [x] Talents: lifecycle playbooks, pre-stream check, exposure, identity vault
- [x] Trademarks and designs: office import and sync (JPO, USPTO TSDR, EUIPO; credentials optional), designations, coverage matrix, leak check, renewals with instructions and forecast
- [x] Enforcement: cases, action ladder, notice drafts (DMCA, Japanese platform request, marketplace report, warning letter), evidence with hashes, watch hits, platform enrolments, customs recordations
- [x] Guidelines (versioned, starter templates) and fan permits
- [x] Inbox review door for every automated proposal, with optional second reviewer
- [x] Reports (15) with CSV, daily digest (role-aware, portal digests), calendar feed, audit log
- [x] Frontend: every page in English and Japanese, external portal for licensees, committee members and outside reviewers

## Entities

| Collection | Purpose | Notes |
|------------|---------|-------|
| users | Accounts | `role`, `ui_language`; first user becomes admin |
| settings | Organization settings row | profiles, modules, default language, home currency, work calendar, approval stage templates, leak lag, prefixes |
| parties / involvements | People and companies; their roles on records | `parties.portal_users` links external accounts (admin only) |
| franchises / titles / characters / character_assets | IP catalogue and each character's rights stack | titles tree via `parent`; a relation to titles is always called `work` |
| talents / talent_identity / castings | Performers, private identity, who plays whom | identity readable only by admins and the talent's managers |
| committees / committee_members / consent_requests / distributions | Production committees | windows are `grants` of kind `window` on the committee agreement |
| agreements / grants | Contracts and their scope | grants use dimension include/exclude specs; outbound conflicts need an override reason |
| dimensions / dimension_values | territory, media, language, category (with Nice classes), channel, platform | labels in both languages |
| songs / recordings / releases / society_contracts / society_registrations / content_id_assets / content_id_claims / cid_allowlist | Music | ISRC and ISWC validated on save |
| permissions / guidelines / fan_registrations | Third-party permissions, our guidelines, fan permits | guideline templates have `template = true` |
| products / approvals / approval_rounds / seal_orders / royalty_reports / royalty_lines | Licensing desk | lines are priced by the server |
| families / matters / goods_services / renewals / fee_schedule / fx_rates | Trademarks and designs | rates per EUR; TWD and VND need manual rates |
| enforcement_cases / evidence / watch_hits / platform_enrollments / customs_recordations | Protection | a relation to enforcement_cases is called `case_ref` |
| events / deadlines / rules / office_calendars / calendar_years | Deadline engine | deadlines are never deleted; closed with a reason |
| inbox_items / documents | Review door and files | any record can be an Inbox subject |
| clearances | Clearance checklist per title | due and expiry create deadlines |
| saved_views / audit_log / notifications / sync_runs / ics_tokens / office_connections | System records | audit is append only |

`portal_users` (multi relation to users) on agreements, grants, committees, products, approvals, seal_orders, royalty_reports, consent_requests, distributions and documents is derived by hooks and is the only door for external accounts; committee_members, approval_rounds and royalty_lines follow their parent record's `portal_users` in their rules.

## Operations

Declared in `operations.json` (98 entries); discoverable at `GET /api/_ops`. All are `POST /api/ops/<path>` except `meta` (GET), `calendar.ics` (GET `/api/ics/{token}`) and `session.check` (GET). Params may arrive as strings; JSON arrays and objects as JSON strings.

- Core: `app.guide` (start here), `meta`, `onboarding.complete`, `settings.modules`, `portfolio.summary`, `portfolio.search`, `records.delete` (any record, preview first)
- Events and deadlines on any record: `events.preview`, `events.record`, `events.regenerate`, `deadlines.create|close|extend|reassign|move|upcoming|explain`, `rules.test`, `calendars.refresh`, `calendars.business-days`, `calendar.feed`, `calendar.ics`
- Inbox: `inbox.propose` (the only way automation adds anything), `inbox.preview`, `inbox.decide`
- Rights: `rights.can-we`, `rights.availability`, `rights.dimensions`, `agreements.check-conflicts`, `agreements.sync`, `titles.copyright-term`, `characters.chain`
- Committees: `committees.compute`, `committees.save-distribution`, `committees.mark-paid`, `committees.recoupment`, `committees.who-decides`, `consent.open`, `consent.answer`, `consent.close`
- Licensing: `products.submit-approval`, `products.advance`, `approvals.decide|resubmit|withdraw`, `seals.order|issue|reconcile|variance`, `royalties.add-lines|recalc|mg-status|record-payment`
- Portal: `portal.context`, `portal.submit-product`, `portal.submit-stage`, `portal.submit-statement`, `portal.order-seals`
- Trademarks: `matters.info|lookup|import-office|sync|designate|leak-check`, `coverage.matrix`, `renewals.decide|instruct|record-payment|forecast|refresh-costs`, `offices.save|test|sync-all`, `fx.refresh`, `import.matters`, `import.watch`
- Music and talent: `music.completeness|setlist-check|unregistered|neighbouring-terms|new-version`, `content-id.conflicts`, `content-id.claim-event`, `talents.pre-stream-check|exposure|lifecycle`, `permissions.recheck`, `guidelines.from-template|publish`, `fan.decide`
- Enforcement: `cases.draft-notice` (draft only, never sent), `cases.evidence`
- Reports and digest: `reports.run`, `digest.preview`, `digest.send`

Role gates are enforced in the route handlers (`lib_ops.handle(e, level, ...)`), not only in the UI.

## Operating from the CLI (how CraftBot drives this app)

Start with `agent-app run <project> app.guide`: conventions plus ready-to-run recipes for the common jobs.

- Names work wherever an id is asked. Every `*_id` param (and `subject_id`, `records.delete --id`) accepts the record id, its reference (AG-0002, PR-0001, TM-0001-JP, EC-0001, FP-0001), an office number for trademarks or designs (any punctuation), or the exact name ("Hikari", "Luna Hoshino", "Starlight Drive Committee"). An ambiguous name returns the candidates with their ids. Resolution happens once, in `lib_ops.handle` (`resolveParams`), for staff and agents only; portal accounts must pass ids so nobody can probe other companies' records by name.
- Can we? assets take `type:name` too (`character:Hikari`, `title:...`, `trademark:TM-0001-JP`).
- Dates are YYYY-MM-DD. Lists take JSON or comma-separated text; objects take JSON; booleans take true/false.
- Errors are `{ error, error_ja }`; a refused or failed op changes nothing.
- Deleting: `records.delete --collection <kind> --id <id or name> --preview true` lists what the delete takes along (relations marked cascade: an agreement takes its grants, deadlines, events and statements) and what only loses its link (products keep existing without the agreement); run it again without `--preview` after the user agrees. Manager rights (admin for deadlines, Inbox items, evidence, identity, rules and users), for the preview too since it names records; never your own account or the last admin; every delete is in the audit log with its reason. The UI's delete buttons use the same op (`components/deleteRecord.tsx`).
- Plain records (franchises, characters, talents, titles, songs, parties, ...) are created and edited with `agent-app data`; the server still validates them and derives refs, portal access and deadlines. Use the ops for everything with rules (events, deadlines, approvals, money, rights, lifecycle).

## Triggers (app to CraftBot)

Declared in `triggers.json`. Every trigger proposes through `inbox.propose` or writes a draft; none creates deadlines or decides anything.

| Trigger | Fired from | Result |
|---------|-----------|--------|
| agreement_extraction_requested | Agreements, document "Read the contract" | Inbox agreement draft with grants and citations |
| document_docketing_requested | Document "Docket this" on marks, cases, agreements and other records | Inbox proposal with one event, dates and citations |
| approval_review_requested | Approval drawer | `approvals.draft_comments` only |
| royalty_statement_requested | Statement documents "Read the statement" | Inbox royalty statement proposal |
| takedown_drafts_requested | Case page | `enforcement_cases.draft_notice` only |
| marketplace_scan_requested | Enforcement, watch tab | Inbox watch hits |
| guideline_check_requested | Permissions | Inbox permission proposal |
| portfolio_question_asked | Ask CraftBot (top bar) | Read-only answer |
| email_draft_requested | Renewals, agreements, committees | Email draft in the user's account, never sent |

## External data

| Source | Used for | Auth | Called from |
|--------|----------|------|-------------|
| USPTO TSDR `tsdrapi.uspto.gov` | US trademark status | API key (optional) | lib_offices.js |
| EUIPO API `api.euipo.europa.eu` (or sandbox) | EU trade marks and designs | OAuth client credentials (optional) | lib_offices.js |
| JPO API `ip-data.jpo.go.jp` | JP trademarks and designs | password grant (optional); daily call budget | lib_offices.js |
| ECB `www.ecb.europa.eu` eurofxref-daily.xml | FX reference rates | none | lib_fx.js |
| Cabinet Office `www8.cao.go.jp` syukujitsu.csv | Official Japanese holidays | none | lib_calendar.js |
| CraftBot bridge `send_gmail`, `send_slack_message` | Digest delivery when the channel is email or Slack | CraftBot connections | lib_digest.js |

Rules: hooks only (never the frontend), always a `timeout`, non-200 is a clean error recorded on the connection and in `sync_runs`. Office changes never write directly: they become `office_change` Inbox items. CN, KR and TW have no office connection: records are entered by hand. China's 2027 holiday list was not published at build time; add it in Settings > Calendars when it is.

## Crons

- `eipm_hourly`: reminders and escalations, the daily digest at the configured hour, the lapse sweep
- `eipm_daily`: time-based obligations (birthdays, anniversaries, fiscal years, rolling report periods) and approval timeouts
- `eipm_office_sync`: one office sync a day at `settings.sync_hour` when enabled
- `eipm_fx`: one successful ECB fetch a day; renewal costs follow
- `eipm_monthly`: official Japanese holidays and the JPO keep-alive call

## Live data (every view follows agent writes)

`frontend/src/app/lib/live.ts` is the only way views load data: `useCollection` (with expand-source subscriptions), `useLiveAsync`, `useLiveReload`, `useLiveRecords`. A new view that loads data must use one of these.

## Frontend

- `reference/FRONTEND_GUIDE.md` is binding for every page: strings through `t()` with Japanese in `locales/ja/<area>.ts`, no em dashes, ops for every action, responsive at 400/768/1280 px with no page-level horizontal scroll.
- `lib/records.ts` and `lib/enums.ts` are generated from the schema by `reference/tools/gen_records.py` (dump the schema with `reference/tools/dump_schema.py` from a migrated scratch database). Regenerate after any schema change; never edit them by hand.
- `node scripts/i18n-check.ts` (from `frontend/`) fails on a missing Japanese entry, a dictionary conflict or an em dash anywhere in the app.

## Hooks layout

- `lib_util.js` dates, records, JSON reads (`u.j`), roles and levels, bilingual errors (`u.err(en, ja)`), audit, notifications in the recipient's language, refs
- `lib_calendar.js` office calendars, roll forward, business days
- `lib_engine.js` subjects, event codes, rule evaluation, proposals, commit, regenerate, close/extend, expiry, copyright terms, renewals
- `lib_obligations.js` deadlines generated from record fields (keys `obl:<type>:<id>:<key>`)
- `lib_rights.js` dimension trees, availability, deciders, Can we?, conflicts, coverage matrix
- `lib_committee.js` waterfall, distributions, recoupment, consent
- `lib_licensing.js` reviewer chains, approvals, seals, royalty pricing, MG
- `lib_music.js` ISRC/ISWC, shares, completeness, setlist check, neighbouring terms
- `lib_talent.js` pre-stream check, exposure
- `lib_portal.js` derived `portal_users`
- `lib_offices.js` office clients, snapshot diff, sync (TSDR, EUIPO, JPO)
- `lib_digest.js` digest, reminders, lapse sweep, ICS
- `lib_reports.js` summary, search, forecast, reports, CSV import
- `lib_records.js` delete rules per collection, aliases, impact preview (cascades and unlinks)
- `lib_fx.js`, `lib_inbox.js`, `lib_ops.js` (route plumbing: role guard, bilingual errors, name and reference resolution)
- `eipm_system.pb.js` record hooks, audit hooks, crons
- `ops_core`, `ops_inbox`, `ops_marks`, `ops_rights`, `ops_licensing`, `ops_music_talent`, `ops_protect`, `ops_records` (`.pb.js`) every declared operation
- `cache_control.pb.js` no-store on the SPA shell

Goja rules that bite here: require libs inside every callback; helpers defined at file scope in a `.pb.js` file are invisible inside callbacks (put them in a `lib_*.js`); read JSON fields with `u.j(record, field, fallback)`; request bodies come from `e.requestInfo().body`; hooks must never mention the agent request queue collection by name.

## Ownership map

- Editable: `frontend/src/app/`, `frontend/scripts/`, `pb/pb_migrations/`, `pb/pb_hooks/` files that do not start with an underscore,
  `operations.json` (non-system entries), `triggers.json`, this file, `reference/`.
- System-managed (never edit): `frontend/src/kit/`, `frontend/src/config.gen.ts`, `frontend/src/main.tsx`,
  the underscore hooks (`pb/pb_hooks/_*.js`), `manifest.json`.
