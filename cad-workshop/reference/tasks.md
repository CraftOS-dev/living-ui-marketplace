# Tasks: CAD Workshop

Every task cites what it implements. These features already exist in the published app `cad-workshop` 1.0.0, so the build tasks are recorded as done.

## Build
- [x] T-1 (F-FRM-1, F-FRM-2, F-FRM-3, F-FRM-4): app frame. The 52 px icon rail has the mark, New part, three groups, hover labels and count badges for failing parts and open requests. The phone bottom bar has New part in the middle and a menu for the remaining pages (`components/Shell.tsx`).
- [x] T-2 (F-FRM-5): hash routes and the app's own trail for Back buttons (`lib/router.ts`).
- [x] T-3 (F-FRM-6): numbers read "1,234.5" in every locale, with a true minus sign (`lib/format.ts`).
- [x] T-4 (F-FRM-7, F-FRM-8): colors and the viewport palette are derived from the host theme tokens with contrast checks, and re-derived on each theme change (`lib/themeColors.ts`, `theme.css`). Line icons are stored by name (`lib/icons.ts`), with "your AI agent" copy throughout.
- [x] T-5 (F-FRM-9): an open page reloads onto a newly deployed build after a reconnect or a tab show, waiting while a dialog is open (`lib/live.ts`).
- [x] T-6 (F-HOME-1, F-HOME-2, F-HOME-3, F-HOME-4, F-HOME-5, F-HOME-6): Home has the greeting and both ways to start, the counts strip, the first-time card, Recent parts, the Geometry engine panel with its test, requests and latest changes (`pages/Home.tsx`).
- [x] T-7 (F-NEW-1, F-NEW-2): New part creates the next free "Part N" and opens it, and the part is renamed in place in the workspace header (`components/NewPart.tsx`, `PartName` in `pages/Part.tsx`).
- [x] T-8 (F-NEW-3, F-NEW-4, F-NEW-5): an empty part's start choices. The four starters are real parameters and features applied as one `edits.batch` (`STARTERS`), and Describe it opens the Agent tab.
- [x] T-9 (F-PRT-1, F-PRT-2, F-PRT-3, F-PRT-4): Parts page with table and grid layouts, search, filters, sort kept in the address, and pin, duplicate, archive and delete from each part's menu (`pages/Parts.tsx`, `components/PartsTable.tsx`, `components/PartCard.tsx`).
- [x] T-10 (F-WS-1, F-WS-6, F-WS-7, F-WS-8): the docked workspace. It has the header bar with state, size, undo, redo, export and More; the left, middle and right areas; the Model / Tree / Details tabs below 1024 px; and the engine start on open (`pages/Part.tsx`).
- [x] T-11 (F-WS-2, F-WS-3, F-WS-4): the grouped toolbar with shortcuts in its tooltips and ready dots from the selection, plus the Ctrl+K tool palette (`components/workspace/Toolbar.tsx`, `AddFeature.tsx`).
- [x] T-12 (F-WS-5): workspace keyboard shortcuts for tools, fit, undo, redo, delete and Escape.
- [x] T-13 (F-TOOL-1, F-TOOL-2, F-TOOL-5, F-TOOL-6): the floating tool dialog. It has essentials first with More options, pick fields filled from view clicks and box select, the volume delta, plain-language errors with tips by code and kind, Enter for OK and Escape to cancel, and editing carried on when a kept change fails (`components/workspace/ToolDialog.tsx`, `fields.tsx`, `lib/errors.ts`).
- [x] T-14 (F-TOOL-3, F-TOOL-4): drag handles with typable value boxes, the move gizmo, ghosts while dragging, and the debounced dry-run preview (300 ms; 450 ms while dragging) (`components/workspace/tools.ts`, `components/viewer/handles.ts`).
- [x] T-15 (F-SKT-1, F-SKT-2, F-SKT-3, F-SKT-4, F-SKT-5): sketch mode on planes and flat faces. It has the six drawing tools, snapping and inference with a zoom-following grid, typed sizes, canvas dimensions with expressions, reshape handles and arc bends, local undo, and Finish going on to Extrude (`components/workspace/SketchMode.tsx`, `lib/sketchGeom.ts`).
- [x] T-16 (F-TREE-1, F-TREE-2, F-TREE-3, F-TREE-4, F-TREE-5): the left panel. Parameters take expressions, arrow-key steps, scrubbing and sliders. The feature tree has status and author, a context menu, drag to reorder and suppress. Below come the rollback bar and the bodies with eye toggles (`components/workspace/Tree.tsx`, `lib/expr.ts`).
- [x] T-17 (F-VIEW-1, F-VIEW-2, F-VIEW-4, F-VIEW-7): the three.js viewer. It has picking of faces, edges, profiles and planes, box select, orbit around the picked point, the three mouse schemes, Alt-click cycling, double-click to edit, the hover readout, and drawing only on change (`components/viewer/engine.ts`, `Viewer.tsx`).
- [x] T-18 (F-VIEW-3): the right-click menu for faces, edges, profiles and empty space (`components/workspace/ContextMenu.tsx`, `onContext` in `pages/Part.tsx`).
- [x] T-19 (F-VIEW-5): the view bar. It has the selection filter, the seven standard views and the navigation cube, fit, projection, see-through, a section plane on X, Y or Z with position and side, and full screen.
- [x] T-20 (F-VIEW-6, F-AGT-6): the selection is shared with the agent through `selection.get` and `selection.set`, synced 250 ms after it changes, and follows the server when the agent sets it.
- [x] T-21 (F-PNL-1, F-PNL-2): the part panel with size, mass, validity, material, color and the last build, plus the build error with Edit, Show candidates and Ask to fix (`PartPanel` in `components/workspace/Panels.tsx`).
- [x] T-22 (F-PNL-3, F-PNL-4): the selection panel with plain labels, quick tools, copy key, kernel measurements with the measurement line, and keep as a check (`SelectionPanel`, `model.measure`).
- [x] T-23 (F-PNL-5): spec checks that re-run on every build, with pass, fail or could not run and the measured value (`ChecksPanel`, `checks.save`, `lib_misc.js`).
- [x] T-24 (F-PNL-6, F-PNL-7, F-ACT-1, F-ACT-2): the change journal. Batches have revert (asking first over later changes), the compare overlay of added and removed material with volumes, and the Activity page with its filter, paging and remove from history (`lib_changes.js`, `compare.builds`, `pages/Activity.tsx`).
- [x] T-25 (F-PNL-8, F-REQ-1, F-REQ-2, F-REQ-3, F-REQ-4, F-AGT-8, F-AGT-9, F-AGT-10): requests to the agent. They come from the Ask your AI agent dialog, the workspace's Agent thread and the Requests page. Each is stored with the selection and fires `design_requested`, `repair_requested` or `review_requested`, and its status only moves forward. The three playbooks come with them (`components/AskAgent.tsx`, `components/workspace/AgentPanel.tsx`, `pages/Requests.tsx`, `events.json`).
- [x] T-26 (F-EXP-1, F-EXP-2, F-EXP-3, F-EXP-4): export as STEP (read back and checked), 3MF, STL or GLB at three mesh qualities, with download and path, and the Exports page with format filter and "Part changed since" (`components/workspace/ExportDialog.tsx`, `pages/Exports.tsx`, `lib_exports.js`).
- [x] T-27 (F-SET-1, F-SET-2, F-SET-3, F-SET-4, F-SET-5): Settings for display, mouse scheme, agent build wait, materials with densities and the default, and the engine panel with Test and Clean old builds (`pages/Settings.tsx`, `settings.update`, `jobs.run`).
- [x] T-28 (F-ENG-1, F-ENG-2, F-ENG-3): the engine's first-run setup. It makes pinned downloads checked by size and SHA-256, resumes, offers Retry and Install, reports progress through `app.status`, and keeps builds queued meanwhile (`lib_setup.js`, job `cad_engine_setup`, `components/EngineSetup.tsx`).
- [x] T-29 (F-ENG-4, F-ENG-5): the build queue. Builds are reused by input hash and coalesced per part, the `cad_builds` worker waits on a wake flag, the engine process keeps a feature cache, interrupted builds are requeued on boot, and old builds are pruned hourly (`lib_builds.js`, `lib_engine.js`, `hooks.pb.js`).
- [x] T-30 (F-AGT-1, F-AGT-2, F-AGT-11): the 43 operations in `operations.json`, served to agents by `a2app_routes.pb.js` through the same handlers the View calls. `app.guide` gives the conventions and recipes, and `records.delete` (with its preview) goes through the adapter's approval (`lib_guide.js`, `lib_delete.js`).
- [x] T-31 (F-AGT-3, F-AGT-4): the edit envelope. It covers `edits.batch`, `dry_run`, `expected_hash`, `wait_s` and the revert of an agent edit that breaks the build unless `on_fail=keep` (`lib_edit.js`, `lib_tree.js`).
- [x] T-32 (F-AGT-5, F-AGT-7): model inspection for the agent (`model.describe|measure|properties|check`, `refs.resolve`, `views.render`, `compare.builds`) and STEP assets for `import_step` (`lib_model.js`, `lib_misc.js`).
- [x] T-33 (F-AGT-12): record guards refuse direct API writes on every collection and name the operation to use (`hooks.pb.js`, `lib_rules.js`).
- [x] T-34 (F-AGT-13): what the agent made is marked with a sparkle on parts, features, parameters, checks and exports, and as "Your AI agent" in the history.

## Verification
- [x] Framework-files check (`validateFrameworkFiles` of the Agent App CLI) reports no problems for manifest.json, operations.json, AGENT_APP.md, reference/requirements.md and reference/tasks.md.
- [x] ## Operations Design in reference/requirements.md lists exactly the 43 operations of operations.json, each under its declared module.
- [ ] Agent App Framework gate (`agent-app <dir> validate`) passes, including the describe budget on a dev instance.
- [ ] Every declared operation answers through `a2app` on a live instance.
- [ ] The View renders identically to the published build (screenshot comparison).
