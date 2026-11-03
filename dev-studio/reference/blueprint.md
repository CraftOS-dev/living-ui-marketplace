# Blueprint reference — react-node

A React (Vite) View + a Hono server + a SQLite store, with the A2App adapter
mounted as embedded `@a2app/adapter-core` middleware.

Where the `creator`/`modify` skill says "per your stack", the answer is here. If
this file and the source disagree, the source wins.

## Read this first

The scaffold gives you a complete, runnable starter app — the A2App adapter, a
working data model, and a full React View — which you edit into your own:

- **entities** — the data model in `a2app.schema.mjs` (see **Schema** below);
- **custom operations** — declared in `schema.operations` + `operations.json` and
  implemented in `schema.operationRunners` (see **Operations**);
- **the View** — the React app in `index.html` + `src/`, built on the shipped
  shared components and design tokens (see **The View**).

The starter models a to-do list; replace it with your own entities, operations,
and screens.

## File map — who owns what

Every file that ships on a fresh scaffold, in the order you meet them:

| Path | Owner | What it is |
|---|---|---|
| `a2app.schema.mjs` | **YOURS** | the data model + operations: exports `schema = { entities, operations, operationRunners }`, each entity carrying `module`/`summary`/`fields`/`seed`. Edit this to evolve the app; `describe`/`schemaVersion` derive from it. |
| `operations.json` | **YOURS** | the operation declarations `describe` and approval read (name, module, typed params, entity, appliesWhen, flags). Byte-mirror of `schema.operations`. |
| `index.html` | **YOURS** | the Vite entry: links `tokens.css`/`ui.css`, mounts `#root`, loads `src/main.jsx`. |
| `src/main.jsx` | **YOURS** | React root: StrictMode + ToastProvider + App; imports `updater.js` to start the update watcher. |
| `src/App.jsx` | **YOURS** | the View logic: state machine (loading/ready/error), add/advance/delete actions, filters, the `a2app:datachange` listener, boot. |
| `src/api.js` | **YOURS** | the one fetch wrapper — 10 s timeout, GET retry-once, readable error messages. |
| `src/Icon.jsx` · `src/toast.jsx` · `src/ConfirmDialog.jsx` · `src/format.js` | **YOURS** | the shared pieces — icon set, `useToast`, `useConfirm` (in-app dialog, never `window.confirm`), day formatting. One impl each; compose, never re-implement. |
| `src/updater.js` | **YOURS** | the runtime bridge to the system-owned update watcher. Keep it when you rewrite the View. |
| `public/tokens.css` | **YOURS** | design tokens (the kit sheet): foundation `--agent-app-*` + semantic bridge, light + dark + style packs. Re-point values; keep the NAMES stable. |
| `public/ui.css` | **YOURS** | component styles (buttons, cards, list rows, dialog, toasts). Consumes semantic tokens only. |
| `vite.config.js` | **YOURS** | the View build: React plugin, `dist/` output, dev-server proxy to the running app. |
| `AGENT_APP.md` | **YOURS** | this app's index: plan, modules, entities, operations, conventions, checklist. |
| `reference/requirements.md` | **YOURS** | the binding spec — Part A (SRS) + Part B (tech spec + Quality Conformance). |
| `reference/tasks.md` | **YOURS** | the build ledger — one task per feature/quality item, ticked as you complete it. |
| `reference/blueprint.md` | reference | this file — the stack map. |
| `.gitignore` | **YOURS** | ignores `data/`, `dist/`, credentials, and framework state. Extend for your own artifacts. |
| `package.json` | build | dependencies (react, hono, better-sqlite3, adapter-core) + scripts (`build` = vite build, `dev:ui` = vite dev server). Referenced by the pipeline. |
| `manifest.json` | SYSTEM (hash-locked) | app identity, `modules[]`, `authMode`, `pipeline` (install/build/start/health). Change modules via the CLI, never by hand-editing a locked field. |
| `server.mjs` | SYSTEM (hash-locked) | the Hono server + `@a2app/adapter-core` middleware + the SQLite binding: serves the records API, identity, describe, the built View (`dist/`), and `/_a2app/update.js`. Never edit. |
| `a2app-update.js` | SYSTEM (hash-locked) | the update watcher served at `/_a2app/update.js` — detects code vs. data staleness in an open tab. Never edit. |
| `scripts/dev-prepare.mjs` | lifecycle | run by `agent-app dev`: builds a fresh, seeded SQLite store in an isolated dir. Leave it alone. |
| `scripts/promote-apply.mjs` | lifecycle | run by `agent-app promote`: applies to live after a mandatory backup. Leave it alone. |
| `dist/` | build output | the compiled View (`npm run build`). Git-ignored; served by `server.mjs`. Never edit by hand. |
| `data/` | runtime | the live SQLite database (git-ignored, created on first boot). Never edit by hand; never commit. |

SYSTEM files are hashed in `.a2app/system-hashes.json`; the gate fails the build
if one changes. Need a variant of a shared component? Wrap it in `src/`, never
edit the locked original.

## Mental model

- The **adapter is the only agent surface.** A human uses the View; an agent
  operates the same records through A2App. Both converge on the SQLite store.
- **`a2app.schema.mjs` is the single source of truth for the model.** You never
  hand-write `describe` — the adapter derives it (and `schemaVersion`) from your
  schema. Change the schema, and every A2App screen updates.
- **The store is schema-derived and additive.** Records are JSON rows in one
  SQLite table keyed (entity, id); there are no migration files on this stack.
  Add a field to the schema and it is simply available; existing rows keep
  their stored values. This is the opposite of the pocketbase stack — do not go
  looking for a `migrations/` directory.
- **The View is served BUILT.** `vite build` compiles `index.html` + `src/`
  into `dist/`; `server.mjs` serves `dist/` with real cache validators. A
  source edit does nothing until the next build.

## Schema — entities & fields

Edit `a2app.schema.mjs`. It exports one object:

```js
export const schema = {
  entities: {
    <entity>: {
      module: "<module-from-manifest>",   // REQUIRED — every entity names its module
      summary: "one line shown beside it on the module screen",
      fields: [
        { name: "title", type: "string", required: true, max: 200 },
        { name: "status", type: "enum", values: ["todo", "doing", "done"] },
        { name: "due", type: "string", max: 10, dayKey: true },  // "YYYY-MM-DD"
        { name: "created", type: "datetime", readOnly: true },   // server-set
      ],
      seed: [ { id: "…", title: "…", created: "2026-01-01T00:00:00.000Z" } ],
    },
  },
  operations: [ /* see below */ ],
  operationRunners: { /* see below */ },
};
```

**Field types** (the A2App protocol vocabulary): `string` · `number` ·
`boolean` · `datetime` · `enum` (+ `values`) · `ref` (+ `entity`) · `list<enum>`
· `list<ref>` · `json` · `binary`. Field flags: `required`, `readOnly`
(server-managed, agents may not write it), `max`, and `dayKey: true` for a
whole-day text field advertised as `YYYY-MM-DD`.

**Seeding:** `entities.<name>.seed` is applied when the store is built fresh
(first boot, `dev`, and after `promote`). Seeded data survives; test data you add
at runtime does not carry to a fresh DB.

## Operations — anything beyond plain CRUD

Plain create/read/update/delete needs no operation — the records API covers it.
A declared operation is required only for behavior beyond that. Declare it in
**two places that must agree**, then implement it:

1. `schema.operations` (in `a2app.schema.mjs`) — and the identical row in
   `operations.json`.
2. `schema.operationRunners` — the implementation.

```js
operations: [
  { name: "clear-done", description: "Delete every done task.",
    destructive: true, module: "planning", params: {} },
  { name: "complete-task", description: "Mark one task done.",
    module: "planning", entity: "tasks",
    appliesWhen: { field: "status", ne: "done" },
    params: { task: { type: "ref", entity: "tasks", required: true } } },
],
operationRunners: {
  "clear-done": (_args, _ctx, { store }) => {
    let removed = 0;
    for (const rec of store.list("tasks")) {
      if (rec.status === "done" && store.remove("tasks", rec.id)) removed++;
    }
    return { removed };
  },
  "complete-task": (args, _ctx, { store }) => {
    const task = store.get("tasks", args?.task);
    /* … */
    store.put("tasks", task);
    return { ok: true };
  },
},
```

- **Runner signature:** `(args, ctx, { store, trigger }) => jsonableResult`. `store` is
  the SQLite-backed record store — `list(entity)` · `get(entity, id)` ·
  `put(entity, record)` · `remove(entity, id)`. Writes are durable when the
  call returns; there is no separate persist() step.
- **`params` is REQUIRED and typed** (same vocabulary as fields); use `{}` for
  none. The record screen renders it as the signature — args described only in
  prose can neither be shown nor checked.
- **`entity`** attaches the op to a record screen; **`appliesWhen`** decides
  availability on a given record and the adapter derives the blocked reason from
  it. Comparisons only — `eq`, `ne`, `in`, `notIn`, `isBlank`, composed with
  `all`/`any`/`not`. Never a natural-language rule.
- **Flags:** `destructive: true` (requires human approval), `readOnly: true`
  (no side effects), `idempotent: true` (safe to repeat).
- The gate step **"operations resolve"** fails the build if any declared
  operation has no runner function.

## The View — `index.html` + `src/`

A React SPA over the same records API the agent uses. Same-origin writes are
trusted by the adapter, so the browser needs no token.

**Records API** the View calls (PocketBase-compatible REST, served by the adapter):

| Call | Meaning |
|---|---|
| `GET /api/collections/<entity>/records?sort=-created&page=1&perPage=100&filter=status = "todo"` | list; returns `{ items, totalItems }` |
| `POST /api/collections/<entity>/records` (JSON body) | create; returns the stored record |
| `PATCH /api/collections/<entity>/records/<id>` | update |
| `DELETE /api/collections/<entity>/records/<id>` | delete |
| `GET /api/_a2app` | identity (app name, versions) |

Always render back what the server **stored**, not what you sent. Never render an
unbounded collection — page with `perPage`.

**Shared pieces — `src/`** (one implementation each; import, don't rebuild):
`<Icon name size>` · `useToast()` → `toast(kind, message)` ·
`useConfirm()` → `[confirm, confirmElement]` (in-app dialog — never
`window.confirm`) · `api(path, init)` · `fmtDay(dayKey)` · `isPastDay(dayKey)`.
Component styles are plain CSS classes in `public/ui.css`.

**Tokens — `public/tokens.css`:** the kit sheet — `--agent-app-*` foundation →
semantic bridge. Components consume ONLY semantic tokens (`--bg-surface`,
`--text-primary`, `--accent-solid`, `--danger-solid`, `--focus-ring`, `--sp-*`,
`--r-*`, `--fs-*`, `--dur-*`, …). Theme by re-pointing the foundation or picking
a `[data-style]` pack; keep the names stable. Light and dark both resolve every
token and hold WCAG AA. Never hardcode a value where a token exists.

**Realtime / staleness — `src/updater.js`** bridges to the system-owned
watcher (`/_a2app/update.js`, a RUNTIME import the bundler must leave alone).
It reloads the tab on a CODE change when nothing is unsaved, and on a DATA
change (an agent wrote through A2App) dispatches `a2app:datachange` on `window`
so the View re-reads without discarding a half-typed form. Keep the bridge and
the listener when you rewrite the View. Do not add your own polling or reload
logic.

**Building:** `npm run build` (the pipeline build step) compiles the View into
`dist/`. For tight iteration `npm run dev:ui` runs Vite's dev server with
`/api` and `/_a2app` proxied to the running app — start the app first
(`agent-app <dir> serve` or `dev`).

## External data (third-party APIs)

Call the internet from the **backend only** — never the frontend (CORS breaks,
keys leak). On this stack the backend seam you own is the **operation runner**:
runners execute in-process on the Node server and can `fetch()`. Put third-party
calls (and any secret-bearing request) in a runner, expose the result as records
or an operation return. `server.mjs` is system-owned, so boot-time fetches are
not your seam — model an initial sync as a runner (e.g. a `refresh` operation)
that fills the store when it is empty.

## App→agent triggers

**This blueprint supports them.** `server.mjs` is system-owned, so the adapter
handle that enqueues agent work is not yours to reach directly — you get it as
`trigger` in an operation runner's toolbox, beside `store`:

```js
// a2app.schema.mjs
events: [{ type: "task.needs_triage" }],

operationRunners: {
  "request-triage": (args, _ctx, { store, trigger }) => {
    const task = store.get("tasks", args?.task);
    if (!task) return { ok: false, reason: "no such task" };
    const { taskId } = trigger("task.needs_triage", { task: task.id }, "triage");
    return { ok: true, queued: taskId };
  },
},
```

`trigger(type, payload, capability)` emits the event and, when a capability is
named, puts a task on the app's queue. Without a capability it only announces
something — nothing is queued and no agent is ever handed it.

- **The type must be in `schema.events`.** `server.mjs` passes that list to the
  adapter, which refuses an undeclared type. That refusal happens at fire time,
  inside the operation, so an undeclared type is a feature that works in review
  and fails in front of a user. `test/app-to-agent.test.mjs` checks the two
  agree.
- **Send ids.** The agent re-reads the record; a copy in the payload is stale by
  the time it is read, and prose there is an instruction the app does not get to
  give.
- An operation runner is the only firing point this blueprint offers. Record
  creation and updates go through system-owned code, so "fire when a record is
  created" is not available — model it as an operation the UI or an agent calls.

The queue only moves when something is listening: `agent-app <dir> bridge start`,
or a harness polling `a2app <dir> tasks next --wait`.

**Show the queued work in the View.** An agent run takes seconds to minutes, so
the control that queued it needs to show where it is (see the creator skill for
the states to render). Keep `taskId` on the record (a `readOnly` string field
the runner sets), then follow it from `src/`:

```js
// poll only while unfinished; stop at completed / failed / canceled
const t = await api(`/api/_a2app/tasks/${encodeURIComponent(record.agentTask)}`);
// t.status · t.progress?.step · t.claim?.claimedAt · t.result?.summary · t.reason · t.pollAfterMs
```

On a single-user app (`authMode: "none"`) the View needs no credential for this
read. **On a multi-user app it answers 401.** A browser sends no `Origin` on a
same-origin GET, so the adapter treats the read as an uncredentialled program,
and the View has no other path to the queue yet. There, show what the agent
writes to the record instead (a status or assignee it sets on claim and on
finish). A 404 means the task has been pruned, so drop the indicator. Don't
retry it.

## Build, run, gate

`manifest.json`'s `pipeline` drives everything (`install` → `build` → `start`,
health at `/api/_a2app`). Never start a server by hand.

```bash
agent-app <dir> dev        # boot the candidate on a hidden port: fresh seeded store, prints the dev URL
agent-app <dir> validate   # framework files → build (vite) → schema loads → operations resolve → ownership canon → describe budget (on dev)
agent-app <dir> serve      # launch LIVE as a managed, health-polled background process; prints the URL
agent-app <dir> promote    # requires the gate pass; backup, scripts/promote-apply.mjs, destroys the dev instance
```

Toolkit gate steps (from `a2app.toolkit.json`): **"schema loads (fresh,
additive)"** and **"operations resolve"**. `lifecycle.dataDir` is `data/`.

**Environments (one tree, redirected inputs).** `server.mjs` reads `PORT`,
`A2APP_DATA_DIR` and `A2APP_ENV` from the framework. The dev instance runs
against a disposable per-boot SQLite store and serves `dist/` directly — a
View edit needs a rebuild to show; a `server.mjs`/schema edit needs `dev`
again. The LIVE instance serves a boot-time snapshot of `dist/`
(`.a2app/public`), so edits never reach users until promote + serve.

## Footguns for this stack

- **Two files, one truth.** Every operation lives in BOTH `schema.operations`
  and `operations.json`, byte-agreeing on name/module/params/flags. The gate
  fails a mismatch.
- **The View is served built.** Editing `src/` changes nothing a browser sees
  until `npm run build` runs. If the app looks stale, check `dist/` before
  debugging the server.
- **No migrations here.** Schema is declarative and additive; do not look for or
  create a `migrations/` directory.
- **Empty-DB first paint.** A fresh app has no records — the View must render its
  loading/empty/error states without erroring. The verifier fails any first-paint
  error.
- **Keep the update-watcher bridge.** Rewriting the View without `src/updater.js`
  (the runtime import of `/_a2app/update.js`) leaves already-open tabs stale
  forever.
