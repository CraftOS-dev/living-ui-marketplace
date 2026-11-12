# PDF Splitter

> Per-project plan, context and index. Keep it current with every change.

## Plan

A single-page PDF splitter for one person, used in the browser with no
accounts. The person uploads a PDF, sees every page as a thumbnail, and splits
it three ways: the pages they selected (one file per page), custom ranges like
`1-5, 8, 11-15` (one file per range), or every N pages. They download one
part or all parts as a ZIP. Every split is kept as the document's Split
History, so its parts can be downloaded again later.

**All PDF work happens in the person's browser.** The page counts pages and
draws thumbnails with pdf.js, and it builds every part and the ZIP with
pdf-lib and JSZip, each time a download is clicked. The server (PocketBase)
stores only two things:
- the uploaded source PDF (`pdfs`);
- each split's plan (`split_jobs`: which pages go into which file).

It never stores an output file. A split is therefore a record, not a set of
files. The app has no place to put files an agent makes.

An agent does everything a person can do through seven operations:
- **Upload:** a PDF from an absolute path on this computer.
- **Look:** the documents, one document with its history, and one split's plan.
- **Split:** preview a split, or create one, with the same rules as the split
  controls.
- **Delete:** a document.

The agent cannot download parts from the app. It builds them itself:
`splits.get` returns the source PDF's local path and each file's name and
page range, and any PDF tool cuts the same pages from that file.

**Start with `a2app pdf-splitter pdfs pdfs.list`.** It gives each document's
id, name and page count.

`LIVING_UI.md` in this folder describes an older Python backend that no longer
exists. Do not rely on it.

## Modules

Every operation and every collection an agent can reach belongs to one module. `a2app <app>` lists them; `a2app <app> <module>` lists a module's operations.

| Module | Operations | Collections |
| --- | --- | --- |
| `pdfs` | 4 | `pdfs` |
| `splits` | 3 | — |
| `records` | 0 | `split_jobs` |

## Entities

See `reference/requirements.md` § Data Requirements.

| Collection | Purpose | Notes |
|------------|---------|-------|
| pdfs | One uploaded PDF. Fields: `filename` (the file's name, up to 500 characters), `source` (the stored PDF, `application/pdf`, up to 100 MB), `file_size` (bytes), `page_count`, `created` (shown as the upload time) | Names need not be unique: the same file can be uploaded again as a new record. Deleting a PDF deletes its `split_jobs` (cascade) and its stored file. |
| split_jobs | One split, i.e. one row of Split History. Fields: `document` (→ pdfs), `split_type` (`pages`, `ranges`, `every_n`), `split_config`, `file_count`, `created` | `split_config` takes one of three exact shapes: `{"pages":[1,3,5]}` (ascending, no repeats), `{"ranges":[[1,5],[8,8]]}` (in the order typed; a single page p is `[p,p]`) or `{"n":2}`. The UI only ever creates these rows. It never edits or deletes one on its own; they go when their PDF is deleted. |

## Operations

Call an operation with `a2app <app> <module> <operation> --param value` (`<app>` is the app directory, its id or its name). A destructive one first answers `approval_required` with an approval key: ask the person, then repeat the call with `--approve <key>`. `a2app <app> --find <word>` locates an operation by name. Every operation below runs on the server in the app's own code: the handler its screens use where they call one, otherwise a server copy of exactly what the screens do.

### pdfs

- `pdfs.list` *(read-only)* — START HERE. Uploaded PDFs, newest first (the sidebar): id, file name, page count, size and upload date. Change things with pdfs.upload, splits.create and pdfs.delete rather than raw data writes.
- `pdfs.get` *(read-only)* — One PDF as the open document shows it: details, its split history (type, summary, file count, date) and where its source file is (path and url). Params: `pdf` (string, required).
- `pdfs.upload` — Upload a PDF from this computer, like dropping it on the app: an absolute path to a .pdf file (starts with %PDF, max 100 MB). Password-protected (encrypted) PDFs are refused, as the person's upload refuses them, because the app can never split them. Returns the id, name and page count. Params: `path` (string, required), `page_count` (number).
- `pdfs.delete` *(destructive)* — Delete a PDF, its stored file and its whole split history. Params: `pdf` (string, required).

### splits

- `splits.preview` *(read-only)* — Check a split without doing it: the same rules as the split controls, and the files it would make (file names and page ranges). Nothing is saved. Params: `pdf` (string, required), `split_type` (pages|ranges|every_n, required), `pages` (string), `ranges` (string), `n` (number).
- `splits.create` — Split a PDF (the Split PDF button): by selected pages, custom ranges or every n pages. Records it in the split history and lists its files as the Split Complete panel does, in the order its downloads give them. Params: `pdf` (string, required), `split_type` (pages|ranges|every_n, required), `pages` (string), `ranges` (string), `n` (number).
- `splits.get` *(read-only)* — One split from the history and what its downloads give: files[i] is what Part i+1 downloads (file name, first and last page), the ZIP's entries, and the source PDF's path, so you can build the same files with your own PDF tool. Params: `split` (string, required).

### What each operation returns

- **`pdfs.list`** returns:
  - `count`;
  - `documents[]` of `{id, filename, page_count, file_size, size, uploaded_at}`. `size` is the sidebar's text (`1.2 KB`, `40.0 MB`) and `uploaded_at` is ISO 8601.
- **`pdfs.get`** returns:
  - the same document fields;
  - `source: {file, url, path}`, where `path` is the absolute path of the stored PDF on this computer;
  - `history: {count, splits[]}`, newest first. Each split is `{id, split_type, type_label, summary, file_count, created_at}`, with the labels as Split History shows them: "By Pages" "Pages: 2, 10", "By Ranges" "1-5, 8", "Every N" "Every 2 pages".
- **`pdfs.upload`** returns the document fields, plus `page_count_source` (`file` or `agent`) and `message` (`Uploaded "<name>" (<n> pages)`).
- **`pdfs.delete`** returns `{status: "deleted", id, filename, splits_removed, message}`.
- **`splits.preview`** returns:
  - `pdf`, `split_type`, `split_config`, `file_count`;
  - `files[]` of `{filename, from, to}` (pages are 1-based and inclusive), in the order the Split Complete panel lists them and its downloads give them.
- **`splits.create`** returns the same as `splits.preview` plus the new split's `id`, `document_id`, `created_at` and `message` (`Split plan saved: N files (…)`: the app builds the files in the person's browser on download; the person's own toast reads "Split complete! N files created.").
- **`splits.get`** returns:
  - the history fields and `split_config`;
  - `document` (the file name), `source: {file, url, path}`;
  - `files[]` of `{index, part, filename, from, to}`, in download order;
  - `zip: {filename: "split_output.zip", entries[]}`: every file's name, in the order of `files[]`;
  - `download_error`, only when the browser could not build the parts either.

`pdf` accepts the id or the exact file name. When several PDFs share that name
the call answers 400 and lists their ids under `data.ids`; pass an id instead.

### Common jobs

The `<app>` in each call can be the directory, the id `pdf-splitter` or the name.

**Upload a PDF**
```
a2app <app> pdfs pdfs.upload --path "C:\Users\me\Documents\report.pdf"
```
The checks run in the same order as the UI's, with the same messages:
- the name must end in `.pdf` (any case), else "Only PDF files are allowed";
- the file must start with `%PDF` at byte 0, else "Invalid PDF file";
- the file must be at most 100 MB;
- the file must not be password-protected (encrypted), else "This PDF is password-protected (encrypted). PDF Splitter cannot split password-protected PDFs: remove the password and upload it again."

The path must be absolute, and the file is read from disk; the app runs on the
same computer. The record keeps the file's own name. The person can upload the
same file twice, and so can you; each upload is a new document. If the answer
asks for `page_count`, see § Page counts below.

**Preview, then split**
```
a2app <app> splits splits.preview --pdf <id> --split_type ranges --ranges "1-5, 8, 11-15"
a2app <app> splits splits.create  --pdf <id> --split_type ranges --ranges "1-5, 8, 11-15"
```
- `--split_type pages` takes `--pages`:
  - a JSON list (`"[1, 3, 5]"`) or a single number;
  - ranges to select (`"1-3, 8"`, which selects pages 1, 2, 3 and 8 like a shift+click);
  - or `all` (like "Select all").

  It makes one file per page, `page_<p>.pdf`. Repeats collapse and pages are
  sorted, as the selection is a set.
- `--split_type ranges` takes `--ranges` in the split controls' grammar: parts
  separated by commas, each `a-b` (1 ≤ a ≤ b ≤ page count) or a single page.
  - It makes one file per range, `pages_<a>-<b>.pdf` (a single page p gives `pages_p-p.pdf`), in the order typed.
  - A range typed twice makes two files: the second is `pages_<a>-<b> (2).pdf`, a third ` (3)`, and so on.
  - Any bad part refuses the whole input with "Invalid range. Use format: 1-5, 8, 11-15 (pages 1-P)".
  - The UI reads numbers leniently, and so does the operation: `5x` reads as 5, and `1-2-3` reads as `1-2`.
- `--split_type every_n` takes `--n`, from 1 to the page count. It defaults to 2, the UI's starting value.
  - It makes `pages_1-n.pdf`, `pages_<n+1>-<2n>.pdf` and so on; the last file may be shorter.
  - It makes ceil(pages / n) files.
- A parameter that belongs to another type is refused rather than ignored.
- Pages are checked against the document's stored page count, as the UI does.
  "No valid pages to split" means nothing was left; this only happens when the
  file has fewer pages than recorded.

**Get the parts (the person's "Download")**
```
a2app <app> splits splits.get --split <split id>
```
Build each file from `source.path` with your own PDF tool. Each entry of
`files[]` has `filename`, `from` and `to`, and every part is one run of pages.
For example: `qpdf "<source.path>" --pages . <from>-<to> -- "<filename>"`.

`part` matches the person's buttons: "Part 1" is `files[0]`.

For "Download All (ZIP)", put every file of `files[]` into `split_output.zip`
under its name, in that order (`zip.entries` lists the names). The pages are
the ones the person's download gives. The bytes are not identical, because
pdf-lib writes the file differently.

**Delete a PDF**
```
a2app <app> pdfs pdfs.delete --pdf <id>
```
It answers `approval_required` with a key. Ask the person, then repeat the call
with `--approve <key>`. The PDF, its stored file and its whole split history
are removed. The person's own trash button does this in one click, with no
confirmation.

## Conventions

### Page counts

- **When the server counts.** The server has no PDF library. It reads the page
  count from the file only when the catalog and page tree are plain text, and
  then `page_count_source` is `file`.
- **When you must count.** Many PDFs keep those objects in compressed object
  streams; pdf-lib's default output is one example. A page count written as a
  reference (`/Count 5 0 R`) is not read either. For those the upload answers: "This PDF keeps its page list compressed, so the
  app cannot count its pages on the server. Count them with your own PDF tool
  and pass page_count."
  - Count the pages, then repeat with `--page_count <n>`.
  - The value is then stored as given (`page_count_source: agent`), so it must be exact.
  - A wrong count shows the person missing or broken thumbnails and wrong split limits.
- **Mismatch.** When the server can read the count and `--page_count`
  disagrees, the upload is refused.
- **Encrypted PDFs** are refused on upload: any file with an encryption
  dictionary. The person's browser can never split one, because pdf-lib cannot
  decrypt it, so its parts would come out blank.
  - The person's upload refuses them too: a PDF that needs a password to open, and one with only an owner password.
  - A protected PDF stored before that check fails to split with "Failed to open PDF: the file is encrypted", in the UI and in the operation alike.

### File order and names

- **One order.** The Split Complete panel lists a split's files in plan order: selected pages ascending, ranges as typed, chunks from page 1.
  - Its buttons, "Part i" in the history and the ZIP follow that order, and so does `files[]` in `splits.preview`, `splits.create` and `splits.get`.
  - When the person talks about "Part i", use `files[i-1]`.
- **Unique names.** A repeated range (`1-2, 1-2`) makes two files, `pages_1-2.pdf` and `pages_1-2 (2).pdf`.
  - `file_count` counts both, both download the same pages, and the ZIP holds both.

### The person's screen does not update by itself

The page loads the document list once, when it opens, and has no live
updates:
- A PDF the agent uploads or deletes appears or disappears only after the person reloads.
- A document the agent deleted stays on an open screen until the person reloads. Splitting it there fails with "PDF not found", and its downloads do nothing.
- A split the agent makes shows in an open document's Split History when the person switches documents, splits again, or reloads.

Tell the person to reload the app after you change something.

### Raw record access

`a2app <app> data pdfs …` and `data split_jobs …` reach the records directly.
Reading them is fine, e.g. `data split_jobs list --filter "document='<id>'"`.
Writing through them skips every check the operations make:
- **A PDF cannot be created that way:** the source file cannot travel in a JSON body.
- **Edits are unchecked.** Changing `filename`, `page_count` or `file_size`, or
  creating, editing or deleting a `split_jobs` row, is not checked at all.
- **The UI cannot make these states.** It has no rename and no way to edit or
  delete a history row. A wrong `file_count` or `split_config` gives the person
  Part buttons that download the wrong pages or nothing.

Use the operations for every change.

### Gotchas

- **Lists.** The sidebar and each document's history show at most 500 rows, and the operations keep that limit.
- **Reading the source.** An upload, and the first split or `splits.get` of a stored PDF, read the whole file once (about 3 s for 40 MB). What they learn is kept in memory until the app restarts.
- **The agent's routes.** The routes live in `pb/pb_hooks/agent_ops.pb.js` (`/api/ops/<group>/<verb>`), with the framework's `POST /api/ops/<name>` aliases generated in `a2app_routes.pb.js`. Their logic is in `pb/pb_hooks/lib_agent.js`. Each function there ports a browser function and names it: `apiAdapter.ts`, `SplitControls.tsx`, `SplitHistory.tsx`, `Sidebar.tsx`, `ThumbnailGrid.tsx`. Change both sides together.
- **The browser side.** The person's page keeps the old V1 screens. `frontend/src/app/services/apiAdapter.ts` intercepts their requests to a placeholder host and answers them in the browser. That is where the page counts, renders, splits and zips.
- **Restarts.** Hooks do not hot-reload: restart the app after a hook change.

### Ownership map

- **System-owned (hash-locked, from the `blueprint-pocketbase-kit` toolkit — never edit):** `manifest.json`, `pb-serve.mjs`, `pb-fetch.mjs`, `pb-check.mjs`, `pb-build.mjs`, `pb/pb_hooks/_a2app.pb.js`, `pb/pb_hooks/_a2app_impl.js`, `pb/pb_hooks/_a2app_rules.js`, `pb/pb_hooks/_compat_lib.js`, `pb/pb_hooks/_compat_rules.js`, `pb/pb_hooks/_compat_system.js`, `pb/pb_hooks/_system.pb.js`, `pb/pb_hooks/_triggers.pb.js`, `pb/pb_hooks/_triggers_lib.js`, `pb/pb_hooks/_craftbot_bridge.js`.
- **Agent-owned:** `operations.json`, `events.json`, `AGENT_APP.md`, `reference/`, `pb/pb_hooks/a2app_routes.pb.js` (regenerate with `tools/agent-app-migrate` rather than hand-edit), every other file under `pb/pb_hooks/` and `pb/pb_migrations/`, and `frontend/`.

## Checklist

Build and verification tasks live in `reference/tasks.md`.
