# Markdown Editor

> Per-project plan, context and index. Keep it current with every change.

## Plan

A three-panel markdown workspace for one person, with no accounts or sign-in. On the left an **Explorer** shows a tree of files and folders. In the middle, open files sit in VSCode-style **tabs** over a plain monospace text area. On the right a **Preview** renders the active file live as GitHub Flavored Markdown. The person creates, renames, moves (by dragging), deletes and uploads files and folders in the explorer, edits in the text area and saves with Ctrl+S. The explorer and the preview can be hidden and resized, and the open tabs and panel layout come back after a reload.

The workspace is a **virtual file system** stored in PocketBase, not files on disk. Every file and folder is one `nodes` record, and the editor layout is the single `sessions` record.

**How the app is built.** The View is the original V1 frontend, unchanged. It talks to PocketBase through a client-side shim, `frontend/src/app/services/apiAdapter.ts`, which rebuilds V1's `/api/files*` routes in the browser on top of the `nodes` collection. All of the workspace rules live in that shim. The agent operations (`pb/pb_hooks/agent_ops.pb.js` routes, `pb/pb_hooks/lib_agent.js` logic) port those same rules to the server, so an agent writes exactly the records a person's clicks write.

**The file tree (`nodes`).**
- `path` is the full workspace path, `/`-separated with no leading slash, e.g. `notes/todo.md`. It is unique.
- `parent` is the path of the containing folder, `""` at the top level. The explorer lists a node only under `parent = <folder>`, so a node whose folder does not exist is invisible.
- `name` is the last path segment; `is_dir` marks a folder; `content` is a file's text (`""` for a folder).
- `modified` is the time of the last save in epoch seconds with a fraction, e.g. `1794388329.625`. It is set on create, save and upload, never on rename or move.
- **The markdown rule:** only a file whose name ends in `.md` or `.markdown` (any case) opens in the editor. Other files are listed dimmed and cannot be opened, read or saved. A new file gets `.md` appended unless its path already ends in `.md` or `.markdown` (any case), so `Notes.MD` stays `Notes.MD`.
- **The path rules:** a new path never starts with `/` and holds no backslash and no empty, `.` or `..` segment. A rename's new name is one segment, so it holds no `/` either. The app and the operations refuse anything else with the reason.
- **Folders on demand:** creating, uploading, renaming or moving to a path whose folders are missing creates those folders first.
- **Folders carry their contents:** renaming a folder moves every node under `<folder>/`, and deleting a folder deletes all of them. A folder is never moved inside itself.

**The editor layout (`sessions`).** One record holds:
- the open tabs (`open_tabs`, a list of `{path}`: the text stays in the files) and the active tab path (`active_tab`, `""` for none);
- the panel widths and which panels are shown;
- the explorer's open folders (`expanded_dirs`, a list of folder paths);
- `updated`, when it was last saved.

The editor writes it as the person opens, switches and closes tabs, opens or closes folders, and changes the layout. It reads it only once, when the page loads.

**Start with `a2app <app> files files.list`.** It returns the whole tree in the explorer's order. Then use `a2app <app> editor editor.tabs` to see which files the person has open.

**Common jobs.**
- **See the workspace:**
  - `a2app <app> files files.list` returns the tree: folders first, then A–Z ignoring case, depth first, with no file text.
  - `--folder notes` lists one folder's subtree; `--recursive false` lists only its own items, as one explorer level.
- **Read a file:** `a2app <app> files files.read --path notes/todo.md` returns:
  - `content`;
  - `modified` (keep it for the write);
  - `open_in_editor`, which is true when the person has the file open in a tab.
- **Edit a file:** read it, change the text, then save the whole new text:
  - `a2app <app> files files.write --path notes/todo.md --content @todo.md --expected_modified <modified from the read>`.
  - The write replaces the text, as Ctrl+S does. `--append true` adds the text to the end instead.
- **Add a new file with text:**
  - `a2app <app> files files.upload --path ideas/launch.md --content @launch.md`.
  - It refuses a path that already exists and lists it as a conflict.
  - To replace an existing file anyway, ask the person, then use `files.upload-overwrite`, which asks for their approval.
- **New empty file or folder:**
  - `a2app <app> files files.create --path notes/ideas` creates `notes/ideas.md`.
  - `--type folder` creates a folder instead.
- **Rename:**
  - `a2app <app> files files.rename --path notes --name archive` renames a folder in place, and everything inside moves with it.
  - The name is one segment: a name with `/` or `\` is refused, as in the Rename dialog. Use `files.move` to put a file in another folder.
- **Move a file into a folder:** `a2app <app> files files.move --path todo.md --to archive`. This mirrors the explorer exactly:
  - only files can be moved;
  - the target must be an existing folder;
  - there is no top-level target.

  To move a file to the top level, read it, `files.upload` it at the new path, then `files.delete` the old one.
- **Delete:**
  - `a2app <app> files files.delete --path drafts` deletes a file, or a folder with everything in it.
  - It is permanent, so it asks for the person's approval.
- **Tell the person to reload.** The open page does not refresh itself (see Gotchas). After a change, tell the person to reload the app, or to close and reopen a tab they had open.

## Modules

Every operation and every collection an agent can reach belongs to one module. `a2app <app>` lists them; `a2app <app> <module>` lists a module's operations.

| Module | Operations | Collections |
| --- | --- | --- |
| `files` | 9 | `nodes` |
| `editor` | 1 | `sessions` |

## Entities

See `reference/requirements.md` § Data Requirements. In short:

| Collection | Purpose | Notes |
|------------|---------|-------|
| nodes | One file or folder: `path` (unique), `parent`, `name`, `is_dir`, `content`, `modified` | The workspace tree; write it through the `files` operations, never with raw `data` writes |
| sessions | One row: `open_tabs`, `active_tab`, `folder_panel_width`, `preview_panel_width`, `folder_visible`, `preview_visible`, `expanded_dirs`, `updated` | Written by the open editor; `open_tabs` holds `{path}` entries and `expanded_dirs` the open folders |

## Operations

Call an operation with `a2app <app> <module> <operation> --param value` (`<app>` is the app directory, its id or its name). A destructive one first answers `approval_required` with an approval key: ask the person, then repeat the call with `--approve <key>`. `a2app <app> --find <word>` locates an operation by name. Every operation below runs on the server in the app's own code: the handler its screens use where they call one, otherwise a server copy of exactly what the screens do.

### files

- `files.list` *(read-only)* — The workspace tree (the nodes collection) as the explorer shows it: folders first, then A-Z by name, with is_dir, is_markdown and modified; no file text. Params: `folder` (string), `recursive` (boolean).
- `files.read` *(read-only)* — Open a .md or .markdown file: its text, its modified time (pass it back as expected_modified when writing), and whether the person has it open in a tab. Params: `path` (string, required).
- `files.write` — Save new text into an existing .md or .markdown file, as Ctrl+S does in the editor; --append true adds the text to the end instead (no newline is inserted: start the text with one). Params: `path` (string, required), `content` (string), `encoding` (text|base64), `append` (boolean), `expected_modified` (number).
- `files.create` — New empty file (.md is added unless the path ends in .md or .markdown, any case) or new folder, as New File / New Folder; missing parent folders are created. Params: `path` (string, required), `type` (file|folder).
- `files.upload` — Add a file with this text at a path, as Upload File / Upload Folder; refuses a path that already exists. Params: `path` (string, required), `content` (string), `encoding` (text|base64).
- `files.upload-overwrite` *(destructive)* — Upload that replaces an existing file, as Overwrite in the upload conflict dialog. Ask the person first. Params: `path` (string, required), `content` (string), `encoding` (text|base64).
- `files.rename` — Rename a file or folder in its folder, as the Rename dialog; a folder's contents move with it and their open tabs follow. Params: `path` (string, required), `name` (string, required).
- `files.move` — Move a file into another existing folder, as dragging it onto that folder in the explorer. Params: `path` (string, required), `to` (string, required).
- `files.delete` *(destructive)* — Delete a file, or a folder with everything in it; their open tabs close. Permanent; ask the person first. Params: `path` (string, required).

### editor

- `editor.tabs` *(read-only)* — The files the person has open in editor tabs (the sessions record) and the active one, as last saved by the editor; unsaved edits are not visible.

### Results

A successful call prints the adapter's envelope `{"a2app": true, "ok": true, "operation": "…", "result": {…}}`. The `result` fields of each operation:

| Operation | `result` |
| --- | --- |
| `files.list` | `folder`, `recursive`, `count`, `items[]`: `{path, name, is_dir, is_markdown, modified}` in explorer order |
| `files.read` | `path`, `name`, `content`, `modified`, `open_in_editor` |
| `files.write` | `status: "saved"`, `path`, `modified` (the new value), `length`, `open_in_editor`; plus a `note` when the person has the file open |
| `files.create` | `status: "created"`, `path` (the final path, `.md` included), `type`, `md_appended`, `created_folders[]` |
| `files.upload`, `files.upload-overwrite` | `status: "uploaded"`, `path`, `replaced` (whether an existing file was replaced), `created_folders[]` |
| `files.rename` | `status: "renamed"`, `old_path`, `new_path`, `moved` (nodes rewritten, the item and everything inside), `is_markdown`, `created_folders[]`, `tabs_updated` |
| `files.move` | `status: "moved"` (or `"unchanged"` when the file is already in that folder), `old_path`, `new_path`, `tabs_updated` |
| `files.delete` | `status: "deleted"` (or `"not_found"`), `path`, `deleted: {files, folders}`, `tabs_updated` |
| `editor.tabs` | `active` (path or null), `open[]`: `{path, active, exists}`, `note` |

**Refusals.** A refused call answers `ok: false` with:
- a `code`: `rejected` (400), `not_found` (404) or `conflict` (409);
- a `message` that says what to do;
- sometimes `data`, e.g. `data.conflicts` (the paths that already exist) or `data.modified` (the file's current `modified`).

The adapter also refuses unknown parameters and enum values outside the list, and it checks `path` and `name` are not blank.

**Reading text from a result.** Results are JSON, so the text in `content` arrives escaped:
- a new line is `\n`;
- `<`, `>` and `&` are `<`, `>` and `&`.

Decode the JSON (e.g. `| jq -r .result.content`) before editing the text. Never copy the escaped form into a write: it would store the literal `<` characters.

## Conventions

### Rules

- **Paths, not ids.** Every operation takes workspace paths: `path`, `folder` and `to`. Record ids are never needed.
  - **Existing node:** the path is matched exactly, and then with surrounding spaces trimmed.
  - **New path** (`files.create`, `files.upload`, `files.upload-overwrite`): trimmed, as the app trims a typed name, then checked against the path rules (see Guards).
- **`files.write` saves an existing `.md` or `.markdown` file only**, as the editor does:
  - a missing path answers `not_found` and points to `files.upload` (the editor, too, refuses to save a file that is gone and offers to save it as a new file);
  - a folder answers `conflict` "A folder has this path", and a non-markdown file is refused.
- **`files.read` opens `.md` and `.markdown` files only.** Other files appear in `files.list` with `is_markdown: false`, and the app cannot open them either.
- **Uploads take any file name** (folder upload accepts any file type), but only text can be stored.
- **Upload conflicts:**
  - `files.upload` never replaces anything. An existing file answers `conflict` with `data.conflicts: [path]`, and nothing is written.
  - `files.upload-overwrite` creates the file or replaces an existing file's text, after the person's approval.
  - Neither uploads onto a folder's path: that answers `conflict` "Not uploaded: <path> (A folder has this path)", as the app leaves such a file out and says so.
- **Rename:**
  - `files.rename` keeps the item in its folder: a `name` with `/` or `\` is refused, as in the app.
  - Renaming to the name it already has, or to a taken name, answers `conflict` "Name already taken".
  - A rename can drop `.md`. The result's `is_markdown: false` then says the file can no longer be opened.
- **Tabs follow, as in the app.** When a file the person has open is renamed, moved or deleted, the stored session follows: its tab is renamed, or closed with the neighbour becoming active.
  - The tabs of files inside a renamed or deleted folder follow or close too.
  - `tabs_updated` counts what changed. The session is saved in the same transaction as the files, so the call fails, changing nothing, if it cannot be saved.
- **Errors** carry the app's own wording where the app has one: "Already exists", "Name already taken", "Source not found", "File not found", "A folder has this path", "A file with that name already exists in this folder", and the path rules' reasons (e.g. "A path cannot start with "/"").
- **Writes are atomic.** Each multi-record change (a folder rename, move or delete, a create or upload with new folders) runs in one transaction.

### Sending text (`content`)

The `a2app` CLI sends each `--param value` as one shell argument. Long text, or text that starts with `--`, does not fit that well, so:
- **From a file:** `--content @draft.md` reads the value from that file as UTF-8 text, verbatim (never turned into a number or boolean). This is the normal way to send a document.
- **From stdin:** `--content @-` reads the value from standard input.
- **Front matter:** `--content=value` carries its value in the same argument, so the value may start with `--`, e.g. YAML front matter `---`. `@file` and `@-` also handle it.
- **A literal `@`:** text starting with `@@` is sent as text starting with a single `@`. An `@word` that names no existing file stays the literal text `@word`.
- **base64:** `--encoding base64 --content "$(base64 -w0 draft.md)"` sends the text base64-encoded, as UTF-8.
  - The app decodes it, drops a leading byte-order mark, and turns invalid bytes into U+FFFD.
  - It keeps leading and trailing new lines exactly. `"$(cat file)"` in a shell drops trailing new lines.
- **In parts:** for `files.write`, `--append true` adds `content` to the end of the stored text.
  - Use it when text is too long for one command line: write the first part, then append the rest.
  - Each part is saved, so the person sees the file grow if they reload in between.
- **Empty:** `--content ""` writes an empty file. `content` must be present in every write and upload.
  - A JSON `null` is refused, because the CLI turns the bare word `null` into one. Send that text with `@file` or base64.
- **Size limit:** at most 10,000,000 characters per file, after decoding and appending.

### Concurrency: `expected_modified` and `open_in_editor`

- **`expected_modified`:** pass the `modified` value from `files.read` (or `files.list`) to `files.write`.
  - If the file was saved since then (by the person or anyone), the write is refused with `conflict` and the current value in `data.modified`.
  - Read again, merge, and write again. Always pass it when the person might be working.
- **`open_in_editor`:** `files.read` and `files.write` report it, from the stored session.
  - When true, the person has the file open in a tab, and may have unsaved edits you cannot see.
  - `files.write` then adds a `note` saying so.

### Guards

Each guard refuses only input that the app could never turn into a correct, visible result. A valid write is never altered. The app refuses the same input in its own dialogs.

1. **The path rules** refuse a new path with `rejected` and the reason when it:
   - starts with `/` (`/top.md`);
   - holds a backslash (`a\b.md`);
   - has an empty segment (`a//b.md`, or a trailing `/` as in `files.create --path foo/`);
   - has a `.` or `..` segment (`../x.md`).

   A rename's `name` may not contain `/` or `\` either.
2. **A folder moved inside itself** is refused with `rejected` "A folder cannot be moved inside itself".
3. **A file used as a folder** (`notes/todo.md/child.md`) is refused with `conflict` "… is a file, not a folder".
4. **A path over 2,000 characters, and a name over 500 characters**, are refused. The database would reject them anyway.
5. **An upload onto a folder's path** is refused with `conflict`, the same reason the app gives when it leaves such a file out of an upload.
6. **Save targets:** `files.write` refuses a folder, a non-markdown file, and a missing file.
7. **Move rules:** `files.move` refuses moving a folder, a missing or non-folder target, and the top level as a target, exactly like the explorer's drag and drop.

**Raw HTML is fine.** Text may hold any HTML, as text a person types may. The preview sanitises the rendered HTML, so a script tag, an event handler or a `javascript:` link in a file never runs.

### Gotchas

- **The open page does not refresh itself.** The View has no realtime subscription and no polling.
  - The explorer re-reads the tree only when the page loads, after the person's own explorer actions, and when a folder is expanded.
  - An open tab never re-reads its file.
  - So after an agent change, the person sees it only once they reload, reopen the tab, or act in the explorer.
- **An open tab's next save overwrites agent writes.** If the person has a file open and you write it, their tab still holds the old text. Their next Ctrl+S replaces your write without warning; `expected_modified` cannot catch this from your side.
  - A file you rename or delete is different: saving its stale tab writes nothing. The app tells the person the file is gone and offers to save their text as a new file, at a path they choose (the old one included).
  - Check `open_in_editor` first. When true, ask the person to close the tab, or to reload after your change, before they save.
- **Unsaved edits are invisible.** The text in the person's editor, and the ● unsaved marker, live only in the browser. `files.read` returns the last saved text.
- **The session can be overwritten.** An open editor rewrites `open_tabs` and `active_tab` from its own memory on its next tab action. Tab updates made by `files.rename`, `files.move` and `files.delete` last only if no editor is open. `editor.tabs` shows what the editor last saved.
- **Prefer the operations over raw `data` writes.** `a2app <app> data nodes …` skips every rule above:
  - `parent` and `name` that match `path`;
  - the missing folders;
  - the `.md` suffix;
  - moving or deleting a folder's contents;
  - `modified`;
  - the session bookkeeping;
  - the guards.

  `data nodes delete` removes one record without the person's approval, and leaves the folder's children as invisible orphans. Plain `data` is fine for reading:
  - `data nodes list --filter "content ~ 'term'" --limit 500` searches file text, which the app itself cannot do;
  - `data nodes list` returns every file's text, 30 rows a page unless `--limit` is given.
- **Two copies of the rules.** The browser (`services/paths.ts` and the shim `apiAdapter.ts`) and `lib_agent.js` hold the same workspace rules, with the same messages. A change to one must be made in the other.
- **The app's own routes.** `agent_ops.pb.js` also registers `/api/ops/files/<verb>` and `/api/ops/editor/tabs`: GET for the reads, POST for the writes. No screen calls them. Agents use `a2app`, which reaches the same handlers as `POST /api/ops/<name>` (`a2app_routes.pb.js`).
- **Hooks.** On a live instance hooks do not hot-reload (`--hooksWatch=false`), so restart the app after a hook change.
  - `lib_agent.js` is required once per handler, never inside loops: `require()` costs about a millisecond.
  - Query results are Go slices. They are copied with `Array.from()` before sorting.

### Ownership map

- **System-owned (hash-locked, from the `blueprint-pocketbase-kit` toolkit — never edit):** `manifest.json`, `pb-serve.mjs`, `pb-fetch.mjs`, `pb-check.mjs`, `pb-build.mjs`, `pb/pb_hooks/_a2app.pb.js`, `pb/pb_hooks/_a2app_impl.js`, `pb/pb_hooks/_a2app_rules.js`, `pb/pb_hooks/_compat_lib.js`, `pb/pb_hooks/_compat_rules.js`, `pb/pb_hooks/_compat_system.js`, `pb/pb_hooks/_system.pb.js`, `pb/pb_hooks/_triggers.pb.js`, `pb/pb_hooks/_triggers_lib.js`, `pb/pb_hooks/_craftbot_bridge.js`.
- **Agent-owned:** `operations.json`, `events.json`, `AGENT_APP.md`, `reference/`, `pb/pb_hooks/a2app_routes.pb.js` (regenerate with `tools/agent-app-migrate` rather than hand-edit), every other file under `pb/pb_hooks/` and `pb/pb_migrations/`, and `frontend/`.

## Checklist

Build and verification tasks live in `reference/tasks.md`.
