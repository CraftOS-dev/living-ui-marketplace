# Research OS

> Per-project plan, context and index. Keep it current with every change.

## What this app does

A research workspace for academics: a library of papers with their PDFs, a
reader, projects built around a research question (to-do list, reading list,
claims map, experiments, boards, writing desk, systematic reviews), discovery over
the open registries, and notes. Every quote stays tied to its page.

Easy on the surface: Home shows what to continue, what needs you and every
project's open tasks; each project's Overview shows its numbers and its to-do;
the reader works like Zotero's (select text, pick a
color; Backslash turns a passage into evidence). Advanced work (
manuscripts with live citations, PRISMA screening, the citation map) sits one
click deeper.

Your AI agent operates the same operations through the `agent-app` CLI. It
reads, identifies PDFs, proposes claims, evidence and links,
drafts text as tracked changes and screens records; everything it judges is
`agent_proposed` until a person confirms. Trashing, merging and deleting PDFs
become **proposals** a person approves. It works the tasks a person hands it
in a project's to-do list. It plans experiments and analyzes their runs (its conclusion waits for a person). It reads and adds files in each project's research repository (repo.*; its deletions are proposals). It may start a manuscript (ms.create; the outline counts as its text in the AI-use disclosure), snapshot it and build its PDF; its text goes in as tracked changes (ms.propose) and its settings (venue, authors, preamble, style folder) as a proposal (ms.update with --why). The app hands work back through 15 triggers. The UI says "your AI agent" and never names a product.

**Start every agent session with `agent-app run <project> app.guide`**: it
returns the conventions, the claims grammar, the highlight meanings, what the
agent may do, the error codes and ready-to-run recipes
(`app.guide --topic identify|ocr|claims|answer|access|search|feeds|draft|support|responses|screening|experiment|tasks|repository|references|notes|boards`). The topics, the areas and the trigger instructions come from the recipes and the catalog themselves (`lib_guide.RECIPES`, `lib_catalog.all()`); after a recipe change run `node tools/gen_triggers.mjs` (a trigger carries its recipe's steps).

CLI-friendliness checked 2026-10-23 by driving every area through `agent-app run` as the agent (scratch `agent_cli_drive.mjs`, 103 calls; `agent_cli_fixes.mjs`, 28 checks): uploads take `--paths`, files come back as `disk_path` / `file_path` / `thumb_path`, JSON parameters arrive as text and are parsed, a wrong value inside a JSON parameter is refused with the allowed values (`lib_util.choice`, never replaced by a default), and an unknown op or misspelt parameter gets the closest names from the CLI.

## Requirements

See `reference/requirements.md` (binding). Design and research behind it:
`reports/Research OS landscape and design.md` in the CraftBot repo.

Built (backend tested end to end: 89 checks, plus 32 for tasks and 15 in the
browser for the to-do views; every page checked on a seeded instance and on an
empty one, at 390px and 1440px, light and dark, in all 15 theme packs):

- [x] Library: add by DOI, arXiv, PubMed, PMCID, OpenAlex or ISBN (checksummed) with registry resolution (Crossref, arXiv, OpenAlex, PubMed, Open Library); PDFs by drop or upload; import BibTeX, RIS, CSL JSON with preview and undo; collections tree, tags, starred, read states; views (unread, recent, to identify, integrity alerts, duplicates, trash); filter builder; duplicates and merge; retraction checks (Crossref `updated-by`); export BibTeX, RIS, CSL JSON
- [x] Reader: pdf.js canvas under the app's own stored text layer; 8 highlight colors with meanings, underline, comments, area marks; find; outline, thumbnails, highlights list; paper, note, claims, questions and references panels; tabs of open papers; position remembered; thumbnails made on first view
- [x] Projects: reading list (status, role), claims map (questions, claims, evidence; layered layout, drag to place, drag a dot to link, inspector, list view, tidy), boards (cards of claims, passages, papers, notes, stickies, sections; real links), writing (block editor typeset with LaTeX: figures from the repository, tables, displayed and inline maths drawn with KaTeX, cross-references, abstract and LaTeX blocks, venue classes and front matter, own preamble, a PDF pane built with Tectonic on this computer with errors placed on their blocks; , `@` citations in 7 styles, claim links, tracked changes, snapshots, ready checks, AI-use disclosure, reviews received with responses and a letter, export to Word, LaTeX with .bib, Markdown, text), screening (import, blinded dual screening with your AI agent as second seat, conflicts, records, PRISMA 2020 flow as SVG, protocol, kappa, CSV)
- [x] Discover: search with every executed query and count shown, candidates with relevance reasons, saved searches with daily or weekly alerts, deep search by your AI agent, citation map (year by citations, Top cited and Top citing)
- [x] Notes (literature, project, free) with embedded passages and claims, pictures and tables (2026-10-22; research in research_notes/Note images and tables/ at the CraftBot root: pictures are pasted, dropped or chosen with / Image, land where the cursor is with their preview at once, resize by dragging either edge (shape kept), sit left, centred or right, take a caption and open full size on a click; tables come from / Table (3 by 3, header row on) or from a spreadsheet range pasted into a line, Tab and Shift+Tab move across with Tab in the last cell adding a row, Enter moves down, Shift+Enter breaks a line in a cell, + below and at the right add a row or a column, right click or the table menu inserts or deletes rows and columns, aligns a column, turns the header row off or deletes the table, and a range pasted into a cell fills from there; exports keep them: Markdown pipe tables with their alignment and pictures as files next to the note); Activity with undo (single or batch); Settings (highlight meanings and hues, citation style, registry contact email, agent policy and daily caps, text engine check, export)
- [x] Open-access PDFs download on their own when a paper is added (Settings, on by default)
- [x] To-do (2026-10-22): each project has its own to-do list (`tasks`, belongs to one project only). Opens as a board by status (to do, in progress, waiting, done) with drag and drop and a "+" per column (the default, at the user's request; the List choice is remembered per browser under `ro_tasks_view`), or a list grouped by due day (late, today, this week, later, no due day, done); N adds a task (on the board, to To do) with due day and priority; filters (late, today, this week, yours, your AI agent, labels, words); the task panel has status, due day, priority, for whom (you or your AI agent; refused in confidential projects), repeat (daily, weekly, monthly: completing makes the next one), labels, a checklist, notes and links to the project's papers, claims, manuscripts, boards and notes. Home shows every project's open tasks (late, today, this week, with your AI agent as filter tiles, by project, next up) and ticks them off in place.
- [x] Experiments (v2, redesigned 2026-10-22 after the user rejected v1 as unusable; research in reports/Experiments redesign.md at the CraftBot root): any kind of experiment (lab bench, chemistry, simulation, a study with people, field work) inside a project, numbered EXP-001.... The hub (one sidebar row, Experiments) shows every experiment of the project: an In progress strip on Table and Timeline (a card per running or paused one: T+ time, the next step with Done, a line to write in its journal, Resume when paused), then Board (the default view; drag a card between Planned, Running, Paused, Done, Cancelled), Table (grouped by status or kind, sortable, pin to the top; a compact list on a phone) or Timeline (planned dates dashed, actual dates solid, today marked); search and filters by status, outcome, kind and tag. New experiment: blank or from a template. The experiment page is one scrolling document with a sticky section nav (Objective, Design, Protocol, Runs, Results, Conclusion) and the journal always on the right (a drawer below 1100px). Status (planned, running, paused, done, cancelled) is separate from the outcome (supports, refutes, inconclusive, failed). Design: a variables table (varied with levels, kept the same with a value, measured; types and units), materials and setup, what it tests. Protocol: steps with minutes, ticked while running (time stamped), a note or deviation per step. Runs: the sheet (Enter down, Tab across, Esc cancels), Plan runs, paste CSV, export. Results: n, mean, SD, min, max per group, a dot chart, Group by and Compare to (a reference group: difference and percent). Conclusion: outcome, what the data show, next steps; Run it again on failed or inconclusive. Journal: entries are note, observation, result, deviation or issue, can say what they are about (a step or a run), are grouped by day (Day N), stamped with clock time and T+, flagged when written late; corrections keep the original with a reason and striking out keeps the text legible with a reason (nothing is erased). Bench mode: full screen, one step at a time in large type, a countdown for timed steps, Done stamps and advances, a note or photo about the step, Record the next run, Coming up and Latest in the journal. Run again plans a repeat with the same plan (lineage both ways); Save as a template. Your AI agent plans (hypothesis, variables, protocol, materials) or analyzes (a proposed conclusion) on request.
- [x] Research repository (2026-10-22, the user's reference: the company OS "Repo" page; research in research_notes/Project repository design/ at the CraftBot root): each project's own folders and files, as a tree on the left and what is open on the right. Every project starts with README.md (the project's name and question, what goes where, people, how to reproduce, data, how to cite, changes) and data/raw, data/processed, code, results, docs (the layout Wilson et al. 2017, Cookiecutter Data Science, TIER and rrtools agree on). Upload files or whole folders (the structure is kept; drop them from the computer onto a folder too), up to 1 GB a file; a name already in the folder becomes the file's next version and the one before is kept (look at, download or restore any version). Preview: text and code with line numbers, Markdown drawn (relative links open files, relative pictures show), CSV and TSV as a table (first 1,000 rows), pictures, SVG, PDFs (pdf.js), sound and video; text files are edited in place (Ctrl S; saving makes a version). Rename (F2), move (drag onto a folder, or Move to...), delete (with everything inside and every version, after a confirm), download a file, a folder or a selection as a zip (up to 2 GB), find a file by name, Ctrl or Shift click to pick several, right click for the rest, arrow keys move through the tree. A folder shows its README below what is inside. Your AI agent lists, reads text files (others by their disk_path), uploads from this machine, writes text files and makes folders; its deletions are proposals. Phone: the tree, then the open item with Back.

## Entities

Every collection's API rules are null: nothing reads or writes records
directly; everything goes through `/api/ops/*` (record request hooks also
refuse direct writes). Schema: `pb/pb_migrations/1700000100_research_schema.js`;
seed (settings row with the 8 highlight slots, citation style, agent policy,
log retention): `1700000200_research_seed.js`.

| Group | Collections |
|-------|-------------|
| Library | `settings`, `import_batches`, `works` (identifiers, `resolution`, `identity`, `integrity`, `read_state`, `oa_fetch`, `edited` fields people own), `collections` (self parent), `collection_items`, `tags`, `work_tags`, `field_marks`, `saved_views`, `work_refs`, `oa_cache` |
| Reading | `files` (protected PDF, sha256, version, `current`, `text_state`, outline, position, thumbnail), `pages` (stored text items, lines, `origin` pdf_text / agent_ocr / none), `anchors` (page plus start and end offsets in the stored text; the quote is computed), `annotations` |
| Thinking | `projects` (question, color, `confidentiality`), `project_works`, `nodes` (question, claim, evidence; judged `status`; map place), `node_anchors`, `relations` (supports, opposes, informs; judged), `boards`, `board_items`, `notes` (typed blocks, including `image` {file, caption, width, align} and `table` {rows, header, align per column}), `note_files` (a note's pictures: `note` cascade, `file` protected up to 25 MB, `name`, `bytes`, `actor`; migration `1700000800_note_files.js`) |
| Your AI agent | `asks`, `proposals`, `activity`, plus the platform's `agent_requests` queue |
| Discovery | `searches`, `search_runs` (executed queries and counts), `candidates` |
| Writing | `manuscripts` (`style`, `template` = venue, `authors` [{name, affiliation, email}], `preamble` (own LaTeX, '' follows the venue), `style_folder` (a repository folder with a venue's .cls/.sty/.bst)), `ms_blocks` (types h1-h3, paragraph, quote, bullet, numbered, equation, abstract, figure, table, latex; segments text, cite, claim, math, ref; `data` figure {file, width} / table {rows, header, align} / latex {code}; typed, pasted and agent characters), `ms_changes` (tracked changes; before/after carry `data`), `ms_snapshots` (restore keeps block ids, so references survive), `ms_builds` (a PDF build: status running/done/failed, phase, pdf, pages, seconds, errors [{level, message, file, line, block or where}], `lines` (which main.tex lines each block wrote), `stamp` (hash of the source), `dir`; the latest 5 finished kept; migration `1700000900_ms_latex.js`), `reviews_received`, `response_items` |
| Screening | `reviews` (protocol, reasons, dual, blind, agent seat), `import_logs`, `review_records` (`ta`, `ft` states, `dup_of`), `decisions` (seat person, agent or final; the agent's basis is a word span of the abstract) |
| Search | FTS5 tables `works_fts`, `pages_fts`, `notes_fts` (maintained by `lib_search.js`) |
| To-do | `tasks` (`project` cascade, `status` todo/doing/waiting/done, `priority`, `due` YYYY-MM-DD or empty, `assignee` person/agent, `labels`, `checklist` [{id, text, done}], `links` [{kind, id}] to works, nodes, manuscripts, boards, notes of the same project, `recur`, `sort`, `done_at`, `actor`); migration `1700000300_research_tasks.js` |
| Experiments | `experiments` (`project` cascade, `number` per project, `kind`, `status` planned/running/paused/done/cancelled, `outcome` supports/refutes/inconclusive/failed or empty, `aim`, `hypothesis`, `variables` [{id, name, role condition/constant/measure, type, unit, levels, value, options}], `steps` [{id, text, minutes, done, done_at}], `materials`, `links` [{kind node/work, id}], `tags`, `planned_start`, `planned_end` (YYYY-MM-DD), `pinned`, `parent` (the experiment it repeats, not cascade), `started_at`, `ended_at`, `summary`, `next_steps`, `conclusion_by`), `exp_runs` (`number`, `values` keyed by variable id, `status` planned/done/failed/excluded, `note`, `recorded_at`), `exp_log` (`kind` note/observation/result/deviation/issue/system, `text`, `ref` {kind step/run, id}, `edits` [{action corrected/struck, text, kind, reason, at, actor}], `struck`, `struck_at`, `files` protected, `at`), `exp_templates` (`name`, `project` not cascade, `kind`, `aim`, `hypothesis`, `variables`, `steps`, `materials`, `tags`); migrations `1700000500_experiments.js`, `1700000600_experiments_v2.js` |
| Repository | `repo_items` (`project` cascade, `parent` the folder it is in (self relation, cascade; empty at the top), `kind` folder/file, `name` (unique in its folder ignoring case; no slashes, colons, asterisks, question marks, quotes, angle brackets or vertical bars), `file` protected (none for an empty file), `bytes`, `version`, `actor`), `repo_versions` (`item` cascade, `number`, `file` protected, `bytes`, `actor`, `made_at`: the versions before the current one), `projects.repo_ready` (the starter was made); migration `1700000700_repository.js` |

The core rules (enforced in operations, never in the screens):

- A citation points only at a citable work: `resolution` resolved, or manual and entered by a person (`lib_core.citable`). Refused with `source_unresolved`.
- An anchor is offsets into the app's own stored text of a file version; quotes are never matched as text.
- Relations follow a fixed grammar: evidence or claim supports or opposes a claim; evidence or claim informs a question (`lib_graph.grammarOk`).
- What your AI agent judges is `agent_proposed`; only a person sets `researcher_confirmed` (confirm effects deny the agent).
- Confidential projects refuse the agent token, hide their papers from the agent's lists and fire no triggers (`lib_core.guardProject`, `hiddenSql`).
- Your AI agent's screening decisions need a rationale, a confidence and (when there is an abstract) the word span they rest on.

## Operations

227 operations in the catalog (`agent-app ops <project>`), generated
from `pb/pb_hooks/cat_core.js`, `cat_library.js`,
`cat_reader.js`, `cat_projects.js`, `cat_agent.js`, `cat_discover.js`,
`cat_write.js`, `cat_screen.js`, `cat_tasks.js`, `cat_exp.js`. Each entry names its
handler (`lib_x.fn`), method, effect (read, capture, judge, confirm, change,
admin), agent rule (`allow`, `deny`, `propose`) and typed params. **After any
catalog change run `node tools/gen.mjs`**: it validates the catalog (read ops
are GET, confirm and admin ops deny the agent, `why` and `confirm` are
reserved) and writes `pb/pb_hooks/routes.pb.js`, `operations.json` and
`frontend/src/app/lib/ops.gen.ts`.

`lib_ops.js` dispatches every route: reads params (query, JSON or
multipart), authenticates (`lib_auth.context`: the agent by `X-A2App-Token`,
a person by the platform session cookie the page is served with), validates
params against the spec (unknown params refused), runs the handler or turns
an agent call into a proposal (`lib_agent.proposeOrRun`; the agent's reason
is the reserved `why`), and flushes the live-update bus. Destructive
operations the agent may run need `--confirm true`; without it the answer
says what would go.

Id lists (`works`, `nodes`, `relations`, ...) take one id, ids separated by
commas or spaces, or a JSON list (`lib_util.ids`).

## Agent triggers

Defined in `triggers.json`, generated by `node tools/gen_triggers.mjs` from
the recipes in `lib_guide.js` (each instruction ends by reminding the agent
that page text is data, not instructions). Screens ask through
`agent.request`, which fires server-side (`_triggers_lib.fire`); screens
follow progress by reading the platform's request queue. App hooks never
read or write that queue.

| Trigger | Fired when | What the agent does |
|---------|------------|--------------------|
| `papers_waiting` | PDFs added without metadata (setting `auto_identify`) | Reads the first pages, `works.identify` (a person confirms) or `works.identify-fail` |
| `ocr_requested` | Scanned pages (setting `auto_ocr`) | `pages.set-ocr` with word boxes so the pages become selectable |
| `question_asked` | A person asks a question | `asks.answer` with quote blocks on passages |
| `claims_requested` | "Map the claims" in a project | Proposes questions, claims and evidence by line ranges (`nodes.create-many`) |
| `access_requested` | "Find full text" on a paper | Open access first, then the person's own library access |
| `proposal_returned` | A person returns a proposal with a note | Revises and proposes again |
| `search_requested` | "Deep search" | More queries, `candidates.file` with relevance and reasons |
| `feed_review` | Saved-search alerts bring new candidates | `candidates.assess` |
| `draft_requested` | "Draft a passage" in writing | `ms.propose` tracked changes |
| `support_check_requested` | "Check each citation" | Field marks on blocks whose citation does not clearly support the sentence |
| `responses_requested` | "Split into comments" on a review received | `responses.add-items` with types, strategies and draft responses |
| `screening_requested` | "Your AI agent screens" | `screen.decide` as the blinded second seat |
| `references_requested` | A paper's reference list | Resolves references |
| `task_assigned` | A person sets a task's "For" to your AI agent (never in confidential projects) | `tasks.update --status doing`, does the work, ticks steps (`tasks.check`), writes what it did into the notes, then `tasks.complete` or hands it back (`--status waiting --assignee person` with the question) |
| `experiment_requested` | "Your AI agent" on an experiment: Plan this experiment, or Analyze the results | plan: `exp.update` with hypothesis, variables, steps, materials (keeps what the person wrote), maybe `exp.plan-runs`, a log note; analyze: `exp.results` + `exp.runs` + `exp.entries`, then `exp.conclude` (proposed until a person keeps it) |

## External data

| Source | Used for | Auth | Called from |
|--------|----------|------|-------------|
| api.crossref.org | DOI metadata, search, retraction notices (`updated-by`) | none (polite pool with the contact email from Settings) | `lib_registry.js` |
| api.openalex.org | Enrichment, open-access links, citation counts, search, citation map | none (contact email when set) | `lib_registry.js`, `lib_citemap.js` (30-day `oa_cache`) |
| export.arxiv.org, arxiv.org | arXiv metadata and search (Atom), PDFs | none | `lib_registry.js`, `lib_files.fetchOa` |
| eutils.ncbi.nlm.nih.gov | PubMed summaries, abstracts, search | none | `lib_registry.js`, `lib_screen.js` |
| openlibrary.org | Books by ISBN | none | `lib_registry.js` |
| github.com, release-assets.githubusercontent.com | Tectonic 0.17.0, once per computer (SHA-256 checked) | none | `engine/latex.mjs` |
| relay.fullyjustified.net, data1b.fullyjustified.net | LaTeX packages the first builds use (Tectonic's bundle) | none | Tectonic |
| Open-access hosts (any) | The PDF at OpenAlex's `best_oa_location.pdf_url` | none | `lib_files.fetchOa` |

All calls go through `lib_registry.fetch` (or `$http.send` with a timeout);
an unreachable registry answers `unreachable` (502) and papers stay
`unreachable` with a backoff retry (`retry_at`). Nothing is ever invented.

## Text engine

`engine/pdftext.mjs` runs pdf.js in Node (loaded from `frontend/node_modules`)
with a watchdog. Output per item `[str, left, top, height, width, angle, eol]`;
page text is each item's `str` plus "\n" after line ends; lines are stored
too, so your AI agent anchors by `--lines "a-b"` (with `from_char` /
`to_char`). The reader draws the same stored items as its selectable layer,
so a selection and an anchor always name the same characters.

## Typesetting engine (LaTeX)

`lib_ms.latexSource` writes `main.tex` from the blocks: the venue's preamble (`defaultPreamble`: document class, natbib's and hyperref's options passed first, the style folder's .sty files, fontspec under XeTeX or T1/Latin Modern under pdfLaTeX, amsmath, graphicx, booktabs, natbib or cite, hyperref) or the person's own; front matter per venue (article: \title/\author/\date/\maketitle and the abstract environment; elsarticle: frontmatter with \author[n]/\affiliation/\ead; IEEEtran: \IEEEauthorblockN/A); headings, lists, quotes, equations (`equation` with `\label{eq:<block>}`), figures (`figures/fig<n>.<ext>` at `width` % of \linewidth), tables (booktabs, a cell's line breaks as \shortstack), LaTeX blocks as they are; the AI-use declaration; `\bibliographystyle` (style folder's .bst, else IEEEtran, elsarticle-num/harv, unsrtnat or plainnat) and references.bib. Labels are `sec:`, `eq:`, `fig:`, `tab:` plus the block id; a reference reads "Figure~\ref" ("Fig." for IEEE and Elsevier), "Eq.~\eqref", "Table~\ref", "Section~\ref", or the bare number. `numbering()` gives the editor the numbers LaTeX will (IEEE: sections I, II-A; tables I, II) and each caption's own label.

`ms.build` writes the job into `pb_data/ro_latex/<build id>/` (main.tex, references.bib, the figures and the style folder's files copied from repository storage) and runs `node engine/latex.mjs start <dir>`, which starts the build detached and returns. `engine/latex.mjs run` downloads Tectonic 0.17.0 once per computer from its GitHub release into `RO_LATEX_HOME` (default `%LOCALAPPDATA%/research-os/latex`, `~/Library/Caches/...`, `~/.cache/...`), checks the SHA-256 pinned in `engine/latex.json`, then runs `tectonic -X compile main.tex --untrusted --keep-logs -Z continue-on-errors` (recoverable errors still give a PDF) and writes `status.json` (phase starting, engine, packages, compiling, done, failed; `beat` every 3 s; errors and warnings from Tectonic's `error:`/`warning: file:line:` lines; pages via pdf.js). The first build fetches the package bundle (relay.fullyjustified.net, data1b.fullyjustified.net), about 2.5 minutes; later builds take 3 to 15 seconds.

Confinement: LaTeX's \openout writes any path and Tectonic has no switch against it, even with --untrusted (tested), so the engine runs Tectonic where it can write only to the job folder and its cache: Windows Low integrity (the exe, the cache and the job folder are labelled with icacls; a write elsewhere fails with Access is denied and the build fails), macOS sandbox-exec, Linux bubblewrap (required; without it the build says to install it). Reads are not restricted, as in a normal TeX install.

`ms.build-status` (polled every 1.5 s by the PDF pane while a build runs) calls `settle`: it reads status.json, keeps the phase, and when done stores the PDF, the log and the errors placed by line on blocks (or `where` preamble/front), removes the job folder and keeps 5 finished builds. A build whose beat stops for 90 s fails (computer slept). `ro_jobs` settles builds nobody watches; `ro_hourly` sweeps folders no running build owns. `current` compares the build's `stamp` with a fresh source hash. One build runs per manuscript; a second `ms.build` answers the running one.

## Background jobs

- `ro_text` (every minute, runs 58 s): reads PDFs waiting for text; sets `ro_text_alive`; `lib_files.wake` drains inline for 8 s when no loop is alive.
- `ro_resolve` (every minute): resolves queued papers, then downloads due open-access PDFs (`lib_files.oaDue`); woken by the `ro_resolve_wake` flag.
- `ro_jobs` (every minute): re-asks your AI agent about work whose ask was refused or lost; settles PDF builds (`lib_ms.settleAll`).
- `ro_hourly` (minute 17): saved-search alerts, retraction re-checks, pruning old unsaved searches, left-over PDF build folders (`lib_ms.sweep`), `PRAGMA optimize`.
- All skip a round when `$app` is transactional.

## Frontend

`frontend/src/app/`: `App.tsx` (lazy pages, providers), `pages/` (Home,
Library, Paper, Reader, Projects, Project, Discover, Notes, Agent, Activity,
Settings), `components/` (`ui.tsx` primitives, `home/ProjectCarousel.tsx`,
`tasks/` (`TodoPanel.tsx` for Home and a project's Overview, `bits.tsx`: the round check, due words, priority flag), `Shell.tsx` rail and phone
bar, `AddPapers.tsx`, `Palette.tsx` (Ctrl K), `agent.tsx` (requests, asking,
deciding), `reader/` (pdf.js, geometry, page view, panels, promote dialog),
`library/`, `notes/` (`NoteEditor.tsx`, `ImageBlock.tsx` resize, align, caption, full size view; `TableBlock.tsx` cells and their keys, row and column menu; `clipboard.ts` pictures and spreadsheet ranges in a paste or a drop), `repo/` (the research repository: `Repository.tsx` tree, uploads, move and delete; `Preview.tsx` file, folder and selection views, editor, versions; `markdown.tsx` a small Markdown renderer drawing React elements; `transfer.ts` uploads with progress, dropped folders, zips; `shared.tsx`), `exp/` (Experiments: `Hub.tsx` every experiment of a project and the Overview panel, `Page.tsx` one experiment, `Runs.tsx` sheet and results, `Journal.tsx`, `Bench.tsx`, `shared.tsx`), `project/` (Tasks, ClaimsMap, Board,
Editor, Writing, Screening, canvas; `project/Editor.tsx` the manuscript blocks with `$` maths and `#` reference pickers, `Figure.tsx` repository picture or PDF with edge resize and the picker, `Pdf.tsx` the PDF pane, `useBuild`, LaTeX settings, zip exports)), `lib/` (`math.ts` KaTeX loaded on first use, `api.ts` ops client, `live.ts`
live views, `router.ts` hash routes, `themeColors.ts`, `zip.ts`, `docx.ts`).

## Gotchas

- A value inside a JSON parameter that must be one of a few (a variable's role, a card's color, a column's alignment, a comment's kind) goes through `util.choice`: absent gives the default, a wrong one is refused naming the allowed values. Never write `LIST.indexOf(v) >= 0 ? v : default`: your AI agent then never learns its mistake (an experiment variable sent as role "varied" silently became a measure, 2026-10-23).
- Hooks do not hot-reload (`--hooksWatch=false`): restart the app after any hook change. `require` modules inside each handler; only use `tx` inside `runInTransaction`.
- SQL aggregates over no rows are NULL (`SUM`, `MIN`, `MAX`): wrap them in `IFNULL(..., 0)` / `COALESCE`. A seeded database hides the mistake: Home failed on the first live start with an empty library (2026-10-22). Test on an empty database too: every read op as a person and as the agent, and every page.
- `activity.project` is plain text, not a relation: never filter it with `project.confidentiality`; `lib_activity.list` keeps confidential projects from the agent.
- Buttons: `variant="primary"` is the accent with a white icon and label (`--ro-primary`, deepened only when white would read below 4.5:1); ink fills stay for selected chips and toggles.
- PocketBase record filters (`findRecordsByFilter`) do not take SQL subqueries; use back-relations (`work.project_works_via_work.project ?= {:p}`) or list the ids first. Raw SQL (`util.rows`) is where subqueries go.
- The pdf.js worker is bundled with `?worker&url` so it ships as a `.js` file: PocketBase on Windows serves `.mjs` as `text/plain` and browsers refuse it as a module.
- Unlayered rules in `theme.css` beat Tailwind utilities (which live in a layer): a class rule that sets `position` silently cancelled `absolute inset-0` on the canvases. Do not set layout properties in `.ro-*` rules used together with utilities.
- The editor counts typed characters from the browser's native `beforeinput` (React's `onBeforeInput` is a stand-in without `inputType`). The counts drive the AI-use disclosure.
- The `@` citation picker leaves a `[data-caret]` marker element at the caret and replaces it; a saved `Range` does not survive focus moving into the picker. A block is never redrawn while it holds the marker.
- The reader's text layer uses pdf.js's end-of-content technique (`PageView.trackLayer`) so dragging over blank space does not jump the selection into a footnote or the next column.
- Colors: `themeColors.ts` derives every `--ro-*` token from the host theme. Words in state colors use the `-text` variants (`--ro-rel-supports-text`, `--ro-kind-evidence-text`); count badges use `--ro-badge` with white figures. Audit: 7 pages x 15 packs x 2 modes, every visible text element at 4.5:1 (or 3:1 large), 0 below.
- Live updates: no record is streamed. After each operation `lib_bus.flush` sends one message on the realtime topic `ro` naming the changed collections; `lib/live.ts` subscribes once at startup and reloads the views that read them. Checked 2026-10-23 against your AI agent: 29 screens (Home, Projects, Library, Paper, Overview, Claims map, Board, Reading list, an open note even while it is typed in, Notes list, To-do, Experiments and an experiment page, Repository tree, an open file and the sidebar counts, Writing with a proposal while typing and a PDF the agent built, the Agent page proposals, answers and rail badge, Screening, Activity) showed each change the agent made through `agent-app run` within about a second, with no reload (scratch `agent_live_ui.mjs`). Every stored collection is in `lib_bus.COLLECTIONS` except `users` (not shown) and `agent_requests` (followed directly); a new collection must be added there, to the three guard lists in `hooks.pb.js` and to the `Collection` type in `live.ts`, and every view must name what it shows in its `useLive` reads.
- Home (2026-10-22 redesign): setup card, then the project shelf (`components/home/ProjectCarousel.tsx`: every active project as a card on a 3D ring, cards on the app's card surface with the project's color as a top bar and in the canvas point cloud whose shape follows the stage and density the work in it; arrows, swipe, sideways wheel, ruler and Left/Right/Home/End; the last slot starts a project; no panel under the ruler, the user removed it), then the library panel (with continue reading) beside Needs you. The shelf sits on the page background with no panel.
- The Home shelf's front card has `transform: none` (and every card sits on whole pixels): a front card pulled toward the viewer (`translateZ`) or left inside the 3D stage drew its text soft, worst at 125% and 150% display scaling. Side cards keep their 3D transforms; the transition interpolates between `none` and them.
- Projects page cards (`components/project/ProjectTile.tsx`) follow the Home shelf card (the user's reference: a repository card): number with the stage as a quiet uppercase label, waiting-for-you or private tag, the point cloud in the project's color (animates on hover), name and one-line question, then the project's to-do as labelled fields (`tasks/bits.tsx ProjectTodo`, the same on the Home shelf card): to do, late (red when any), done "x of y", next task and its due day. `projects.list`/`get` return `stats.tasks_done` and `next_task` (`lib_tasks.nextOf`, the order of every task list); the old papers/read/claims/evidence/questions/updated fields were replaced at the user's request (2026-10-22). Fixed height 330px. Use `line-clamp-*` without `block` (it cancels the clamp). The Home shelf shows no stage caption under the front card.
- Pages remount only when the page or its main id changes (`App.tsx keyOf`); filters and tabs update in place with `replaceQuery`.
- Tables (comparison grids of papers by questions) were removed at the user's request on 2026-10-22 ("does not really serve any purpose"): `cat_tables.js`, `lib_grids.js`, `components/project/Table.tsx`, the `extraction_requested` trigger, the `table` recipe and the cell cap are gone; migration `1700000400_remove_tables.js` drops `grids`, `grid_columns`, `grid_rows`, `grid_cells` and their Activity entries, proposals, field marks and task links. A project URL with an unknown `view` opens the Overview.
- Experiments: run values are keyed by variable id, so renaming a variable keeps its data and removing one leaves its values (undo restores the variable whole). Screens make new variable, step and material ids themselves (8 lowercase letters or digits, `okId`) so a row being typed in keeps its React key when the save comes back. A sheet cell's editor is a fresh component per edit (`CellEditor`); keeping the draft in the cell and resetting it in an effect let fast typing land on the cancelled text. Journal files: `exp.file` streams pictures and PDFs inline and everything else as a download, with `nosniff` (`lib_files.streamName`).
- Experiments v2 (migration `1700000600_experiments_v2.js`): `verdict` is replaced by `outcome` (separate from status; `failed` is an outcome now, `paused` a status) and the log kind `change` by `deviation`; the value lists are replaced, not converted (the live data had one planned experiment and no entries). Journal entries are never deleted or edited in place: `exp.correct` (reason required: typo, recording, calculation, late, review, other) pushes the old text to `edits`, `exp.strike` (reason required) marks it struck and it stays legible; the entry count leaves struck ones out. `exp.log --at` back-dates an entry (never into the future) and it shows as late when written more than 10 minutes after. `exp.step` refuses while planned (`not_running`). `exp.repeat` makes a planned copy with the same plan (steps unticked, same variable ids) and `parent` set; deleting an experiment clears its repeats' `parent`. Templates from a confidential project are hidden from your AI agent.
- Experiment saves send whole lists (variables, steps, materials), so `saveExp` (`components/exp/shared.tsx`) queues saves per experiment and `useSynced` keeps what was typed while any are on their way; before that, fast typing in the Design table lost levels (an older save landed last). Only a status change announces `exp_log` and `projects`; the project sidebar takes its experiment count from `projects.get` stats instead of listing experiments. An edit costs 5 requests (it was 12), well under the platform's 300 `/api/ops` requests a minute; long browser test runs can still hit 429, so space them a minute apart.
- Repository (`lib_repo.js`, `cat_repo.js`): `lib_repo.ensure` makes the starter when a project is made (`projects.create`) and, for a project made before repositories, on `repo.init` (the page calls it the first time it opens; `repo.list` says `ready: false` until then). It reads the project again in a transaction, so two screens make it once; `repo_ready` keeps an emptied repository empty. Writes go through `locked` transactions; paths in their answers are read inside the transaction (outside it, folders just made are not visible yet and a new folder's path came back as its bare name).
- Repository versions: `newVersion` saves a `repo_versions` record with a copy of the current bytes (`$filesystem.fileFromPath` of its stored file) before the item takes the new file. PocketBase cannot store an empty file (`fileFromBytes('')` fails with "cannot create an empty file"), so an empty file has no stored bytes, `repo.file` answers an empty body for it, and the catalog's `content` is not required (a required string treats "" as missing, which refused New text file).
- Repository serving (`repo.file`): pictures, PDFs, sound and video inline with their type; text and code (HTML too) as text/plain with `Content-Security-Policy: sandbox`, never as a page; SVG is shown through a blob URL in an img (a picture cannot run scripts); everything else, and `--download`, as an attachment. A request naming `version` is cached immutable. Your AI agent gets `disk_path` instead of the bytes. PDFs are drawn with the reader's pdf.js (`components/reader/pdf.ts`): the browser's own viewer is not available headless and may be blocked in the host's frame.
- Repository uploads: the page sends files bound for one folder in batches (20 files or 64 MB a request) through an XMLHttpRequest for progress, and waits and retries on 429, so a folder of many small files stays under the platform's 300 `/api/ops` requests a minute. Go's multipart reader keeps only a file's base name, so a folder upload sends each batch's folder path as `path`. A drop from the computer is read with `webkitGetAsEntry` (dropped folders walked); entries must be taken before the drop event ends.
- Repository page: an item just made is opened before the list reloads, so the "address names something that is gone" check waits for it (`justMade`). Selected rows use `--ro-primary` with white text (the accent fails contrast in several packs). Unsaved edits ask before another item opens.
- Note pictures: `notes.add-image` uploads first and returns ids; the editor shows a local preview at once, puts the image block in place, and swaps in the id when the upload answers (`wire()` never saves a block still uploading). A block may only name a picture of its own note, so `notes.create` cannot hold pictures (add them once the note exists; your AI agent uses `notes.add-image --paths --append true`). `prune` deletes pictures no block uses on the next save, but only ten minutes after they were added, so a picture still being placed (or saved by an older save in flight) is never lost. Pictures are served by `notes.image` inline with their own type and cached immutable (an id's bytes never change); a pasted screenshot is renamed `pasted-<time>.png`.
- Note tables: cells are contentEditable and keep their text in the page while typed in; a focused cell is never rewritten from the data, so before rows or columns move (`letGo`) the focused cell is blurred first, and a pasted range writes its cells into the page directly. The server keeps a table a rectangle (every row padded to the widest), at most 500 rows by 30 columns, 4,000 characters a cell. Column widths are not offered: GitHub-style Markdown tables cannot keep them.
- The hub's Table switches to a compact list below 700px of container width; the page's top bar measures its own width (the More menu is a portal, so container queries do not reach it) and moves Run again into More on a phone. Journal day headings stick per day group (sticky inside one list item only stuck for that item).
- PocketBase hands record lists to JS as Go-backed arrays: `.reverse()` on one swaps entries wrongly (duplicates appeared). Map to plain objects first, then reverse.
- A file input's `files` is emptied by `input.value = ''`, and a drop's or paste's list when the event ends: copy it with `Array.from` before any state updater runs.
- Scratch instances for testing must create a superuser before `serve`, or PocketBase opens its installer page in the browser.
- Task writes go through `lib_tasks.locked`: the task is read afresh and saved inside one transaction (PocketBase runs transactions one at a time). Reading with `ctx.app` and saving later lost edits: a label and a step added a moment apart saved over each other because `save` writes the whole record. Errors thrown inside keep their status through the `failure` stash.
- To-do items (2026-10-22, user request): no check box anywhere a task is listed (board cards, list rows, the Overview and Home To-do panels); the priority flag takes its place (`PriorityPick`, click to change; urgent/high filled, medium blue, low grey, none faint). A task is completed from its panel (the round check or Status) or by dragging it to Done. Board columns end with an "Add a task" row (stays open after Enter for the next task; Esc or leaving it empty closes it); N opens it in To do. A drop moves the card at once (`moved` in `BoardView`, the same sort the server works out) and the server's answer takes over when the list has it; a line shows where the card will land.
- "This week" means today through 7 days ahead everywhere (Home tile, project filter, `tasks.list --due week`, `tasks.summary` counts); the project list's "This week" group starts tomorrow because Today has its own group.
- Home order: setup card, project shelf, library beside Needs you, To-do (`components/tasks/TodoPanel.tsx`, from `tasks.summary`; archived projects' tasks are left out as in the counts), then new candidates beside recent activity.
- Project Overview (2026-10-22, the user removed the journey steps strip and its Next box as useless): title and question, the number cards (papers, questions, claims, evidence), the proposals bar, the project's To-do (`TodoPanel project={p}`: tiles, in progress / waiting / no due day / high or urgent, a quick add line, every open task by day then priority with "N more open tasks"), then claims beside made here and recent. `projects.*` still return `journey` because the stage label on the project cards (`stageOf`) comes from it; the `Journey` steps component is deleted.

- Manuscript Enter: a new block's save answers before React has drawn it, so the caret goes there from an effect once the block is on the page (`focusNext` in `Editor`), not from a timer (the timer version never moved the caret; fixed 2026-10-22).
- One block's saves run one after another (`queued` in `Editor.tsx`), each reading the page when it runs: a caption save and a figure's data save never land out of order. `ms.save-block` without `content` empties the text, so a data save always sends the caption as it is.
- The editor's KaTeX preview is not the build: a command from the preamble (\newcommand) or a package draws as an amber note in the preview and still typesets.
- Tectonic prints each TeX error once per pass; `issues()` keeps one of each, and drops its own place-less warnings (about how it was run).

## Ownership map

- Editable: `frontend/src/app/`, `pb/pb_migrations/` (new files only once live), `pb/pb_hooks/*.pb.js`, `lib_*.js` and `cat_*.js` (not the `_*.js` system files), `engine/`, `tools/`, `operations.json`, `routes.pb.js` and `triggers.json` (generated), this file, `reference/`.
- System-managed (never edit): `frontend/src/kit/`, `frontend/src/main.tsx`, `frontend/src/config.gen.ts`, the underscore hooks (`pb/pb_hooks/_*.js`), `manifest.json` (its `capabilities` are written by the validate gate).

## 2026-10-23: explicit presentation reset

Settings has an opt-in Presentation demo panel. `demo.preview` returns deletion counts and an exact research-data fingerprint; `demo.reset` is a declared destructive change requiring that fingerprint, phrase `RESET AND LOAD DEMO`, acknowledgement, and agent `--confirm true` after explicit user consent. It refuses stale previews, running PDF builds, and agent access when a confidential project exists. A fixed whitelist of research collections is deleted through PocketBase record APIs inside one transaction; settings/users/schema/system collections stay intact. No optional backup is made; platform mandatory deployment backups are untouched. It is never called at boot, in a migration or by a trigger.

Four fixtures: Continual Learning Lab, Sleep & Memory Review, Battery Materials Bench, Urban Heat Field Study. Every project has 5 synthetic non-citable sources with exact-text PDFs/highlights, 6 proposed nodes/5 relations, 10 board cards, 2 proposed notes, 6 tasks, 8 experiment runs/4 journal entries, a manuscript with a tracked change, and 4 repository files. Sleep includes 12 screening records and 4 fictional reviewer comments. Data are labeled synthetic; no fake real-world identifiers, confirmed judgments, or external sends. `lib_demo.js` owns transactional maintenance and data links; `lib_demo_data.js` owns narratives. Repeating reset replaces fixtures, never duplicates them.
