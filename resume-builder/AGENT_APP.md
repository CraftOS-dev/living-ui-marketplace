# Resume Maker

> Per-project plan, context and index. Keep it current with every change.

## Plan

A resume maker for one person who keeps several resumes. One screen holds everything:
- **Header:** the resume selector with New, Rename, Duplicate and Delete, the score pill, Import, and the Export menu (PDF, Word, LaTeX, JSON backup).
- **Toolbar:** template, accent swatch, font, scale, line spacing and avatar shape.
- **Editor panel (left):** eleven tabs (Personal, Experience, Education, Skills, My Time, Achievements, Philosophy, Projects, Certs, Papers, Layout).
- **Preview (right):** a live A4 sheet in one of 34 templates.

Each resume is one JSON document in the `resume_state` collection. The screens write that document through PocketBase's records API; they call no operation.

An AI agent works on the same resumes through the `a2app` CLI. Every action a person can take on a resume's content, style or layout is an operation. The operations run a server copy of exactly what the screens do (`pb/pb_hooks/lib_agent.js`), so an agent edit is stored in the same shape and with the same defaults as a person's edit. What stays in the browser: printing to PDF, which resume or tab is open, and the page count of the preview.

**Start every agent session with `a2app <app> app app.guide`.** It returns the addressing rules, the note on leftover save copies, every section's fields, defaults and insert position, and the limits.

### The resume document

A resume has these parts. "Module" is the operation module that edits it. "Data key" is the key in `resumes.get` output and in the JSON backup.

| Part | Data key | Module | Fields an agent sets | A new item | New items go |
| --- | --- | --- | --- | --- | --- |
| Personal details | `personal` | `personal` | `fullName`, `jobTitle`, `email`, `phone`, `location`, `linkedin`, `github`, `website`, `photoUrl`, `summary` (multi-line) | — | — |
| Work experience | `experiences` | `experience` | `position`, `company`, `startDate`, `endDate`, `isCurrent`, `description` (multi-line) | company "New Company", position "Role / Title", start "2023", end "Present", current, one sample bullet | first |
| Education | `educations` | `education` | `degree`, `institution`, `startDate`, `endDate`, `gpa` | "University Name", "B.S. Degree", 2018 to 2022 | first |
| Skills | `skills` | `skills` | `name` (required on add), `category`, `proficiency` | category "Programming Languages", level Advanced | last |
| My Time | `myTime` | `mytime` | `label`, `percentage` (0–100), `color` (#rrggbb) | "New Activity Focus", 15, the next colour of `#f97316 #ec4899 #10b981 #f59e0b #8b5cf6 #06b6d4` by row count | last |
| Achievements | `mostProudOf` | `achievements` | `title`, `description`, `icon` | "Key Achievement", a placeholder description, icon trophy | last |
| Philosophy | `philosophy` | `philosophy` | `quote` (multi-line), `author` | — (one quote) | — |
| Projects | `projects` | `projects` | `title`, `technologies`, `link`, `description` (multi-line) | "Project Title", "React, TypeScript", a placeholder description | last |
| Certifications | `certifications` | `certifications` | `name`, `issuer`, `issueDate`, `url` | "Certification Name", "Issuing Organization", 2023 | last |
| Publications | `publications` | `publications` | `title`, `publisher`, `date`, `url`, `description` (multi-line) | "Publication Title", "Publisher / Journal", 2024, a placeholder description | last |
| Style | `style` | `style` | `templateId` (by `style.set-template`), `fontFamily`, `accentColor`, `fontSize`, `lineSpacing`, `photoShape` | — | — |
| Layout | `sectionVisibility`, `sectionOrder` | `layout` | show or hide a section; move it one step | — | — |

The document also holds `title` (the name in the selector) and `updatedAt`, which every write stamps.

**Items.**
- Every item has an `id`: `exp-<ms>`, `edu-<ms>`, `sk-<ms>`, `mt-<ms>`, `mp-<ms>`, `proj-<ms>`, `cert-<ms>`, `pub-<ms>`.
  - Resumes made by New (`resumes.create`) use `<prefix>-<ms>-<n>`.
  - The seeded resume uses `exp-1` and the like.
  - An imported resume keeps the document's ids.
- Item operations take `--item <id>`. Read the ids from `resumes.get --section <module>`, or from an `add` result.
- An add takes the item's fields directly. Any field not given keeps the placeholder above, exactly as the add button leaves it. So give every field you want to differ from the placeholder.

**Text formats.**
- Dates are free text, written as they should read ("Jan 2021", "2019", "Present").
- Bullets are lines starting with "• ", joined by line breaks. That is what the app's Enter key and its action-verb buttons produce (Spearheaded, Engineered, Architected, Orchestrated, Optimized, Accelerated, Redesigned, Pioneered, Scaled, Transformed).
- Links may omit `https://`; the preview adds it.

**Layout.**
- The Layout tab lists ten sections: `summary`, `experience`, `education`, `skills`, `myTime`, `mostProudOf`, `philosophy`, `projects`, `certifications`, `publications`.
- The layout operations take these names. They are not the module names: `myTime` and `mostProudOf` are the My Time and Achievements sections.
- Fourteen templates omit My Time and Philosophy; `style.options` lists each template's `omits`. An omitted section stays hidden whatever its visibility says.

### Common jobs

`<app>` is the app's directory, id (`resume-builder`) or name.

- **Find a resume:** `a2app <app> resumes resumes.list`. Rows are newest first.
  - A row with `shadowOf` set is a leftover save copy (see "One record per resume").
  - Every other operation on a resume takes `--resume <id>`.
- **Read it:**
  - `a2app <app> resumes resumes.get --resume <id>` returns the whole resume as the editor shows it: missing parts are filled the way the app fills them, and item ids are included.
  - Add `--section experience` (or `personal`, `education`, `skills`, `mytime`, `achievements`, `philosophy`, `projects`, `certifications`, `publications`, `style`, `layout`) for one part.
  - `layout` returns the Layout tab's rows: `visible`, `supportedByTemplate`, `shown`.
  - An uploaded photo is summarised (`data:image/png;base64,… (84 KB uploaded image, elided)`), never printed.
- **Build a resume from someone's CV:** import a complete JSON document (see "Importing a document"). This is one call, and it gives full control over item order.
  - The alternative is `resumes.create --title "…"` followed by replacing every part.
  - `resumes.create` fills the new resume with a random sample person (one of four), exactly like the New button. Remove or overwrite all of it, or the sample person's jobs, skills and certifications stay on the resume.
- **Edit a section:**
  - `a2app <app> experience experience.add --resume <id> --position "CTO" --company "Acme" --startDate "2019" --isCurrent false --endDate "2023" --description "• Led the platform team of 12"`
  - then `experience.update --resume <id> --item <exp id> --company "…"`
  - and `experience.remove --resume <id> --item <exp id>`.
  - The other sections work the same way with their own fields.
  - The current-role rule:
    - `--isCurrent true` sets the end date to "Present", and `--isCurrent false` clears it, as the Current checkbox does.
    - An `--endDate` is refused while the item is current, because the app disables that field. Send `--isCurrent false` in the same call.
- **Order items:** the app cannot reorder items inside a section, and neither can an operation.
  - New experience and education items go first; everything else goes last.
  - For newest-first experience, add the oldest job first. To move an item, remove it and add it again in the right turn.
- **Personal details and photo:**
  - `personal.update` changes any of the ten fields; `--photoUrl ""` removes the photo.
  - `personal.set-photo --resume <id> --path <absolute image path>` uploads a png, jpg, gif, webp, svg, bmp or avif file under 700 KB. It is stored inside the resume as a data URL, like the app's upload button.
- **Philosophy:** `philosophy.update --quote "…" --author "…"`. An empty author shows the person's name, as the app does.
- **Template and style:**
  - `style.options` lists the 34 templates (label, group, default font, omitted sections), the 8 accent swatches, fonts, sizes, spacings and photo shapes.
  - `style.set-template --resume <id> --template ivy_league` behaves like the template dropdown. It also resets the font to the template's default and sets every section's visibility to what the template supports, so hidden sections may come back.
  - `style.update` sets `accentColor`, `fontFamily`, `fontSize`, `lineSpacing` and/or `photoShape`.
- **Layout:**
  - `layout.set-visibility --resume <id> --section mostProudOf --visible false` hides a section.
  - `layout.move --resume <id> --section summary --direction down` moves a section one step.
  - Moving the first section up, or the last one down, is refused.
- **Score:** `resumes.score --resume <id>` returns the header pill and the breakdown dialog: `score` (0–100), the five 20-point groups and the same tips the app shows.
- **Export:** `resumes.export --resume <id> --format json|word|latex` returns `filename`, `mimeType` and `content`, byte for byte what the Export menu downloads.
  - Word is an HTML `.doc`; the content starts with a byte-order mark.
  - Write `content` to a file yourself.
  - **PDF cannot be made by an operation.** The app prints through the browser's print dialog: ask the person to click Export, then PDF.
- **Rename, duplicate, delete:**
  - `resumes.rename --resume <id> --title "…"`.
  - `resumes.duplicate --resume <id>` makes a copy named "<title> Duplicate".
  - `resumes.delete --resume <id>` is destructive: ask the person, then repeat it with `--approve <key>`. Deleting the last resume leaves the app's default sample resume "Software Engineer Resume", as the app does.

### Importing a document

`resumes.import` makes a new resume from a JSON backup, like the Import button. Pass exactly one of:
- `--json`: the document text. With the CLI, `--json @backup.json` reads it from that file and `--json @-` reads it from standard input. Both reach the app verbatim, so no shell quoting is needed.
- `--path`: the absolute path of a `.json` file, which the app reads on its own machine.

The same file can be produced with `resumes.export --format json` and edited.

The app's own test applies first. The document must be JSON with a truthy `personal`, `experiences` or `title`. If it is not, the call is refused with the app's own message "Failed to import JSON file. Please ensure it is a valid resume export."

Then a shape check runs, so the stored resume can never break the app:
- every field has the type the app's own data has;
- every list item has its required fields and a unique `id`;
- `proficiency` and `icon` are from their lists;
- `style.templateId` is one of the 34;
- `sectionOrder` names valid sections once each.

What is stored, and what the result reports:
- The new resume is the app's sample resume overlaid with the document, as the app does. Any part the document lacks keeps the sample's content (Alex River's jobs, skills and so on). The result lists those parts in `filledFromSample`, for example `["myTime", "personal.phone"]`.
- Unknown keys are stored as the app stores them and listed in `unknownKeys`.
- Experience `location`, education `fieldOfStudy`, `style.secondaryColor` and `style.showPageNumbers` have no control in the app. A document is the only way to set them, as it is for a person.
- The title is the document's `title`, else "<fullName> Resume", else "Imported Resume".

### One record per resume

**How the app stores a resume:**
- The app shows every `resume_state` record whose `data` has a `personal` part, and uses the **record id** as the resume's id.
- Opening, editing, renaming, reloading and deleting all act on that one record. The app saves the whole resume into it 600 ms after the last edit; opening or switching to a resume writes nothing.
- New, Duplicate and Import create a new record at once, with `key` and `data.id` equal to its record id. Delete removes the record. Agent operations store resumes the same way.

**Leftover save copies:**
- Older versions of the app saved a person's edits into a second record whose `key` is the id of the resume that was open. Such records may still exist.
- `resumes.list` shows each one as a separate resume with the same title, with `shadowOf` set to the original's id. It may hold the person's newest edits.
- It is an ordinary resume now: edits to it stay. Ask the person which one to keep before deleting either.

### What a person sees after an agent change

The app reads the database once, when it opens. It does not see changes made since.

- **Stale editor:** an editor that is open while the agent works keeps showing its old version. Its next edit saves that whole version over the agent's change.
- **Edits made offline:** an edit the person made while the app could not reach its database is saved when they next open the app, over any change you made to that resume meanwhile. Their other resumes show your changes.
- **Reload to see the change:** ask the person to reload the app before they edit that resume again. They then see the agent's version.
- **One editor at a time:** do not let the person and the agent edit the same resume at the same time.
- **Newly made resumes:** after a reload the app opens the resume that was open before. A resume the agent created or imported appears in the selector, where the person picks it.

### Stricter than the screens

The operations accept what the screens' controls can produce, and refuse what those controls make impossible. Each refusal has a code and a message that names the parameter.

- `invalid_param`:
  - One-line fields (every field not marked multi-line above) refuse line breaks. Multi-line fields store line breaks as `\n`.
  - `accentColor` is one of the 8 swatches only. The seeded resume's `#6366f1` is not a swatch; it stays until changed.
  - `percentage` is a number from 0 to 100 (the app's box is meant for 1–100; clearing it stores 0). `color` is `#rrggbb`, stored lower-case like the colour picker.
  - `skills.add` needs a non-empty `name`, as the quick-add form does.
  - `resumes.create` and `resumes.rename` refuse an empty title; titles are trimmed.
  - Enum parameters accept only their listed values.
- `unknown_param`: any parameter the operation does not take is refused, never ignored.
  - `location`, `fieldOfStudy`, `secondaryColor` and `showPageNumbers` point to `resumes.import`.
  - `templateId` points to `style.set-template`.
- `refused`:
  - an end date while the experience is current;
  - moving the first section up or the last one down;
  - a section the resume's Layout tab does not list.
- `not_found`: an unknown resume or item.
- `not_a_resume`: a record without a `personal` part, which the app does not show.
- `not_a_resume_export` and `invalid_shape`: an import that fails the app's test or the shape check.
- `too_large`: a photo over 700 KB, or a resume that would exceed PocketBase's 1 MB limit for the `data` field. The app itself fails silently there.
- `browser_only`: `resumes.export --format pdf`.

## Modules

Every operation and every collection an agent can reach belongs to one module. `a2app <app>` lists them; `a2app <app> <module>` lists a module's operations.

| Module | Operations | Collections |
| --- | --- | --- |
| `app` | 1 | — |
| `resumes` | 9 | `resume_state` |
| `style` | 3 | — |
| `layout` | 2 | — |
| `personal` | 2 | — |
| `philosophy` | 1 | — |
| `experience` | 3 | — |
| `education` | 3 | — |
| `skills` | 3 | — |
| `mytime` | 3 | — |
| `achievements` | 3 | — |
| `projects` | 3 | — |
| `certifications` | 3 | — |
| `publications` | 3 | — |

## Entities

See `reference/requirements.md` § Data Requirements.

| Collection | Purpose | Notes |
|------------|---------|-------|
| resume_state | One record per resume: `key` (text, required) and `data` (the whole resume as JSON, at most 1 MB) | Seeded with one sample resume (`key` "default_resume", "Senior Software Engineer CV"). Resumes made since have `key` equal to their record id; a record whose `key` is another record's id is a leftover save copy from older app versions. No unique index on `key` |

`a2app <app> data resume_state …` reaches the raw records, but a raw write checks only that `data` is JSON. A malformed resume that the app opens crashes it into its error screen on every load. Edit resumes through the operations, which keep the shape.

## Operations

Call an operation with `a2app <app> <module> <operation> --param value` (`<app>` is the app directory, its id or its name). A destructive one first answers `approval_required` with an approval key: ask the person, then repeat the call with `--approve <key>`. `a2app <app> --find <word>` locates an operation by name. Every operation below runs on the server in the app's own code: the handler its screens use where they call one, otherwise a server copy of exactly what the screens do.

### app

- `app.guide` *(read-only)* — How to drive Resume Maker: resume and item ids, leftover save copies, reload to see changes, sample content, every section's fields and defaults, limits. Read first.

### resumes

- `resumes.list` *(read-only)* — Resumes (resume_state records) as the app's dropdown shows them, newest first. A row with shadowOf set is a save copy an older version of the app made of another resume; it is an ordinary resume now.
- `resumes.get` *(read-only)* — One resume exactly as the editor shows it (missing parts filled the way the app fills them), with item ids; or one section. layout = the Layout tab rows. Params: `resume` (string, required), `section` (personal|experience|education|skills|mytime|achievements|philosophy|projects|certifications|publications|style|layout).
- `resumes.score` *(read-only)* — The app's resume score: 0-100, five 20-point groups and the same improvement tips. Params: `resume` (string, required).
- `resumes.export` *(read-only)* — The file the app's Export menu downloads: json backup, word (.doc) or latex (.tex), as filename + content. PDF is printed by the browser only. Params: `resume` (string, required), `format` (json|word|latex, required).
- `resumes.create` — New resume like the New button: filled with a random sample person. Replace its sections next, or use resumes.import. Shows in the app after it is reloaded. Params: `title` (string).
- `resumes.import` — New resume from a JSON backup, like Import. The app's own check plus a shape check; parts the document lacks keep the app's sample content (see filledFromSample). Shows in the app after it is reloaded. Params: `json` (string), `path` (string).
- `resumes.duplicate` — Copy a resume like the Duplicate button; the copy's title gets ' Duplicate' appended. Shows in the app after it is reloaded. Params: `resume` (string, required).
- `resumes.rename` — Rename a resume. Shows in the app after it is reloaded. Params: `resume` (string, required), `title` (string, required).
- `resumes.delete` *(destructive)* — Delete a resume (the app asks for confirmation). Deleting the last one leaves the app's default sample resume, as the app does. Shows in the app after it is reloaded. Params: `resume` (string, required).

### style

- `style.options` *(read-only)* — The template list (label, group, default font, sections it omits), the 8 accent swatches, fonts, sizes, line spacings and photo shapes.
- `style.set-template` — Switch template. Like the app, this resets the font to the template's default and re-applies the template's section visibility. Shows in the app after it is reloaded. Params: `resume` (string, required), `template` (executive_classic|executive_one|high_performer|enhancv_modern_v2|enhancv_modern|enhancv_classic|ivy_league_v3|imprint|ivy_league_v2|ivy_league|pure|double_column_banking|collegiate|crest|crest_projects|executive_serif|single_column_v2|boxed_manager|compact_two_col|enhancv_compact|enhancv_contemporary|data_timeline|enhancv_minimal|single_column|timeline_tech|creative_banner|enhancv_creative|double_column|elegant|elegant_v2|polished|enhancv_stylish|systems_tech|timeline, required).
- `style.update` — Change accent colour, font, size, line spacing and/or avatar shape. Shows in the app after it is reloaded. Params: `resume` (string, required), `accentColor` (#f97316|#0f172a|#0c2340|#004d40|#1d4ed8|#10b981|#8b5cf6|#d97706), `fontFamily` (Default|Outfit|Inter|Playfair Display|Space Mono|Plus Jakarta Sans), `fontSize` (small|medium|large), `lineSpacing` (compact|normal|spacious), `photoShape` (round|square|hidden).

### layout

- `layout.set-visibility` — Show or hide a section (the Layout tab's eye button). A template that omits the section never shows it. Shows in the app after it is reloaded. Params: `resume` (string, required), `section` (summary|experience|education|skills|myTime|mostProudOf|philosophy|projects|certifications|publications, required), `visible` (boolean, required).
- `layout.move` — Move a section one step up or down in the Layout tab order. Shows in the app after it is reloaded. Params: `resume` (string, required), `section` (summary|experience|education|skills|myTime|mostProudOf|philosophy|projects|certifications|publications, required), `direction` (up|down, required).

### personal

- `personal.update` — Change name, headline, contact details, links, photo URL and/or summary. Shows in the app after it is reloaded. Params: `resume` (string, required), `fullName` (string), `jobTitle` (string), `email` (string), `phone` (string), `location` (string), `linkedin` (string), `github` (string), `website` (string), `photoUrl` (string), `summary` (string).
- `personal.set-photo` — Upload a profile photo from a file, like 'Upload Image File' (stored in the resume as the app stores uploads). Shows in the app after it is reloaded. Params: `resume` (string, required), `path` (string, required).

### philosophy

- `philosophy.update` — Change the work-philosophy quote and/or its author. Shows in the app after it is reloaded. Params: `resume` (string, required), `quote` (string), `author` (string).

### experience

- `experience.add` — Add a work experience position like Add Position (goes first); fields not given keep the app's placeholder values. Shows in the app after it is reloaded. Params: `resume` (string, required), `position` (string), `company` (string), `startDate` (string), `endDate` (string), `isCurrent` (boolean), `description` (string).
- `experience.update` — Change fields of one work experience position. Shows in the app after it is reloaded. Params: `resume` (string, required), `item` (string, required), `position` (string), `company` (string), `startDate` (string), `endDate` (string), `isCurrent` (boolean), `description` (string).
- `experience.remove` — Remove one work experience position (one click in the app, no confirmation); the result holds the removed item. Shows in the app after it is reloaded. Params: `resume` (string, required), `item` (string, required).

### education

- `education.add` — Add a degree like Add Degree (goes first); fields not given keep the app's placeholder values. Shows in the app after it is reloaded. Params: `resume` (string, required), `degree` (string), `institution` (string), `startDate` (string), `endDate` (string), `gpa` (string).
- `education.update` — Change fields of one degree. Shows in the app after it is reloaded. Params: `resume` (string, required), `item` (string, required), `degree` (string), `institution` (string), `startDate` (string), `endDate` (string), `gpa` (string).
- `education.remove` — Remove one degree (one click in the app, no confirmation); the result holds the removed item. Shows in the app after it is reloaded. Params: `resume` (string, required), `item` (string, required).

### skills

- `skills.add` — Add a skill like the quick-add form (goes last); fields not given keep the app's placeholder values. Shows in the app after it is reloaded. Params: `resume` (string, required), `name` (string), `category` (string), `proficiency` (Beginner|Intermediate|Advanced|Expert).
- `skills.update` — Change fields of one skill. Shows in the app after it is reloaded. Params: `resume` (string, required), `item` (string, required), `name` (string), `category` (string), `proficiency` (Beginner|Intermediate|Advanced|Expert).
- `skills.remove` — Remove one skill (one click in the app, no confirmation); the result holds the removed item. Shows in the app after it is reloaded. Params: `resume` (string, required), `item` (string, required).

### mytime

- `mytime.add` — Add a My Time row like Add Focus (goes last); fields not given keep the app's placeholder values. Shows in the app after it is reloaded. Params: `resume` (string, required), `label` (string), `percentage` (number), `color` (string).
- `mytime.update` — Change fields of one My Time row. Shows in the app after it is reloaded. Params: `resume` (string, required), `item` (string, required), `label` (string), `percentage` (number), `color` (string).
- `mytime.remove` — Remove one My Time row (one click in the app, no confirmation); the result holds the removed item. Shows in the app after it is reloaded. Params: `resume` (string, required), `item` (string, required).

### achievements

- `achievements.add` — Add a achievement badge like Add Highlight (goes last); fields not given keep the app's placeholder values. Shows in the app after it is reloaded. Params: `resume` (string, required), `title` (string), `description` (string), `icon` (trophy|rocket|target|star|award|zap|heart|flame).
- `achievements.update` — Change fields of one achievement badge. Shows in the app after it is reloaded. Params: `resume` (string, required), `item` (string, required), `title` (string), `description` (string), `icon` (trophy|rocket|target|star|award|zap|heart|flame).
- `achievements.remove` — Remove one achievement badge (one click in the app, no confirmation); the result holds the removed item. Shows in the app after it is reloaded. Params: `resume` (string, required), `item` (string, required).

### projects

- `projects.add` — Add a project like Add Project (goes last); fields not given keep the app's placeholder values. Shows in the app after it is reloaded. Params: `resume` (string, required), `title` (string), `technologies` (string), `link` (string), `description` (string).
- `projects.update` — Change fields of one project. Shows in the app after it is reloaded. Params: `resume` (string, required), `item` (string, required), `title` (string), `technologies` (string), `link` (string), `description` (string).
- `projects.remove` — Remove one project (one click in the app, no confirmation); the result holds the removed item. Shows in the app after it is reloaded. Params: `resume` (string, required), `item` (string, required).

### certifications

- `certifications.add` — Add a certification like Add Cert (goes last); fields not given keep the app's placeholder values. Shows in the app after it is reloaded. Params: `resume` (string, required), `name` (string), `issuer` (string), `issueDate` (string), `url` (string).
- `certifications.update` — Change fields of one certification. Shows in the app after it is reloaded. Params: `resume` (string, required), `item` (string, required), `name` (string), `issuer` (string), `issueDate` (string), `url` (string).
- `certifications.remove` — Remove one certification (one click in the app, no confirmation); the result holds the removed item. Shows in the app after it is reloaded. Params: `resume` (string, required), `item` (string, required).

### publications

- `publications.add` — Add a publication like Add Paper (goes last); fields not given keep the app's placeholder values. Shows in the app after it is reloaded. Params: `resume` (string, required), `title` (string), `publisher` (string), `date` (string), `url` (string), `description` (string).
- `publications.update` — Change fields of one publication. Shows in the app after it is reloaded. Params: `resume` (string, required), `item` (string, required), `title` (string), `publisher` (string), `date` (string), `url` (string), `description` (string).
- `publications.remove` — Remove one publication (one click in the app, no confirmation); the result holds the removed item. Shows in the app after it is reloaded. Params: `resume` (string, required), `item` (string, required).

### Results

- Every operation's result carries `success: true` and the data it names.
- Writes also return `resume` (`id`, `title`, `updatedAt`) and the touched item or part.
- Adds return the `item` and its `position` (`first` or `last`); removes return the `removed` item, so it can be added back.
- My Time results add `total` and `totalIs100`, the form's "recommended to equal 100%" hint.
- `count` is the section's size after the change.
- Results never print an uploaded photo.

## Conventions

### Code

- `pb/pb_hooks/agent_ops.pb.js` holds one route per operation at the app's own path, `/api/ops/<group>/<verb>`: GET for reads, POST for writes. `resumes.duplicate` is at `/api/ops/resumes/copy`.
- The generated `a2app_routes.pb.js` serves each operation to agents as `POST /api/ops/<name>` by calling the same handler.
- The logic is `pb/pb_hooks/lib_agent.js`, required inside each handler. Every rule there cites the UI line it copies.
- It ports these from the frontend: the sample resume (`data/presets.ts`), the four sample people (`utils/randomCandidateGenerator.ts`), the template list (`components/Toolbar.tsx`), default fonts (`types/resume.ts`), template sections (`utils/templateSections.ts`), the score (`utils/scoreCalculator.ts`), and the Word and LaTeX exports (`components/Header.tsx`, copied verbatim). If the frontend changes, change these copies with it.
- `pb/pb_hooks/ops.pb.js` keeps the published app's route `POST /api/ops/resumes/duplicate` (body `{ id }`). It runs the `resumes.duplicate` handler and also answers the new copy's `id` and `title` at the top level, as it was published.

### Gotchas

- **Writes:** every write reads, changes and saves one whole resume inside a transaction, which serializes concurrent agent calls on it.
- **Storage format:** `rec.set('data', object)` stores the same bytes the app's own save stores; a pre-stringified JSON string would not. Read with `JSON.parse(rec.getString('data'))`.
- **Normalizing:** reads fill missing parts exactly as the app does on load (`ResumeContext.tsx`). A write stores that filled document, as the app's own save would.
- **Hooks do not hot-reload** (`--hooksWatch=false`): restart the app after a hook change.
- **Response text:** `e.json` escapes `<`, `>` and `&` in response text, so agent-facing text uses `{id}` placeholders.
- **Fonts:** the resume fonts (Inter, Outfit, Playfair Display, Space Mono, Plus Jakarta Sans) are not bundled. The preview uses them when the machine has them installed.

### Ownership map

- **System-owned (hash-locked, from the `blueprint-pocketbase-kit` toolkit — never edit):** `manifest.json`, `pb-serve.mjs`, `pb-fetch.mjs`, `pb-check.mjs`, `pb-build.mjs`, `pb/pb_hooks/_a2app.pb.js`, `pb/pb_hooks/_a2app_impl.js`, `pb/pb_hooks/_a2app_rules.js`, `pb/pb_hooks/_compat_lib.js`, `pb/pb_hooks/_compat_rules.js`, `pb/pb_hooks/_compat_system.js`, `pb/pb_hooks/_system.pb.js`, `pb/pb_hooks/_triggers.pb.js`, `pb/pb_hooks/_triggers_lib.js`, `pb/pb_hooks/_craftbot_bridge.js`.
- **Agent-owned:** `operations.json`, `events.json`, `AGENT_APP.md`, `reference/`, `pb/pb_hooks/a2app_routes.pb.js` (regenerate with `tools/agent-app-migrate` rather than hand-edit), every other file under `pb/pb_hooks/` and `pb/pb_migrations/`, and `frontend/`.

## Checklist

Build and verification tasks live in `reference/tasks.md`.
