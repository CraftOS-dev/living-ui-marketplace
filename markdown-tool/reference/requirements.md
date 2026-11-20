# Requirements: Markdown Editor

PART A — REQUIREMENTS (SRS). User-approved before build; frozen after; changes via ## Changes.

## Introduction

### Purpose
Markdown Editor is a desktop-style markdown workspace for one person, used in the browser with no accounts or sign-in. Its one job is to keep a tree of markdown notes, and to edit them side by side with a live rendered preview.
- **Explorer:** a file tree on the left, where files and folders are created, renamed, moved, deleted and uploaded.
- **Editor:** VSCode-style tabs over a plain text area in the middle, saved with Ctrl+S.
- **Preview:** GitHub Flavored Markdown rendering of the active file on the right.

The explorer and the preview can be hidden and resized, and the open tabs and layout come back after a reload. An AI agent works on the same workspace through A2App: every file action a person can take is a declared operation that writes the same records.

### Scope
**Goals**
1. A `.md` file opens from the tree into a tab with one click, and its preview updates with every keystroke.
2. Ctrl+S saves the active tab, and the unsaved marker (●) clears.
3. Renaming or deleting a folder applies to everything inside it, its open tabs included. A new file's path always ends in `.md` or `.markdown`, and an upload never replaces an existing path without the person's confirmation. A change that fails is undone and reported, never shown as done.
4. After a reload the same tabs (whose files still exist), the same active tab, panel widths, panel visibility and open folders come back.
5. Every file action a person can take is available to an agent as an operation, and the agent's writes produce the same `nodes` and `sessions` records as the person's.

**Core functionalities:** file tree · create, rename, move and delete of files and folders · file and folder upload with conflict confirmation · tabbed plain-text editor · save with Ctrl+S · live GitHub Flavored Markdown preview · resizable, collapsible panels · session restore · agent operations

### Approval
Approved by the user: 2026-11-11 — carried over from the published marketplace app `markdown-tool` 1.0.0, whose requirements were approved when it was built; this document restates them in the framework's form without changing any feature.

## Product Description

### Product Perspective
- **Access:** `authMode: none`. One person uses the app on their own machine with no sign-in. It serves on loopback only, and the collection rules are open (`''`).
- **Integrations:** `manifest.json` declares none (`capabilities.integrations: []`). The app calls no outside service. The CraftBot bridge module (`_craftbot_bridge.js`) ships with the kit, but nothing in the app calls it.
- **How the View is built:** it is the original V1 frontend, unchanged.
  - It talks to PocketBase through a client-side shim (`frontend/src/app/services/apiAdapter.ts`). The shim rebuilds V1's `/api/files*` and `/api/session` routes in the browser on top of the `nodes` and `sessions` collections.
  - Every workspace rule (the path rules, folders on demand, folder contents moving and deleted with the folder, upload conflicts, the `.md` suffix) runs in that shim, with the path rules in `services/paths.ts`.
- **The agent's side:** the operations in `pb/pb_hooks/agent_ops.pb.js` and `lib_agent.js` port the same rules to the server.
- **What it deliberately is not:**
  - **Not a real file system:** V1 kept files on disk under a `WORKSPACE_ROOT`; this version keeps the workspace as records.
  - **Not a rich editor:** no formatting toolbar, syntax highlighting, search, export or version history.
  - **No AI features of its own.**

### User Characteristics
One person writing and organising markdown notes, on a desktop or laptop browser with a mouse and keyboard, in sessions of minutes to hours. They keep several files open in tabs, write with the preview beside the text, and rearrange the tree now and then. The layout is a fixed three-panel desktop layout; phone widths are not designed for (see ### Conventions and overrides).

### Constraints
- C-1: A file or folder is one `nodes` record:
  - `path` is the full workspace path, `/`-separated, and unique;
  - `parent` is the path without its last segment (`""` at the top level);
  - `name` is the last segment;
  - `is_dir` marks a folder;
  - `content` is a file's text (`""` for a folder);
  - `modified` is the last save time in epoch seconds with a fraction, set on create, save and upload, never on rename or move.
- C-2: The explorer lists a node only under its `parent` folder. A node whose folder does not exist is never shown.
- C-3: Only a file whose name ends in `.md` or `.markdown` (any case) opens in the editor. Other files are listed dimmed and do nothing when clicked.
- C-4: A new file (New File) gets `.md` appended when its path does not end in `.md` or `.markdown` (any case), so `Notes.MD` stays `Notes.MD`. Uploaded and renamed files keep the name given.
- C-5: Creating, uploading, renaming or moving to a path whose folders are missing creates those folders first.
- C-6: Renaming or moving a node moves every node whose path starts with `<path>/`, and a folder is never moved inside itself. Deleting a node deletes every node under it.
- C-7: Two nodes never share a path. Creating, renaming or moving onto an existing path is refused. An upload onto existing paths writes nothing until the person confirms Overwrite, and a file is never uploaded onto a folder's path.
- C-8: Delete is permanent: there is no trash or undo.
- C-9: One `sessions` record holds the editor layout:
  - `open_tabs` is a list of `{path}`: the text is in the files, so the session stays small however large they are;
  - `active_tab` is a path, or `""` for none;
  - the panel widths: the explorer 160–500 px (default 240), the preview 180–700 px (default 380);
  - the panel visibility (default both shown);
  - `expanded_dirs`, the explorer's open folders;
  - `updated`, when it was last saved.

  The editor reads it once when the page loads. The tabs of a renamed or moved node, and of everything inside a renamed folder, follow it; the tabs of a deleted node, and of everything inside it, close.
- C-10: A file holds at most 10,000,000 characters of UTF-8 text. Uploaded files are read as text.
- C-11: A new path is workspace-relative and `/`-separated: it never starts with "/" and holds no backslash and no empty, "." or ".." segment. A new name given in a rename is one segment, so it holds no "/" either. A new path whose folder is a file (`notes.md/child.md` under the file `notes.md`) is refused with "\"notes.md\" is a file, not a folder": the explorer could not show it. A path or name that breaks these rules is refused with the reason, in the View and in the agent operations.

### Assumptions
- A-1: Volume ceiling: about 500 nodes holding a few MB of text in all. The browser shim reads every node with its text (500 records per page) for each listing, open, save, create, rename, delete and upload.
- A-2: One person in one browser tab at a time. The app has no conflict detection between tabs, and an open page does not see changes made elsewhere until it reloads.
- A-3: Files are UTF-8 text. A binary file uploaded with a folder is stored as decoded text and is not usable.

## Features

### Module: Frame
- F-FRM-1: The user sees one full-height page: a toolbar with the title "Markdown Editor" and two panel toggles, over three panels side by side. The panels are the Explorer on the left, the tabs and editor in the middle, and the Preview on the right.
- F-FRM-2: The user can hide or show the explorer (left toggle) and the preview (right toggle). Each toggle shows the panel's state with its icon and an accent color while the panel is shown, and its tooltip reads "Hide explorer"/"Show explorer" or "Hide preview"/"Show preview".
- F-FRM-3: The user can resize the explorer (160–500 px) and the preview (180–700 px) by dragging the divider beside it. A divider next to a hidden panel is dimmed and does not drag.
- F-FRM-4: WHEN the page loads THE SYSTEM SHALL restore the saved session: the open tabs, each re-read from its file (a tab whose file is gone is dropped), the active tab, the panel widths, which panels are shown and which folders are open (a folder that is gone stays closed). Without a saved session, the explorer is 240 px wide, the preview 380 px, both are shown and every folder is closed.
- F-FRM-5: The user sees "Loading…" until the session is restored.
- F-FRM-6: The user sees a toast in the top-right corner for every save, file action and failure, which closes after 3 s.
- F-FRM-7: WHEN the host sends a theme or a light/dark mode THE SYSTEM SHALL recolor the app with that theme (craftbot, normal, ocean, forest, pastel or custom colors). Without a host it uses the dark craftbot theme.
- F-FRM-8: WHEN the open tabs and layout cannot be saved THE SYSTEM SHALL say so in a toast ("Failed to save open tabs and layout") with the reason.

### Module: Explorer (files)
- F-EXP-1: The user sees the workspace as a tree under the header "EXPLORER": folders first, then files, each sorted by name ignoring case. Folders show a chevron and an open or closed folder icon, and files a file icon. Files that are not `.md` or `.markdown` are dimmed and do nothing when clicked.
- F-EXP-2: The user can expand or collapse a folder by clicking it. Its contents load when it opens, with "…" while loading, and are indented under it. The open folders are saved in the session.
- F-EXP-3: The user sees the open file highlighted in the tree.
- F-EXP-4: WHEN the workspace is empty THE SYSTEM SHALL show "Workspace is empty" with a "New File" button.
- F-EXP-5: The user can create a file or a folder in a "New File" or "New Folder" dialog: at the top level from the header buttons, or inside a folder from that folder's hover buttons ("New file here", "New folder here"). Enter or Create confirms, and Cancel, Escape or the backdrop closes the dialog. A name containing "/" creates the folders it names. A path that breaks the path rules (C-11), or whose folder is a file, is refused in a toast that gives the reason.
- F-EXP-6: WHEN a new file's path does not end in ".md" or ".markdown", in any case, THE SYSTEM SHALL append ".md".
- F-EXP-7: WHEN a new file or folder's path already exists THE SYSTEM SHALL refuse it with "Already exists".
- F-EXP-8: The user can rename a file or folder in place from its hover "Rename" button. The dialog is pre-filled with the current name, and Enter or Rename confirms. A renamed folder takes everything inside it along, and the tabs of the renamed file, or of the files inside the renamed folder, follow it. A name with "/" or "\" is refused in a toast (C-11): a rename keeps the item in its folder.
- F-EXP-9: WHEN the new name is already taken THE SYSTEM SHALL refuse the rename with "Name already taken".
- F-EXP-10: The user can move a file by dragging it onto a folder in the tree, which is highlighted while the file is over it. Folders cannot be dragged, and there is no drop target at the top level. Dropping a file on its own folder does nothing.
- F-EXP-11: WHEN the target folder already holds a file of that name THE SYSTEM SHALL refuse the move with "A file with that name already exists in this folder".
- F-EXP-12: The user can delete a file, or a folder with everything in it, from its hover "Delete" button after confirming "Delete <name>? This cannot be undone." The tabs of the deleted file, or of every file inside the deleted folder, close.
- F-EXP-13: The user can upload one or more `.md` or `.markdown` files from "Upload File". They land at the top level of the workspace.
- F-EXP-14: The user can upload a whole local folder from "Upload Folder", with files of any type. Its structure is kept under a top-level folder of the same name.
- F-EXP-15: WHEN an upload would replace existing paths THE SYSTEM SHALL write nothing and list those paths in "File(s) Already Exist", offering Overwrite or Cancel. Overwrite uploads the whole selection, replacing the existing files. A file whose path is a folder's, whose folder is a file, or that breaks the path rules (C-11), is never uploaded: the rest go ahead, and a toast lists it with the reason ("Not uploaded: <path> (<reason>)").
- F-EXP-16: WHEN a create, rename, move, delete or upload succeeds THE SYSTEM SHALL confirm it in a toast ("Created file: <name>", "Renamed successfully", "Deleted <name>", "Uploaded <n> files") and reload the tree with every folder collapsed.
- F-EXP-17: WHEN one of the writes of a create, rename, move, delete or upload fails THE SYSTEM SHALL stop there, undo the writes already made, and say in a toast what failed and why ("Failed to rename: …"). It never reports a change that did not happen.

### Module: Editor (files, editor)
- F-EDT-1: WHEN the user clicks a `.md` or `.markdown` file THE SYSTEM SHALL open it in a new tab, or switch to its tab when it is already open, and show it in the editor and the preview.
- F-EDT-2: The user sees VSCode-style tabs: each shows its file name (full path on hover), the active tab has an accent top border, a ● marks unsaved changes, and a × closes the tab (shown on hover).
- F-EDT-3: The user can switch tabs by clicking them. Closing the active tab makes its neighbour active, and closing a tab discards its unsaved changes without asking.
- F-EDT-4: The user can edit the active file in a plain monospace text area with no formatting toolbar. Tab inserts two spaces.
- F-EDT-5: The user can save the active file with Ctrl+S (⌘+S on a Mac). A "Saved" toast confirms it and the ● clears; "Failed to save" reports a failure.
- F-EDT-6: WHEN no file is open THE SYSTEM SHALL show "Select a file from the folder panel to open it".
- F-EDT-7: WHEN the user saves a tab whose file was renamed or deleted elsewhere, or whose path is now a folder's, THE SYSTEM SHALL write nothing and open "Save as New File". It says what happened and offers to save the text at a path the user gives, pre-filled with the old one (".md" added as for a new file). The tab then belongs to the new file.

### Module: Preview
- F-PRV-1: The user sees the active tab's text, saved or not, rendered under the header "PREVIEW" as GitHub Flavored Markdown on every keystroke. Single line breaks show as breaks. Headings, lists, tables, code blocks, quotes, links and images are styled.
- F-PRV-2: WHEN no file is open THE SYSTEM SHALL show "Preview will appear here when a file is open".
- F-PRV-3: WHEN the text holds raw HTML THE SYSTEM SHALL show it sanitised: scripts, event handlers and `javascript:` links are removed, so nothing in a file runs in the page.

### Agent (via A2App)
- F-AGT-1: The agent can perform every file action a person can as an operation: the 10 operations in ## Operations Design. These are `files.list`, `files.read`, `files.write`, `files.create`, `files.upload`, `files.upload-overwrite`, `files.rename`, `files.move` and `files.delete` in module `files`, and `editor.tabs` in module `editor`.
- F-AGT-2: The agent can read the tree in the explorer's order with `is_dir` and `is_markdown`, and read a `.md` file's text with its `modified` time.
- F-AGT-3: WHEN the agent creates, saves, uploads, renames, moves or deletes THE SYSTEM SHALL write the same `nodes` and `sessions` records the person's action writes:
  - the `.md` suffix;
  - folders created on demand;
  - folder contents moved and deleted with the folder;
  - upload conflicts listed and nothing written;
  - the path rules (C-11);
  - the tab bookkeeping of rename, move and delete, for the node and everything inside it.
  
  Each multi-record change runs in one transaction, the tab bookkeeping included.
- F-AGT-4: WHEN an agent write breaks the path rules (C-11), would create a node the explorer could not show (a file used as a folder), would move a folder inside itself, would upload onto a folder's path, or would save into a folder, a non-markdown file or a missing file THE SYSTEM SHALL refuse it with a message that says why.
- F-AGT-5: The agent can write any text a person can type, raw HTML included; the preview shows it sanitised, as it does a person's text.
- F-AGT-6: WHEN the agent passes `expected_modified` and the file was saved since THE SYSTEM SHALL refuse the write with a conflict carrying the current `modified`. Reads and writes report `open_in_editor`, from the stored session.
- F-AGT-7: The agent can send text base64-encoded (`encoding: base64`) and in parts (`append: true`), with the same stored result as plain text.
- F-AGT-8: The agent can see the tabs the person has open and the active one, as last saved by the editor (`editor.tabs`).
- F-AGT-9: WHEN the agent calls a destructive operation (`files.upload-overwrite`, `files.delete`) THE SYSTEM SHALL answer `approval_required` until the person has approved that call.
- F-AGT-10: The agent can read `nodes` and `sessions` as entities through `a2app <app> data`, under the open collection rules.

## Non-Functional Requirements
- N-1: The preview re-renders on every keystroke of the active tab.
- N-2: Session writes are debounced: tab changes are saved 500 ms after the last one, and panel widths 600 ms after the last drag movement. A panel toggle is saved at once.
- N-3: Each agent operation that changes several records (a folder rename, move or delete, or a create or upload with new folders) runs in one transaction: all of it is stored, or none. The View writes one record per call, stops at the first failed call and undoes the calls before it (F-EXP-17).
- N-4: `files.list` reads paths without file text, so listing does not grow with the size of the files.
- N-5: The page is a desktop layout. The editor keeps at least the room left by the two side panels at their widths (explorer 160–500 px, preview 180–700 px).

## Data Requirements
- **nodes** (module: files): path (string, required, max 2000), parent (string, max 2000), name (string, required, max 500), is_dir (boolean), content (string, max 10000000), modified (number).
- **sessions** (module: editor): open_tabs (json), active_tab (string, max 2000), folder_panel_width (number), preview_panel_width (number), folder_visible (boolean), preview_visible (boolean), expanded_dirs (json), updated (datetime, server-set).

## External Interfaces
- **Human (browser):**
  - **Screen:** one single-user page served by PocketBase at the app's own origin: the toolbar, the Explorer, the tabs and editor, and the Preview, plus the dialogs opened from the explorer.
  - **File input:** "Upload File" (`.md` and `.markdown` files) and "Upload Folder" (any files of a local folder).
  - **File output:** none.
  - **Host messages:** when embedded in CraftBot, the page takes its theme and light/dark mode from the host by `postMessage`.
- **Agent (A2App):** the modules and collections in AGENT_APP.md § Modules; operations exactly as declared in ## Operations Design. No other machine interface is offered to agents; the app's own screens call their own routes.

## Out of Scope
- More than one person: accounts, sign-in, sharing, roles, or editing together in real time.
- Files on the machine's disk: the workspace lives only in the app's database (V1's `WORKSPACE_ROOT` directory is gone).
- Opening, editing or previewing files that are not `.md`, and storing binary files such as images faithfully.
- A formatting toolbar, WYSIWYG editing, syntax highlighting, spell checking, or find and replace.
- Searching file names or contents.
- Exporting, downloading, printing or sharing files, or rendering them to HTML or PDF.
- Trash, undo after delete, or version history.
- Moving a file to the top level, or moving a folder, by drag and drop.
- Live refresh of changes made in another tab or by an agent while the page is open.
- A phone or tablet layout.
- Work the app asks an agent for: it queues no tasks (`events.json` lists none).

## Quality of Life
- The text area takes the focus when a tab is opened or switched to, and the name field takes the focus when a dialog opens.
- A tab shows its full path on hover, and long names truncate with an ellipsis in tabs and in the tree.
- A folder's own New file and New folder buttons put the new item straight into that folder.

PART B — TECHNICAL SPECIFICATION.

## System Overview
PocketBase 0.39 (JS hooks, migrations) + React 19 / Vite / Tailwind 4 View in `frontend/` built into `pb/pb_public/`, on the `blueprint-pocketbase-kit` toolkit.
- **The View** is the V1 frontend:
  - `App.tsx` mounts `MainView`;
  - `MainView` holds the tabs, the panel layout and the session restore;
  - `FolderPanel` is the explorer and its dialogs;
  - `TabBar`, `EditorPanel`, `PreviewPanel` and `PanelDivider` make up the rest of the page.
- **The data layer:** `AppController.ts` calls V1's REST paths, and the fetch shim `services/apiAdapter.ts` answers them in the browser. The shim reads and writes the `nodes` and `sessions` collections through PocketBase's records API.
- **Server-side code:** the only app logic on the server is the agent operations, with routes in `pb/pb_hooks/agent_ops.pb.js` (`/api/ops/files/<verb>`, `/api/ops/editor/tabs`) and logic in `lib_agent.js`. The generated `a2app_routes.pb.js` serves them to agents as `POST /api/ops/<name>`. `ops.pb.js` declares no routes.

Modules → navigation map:

| Module (manifest) | Where a person meets it | Route |
| --- | --- | --- |
| `files` | The Explorer (tree, its header buttons, hover actions, drag and drop, the dialogs), the editor's Save, and opening a file into a tab | — (single page) |
| `editor` | The tab strip and the panel layout (toggles, dividers), restored on load | — (single page) |

There is no navigation: everything is on one page, and dialogs open over it.

## UI Design
- **Design system:** the V1 "CraftBot Browser Interface" design system, in `frontend/src/app/styles/global.css`:
  - **Variables:** `--color-primary` #FF4F18 (orange accent), a grey scale, `--bg-*`, `--text-*` and `--border-*` roles, success, warning, error and info colors, Inter for text and JetBrains Mono for code (taken from the machine when installed; no font is bundled), a 12/13/14/16/18/20 px type scale, a 4 px spacing scale, 4–12 px radii, and 100/150/200 ms transitions.
  - **Theme presets:** `theme/themes.ts` (craftbot, normal, ocean, forest, pastel, custom; each dark and light) writes its variables onto `:root`.
  - **Components:** written once in `components/ui/index.tsx` (Button, Input, Modal, Card, Alert, Badge and others). Icons come from lucide-react, toasts from react-toastify, and markdown rendering from marked 12, sanitised with DOMPurify 3.
  - **Kit:** the UI kit 0.5.0 vendored in `frontend/src/kit` (system-managed), supplies the `Shell` (error boundary, theme bridge, console relay) and its tokens through `app.css`. The app's own variables are not mapped onto the kit tokens.
- **Layout:**
  - **Page:** a full-height page with a 36 px toolbar on top and a row of three panels below.
    - **Explorer:** a header "EXPLORER" with four icon buttons, then the tree. Rows are at least 24 px tall and indented 14 px per level.
    - **Dividers:** 4 px wide, accent on hover.
    - **Center:** a 34 px tab strip over the text area.
    - **Preview:** a 34 px "PREVIEW" header over the rendered text.
  - **Panel sizes:** the side panels have fixed, saved widths; the center takes the rest.
  - **Dialogs:** centered over a dimmed backdrop, 420 px wide at most.
  - **Defaults:** dark by default, with light from the host.
- **Screen — Workspace (the page):**
  - **Primary object:** the workspace tree and the active file. **Primary action:** open a file and edit it; Ctrl+S saves.
  - **Loading:** "Loading…" until the session is restored, then "Loading workspace…" in the explorer, and "…" beside a folder while its contents load.
  - **Empty:**
    - the explorer shows "Workspace is empty" with a "New File" button;
    - the editor shows "Select a file from the folder panel to open it";
    - the preview shows "Preview will appear here when a file is open";
    - the tab strip is hidden while no tab is open.
  - **Error:** a toast: "Failed to load workspace", "Failed to load folder", "Failed to open <path>", "Failed to save", "Failed to create file" / "Failed to create directory", "Failed to rename", "Failed to delete", "Failed to upload", "Failed to move file", "Failed to save open tabs and layout", each followed by the reason when there is one; "Not uploaded: <path> (<reason>)" for files an upload left out.
  - **Success:** "Saved", "Saved as <path>", "Created file: <name>" / "Created folder: <name>", "Renamed successfully", "Deleted <name>", "Uploaded <n> file" or "Uploaded <n> files". The tree reloads collapsed, and ● marks unsaved tabs.
  - **Narrow:** no layout change. The center panel shrinks first, and the side panels keep their widths.
- **Screen — New File / New Folder dialog:**
  - **Primary object:** a name, with the placeholder "filename.md" or "folder-name".
  - **Primary action:** Create; Enter also creates. Cancel, Escape or the backdrop closes the dialog.
  - **States:** an empty name does nothing; "Already exists" in a toast for a taken path, the reason a path breaks the path rules (C-11), or "Failed to create file: \"<folder>\" is a file, not a folder", and the dialog stays open.
- **Screen — Rename dialog:**
  - **Primary object:** the item's new name, pre-filled with its current name.
  - **Primary action:** Rename; Enter also renames.
  - **States:** "Name already taken", "A name cannot contain "/" or "\"" or "Failed to rename: <reason>" in a toast, and the dialog stays open.
- **Screen — Confirm Delete dialog:**
  - **Primary object:** the item.
  - **Copy:** "Delete <name>? This cannot be undone."
  - **Primary action:** Delete (a red danger button); Cancel closes.
- **Screen — "File(s) Already Exist" dialog:**
  - **Primary object:** the list of conflicting paths, in monospace, scrolling past 200 px.
  - **Copy:** "The following file(s) already exist in the workspace. Overwrite them?"
  - **Primary action:** Overwrite (danger; it shows a spinner while uploading); Cancel uploads nothing.
- **Screen — Save as New File dialog:**
  - **Primary object:** the new path, pre-filled with the tab's old path.
  - **Copy:** "<path> no longer exists: it was renamed or deleted elsewhere." or "<path> is now a folder, so the file cannot be saved there.", then "Save your text as a new file?"
  - **Primary action:** Save; Enter also saves. Cancel, Escape or the backdrop closes it and writes nothing.
  - **States:** "Already exists", "That file is open in another tab", the reason a path breaks the path rules, or "Failed to save: \"<folder>\" is a file, not a folder", in a toast, and the dialog stays open. On success, "Saved as <path>", and the tree reloads.
- **Formatting:**
  - **What is shown:** file and folder names as stored, and tab names as the last path segment with the full path in the tooltip. No dates, sizes or ids are shown.
  - **Code:** the editor uses the monospace font at 14 px with a 1.6 line height.
  - **Preview:** headings h1 and h2 are underlined by a rule, inline code is tinted in the accent, and tables have zebra rows.

## Quality Conformance

- **Q1 Completeness & IA:**
  - **Orientation:** one page with fixed regions: the explorer with its "EXPLORER" header, the tabs with the active one marked, and the "PREVIEW" header. The open file is highlighted in the tree.
  - **Reach:** every function is reachable from the toolbar, the explorer's header, a tree row's hover buttons, or a tab (map in ## System Overview).
  - **Names hold app-wide:** file, folder, explorer, preview, tab, upload, rename, delete.
  - **Working set:** the tree is the one working set that can grow. It has no search or filter, only folding (Out of Scope).
- **Q2 Design system:**
  - **Tokens:** the V1 variables in `global.css` and the theme presets (see ## UI Design). Components use the variables.
  - **Hard-coded colors:** the default palette itself in `global.css` and `themes.ts`.
  - **Semantic roles:**
    - the orange primary for the active state (toggles, the active tab's border, the active tree row, links and inline code in the preview);
    - red for the delete hover and the danger buttons;
    - grey for chrome and muted text.
  - **Icons:** lucide-react only.
  - **Light and dark:** come from the host's messages; standalone, the dark craftbot theme applies.
- **Q3 Layout & composition:**
  - **Spacing:** a 4 px scale.
  - **Density:** a compact, IDE-like layout: 24 px tree rows, a 34 px tab strip, 11 px uppercase panel headers.
  - **Primary actions:** each dialog has one primary button (Create, Rename, Delete, Overwrite).
  - **Long names:** truncate with an ellipsis in tree rows and tabs (tabs at most 180 px).
  - **Scrolling:** the tree, the text area and the preview scroll on their own. There is no pagination.
- **Q4 Interaction:**
  - **Affordance:** tree rows, toolbar buttons and tabs use the pointer cursor and tint on hover. Dividers show a resize cursor, dimmed and inert next to a hidden panel. Disabled buttons dim to half opacity with a not-allowed cursor.
  - **Destructive actions:**
    - delete asks in the app's own dialog, naming the target and the consequence ("Delete <name>? This cannot be undone.");
    - overwriting on upload asks in the "File(s) Already Exist" dialog, listing every path.
  - **No confirmation:** closing a tab with unsaved changes discards them (### Conventions and overrides).
  - **Keyboard:** Ctrl/⌘+S saves; Tab inserts two spaces in the editor; Enter confirms the New and Rename dialogs; Escape closes any dialog.
  - **Constrained input:** the `.md` suffix is added rather than asked for, and a path that breaks the path rules is refused with the reason before anything is written.
- **Q5 State & feedback:**
  - **States:** each screen's states are listed in ## UI Design.
  - **In-flight:** the Overwrite button shows a spinner while uploading. Other actions show no in-flight state (### Conventions and overrides).
  - **Success:** a toast, plus the updated tree or the cleared ●.
  - **Errors:** a toast; no screen renders its own error state.
  - **Loading:** "Loading…" before the session is restored, "Loading workspace…" for the tree, "…" for a folder.
  - **Agent writes:** the results say when the person has the file open, and the open page shows agent changes only after a reload (Q11).
- **Q6 Motion:**
  - **Transitions:** colors and backgrounds change over 100 ms. Dialogs fade their backdrop in and slide up over 150 ms. Spinners turn while busy.
  - **Reduced motion:** there is no `prefers-reduced-motion` rule (### Conventions and overrides).
- **Q7 Content:**
  - **Voice:** short and plain, in sentence case: "Workspace is empty", "Select a file from the folder panel to open it", "Name already taken".
  - **Agent errors:** operation errors say what to do, e.g. "File not found; use files.upload to add a new file", "The file was saved since you read it …; read it again before writing", or the reason the explorer could not show a path.
  - **Terminology:** file, folder, explorer, preview, tab, upload, overwrite.
- **Q8 Accessibility:**
  - **Contrast:** text and surfaces come from the theme presets (white or near-white on near-black in dark, near-black on white in light). Muted text is the preset's muted grey.
  - **Focus:** `:focus-visible` draws a 2 px outline in the primary color.
  - **Dialogs:** `role="dialog"` with `aria-modal`, labelled by their title. They close on Escape, and the New and Rename dialogs focus their name field on open, but no dialog traps focus.
  - **Labels:** icon-only buttons carry a `title` tooltip ("New File", "Upload Folder", "Rename", "Delete", "Close tab", …), and the dialog close button an `aria-label`.
  - **Gaps (### Conventions and overrides):**
    - tree rows and tabs are clickable `div`s that the keyboard cannot reach;
    - moving a file needs a mouse drag;
    - the dividers need a mouse.
  - **Meaning:** unsaved state is shown by the ● mark (with the tooltip "Unsaved changes"), not by color alone.
- **Q9 Responsiveness:**
  - **Target:** desktop and laptop widths. There are no breakpoints or media queries.
  - **Narrow widths:** the side panels keep their saved widths (at least 160 and 180 px), the center panel shrinks, and either side panel can be hidden to make room. Phone widths are not designed for (### Conventions and overrides).
  - **Embedding:** the page fills the viewport height, as in the CraftBot shell.
- **Q10 Performance:**
  - **At A-1:** every explorer listing, file open, save, create, rename, delete and upload in the View loads all nodes with their text through the shim (`pbListAll`, 500 per page), filters in the browser, and writes one record per call.
  - **Preview:** re-renders with `marked` on each keystroke, memoised per text.
  - **Agent side:** `files.list` reads paths only (no text), and each agent operation does one read of the tree plus its writes.
  - **Assets:** the bundle has no images and no web fonts.
- **Q11 Caching & freshness:**
  - **Static:** the built bundle has content-hashed asset names, and the document is served no-store by the toolkit's SPA header.
  - **Data:** nothing is cached beyond in-memory view state.
  - **Freshness:** the View has no realtime subscription and no polling.
    - The tree is re-read on load, after the person's own explorer actions, and when a folder is expanded.
    - An open tab never re-reads its file.
    - The session is read once on load.
    
    Changes made elsewhere (another tab, an agent) show after a reload (### Conventions and overrides).
- **Q12 Data integrity:**
  - **Paths:** unique (`idx_nodes_path`), with `parent` indexed (`idx_nodes_parent`). There are no relation fields: the tree is keyed by path.
  - **The rules:** `parent`, `name`, the folders on demand and the folder subtree are kept by the browser shim for the person, and by `lib_agent.js` for the agent. The database enforces only the unique path, the required `path` and `name`, and the lengths.
  - **Atomicity:** the person's multi-record actions are separate REST calls; the first that fails stops the action, and the calls before it are undone (F-EXP-17). The agent's run in one transaction each (N-3).
  - **Path rules:** both sides refuse paths that break the path rules (C-11) or whose folder is a file, and a folder is never moved inside itself.
  - **Migrations:** `1700000000_init_workspace.js` builds both collections and `1700000001_sessions_updated.js` adds the session's `updated` autodate; they replay on a fresh database.
- **Q13 API:**
  - **The View:** calls only PocketBase's records API (through the shim) and `/api/_console`.
  - **The agent operations:** the app's own routes are GET for reads and POST for writes. Agents reach the same handlers through the adapter as `POST /api/ops/<name>`.
  - **Parameters:** read by the typed readers in `lib_agent.js`, which answer 400 naming the parameter.
  - **Errors:** PocketBase's shape `{ status, message, data? }`, with 400, 404 and 409 used for their meaning and 500 for the unexpected. `data` carries `code`, `conflicts` or `modified` where useful.
  - **Repeats:** `files.delete` is safe to repeat (`not_found`).
  - **Leaks:** stack traces are never returned.
- **Q14 Architecture:**
  - **Layers:** the UI is in `frontend/src/app/components`, and the data layer in `AppController.ts` and `services/apiAdapter.ts`. The agent's logic is in `pb/pb_hooks/lib_agent.js` and its routes in `agent_ops.pb.js`.
  - **Shared parts:** widgets exist once in `components/ui/index.tsx`.
  - **Duplication:** the workspace rules exist twice, in the shim and in `lib_agent.js` (### Conventions and overrides).
  - **Configuration:** in manifest.json and the toolkit's launcher.
- **Q15 Resilience:**
  - **Failed calls:** a failed load or write in the View toasts a "Failed to …" message with the reason, with no retry. A failed record write fails the action, and the writes before it are undone (F-EXP-17). A failed session save toasts once (F-FRM-8).
  - **Crashes:** a render crash shows the kit's "Something went wrong" panel with "Reload app".
  - **Agent side:** checks happen before writing, and a failed transaction leaves nothing half-written. The session bookkeeping runs in the same transaction, so if the session cannot be saved the operation fails and nothing changes.
  - **Hook errors:** caught, logged and answered as JSON, never shown raw.
- **Q16 Security & privacy:**
  - **Access:** with `authMode: none` the collection rules are open (`""`), because the app is single-user and binds loopback.
  - **Adapter:** the framework adapter runs its host check, framing policy and credential checks before any app hook.
  - **The app's own routes:** writes need a caller: the View, or the agent's `.agent-token` sent as `X-A2App-Token`.
  - **Approval:** destructive operations need the person's approval through the adapter.
  - **The preview:** marked's HTML passes through DOMPurify before it reaches the page, so scripts, event handlers and `javascript:` links in a file never run (F-PRV-3).
  - **Rate limits:** the toolkit sets 300 requests per minute on `/api/ops/`.
  - **Data:** file text stays in `pb/pb_data` and is not logged.
  - **Credentials:** runtime credentials (`.agent-token`, `.principal`, `.superuser`) are git-ignored and never shipped.
- **Q17 Observability:**
  - **Server logs:** the agent operations log `[markdown-tool] agent operation failed: <message>` for 5xx errors. The toolkit adds `[handler-error] <METHOD> <path>: <message>` for uncaught handler errors.
  - **Browser logs:** the kit's console relay ships browser errors and warnings to `logs/frontend_console.log`.
  - **Health:** `/api/_a2app`, the adapter's identity document.
- **Q18 Version control:**
  - **Commits:** per app and per change.
  - **Ignored:** `.gitignore` excludes credentials, `pb/pb_data/`, the PocketBase binary, the built View `pb/pb_public/`, `frontend/node_modules/`, framework runtime state under `.a2app/`, and `logs/`.
  - **Clean build:** the app builds from a clean checkout with the manifest pipeline alone (`install`, `build`, `start`).

### Conventions and overrides
The published app is restated here unchanged, so these are standing decisions of the approved build, not new work. Revisit any of them when the app is next modified.
- Q4.2 (confirm or undo for losing work): closing a tab with unsaved changes discards them without asking.
- Q5.3 (in-flight feedback): only the Overwrite button shows a spinner. Saves and explorer actions show their result in a toast, with no busy state.
- Q5.4 (designed error states): failures are reported by toast only.
- Q6.3 (reduced motion): there is no `prefers-reduced-motion` rule. The motion is limited to 100–150 ms fades and slides.
- Q8 (keyboard and pointer alternatives): tree rows, tabs and the dividers are mouse-only, and moving a file needs a drag. Dialogs do not trap focus.
- Q9 (narrow widths): the layout is desktop-only, with no breakpoints.
- Q11 (freshness): the View has no realtime subscription. Changes made elsewhere appear after a reload. An open tab's next save overwrites a change made to its file elsewhere.
- Q14.4 (one implementation per rule): the workspace rules are written twice, in the browser (`services/paths.ts`, `apiAdapter.ts`) and in `lib_agent.js` for agents, and are kept in step by hand.
- Q2 (theme tokens): the app's own `--bg-*`, `--text-*` and `--color-*` variables come from its theme presets and the host's messages, not from the kit's `--agent-app-*` tokens.
- Mirrored global rules: none recorded for this app.


## Process Flows
None — the app has no record lifecycle: a file or folder exists or does not, and every action completes in one step. The session is restored once on load and saved after tab and layout changes (N-2).

## Operations Design
| Operation | Module | Entity | appliesWhen | Params | Flags |
| --- | --- | --- | --- | --- | --- |
| files.list | files | — | — | folder: string, recursive: boolean | readOnly |
| files.read | files | — | — | path: string! | readOnly |
| files.write | files | — | — | path: string!, content: string, encoding: enum, append: boolean, expected_modified: number | — |
| files.create | files | — | — | path: string!, type: enum | — |
| files.upload | files | — | — | path: string!, content: string, encoding: enum | — |
| files.upload-overwrite | files | — | — | path: string!, content: string, encoding: enum | destructive |
| files.rename | files | — | — | path: string!, name: string! | — |
| files.move | files | — | — | path: string!, to: string! | — |
| files.delete | files | — | — | path: string! | destructive |
| editor.tabs | editor | — | — | — | readOnly |

## Changes
- 2026-11-11 defect fixes: the user asked for the published app's recorded defects (D-1 to D-11) to be fixed. The tabs inside a renamed or deleted folder follow it or close (C-9, F-EXP-8, F-EXP-12); paths and rename names follow the path rules, and a folder is never moved inside itself (C-6, C-11, F-EXP-5); `.markdown` files open like `.md` (C-3, F-EDT-1), and New File's `.md` check ignores case (C-4, F-EXP-6); an upload never counts a file it left out (F-EXP-15); saving a tab whose file is gone offers "Save as New File" instead of re-creating it (F-EDT-7); a failed write in a multi-record action stops, undoes and reports (F-EXP-17, N-3); the session stores tab paths only and reports a failed save (C-9, F-FRM-8), keeps the open folders (F-FRM-4, F-EXP-2) and has an `updated` time (Data Requirements); the preview is sanitised (F-PRV-3). The agent operations follow the same rules, and the agent-only script guard is gone with the defect it worked around (F-AGT-3, F-AGT-4, F-AGT-5).
- 2026-11-11 follow-up: New File, upload, move and Save as New File refuse a new path whose folder is a file, with the agent operations' reason, instead of creating a node the explorer never shows (C-11, F-EXP-5, F-EXP-15).
