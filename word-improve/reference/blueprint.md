# Blueprint reference — pocketbase-kit

The marketplace's toolkit for PocketBase apps built with the agent-app UI kit:
a PocketBase 0.39 backend (JS hooks + migrations) and a React 19 / Vite /
Tailwind 4 View in `frontend/`, compiled into `pb/pb_public/`. The A2App adapter
is the Agent App Framework's own (`blueprint-pocketbase-react`, pinned in the
toolkit's `framework.lock.json`); this toolkit adds the compatibility hooks the
apps' own code and UIs were written against.

If this file and the source disagree, the source wins.

## File map — who owns what

| Path | Owner | What it is |
|---|---|---|
| `operations.json` | **agent** | the operations agents may call: name, module, typed params, flags. |
| `events.json` | **agent** | the work the app may ask an agent for: event type = capability, typed payload, cooldown. |
| `AGENT_APP.md` | **agent** | the app's index: plan, modules, entities, every operation, the work playbooks, conventions. |
| `reference/requirements.md`, `reference/tasks.md` | **agent** | the binding spec and the build ledger. |
| `pb/pb_hooks/a2app_routes.pb.js` | **agent** (generated) | `POST /api/ops/<name>` for every declared operation, running the app's own handler through the adapter's `op()`. Regenerate with `tools/agent-app-migrate` in the marketplace repo, or add a line by hand for a new operation. |
| `pb/pb_hooks/*` (no `_` prefix) | **agent** | the app's own routes (`/api/ops/<group>/<verb>`, which its screens call), libraries and jobs. |
| `pb/pb_migrations/*.js` | **agent** | the schema, additive only. |
| `frontend/**` | **agent** | the View, including its copy of the UI kit (`frontend/src/kit`). |
| `manifest.json` | SYSTEM | identity, modules and their collections, `authMode`, the pipeline. |
| `pb-serve.mjs`, `pb-fetch.mjs`, `pb-check.mjs`, `pb-build.mjs` | SYSTEM | launcher, pinned PocketBase fetcher, gate checks, fingerprinted View build. |
| `pb/pb_hooks/_a2app.pb.js`, `_a2app_impl.js`, `_a2app_rules.js` | SYSTEM | the framework's A2App adapter. |
| `pb/pb_hooks/_system.pb.js`, `_compat_system.js`, `_compat_lib.js`, `_compat_rules.js` | SYSTEM | what the apps' UIs relied on: the SPA no-store header, the 1.9.0 write guard for the View's own writes, the credential check on the app's own operation routes, the multi-user operations gate, rate limits, the console and coverage relays. |
| `pb/pb_hooks/_triggers.pb.js`, `_triggers_lib.js` | SYSTEM | the `agent_requests` queue the UI fires into and watches; every landed row becomes an A2App task, and the row follows the task. |
| `pb/pb_hooks/_craftbot_bridge.js` | SYSTEM | `callLLM` (answered by the framework bridge's harness, or CraftBot), `callAction`/`callIntegration` (CraftBot only). |

## How an agent reaches the app

- **Operate:** `a2app <app>` → modules → `a2app <app> <module> <operation> --param value`. Destructive operations answer `approval_required` first; the person approves; the call is repeated with `--approve <key>`.
- **Records:** `a2app <app> data <collection> list|get|create|update|delete` for the collections the manifest lists.
- **Work the app asks for:** `a2app <app> tasks next` (or `agent-app <app> bridge start`), then `tasks progress` / `tasks complete`. AGENT_APP.md § Work the app asks for says how to do each capability.
- **Who the agent is:** the app's `.agent-token`, sent as `X-A2App-Token`, makes the agent the app's operator (PocketBase's superuser), exactly as agents have always operated these apps.

## Adding an operation

1. Write the route the screens will call (`routerAdd("POST", "/api/ops/<group>/<verb>", …)`) as usual.
2. Declare it in `operations.json` (`module`, `params`, `destructive`, `readOnly`).
3. Serve it to agents: add a line to `a2app_routes.pb.js` —
   `routerAdd("POST", "/api/ops/<name>", (e) => require(\`${__hooks}/_a2app_impl.js\`).op(e, "<name>", (ev) => (<the same handler>)(ev)));`
4. Document it in AGENT_APP.md § Operations. The gate's "operations resolve" step fails a declaration without a route.

## Asking for agent work

Declare the capability in `events.json` (`type`, `capability` = the same name,
`payload` = `request` plus typed params, optional `cooldownSeconds`), fire it
from a hook with `require(\`${__hooks}/_triggers_lib.js\`).fire(e.app, "<name>", params, "hook")`
or from the UI with the kit's `fireAgentTrigger`, and write its playbook in
AGENT_APP.md.

## Build, run, gate

- `install` = `node pb-fetch.mjs && npm --prefix frontend install --ignore-scripts`
- `build` = `node pb-build.mjs` (skips when `frontend/` is unchanged since the last build)
- `start` = `node pb-serve.mjs`; `health` = `/api/_a2app`

```bash
agent-app <dir> serve --install   # first run: PocketBase + dependencies, build, launch
agent-app <dir> validate          # framework files → canon → build → hooks + self-test → operations resolve → describe budget
agent-app <dir> dev / promote     # safe evolve with a fresh database replayed from the migrations
```

## Footguns

- PocketBase is pinned to 0.39.7; `pb-fetch.mjs` provides it.
- Hook handlers run in PocketBase's JS runtime (goja): `require()` inside each handler; record hooks reach the request as `e.requestEvent.request`.
- `require()` costs ~1.6 ms per call; keep it out of per-row loops.
- Never `.reverse()` a query result in place (`Array.from(rows).reverse()`).
- Every module's describe level must fit 2,000 characters untrimmed: keep operation descriptions short (the long form lives in AGENT_APP.md).
