# Tasks: Research Board

Every task cites what it implements. These features already exist in the published app `research-board` 2.0.0, so the build tasks are recorded as done.

## Build
- [x] T-1 (F-LOOK-1, F-LOOK-2, F-LOOK-4): the sidebar-and-board frame with no other pages, flat compact high-contrast surfaces, one line icon per kind and no emoji (`App.tsx`, `theme.css`, `lib/kinds.ts`).
- [x] T-2 (F-LOOK-3): `--rb-*` colors derived from the host theme tokens with contrast checks, re-derived on each theme change, with neutral kinds and hues only for supports and contradicts (`lib/themeColors.ts`).
- [x] T-3 (F-LOOK-5): motion for entrances, landing cards, links drawing in, sliding panels and eased view changes, all removed under reduced motion (`theme.css`, `board/canvas.tsx`).
- [x] T-4 (F-LOOK-6, F-LOOK-7): popovers that measure themselves and stay inside the window; the realtime hub and the reload onto a newly deployed build (`components/ui.tsx`, `lib/live.ts`).
- [x] T-5 (F-SIDE-1, F-SIDE-2, F-SIDE-4, F-SIDE-5): the sidebar of boards with counts, the review dot, inline create and rename, the board menu (description, duplicate with files and links, export, delete), find past seven boards, and collapse (`components/Sidebar.tsx`, `components/BoardForm.tsx`).
- [x] T-6 (F-SIDE-3): board delete with the "Delete this board?" confirmation, cascading to its cards and links (`boards.delete`).
- [x] T-7 (F-SIDE-6, F-SIDE-7): the settings popover (workspace name, link previews) with the install-time name from `setup.json`, and the first-board screen (`lib_settings.js`, `App.tsx`).
- [x] T-8 (F-CNV-1, F-CNV-2, F-CNV-5): the dotted stage with pan, wheel and pinch zoom around the pointer, fit, zoom controls, eased glides and the saved last view (`board/canvas.tsx`, `boards.update --viewport`).
- [x] T-9 (F-CNV-3, F-CNV-4, F-CNV-6, F-CNV-7): the minimap, the link legend, the empty-board state and "This board is not here" (`board/Overlays.tsx`, `board/BoardPage.tsx`).
- [x] T-10 (F-CRD-1, F-CRD-6, F-CRD-7): the eight kinds of cards drawn as map nodes with kind stripe, caption and marks, in-place note and section editing, media players and the PDF viewer (`board/CardView.tsx`, `components/Media.tsx`).
- [x] T-11 (F-CRD-2): adding from the tools (click or drag), Add, a double click, N, dropped files, a dragged address and paste; kind detection from address or file (`board/BoardPage.tsx`, `lib_add.js`, `lib_cards.js`).
- [x] T-12 (F-CRD-3, F-CRD-4): the Add dialog with the kind and board pickers, live preview, file drop zone (200 MB), tags and inline errors; Ctrl Enter adds (`components/AddCard.tsx`).
- [x] T-13 (F-CRD-5): drag to move (selection together, sections carrying their cards), corner resize and arrow-key nudges, saved through `cards.move` with optimistic positions.
- [x] T-14 (F-CRD-8): the trash with the 8 s Undo bar and Ctrl Z (`cards.delete`, `cards.restore`), and the hourly `rb_trash` job (`hooks.pb.js`).
- [x] T-15 (F-CRD-9): duplicating cards with the links among them (`cards.duplicate`, Ctrl D).
- [x] T-16 (F-INS-1, F-INS-2, F-INS-3, F-INS-4): the inspector docked on the right (a bottom sheet on phones): content, title, address, text, source, star, color, tags, links with keep and reject, open the source, duplicate, move or copy, delete (`components/CardPanel.tsx`).
- [x] T-17 (F-INS-5, F-AGT-4): the Summary section (Summarize, follow, cancel, ask again, remove, failure) and the `digests_waiting` trigger with its playbook (`ops_agent.pb.js`, `lib_agent.js`).
- [x] T-18 (F-LNK-1, F-LNK-2, F-LNK-5): linking by dragging a card's top dot, the kind picker, curved links with arrowheads colored by kind and labels, one link per pair (`board/BoardPage.tsx`, `lib_links.js`).
- [x] T-19 (F-LNK-3, F-LNK-4): the link panel (kind, label, flip, remove) and proposed links dashed and flowing until kept or rejected (`board/Panels.tsx`, `links.decide`).
- [x] T-20 (F-SEL-1, F-SEL-2, F-SEL-3): click, Shift click, Shift drag area (also inside sections) and Ctrl A; the selection panel (group in a section, tidy, tag, move or copy to a board, duplicate, delete) with transactional bulk operations (`board/Panels.tsx`, `ops_cards.pb.js`).
- [x] T-21 (F-FND-1, F-FND-2): find on the board with dimming and match stepping, and the kind filter with counts (`board/BoardPage.tsx`).
- [x] T-22 (F-REV-1, F-REV-2, F-REV-3, F-AGT-5): "Ask your AI agent to review" with focus, the toolbar status, the review panel with keep all and reject all, review again and dismiss, and the `reviews_waiting` trigger with its playbook (`board/Review.tsx`, `ops_agent.pb.js`).
- [x] T-23 (F-TAG-1): the tag editor with suggestions in the Add dialog, the inspector and the selection panel; tags cleaned to at most 20 per card (`components/ui.tsx`, `lib_cards.js`).
- [x] T-24 (F-EXP-1): Markdown export of a board (`lib_export.js`, `boards.export`).
- [x] T-25 (F-AGT-6, F-AGT-7): the minute job `rb_agent` that re-asks waiting work and settles work the agent left (4 quiet minutes or 20 minutes) (`lib_agent.js`, `hooks.pb.js`).
- [x] T-26 (F-AGT-8): record hooks for links, tags and colors that hold for every writer (`lib_rules.js`, `hooks.pb.js`).
- [x] T-27 (F-AGT-1, F-AGT-2, F-AGT-3, F-AGT-9): the 43 operations in `operations.json`, served to agents by `a2app_routes.pb.js` through the same handlers the View calls; `app.guide`, `summary.home`, `cards.preview` and file paths for the agent; destructive operations through the adapter's approval (`lib_guide.js`, `lib_summary.js`, `lib_unfurl.js`).

## Verification
- [x] Framework-files check (`validateFrameworkFiles` of the Agent App CLI) reports no problems for manifest.json, operations.json, AGENT_APP.md, reference/requirements.md and reference/tasks.md.
- [x] ## Operations Design in reference/requirements.md lists exactly the 43 operations of operations.json, each under its declared module.
- [ ] Agent App Framework gate (`agent-app <dir> validate`) passes, including the describe budget on a dev instance.
- [ ] Every declared operation answers through `a2app` on a live instance.
- [ ] The View renders identically to the published build (screenshot comparison).
