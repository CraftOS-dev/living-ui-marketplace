# kernel-frontend notes (HR OS)

Built by the kernel-frontend builder, 2026-11-04. The look is Piano Coach (BUILD_SPEC 12); every module builds
its pages from `components/ui.tsx` and the `--hr-*` tokens in `theme.css`. Do not add a second design system.

Status: the contract below (routes.tsx, lib/contract.ts, lib/api.ts, lib/live.ts, lib/format.ts, lib/money.ts,
lib/i18n.ts, lib/auth.tsx, lib/router.ts, components/ui.tsx) is final. Kernel pages (setup, sign in, people,
inbox, settings, print frame) are done; later fixes keep their exports and props.

## 0. Shared rules (UI QA, 2026-11-05): every module re-syncs to these

The kernel components already follow them, so a page built from `components/ui.tsx` inherits most of it.

**Type scale.** Only 10.5px (mono caps labels: `.hr-label`), 12, 13, 14, 15 and 26px. 12 secondary lines and hints,
13 body and controls, 14 card titles, 15 dialog and sheet titles, 26 the page title (PageHeader does it) and the one
big readout (StatTile). Classes `.hr-t12 .hr-t13 .hr-t14 .hr-t15 .hr-t26` (size and line height) or `text-[12px]`
... `text-[26px]`. No 9, 10, 11, 11.5, 12.5, 13.5, 14.5, 16, 17, 18, 20 or 22px anywhere (`ux_audit.mjs` reads
every rendered text node's computed size and fails on anything else).

**Dates and times.** One style for the whole app: the company's (Settings, Company, Date style) or, when that is
"entity", the legal entity's country format (the entity passed, else the sidebar's, else the viewer's own employment
entity, so a Japanese employee sees JP style everywhere, else the first). Timestamps read in that entity's time zone:
`today({ entity })` is the office's today and `dayOf(ts, { entity })` the office's day of a timestamp; `fmtDay`,
`time`, `ago` and `fmtDateTime` given a timestamp do the same. Never `new Date().toISOString().slice(0, 10)` or
`created.slice(0, 10)` (that is the UTC day: "Sent 4 Nov" at 9 in the morning in Tokyo on 5 Nov). Styles: SG
`16 Nov 2026`, US `Nov 16, 2026`, JP `2026/11/16`, CA ISO. Use only `lib/format.ts`: `fmtDay(day, { year, weekday, entity, country })`, `fmtRange(from, to, { entity })`, `fmtMonth`,
`fmtDateTime`, `time(v, { entity })` (24 h, 12 h for month-first styles), `ago`, `relDay`, `weekday`, `monthName`.
Pass `{ entity }` when the record belongs to one (a person's employment, a pay run, a claim). Never `toLocaleDateString`, never an ISO day or a server-formatted date on screen:
operations should answer days ('YYYY-MM-DD'), not text with days in it (see section 7 for the server summaries
that still do).

**Money.** Every amount on screen is `<Money minor currency />` (or `formatMoney` for text that never shows pay,
such as a file name). It hides behind Hide pay as a fixed mask (`PAY_MASK`, the digits are not in the page at all),
shows the ISO code unless the reporting currency is alone on screen, and keeps each currency's decimals (JPY 0, KWD
3). Typed facts for the profile ("At a glance") and similar: send `{ kind: 'money', value: <minor>, currency, per }`
or `{ kind: 'day', value: 'YYYY-MM-DD' }`; the kernel's `FactValue` (pages/people/ProfileTabs.tsx) renders them. Never
send or print "SGD 0.00" or "2800000" as text. `money_lint.mjs` loads every page and fails on a raw minor amount,
and on any amount left in the text with Hide pay on.

**Profile facts (one shape for every module backend).** A module's `profileFacts` (events_<module>.js) answers a
list of `ProfileFact` (lib/contract.ts):
`{ key, label, value: string | number, kind?: 'text' | 'money' | 'count' | 'days' | 'hours' | 'date', currency?, tone?: 'neutral' | 'good' | 'warn' | 'bad', link? }`.
`money` values are integer minor units with `currency` (shown by `<Money>`, so Hide pay applies), `date` values are
'YYYY-MM-DD' (shown in the date style), `days` and `hours` are numbers ("14 days", "37.5 h"), `count` a number; a
fact without `kind` is text. The period of a money fact goes in its label ("Monthly pay"). The kernel renders every
fact with `FactValue` (ui.tsx), on the profile and wherever facts appear; use it too. Today's backends to align:
payroll sends `kind: 'day'` (now `'date'`) and `per` (put the period in the label), expenses sends a formatted
"SGD 0.00" text (send `kind: 'money'` with minor units), leave sends "14 days available" text (send `kind: 'days'`
with the number and say "available" in the label), lifecycle and time send text (fine for text).

**Timestamps to days (one sweep for module code).** `format.ts` now has `stampDayKey(ts, { entity })` (a PocketBase
timestamp's day key in the entity's time zone, for grouping and comparing; a 'YYYY-MM-DD' day comes back as it is),
`fmtStampDay(ts, opts)` (the day in the date style) and `fmtStamp(ts, f)` (day and time). Replace every
`x.some_at.slice(0, 10)` with `stampDayKey(x.some_at)` and `new Date().toISOString().slice(0, 10)` with `today()`.
The mechanical sweep across module folders was refused by this session's permission check (writing other modules'
files), so it is left to each module (the script is `SCR/kernel-frontend/tools/sweep_stamps.py <frontend/src/app>`,
a dry run without `--write`, which lists exactly these replacements). Files and replacements found in APP on
2026-11-05 (hiring had already fixed its own):
- expenses: components/expenses/AddExpense.tsx: 2 (today()); components/expenses/Panels.tsx: 1 (stampDayKey(c.submitted_at)); pages/expenses/Advances.tsx: 2 (today()); pages/expenses/Claim.tsx: 3 (stampDayKey(c.submitted_at), stampDayKey(h.at), today()); pages/expenses/Claims.tsx: 2 (stampDayKey(c.submitted_at), today()); pages/expenses/Mine.tsx: 1 (stampDayKey(c.submitted_at))
- home-reports: pages/me/Pages.tsx: 1 (stampDayKey(d.set_at)); pages/me/parts.tsx: 1 (stampDayKey(a.created))
- lifecycle: components/lifecycle/bits.tsx: 1 (stampDayKey(task.done_at)); pages/lifecycle/Board.tsx: 1 (today()); pages/lifecycle/Grievances.tsx: 2 (stampDayKey(g.created), stampDayKey(r.created)); pages/lifecycle/Handbook.tsx: 4 (stampDayKey(page.acked_at), stampDayKey(page.published_at), stampDayKey(v.created), stampDayKey(x.acked_at)); pages/lifecycle/Letters.tsx: 2 (stampDayKey(l.acked_at), stampDayKey(l.issued_at)); pages/lifecycle/Separations.tsx: 2 (stampDayKey(s.exit_interview?.done_at), today()); pages/lifecycle/widgets.tsx: 1 (stampDayKey(l.acked_at))
- payroll-core: pages/payroll/core/People.tsx: 1 (stampDayKey(pending[0]?.created))
- payroll-out: pages/payroll/out/YearEnd.tsx: 1 (stampDayKey(d.issued_at)); pages/print/payroll/YearEndPrint.tsx: 1 (stampDayKey(issued.at))
- performance: pages/performance/Calibration.tsx: 1 (stampDayKey(h.at)); pages/performance/Cycles.tsx: 1 (stampDayKey(h.at)); pages/performance/GoalPage.tsx: 1 (stampDayKey(c.at)); pages/performance/Review.tsx: 1 (stampDayKey(last.at))
- time: pages/time/ProfileTab.tsx: 1 (today())

**Entity rows still to swap (one line each, refused for the same reason):** payroll-out
`components/payroll-out/parts.tsx` `EntityChooser`: return `<EntityPicker value={value} onChange={onChange}
label={t('po.entity')} className="w-[240px] max-w-full" />` (Year end, Pay-out settings); time
`pages/time/Settings.tsx` RulesTab: `<EntityPicker value={entity} onChange={(v) => (setEntity(v), setSel(''))}
label={t('time.set.entity')} entities={ents} className="w-[240px] max-w-full" />` (EntityPicker takes `entities`).

**Tap targets.** On touch screens (`pointer: coarse`) everything you tap is 40 x 40 or more. ui.tsx does it for you:
Button, every field and picker (`FIELD`), Checkbox, MenuItem, DataTable rows and Inbox rows (`.hr-tap`: at least
40 x 40), IconButton, the back arrow, Segmented, Tabs and the Toggle's button around its track (`.hr-tap-sq`:
40 x 40); Hint and LinkButton (`.hit`: an invisible 40 x 40 touch area, the mark keeps its size). These are real
boxes (getBoundingClientRect is 40), except `.hit`. Your own clickable `<a>` or `<button>`: add `hr-tap` (rows, list items), `hr-tap-sq`
(square icons) or `hit` (inline links, small marks). The phone audit checks 40px, not 24.

**Page header.** `<PageHeader title meta back>{actions}</PageHeader>`: title 26px with the mono meta on its baseline
(Piano Coach), no rule under it. On a phone (under 768px) the first row holds menu, back, "More" (every page action,
one or many) and the shell's search, Hide pay and notifications; the title has the whole width on its own line under
it (two lines at most, never cut to a few letters), the meta under the title. Do not hide actions with
`hidden sm:inline-flex`; put them all in the header. Keep titles a natural short form ("Payslip, Nov 2026"), the
detail goes in `meta`. One black (primary) button per screen: card and row actions are default buttons.
`phonehead.mjs` checks every route at 360, 390 and 430.

**Panel headers.** A Panel's `aside` (its actions) wraps under the label when the header is too narrow (phones) and
never crosses the border; keep asides to one or two small buttons or a Menu.

**Panels.** Number them 01, 02, 03 in reading order on every page (and from 01 in each tab); tiles under a panel
as 01.1, 01.2; never letters, never 00. Panels without a number are fine; mixing numbered and unnumbered on one
page is not.

**Home widgets are numbered with Home.** A `homeWidgets` component now receives `{ index }` (`HomeWidgetProps` in
lib/contract.ts: "03", its place in Home's reading order) and passes it to its Panel: `function Widget({ index }:
HomeWidgetProps) { return <Panel index={index} label=...> }`. home-reports (the Home host): number Home's own panels
and the widgets in one reading-order count and render `<w.component index={idx()} />`.

**Sidebar.** The black row shows `PrimaryAction.short` (one or two words, "Run payroll"; the full `label` is its
tooltip); with no people in the company it is "Add people". Only the place you are in shows its children (no place is open by default); a place the person opens
stays open. Keep `nav` short: setup pages (components, rule packs, settings) belong under one "Settings" child.

**One entity control.** `<EntityPicker value onChange label all? />` (ui.tsx): the sidebar switch in field form.
Never a native select of entities or a Segmented row of entity codes. Default to `useUi().entity`.

**First steps.** Until the company has people, lead with `<FirstPeople />` (pages/people/Start.tsx: "Add your first
people" with Hire and Import a spreadsheet; `inline` for a panel). A sign-in without an employee record gets
`<NotLinked />` (an administrator links themselves to a person or adds themselves; anyone else is told who links
it), never a dead end and never a read that fails with 409. home-reports: Home's setup guide leads with
`<FirstPeople inline />` while `counts.people === 0`, and `/me` renders `<NotLinked />` when `me.employee === null`
(both one line; the kernel does not edit your files).

**PIN inside a confirm.** For a `confirm` operation behind a question ("Lock this pay run?") use
`const pin = await confirmPin(text, title, okLabel)` and pass `{ pin }` to the op: one dialog with the PIN boxes,
not a confirm and then a PIN dialog on top.

## 1. The module page contract (`frontend/src/app/pages/<module>/index.tsx`)

Types live in `lib/contract.ts`; the full comment is at the top of `routes.tsx`. Your index exports:

| Export | Type | What the kernel does with it |
|---|---|---|
| `routes` | `RouteDef[]` `{ path, page, title, perm?, frame? }` | Hash routes. Paths start with your module segment (`/time/...`). `perm` as in the catalog (`'time:view'`, `'team'`, `'employee'`, `'admin'`, alternatives with `|`; default signed). No page folds the sidebar: only the viewer's own toggle does. `frame: 'print'` renders the page alone on A4 (`/print/<module>/...`). Pages get `{ params, query }`. |
| `nav` | `NavChild[]` `{ key, label, to, perm? }` | Child rows under your place in the sidebar (the place itself, its icon and order are the kernel's `places()` in routes.tsx). |
| `useNavTree` | `() => NavTree \| null` | Data rows under your place with an inline "+" (`children`, `onAdd`, `addLabel`, `addTo(id)`, `addToLabel`). Payroll: pay schedules with "+" for an off-cycle run. A hook; called once per render. |
| `profileTabs` | `ProfileTab[]` `{ key, label, component, perm?, selfAndTeam?, order? }` | Extra tabs on the employee profile. `component` gets `{ employee, employment, entity, currency, self }`. Shown when `perm` passes, or to the person and their managers unless `selfAndTeam: false`. |
| `primary` | `PrimaryDef[]` `{ for: 'payroll'\|'manager'\|'employee', usePrimary }` | The one black action at the top of the sidebar. `usePrimary()` returns `{ label, icon, to? , run?, busy? }` or null. The kernel shows payroll's for payroll editors, Approvals (Inbox) for managers and people editors, time's for employees. Stubs: time "Clock in" to `/time`, payroll "Run payroll" to `/payroll`; replace them (for example the next due run, or a real clock in/out). |
| `approvalViews` | `Record<kind, Component<{ approval }>>` | The decision context inside an Inbox approval card for your approval kinds (balance before and after, who else is away, policy flags). `approval` is the `approvals.list` row (kind, ref_collection, ref_id, payload, summary, amount_minor, currency, employment...). |
| `inboxSections` | `InboxSection[]` `{ key, label, useItems, order?, perm? }` | Blocks in Inbox "For you" below approvals and proposals; item counts add to the sidebar Inbox badge. `useItems()` is a hook returning `InboxItem[] \| null` `{ id, title, sub?, link?, due?, person?, actions?: [{ label, run, primary? }] }`, only the viewer's own open items. |
| `homeWidgets` | `HomeWidget[]` `{ key, for: 'admin'\|'manager'\|'employee', component, order?, size: 'wide'\|'narrow' }` | Collected by `homeWidgets(kind)` in routes.tsx for the Home page (home-reports builder). `component` gets `{ index }` (HomeWidgetProps) for its Panel. |
| `publicRoutes` | `RouteDef[]` `{ path, page, title }` | Pages that open before sign-in (the time kiosk, `/time/kiosk/:code`). Once the company is set up they render alone, without the shell, in every session state (signed out or in), and get `{ params, query }`. Their operations must be `perm: 'public'`; the page keeps its own device credential (the kiosk token), never a member session. `perm` and `frame` are not used. |

Rules: a module root page (`/time`, `/leave`, `/expenses`, `/payroll`, `/performance`) serves every role that
reaches it (an employee sees their own view there; the phone bottom bar links to it). Payroll: `pages/payroll/index.tsx`
(payroll-core) spreads the exports of `pages/payroll/out/index.tsx` (payroll-out). The stub `index.tsx` in each module
folder is yours to replace. Print pages: use `PrintHead`, `PrintTable` from `pages/print/index.tsx`.

## 2. Data: `lib/api.ts`, `lib/live.ts`

- `op<T>(name, params, opts?)`: the member token rides along; GET params as the query, POST as JSON (lists and
  objects stringified). Errors are `OpError { status, code, message, data }`; a toast shows the message unless
  `{ quiet: true }`. A 401 session code sends the person to sign in. **PIN**: every op in `PIN_OPS` (effect confirm)
  opens the PIN dialog before it is sent; `{ pin: { title, text } }` words it; a wrong PIN asks again with the tries
  left. `askPin()` gets one PIN for a batch (pass it as the `pin` param). Approvals that need a PIN (`needs_pin`)
  are decided with `{ pin }` by the Inbox.
- Money params are **major-unit strings**: `majorParam(minor, currency)` from ui.tsx turns `MoneyInput` minor units
  into `"1250.50"`. Answers carry `_minor` integers.
- `opForm(name, params, { file })` for uploads; `download(name, params, 'open'|'save')` for protected files;
  `saveText(csv, filename)`; `copyText(text)`.
- `useOp<T>(name, params, reads, opts?)`: a live read; reloads when any collection in `reads` changes (the realtime
  topic `hr`, one subscription for the app). `opts.name` remembers data across visits; `opts.skip` waits.
  When the params change, the view empties until the new answer arrives (another record never shows the last
  one's data); pass `opts.keep: true` for filters, searches and paging so the old rows stay while the new load runs.
- The shell remounts a page when its route params change (`/people/E0005` to `/people/E0021`), so per-record state
  in your page resets by itself; query changes (`?tab=`, filters) keep the page mounted.
- `act(edits, run, reads)`: optimistic edits laid over every live view (`patch(id, fields)`, `drop(id)`,
  `insert(listKey, item)`, `reshape(viewName, fn)`); withdrawn when the op fails. `changed(...collections)` reloads now.
- `useOnChange(collections, fn)`.
- At most six calls are on the wire at once (`IN_FLIGHT` in lib/api.ts, for `op`, `opForm`, `download` and photos);
  the rest wait in order, reads first while the line is longer than six, and a cancelled view leaves the line.
  Calls that bypass `op()` (a module's own `pb.send` or `fetch`) bypass the line too: use `op()`.
- Busy server: a 429 (rate limited) was never processed, so `op`, `opForm`, `download` and photos try again after
  250 to 500 ms, then 500 to 1000 ms (3 tries in all, with jitter); reads also try again after a dropped
  connection or a 502/503/504. When it still fails the error is `{ status: 429, code: 'busy' }` with the calm
  message "The app is busy for a moment. Try again in a few seconds." `fetchRetry(url, init)` gives the same tries
  to a module's own protected-file fetch.
- The shell's numbers come from ONE provider at the frame root (`components/shell/counts.ts`
  `ShellCountsProvider`): `app.home` and every module's `inboxSections` `useItems()` run there once per refresh,
  and `useShellCounts()` (sidebar, header, agent card, Inbox) reads that answer, including each section's
  `items[key]`. Module code never calls `useItems()` itself and never reads `app.home` for the badge.

## 3. Session and rights: `lib/auth.tsx`

`useMe()` -> `Me` (member, role, levels, owner, admin, entities, employee, manages, has_pin, company, unread, today).
`can(me, module, level)`, `isManager(me)`, `seesPay(me)`, `allowed(me, perm)`. `refreshMe()` after a change to the
person or company. `lib/store.tsx`: `useUi()` `{ hidePay, rail, entity }` (the selected legal entity; '' = all),
`setUi`.

## 4. Format, money, i18n, router

- `lib/format.ts` (the one date style, section 0): `fmtDay(day, { year, weekday, entity, country })`,
  `fmtRange(from, to, { entity })`, `fmtMonth`, `fmtDateTime`, `time(v, { entity })`, `dateOrder()`, `relDay`, `ago`,
  `tenure`, `minutes`, `dayKey`, `addDays`, `addMonths`, `daysBetween`, `weekday`, `monthName`, `personName(parts)`
  (family-first order when stored), `initials`, `humanize`, `number`. A typed day in a DayPicker is read in the same
  style (day first unless the style is month first).
- `lib/money.ts`: `formatMoney(minor, currency, { display, compact, sign })` (JPY 0 decimals, KWD 3, IDR shown 0),
  `parseMoney(text, currency)`, `exponent`, `toMajor` (charts only), `currencySymbol`. **Unambiguous by default**
  (`display: 'auto'`): the ISO code ("SGD 1,250.00", "JPY 250,000"), and the narrow symbol ("$98,000.00") only
  when the amount is in the company's reporting currency AND every `<Money>` on screen is in that one currency
  (SGD and USD both read "$"). `'code'` and `'symbol'` force one, `'none'` drops it. Do not build "$" strings
  yourself; prints and exports that leave the screen pass `display: 'code'`.
- `lib/i18n.ts`: `t(key, vars)`, `tn(key, n)` (`key.one` / `key.other`), `has(key)`. Put your copy in
  `i18n/<module>.en.ts` as `export default { 'leave.title': 'Leave' } as const;` (auto-loaded).
- `lib/router.ts`: `useRoute()` `{ path, segments, query }`, `href(path, query)`, `navigate(path, query)`,
  `setQuery(patch)` (no history entry), `matchPath`, `under(path, base)`.
- `lib/kinds.ts`: `kindLabel(kind)` reads `kind.<approval kind>` (the kernel catalog names the kinds of SPEC 3.4).

## 5. Components (`components/ui.tsx`)

Controls are 32px (sm 28, lg 40), radius `--hr-radius` (at most 8px), hairline borders, ink primary.

| Component | Props (main) | Use |
|---|---|---|
| `Button` | `variant: primary\|default\|ghost\|danger\|agent`, `size: sm\|md\|lg`, `icon`, `iconRight`, `busy` | One primary per page. |
| `IconButton` | `icon`, `label` (also the tooltip), `size`, `active`, `tone: 'danger'` | Quiet icons. |
| `LinkButton` | `onClick`, `tone` | Inline "Edit", "Remove". |
| `Input`, `Textarea` (grows), `SearchInput` (`value`, `onChange`) | as HTML | 13px text. |
| `Select` | native, forms only | Never in a sidebar. |
| `Picker` | `value`, `onChange(v, item)`, `items: PickItem[]` `{ value, label, sub?, person? }`, `label`, `clearable` | Searchable choice (people, departments). |
| `Toggle`, `Checkbox` | `checked`, `onChange`, `label` | |
| `Segmented` | `value`, `onChange`, `options [{ value, label, icon? }]`, `label`, `size` | View switches and small choices. |
| `Tabs` | `value`, `onChange`, `tabs [{ value, label, count? }]`, `label` | Underlined, sliding bar. |
| `Field` | `label`, `hint`, `error`, `optional`, `help` (a ? tooltip) | One column forms. |
| `Row` | `label`, `hint`, children on the right | Settings rows. |
| `Fact`, `FactStrip` | `label`, value | Read-only facts. |
| `Panel` | `index` ("01"), `label`, `aside`, `flush`, `bodyClass` | The hairline panel with a mono label. |
| `StatTile` | `label`, `value`, `sub`, `index`, `tone`, `onClick` | The one big mono readout (26px). |
| `Empty` | `icon`, `title`, children, `action` | Every empty state offers the first action. |
| `LoadError`, `Loading`, `Skeleton`, `Spinner` | | |
| `Count`, `Tag`, `StatusDot`, `Notice` | `tone: neutral\|rh\|lh\|bad\|warn\|good\|agent\|faint` | Colour carries meaning only. |
| `Hint`, `Tip` | `text` | Definitions in tooltips, never paragraphs. |
| `Popover`, `Menu`, `MenuItem`, `MenuSep`, `MenuLabel` | `anchor`, `open`, `onClose`, `align`, `side`, `width` | Portaled, stays in the window. |
| `Dialog` | `open`, `onClose`, `title`, `meta`, `footer`, `width` | Confirmations and short forms. |
| `Sheet`, `SheetHeader` | `open`, `onClose`, `label`, `width` | Record details docked right. |
| `useConfirm()`, `confirmAsk(text, title, ok, tone)` | | Ask before what cannot be undone (host mounted in App). |
| `PinDialog`, `PinBoxes` (`align: 'center'\|'start'`) | | The PIN (normally automatic through `op`). |
| `ItemFacts` | `facts: ItemFact[]` (the server's facts), `entity`, `labelled` (label before each value) or dot-separated, `skip` (keys) | Approvals, notifications and search results; use it for any server facts. `checkPin(pin)` checks a PIN with `pin.verify`. |
| `confirmPin(text, title, ok, tone)` | resolves the PIN or null | A confirm question with the PIN boxes in the same dialog; pass `{ pin }` to the op. |
| `EntityPicker` | `value`, `onChange(id)`, `label`, `all` (adds All entities, value '') | The one entity control in pages and forms. |
| `Money` | `minor`, `currency`, `display: 'auto'\|'code'\|'symbol'` (default auto, see section 4), `format`, `always`, `tone: 'auto'` (red below zero) | Mono, blank behind "Hide pay". Each one tells the screen its currency, so a second currency turns every amount to codes before paint. |
| `MoneyInput` | `value` (minor or null), `onChange`, `currency` | Locale grouping, never floats. Send with `majorParam`. |
| `DayPicker` | `value` ('YYYY-MM-DD'), `onChange`, `label`, `min`, `max`, `clearable`, `weekStart` | Month grid plus typed entry. Never a native date input. |
| `DateRange` | `from`, `to`, `onChange(from, to)`, `presets` | Two clicks. |
| `Avatar`, `PersonChip` | `name`, `photo?`, `sub`, `size`, `href` | Initials in the name's order. For an employee's real photo use `PersonPhoto` from `pages/people/photo.tsx` (`employee`, `has` (the row's `photo` flag from `people.directory` or the employee record), `name`, `sub`, `size`, `href`; it fetches `people.photo` with the token and falls back to initials). |
| `DataTable` | `columns: Column[]` `{ key, label, width, align, mono, sort, render, hideBelow: lg\|xl, phone: title\|sub\|end\|hide }`, `rows`, `rowKey`, `onRowClick` or `rowHref`, `selectable`, `selected`, `onSelect`, `selectionBar`, `empty`, `onMore` + `hasMore` (scroll pagination), `initialSort`, `foot` | Dense 36px rows, sticky header, stacked rows under 768px. |
| `Timeline` | `items: TimelineItem[]` `{ id, day, title, state: past\|current\|scheduled, lines [{ label, before?, after }], meta, actions, agent }` | Effective-dated history. |
| `Stepper` | `steps [{ key, label }]`, `current`, `onStep`, `done` | Setup, pay run steps. |
| `FileDrop` | `onFiles`, `accept`, `label`, `multiple` | Uploads. |
| `Section` | `title`, `aside` | A labelled block inside a panel. |
| `AgentMark` | `size`, `working` | Your AI agent (black and white star). |
| `PageHeader` | `title`, `meta` (mono line), `back` (a hash link), children (actions) | Every page starts with it; the shell adds search, Hide pay, notifications. |
| `PageBody` | `className`, `wide` | Standard gutters and phone bottom padding. |
| `toast` | `toast.success(text, { label, run })`, `toast.info`, `toast.error` | Say what happened and offer the next step. |

Theme: tokens `--hr-page, side, panel, raised, sunk, line, line-2, hair, ink, ink-2, muted, faint, hover, active,
on-ink, agent, agent-ink, rh, lh, bad, warn, good` (and `*-soft` tints). `lib/themeColors.ts` derives them from the
host pack with contrast checks (all text incl. faint 4.5:1 on every surface) and rewrites them on theme change. Classes: `.hr-label`
(mono 10.5px caps), `.hr-mono`, `.hr-num`, `.hr-wrap` (free text), `.hr-panel`, `.hr-grid` (canvas grid),
`.hr-in` (6px settle), `.hr-scroll`, `.hit` (40px touch area), `.hover-only` (visible on touch), `.hr-no-print`.
Type scale: 10.5 (labels), 12, 13, 14, 15, 26. Use `--hr-hover` for hover, never a surface token.

## 6. Kernel pages

Setup (company, country with what it brings, owner with password and PIN, recovery code once), sign in, recovery,
invite (`#/invite?email=&code=`); People: directory (`/people`, filters, headcount tiles, scroll paging, CSV export),
org chart (`/people/org`, grid canvas, drag to pan, Ctrl+wheel to zoom, fold teams), hire (`/people/new`, defaults from
the entity's country; a link may fill it with `entity, legal_name, personal_email, phone, title, job_title, department,
location, employment_type, start_day, pay_basis, pay_amount` (major units), `pay_per, currency, employee,
from_application`: hiring's accepted offer does, and `from_application` goes to `people.hire`, which marks the
application hired with the new employment; the pay is filled only when `currency` is empty or the entity's), profile (`/people/:number`: Overview, Job and pay with Update vs Edit and scheduled changes,
Personal with emergency contacts and dependants, Bank and IDs masked with reveal by PIN and approval for bank changes,
Documents with upload and acknowledge, Skills, plus module tabs), person print (`/print/people/:number`); Inbox
(`/inbox`: approvals with one-tap approve, proposals with before and after, your requests, your AI agent's jobs and
the ask box, module sections); Settings (`/settings/<section>`: company, entities (`/settings/entities/:id`),
locations, departments and titles, holiday calendars with a year grid, work schedules with a week editor, approval
flows, members, roles (level grid), your AI agent, import and export, audit log, security, notifications).

## 7. Needs from the kernel backend

Delivered and used (2026-11-05): approvals, notifications and search results carry structured `facts` (days,
ranges, money, states, numbers, text); the Inbox cards, the notifications list and Ctrl K render them with
`ItemFacts` (ui.tsx: dates in the entity's style, money through `<Money>` so Hide pay applies, states in words), and
show the plain summary, body or subtitle only when there are no facts. An approval card with facts is titled by
its kind, with the person's chip instead of the person's name. `pin.verify` checks every PIN the PIN dialog and
`confirmPin` take before the operation is sent (a wrong PIN answers 200, the console stays quiet). Setup lists the
country's and the region's `pack_names`.

Delivered earlier:

1. `entities.get` returns `entity.profile_fields` and `people.get` returns `employments[].profile_fields` with
   `scope: 'employee'|'entity'`: the hire page renders the employee fields of the entity's packs, the profile
   "Tax details" panel shows them with their labels and "Update tax details" sends `tax.update`.
2. `people.photo` (GET stream) and `people.photo-set` (multipart `photo`, or `clear`): the profile photo button
   uploads and removes; avatars across People, the org chart and the profile show it.
3. `app.home.jobs_claimed` drives the agent card's working state.

## 8. Things module builders must know

- `Field` is a labelled group (`<div role="group">`), not a `<label>`: give every input its own `aria-label`
  (a label element forwarded clicks to the first button inside Segmented and Picker).
- `.hr-label`, `.hr-panel`, `.hr-mono`, `.hr-num`, `.hr-wrap`, `.hr-grid` live in the CSS components layer, so a
  Tailwind utility on the same element wins (`hover:bg-[var(--hr-hover)]` on a panel works).
- An `IconButton` on a row that itself takes the hover fill needs `onRow` (it then hovers one step darker).
- Hover-only row actions: `className="hover-only opacity-0 group-hover:opacity-100 focus-visible:opacity-100"`; on
  touch screens they are always visible.
- Money params are major-unit strings (`majorParam`); answers are `_minor` integers; show them with `<Money>`.
- PIN ops ask the PIN on their own; do not build another PIN form.
- The realtime topic is `hr`; list every collection your view reads in `useOp(..., reads)`.
- Phone: tables become stacked rows by themselves (`phone: 'title' | 'sub' | 'end' | 'hide'` per column); keep tap
  targets 24px or more (or add `hit`), and nothing only on hover.
- Copy: no em or en dashes, no emoji, "your AI agent", plain words; the i18n checker is `SCR/kernel-frontend/tools/i18ncheck.mjs <src/app>`.
- `inboxSections` hooks are mounted for the whole session on every page (in the shell provider): keep each to one
  small read, pass `skip` when the viewer lacks the right, and list exact `reads` so it refreshes only when it must.
- Sidebar: the place you are in shows its child rows by itself (you can still fold it while there); other places
  keep the open or folded state the person gave them.

## 9. Tests and screenshots

Tests (copied to `reference/tests/kernel-frontend/`; run on a scratch copy at port 3182 with `run_all.sh`, set
`HR_APP` to the copy when running them elsewhere):

| Test | What it proves |
|---|---|
| `setup.mjs` | Empty database: the four setup steps (phone light and dark, desktop dark), company created, recovery code shown once, the app opens. |
| `empty_members.mjs` | Empty database: a manager and an employee invited and joined (no other data). |
| `pass.mjs <label> <email> <password> [pages]` | Every page for one person, light and dark, 1440 and 390, screenshot each, fail on any console error or 5xx. |
| `flows.mjs` | On the demo seed: approve a bank account with the PIN, a wrong PIN asks again with tries left, reveal a sealed number, schedule a job change (Update, future day, Timeline shows it scheduled), hire, Ctrl K search and open, Hide pay blanks figures, ask your AI agent, add a department, invite a member (PIN, code shown), set a profile photo, update tax details from the packs fields. |
| `audit.mjs` | 16 theme packs x light and dark: token pairings (text 4.5:1 on every surface, layers apart, lines visible) and every visible text node against the surface under it, on 9 pages. |
| `ux_audit.mjs` | Pointer cursor on everything clickable, hover sweep light and dark (the hover differs from the surface), phone pass at 390 (no sideways scroll, targets, nothing hover-only, a long word does not widen the page). |
| `preauth.mjs` | Sign in (and a wrong password), recovery, invite, light and dark, 1440 and 390. |
| `live.mjs` | A change made through the API shows on an open page without a reload; your AI agent's proposal raises the Inbox count live. |
| `money.mjs` | No server: codes by default, the symbol only for the reporting currency alone on screen, back to the symbol when the other currency leaves, JPY 0 and KWD 3 decimals, parsing refuses JPY decimals. |
| `shell_probe.mjs` | The place you are in shows its children although it was folded, a folded place stays folded, and amounts on profiles in INR, SGD and USD read as codes or the lone reporting symbol. |
| `hire_prefill.mjs` | Demo seed plus hiring's seed (`reseed.sh hiring`): HR approves the offer, the recruiter sends it and records acceptance, the owner clicks "Hire <name>" on the offer, every prefilled field is checked, the hire opens the new profile, and the application is hired with that employment. |
| `dates.mjs` | No server: dmy, mdy, ymd and iso styles for days, ranges, months and times, the entity and country choice, and the company style winning. |
| `money_lint.mjs` | Demo seed: every profile with money facts, People, Inbox, Settings and the module roots: no raw minor amount on screen, and with Hide pay on no amount left in the page text. |
| `qa_shots.mjs` | The screenshots for the UI QA items once each page has its data (light 1440 and 390, the phone More list, the drawer, Hide pay on the profile). |
| `kiosk.mjs` | Module `publicRoutes`: the time kiosk opens signed out without the shell or the sign-in form, before HR starts the tablet and after (its token in storage), light and dark, 1440 and 390, no console errors. |
| `timing.mjs [email] [password] [pages]` | Page-ready time on the demo seed (no operation in flight for 400 ms, no skeleton), full load and in-app move, and how often each operation ran. |

Screenshots (scratch, `SCR/kernel-frontend/shots/`): `empty/` (owner, manager and employee on an empty database,
`<role>_<page>_<scheme>_<width>.png`, plus `setup_*`), `seed/` (owner, HR, payroll, manager, employee on the demo seed,
same naming), `flows/`, `preauth/`, `ux/`, `kiosk/` (`kiosk_<new|started>_<scheme>_<width>.png`), `hire/` (`hire_prefilled.png`, `hire_done.png`), `probe/`,
`after/` (the UI QA fixes, `qa_shots.mjs`; the before shots are the QA's own in `SCR/qa-ui/shots/`). Piano Coach reference shots: `SCR/kernel-frontend/piano_shots/`.
