# Image Utility

> Per-project plan, context and index. Keep it current with every change.

## What this app does

Quick, careful image work on this computer: crop and straighten, resize,
frame on a canvas, adjust light and colour, apply a look, cut out the
background, and mark it up with layers (text, arrows, lines, boxes,
ellipses, highlights, numbered steps, pen drawings, redactions, logos and
watermarks, placed or tiled), each one moved, resized, turned, restacked,
hidden or locked on its own; then export
small files (WebP, AVIF, JPEG, PNG, GIF, ICO, TIFF) with real file sizes,
a quality comparison at 100 % and control over metadata and location. One
image at a time in a desktop-editor workspace, or a whole selection as a
batch with a recipe, a rename pattern and a preview before it runs.

Edits are non-destructive: an image is its untouched original plus an
ordered stack of edits, rendered by a local image engine (Pillow, MozJPEG,
oxipng, AVIF; optional ONNX background removal). Every edit stays
changeable, can be turned off or reordered, and every change is undoable
(undo, redo, revert any batch). A layer is an edit of kind `layer`, so it
shares the history, undo, proposals and journal; the engine draws the
layers over the photo's own edits, bottom first.

The workspace follows CAD Workshop's design: a toolbar of labelled tools
with shortcuts, the edit stack and the library on the left, the stage in the
middle (zoom and pan, checkerboard, full-resolution tiles past the preview,
hold `\` for the original), and on the right the image's facts and
histogram, Export, History and the AI agent. A photo tool opens as a small
dialog over the stage; tone and size tools preview the whole result live,
crop draws its box on the image as it enters the edit. Layers are drawn
live over the photo and edited in place, as in a design tool; the selected
layer's properties float over the stage on the side away from it.

An AI agent operates the app through the `agent-app` CLI with the same
operations the UI calls. By default its edits are **proposals** the person
previews, accepts or rejects (it can never change the person's edits), and
its batches wait for the person to run them; Settings can let it edit or
run directly. The app hands work back through two triggers (edit images,
describe images). The UI says "your AI agent"; what the agent does is
marked `agent`.

**Start every agent session with `agent-app run <project> app.guide`**: it
returns the conventions (coordinates, the stack, dry runs, metadata), every
edit kind's params, error codes, the policy, presets, logos, recent images
and recipes: bring images in, look at an image, straighten and crop, make
it web-ready, fit an email limit, polish a screenshot, cut out a product,
social sizes, favicons, same edits on other images, process a folder,
describe images, undo, see what changed in quality.

## Requirements

See `reference/requirements.md` (binding). Feature checklist:

- [x] Home is the library and nothing else, filling the page: a top bar (search, All / Edited / Untouched / Proposals, sort, large or small cards, Add images), an "Add images" tile first, then every image as a card with its result, name, format, size, file size and where the original lives (the path it was imported from, or the app's kept copy for uploads); images with a proposal from the agent are marked (the rail's Library entry carries the proposals count)
- [x] Import from anywhere: the rail's Import (drop zone, choose files, a file or folder path on this computer), the Add images tile, drop files on any page, paste an image (Ctrl+V); one image opens, several go to the library; HEIC and RAW refused with a reason
- [x] Workspace toolbar: photo tools Crop (C), Left ([), Right (]), Flip (H), Resize (R), Canvas (B), Adjust (A), Auto (Shift+A), Filter (F), Cut out (K); then the layer tools Select (V), Text (T), Arrow (L), Line (Shift+L), Box (U), Ellipse (E), Highlight (M), Step (N), Pen (P), Redact (X), Logo (G); rotations fold into one rotate-only crop
- [x] Tool dialog over the stage, saving as you go: no Apply or Cancel; the first real change adds the edit and later ones update it (sliders and typing a moment after they stop, drags when they end, choices at once); a tool brought back to doing nothing removes its edit; cut out runs on opening; undo and redo in the dialog's bar (they also bring the open tool back in step); the cross or Esc closes; crop shows the image as it enters the edit (layers hidden while you crop); "Result W × H", warnings, plain-language refusals
- [x] Crop: ratios (free, original, 1:1, 4:5, 4:3, 3:2, 16:9, 9:16, 2:3, 21:9, swap), drag the box (8 handles, ratio-locked, draw a new one outside it), rule of thirds, typed width and height, Find the subject (smart crop), straighten −45..45° (the box stays inside), quarter turns, flips
- [x] Resize: longest edge, exact size (proportional or not), percent, fit in a box, fill a box keeping the subject; social and web sizes; never enlarges unless asked; resampling (Lanczos, sharper MKS2021, bicubic, bilinear, nearest for pixel art); light sharpening after a shrink
- [x] Canvas: padding (all or each side), pad out to a ratio, colour / gradient / blur / transparent background, rounded corners, shadow
- [x] Adjust: Auto (levels, midtones, white balance), exposure, contrast, highlights, shadows, whites, blacks, temperature, tint, vibrance, saturation, clarity, sharpen, vignette; double-click resets a slider; filters: 12 looks with previews of this image and a strength
- [x] Layers on the stage: pick a layer tool and drag (or click, for text and steps); text is typed in place (Enter or a double-click types into a text layer again); click a layer to select it, drag to move it (Shift locks the axis), 8 handles resize it (corners only and in proportion for text, steps and logos; Shift keeps proportions), the round handle turns it (Shift snaps to 15°), arrows and lines have a handle at each end (Shift snaps to 45°); arrow keys nudge (Shift for 10 px), Delete removes, Ctrl+D duplicates, Ctrl+] / Ctrl+[ bring forward and send backward (with Shift to the front and back), Esc lets go; pens and steps keep drawing, the other tools hand back to Select; steps number themselves; locked layers cannot be dragged; drawn live in the browser (redactions pixelate or blur the photo on screen too), the engine draws the same layers for exports, thumbnails and the agent
- [x] Layers list (left panel, top layer first): click to select, drag to restack, eye to hide or show, lock, double-click to rename, bin to delete, the agent's layers marked; the photo and its own edits listed under the layers
- [x] Layer properties (floating panel): text (words, font, size, alignment, colour, label box behind, outline), stroke colour and width, fill and its opacity, corner radius, highlighter colour, step number and colour, arrow at both ends, redaction solid (the safe one, said so) / pixelate / blur, logo (pick or upload in place), tile across the image with a gap (text and logos: watermarks), opacity, rotation, pinned to the photo (follows crops and turns) or the frame (stays put: watermarks, captions), order, lock, hide, duplicate, delete; the colour, font and redaction style you set are used for the next layers
- [x] Remove background: fast or detailed model on this computer (installed on request, with progress), transparent or a colour behind, soft or hard edge, grow or shrink the edge
- [x] Edit stack (under the layers): from the original down, click to edit (the tool opens on that edit), drag to reorder, eye to turn off, bin to remove, the agent's edits marked; menu (it flies out over the stage): apply a recipe, save the edits as a recipe, copy the edits to other images (scaled), back to the original; the agent's proposals on top with Preview on the image, Reject (with a reason it reads, typed in the card) and Accept
- [x] Stage: wheel or pinch zoom around the pointer, drag or Space or middle button to pan, Fit (0), 100 % (1), 200 % (2), + and −, zoom menu, full-resolution tiles past the preview, checkerboard / light / dark backdrop, full screen, the pixel under the pointer, hold `\` or the Original button for the original
- [x] Inspector: Image (result size, histogram with clipping, the original file's format, size, colour, profile, frames, DPI, source; camera data; location with what export does to it; name, title, alt text with a 125-character guide and "ask your AI agent to describe it", keywords, notes, pin), Export, History (undo, redo, revert one change, what each change did), Agent (ask for an edit, optionally pointing at a region drawn on the image, or a description; quick asks; this image's requests and answers)
- [x] Export: presets (Web WebP, AVIF + JPEG, email under 500 KB, print, lossless PNG, retina 1x/2x, favicon set) or custom; several outputs at once; per output format, quality (best, balanced, small, custom, max KB, lossless), longest edge, file name suffix, PNG effort, ICO sizes; real encoded sizes with the saving against the original and the quality a size target chose; compare before and after at 100 % (split slider); metadata basic / everything / none, remove the location, JPEG background for transparency; file name; also copy to a folder; downloads; save as a preset; exported before
- [x] Batches: New batch from picked images; start from each image's edits or not, then a recipe or a size; an export preset or format, quality, longest edge; metadata; rename pattern with tokens; folder with collision handling; plan and preview (every file name, duplicates, files already there, test encodes, estimated total); run in the background with progress; stop, resume, retry the failed, download all as a zip, show the files; the agent's batches wait for Run or Reject
- [x] Exports page: every file with size, saving, where it was copied, who made it; filter by format or batch; download, delete
- [x] Requests page and Activity page (every change by day, revert)
- [x] Settings: the engine (state, folder) and the two background models (install with progress, retry), export defaults, the AI agent's policy (propose or edit; plan or run batches; house rules; the folder it may write to), presets (recipes, export, sizes; add sizes; delete your own), logos, keyboard shortcuts
- [x] Phone, tablet and desktop layouts (Image / Layers / Details tabs below 1024 px); the CAD Workshop visual system; light and dark from the host theme
- [x] Every UI action has a CLI operation

## Entities

Coordinates are full-resolution pixels of the image as it enters an edit.
Only crop, resize and canvas change the size; `lib_geom.js` (hooks),
`geom.ts` (workspace) and `geom.py` (engine) compute it the same way
(checked on 3,000 random stacks).

Layers are the exception: a layer is pinned to the **photo** (its numbers
are pixels of the original photo; it follows crops, turns, straightening,
resizes and canvas padding) or to the **frame** (`anchor: "frame"`;
positions are fractions of the result's width and height, sizes fractions
of its short side; it stays put). Every render reports `transform`, the
affine map from original photo pixels to result pixels, which the engine,
the hooks (`lib_layers.js`) and the workspace (`lib/layers.ts`) use to
place layers. `layers.add` and `layers.update` take numbers in result
pixels by default (`space=layer` for the layer's own space) and
`layers.list` gives each layer `in_result`.

Layer types and their params (all: `name`, `opacity`, `locked`, `anchor`;
shown or hidden is the edit's `enabled`): boxes (`rect`, `ellipse`,
`highlight`, `redact`, `logo`, `pen`) have `cx`, `cy`, `w`, `h`,
`rotation` (degrees clockwise about the centre); `text` has `cx`, `cy`,
`size`, `rotation`, `text`, `font`, `color`, `bg`, `outline`, `align`,
`tile`, `gap`; `step` has `cx`, `cy`, `size`, `n`, `color`; `arrow` and
`line` have `x1`, `y1`, `x2`, `y2`, `width`, `color`, `both`; `pen` adds
`points` (in −0.5..0.5 of its box); `redact` has `mode` (solid, pixelate,
blur); `logo` has `asset`, `tile`, `gap`; `rect` and `ellipse` have
`width`, `color`, `fill`, `fill_opacity`, `radius`.

| Collection | Purpose | Notes |
|------------|---------|-------|
| settings | One row: `defaults` (format, quality, metadata, strip_gps, matte, effort, resample), `policy` (agent_edits propose/apply, agent_batches propose/run, house_rules), `export_folder` | Policy and export folder are the person's (`person_only`) |
| images | `name`, `original` (file, kept untouched), `source_path`, facts read by the engine (`format`, `width`, `height`, `bytes`, `frames`, `duration_ms`, `alpha`, `mode`, `icc`, `wide_gamut`, `exif`, `gps`, `dpi`, `hash`), `status` (pending, ready, failed), `error`, `preview` (cache key), `thumb`, `out_width`, `out_height`, `edits_count`, `stack_hash`, `transform` (original photo pixels to result pixels), details (`title`, `alt_text`, `caption`, `keywords`, `notes`, `pinned`), `origin`, `last_exported`, `exports_count` | `pending` while the engine is being set up; read and rendered when it is ready |
| edits | `image`, `seq`, `kind` (crop, resize, canvas, adjust, filter, remove_bg, layer), `params` (checked by `lib_kinds.js`), `enabled`, `author`, `state` (active, proposed), `proposal`, `note`, `mask` (remove_bg), `mask_key`, `mask_info` | A remove_bg mask is made once per (image, upstream edits, model); layers are drawn after every photo edit, in stack order |
| changes | `image`, `batch`, `actor` (you, agent, system), `action` (add, update, remove, move), `edit`, `before`, `after`, `note`, `reverted_by`, `reverts`, `ord` | The journal; a revert is a new batch (hops: 0 edit, odd undo, even redo) |
| proposals | `image`, `kind` (edits, batch), `title`, `reason`, `status` (pending, accepted, rejected, superseded), `preview`, `summary`, `batch`, `decided_at`, `response` (the person's reason), `author` | The agent's edits under the propose policy |
| exports | `image`, `batch`, `file`, `name`, `format`, `width`, `height`, `bytes`, `source_bytes`, `settings`, `folder_path`, `requested_by` | Kept files; deleting an image keeps its exports |
| presets | `name`, `kind` (export, size, recipe), `description`, `data`, `builtin`, `sort` | 13 sizes, 7 export presets, 4 recipes built in |
| batches | `name`, `images`, `recipe` (use_edits, edits), `outputs`, `rename`, `collision`, `folder`, `status` (draft, proposed, queued, running, done, failed, cancelled), `cancel`, `total`, `done_count`, `failed_count`, `bytes_in`, `bytes_out`, `results`, `zip`, `started`, `finished`, `error`, `requested_by` | |
| assets | `name`, `file`, `kind` (logo), `width`, `height`, `bytes` | Logos for logo layers; one in use cannot be deleted |
| requests | `kind` (edit, describe), `image`, `images`, `title`, `body`, `region`, `status` (sent, working, done, failed), `result`, `request_id` | Status only moves forward |

Every collection is written only through the operations (`hooks.pb.js`
refuses direct API writes and names the operation to use).

## Operations

64 operations in `operations.json` (`agent-app ops <project>`):
`app.guide|schema|status|context|ui`; `settings.get|update`;
`engine.status|install|test`;
`images.list|get|info|render|import|update|duplicate|delete`;
`analyze.image`; `filters.previews`;
`edits.add|update|move|remove|apply|copy|reset`;
`layers.list|add|update|arrange|remove`;
`history.list|undo|redo|revert`; `proposals.list|accept|reject`;
`export.estimate|compare|create`; `exports.list|delete`;
`presets.list|save|delete`;
`batches.list|get|create|preview|run|cancel|retry|delete`;
`requests.create|list|get|update`; `assets.list|add|delete`.

Edit operations answer one envelope `{ ok, applied, proposed, batch, image,
stack, preview {url, path}, warnings, summary, edit, proposal, message }`;
`dry_run=true` renders without saving (`out` is the result size). An agent
under the propose policy gets `proposed: true` and its edits join one open
proposal per image (`title`, `reason`); changing or removing the person's
edits answers `agent_propose_only`. `images.render` takes `upto`,
`proposal`, `original`, `region` (full resolution), `draft` (one unsaved
edit on top: how the crop tool shows its rotated frame) and `layers=false`
(the photo without its layers, what the workspace draws them over), and
answers `transform`. The layer operations wrap the edit operations (same
envelope, proposals and history): `layers.add` (`type`, `props`, `anchor`,
`name`), `layers.update` (props merge, `null` resets a key; `name`,
`opacity`, `locked`, `anchor`, `visible`), `layers.arrange` (front, back,
forward, backward), `layers.remove` (`layer` or `layers`). Copying edits
to another image scales photo-pinned layers; recipes and batches take only
frame-pinned layers (a photo position means nothing on another photo); a
logo layer must name a logo from `assets.list`.

Routes live in `pb/pb_hooks/ops.pb.js` (plus `GET /api/img/cache/{path}`,
which serves rendered previews, filter thumbnails and compare crops by
content hash); logic in the `lib_*.js` modules (required inside each
handler): `lib_stack.js` (stack, journal, undo, proposals), `lib_kinds.js`
(params, summaries, schema), `lib_layers.js` (layer operations, result and
layer space), `lib_geom.js`, `lib_render.js` (render cache,
masks), `lib_images.js` (import, probe, refresh), `lib_export.js`,
`lib_batch.js` (plan, preview, worker lane), `lib_presets.js`, `lib_app.js`
(images, settings, status, screen, requests, logos), `lib_engine.js` (the
engine process), `lib_setup.js` (first-run download), `lib_guide.js`,
`lib_rules.js`, `lib_util.js`.

## The image engine

`engine/` holds an embedded CPython 3.11.9 (`python/img-engine.exe`) with
Pillow 13.0.0 (AVIF, WebP, Little CMS, FreeType built in), NumPy 2.4.6,
pyoxipng 9.1.1, mozjpeg-lossless-optimization 1.3.2 (+ cffi) and,
when installed, onnxruntime 1.31.1 with the u2netp / isnet-general-use
models; the app's engine code is `engine/img_engine/`. Provenance, versions
and licenses: `engine/licenses/NOTICE.md` (with the license texts).

- `img_engine/`: `render.py` (the photo's edits with a prefix cache in
  memory, editing edit k re-renders from k, while tracking the affine map
  from original photo pixels to the result through flips, turns,
  straightening, crop offsets, resizes and canvas padding; then the
  layers), `layers.py` (each layer drawn as a rotated, supersampled tile
  and composited bottom first; tiling for watermarks; redactions solid,
  pixelated or blurred under a rotated mask; logos), `geom.py`, `load.py`
  (sRGB, 16-bit and CMYK, EXIF orientation applied, JPEG draft loading for
  previews, probe, histogram), `tone.py` (LUT-based adjustments, 12 looks,
  Auto), `draw.py` (strokes, arrowheads and text supersampled 4x,
  redaction, canvas), `ai.py`
  (masks), `encode.py` (formats, named quality levels per codec, metadata
  policies, target size, palette PNG + oxipng, MozJPEG optimization,
  animation, ICO), `jobs.py` (render, export, analyze, mask, filters,
  compare, zip), `server.py` (the job loop).
- One long-lived process per data folder, started on the first job, exits
  with PocketBase or on `<data>/img-engine/stop`. Jobs are JSON files
  (`inbox` to `outbox`, written to a temporary name and renamed); absolute
  paths of 240 characters or more are passed in Windows' long form, so a
  deep app folder never looks like a missing file.
- Pipeline rules: the original is never written; colour is converted to
  sRGB on load and tagged on export; EXIF orientation is applied to the
  pixels and written as 1; metadata `basic` keeps camera, date, author,
  copyright and the alt text as the description; GPS is removed unless
  `strip_gps=false`; transparency goes to JPEG over the matte colour; a size
  target tries the floor quality (JPEG/WebP 40, AVIF 30) first and shrinks
  the image when even that does not fit, then searches up.
- First run: only `img_engine/` and `licenses/` ship. `lib_setup.js` (cron
  lane `img_engine_setup`) downloads about 32 MB once, pinned by URL, size
  and SHA-256, checks each file (curl.exe, certutil.exe, tar.exe), unpacks
  under an "unpacking" mark and moves it into place; it starts within a
  minute of the first boot (never in a `CRAFTBOT_APP_ENV=shadow` boot),
  resumes a partial download and after a failure waits for
  `engine.install` (Retry on Home and in Settings). Background removal
  (`bg`, about 20 MB; `bg_detailed`, 179 MB) downloads only when the person
  asks (`engine.install what=bg`; the agent cannot). Installing it stops the
  engine so onnxruntime loads on the next job. While the engine is on its
  way, imports are kept `pending` and read when it is ready; other calls
  answer `engine_unavailable` with the progress.

## The workspace (frontend)

- `pages/Image.tsx` owns the photo tool session (kind, params, the edit it
  saves to) and saves as you go: one save at a time, newest change last
  (320 ms after sliders and typing stop, at once for drags ending and
  choices), the session's edit id kept in a ref so a quick second change
  updates the edit the first one made; a no-op removes the edit; undo and
  redo resync the open tool from the answer's stack. It shows the photo
  without its layers (`images.render layers=false`, re-rendered only when
  the photo's own edits change) and owns the layers: what the server has
  plus what was changed here and not yet seen back (shown at once; a drag
  saves when it ends, sliders a moment after they stop; dropped once the
  image reloads with the saved change), new layers shown and selected
  before the server answers, restacks shown at once; every write goes
  through one queue so the server sees them in order. Also the base
  picture for crop (`upto` and a `draft` crop for rotations), quick
  actions, keyboard shortcuts, reporting the screen (tool, selected layer)
  to `app.ui`.
- `lib/layers.ts`: the photo-to-result map, placing a layer in result
  pixels and writing geometry back in its own space, repinning, text
  layout, new layers' defaults.
- `components/workspace/`: `Stage.tsx` (view transform, pan and zoom,
  detail tiles, bottom bar, overlay slot, panel on either side),
  `LayersOverlay.tsx` (every layer drawn in SVG over the photo, matching
  `layers.py`; selection frame, handles, rotate handle, drawing new layers,
  typing text in place; redaction patches pixelated or blurred from the
  photo bitmap), `LayersList.tsx`, `LayerDialog.tsx` (properties, logo
  picker), `overlays.tsx` (crop box, region), `forms.tsx` (one form per
  photo tool), `ToolDialog.tsx`, `Toolbar.tsx`, `tools.ts`,
  `controls.tsx`, `StackPanel.tsx`, `InfoPanel.tsx`, `ExportPanel.tsx`,
  `HistoryPanel.tsx`, `AgentPanel.tsx`.
- `components/Importer.tsx` (dialog, drop anywhere, paste), `Shell.tsx`
  (rail and phone bar), `EngineSetup.tsx` (setup progress, add-ons).

## Agent triggers

| Trigger | Fired when | What the agent does |
|---------|------------|--------------------|
| `edit_requested` | The person asks for an edit (Agent tab; quick asks) | Reads the request (`requests.get`, with the region they drew), looks at the image, edits with dry runs first (proposals by default; marks, labels, redactions and watermarks as layers with `layers.add`, so the person can still move them), checks the result with `images.render`, exports if asked, reports with `requests.update` (or asks back when it would have to guess) |
| `describe_requested` | "Ask your AI agent to describe it" or "Ask for alt text" on a selection | Looks at each image, writes alt text (under 125 characters), a title and keywords with `images.update`, reports them |

Each trigger needs one approval in CraftBot before it can run.

## External data

None at run time. Images come from the person (uploads, paths, paste) or
the AI agent (paths). The only downloads are the engine's first-run setup
and the optional background models (www.python.org, files.pythonhosted.org,
github.com release assets; see The image engine).

## Background jobs

- `img_engine_setup` (every minute): the first-run download and requested add-ons; returns at once when nothing is wanted.
- `img_worker` (every minute): images waiting for the engine, then queued batches one image at a time; between jobs it waits on a wake flag until second 56, so a batch you run starts at once.
- `img_prune` (03:41 daily): previews and work files older than a week (made again on demand).
- On boot, a batch that was running is queued again.

## Gotchas

- Hooks do not hot-reload: restart the app after any hook change. Engine code changes take effect when the engine restarts (it stops with the app).
- `onBootstrap` runs before the app's migrations on a brand-new database: anything it reads must tolerate missing collections.
- Record ids made in the hooks must match PocketBase's pattern (15 lowercase letters and digits: `u.newId()`); `$security.randomString` has capitals.
- PocketBase sort strings use `-field`, not `field desc`.
- A JSON body's one-element list (`["trim"]`) is a list; only a multipart field's one-element list of JSON text is unwrapped (`lib_util.json`).
- The render cache's meta file is shared by calls with and without a thumbnail: the cached path sets `thumb_path` per call.
- PocketBase limits request bodies to 32 MB by default; `images.import` raises it to 2 GB (`$apis.bodyLimit`).
- Windows MAX_PATH: the engine converts long absolute paths to `\\?\` form and back; keep stored file names short.
- The UI subscribes to all collections once at startup (`lib/live.ts`); the SDK drops subscriptions made during its first connection.
- Colors: `lib/themeColors.ts` derives every `--iu-*` color (and the checkerboard tones) from the kit theme tokens with contrast checks; never hardcode a color in components (the stage's light and dark backdrops are the exceptions, by design).
- The visual system is CAD Workshop's: build screens from `components/ui.tsx`; corners from `--iu-r-sm|r|r-md|r-lg`; dense tables use `.iu-table`.
- Overlay tools capture left drags; Space and the middle button pan in the capture phase, before a tool sees the press. With Select on, a press on empty space lets go of the layer and pans.
- Layers are composited after every photo edit whatever their place in the stack list; their order among themselves is the stack order. A layer's `updated` stamp is how the workspace knows the server has its change.
- A step's `n` is text (up to 3 characters: 1, 2, A).

## Ownership map

- Editable: `frontend/src/app/`, `pb/pb_migrations/` (new files only), `pb/pb_hooks/*.pb.js` and `lib_*.js` (not the `_*.js` system files), `operations.json` (non-system entries), `triggers.json`, `engine/img_engine/`, `engine/licenses/`, this file, `reference/`.
- Vendored (downloaded on first run; change only by changing the pins in `lib_setup.js` as a whole, keep `engine/licenses/` in step): `engine/python/`, `engine/site-packages/`, `engine/models/`.
- System-managed (never edit): `frontend/src/kit/`, `frontend/src/main.tsx`, `frontend/src/config.gen.ts`, the underscore hooks (`pb/pb_hooks/_*.js`), `manifest.json`.
