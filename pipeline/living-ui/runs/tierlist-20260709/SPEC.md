# SPEC — Tier List (tierlist)

- Run: tierlist-20260709   Date: 2026-07-09
- Source request: queue/20260709-tierlist.md   Category: tier list maker

## 1. Summary

A personal tier-list maker: create named tier lists (games, music, food, anything), upload images or add text items, drag them into colored ranked rows (default S/A/B/C/D), and download the finished chart as a PNG. Target user: the CraftBot owner making rankings for fun or to share as images. Jobs-to-be-done: (1) rank a set of things visually in minutes, (2) keep multiple lists and come back to them, (3) get a clean shareable image of the result.

Research says the entire requirement sits inside the market's **free-tier baseline** (research/competitors.md) — so the bar is "do the fundamentals flawlessly", and win where the reference product (TierMaker) is weakest: no login, no ads, no watermark, non-destructive item removal, autosaved persistence (research/features.md §4).

## 2. Scope

**In (v1):** tier-list dashboard (create/rename/delete/search, count badges); tier grid with S/A/B/C/D defaults; tier ops (rename inline, recolor from fixed swatches, add/remove/reorder, clear-to-pool); image upload with optional captions + text-only items; unranked pool with drag-and-drop and touch/tap fallback; item ops (unrank vs delete, edit caption, bulk select); one-click PNG export of title+grid.

**Out (explicit non-goals):** accounts/auth (single-user CraftBot app; request has no multi-user constraint); public templates/community/voting; real-time collaboration; shareable state URLs; AI item generation; video items; undo/redo (disabled in GLOBAL_LIVING_UI); animations (disabled); infinite scroll (disabled).

**Won't (v1):** template library (TierMaker's moat — massive scope, zero request support); S/M/L thumbnail size presets (polish, deferrable); export formats beyond PNG (PNG is the genre standard); drag-to-reorder whole tier rows (▲▼ buttons cover it, research/ux-patterns.md §4).

## 3. Entities & data model

| Entity | Fields (name: type) | Relations | Notes |
|---|---|---|---|
| TierList | id: int PK · name: str(1–100) required · created_at: datetime · updated_at: datetime | has many Tier, Item (cascade delete) | "multiple named tier lists" verbatim |
| Tier | id: int PK · tier_list_id: int FK · label: str(0–100) · color: str(7) hex · position: int | belongs to TierList; items via Item.tier_id | color is USER DATA seeded from the canonical palette (see §6 A3); position = row order top→bottom |
| Item | id: int PK · tier_list_id: int FK · tier_id: int FK **nullable (NULL = unranked pool)** · caption: str(0–200) · image_path: str nullable · position: int | belongs to TierList; optionally to Tier | text-only item = image_path NULL; image item caption optional. Never a field named `metadata` |

No enum-like fields (no `Literal` needed). Ordering = integer `position` renumbered on move (research/data-model.md §2 — fractional indexing is overkill at this scale). Uploaded files: disk under `backend/uploads/`, content-hash filename, path in DB, served same-origin via FastAPI StaticFiles.

## 4. Features (MoSCoW)

### Must

#### M1 — Tier list management (dashboard)
Card dashboard of all tier lists; create with a name, rename, delete (confirm dialog), open in editor. Search/filter bar and per-card item-count badges (GLOBAL_LIVING_UI enabled rules).
- [ ] Creating a list with a name shows it on the dashboard; reloading the page keeps it.
- [ ] A new list opens with exactly 5 tiers labeled S, A, B, C, D in canonical colors, all empty, plus an empty pool.
- [ ] Deleting a list asks for confirmation and removes its tiers, items, and now-unreferenced image files.
- [ ] Dashboard search narrows cards by name as you type; each card shows its item count.

#### M2 — Tier grid (the editor core)
Full-width rows: colored label cell left, neutral item strip right, row controls on the right edge. WYSIWYG — the grid always looks like the export. List title shown above the grid, editable.
- [ ] Tier label renames inline (click label text, type, blur/Enter saves) and persists across reload.
- [ ] Row label cells render their stored color with near-black text (all swatches are light pastels).
- [ ] Rows grow vertically when items wrap; label cell stretches with the row.

#### M3 — Tier operations
Per-row controls: ▲▼ move, and a settings popover with color swatches (fixed 13-light-swatch palette), Add Row Above, Add Row Below, Clear Row, Delete Row.
- [ ] Add Row Above/Below inserts an unnamed row at the right position with the next palette color.
- [ ] Clear Row moves the row's items to the pool (order appended), never deletes them.
- [ ] Delete Row does the same for its items, then removes the row; deleting the last row is blocked (min 1 tier).
- [ ] Row order changes via ▲▼ persist across reload.

#### M4 — Items: upload & text
Multi-file image upload (jpg/jpeg/png/webp, ≤10 MB/file, server-side resize to ≤512 px + EXIF strip via Pillow, content-hash dedupe) landing in the pool; optional caption per image; "Add Text" creates a text-only item that ranks identically.
- [ ] Uploading 3 files at once puts 3 thumbnails in the pool; reload keeps them.
- [ ] A .txt or 15 MB file is rejected with a user-visible error toast; valid files in the same batch still land.
- [ ] An image item's caption renders under the thumbnail; a text-only item renders as a tile with its text.
- [ ] Re-uploading the same image file does not duplicate the stored file (hash dedupe) but does create a second item.

#### M5 — Pool & drag-and-drop
Bottom tray under the grid; drag pool→row, row→row, reorder within a row; drop shows an insertion indicator; touch gets long-press drag AND tap-item-then-tap-tier fallback (research/ux-patterns.md §4). Esc cancels an in-flight drag/selection.
- [ ] Dragging an item from the pool into tier S places it at the drop position; reload shows it still in S at that position.
- [ ] Reordering two items within a row persists.
- [ ] On a touch viewport, tapping an item then tapping a tier row places it (fallback path).
- [ ] The pool is visibly a drop target and items dragged out of rows land back in it.

#### M6 — Item operations
Hover/selected item shows: × (unrank → returns to pool — NEVER deletes), edit caption, delete (confirm dialog). Pool supports bulk-select → delete selected (enabled global rule). Delete removes the DB row and the file if unreferenced.
- [ ] × on a ranked item returns it to the end of the pool; the item is not deleted.
- [ ] Deleting an item asks for confirmation and removes it everywhere; its file is gone from uploads/ if no other item references it.
- [ ] Editing a caption persists across reload.
- [ ] Selecting 3 pool items and choosing Delete removes all 3 after one confirmation.

#### M7 — Export as PNG
One "Download image" button; captures ONLY the title + tier grid (pool and all controls excluded via `data-html2canvas-ignore`), using html2canvas (already a template dependency), after `document.fonts.ready`; triggers a browser download named `<list-name>.png`. No watermark.
- [ ] Clicking Download on a populated list saves a PNG whose content is the title + all tier rows with their colors, images, and captions — no pool, no buttons.
- [ ] Export works with uploaded images (same-origin — no canvas taint) and text-only items.
- [ ] A list with an empty tier exports that tier as an empty colored row (structure preserved).

### Should
- Keyboard-accessible item movement (Tab focus, arrows move between tiers) — enabled-rule "keyboard shortcuts" beyond Esc/Delete basics.
- Pool filter box when the pool holds many items (mirrors the search enabled rule inside the editor).
- Duplicate tier list (dashboard card action).

### Won't (v1)
See §2 — template library, thumbnail size presets, non-PNG export, draggable rows.

## 5. Questionnaire answers

**1. Design & Visual Identity** — CraftBot tokens throughout (primary #FF4F18 for primary actions, `var(--radius-md)`, comfortable spacing, system font, follow-system theme). Tier label colors are user data seeded with the canonical TierMaker-style pastel ramp (S #FF7F7F, A #FFBF7F, B #FFDF7F, C #FFFF7F, D #BFFF7F) — the genre's visual identity, stored per-row, user-changeable from a fixed 13-light-swatch picker. Item strips and all chrome use neutral tokens so the label column carries the color.

**2. Data & Entities** — TierList → Tier → Item per §3. Pool = Item.tier_id NULL. Order = position ints.

**3. Features & Functionality** — full CRUD on all three entities; drag-and-drop placement; multi-upload; caption editing; unrank-vs-delete distinction; PNG export; search on dashboard; bulk delete in pool.

**4. Layout & Navigation** — two screens: dashboard (card grid) and editor (title bar → tier grid → Add Tier → toolbar → pool tray). Back link editor→dashboard. Detail editing happens inline or in small popovers — no separate detail screens. Modals only for confirmations and the caption editor.

**5. UX & Polish** — loading spinners on fetch/upload/export; toasts for all CRUD outcomes; confirmation dialogs for all destructive actions; empty states: new list shows full colored empty grid + dashed upload target with "Upload images, then drag them into tiers"; dashboard empty state with "Create your first tier list" button; inline validation on names/captions; hover states everywhere; insertion indicator during drag.

**6. Users & Access** — single user, no auth (CraftBot personal app; request silent on multi-user → Safe Assumption: no auth module).

## 6. Assumptions register

| # | Assumption | Source | Risk if wrong |
|---|---|---|---|
| A1 | No auth/multi-user needed | safe-assumption (request silent; personal CraftBot app) | Auth module retrofit is a known, documented path |
| A2 | Default tier colors = canonical pastel ramp; label text near-black; picker constrained to 13 light swatches | research: ux-patterns.md §6, data-model.md §3 | Colors are per-row data — trivially reseeded |
| A3 | Tier colors stored as user DATA (hex in DB) do not violate the no-hardcoded-colors rule, which governs UI chrome/CSS | request (tier lists are inherently colored) + guide reading | If reviewer disagrees, swap swatch hexes for token-derived palette — isolated change |
| A4 | × on ranked item = unrank to pool; explicit delete is separate | research: features.md §4 (most-requested fix in category) | Behavior toggle is small |
| A5 | Export includes title, excludes pool/controls | research: ux-patterns.md §4 | Capture container is one component — easy to adjust |
| A6 | Images resized server-side to ≤512px, originals not kept | research: data-model.md §4 | Full-res needed → keep original alongside thumb |
| A7 | Min 1 tier per list enforced | research: data-model.md §6 | Trivial to relax |
| A8 | Upload cap 10 MB/file, formats jpg/jpeg/png/webp | research: data-model.md §6 (TierMaker whitelist) | Config constant |
| A9 | Rows reorder via ▲▼ buttons, not drag | research: ux-patterns.md §4 (TierMaker pattern); scope control | Drag-rows could be a later round |

## 7. Design direction (handoff to Part B)

1. **tiermaker.com** — PINNED by the human. Editor viewable without login at `https://tiermaker.com/single-use-tier-list/` and template pages; **blocks automated fetchers (Cloudflare 403)** — expect fallback ladder.
2. **opentierboy.com/rank/** — verified live, no login, deliberately TierMaker-like layout; best capturable stand-in.
3. **tierlist-maker.com** — verified live, no login, minimal chrome, exactly our feature set.

## 8. Build notes

- No auth module. No external integrations.
- **Smoke-test contract** (guide "Schema contract" section): upload endpoint `POST /api/upload` takes an OPTIONAL multipart file and returns 200 `{"status":"no_file"}` when absent (auto-generated smoke payloads must not 422); item create accepts plain JSON (`caption` and/or `image_path`, both optional at the API level); all DELETEs idempotent (200 `{"status":"not_found"}` on missing) and query-param-free; no FK-existence 4xx on PUT; no enum fields.
- Reorder API: `PUT /api/tier-lists/{id}/order` style bulk endpoints receiving ordered id arrays (one transaction, renumber positions).
- `html2canvas` is already in `_template` package.json — reuse, do not add a new capture lib. Use `data-html2canvas-ignore` on all chrome inside the capture container. Avoid `oklch()` anywhere (html2canvas limitation).
- Uploads dir `backend/uploads/` must be cleaned at publish (runtime artifact). Serving: a normal `GET /uploads/{filename}` route in `routes.py` returning `FileResponse` (router is included at `/api`, so images live at `/api/uploads/<hash>.webp`) — verified this needs zero `main.py` edits.
- Pillow added to `backend/requirements.txt` for resize/EXIF-strip.
