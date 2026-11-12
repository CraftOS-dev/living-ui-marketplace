# Tasks: Markdown Editor

Every task cites what it implements. These features already exist in the published app `markdown-tool` 1.0.0, so the build tasks are recorded as done. The agent operations (T-16 to T-19) were added on 2026-11-11 as server-side ports of the View's own rules, without changing the View.

## Build
- [x] T-1 (F-FRM-1, F-FRM-2, F-FRM-3): one page with the 36 px toolbar (the title "Markdown Editor" and the explorer and preview toggles) over three panels.
  - The dividers resize the explorer (160–500 px) and the preview (180–700 px), and are inert next to a hidden panel.
  - Files: `components/MainView.tsx`, `PanelDivider.tsx`.
- [x] T-2 (F-FRM-4, F-FRM-5): session restore on mount, with "Loading…" until it is done.
  - Each saved tab is re-read from its file and dropped when the file is gone. Widths are clamped, and the active tab falls back to the first.
  - Tab changes are saved after a 500 ms debounce, widths after 600 ms, and toggles at once.
  - Files: `MainView.tsx`, and `apiAdapter.ts` `handleGetSession`/`handlePutSession` on the single `sessions` record.
- [x] T-3 (F-FRM-6): react-toastify toasts in the top-right corner, closing after 3 s (`App.tsx`).
- [x] T-4 (F-FRM-7): the theme presets (craftbot, normal, ocean, forest, pastel, custom) are written onto `:root` from the host's `craftbot-theme` and `livingui-theme` messages, with the dark craftbot theme by default (`theme/themes.ts`, `App.tsx`).
- [x] T-5 (F-EXP-1, F-EXP-2, F-EXP-3, F-EXP-4): the explorer tree.
  - Folders come first, then A–Z ignoring case (`apiAdapter.ts` `handleListFiles`).
  - Folders load lazily on expand, with "…" while loading.
  - Non-`.md` files are dimmed and inert, and the open file is highlighted.
  - An empty workspace shows "Workspace is empty" with "New File".
  - File: `components/FolderPanel.tsx`.
- [x] T-6 (F-EXP-5, F-EXP-6, F-EXP-7): the New File and New Folder dialogs, from the explorer header and from each folder's hover buttons.
  - `.md` is appended to a file path that does not end in `.md`.
  - "Already exists" refuses a taken path, and missing folders are created on demand.
  - Functions: `FolderPanel.handleCreate`, `apiAdapter.ts` `handleCreateItem` and `ensureDirs`.
- [x] T-7 (F-EXP-8, F-EXP-9): the Rename dialog, pre-filled with the current name.
  - The renamed node and every node under it get a new `path`, `parent` and `name` (`handleRenameItem`), and the tab of a renamed open file follows (`MainView.handleFileRenamed`).
  - "Name already taken" refuses a taken name.
- [x] T-8 (F-EXP-10, F-EXP-11): drag and drop of a file onto a folder.
  - The target folder is highlighted, and dropping on the file's own folder does nothing.
  - "A file with that name already exists in this folder" refuses a taken name.
  - Folders cannot be dragged, and there is no top-level target (`FolderPanel.handleDrop`).
- [x] T-9 (F-EXP-12): delete with the "Confirm Delete" dialog ("Delete <name>? This cannot be undone.").
  - The node and every node under it are deleted (`handleDeleteItem`), and the deleted file's tab closes (`MainView.closeTab`).
- [x] T-10 (F-EXP-13, F-EXP-14, F-EXP-15): "Upload File" (`.md`/`.markdown`, to the top level) and "Upload Folder" (any files, keeping the folder's structure).
  - Existing paths make the upload write nothing and open "File(s) Already Exist", which lists them with Overwrite and Cancel.
  - Function: `apiAdapter.ts` `handleUpload`.
- [x] T-11 (F-EXP-16): each explorer action confirms in a toast and reloads the tree. The panel remounts, so every folder collapses (`MainView` `folderRefreshKey`).
- [x] T-12 (F-EDT-1, F-EDT-2, F-EDT-3): tabs.
  - A `.md` file click opens a tab or switches to an open one.
  - Each tab shows its name, with the full path on hover. The active tab has an accent top border, ● marks unsaved changes, and × closes the tab on hover.
  - Closing the active tab activates its neighbour.
  - Files: `MainView.openFile`/`switchTab`/`closeTab`, `components/TabBar.tsx`.
- [x] T-13 (F-EDT-4, F-EDT-5, F-EDT-6): the plain monospace text area, with Tab inserting two spaces.
  - Ctrl/⌘+S saves `content` and `modified` (`MainView.handleSave`, `apiAdapter.ts` `handleWriteFile`), and toasts "Saved" or "Failed to save".
  - With no file open, the editor shows "Select a file from the folder panel to open it".
  - File: `components/EditorPanel.tsx`.
- [x] T-14 (F-PRV-1, F-PRV-2): the live preview of the active tab's text with `marked` (GitHub Flavored Markdown, single line breaks as breaks), styled headings, lists, tables, code, quotes, links and images. With no file open, it shows "Preview will appear here when a file is open" (`components/PreviewPanel.tsx`).
- [x] T-15 (F-AGT-10): the schema migration `1700000000_init_workspace.js`.
  - `nodes` (`path` unique, `parent` indexed) and the single-row `sessions`, under open rules.
  - Both are exposed as entities for `a2app <app> data` (manifest modules `files` and `editor`).
- [x] T-16 (F-AGT-1, F-AGT-2, F-AGT-8): agent reads ported from the browser shim to `pb/pb_hooks/lib_agent.js`, behind routes in `agent_ops.pb.js`:
  - `files.list`: the explorer's order, paths read without file text;
  - `files.read`: `.md` only, with `modified` and `open_in_editor`;
  - `editor.tabs`: the stored tabs, with whether each file still exists.
  
  The generated `a2app_routes.pb.js` serves every operation as `POST /api/ops/<name>`.
- [x] T-17 (F-AGT-3, F-AGT-4): agent writes `files.create`, `files.write`, `files.upload`, `files.upload-overwrite`, `files.rename`, `files.move` and `files.delete`.
  - They port `handleCreateItem`, `handleWriteFile`, `handleUpload`, `handleRenameItem`, `handleDeleteItem` and `ensureDirs`, plus the tab bookkeeping of `handleFileRenamed` and `closeTab`.
  - Each multi-record change runs in one transaction.
  - Guards refuse a path that breaks the path rules, a file used as a folder, a folder moved inside itself, an upload onto a folder, and a save into a folder, a non-markdown file or a missing file.
  - Checked against the real `apiAdapter.ts` on two fresh instances: identical `nodes` and `sessions` records.
- [x] T-18 (F-AGT-5, F-AGT-6, F-AGT-7):
  - agent-written text is stored as given, raw HTML included, like a person's; the preview sanitises it;
  - `expected_modified` refusing a stale write with the current `modified`, and `open_in_editor` on reads and writes;
  - `encoding: base64` (UTF-8, leading byte-order mark dropped) and `append: true` for long text.
- [x] T-19 (F-AGT-9): `files.upload-overwrite` and `files.delete` are declared destructive, so the adapter answers `approval_required` until the person approves the call.
- [x] T-20 (F-FRM-4, F-FRM-8, F-EXP-2, F-EXP-5, F-EXP-6, F-EXP-8, F-EXP-12, F-EXP-15, F-EXP-17, F-EDT-1, F-EDT-7, F-PRV-3, F-AGT-3, F-AGT-4): the recorded defects D-1 to D-11 fixed on 2026-11-11 (## Changes).
  - The path rules and `isMarkdownName` live in `services/paths.ts`, used by `FolderPanel`, `MainView` and `apiAdapter.ts`, and copied with the same messages into `lib_agent.js`. `parentProblem` refuses a new path whose folder is a file in the shim's create, rename/move and upload, as `planNewPath` does for the agent.
  - The tabs of a renamed or deleted folder's files follow or close (`MainView.handleFileRenamed`/`handleFileDeleted`, `lib_agent.js` `renameTabs`/`closeTabs`, now inside the operation's transaction).
  - `apiAdapter.ts` fails on any failed PocketBase call, undoes a multi-record action's earlier calls (`UndoLog`), refuses a save to a missing file or a folder, and reports files an upload left out (`skipped`). `MainView` offers "Save as New File".
  - The session stores `{path}` tabs and `expanded_dirs`, merges debounced saves and toasts a failed save. Migration `1700000001_sessions_updated.js` adds `sessions.updated`.
  - `PreviewPanel` sanitises with DOMPurify; the agent-only script guard is removed.

## Verification
- [x] Framework-files check (`validateFrameworkFiles` of the Agent App CLI) reports no problems for manifest.json, operations.json, AGENT_APP.md, reference/requirements.md and reference/tasks.md.
- [x] ## Operations Design in reference/requirements.md lists exactly the 10 operations of operations.json, each under its declared module.
- [ ] Agent App Framework gate (`agent-app <dir> validate`) passes, including the describe budget on a dev instance.
- [ ] Every declared operation answers through `a2app` on a live instance.
- [ ] The View renders identically to the published build (screenshot comparison).
