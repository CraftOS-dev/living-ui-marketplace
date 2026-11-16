# kernel-frontend notes (Venture OS)

Built by the kernel-frontend builder, 2026-11-12. The shell, the design system, the charts, Focus mode, setup and
sign-in, the Settings frame with the kernel sections, the agent panel, search, the drop overlay and the module
registry. Every module builds its pages from `components/ui.tsx`, `components/charts.tsx` and `components/next.tsx`
on the `--vo-*` tokens of `theme.css`. Do not add a second design system and do not fork a component: wrap it in your
own folder and report the need.

Typechecked and built against the real kernel catalog in `APP/frontend/src/app/lib/ops.gen.ts` (kernel-core and
kernel-records, 139 ops, 2026-11-12) and smoke-tested against the real kernel backend (`real_smoke.mjs`). Gate passes
on the scratch copy.

## 1. Files (all under `frontend/src/app/`)

| File | What |
|---|---|
| `App.tsx` | Boot: theme colours, realtime, session; setup, sign in, invite, recovery, or the frame. |
| `theme.css` | `--vo-*` tokens, `.vo-*` classes, the whole motion vocabulary. |
| `registry.ts` | Collects every `pages/*/index.tsx` (eager glob: metadata only, components behind `lazyPage`). Types in `lib/contract.ts`. |
| `lib/lazy.ts` | `lazyPage(load, name)`: a component from its own chunk, prefetched after the first paint (SPEC U13); `prefetchPages()`. |
| `components/ui.tsx` | Controls, panels, readouts, process pictures, tables, dialogs, PIN, toasts. |
| `components/charts.tsx` | LineChart, BarChart, Sparkline, Ring, Funnel, Meter, Tally, PathGraph, TileMap, Legend. |
| `components/next.tsx` | `NextCard` (generic card), `NextRow` (compact row), `runNextAction`, `KIND`. |
| `components/Focus.tsx` | `Focus`, the queue view (keys J K A X E Esc, slide, All clear). |
| `components/ImportDialog.tsx` | CSV or XLSX import through `imports.*` (preset a `target`). |
| `components/shell/*` | Frame, Sidebar, TopTools (search, Next count, bell), SearchPalette, AgentPanel, DropOverlay, counts, HomePlaceholder. |
| `lib/api.ts` | `op`, `runOp`, `opForm`, `download`, `askPin`, `copyText`, `saveText`, `saveBlob`, `errMessage`; reads asked for together go as one `app.batch`. |
| `lib/live.ts` | `useOp`, `useLive`, `act` with `patch`, `drop`, `insert`, `reshape`; `changed`, `useOnChange`, `tempId`. |
| `lib/format.ts` | Money, percent, multiples, compact numbers, days, relative days, times, names. |
| `lib/auth.ts` | Session: `useMe`, `can`, `allowed`, `refreshMe`, `signOut`. |
| `lib/router.ts` | Hash routes: `useRoute`, `navigate`, `go`, `href`, `setQuery`, `matchPath`, `under`, `previousRoute`. |
| `lib/store.ts` | Per-browser conveniences: `useUi()` `{ rail, fund }` (the fund scope, '' = all), `remember`, `keep`. |
| `lib/sheets.ts` | `readTable(file)` (CSV, TSV, XLSX), `parseCsv`, `toCsv`, `saveXlsx(sheets, name)`. |
| `lib/source.ts` | The one citation reader: `openSource(ref)` (over the page), `sourceHref(ref)` (`#/source?file=&page=&anchor=&quote=`), `SourceRef { file, page?, anchor?, quote?, name? }`. |
| `components/shell/SourceHost.tsx` | Mounts the registered `reader` once; the `#/source` route; resolves an anchor-only citation through anchors.resolve. |
| `lib/pdf.ts` | pdf.js loaded on first use with its worker bundled: `pdfjs()`, `openDocument(id, url)`, `drawPage(page, canvas, scale)`. |
| `lib/themeColors.ts` | Derives every `--vo-*` colour from the host pack with contrast checks (all 16 packs pass). |
| `lib/types.ts` | Kernel shapes: `Me`, `Firm`, `EntityRef`, `NextItem`, `NextAction`, `NextData`, `Job`, `SearchHit`. |
| `lib/toast.ts` | `toast.undo(text, run)`, `toast.error(text)` (a result belongs on screen, never in a toast). |
| `pages/focus/` | `#/focus` (and `?at=<key>`); command "Start Next"; the kernel's own cards `proposal` and `draft` (`kernelCards.tsx`) and their pages (`KernelPages.tsx`, lazy) `#/next/proposal/:id` (every change, accept all or some) and `#/next/draft/:id` (correct, approve and send, cancel), the hrefs kernel-core sends. |
| `pages/setup/` | First run: Firm, Fund, You, PIN (StepTrack), recovery code once with Copy. |
| `pages/auth/` | Sign in, `#/invite?email=&code=`, `#/recover` (owner recovery code); `Welcome`, `OnceCode`. |
| `pages/settings/` | `#/settings/:section` frame; kernel sections Firm, Funds, Members (and roles), Your AI agent, Data, Security. |
| `pages/agent/` | `#/agent` (`AgentPage.tsx`, lazy): tell your AI agent, every job, its runs with Undo (activity.undo). |

## 2. The module contract (`pages/<module>/index.tsx`)

Export any of these (types in `lib/contract.ts`; import types from there or from `registry.ts`):

```tsx
// pages/example/index.tsx
import { Briefcase, Plus } from 'lucide-react';
import { Button, PageBody, PageHeader, Panel, FigureStrip, DataTable } from '../../components/ui.tsx';
import { BarChart } from '../../components/charts.tsx';
import type { CommandDef, DealTab, DropHandler, NavItem, RouteDef, SettingsSection, CardProps } from '../../lib/contract.ts';
import { useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';

function DealsPage(): React.JSX.Element {
  const live = useOp<{ deals: Deal[] }>('deals.list', {}, ['deals', 'stage_events'], { name: 'deals.list' });
  return (
    <>
      <PageHeader title="Deals">
        <Button variant="primary" icon={Plus} onClick={...}>Add deal</Button>   {/* the one black button */}
      </PageHeader>
      <PageBody>
        <FigureStrip items={[{ label: 'Open', value: '42' }]} />                  {/* the visual first */}
        <Panel flush><DataTable ... /></Panel>
      </PageBody>
    </>
  );
}

export const routes: RouteDef[] = [
  { path: '/deals', page: DealsPage, dense: true },          // dense: informational only (the sidebar folds only by the person's click)
  { path: '/deals/:id', page: DealPage, title: 'Deal', perm: 'pipeline:view' },
];
export const nav: NavItem = { key: 'deals', label: 'Deals', icon: Briefcase, path: '/deals', order: 30 };
// Inbox: count: { kinds: ['verdict'] }   Committee: count: { kinds: ['vote'] }   (or a hook () => number | null)
export const cards = { triage: TriageCard };                 // Focus card bodies keyed by NextItem.card
// or { triage: { body: TriageCard, figures: false } } when the body shows the figures its own way
export const dealTabs: DealTab[] = [{ key: 'memo', label: 'Memo', order: 30, component: ({ deal }) => <Memo id={deal.id} /> }];
export const settings: SettingsSection[] = [{ key: 'pipelines', label: 'Pipelines', order: 40, component: PipelinesSettings }];
export const drops: DropHandler[] = [{ key: 'deck', label: 'New deal', accepts: (i) => i.files.some((f) => /\.(pdf|pptx?)$/i.test(f.name)) || i.url !== null, handle: async (i) => '#/inbox' }];
export const commands: CommandDef[] = [{ key: 'add-deal', label: 'Add deal', icon: Plus, run: () => ... }];
export const primary = { label: 'Add deal', icon: Plus, run: openAddDeal };   // intake only
export const homeBlocks = [{ key: 'ask', order: 10, size: 'wide', component: AskBar }];   // home only
export const reader = ({ source, onClose }: ReaderProps) => <MyReaderSheet ... />;          // the citation reader (diligence)
```

- Pages load on demand (SPEC U13). Keep the index to metadata and wrap every component it registers (page, tab,
  settings section, Focus card body, drop or home block) in `lazyPage` from `lib/lazy.ts`; the shell's Suspense keeps
  the old page on screen until the chunk is in, and every chunk is prefetched after the first paint:

  ```tsx
  import { lazyPage } from '../../lib/lazy.ts';
  const DealsPage = lazyPage(() => import('./DealsPage.tsx'), 'DealsPage');
  const DealPage = lazyPage(() => import('./DealPage.tsx'), 'DealPage');
  export const routes: RouteDef[] = [{ path: '/deals', page: DealsPage, dense: true }, { path: '/deals/:id', page: DealPage }];
  ```

  A file the index imports anything else from (a helper, a constant, a hook) is pulled into the main chunk whole, so
  keep those in a separate small file. Inside your own pages, wrap a lazy tab or panel in `<LazyBoundary>` (ui.tsx).
  Proposals for every module index: `SCR/kernel-frontend/lazy_proposals/<module>/index.tsx`.
- Places and orders (SPEC 3): home 10, inbox 20, deals 30, committee 40, portfolio 50, funds 60, network 70,
  markets 80. Settings sections: firm 10, funds 20, members 30, pipelines 40, theses 50, templates 60, your AI agent
  70, capture 80, data 90, security 100.
- Routes resolve exact paths first, then `:param` patterns, in folder order; the kernel's `/` placeholder comes last,
  so home's `/` wins. A page remounts when its route params change; query changes keep it mounted.
- `NavItem.children` (`{ key, label, path }[]`) render as tree rows under the place while you are in it.
- `RecordLike` (`{ id } & Record<string, unknown>`) is what `dealTabs` / `companyTabs` / `personTabs` components get
  (`{ deal }`, `{ company }`, `{ person }`); the owning module casts it to its own type. `show?(props)` hides a tab.
- `DropInput` is `{ files, url, text, path }`. A dropped or pasted (outside a field) file or URL goes to every
  handler whose `accepts` says yes; several show as chips; `handle` answers where the result is (the shell opens it).
  A `FileDrop` (data-vo-drop) keeps its own drops.
- Phone bottom bar: Home, Next (Focus), Deals, Portfolio (by nav key), More.

## 3. Components (`components/ui.tsx`)

Controls are 32px (sm 28, lg 40), radius at most 8px, hairline borders. Every one carries `vo-focus` and touch sizes.

| Component | Props (main) |
|---|---|
| `Button` | `variant: primary\|default\|ghost\|danger`, `size: sm\|md\|lg`, `icon`, `iconRight`, `busy`, `kbd` (a key hint "A") |
| `IconButton` | `icon`, `label` (also the tooltip), `size`, `active`, `tone: 'danger'`, `onRow` (inside a hovered row) |
| `LinkButton`, `Kbd`, `Spinner`, `Skeleton` | small parts |
| `Input`, `SearchInput` (`value`, `onChange`), `Textarea` (grows; `minRows`, `maxRows`), `Select` (forms only) | as HTML |
| `Toggle`, `Checkbox` | `checked`, `onChange`, `label` (`hideLabel`) |
| `Segmented` | `value`, `onChange`, `options [{ value, label, icon?, count? }]`, `label`, `size` |
| `Tabs` | `value`, `onChange`, `tabs [{ value, label, count?, icon? }]`, `label` (at most 6 on a record page) |
| `Field` | `label` (1 to 3 words), `tip` (a ? tooltip), `error`; never help text under it |
| `Row` | `label`, `tip`, children on the right (settings rows) |
| `More` | the fields beyond three, behind "More" (`defaultOpen`) |
| `Panel` | `label` (a short plain title, 13px semibold: what is in it), `tip` (the detail on a small ? beside it), `aside` (one or two small actions), `flush`, `bare` (no border); 16px padding |
| `SubHeader` | a heading inside a page or a Settings section: `title`, children = its actions |
| `Empty` | `icon`, `title` (at most 4 words), `action` (one button); no body text |
| `LoadError` | `message` (one line), `onRetry` |
| `Count`, `StatusDot` (`tone`, `label`, `pulse` = the breathing dot), `Tag` (`tone`, `icon`), `Notice` | `Tone = neutral\|a\|b\|bad\|warn\|good\|agent\|faint`; `chipTone(NextItem chip tone)` |
| `Tip` | wraps a label: `text` shows on hover and focus |
| `Hint` | a small ? with `text` |
| `Bubble` | the tooltip box anchored to a ref |
| `Popover`, `Menu` (`label`, `children(close)`, `trigger: icon\|button`, `onRow`), `MenuItem`, `MenuSep`, `MenuLabel` | portaled, stay in the window |
| `Dialog` | `open`, `onClose`, `title`, `footer`, `width` |
| `Sheet`, `SheetHeader` | docked right; `label`, `width` |
| `confirmAsk(title, ok, tone, text?)`, `confirmPin(title, ok, tone, text?)` | a question; with the PIN in the same dialog |
| `PinBoxes`, `PinDialog`, `PinHost`, `checkPin` | the PIN; ops with effect confirm ask it by themselves |
| `Toasts`, `toast` | `toast.undo('Passed', run)`; `toast.error(text)` |
| `Money` | `minor` (number or BigInt-safe string), `currency`, `compact`, `whole`, `sign`, `bare`, `tone: 'auto'` |
| `MoneyInput` | `value` (minor or null), `onChange`, `currency` (types "3.2m", "250k", "1,500,000") |
| `PctInput` | `value` (ppm or null), `onChange(ppm)`, `label` |
| `DayPicker` | `value` 'YYYY-MM-DD', `onChange`, `label`, `min`, `max`, `clearable` |
| `Avatar` | `name`, `size`, `square` (companies, funds), `agent` |
| `PersonChip` | `name`, `href` or `onClick`, `square`, `size` |
| `Picker` | `value`, `onChange(v, item)`, `items [{ value, label, sub?, icon?, avatar?: person\|company }]`, `label`, `onSearch`, `clearable` |
| `StatTile` | `label` (12px above), `value` (26px mono; words in the text face; null shows "Unknown"), `tip`, `tone`, `onClick`, `bare` |
| `FigureStrip` | `items: Figure[]` (`{ label, value, tip?, tone? }`), `panel` (default bare) |
| `Fact` | `label`, children, `mono`, `tip` |
| `StepTrack` | `labels` (at most 5, one word), `at` (current index; >= length = all done), `compact` |
| `StageTrack` | `stages [{ key, label }]`, `current`, `onMove(key)` (click a dot), `stalled` |
| `GradeDot` | `grade: artifact\|founder_reported\|public\|unverifiable\|unknown` |
| `CheckChip` | `state: met\|unmet\|unknown`, `label` |
| `AgentMark` | `size`, `working: true\|'waiting'` |
| `AgentTag` | the small Sparkle beside content your AI agent prepared |
| `Citation` | `label` ("p.4"), `quote` (tooltip); `source` ({ file, page, anchor?, quote? }: opens the one shared reader; middle-click opens `#/source` in a tab), or `href` (a public URL, new tab), or `onOpen` |
| `ChipPicker` | `options [{ value, label }]`, `label`, `keys` (1 to 9 pick or toggle); one: `value`, `onChange(v)`; many: `multiple`, `value: T[]`, `onChange(values)` (role checkbox, a check on the chosen) |
| `Board` | `columns [{ key, label, items }]`, `itemKey`, `renderCard`, `onMove(cardId, toColumnKey, toIndex)` (drag, sort, Move menu, Alt+Arrows; may return a Promise), `sortable` (default true), `fill` (default true: to the bottom of the window), `cardLabel`, `stalled(item)` (warn edge), `onOpen`, `label`. See "Fix 3". |
| `DataTable` | `columns [{ key, label, width, align, mono, sort, render, optional, fixed, phone: title\|sub\|end\|hide }]`, `rows`, `rowKey`, `onRowClick` or `rowHref`, `selectable` + `selected` + `onSelect` + `selectionBar`, `onMore` + `hasMore` (scroll pagination), `initialSort`, `stickyTop` (56 under the top bar, 0 inside a Panel), `viewScope` (column picker remembered + saved views through views.*; the key is views' `page`), `viewState` + `onApplyView` (your filters in a view), `leaving` (keys that fold away), `empty`, `foot` |
| `PhoneList`, `PhoneRow` | stacked rows under 768px (DataTable does it by itself) |
| `FileDrop` | `onFiles`, `accept`, `label`, `multiple` |
| `PageHeader` | `title`, children = the page's actions (one primary), `back`, `backOnPhone`; the shell adds search, Next, bell |
| `PageBody` | gutters (16px top, 20px sides and bottom), 12px (`--vo-gap`) between blocks, `wide` |
| `Section` | a short mono label over a block inside a panel or sheet |

`components/next.tsx`: `NextCard` (`item`, `position`, `editing`/`onEditing`, `onDone`, `large`, `choosing`/`onChoosing`,
`onSkip`), `NextRow` (`item`, `onOpen(item)`; Home's rows: `onOpen={(i) => navigate('/focus', { at: i.key })}`),
`runNextAction(item, action, extra)`, `primaryOf(item)`, `KIND` (icon and word per kind), `NEXT_READS`.
`components/Focus.tsx`: `Focus` (`at`, `kinds` to embed a module's own queue, `onLeave`).
`components/shell/AgentPanel.tsx`: `openAgent(jobId?)`, `askAgent(text, context) -> job id` (chat.ask; the panel opens
on it), `useJob(id)` (follow a job live: `data.job`), `jobAnswer(job)`, `TellField`, `JobItem`.
`components/shell/SearchPalette.tsx`: `openSearch()`.
`lib/source.ts`: `openSource(ref)`, `sourceHref(ref)`; every citation in every module opens the same reader this way.

## 4. Charts (`components/charts.tsx`)

Values are plain numbers (major units or counts); pass `format` for the tooltip (`(v) => money(v * 100, 'USD', { compact: true })`
or `compact`), `yFormat` for the axis. Tones: `a` (blue, primary series), `b` (teal, secondary), `ink`, `muted`, `good`, `warn`, `bad`.

| Chart | Props |
|---|---|
| `LineChart` | `labels`, `series [{ key, label, values (null = gap), tone?, dashed?, forecastFrom? }]`, `height` (200), `format`, `yFormat`, `area` (fill the first series), `refLines [{ value, label, tone? }]`, `zero` (include 0, default true) |
| `BarChart` | `labels`, `series` (negative values go below the axis: calls), `lines` (series drawn over the bars on the same scale: NAV), `stacked`, `height`, `format`, `yFormat`, `highlight` (one index darker) |
| `Sparkline` | `values`, `status` (optional, one per value: `'staged'` draws the segments into and out of that point dashed and its dot hollow, like LineChart's forecast; `'verified'` or nothing is solid), `tone`, `width` (80), `height` (24), `area`, `format` |
| `Ring` | `value` and `max`, or `segments [{ label, value, tone? }]`; `size`, `thickness`, `center` (the figure), `format` |
| `Funnel` | `stages [{ label, value }]` in order; conversion from the stage before shows on the right; `format`, `tone` |
| `Meter` | `value` (null = Unknown), `max`, `tone`, `marks [{ value, label?, tone? }]` (threshold ticks), `label` ("Paid"), `format` (default percent), `height` |
| `Tally` | `options [{ label, count, tone? }]` (revealed votes only), `height` |
| `PathGraph` | `paths [{ nodes [{ id, label, kind: member\|connector\|target }], strengths (0 to 1 per edge) }]`; the first path is the best (ink); `selected`, `onSelect(i)` |
| `TileMap` | `segments [{ key, label, tiles [{ id, label, relation: portfolio\|pipeline\|passed\|tracked\|competitor, href? }] }]`, `onTile`, `legend` |
| `Legend` | `items [{ label, tone, dashed? }]` |

Every chart sweeps in once on first draw and shows a tooltip on hover; nothing loops.

## 5. Helpers (`lib/`)

- `op<T>(name, params, { quiet, pin, signal })`: typed by `ops.gen.ts`; lists and objects travel as JSON; confirm ops
  ask the PIN; errors are `OpError { status, code, message, data }` with a toast unless `quiet`. `runOp` for names that
  arrive as data. `download(name, params, 'save'|'open')` for files (POST ops too, with the PIN).
- Reads batch themselves: GET read ops asked for within 8 ms of each other (a page's first load, the views one
  realtime change refreshes) travel as ONE `app.batch` request (kernel-core notes 22), up to 12 reads each; the same
  read asked twice in that moment is sent once (each caller gets its own copy). Every caller gets its own answer or
  `OpError` exactly as from a call of its own (a failing read fails alone), with the same retries, toasts and PIN
  handling. Writes, uploads, `download`, public reads (setup.status), calls before sign-in and params over 1500
  characters go alone; a read the
  server answers `not_batchable` (it sends a file or headers) is resent alone and kept alone from then on. Params go
  as strings, as in a query. Nothing to do in module code.
- `useOp<T>(name, params, reads, { name, keep, skip })`: a live view; `reads` are collection names (or `'*'`); `name`
  remembers the last answer across visits (no spinner on return); `keep` for filters and paging.
- `act(edits, run, reads)`: optimistic edits (`patch(id|key, fields)`, `drop(id|key)`, `insert(listKey, item)`,
  `reshape(viewName, fn)`) laid over every view, withdrawn when the op fails.
- Format: `money(minor, cur, { compact, whole, sign, bare })` ("USD 3.2M"), `majorParam(minor, cur)` (money params are
  major-unit strings), `parseMoney`, `toMajor` (charts only), `pct(ppm)` ("12.5%"), `ratioPct(0.62)`, `e8(v)`,
  `multiple(e8)` ("2.4x"), `compact(n)`, `num(n, digits)`, `plural`, `days(n)`, `months(n)` ("6.5 mo"), `today()`,
  `dayOf(ts)`, `fmtDay(day, { year, weekday })`, `fmtMonth`, `fmtQuarter`, `fmtRange`, `time(ts)`, `fmtDateTime`,
  `relDay(day)` ("in 3 days"), `ago(ts)`, `addDays`, `daysBetween`, `initials`, `humanize`. Days are in the firm's zone
  and date style (set from `auth.me`).
- `useMe()`, `can(me, module, level)`, `allowed(me, perm)` (catalog syntax, alternatives with `|`), `refreshMe()`.
- `useUi().fund`: the sidebar's fund scope ('' = all funds); pass it to your reads.
- Citations: `<Citation label="p.4" quote={q} source={{ file, page, anchor }} />` or `openSource({ file, page, anchor })`.
  The reader is the one a module registers (`reader` export, diligence's page view); with only an anchor the shell
  resolves file, page and quote first. Until a reader is registered the file opens (files.download).

## 6. Visual rules every module follows (SPEC 2 and 13)

- No text under any title, panel label, field label or figure. Labels are 1 to 3 words; explanations go in `Tip` or
  `Hint`. About 40 interface words at rest per page; empty states are an icon, at most 4 words, one button.
- One black button per page (in `PageHeader`); everything else default, ghost, an icon button or a menu item.
- Lead a landing page with a visual (a chart or a `FigureStrip`), at most 2 blocks above the list; Home at most 5.
- Process as a picture: `StepTrack` (at most 5 one-word dots), `StageTrack`, `Meter` for money in progress.
- Show results in place; toasts only for undo (`toast.undo`). Your AI agent's content carries `AgentTag`; while it has
  not answered, say "Waiting for your AI agent".
- Choices are `ChipPicker` or `Segmented`; at most 3 fields, the rest in `More`; defaults filled.
- Lists are 36px rows with data (`DataTable`), boards for stages (`Board`), mono figures right-aligned.
- Type scale 12, 13, 14, 15, 26 (10.5 only in `.vo-label` panel labels); figures are `vo-mono vo-num`; free text
  `vo-wrap`; flex and grid children `min-w-0`.
- Colours only through tokens (`var(--vo-*)`), meaning only (a, b, good, warn, bad); hover uses `--vo-hover` (inside a
  hovered row use `onRow` on icon buttons); a SELECTED row (fill `--vo-active`, `aria-current`) hovers with
  `--vo-active-hover`, apart from its fill and the surface in every pack; pointer cursor on everything clickable (base CSS does buttons, links and
  roles; add `cursor-pointer` to a clickable div).
- Motion: only `.vo-in` (once per panel), colour transitions, the Focus slide, a chart sweep, `.vo-fold` for rows
  leaving, `.vo-pulse` for working. Nothing else.
- Touch: `vo-tap` (rows, buttons), `vo-tap-sq` (icons), `hit` (small marks) give 40px targets on touch screens.
- No emoji, no em or en dashes, no drawn logos (lucide icons; `Avatar square` for companies), "your AI agent".

## 7. NextItem as the frontend reads it (SPEC 4.3 plus kernel-core's normalisation)

`{ key, module, kind, card ('' = generic), title, figures, chips, steps (null or { labels, at }), agent, rank, at,
href ('' = none), data (null or object), actions }`. The generic card shows, from `data`: `body` (full text, a draft),
`lines` ([{ label, before?, after }], a proposal), `quote` ({ text, source?, href? }, the source beside a value to
verify) and `edit` ({ op, params, fields }: E edits each field in place and saves the changed ones through `op`). A custom renderer
(`cards[key]`) gets `{ item }` and draws only the body; the kernel frame draws kind, title, chips, steps, figures and
the actions (register `{ body, figures: false }` to leave the figure strip out). Open and Skip are icon buttons
(tooltips "Open", "Skip (X)"), so a module may label its own actions freely. When the op an action runs answers an
`href`, the screen goes there after the action (network's Add note answers the note). The kernel's `proposal` card loads
`proposals.get` for before and after, shows `why` and the evidence quote; the `draft` card shows the recipients and a
failed send's error, the generic body shows the text. Actions: `{ label, op, params, primary, pin, confirm, choose }` plus `done` (the undo toast's word,
"Passed") and `undo` ({ op, params }, the toast's Undo) and `tone: 'danger'`.

## 8. Requests to kernel-core (contract changes; the frontend already reads them)

1. `lib_next` normalise: pass through action `done` (string, at most 20 characters), `undo` (`{ op, params }`, op
   in the catalog) and `tone` ('danger'); today they are dropped, so the Undo toast never shows for module items.
2. `next.count` answers `{ total, by_kind }` (as built): the sidebar counts Inbox from `verdict` and Committee from
   `vote`.
3. Outbound drafts: add `edit: { op: 'outbound.update', params: { outbound: id }, field: 'body' }` to the draft
   item's `data` (lib_outbound.nextItems) so E edits the text in Focus; today the draft page does it.
4. The PIN for an action is asked before the card leaves (the frontend calls `pin.verify` through the PIN dialog,
   then sends `pin`); confirm ops keep answering `wrong_pin` with `data.left`.

## 9. Fix round 1 (2026-11-12, from the module builders)

1. ChipPicker `multiple` (committee's local `ChipToggles` can go: `<ChipPicker multiple value={keys} onChange={setKeys} ... />`).
2. `runNextAction` follows an `href` the op answers.
3. Focus: Skip and Open are icon buttons with tooltips; key X still skips.
4. Selected rows (Settings list, sidebar places and tree rows, fund scope, selected table rows, active icon buttons)
   hover with the new `--vo-active-hover` token (derived per pack in themeColors.ts; audited).
5. One citation reader: registry slot `reader`, `openSource`, `Citation source`, route `#/source`. Diligence registers
   its reader with one export in `pages/diligence/index.tsx` (tested in scratch, the diligence builder adds it in APP):

   ```tsx
   import type { ReaderProps } from '../../lib/contract.ts';
   import { ReaderSheet } from '../../components/diligence/Reader.tsx';
   export const reader = ({ source, onClose }: ReaderProps): React.JSX.Element | null => <ReaderSheet target={{ cite: { anchor: source.anchor ?? '', file: source.file, file_name: source.name ?? '', page: source.page ?? 1, quote: source.quote ?? null, nda: false, hidden: false } }} onClose={onClose} />;
   ```

   Committee (`components/committee/parts.tsx`): `<Citation label={label} quote={quote} source={{ file: c.file, anchor: c.anchor, page: c.page }} />`
   instead of `onOpen={() => download(...)}`; portfolio (`pages/portfolio/Updates.tsx`): pass `source={{ file, page, quote }}`
   from the snippet; diligence's own chips may keep their reader with Confirm and Reject.
6. Sparkline `status` (portfolio: `status={r.kpi.spark.map((p) => p.status)}` with 'verified' or 'staged').

7. Settings > Funds: the LPA form edits a copy of the stored terms, so keys it does not show go back unchanged
   (entities.save merges and checks the whole object), and shows Compounding (Compound | Simple, `pref_compounding`)
   after Hurdle behind More. Tested by `tests/lpa_check.mjs` on the merged app.
8. Lazy pages (SPEC U13): the kernel's own pages (Your AI agent, the proposal and draft pages, every kernel Settings
   section, setup) are `lazyPage` chunks; `Frame` holds one Suspense outside the keyed page, route changes (hash
   and `setQuery`) run as transitions, so a move keeps the old page until the new chunk is in; `prefetchPages()`
   fetches every registered chunk when the browser is idle after the first paint. Main chunk on the merged build:
   932 kB before, 896 kB with the kernel's pages lazy, 578 kB (gzip 170 kB) once every module index adopts
   `lazyPage` (measured in scratch with the proposals). What stays eager after that are files a module index also
   imports helpers from (deals `DealPage` with `useCanEdit`, portfolio `PortfolioPage` with `LIST_READS`, funds
   `Investment` with `showInvestment`, network `RecordPages` with `COMPANY_TABS`, intake's add deal helpers).
9. PersonChip hovers with `--vo-active` (it sat on a hovered row and matched it).

## 9b. Fix round 2 (2026-11-12): reads travel as app.batch

`lib/api.ts` coalesces reads into `app.batch` (section 5). Measured on a fresh merged copy of APP (committee's
`seed_ui.mjs`), the batched build against the same build without it, the server restarted before every cold load,
3 runs each, medians (`tests/cold_load.mjs`; the machine shared with other builders):

| Screen | Cold load before | Cold load after | Move inside the app before | after |
|---|---|---|---|---|
| Home (`#/`, shell reads) | 1482 ms, 5 requests | 1365 ms, 3 requests (5 reads) | | |
| Focus | 856 ms, 6 requests | 887 ms, 3 requests | 57 ms | 76 ms |
| Deal page | 1715 ms, 10 requests | 1660 ms, 4 requests (10 reads) | 410 ms, 5 requests | 250 ms, 2 requests |
| Portfolio | 940 ms, 6 requests | 1193 ms, 3 requests | 121 ms | 103 ms |
| Committee | | | 287 ms, 2 requests | 223 ms, 1 request |
| Network | | | 147 ms, 3 requests | 73 ms, 1 request |

Moves with several reads got faster (deal page and network both cut by about 40 to 50 percent); cold loads moved
within the noise. Why (waterfall, `WATERFALL=1`): a cold load first waits on the boot chain (index chunk, then
`setup.status`, then `auth.refresh`), and the page's first wave is about four reads; one batch runs them one
after another in one runtime (767 ms for deals.get, next.count, jobs.list and notifications.list after a restart),
where four parallel requests took 344 ms at that load. The next wave is then cheaper (191 ms against 558 ms).
Under the heavier load kernel-core measured (ten reads at once, 4.3 to 10.7 s), the single request wins outright.
Boot (2026-11-12, round 2b): with a token, `auth.refresh` goes first and alone, and a live session opens the frame
as soon as it answers; `setup.status` is asked only when there is no live session (a session means a set-up firm).
The first page's lazy chunk starts loading at boot (`preloadPage`), alongside the session check. Asking setup.status
and auth.refresh side by side was measured too and is slower right after a restart: each concurrent request warms its
own cold JS runtimes. Boot gap (main chunk in to the first page read leaving), medians of 12 cold loads each (Home
and Focus, server restarted every time): sequential 412 ms, side by side 437 ms, refresh first 337 ms. Content
medians: Home 1200 / 1399 / 1215 ms, Focus 1156 / 1054 / 883 ms (sequential / side by side / refresh first), one
request fewer on every signed-in load. `tests/boot_check.mjs` covers every path: live session (refresh first, no
setup.status, the frame does not wait), no session (sign in), dead session (cleared quietly, no notice), firm not set
up (setup, token cleared), unreachable (Try again).

`tests/batch_check.mjs` shows every screen reads the same with and without batching (10 pages), batches hold only
reads (at most 12, no duplicates), a 404 read fails alone beside 200s, and a realtime change refreshes next.list and
next.count in one request.

`tests/merged_audit.mjs` runs the theme audit (16 packs x 2 modes) and the UX audit over every page of the merged app
(module pages included) and groups the findings by owning module; `tests/checks.mjs` holds the in-page checks.

## 10. Tests and screenshots

Tests in `reference/tests/kernel-frontend/` (scratch: `SCR/kernel-frontend/tests/`; run with `run_all.sh`, set `APP`
and `PORT`). All but `real_smoke.mjs` ran against the scratch stand-in backend (port 3183): `seed.mjs` uses the stand-in's
`standin.seed` op and sample op names (`intake.advance`, ...) that only the stand-in has; point it at real module ops
once they land.

| Test | Result |
|---|---|
| `setup.mjs` | Empty database: the four steps light and dark at 1440 and 390, recovery code shape, the app opens. Pass. |
| `shots.mjs` | Every screen light and dark at 1440 and 390, no console errors, word counts at rest. Pass. |
| `flows.mjs` | 26 checks: the draft and proposal pages, vote with chips and PIN, advance and Undo, pass with a reason key, skip, edit a draft, wrong PIN then right, All clear, agent question answered live, invite code, import, export with PIN, Ctrl K, drop, fund scope, dense rail. Pass. |
| `audit.mjs` | 16 theme packs x light and dark x 4 pages: token pairs and every text node. Pass. |
| `real_smoke.mjs` | Against the REAL kernel (an APP copy, 139 ops, empty database then `setup.mjs`): every kernel page light 1440 and dark 390, autonomy switches and AI inventory, a fund with LPA terms (entities.save), an invite with the PIN, the import dialog (no targets registered yet: its empty state), chat.ask followed in the panel; no console errors or 5xx. Pass (8 checks). |
| `ux_audit.mjs` | Type scale, pointer cursor, hover sweep (light, dark), phone targets, sideways scroll, long word. Pass. |
| `merged_audit.mjs` | The merged APP (a module's seed, e.g. committee `seed_ui.mjs`): theme and UX audits over every page, findings grouped by module, console errors too. 0 kernel-frontend findings. |
| `reader_check.mjs` | The citation reader: `Citation source` opens the registered reader over the page and as `#/source`, anchor-only refs resolve, Esc closes. 9 checks, pass (with diligence's `reader` export added in scratch). |
| `lazy_check.mjs` | Lazy pages on the merged build: chunks prefetched after the first paint, deep links render, a move waiting on a slow chunk keeps the old page (0 blank frames), returning paints rows in 22 ms, no console errors on any page. Pass. |
| `lpa_check.mjs` | Settings > Funds: Compounding saves `pref_compounding`, every other LPA key round-trips. Pass. |
| `batch_check.mjs` | Read batching on the merged app, unbatched build against batched build: same text on 10 screens, reads only, at most 12, no duplicates, string params, a 404 fails alone, realtime refresh batched. Pass. |
| `boot_check.mjs` | Boot paths: live session (auth.refresh first, setup.status not asked, the frame does not wait), no session, dead session, firm not set up, unreachable. Pass (stand-in and merged). |
| `cold_load.mjs` | Cold loads (server restarted each time; `boot` = main chunk in to the first page read) and, with `WARM=1`, moves inside the app, for kept builds `pb/pb_public_<variant>`; `WATERFALL=1` prints every request. The numbers in 9b. |

Screenshots: `SCR/kernel-frontend/shots/` (`<screen>_<scheme>_<width>.png`: setup steps, signin, invite, recover,
home, focus and focus cards (vote, choose, triage, reading, draft, draft edit, proposal, verify, payment), agent panel,
agent page, drawer, search, notifications, drop and drop choose, every Settings section, invite dialog, fund sheet,
import dialog, gallery (every chart), dense rail; `flow_*` from the flows).

Word counts at rest (light 1440): home 4, focus 17, settings firm 18, funds 30, members 27, data 20, security 29.
Settings, Your AI agent opens on Switches; the Rules tab is REPORT Table 37 (policy text, read-only).

## 11. Gaps

- Open in other modules (merged audit, 2026-11-12; their files, not changed here): committee: the MeetingRoom's
  selected agenda row has no hover (use `--vo-active-hover`), `ChipToggles` can become `ChipPicker multiple`, its
  citations can pass `source`; network: `rowHref` rows in `components/network/Tables.tsx` hold a `PersonChip href`
  (an anchor inside an anchor), and phone targets under 24 px on text links (/network company and site links,
  /people/:id email and company); portfolio: `Sparkline status` and `Citation source`; every module: `lazyPage`.
- Home is a placeholder (`#/` with Start) until the home module brings its route and `homeBlocks`.
- Table 37 is kept as a fixed table in `pages/settings/Agent.tsx` (the policy the catalog enforces); `ai.inventory`
  feeds the Inventory tab (job kinds and per-module allow, propose, deny counts).
- `NextItem.data.edit` needs the owning module to send it (request 3 above for kernel-core's drafts).
- Notifications show title and time; structured `facts` are not rendered yet.
- npm dependencies added: `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono`, `lucide-react`
  (as HR OS), `pdfjs-dist` 6.4.299 (as Research OS), `read-excel-file` ^9.3.14 (XLSX import, as Store OS) and
  `write-excel-file` ^4.1.1 (XLSX export). No devDependencies changed.

## Majors fix (2026-11-12, QA M1, M4, UI-02, UI-06)

1. **M1 E edits a draft.** `NextData.edit` is `{ op, params, fields: { subject, body } }` (kernel-core's shape; `field` is gone). E (or Edit) opens every field: an input per short field (Subject), the textarea for `body` (Message, focused); Save sends `params` plus the changed fields through `op`; Esc or Cancel restores them. While editing, Save is the one black button (the card's primary action waits, outlined and disabled). Tested end to end in the browser: a person passes an inbox item, your AI agent drafts the email from its job, Focus, E, new subject and body, Save, `outbound.get` shows both and the card shows the new subject.
2. **UI-02 proposals.** The proposal card and `#/next/proposal/:id` show the lines kernel-core sends ("Raise: USD 12M -> USD 15M": `fields[].label`, an arrow between before and after), the kind as a neutral Tag (`kind_label`), and a panel label only when a proposal holds several changes whose label is not the title (a single change is never titled twice).
3. **UI-06 one black element.** `ChipPicker` (one and many) is Segmented's family: chips sit sunk; the chosen one is raised with an ink outline and a check, never solid. `Tag tone="agent"` and `AgentTag` are an ink outline with the Sparkle, never solid. Kernel screens measured in light and dark at 1440 (ink-filled elements in the main column or open dialog): setup 1 (Continue), invite dialog 1 (Invite), Focus draft 1, draft while editing 1 (Save), Focus proposal 1, proposal page 1 (Accept), Focus pass chips 0. Modules that drew their own black chips switch to ChipPicker.
4. **M4.** `runNextAction` asks the PIN first when an action says `pin: true` (an Accept of an import that needs it) as well as for confirm ops; `ImportDialog` asks the PIN once (checked by the dialog) for a target with `pin: true` (`ImportTarget.pin`) and sends it with every batch; any other op that answers `missing_param` for `pin` gets the PIN dialog from `op()` as before.

Shots: `SCR/fix-kernel/shots/` (`focus_draft`, `focus_draft_edit`, `focus_draft_saved`, `focus_proposal`, `next_proposal`, `focus_pass_chips`, `dlg_invite`, `setup_firm`, `setup_firm_filled`, light and dark at 1440), script `SCR/fix-kernel/tests/ui_shots.mjs`. Focus keeps its card when only `?at=` changes (UI-30, not part of this fix).

## Fix 3 (2026-11-13): Board, sidebar, spacing, Home

### Board (components/ui.tsx), the contract for deals, portfolio asks and the markets map

```tsx
import { Board, type BoardColumn } from '../../components/ui.tsx';

<Board<Deal>
  label="Deal board"                        // aria label
  columns={[{ key: 'screening', label: 'Screening', items: deals }]}   // items in display order
  itemKey={(d) => d.id}
  renderCard={(d) => <DealCardBody d={d} />} // the body only; the Board draws the card frame
  cardLabel={(d) => d.name}                  // the card's name in the Move menu and for screen readers (default: itemKey)
  onMove={(cardId, toColumnKey, toIndex) => save(cardId, toColumnKey, toIndex)}
  sortable                                   // default true: reorder inside a column; false: only between columns
  fill                                       // default true: fills to the bottom of the viewport, columns scroll inside
  stalled={(d) => d.stalled}                 // warn edge
  onOpen={(d) => setPeek(d)}                 // click or Enter on a card
/>
```

- `onMove(cardId, toColumnKey, toIndex)`: `toIndex` is the card's index in the target column AFTER the move (0 = top),
  counted without the card itself. Same column = a reorder (only when `sortable`). Called only when the place changed.
  The card stays where it was dropped until `columns` shows it there. When onMove returns a Promise: a rejection puts
  it back at once; after it resolves, the next `columns` change is taken as the truth. Without a Promise it stays
  there until `columns` shows it in the target column at that index (any index when not `sortable`), or for 8
  seconds. Persist the order on your side (a rank) and give `columns` back in that order.
- Dragging (mouse and pen): the card lifts and follows the pointer with a soft shadow; a dashed shadow placeholder of the
  same height shows exactly where it will land and the other cards make room (150 ms, none with reduced motion). A
  column under the pointer is outlined. Columns and the board scroll by themselves near their edges. Buttons, inputs
  and `[data-vo-nodrag]` inside a card never start a drag; a drag never fires the card's click.
- Keyboard and phone: every card has a Move button (top right, on hover or focus, always on touch screens) with Move up,
  Move down (when `sortable`) and "Move to" each other column (lands at the top, index 0). With a card focused,
  Alt+ArrowUp / Alt+ArrowDown reorder and Alt+ArrowLeft / Alt+ArrowRight move it to the next column.
- `fill`: the board's height runs from its top to the bottom of the viewport (less the PageBody bottom padding), at
  least 320 px; each column scrolls inside. Pass `fill={false}` inside a panel or sheet (natural height).
- Funds' raise board (`components/funds/RaisePage.tsx`) passes `onMove(id, to)` without an order: it should pass
  `sortable={false}` (funds owner) or a same-column drop calls raise.move with the same stage.

### Shell

- The sidebar folds only by the person's click (remembered in `vo.ui.rail`); `RouteDef.dense` no longer folds it
  (kept in the type, informational). The fold button is always visible (the rail shows it alone at the top).
- The blank band under a scrolled page (owner's screenshot 3): the frame was `h-[100dvh] overflow-hidden` with an
  unpositioned `main`, so an absolutely placed element deep in a long page (an `sr-only` list, a tooltip) took the
  window as its containing block, made the document taller than the window, and the wheel at the end of `main`
  scrolled the document: the whole frame slid up and the page background ended mid-screen. Now the frame is
  `fixed inset-0` (`data-vo-frame`) and `#vo-main` is `relative`: the document never scrolls, the sidebar runs the full
  window height and the page background reaches the bottom at every scroll position (print restores normal flow).
- Spacing: `--vo-gap: 12px` between panels and blocks. `PageBody` uses it (`gap-3`, 16px top, 20px sides and bottom on
  desktop, 16px sides on phones); a module's own `gap-5` / `gap-6` grids inside `PageBody` follow it (theme.css), so
  every module tightens without edits. `Panel` padding is 16px.
- Panel titles: `Panel label` is now a plain 13px semibold title in ink (was a 10.5px mono uppercase label), with an
  optional `tip` (a ? beside it) for the detail; no text under it. `Section` keeps the small mono label inside panels.
- `ago()` says "1 day ago" (was "1 days ago").

### Home (pages/home, components/home, lib_home_visual.js)

- Hero on the page itself (no card): the constellation (`components/home/Constellation.tsx`, SVG, replaces the canvas
  `constellation.ts`), the Firm NAV as the one big figure on the left, a three-line key on the right (orbit = fund,
  solid = healthy, red ring = needs attention). Meaning: wireframe sphere = the firm (turns once in two minutes,
  still with reduced motion, off screen or in a hidden tab); thick circle = committed capital, solid for the share
  called, dashed for dry powder, labelled "26% called" on the diagonal nearest the end of the called arc; each tilted
  orbit = a fund sized by its size; each node = a holding placed along its fund's orbit by the day first invested,
  solid when healthy, a `--vo-bad` ring when its runway is under the threshold or it is valued below cost, sized by
  value; vertical axis TVPI, horizontal DPI, tick dots at 1x 2x 3x, a bar at the current value, "TVPI 1.36x" and
  "DPI 0.12x" at the ends. Hover or focus: company (value, multiple, runway, why it needs attention), fund (size,
  companies), the circle (committed, called, dry powder); click opens the company or the fund. Labels keep 12 and
  13 px at every width. Empty firm: "Add a fund to see your firm here" with Add fund.
- `home.summary` visual additions: `readouts.dpi_e8`, `readouts.committed_minor`, `readouts.called_minor` (signed
  commitments and the part called, firm currency; the scoped fund else every fund), `readouts.funds`;
  `constellation.rings[].size_minor` (size, else target, else commitments) and `start_day`;
  `constellation.nodes[].first_day`, `attention`, `reasons` (`runway`, `marked_down`). Cache keys moved to `v3:` and
  `commitments` joined the fund fingerprint.
- Layout: hero; Today's meetings (8 columns) beside Waiting for you (Next with Start, 4); News (full width, the latest
  six from markets' `news.list` scope home, 2 columns; hidden when the role cannot read Markets or the op is not in
  the build); New deals by source beside This quarter's deals (the cohort flow); Portfolio by value beside Fund
  performance; Runway, Invested by sector, ARR growth. Every title says what is in it, details in tips, every figure
  with its unit ("35 items", "84 deals in 12 months", "3.4 mo", "USD 7M", "12 deals"); unknown runways are left out
  (named in the tip).

### Tests (SCR/fix3-shell/work)

- `board_test.mjs` (deals board, light): fills to the bottom with no page scroll; drag between columns shows the
  placeholder after the first card and the lifted card; the drop calls deals.move and the card lands where the
  placeholder was; reorder inside a column moves the placeholder below the second card; Escape puts it back; the Move
  menu lists Move up, Move down and every other column; no console errors. Pass.
- `shots.mjs`: 12 screens x light and dark x 1440 and 390: the document never scrolls, the page reaches the bottom of
  the window, the sidebar runs the full height and stays open (desktop), the deals board fills the height, no console
  errors. Shots in `SCR/fix3-shell/shots/` (`<screen>_<scheme>_<width>.png` and `_end` scrolled to the bottom).

## Fix 4 (2026-11-13): dividers, the living hero, Home news, the Inbox card

### Structure must be visible: `Section`, `Sections`, `Panel divided` (components/ui.tsx, theme.css)

The owner's rule for every card and page: each section inside a card is separated from the next by a full-width
hairline divider, each section starts with its title at the top left, labels and values align on a grid, nothing
floats between sections. The kernel gives three pieces; adopt them when you touch a card.

```tsx
import { Panel, Section, Sections } from '../../components/ui.tsx';

<article className="vo-panel flex flex-col">            {/* a card with no padding of its own */}
  <Sections pad="card">                                  {/* dividers edge to edge, 16px / 20px (24px from md) */}
    <header>...who it is...</header>                     {/* any block can be a section */}
    <Section title="Key numbers" tip="What the figures are.">...</Section>
    <Section title="About the deal" aside="Source: email">{/* aside: right end of the title row */}
      <dl className="grid grid-cols-[minmax(96px,140px)_minmax(0,1fr)] gap-x-6 gap-y-2">...</dl>
    </Section>
    <Section title="Missing">...</Section>
  </Sections>
  <div className="border-t border-[var(--vo-line)] px-5 py-3">...the action bar...</div>
</article>

<Panel label="News" divided>...</Panel>                  {/* a hairline under the panel's title row */}
<Sections pad="flush">...</Sections>                     {/* inside a padded body: dividers span the content */}
<Sections pad="tight">...</Sections>                     {/* a dense column of figures, 10px apart */}
```

- `Section({ title?, aside?, tip?, className, children })`: the title is the small mono label (unchanged look, now an
  `h3`), `aside` sits at the right of the same row (a source, a count, one small action), `tip` puts a ? beside the
  title. Existing uses keep their look; inside `Sections` they get the dividers.
- `Sections({ pad = 'card' | 'flush' | 'tight', label? })`: `.vo-sections` in theme.css draws `border-top: 1px solid
  var(--vo-line)` on every child after the first and pads each child; the rule is unlayered, so a child's own
  padding utilities do not apply inside it (keep a sticky action bar outside).
- `Panel divided`: the title row gets a full-width hairline under it and the body starts 12px below. Home uses it on
  every panel.

### Home hero (components/home/Hero.tsx, Constellation.tsx; lib_home_visual.js)

- No legend. Left: the key numbers as a column (each label above its mono figure, hairlines between): Firm NAV (26px;
  the scoped fund's NAV, labelled "Fund I NAV", when the sidebar scopes a fund), TVPI, DPI, Net IRR, Called ("26% of
  USD 180M"), Dry powder, Portfolio companies ("15 companies"), Open deals ("28 deals"). NAV, companies and deals open
  their pages. On a phone the drawing comes first and the figures sit below in two columns.
- `home.summary` readouts added (no math in the screen): `net_irr_ppm` (the scoped fund's, else
  `lib_eng_metrics.netIrr` over every fund's LP flows in the firm's currency with the firm NAV), `called_ppm`,
  `dry_powder_minor` (sum of `lib_funds.overviewOf(...).unfunded_minor`), `fund_nav_minor` (scoped fund),
  `companies` (portfolio companies in the scope). The funds cache key moved to `v4:`.
- The drawing is alive and calm: the sphere turns (one turn in 40 s), companies travel their fund's orbit (one lap in
  about 4 minutes, keeping their order by the day first invested; on the back half they pass behind the firm), a
  company that needs attention pulses (a `--vo-bad` ring grows and fades every 2 s). Fund names sit beside each orbit
  where it is widest; every company has its name beside it (12px, ink at 70%), placed at the first clear spot
  (outward, inward, above, below and further out), kept while it touches nothing, gliding to a new spot when it must;
  a name with no clear spot fades out (on a phone about 6 of 15 show). Everything pauses while the pointer or keyboard
  focus rests on a company (a ring plus Hero's tooltip; a click opens it) and nothing runs with
  `prefers-reduced-motion: reduce` (a still frame, every name placed).
- Why it did not move before: it turned once in two minutes and only the 50px sphere moved. Reduced motion was not
  the cause: Windows "Animation effects" is on here, and headless Chromium and a frame built like CraftBot's
  (`visibility:hidden` iframe shown later, `frameHost.ts`) both report `no-preference` (checked by the tests).
- Cost: what stands still is SVG, what moves is drawn on a canvas above it, so a frame changes no page element; a
  timer wakes the loop about 15 times a second and asks for one animation frame then (a bare requestAnimationFrame
  loop ran the whole frame pipeline 60 times a second: 20% of the main thread in headless Chromium; SVG attribute
  updates alone cost about 5%). Now about 3.5% of the main thread in headless software rendering. Off screen or in a
  hidden tab it does nothing. The canvas reads the theme colours from the `--vo-*` tokens and redraws on a theme
  change. `canvas.voSpots` (a getter, not in the page) gives tests each company's place and name box.
- Keyboard: each company is a button in a screen-reader list inside the drawing; focusing one stops the motion and
  rings it in the drawing. Orbits and the capital circle stay focusable SVG.

### Home news (components/home/News.tsx)

A small dashboard on markets' contracts (`components/markets/news.ts`: `newsParams`, `NEWS_READS`, `CATEGORY_LABEL`,
`IMPACT_LABEL`, `askInsights`): category tabs (All, Portfolio, Pipeline, Sectors, Markets and macro, Funding, Exits and
M&A, Policy); the lead story (the first of the top 13 with a picture: picture beside the words; else a clean
typographic card, never a made-up picture); six compact cards (thumbnail when it has a picture, headline, topic chip,
source, time), each opening the article in a new tab; beside them "Your AI agent's take" (the latest 3 of
`news.insights`: impact chip Positive, Negative or Watch, headline, two lines of analysis, what it affects, "Full
insight" to `#/markets/news?insight=<id>`). Empty: "News for your firm shows here" (Open Markets), a category with
nothing ("Show all news"), no insights yet ("Ask your AI agent", `news.insights-ask`). Hidden without `markets:view`
or while the ops are not in the build.

### Inbox (components/intake/ItemCard.tsx, pages/intake/Inbox.tsx)

- The card in `Sections`: who it is (logo, name, one line, from and when, status chip) / Key numbers / About the deal
  (facts grid; "Source: email" once, at the right of the title row; each row's source on hover) / Fit with your
  theses / Missing / Seen before / Deck and email (the title says what is there) / Passed / the outcome; the verdict
  bar stays sticky under a hairline. Focus mode's compact card uses `Sections pad="flush"`.
- The top strip: Ready to decide "4 deals" | Replies overdue "1 reply" | Typical reply "43 days", each label above its
  figure with hairlines between. The list's rows and header use `--vo-line` like the card's dividers.

### Tests (SCR/fix4-home/work)

- `shots.mjs`: motion (the sphere turns, companies travel, pulse rings change, a name for every company, no two names
  overlap over 6 samples, main thread under 5%, hover pauses and shows the detail with a hand cursor, moving away
  resumes), reduced motion (still, names placed and clear), a CraftBot-like frame (reduced motion not reported, it
  moves); Home, News and Inbox light and dark at 1440 and 390 (eight key numbers, no legend, names never overlap,
  every Inbox card section after the first starts with a divider, the source sits in the About the deal title row,
  no console errors). `news_check.mjs`: every category tab against markets' real `news.list`, the insight link.
  `focus.mjs`: Focus mode's compact card. `cpu.mjs`, `trace.mjs`: the hero's main-thread cost. All pass.

## Fix 5 (2026-11-13): logos

- `lib/images.ts`: `useImage(url)` (undefined while loading, null when none) fetches a protected image with the session
  (as `download` does) and keeps an object URL per url; `primeImage(url, localSrc)` makes a just-uploaded file stand for
  the url the server answered (no second download, no flash); `logoProblem(file)`, `LOGO_ACCEPT`.
- `components/portfolio/Logo.tsx`: `CompanyLogo({ name, domain, logoUrl })` is the one company logo: the uploaded logo,
  else the website favicon, else the letter. `LogoPicker` is the same logo as a button (click to choose, drop an image;
  hover shows ImageUp). Used by the portfolio hero and grid, deal peek, phone rows, deals list, deal page, Inbox rows and
  card, the network company page.
- Sidebar: with `me.firm.logo_url` (auth.me) the firm's logo replaces Telescope and "Venture OS" (at most 28 by 160 px,
  never enlarged, alt and title = firm name); the folded rail shows it fitted in a 32 px square above the expand button;
  `.vo-logo-plate` puts it on a small white plate on the dark theme. Settings, Firm: a Logo panel (the sidebar head as a
  preview and drop target, Choose or Replace image, Remove; owner or admin).
- Tests: `SCR/fix5/work/t_ui.mjs` (48 checks: flows, refusals for an analyst, shots light and dark at 1440 and 390 in
  `SCR/fix5/shots/`).
