# Entertainment IP Manager: frontend guide

For anyone building pages in `frontend/src/app/pages`. Read this whole file before writing code.

## What the app is

An IP manager for entertainment companies: anime producers and licensors, VTuber and virtual-talent
agencies, character and virtual-idol brands. It tracks the rights stack of each character, titles,
talents, music (composition, master, performance), production committees and their windows, agreements
and grants, licensed products with their approvals (監修), seals (証紙) and royalties, trademarks and
designs in JP, US, CN, KR, TW, EM and WO, enforcement cases, third-party permissions (game and music
streaming guidelines), and fan guidelines and permits. Principles from the approved plan:

- The character is the center: products, licences, songs, marks and cases link to the characters they use.
- Every yes has a name on it: show who can approve a use, and why.
- Every date is explained: deadlines come from a rule or a contract clause you can open ("Why this date?").
- Automation proposes, people decide: CraftBot, office data and email land in the Inbox. Nothing automated writes a deadline.
- Performers are private by default: legal identities (talent_identity) are visible only to admins and that talent's managers.
- Japanese practice first: Japanese terms next to English, Japanese business days for SLAs, JPY by default, any currency allowed.
- No sample data anywhere. Empty states explain what goes there and offer the action that fills it.

## Hard rules

1. **Every visible string goes through `t()`** (or `tn()`, `bi()`, `tf()`, `enumLabel()`), and every literal you
   pass to `t()`/`tn()` gets a Japanese entry in YOUR area's dictionary `src/app/locales/ja/<area>.ts`.
   Write natural business Japanese (です/ます in sentences, short noun phrases for labels). Before adding a key,
   check `locales/ja/core.ts` and `locales/ja/enums.ts`: if the key is already there, just use it. If the same
   English needs a different Japanese in your context, use a context key: `t('Open|action')`.
   Server text arrives bilingual: `{ en, ja }` objects (render with `bi()`), or record fields with a `_ja`
   twin (`title`/`title_ja`, `label`/`label_ja`, `name`/`name_ja`: render with `tf(rec, 'title')`).
   Server error toasts are already bilingual (lib/api.ts picks `error_ja`).
2. **No em dashes** (the long dash, U+2014) anywhere: code, copy, comments, dictionaries. Use commas, colons,
   parentheses or two sentences. The check script fails on it.
3. **Only edit the files you own** (listed in your brief): your page files, new components named
   `components/<area><Name>.tsx`, and `locales/ja/<area>.ts`. Never edit `lib/*`, `components/` files you do not
   own, `App.tsx`, `kit/`, `main.tsx`, `config.gen.ts`, backend files, or the base app. If you need a shared
   change, work around it inside your own files and mention it in your final report.
4. **Every user action goes through the backend**: an `/api/ops/*` route via `op()` / `opToast()` from
   `lib/api.ts`, or a plain record create/update via `createRecord`/`updateRecord` where the collection's rules
   allow it and no op exists. Do not write fields the server derives: `portal_users`, `ref`, `permission_no`,
   `status_group`, `next_deadline*`, `expiry_date`, `sync_*`, deadline `calculation`, report totals,
   royalty line `royalty`/`rate` (the server prices lines). Business rules live in ops; if an op exists for an
   action (see `operations.json` and the `pb/pb_hooks/ops_*.pb.js` files), use the op, not a raw update.
   Read the hook code for the exact request params and response shape before you call an op.
5. **Responsive**: every page works at 400px, 768px and 1280px wide with **no page-level horizontal scroll**.
   Use `min-w-0` on flex/grid children that hold text, `break-words`/`truncate` for long names, responsive grids
   (`grid gap-3 sm:grid-cols-2 lg:grid-cols-3`), toolbars that wrap (`flex flex-wrap gap-2`). Wide tables go in
   a `<div className="overflow-x-auto">` wrapper so only the table scrolls, or become stacked rows on small
   screens (`hidden md:block` table + `md:hidden` list). Dialogs use `className="w-[min(94vw,40rem)]"`.
6. **Roles and modules**: read `useApp()`. `can.read` (internal), `can.contribute`, `can.edit`, `can.rights`,
   `can.licensing`, `can.talent`, `can.manage`, `can.admin`, `can.external`. Hide or disable actions the
   person cannot do (the server refuses them anyway). `on('music')` etc. tells whether a module is switched
   on: hide tabs and links into switched-off modules.
7. **Live data**: use `useCollection` from `lib/live.ts` (not the kit's directly) so views follow changes
   made by anyone, including CraftBot. For op-derived data use `useLiveAsync(fn, deps, [collections])`.
8. Colors only through tones (`Pill`, `EnumPill`, `TONE_*`) and `var(--agent-app-*)` CSS variables. No
   hard-coded hex colors. Follow the base app's look: sharp corners, sections with borders, monospace refs.
9. TypeScript strict with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`: optional props are
   typed `x?: T | undefined`; index access can be undefined.

## Foundation you build on

- `lib/records.ts`: generated record interfaces for every collection (`CharacterRec`, `TalentRec`, ...).
  `lib/enums.ts`: every select field's values and English labels. `lib/shapes.ts`: JSON field shapes and op
  response types (`Proposal`, `CanWeResponse`, `ReportResult`, `PortalContext`, `Bi`, ...). If an op returns
  something not typed there, declare the interface in your own file.
- `lib/i18n.ts`: `t`, `tn`, `bi`, `tf`, `enumLabel(field, value)`, `enumOptions(field)` (pairs for selects),
  `isJa()`, `getLang()`, `joinList`.
- `lib/labels.ts`: `toneOf(field, value)`, `VERDICT_TONE`, `verdictLabel`, `LEVEL_TONE`, `OFFICES`,
  `jurisdictionName(code)`, `CURRENCIES`, `roleHelp`, `moduleLabel`, `profileLabel`.
- `lib/format.ts`: `d10`, `toPb`, `today`, `addDays`, `addMonths`, `daysUntil`, `fmtDate`, `fmtShort`,
  `fmtMonth`, `relLabel`, `ago`, `fmtDateTime`, `fmtMoney(amount, currency)`, `fmtNumber`, `fmtPct`,
  `deadlineSeverity`, `isStatutory`, `windowLabel`, `windowOf`.
- `lib/api.ts`: `op<T>(path, body)`, `opGet`, `opToast<T>(path, body, successMessage)` (returns null on error,
  toasts it), `createRecord`, `updateRecord`, `deleteRecord`, `getRecord`, `listAll`, `fileUrl(rec, file)`,
  `q(value)` to quote a filter literal, `errText`.
- `lib/context.tsx`: `useApp()` gives `settings, lang, homeCurrency, jurisdictions, profiles, modules, on(),
  users, userName(id), me, role, can, meta (event codes etc.), dimValues, dimLabel(dim, code),
  franchises, titles, characters, talents, nameOf(type, id)`. Also `useAsync`.
- `lib/router.ts`: `href(page, id?, params?)`, `navigate`, `useRoute`, `useHashParam(key, fallback)` (use it
  for tabs and filters so they survive reloads), `RECORD_PAGE`, `subjectHref(subjectType, id)`.
- `components/ui.tsx`: `PageHeader`, `Section`, `GroupHeader`, `ListRow`, `StatTile`, `EmptyHint`, `Loading`,
  `ErrorBox`, `Notice`, `Fact`, `FactGrid`, `Field`, `Segmented`, `Checkbox`, `Kbd`, `Toolbar`, `Prose`,
  `Pill`, `EnumPill`, `Tag`, `JurChip`, `Ref`, `IdentityChip`, `Dot`, `TONE_TEXT/BG/DOT/BAR`. Read the file for props.
- `components/DataTable.tsx`: sortable table with CSV export and column picker. Read the file for props.
- `components/pickers.tsx`: `UserSelect`, `JurisdictionSelect` (`officesOnly` for the 7 offices),
  `JurisdictionChips`, `CatalogSelect` (franchise/work/character/talent from context), `RecordPicker`,
  `MultiRecordPicker`, `PartyPicker`, `DimensionPicker` (include/exclude tree), `dimSpecLabel`.
- `components/deadlines.tsx`: `useDeadlineActions(onChanged)` returns `{ actions, canEdit, dialogs }`;
  render `<DeadlineList deadlines={rows} actions={dl.actions} canEdit={dl.canEdit} showSubject={false} />`
  and `{dl.dialogs}`. Deadlines of a record: `useCollection<DeadlineRec>('deadlines', { filter: 'talent = "<id>"', sort: 'due_date' })`
  (the relation field per record type: matter, agreement, work, character, talent, product, approval,
  permission, committee, case_ref, registration, claim, recordation, society_contract, fan_registration, enrollment).
  Also `deadlineSubject(d)`, `kindHelp(kind)`, `WhyDrawer`.
- `components/events.tsx`: `<EventDialog subjectType="talent" subjectId={id} onClose onDone />` records an event
  with a deadline preview (codes come from `meta.event_codes` filtered by record type; pass `codes` to narrow).
  `RegenerateDialog` after base dates change. `useEventCodes(type)`, `useEventLabel()`.
- `components/documents.tsx`: `<DocumentsPanel relation="agreement" relationId={id} extraction />` with
  `docketing` (office letters, platform notices), `extraction` (contracts), `statementFor={agreementId}`
  (licensee sales reports) hand-offs to CraftBot.
- `components/deleteRecord.tsx`: every delete goes through `<DeleteButton collection id onDeleted />` (or `useDeleteRecord().ask`): it previews what the delete takes along via records/delete and hides itself for people who may not delete. Never call deleteRecord() directly. `note` adds advice only the caller knows ("mark the member as exited instead"); the dialog already warns for deadlines and events. Tables use `deleteCol<T>(collection, canDelete(can, collection))` as their last column; dialog footers use `<FooterDelete collection id onDeleted={onClose} />`. A new collection needs an entry in lib_records.js DELETABLE (and ADMIN_ONLY here when admin-only).
- `components/confirm.tsx`: `useConfirm()` returns `[element, confirm]` with translated buttons. Never use the kit's useConfirm (English-only buttons).
- `components/craftbot.tsx`: `handToCraftBot(trigger, params)` returns a request id (adds `lang`);
  `<AgentStatus requestId=... />` follows it live. Triggers (see `triggers.json`):
  `agreement_extraction_requested {document_id}`, `document_docketing_requested {document_id, subject_type?, subject_id?}`,
  `approval_review_requested {approval_id}`, `royalty_statement_requested {document_id, agreement_id}`,
  `takedown_drafts_requested {case_id, forum?}`, `marketplace_scan_requested {character_id? | franchise_id?, marketplaces?}`,
  `guideline_check_requested {permission_id}`, `portfolio_question_asked {question}`,
  `email_draft_requested {subject_type, subject_id, purpose, to?}`. Every trigger only proposes (Inbox) or
  writes drafts; say so in the UI ("CraftBot drafts it, you send it").
- Kit (`../../kit/index.ts`): `Button` (variants primary, outline, ghost, link; sizes sm, icon; `loading`),
  `Input`, `Select` (`options`, `placeholder`, `label`), `Textarea`, `Switch`, `Dialog` (`open, onOpenChange,
  title, description, footer, className`), `Drawer` (`open, onClose, title, width, footer, side`),
  `DropdownMenu`, `Tabs/TabsList/TabsTrigger/TabsContent` (give TabsList `className="flex h-auto w-full flex-wrap"` so tabs wrap at 400px), `Tooltip`,
  `toast`, `NumberInput`, `DateInput`, `SearchInput`, `TagInput`, `FileUpload`, `ImageInput`, `cn`.
  Read `src/kit/components/*.tsx` for exact props when unsure.

## Reference implementation

The base app this one grew from is IP Manager (`ip-manager` in the Agent App marketplace), at
`frontend/src/app` in that app. Its pages show the house style and patterns: `pages/Matter.tsx` (record page with tabs), `pages/Today.tsx`,
`pages/Inbox.tsx`, `pages/Deadlines.tsx`, `pages/Renewals.tsx`, `pages/Agreement.tsx`, `pages/Rights.tsx`
(availability grid), `pages/Approvals.tsx`, `pages/Enforcement.tsx`, `pages/People.tsx`, `pages/Reports.tsx`,
`pages/Settings.tsx` and `components/admin*.tsx`, `components/matter*.tsx`, `components/deals*.tsx`,
`components/renew*.tsx`, `components/workInbox.tsx`. Reuse their structure and interaction design, but
everything must be rebuilt on this app's schema, ops, i18n and roles. Copy no English-only strings.

## Page anatomy

- `PageHeader` with title, meta (a count), subtitle (one plain sentence of what the page is for) and actions.
- List pages: a toolbar (search box, filters as `Select`s or `Segmented`, persisted with `useHashParam`),
  then a `Section` with rows (`ListRow` or a `DataTable`), empty state via `EmptyHint` with the action that
  creates the first record. Creating a record opens a `Dialog` form; save with `createRecord`, then
  `navigate(page, id)` to the new record.
- Record pages: header with name, key pills, primary actions; tabs via `useHashParam('tab', 'overview')`
  (`Segmented` or kit `Tabs`); an Overview tab with `FactGrid`s and the next deadlines; an edit dialog for the
  record's own fields; Documents and Deadlines tabs where the record has them; History (events for the record:
  `useCollection('events', { filter: '<field> = "<id>"', sort: '-date' })`).
- Pass `showSubject={false}` to `DeadlineList` on a record's own page.

## Verify before you finish

From `frontend/`:

```
node node_modules/typescript/bin/tsc -p . --noEmit
node scripts/i18n-check.ts
```

Other people are building other pages at the same time, so you may see errors in files you do not own:
ignore those, but your own files must be clean in both checks. Also re-read your pages for: every string
through `t()`, no em dash, no horizontal page overflow at 400px (look for fixed widths, long unbroken text,
non-wrapping flex rows), and every action going through an op or an allowed record write.

Your final report: the files you wrote, the ops and collections each page uses, anything you could not do,
and any shared change you would have needed.
