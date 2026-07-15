# DESIGN SPEC — Tier List (tierlist)

- Run: tierlist-20260709   Date: 2026-07-09
- References: tiermaker.com (PINNED — primary structural reference, captured live), opentierboy.com (secondary — row styling, minimal chrome), tierlist-maker.com (mobile stacking check)

## 1. References & shot inventory

| File (reference-shots/) | Product | Screen | Width | What it informs |
|---|---|---|---|---|
| tiermaker-editor-1280.png | TierMaker single-use editor | editor | 1280 | THE canonical structure: pastel label cells left, dark full-width item strips, gear+▲▼ on right edge, upload below grid, Download button below that |
| tiermaker-editor-390.png | TierMaker | editor | 390 | rows keep structure at phone width, controls stay on right edge |
| opentierboy-editor-1280.png | OpenTierBoy /rank/ | editor | 1280 | full-width colored row treatment, one-line hint text above grid ("Drag to reorder"), rows as large drop targets, light theme variant |
| opentierboy-editor-390.png | OpenTierBoy | editor | 390 | mobile row stacking |
| tierlist-maker-editor-1280.png | TierList-Maker | editor | 1280 | toolbar grouping (Download/Share/Help in one slim row), pool with Add Image/Add Text |
| tierlist-maker-editor-390.png | TierList-Maker | editor | 390 | grid + pool remain usable at 390px; tiles shrink, rows stack full-width |

Observed on the pinned reference (tiermaker-editor-1280.png): label cells are ~70px colored squares (S `salmon`, A `peach`, B/C `yellows`, D `green`) with black text; item strips are near-black and span the remaining width; each row's right edge holds a gear icon and stacked ▲▼ chevrons; below the grid sit the upload input, a crop-mode select, and a single wide Download button. What we deliberately do NOT take: ads, cookie banner, footer marketing, "Presentation Mode", crop-mode select (we normalize server-side).

## 2. Navigation model & screen inventory

Top-level: two screens, no sidebar (the app is one artifact deep).

| Screen | Purpose | Route |
|---|---|---|
| Dashboard | All tier lists as cards; create/rename/delete/search/open | `/` (default view) |
| Editor | One tier list: grid + pool + actions | in-app view state (SPA), back link to Dashboard |

## 3. Layout per screen

### Dashboard
Information hierarchy: 1) list cards, 2) "New tier list" action, 3) search.
```
+------------------------------------------------------+
| Tier Lists                    [search____] [+ New]   |
|                                                      |
| +----------+  +----------+  +----------+             |
| | My Games |  | Snacks   |  | (Empty-  |             |
| | 24 items |  | 8 items  |  |  State w/ |            |
| | [open]   |  | [open]   |  |  CTA)     |            |
| +----------+  +----------+  +----------+             |
+------------------------------------------------------+
```
Card: name, item-count Badge, open on click, overflow menu (rename / delete). Responsive: card grid 3-col ≥1280, 2-col ≥768, 1-col at 360.

### Editor
Information hierarchy: 1) the colored tier grid (WYSIWYG — always looks like the export), 2) the pool ("what do I do next"), 3) chrome (small, monochrome, excluded from export).
```
+------------------------------------------------------+
| < Back   [List name (inline edit)]      [Download]   |
+------------------------------------------------------+
| +---+------------------------------------+ [g][^][v] |
| | S | [img][img][img+caption]            |           |
| +---+------------------------------------+           |
| | A | [img]                              | [g][^][v] |
| +---+------------------------------------+           |
| | B |                                    | [g][^][v] |
| ... C, D ...                                         |
| [+ Add tier]                                         |
+------------------------------------------------------+
| POOL  [filter___] [Upload images] [Add text] [Select]|
| +--------------------------------------------------+ |
| | [img][img][txt][img]   (dashed drop target)      | |
| +--------------------------------------------------+ |
+------------------------------------------------------+
```
Capture container for export = title + grid only (everything else carries `data-html2canvas-ignore`).
Responsive: at 768 the row-control icons collapse into the gear popover (▲▼ become popover entries); at 360 label cells shrink (~52px), tiles ~64px, toolbar wraps, pool actions stack. No horizontal scroll at any width; rows grow vertically.

## 4. Interaction patterns

- **Drag-and-drop** (per SPEC M5): pool→row, row→row, reorder in row; ghost tile follows pointer; 2px insertion indicator at drop position; origin slot collapses. Esc cancels.
- **Touch**: long-press drag AND tap-item-then-tap-tier fallback (selected item gets a highlight ring; tapping a row places at end; tapping the pool unranks).
- **Tier rename**: click label text → inline input → Enter/blur saves. Row settings gear popover: color swatch grid (13 light swatches), Add Row Above, Add Row Below, Clear Row, Delete Row. ▲▼ move row.
- **Items**: hover (desktop) / select (touch) reveals × (unrank to pool), pencil (caption Modal), trash (delete w/ confirm). Pool bulk-select mode via [Select] toggle → checkboxes on tiles → "Delete selected" with one confirm.
- **Upload**: button opens file picker (multi); dashed pool area also accepts drop-in files; per-file progress spinner; toast per outcome.
- **Export**: Download button → spinner state → browser PNG download `<list-name>.png`; success toast.
- **Keyboard** (enabled global rule): Esc cancels drag/selection; Delete unranks selected ranked item / prompts delete for pool item; arrow keys move a selected item between adjacent tiers (Should-level polish).

## 5. Empty / loading / error conventions

- New list: full colored empty S–D grid (never a blank canvas) + pool empty state: dashed border, "Upload images, then drag them into tiers", [Upload images] [Add text] buttons.
- Dashboard empty: EmptyState with "Create your first tier list" CTA.
- Loading: spinner overlay on initial fetch; per-tile spinner during upload; Download button gets loading state during capture.
- Errors: toast with a human message on any failed API call (enabled global rule); rejected files itemized in the toast ("2 uploaded, 1 rejected: too large").

## 6. Component mapping

| Observed pattern | Preset component (COMPONENTS.md) | Notes |
|---|---|---|
| Dashboard list card | Card + Badge + Button | count badge, overflow menu from Button variants |
| Search / filter bars | Input | dashboard + pool filter |
| New list / rename / caption forms | Modal + Input + Button | inline validation per global rules |
| Confirm delete (list/tier/item/bulk) | Modal + Button (danger variant) | destructive-action rule |
| Toolbar actions (Download, Upload, Add text, Select) | Button (+ hidden file input composed behind Upload Button) | compose: file input has no preset — wrap `<input type=file>` invisibly under a preset Button |
| Empty states | EmptyState | dashboard + pool |
| Toasts | react-toastify | mandated |
| Tier row (label cell + strip + controls) | **compose from primitives** | the domain artifact; no preset fits a tier grid — built from divs styled with tokens + preset icon Buttons; label color from row data |
| Row settings popover | **compose from Card** | small anchored Card with a swatch grid of plain button elements — flagged; swatches render data colors |
| Drag ghost + insertion line | **compose** | drag layer; tokens for the indicator color |
| Item tile (thumb + caption) | **compose from Card primitives** | 80px cover-fit thumb, caption strip, hover action icons (preset icon Buttons) |
| Tabs/Table/List/Select/Toggle | not used | no fit needed |

## 7. Non-goals of the reference pass

Not copied from references: ads/banners, cookie notices, footers, marketing sections, "Presentation Mode", crop-mode dropdown (server normalizes instead), TierMaker's dark page background as identity (our theme follows CraftBot tokens in both modes), community/template features, OpenTierBoy's gradient row fills (we use flat data colors for export fidelity — html2canvas gradients risk), any logos/product names/copy text.

> **HARD RULE (README rule 7 / RESEARCH_AND_DESIGN §0.4):** colors, fonts, spacing, radii, shadows of ALL chrome come from GLOBAL_LIVING_UI.md + `global.css` tokens + preset components — never from these screenshots. The screenshots dictate where things go and how they behave. The only non-token colors anywhere are the per-tier swatches, which are **user data stored in the DB** (SPEC assumption A3), rendered like any user content.
