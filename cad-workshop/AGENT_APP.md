# CAD Workshop

> Per-project plan, context and index. Keep it current with every change.

## What this app does

Design real, editable parts for 3D printing and machining. A part is a
feature tree (sketch, extrude, revolve, primitive, hole, fillet, chamfer,
shell, push/pull, linear and circular pattern, mirror, boolean, transform,
STEP import) driven by named parameters, built by the OpenCascade kernel on
this computer. The workspace works like desktop CAD: a toolbar across the
top (every tool with its shortcut), the parameters and the feature tree on
the left, the model in the middle, and on the right the selection or the
part, spec checks, the history and a thread with your AI agent. A tool opens
as a small dialog over the model: clicks in the view fill it, drag handles
on the model set its values (with a box to type the exact number), and the
model shows a live preview; OK makes it one change. Sketches are drawn
directly on their plane with snapping and typed sizes. Every edit is one
change in a journal: undo, redo, revert any batch, and see what a batch
added and removed on the model. Exports: STEP (re-read and checked), 3MF and
STL for slicers, GLB for viewers.

An AI agent operates the app through the `agent-app` CLI with the same
operations the UI calls, and the app hands work back through three triggers
(design a part or a change, fix a failed build, review for a process). The
app names no particular agent: the UI says "your AI agent", and what the
agent records is marked `agent`.

**Start every agent session with `agent-app run <project> app.guide`**: it
returns the conventions (mm, degrees, Z up, Front looks from -Y), the
reference grammar, the error codes, the feature kinds, the materials, the
parts, and recipes: start a part, a plate with four corner holes, change a
dimension, round the edges the person selected, find keys, measure, look at
it, spec checks, compare before and after a batch, a build failed, bring in
a vendor part, export for printing or CAD, undo.

## Requirements

See `reference/requirements.md` (binding). Feature checklist:

- [x] Home: greeting with New part and Ask your AI agent, parts building or failing, recent parts, requests, latest changes, the engine; a first-time card
- [x] New part: made at once as "Part N" and opened (renamed in place; material and color in the part panel); an empty part offers Sketch, Box, the starters (block, mounting plate, open box, round boss, all real parametric features) and Describe it
- [x] Parts: cards with thumbnails, search, pinned / not building / archived filters, sort, duplicate, pin, archive, delete
- [x] Toolbar: Sketch (S), Extrude (E), Revolve, Box, Cylinder, Sphere, Push/pull (Q), Fillet (Shift+F), Chamfer (Shift+C), Shell, Hole (H), Pattern, Circular, Mirror, Combine, Move (M), Import; a dot marks the tools the selection is ready for; Ctrl+K finds a tool
- [x] Tool dialog (floating over the model): the fields that matter first, the rest under More options; the active pick field fills from clicks in the view (box select adds many; for pattern and mirror a face picks the feature to repeat and a straight edge the direction); drag handles with typable value boxes (extrude distance, revolve angle, push/pull, fillet radius, chamfer distance, shell thickness, hole depth and positions, box sizes and position, cylinder height and diameter, sphere diameter, a move gizmo with X/Y/Z arrows and a turn handle); a ghost while dragging and a live dry-run preview after; volume delta; plain-language errors with a tip; Enter is OK, Esc cancels
- [x] Sketch mode: pick an origin plane or a flat face; the camera faces the plane and the model goes see-through; Line (closing on the start makes an outline), Rectangle, Circle, Slot, Polygon, Construction line; snapping to ends, centers, midpoints, alignments, horizontal/vertical and a zoom-following grid (Alt off); typed sizes while drawing (Tab, Enter); dimension labels on the canvas that take numbers or expressions; handles that reshape items; dragging a segment's middle bends it into an arc; local undo; Finish goes straight on to Extrude
- [x] Workspace: parameters edited in place (expressions, arrow keys, drag the name to scrub, sliders for bounded ones); feature tree with plain names ("Extrude 1"), status and author: click lights up its geometry, double click edits, right click for edit / rename / turn off / roll back / delete, drag to reorder, eye to turn off; a thick rollback bar; bodies with eye toggles
- [x] Viewer: a click adds to the selection and a second click removes it (empty space clears), left drag box-selects, right drag turns around the point under the pointer, middle drag pans (three mouse schemes), Alt-click cycles what is under the pointer, double click edits the feature, right click opens a menu (sketch on face, push/pull, hole, shell, fillet its edges, select its edges, tangent chain or similar faces and edges, look at, edit, hide or show only a body); Delete removes the feature picked in the tree; hover readout in plain words; selection shared with the agent; section plane, see-through, hide bodies, measure line, compare overlay, all seven standard views, navigation cube, fit, perspective or orthographic, full screen; colors from the theme; renders only on change
- [x] Right panel: part (size, volume, area, mass, bodies, validity, material, color, last build, build errors with "edit it", "show candidates" and "ask to fix"), selection (plain labels, quick tools, measurements kept as checks in one click), checks, history (revert, show what changed), your AI agent (this part's requests as a thread, ask for a change, a review or a fix)
- [x] Undo and redo (Ctrl+Z, Ctrl+Shift+Z), revert any batch, compare a batch on the model
- [x] Export dialog (STEP checked by re-reading, 3MF, STL, GLB; mesh quality Draft / Normal / Fine) with download and path; Exports page with filters, "part changed since", delete
- [x] Activity: every batch across parts with revert
- [x] Requests: design, fix and review requests with status and the agent's answer
- [x] Settings: display unit, navigation (three mouse schemes), projection, grid, materials and densities, agent build wait, engine status, engine test, clean old builds
- [x] Phone, tablet and desktop layouts (tabs Model / Tree / Details below 1024 px); compact visual system (28 px controls, hairline panels, small corners, dense tables)
- [x] Every UI action has a CLI operation

## Entities

Lengths are millimetres and angles degrees everywhere; inches are a display
choice. Numbers in feature params are a plain number or `{"expr": "..."}`
of the part's parameters.

| Collection | Purpose | Notes |
|------------|---------|-------|
| settings | One row: `display_unit` (mm, in), `navigation` (right_rotates by default, middle_rotates, left_rotates), `projection`, `show_grid`, `default_material`, `materials` (name, density g/cm3), `agent_wait_s` (0 to 25), `last_prune_at` | Seeded; changes only through `settings.update` |
| parts | `name`, `description`, `material`, `density`, `color` (neutral, accent, blue, green, amber, red, violet, graphite), `tree_hash`, `rollback_after`, `status` (empty, queued, building, ok, warning, failed), `thumbnail`, `current_build`, `pinned`, `archived`, `origin` (you, agent, import), `notes` | `status` and `current_build` follow the builds |
| parameters | `part`, `name` (identifier), `kind` (length, angle, count, ratio), `expr`, `value` (evaluated), `bounds`, `comment`, `author`, `sort`, `error` | Cycles and unknown names refused |
| features | `part`, `seq`, `name` (identifier), `kind` (15 kinds), `params` (checked by `lib_kinds.js`), `suppressed`, `author`, `status` (pending, ok, warning, error, suppressed, rolled_back, not_built), `error`, `warnings`, `ms`, `faces`, `note` | A feature may only use what was made before it |
| builds | `part`, `input_hash`, `status` (queued, running, ok, warning, failed, cancelled), `requested_by`, `preview` (dry run), `tree` (the exact input), `started`, `finished`, `ms`, `view` (view.bin), `topology` (JSON), `thumb`, `summary`, `features`, `error`, `checks`, `cached`, `triangles`, `note` | Coalesced per part; pruned when no longer current (see Background jobs) |
| changes | `part`, `batch`, `actor` (you, agent, system), `action` (add_feature, update_feature, move_feature, delete_feature, set_parameter, delete_parameter, roll_to), `target`, `target_id`, `before`, `after`, `hash_before`, `hash_after`, `note`, `reverted_by`, `reverts`, `ord` | The journal; a batch reverts as a new batch |
| exports | `part`, `build`, `format` (step, stl, 3mf, glb), `file`, `name`, `bytes`, `triangles`, `tolerance`, `verified` (STEP re-read), `input_hash`, `requested_by`, `pinned` | |
| selections | `part`, `keys`, `set_by` | One per part; what the person or the agent points at |
| checks | `part`, `name`, `kind` (bbox_x, bbox_y, bbox_z, volume, area, mass, solid_count, valid, distance, center_distance, radius, face_count, fits_within), `refs`, `op` (eq, le, ge, between), `target`, `target_max`, `tolerance`, `box`, `author`, `result` (pending, pass, fail, cannot_run), `value`, `detail`, `build`, `sort` | Re-run on every build |
| assets | `part`, `name`, `kind` (step), `file`, `bytes`, `hash` | Files for `import_step` |
| briefs | `part`, `kind` (design, repair, review), `title`, `body`, `selection`, `status` (sent, working, done, failed), `result`, `request_id` | Requests to the AI agent; status only moves forward |
| compares | `part`, `from_build`, `to_build`, `batch`, `added`, `removed` (view.bin of the material), `added_mm3`, `removed_mm3`, `before_mm3`, `after_mm3` | |

Every collection is written only through the operations (`hooks.pb.js`
refuses direct API writes and names the operation to use).

## Operations

45 operations in `operations.json` (`agent-app ops <project>`):
`app.guide|status`; `settings.get|update`; `jobs.run` (prune, requeue,
engine_start, engine_test, engine_install); `parts.list|get|create|update|duplicate`;
`params.set`; `features.schema|add|update|move|roll-to`; `edits.batch`;
`builds.get|run|cancel`; `model.describe|measure|properties|check`;
`refs.resolve`; `views.render`; `compare.builds`; `exports.create|list`;
`changes.list|revert`; `selection.get|set`; `checks.list|save|run`;
`assets.add|list`; `requests.create|list|get|update`; `records.delete`
(every record type, with a preview).

Edits answer one envelope `{ ok, status, part, change, build, delta,
summary, features, warnings, error, hints }` with `status` applied, failed,
queued, reverted, unchanged or dry_run. An edit by the agent waits for its
build (`wait_s`, default from settings) and is reverted when the build
fails because of it (`on_fail=keep` keeps it); `dry_run=true` builds
without saving; `expected_hash` refuses an edit when the part changed
meanwhile.

Routes live in `pb/pb_hooks/ops.pb.js`; logic in the `lib_*.js` modules
(required inside each handler): `lib_tree.js` (tree, hashing, the one
transactional `mutate`), `lib_edit.js` (edits), `lib_kinds.js` (feature
schemas), `lib_expr.js` (expression grammar), `lib_builds.js` (queue,
worker, adopt), `lib_engine.js` (the engine process), `lib_setup.js` (the
engine's first-run download), `lib_changes.js`
(journal, revert), `lib_parts.js`, `lib_model.js` (describe, measure,
render, compare), `lib_exports.js`, `lib_misc.js` (settings, selection,
checks, assets, requests, status, jobs), `lib_delete.js`, `lib_guide.js`,
`lib_rules.js`, `lib_util.js`.

## The geometry engine

`engine/` holds an embedded CPython 3.11.9 (`python/cad-engine.exe`) with
OCP 8.0.1 (OpenCascade 8.0.1), numpy and Pillow in `site-packages/`, and the
app's engine code in `cad_engine/` (features, sketches, naming, references,
measurements, tessellation to view.bin, STEP / STL / 3MF / GLB writers, a
small rasterizer for `views.render` and thumbnails). Provenance, versions
and licenses: `engine/licenses/NOTICE.md` (with the license texts).

- One long-lived process per data folder, started on the first job (or by
  `jobs.run job=engine_start`, which the workspace calls when it opens),
  exits when PocketBase is gone, on `<data>/cad-engine/stop`, or after 20
  idle minutes. Load takes about 1.5 s warm and 10 s or more from a cold disk.
- Jobs are JSON files: `<data>/cad-engine/inbox` to `outbox`, written to a
  temporary name and renamed. Both sides retry file access for a few seconds,
  because Windows briefly refuses a file a virus scan is reading; a job the
  engine cannot read is answered with an error, never dropped.
- Built features stay cached in memory: the key of feature k hashes feature
  k-1's key, feature k's canonical JSON and the engine version, so editing a
  feature rebuilds only from there.
- Face keys come from OCCT's own history (`ext1.cap_end`,
  `ext1.side.r1.top`, `fil1.blend.3`, `shell1.inner.<key>`, `@pat1.2` for
  copies, `~n` for pieces of a split face); edge keys join two face keys with
  `|`. References are selectors with an `expect` count; a mismatch fails the
  build with `stale_reference`, the counts and the candidates, never a guess.
- The engine folder is part of the app folder (about 250 MB). It is not
  built by the frontend build and not in backups (backups hold `pb_data`).
- First run: only `cad_engine/` and `licenses/` ship with the app.
  `lib_setup.js` (cron lane `cad_engine_setup`) downloads the rest once,
  about 79 MB, pinned by URL, size and SHA-256: the CPython 3.11.9
  embeddable zip from python.org and the cadquery-ocp-novtk / -proxy
  8.0.1.1.0, numpy 2.4.6 and pillow 12.3.0 wheels from PyPI. Each download
  is checked before it is unpacked (Windows' own curl.exe, certutil.exe,
  tar.exe), unpacked into `engine/.download/` and moved into place folder by
  folder; `python.exe` becomes `cad-engine.exe` and `python311._pth` is
  written as NOTICE.md says. It starts by itself within a minute of the first
  boot (never in a `CRAFTBOT_APP_ENV=shadow` boot), resumes a partial
  download, and after a failure waits for `jobs.run job=engine_install` (the
  Retry button on Home and in Settings). `app.status` → `engine.setup` gives
  `{ state: ready|pending|downloading|installing|failed|off, step,
  done_bytes, total_bytes, error }`. While it is on its way, builds stay
  queued (the worker and waiting edits do not run them; an edit answers
  `queued` at once with a hint) and run when it finishes; other engine calls
  answer `engine_unavailable` with the progress in the message.

## The workspace (frontend)

- `components/viewer/engine.ts` (lazy chunk with three.js): the model, picking (faces, edges, sketch profiles, origin planes), the pointer state machine (click, box, orbit around the picked point, handle drag, sketch pointer, Alt-click cycling, double click, right click), x-ray, hidden bodies (a per-vertex `aHide` flag the shaders discard, not geometry groups, which fight the BVH), ghosts (prism, box, cylinder, sphere, a face swept along its normal), sketch mode (plane grid, curves, points). `handles.ts` (arrows and plane points, constant screen size, drawn on top), `overlays.ts` (sketch and region geometry), `frames.ts` (plane frames without three.js).
- `components/workspace/tools.ts`: per tool, the fields up front, the pick field, the handles and what a drag writes, the ghost, starting values from the selection, tangent chains and face boundaries from the topology. `ToolDialog.tsx` renders it; `pages/Part.tsx` owns the tool state, routes picks into the active field, runs the debounced dry run (300 ms; 450 ms while dragging; ghost tools wait for the drag to end) and shows its preview model.
- `components/workspace/SketchMode.tsx` (a hook giving the palette, the toolbar, the properties panel and the canvas labels) with `lib/sketchGeom.ts` (outlines, hit tests, snap points, dimensions, handles, moves, regions), all in plane coordinates matching the engine's sketch items.
- `Toolbar.tsx`, `ContextMenu.tsx`, `AgentPanel.tsx`, `Tree.tsx`, `Panels.tsx`, `fields.tsx` (pick fields, numbers with arrow-key steps; help text is the label's tooltip).
- Names on screen: `lib/keys.ts` reads our structured keys ("Side face of Extrude 1"); feature titles come from the schema's `name_labels` (ext reads Extrude). Raw keys only go to the clipboard for the agent. `lib/errors.ts` turns error codes into a title and a tip per feature kind (keyed by code, never by message text).
- The topology file a build writes carries `sketches` (loops and construction lines per sketch, with the plane frame), edge `ends` and a `frame` per flat face; the viewer and the tools depend on them.

## Builds

Every edit queues a build of the part's new input or reuses one with the
same input hash (current, queued or finished, which makes undo instant).
The cron worker `cad_builds` (every minute) runs builds and then waits on a
wake flag until second 59, so it never polls; an op that waits for its build
runs the queue itself when no worker is up. A build becomes the part's
current build only if the tree still has its hash when it finishes. Saving a
build retries for a moment and otherwise records a failure, so a build never
stays running. Builds interrupted by a restart are queued again on boot.

## Agent triggers

| Trigger | Fired when | What the agent does |
|---------|------------|--------------------|
| `design_requested` | A design request is sent from the app (Ask your AI agent) | Reads the request (`requests.get`), designs or changes the part with parameters and features, turns stated numbers into checks, looks at it once, reports with `requests.update` (or asks back when a dimension is missing) |
| `repair_requested` | "Ask your AI agent to fix it" on a failed build | Reads the build error, fixes only what failed (dry runs first), confirms the build and the checks, reports |
| `review_requested` | "Ask for a review" (3D printing, resin, 3-axis CNC or general) | Measures and inspects the part for the process and reports findings; never changes the part |

Each trigger needs one approval in CraftBot before it can run.

## External data

None at run time. Everything comes from the person, the AI agent, or STEP
files added to a part. The only downloads are the engine's one-off first-run
setup (www.python.org, files.pythonhosted.org; see The geometry engine).

## Background jobs

- `cad_builds` (every minute): the build worker (above). At most once an hour it also prunes builds that are no longer current: finished ones after a day, previews and cancelled ones after an hour.
- `cad_engine_setup` (every minute): the engine's first-run download (`lib_setup.js`); returns at once when the engine is in place.

## Gotchas

- Hooks do not hot-reload (`--hooksWatch=false`): restart the app after any hook change. Engine code changes take effect when the engine restarts (it stops with the app).
- Inside `mutate` / `runInTransaction` use only the transaction handle; `$app` or `e.app` there deadlocks the process.
- The agent-app CLI sends every param as a string; `lib_util.js` readers accept strings and real JSON alike and answer a 400 with a valid example.
- The UI subscribes to all collections once at startup (`lib/live.ts`); the SDK drops subscriptions made during its first connection.
- The viewer's BVH is built in indirect mode: the index buffer must keep its order, since each face is a range of triangles (picking and highlighting depend on it).
- The key light rides with the camera and so does its target; with the target at the world origin the light becomes a headlight and every face shades the same. The hemisphere light points along +Z (Z is up).
- Colors: `lib/themeColors.ts` derives every `--cw-*` color from the kit theme tokens with contrast checks, re-derived on every theme change; the viewport palette (stage, bodies, edges, selection, compare, axes) comes from the same place, and swatches and legends use `useViewportPalette()` so they match the 3D view. Never hardcode a color in components.
- The visual system is compact: build screens from `components/ui.tsx` (Panel, PropSection, Button, IconButton, ButtonGroup, Badge, Segmented, Tabs, Select, Field, inputCls, menuItem, Stat) and `components/PartsTable.tsx`. Corners come from the `--cw-r-sm|r|r-md|r-lg` tokens (4, 6, 8, 10 px); `rounded-full` only on status dots, color swatches, switches, slider knobs and count badges. Dense tables use the `.cw-table` class (theme.css); dividers inside panels use `--cw-hair`.
- Headless test browsers render WebGL in software: a screenshot started while shaders compile can hang; retry it.
- Stored topology files keep the shape of the engine that wrote them. After the topology format changes, force a rebuild of every part (`builds.run force=true`; builds are derived data) instead of making the frontend accept the old shape.
- PocketBase 0.39 JSVM: `tx.delete(rec)` panics (nil pointer, a 500 that escapes try/catch) when `rec` came from `findRecordsByFilter`; delete a record read by id (`tx.delete(tx.findRecordById(col, rec.id))`). Every delete in the hooks does this.
- `compare.builds` on a part's first batch compares against nothing (no build exists for the empty part); the features before a batch = features now minus the net adds of that batch and every later one.
- Arrow handles can carry a `lead` (screen pixels past their value) so a move gizmo keeps a fixed on-screen size; a handle drag subtracts the grab offset so grabbing the head does not jump the value.
- Keep three.js out of the main bundle: outside `components/viewer/` import only types from `engine.ts` and `overlays.ts`; plane frames come from `frames.ts`.
- In sketch mode the canvas labels take clicks only with the Select tool; with a drawing tool they are display-only, so a click on the canvas always draws.

## Ownership map

- Editable: `frontend/src/app/`, `pb/pb_migrations/` (new files only), `pb/pb_hooks/*.pb.js` and `lib_*.js` (not the `_*.js` system files), `operations.json` (non-system entries), `triggers.json`, `engine/cad_engine/`, this file, `reference/`.
- Vendored (downloaded on first run; change only by changing the pins in `lib_setup.js` as a whole, keep `engine/licenses/` in step): `engine/python/`, `engine/site-packages/`.
- System-managed (never edit): `frontend/src/kit/`, `frontend/src/main.tsx`, `frontend/src/config.gen.ts`, the underscore hooks (`pb/pb_hooks/_*.js`), `manifest.json`.
