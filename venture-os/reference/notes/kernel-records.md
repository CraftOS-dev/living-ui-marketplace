# kernel-records builder notes

Built the shared records backend of Venture OS: people and companies (identity, provenance, the agent rule, merges with undo), deals and pipelines (stages with stall days, stage events, the deal team, restricted deals), files (owners, folders, versions, NDA rights, protected serving, the background text step through the Research OS PDF engine, OCR pages, anchors with resolve and citation scope) and theses (criteria on the fit engine). 50 operations, no UI (screens belong to kernel-frontend and the modules).

Scratch: `SCR/kernel-records/app` on port 3182 with a stand-in kernel (HR OS kernel, plus kernel-core's in-progress `lib_ops.js`, `lib_activity.js` and `lib_catalog.js` copied so the tests run on the real dispatcher model: one tracked transaction per write op, `_activity` in answers, `auto` op checks, dry runs for proposals). Nothing of the stand-in was copied into APP.

## Files (copied into APP)

- `pb/pb_migrations/1741000100_records.js` (people, companies, employments, aliases, dupe_ignores), `1741000110_deals.js` (pipelines, deals, deal_people, stage_events; seeds `deal_flow`), `1741000120_files.js` (files, file_texts, pages, anchors), `1741000130_theses.js` (theses). Every rule null.
- `pb/pb_hooks/lib_records.js, lib_norm.js, lib_deals.js, lib_files.js, lib_text.js, lib_theses.js`
- `pb/pb_hooks/cat_records_people.js, cat_records_companies.js, cat_records_core.js, cat_deals_core.js, cat_files_core.js, cat_theses_core.js`
- `pb/pb_hooks/events_records.js` (search, timeline), `guide_records.js` (app.guide section), `cron_records.js` (the text step every minute; see contract changes)
- `engine/textlayer.mjs` (entry: pdf, office, plain, image, none) and `engine/pdftext.mjs` (Research OS PDF reader, unchanged in its reading; exports `readPdf`)
- `reference/tests/kernel-records/` (t01 to t05, `run_all.mjs`, `fixtures.mjs`, `lib.mjs`, README, `stubs/` test kit)

## Data model

- `people`: name, name_key, email (primary, unique when set), emails (JSON), phone, title, company (rel), linkedin, location, bio, tags, origin (`manual, capture, intake, import, agent, markets, portfolio, other`), prov, merged_into, deleted_at, actor, member.
- `companies`: name, name_key, domain (root, unique when set), domains, website, description, kind (`startup, investor, corporate, service, other`), sector, subsector, hq_country, hq_city, founded_year, team_size, business_model, linkedin, tags, origin, prov, merged_into, deleted_at, actor, member.
- `employments` (person, company, title, current, start_day, end_day), `aliases` (kind, old_id, new_id: merged ids resolve), `dupe_ignores` (kind, a, b).
- `pipelines`: key (unique), name, kind (`deal_flow, spv, lp_raise, program`), stages JSON `[{key, label, stall_days}]`. `deal_flow` seeded: sourced 7, screen 7, first_meeting 7, diligence 21, partner_meeting 14, ic 7, term_sheet 21, closed 0. spv, lp_raise and program are created on first use with default stages.
- `deals`: number (`D-0001`, from `lib_util.nextId(app, 'D', 4)` on settings.seq), name, company, pipeline, stage, stage_entered_at, status (`open, invested, passed, lost, hold`), status_reason, status_at, point, source (`inbound, referral, outbound, scout, event, sourced, co_investor, portfolio, other`), source_person, round JSON `{type, raise_minor, pre_money_minor, post_money_minor}`, currency, check_minor, instrument (`safe_cap, safe_discount, safe_mfn, note, priced, other`), fund, restricted, agent_allowed, tags, intake_item, prov, last_activity_at, deleted_at, actor, member.
- `deal_people`: deal, **member** (the team member, as kernel-core's `dealVisible` reads it), person, role (`point, team, founder, contact, co_investor, advisor, referrer`), team (true for the firm's deal team), actor, added_by.
- `stage_events` (append only): deal, pipeline, kind (`created, moved, status`), from_stage, to_stage, from_status, to_status, days_in_from, note, at, run, actor, member.
- `files`: owner_collection, owner_id, deal (rights and NDA follow it), folder, name, file (protected, 200 MB), bytes, mime, ext, version, prev, current, origin (`upload, email, agent, import, link, generated, system`), source_ref, nda, meta, deleted_at, run, actor, member.
- `file_texts` (one per file version): state (`waiting, extracting, ready, needs_ocr, none, failed`), error, started_at, attempts, sha256, pages, pages_with_text, ocr_pages, engine, same_as, meta (outline, info). Written with SQL by the upload and the engine starter, so it never joins an op's undo unit.
- `pages`: file, page_no, width, height, rotate, text, items, lines, chars, needs_ocr, origin (`pdf_text, ocr, plain, office, none`).
- `anchors`: kind (`text, area, message`), file, page_no, start, end, quote, rects, area, message_id, ref_collection, ref_id, deal (citation scope), run, actor, member.
- `theses`: name (unique, any case), statement, criteria (the fit engine's shape), status (`active, archived`), fund, owner, sort, prov, actor, member.

## Operations (50) and agent rules

| Op | Perm | Your AI agent |
|---|---|---|
| people.list, people.get, people.timeline | network:view | allow |
| people.upsert | network:edit | allow (new records and empty fields; a person's value becomes a people.update proposal) |
| people.link | network:edit | allow |
| people.update | network:edit | propose (note_fields) |
| people.merge | network:edit | propose (merges) |
| people.delete | network:full | deny (destructive, soft delete) |
| companies.list, companies.get, companies.timeline | network:view | allow |
| companies.upsert | network:edit | allow (as people.upsert) |
| companies.update | network:edit | propose (note_fields) |
| companies.merge | network:edit | propose (merges) |
| companies.delete | network:full | deny (destructive, soft delete) |
| records.enrich | network:edit or pipeline:edit | allow (fill empty fields with --source_ref, required for the agent; conflicts become proposals) |
| records.timeline | signed | allow |
| records.dupes | network:view | allow |
| records.ignore-dupe | network:edit | allow |
| deals.list, deals.board, deals.get | signed (rows by deal visibility; `hidden: n`) | allow |
| deals.create | pipeline:edit | allow at the first stage; a later stage becomes a proposal (deals) |
| deals.update | pipeline:edit | propose (note_fields; `auto: lib_deals.autoUpdate` runs only non-financial fields directly when promoted) |
| deals.move | pipeline:edit | propose (stage_moves; `auto: lib_deals.autoMove`: only a move to screen when promoted) |
| deals.assign, deals.team | pipeline:edit | propose (deals) |
| deals.people | pipeline:edit | allow (founders and contacts) |
| deals.status, deals.restrict | pipeline:edit | deny |
| pipelines.list | signed | allow |
| pipelines.save | settings:edit | deny |
| files.list, files.get, files.download, files.text, pages.get | signed (owner rights, deal visibility, NDA) | allow; NDA files only with --job |
| files.upload, files.version | signed (edit rights on the owner) | allow (`--paths`; multipart field `file`; bodyLimit 200 MB) |
| files.delete | signed | propose (files; soft delete of every version) |
| files.move | signed (edit rights on the file and the new owner) | allow (every version; to another folder, or to a deal, company or person) |
| files.set-nda | signed (on: edit rights and a deal; off: the deal team) | deny (audited with before and after) |
| pages.set-ocr, anchors.create | signed | allow |
| anchors.resolve | signed | allow |
| theses.list, theses.get, theses.fit | markets:view or intake:view | allow |
| theses.keys | signed | allow |
| theses.save | markets:edit | propose (theses) |

Counts: 34 allow, 10 propose, 6 deny.

## Exported functions (exact signatures)

lib_records
- `upsertCompany(ctx, { company?, name?, domain?, website?, description?, kind?, sector?, subsector?, hq_country?, hq_city?, founded_year?, team_size?, business_model?, linkedin?, tags?, origin?, source_ref? }) -> company view + { created, changed, kept, proposal, deleted }`
- `upsertPerson(ctx, { person?, email?, emails?, name?, phone?, title?, company? (id, domain, name or an object for upsertCompany), linkedin?, location?, bio?, tags?, origin?, source_ref? }) -> person view + { created, changed, kept, proposal, deleted }`
- `link(ctx, personId, companyId, title, { current?, start_day?, end_day?, source_ref? }) -> employment`
- `merge(ctx, kind ('people'|'companies'|'person'|'company'), keepId, dropId) -> { kept, dropped, filled, moved }`
- `get(ctx, kind, ref) -> view` (person: + employments, deals, deals_hidden; company: + people, deals, deals_hidden)
- `resolve(app, kind, ref, { deleted? }) -> record` (id, merged id, alias, person by email, company by domain or exact name; 404 or 409 with candidates)
- `timeline(ctx, { company | person | deal, limit?, before? }) -> { target, items: [{ at (ISO), module, kind, title, href?, icon?, actor?, ref? }], hidden, next_before }`; a module adds `timeline: 'lib_x.fn'` to events_*.js, fn(ctx, { kind, id, company?, person?, deal? }) -> items or { items, hidden }
- `search(ctx, q, limit)`, `timelineFor(ctx, target)` (registrations), `personOut(app, rec)`, `companyOut(app, rec)`, `mini(app, collection, id)`, `provEntry(ctx, sourceRef)`, `who(ctx)`, `stampWritten(ctx, rec)`, `emit(ctx, name, payload)`, `inRun(ctx, op, fn)`, `upsertCompanyIn(ctx, t, o, meta, state)`, `upsertPersonIn(ctx, t, o, meta, state)`

lib_deals
- `create(ctx, { company, pipeline?, stage?, source?, source_person?, point?, round?: { type, raise_minor, pre_money_minor, post_money_minor }, check_minor?, currency?, instrument?, fund?, name?, restricted?, agent_allowed?, intake_item?, people?: [{ person, role }], tags?, source_ref? }) -> deal view` (emits deal.created; 409 duplicate when the company has an open or held deal in that pipeline)
- `move(ctx, dealId, stageKey, note) -> deal view` (stage key or label; 409 not_open unless open; emits deal.moved)
- `setStatus(ctx, dealId, status, reason) -> deal view` (emits deal.closed for every status but open)
- `assign(ctx, dealId, memberRef) -> deal view`, `team(ctx, dealId, { add?: [memberRef], remove?: [memberRef] }) -> deal view`, `people(ctx, dealId, { add?: [{ person, role }], remove?: [personRef] }) -> deal view`, `restrict(ctx, dealId, restricted, agentAllowed) -> deal view`
- `visible(ctx, deal) -> boolean` (kernel `lib_auth.dealVisible`, and for a person pipeline view or a seat on the team), `visibleSql(ctx, alias) -> { sql, bind }` (the same rule in SQL), `guard(ctx, deal)` (403 restricted), `isTeam(app, dealId, memberId)`
- `get(ctx, ref) -> deal view`, `ref(app, ref) -> record`, `fill(ctx, ref, fields, sourceRef)`, `pipelineOf(app, ref)`, `stagesOf(pipeline)`, `cardOut(app, deal, zone?)`, `dealOut(app, deal, detail)`, `autoMove(ctx, params)`, `autoUpdate(ctx, params)`
- Deal view: id, number, title, company, pipeline, stage, stage_label, stage_index, days_in_stage, stalled, stalls_on, status, point, round_type, raise_minor, currency, check_minor, restricted, last_activity_at, name, stage_entered_at, status_reason, status_at, source, source_person, round, ownership_ppm (check over post-money), instrument, fund, agent_allowed, tags, intake_item, prov; with detail: pipeline (stages), team, people, files.

lib_files
- `add(ctx, { owner_collection, owner_id, name?, origin?, nda?, folder?, deal?, source_ref?, job?, path | upload }) -> file view` (emits file.added; `path` is for your AI agent only, refused inside the app folder)
- `fromPath(ctx, { path, owner_collection, owner_id, name?, origin?, nda?, folder?, deal?, source_ref? }) -> file view` (trusted hook code: loads the file with `$filesystem.fileFromPath`; refuses the app's secrets; the source file stays)
- `text(app, fileId) -> [{ page_no, text, chars, needs_ocr, origin, width, height }]`
- `pathOf(app, fileId) -> absolute local path`
- `move(ctx, fileId, { owner_collection?, owner_id?, folder?, deal?, job? }) -> file view` (every version)
- `canRead(ctx, fileRecord, { job?, deleted? }) -> { ok, reason }`, `canWrite`, `fileFor(ctx, id, { write?, job?, deleted? })`, `fileOut(app, f, text?)`, `textsOf(app, ids)`, `hrefOf(app, f)`, `chain(app, f)`, `kick(app)`, `collect(app, fileId)`, `collectFor(app, ids)`, `textTick(app)`
- Kept from HR OS for the kernel: `mimeOf, uploaded, uploadedAll, localFile, fileParam, absPath, serve, csvInput`
- Scouts (roles with own_items) reach only files whose owner is an intake item they submitted (`intake_items.submitted_by`), never a deal's; files.list of an owner the caller may not see answers 403 instead of an empty list.
- `cards(app, where, bind, order, limit, offset)` in lib_deals: board and list cards in one SQL query (company and point partner joined, round fields by json_extract, stall days from day numbers with lib_eng_days.offsetMinutes, equal to lib_eng_days.stall on 20,000 random cases).
- Owners (`OWNERS`): deals, companies, people, intake_items, notes (pipeline rights), entities, capital_events, quarters, reports, statements (funds), lps (lps), holdings, updates, board_meetings (portfolio), memos, ic_meetings (committee), theses (markets). Your AI agent reads lps, capital_events, quarters, reports and statements files only while fund data is on for it.
- File view: id, name, folder, owner_collection, owner_id, deal, bytes, mime, ext, version, prev, current, origin, source_ref, nda, text_state, text_error, sha256, pages, pages_with_text, ocr_pages, same_as, actor, member, deleted_at, created.

lib_text
- `anchor(ctx, { file, page?, start?, end?, lines?, from_char?, to_char?, quote?, area?, job? }) -> anchor view` (same passage, same anchor)
- `messageAnchor(ctx, { message_id, ref_collection?, ref_id?, start, end, quote, deal? }) -> anchor view`
- `resolve(ctx, anchorIds, { deal?, job? }) -> [{ id, ok, reason?, kind, file, file_name, version, page, start, end, quote, rects, area, message_id, ref_collection, ref_id, deal, valid, in_scope, deleted }]` (valid: the page still holds the quote; null for message anchors; in_scope with deal: its own room, or files of the deal's company that belong to no deal)
- `resolveSpec(ctx, spec)`, `storePages(app, fileId, result, ocrBelowChars)`, `lineSpans(text)`, `rectsFor(items, start, end)`, `anchorOut(app, a)`

lib_theses
- `FACT_KEYS`, `FACT_TYPES` (getters: the fit engine's own objects, never copied), `facts() -> { key: { type, label, ops, values?, code?, unit? } }`
- `validateCriteria(raw) -> clean criteria` (unknown keys and fields named with the closest, coded values within their lists, then `lib_eng_fit.validate`)
- `fit(app, thesisId, facts) -> { thesis: { id, name }, checks: [{ key, label, op, required, status, reason, value }], counts, required }` (`lib_eng_fit.fit` with `lib_fx.rate`; facts `{ key: { value, grade } }` or plain values or a list of `{ key, value, grade }`)
- `active(app)`, `thesisRef(app, ref)`, `thesisOut(app, t)`, `COMPANY_STAGES`, `ROUND_TYPES`, `BUSINESS_MODELS`

lib_norm (CRM, kept whole plus three helpers): `email, validEmail, emails, domain, domains, isFreeMail, workDomain, phone, url, companyFromDomain, nameFromEmail, companyKey, nameKey, tags, country, currency`.

## Events emitted (payloads are ids)

`person.created { person }`, `company.created { company }`, `record.merged { kind, keep, drop }` (inside the merge's unit: re-point your own rows to keep and Undo restores them), `deal.created { deal, company, pipeline, stage }`, `deal.moved { deal, from, to, pipeline }`, `deal.closed { deal, status, reason }`, `file.added { file, owner_collection, owner_id, deal, version }`, `file.text_ready { file, text_state, ocr_pages, owner_collection, owner_id, deal }` (once per version when its text step ends, whatever the outcome; again when OCR turns a needs_ocr file ready).

## Decisions

- Identity follows CRM lib_norm. A name match without email or domain is used only when it is the only one (409 with candidates otherwise); a person by name only within the same company. A company found by name without a domain takes the domain it is given.
- The agent rule is per field: empty, written by your AI agent or the app, or an added list item: direct; a person's value: a proposal of the update op (kind note_fields), returned in the answer. A second email or domain from your AI agent is added beside the primary.
- Writes go through `ctx.app` (the kernel's tracker in an op), so a merge with every link it moved, or a deal with the company and founders it created, is one undo unit; my code leaves the unit's summary with `lib_audit.note`.
- Text step beside the request: `kick` spawns `node engine/textlayer.mjs` with `$os.cmd(...).start()` (at most 2 at a time), keeps the process to reap it, and the answer (written to a temp name and renamed) is stored by the next read of a file in the step or by the minute cron; a stopped engine is retried once after 12 minutes. A page with under 20 non-space characters of a PDF or a picture is needs_ocr. PPTX gives a page per slide in presentation order, DOCX and text files pages of 200,000 characters.
- Stalls by `lib_eng_days.stall` (calendar days in the firm's zone, settings.zone).
- NDA files must belong to a deal; reads by your AI agent need a claimed job whose deal and nda match (`lib_jobs.ndaAllowed`) and are written to the audit trail. NDA files never appear in Ctrl-K search.
- Deleting files, people and companies is a soft delete (Undo and the trash restore them).

## Contract changes (from SPEC 4.5, 6, 7.2, 15)

1. New collection `file_texts`: the text step's state lives beside the file, written with SQL, so an Undo of an upload still works after the background step changed it (the kernel's undo guard compares the file record with its state after the upload). File views merge it; nothing else changes for callers.
2. `deal_people.member` is the team member (kernel-core's `dealVisible` reads it); who added the row is `added_by` (not the usual `member`).
3. `cron_records.js` added to my files (the text step's minute tick).
4. Extra ops beyond SPEC 7.2: people.update, companies.update, people.link, people.delete, companies.delete, records.timeline, records.dupes, records.ignore-dupe, deals.people, pages.get, anchors.create, theses.keys, theses.fit. The provenance param is `source_ref` everywhere (deals use `source` for the deal source enum).
5. Extra event `record.merged`; `deal.closed` also for hold.
6. `lib_files.add` takes `deal`, `source_ref`, `job` as well; `move` and `canRead` exported.
7. Theses criteria are the fit engine's shape (op eq, in, gte, lte, between, exists, bool; values, min, max; money with currency; `required` false unless set).
8. Proposal kinds used: note_fields, merges, stage_moves (promotable in kernel-core's PROMOTABLE), deals, files, theses (always ask).

## What I need from kernel-core

- Keep: `lib_util.nextId(app, 'D', 4)` and the helpers I use (keysOnly, nearest, money, like, rows, one, count, exec, page, oneOf, day, int, text, squash, clip, jsonOf, today, nowIso, slug), `lib_auth.dealVisible / fundDataVisible / systemCtx / memberRef / can / need / scope / inScope`, `lib_jobs.ndaAllowed(app, jobId, dealId)`, `lib_events.timelineFns()` and `search` providers called as fn(ctx, q, limit), `lib_proposals.fromCall(ctx, spec, params)`, `lib_settings.row(app)` (zone, base_currency, agent_sees_fund_data) and `autoAllowed(app, kind)`, `lib_fx.rate(app, from, to, day) -> { rate_e8 } | null`, `lib_money.fromMinor`, `lib_audit.note / write`, `lib_catalog.get`, and the dispatcher's tracked transaction per write op with `_activity`.
- `tools/gen.mjs` must accept the op fields I use: `preview`, `auto` (on propose ops), `files`, `bodyLimit` (files.upload and files.version: 209715200), and the proposal kinds above.
- Problem found in kernel-core's scratch files (not fixed by me): `lib_activity.js` line 23 (`SKIP` lists `agent_requests`) and `lib_exports.js` line 13 make the gate fail ("trigger queue ownership (hooks)": any mention of agent_requests in hooks). The trigger queue is outside the tracker anyway (it is not saved through it); remove the key or use the trigger lib's constant.
- `jobs` and `ask`: modules queue NDA jobs with `lib_jobs.enqueue(app, { ..., deal, nda: true })` (works with kernel-core's enqueue as it is).

## npm dependency

`pdfjs-dist` 6.4.299 in `frontend/package.json` dependencies (the text engine reads `frontend/node_modules/pdfjs-dist`, as Research OS does; the diligence reader needs the same package). Node 22.13 or later on the host PATH.

## Tests and gate

`reference/tests/kernel-records/run_all.mjs` on the scratch copy (port 3182): t01 identity and merges 56 passed, t02 deals 61, t03 files 67, t04 theses 32, t05 sweep 8 (every read op x owner, partner, analyst, your AI agent on an empty database and with data: no 5xx; the 5 people-only ops refuse your AI agent before params). 224 passed, 0 failed. Gate (`agent-app/tools/src/cli.ts validate` on the scratch app): all steps passed. `tools/gen.mjs` is not in APP yet, so the merged catalog was not generated there.

## Known gaps

- XLSX, legacy .doc and .ppt get no text layer (state none; your AI agent reads them through files.download).
- Message anchors do not check their text (valid null): the message body lives in other modules.
- No full-text index over pages (search covers file names); diligence may add one over `pages`.
- deals.funnel, stall Next items and retention purge candidates are left to the deals module and the kernel.
- After a restart, an engine started before it is not reaped by the new process (its answer is still stored).
- The tests were written against the stand-in kernel: check `lib.mjs` `setupFirm` (setup.complete params, invites) against the merged kernel before running them in APP.

## Fix round (coordinator, 2026-11-12)

1. `lib_deals.ref`: a merged deal (soft deleted, with an alias) resolves to the deal kept, through chains of merges; any other deleted deal stays 404. Tested with deals.merge (deals module): old id and old D-number both resolve, also after a second merge.
2. `deals.board` and `deals.list`: one query for every card instead of four reads per card. With 600 deals the board handler takes about 40 to 95 ms (Server-Timing; it was 840 ms end to end) and deals.list of 200 cards about 20 to 30 ms; wall clock on this machine was 100 to 350 ms while 19 PocketBase servers and 90 browsers shared the CPU (100% load), so t02 asserts the handler time (under 150 ms) and prints the wall times. Cards keep their shape.
3. `lib_files.chain` reads by SQL with bound values: a record filter bound to '' (the root folder) matched nothing, so versions lists, moves (deals.merge, intake advance) and deletes of root-folder files did nothing. New op `files.move` (folder or owner). Tested: root versions, files.version, files.move to a deal and between folders, delete of every root version, deals.merge carrying a root file with both versions.
4. Scouts read and write only the files of their own intake items (see Rights).
5. `files.set-nda` (people only, audited).
6. Raw SQL writes (file_texts rows: lib_files.js newTextRow and setText) call `lib_bus.touch` for file_texts and files; a stored text answer touches files.
7. `lib_records.resolve` also finds a person by exact name when only one person has it (409 with candidates when several), as the guide already said; diligence refs.log relies on it.

Module tests run on this scratch copy: intake t01 to t03 (24, 116, 31) and diligence t01 to t05 (84, 98, 33, 36, 18) all pass; deals t01 passes (32). Two deals expectations are now stale and belong to the deals tests: t03_flow expects deals.get of a dropped (merged) deal to answer 404 (it now resolves to the kept deal, fix 1), and t02_notes line 78 logs a reference for "Jane Doe", a person that test never created (its stub refs.log took any name; the real refs.log resolves the person).

Tests: t01 58, t02 75, t03 96, t04 32, t05 9 (270 checks, all passing) on the merged kernel (fresh scratch copy of APP, port 3182). The test kit (`stubs/`) gained `testkit.bulk-deals`; `lib.mjs` now sets up the firm through the merged kernel (members.invite needs the PIN; two scouts invited).

## Majors fix (2026-11-12, QA m1/UI-02)

Proposal previews read as people speak, through kernel-core's `lib_proposals.line()` and `titleOf()`: `deals.update` "<company>: Raise, Post-money" with "Raise: USD 12M -> USD 15M" (only fields that really change; `"12000000.00"` equals the stored 12M; select values by their labels, a person or fund by name, a currency change shown with both currencies), `deals.move` "<company>: Stage" (stage labels), `deals.assign` "<company>: Point partner" (names), `deals.team` "<company>: Add to team, Remove from team" (names); each carries `ref` = the display id. `DEAL_FIELDS` entries gained `label` and `OPTION_LABELS` holds the words of source, round type and instrument (as the deal page shows them). `people.update` and `companies.update` "<name>: <field labels>" (LinkedIn, HQ country, Founded, ...), merges "<kept>: Merge <dropped>" with only the fields that change, `files.delete` "<file>: Remove", `theses.save` "<thesis>: <labels>" with criteria as a list and fund and owner by name.

## Fix 5 (2026-11-13): logos, a company's stage, founders and team links

- Migration `1741009300_logos.js`: `companies.logo` and `settings.logo` (one protected image: png, jpg, webp, svg; 2 MB),
  `companies.stage` (select: idea, pre_seed, seed, series_a, series_b, series_c, growth; the theses vocabulary) and
  `employments.founder` (bool).
- `lib_logos.js` (new): `companyUrl(rec)`, `companyUrlOf(id, stored)`, `firmUrl(settingsRec)` (`/api/ops/companies/logo?company=&v=`,
  `/api/ops/settings/logo?v=`; the version changes with the stored file), `domainOf(app, domain)` ('' in a demo firm; the
  demo flag is read at most every 5 s per runtime), `viewOf(app, rec) -> { logo_url, logo_domain }`. Serving reuses
  `lib_files.serve` (people get the bytes with their session; your AI agent the local path; SVG sandboxed).
- Ops: `companies.logo-set` (network:edit; multipart field `file`, or `--paths` with one absolute path for your AI agent;
  agent `propose`, kind `logos`; bodyLimit 8 MB so an oversized image gets a clear 400 `too_large`), `companies.logo-remove`
  (people only), `companies.logo` (GET, signed), `settings.logo-set`, `settings.logo-remove` (perm admin = settings:full,
  people only), `settings.logo` (GET, signed). Every change audited with before and after.
- Your AI agent's `--paths` proposal: the preview copies the image into `pb_data/vo_staged/logos/<sha256 of path, size,
  time>.<ext>` and the stored proposal names that copy, so the accepting person stores exactly the proposed image (the
  same file proposed twice is the same proposal); the copy is removed once stored. A person never passes a path (403).
- Every company read carries `logo_url` and `logo_domain`: `lib_records.mini` (companies), `companyOut`, deal cards
  (`CARD_SELECT` joins `c.logo`), `network.record` (company), `portfolio.company`, holdings rows, intake items.
- `companies.get` people: `companyPeople(ctx, id)`: founders first (a founder seat on a visible deal, or a current job
  marked founder), then the team (other current jobs), each `{ id, name, email, title, role: founder|team, job }`.
- `people.link --founder true|false` marks the job a founder's. New `people.unlink --person --company` (network:edit;
  agent `propose`, kind `people_links`): ends the current jobs there today, clears `people.company` when it names the
  company, removes founder and contact seats on its visible deals; 409 `not_linked` when there is nothing to undo.
- `companies.*` params `founded_year` and `team_size` are text now, so '' clears them (numbers still work); `stage`
  added. Kind labels: `logos` "Company logo", `people_links` "Team change" (lib_proposals).
- Known gap: an Undo of a logo change restores the previous file name, but PocketBase already deleted that file; screens
  then fall back to the website icon or the letter. Staged images of dismissed or expired proposals stay in
  `pb_data/vo_staged/logos` (a few KB each).
- Tests: `SCR/fix5/work/t_ops.mjs` (76 checks), `t_empty.mjs` (343: every read on an empty firm, no 5xx).
