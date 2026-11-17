# blueprint-mcp-sidecar

A marketplace toolkit that makes an existing open-source app with its own MCP server into an Agent App, **without changing the app**. Not part of the framework.

It covers apps that already have:
- a release archive we can pin by SHA-256;
- an MCP server (streamable HTTP);
- a way to run locally.

For such an app, the toolkit:

1. **Downloads the app's own release**, checks the hash and unpacks it into `<app>/<dir>` (`sidecar/upstream.mjs`). Nothing in it is edited.
2. **Runs it** on a private loopback port, through the app's own hooks in `a2app/app.mjs` (install, build, start). The child guard (`sidecar/guard.mjs`) ends it if the sidecar dies.
3. **Serves the A2App surface on the app's port** (`sidecar/serve.mjs`, `@a2app/adapter-core`; requirement_A2App §12.3, form 3):
   - Each operation is one of the app's own MCP tools (`tools/call` over loopback), or a sidecar operation from the hooks.
   - Arguments are shaped by the tool's own JSON Schema.
   - `destructive: true` operations need the person's approval.
4. **Passes everything else through untouched:** the app's UI, API, WebSockets and its own MCP endpoint.

## Token budget

The protocol caps describe (2,000 characters per level) but never operation results, and the CLI prints a result whole. So the sidecar bounds results itself.

**Results.** Every tool operation takes `view`:

| `view` | Returns |
| --- | --- |
| `text` (default) | The MCP tool's own text answer, cut at a line boundary at the hook's `textLimit` (default 12,000 characters), with `truncated: {shownChars, totalChars, more}`. Also the `…Id` fields and the page `url` from its structured answer. |
| `full` | All of the text, for `--out file.txt`. |
| `data` | The structured answer as is, for `--field` or `--out file.json`. |

MCP servers write their text for agents, so it is usually two to three times smaller than the JSON. The app's generator declares `view` on every tool operation.

**Errors.** The whole recovery goes in `message`, because the CLI prints only the message. Every message starts with its code (`key_missing: …`), because agents branch on the code.

| Code | Status | Source |
| --- | --- | --- |
| hook-named setup problems | 409 | the app's `before` and `explain` hooks |
| `invalid_param` | 409 | the upstream's own validation |
| `upstream_refused` | 409 | other upstream refusals |
| `not_found` | 404 | upstream "not found" |

409 and 404 keep the CLI from dumping the parameter help, which costs tokens and, in some harnesses, replaces the message.

**Guide.** Give the app an `app.guide` sidecar operation: the operator skill tells agents to call one first.

## What an app provides

| File | Purpose |
| --- | --- |
| `upstream.json` | `name`, `archive` (URL), `sha256`, `dir`, plus optional `tag`, `commit`, `mcpPath` (default `/mcp`), `healthPath`, `toolSources` (folders whose source must name every mapped tool), and credit fields |
| `a2app/app.mjs` | hooks: `install(ctx)`, `build(ctx)`, `start(ctx)` → `{ stop, restart }`, `detach(dir)`, `ops`, `before(call, ctx)` / `explain(result, ctx)` (name setup problems such as a missing key, answered 409 with the next step), `conventions`, `credentialHint` |
| `a2app/tools.map.json` | `operations`: name → `{ tool }` or `{ sidecar }`, plus `module`, `summary`, `destructive` |
| `operations.json` | the declared operations (generate them from the live `tools/list`) |
| `manifest.json`, `AGENT_APP.md`, `reference/` | framework files as usual. Keep `modificationLock: true`: the upstream app is not the agent's to edit |

## System paths

`manifest.json`, `sidecar/{pipeline,serve,mcp,context,upstream,guard,check}.mjs`, `sidecar/package.json` and `package-lock.json`, and `sidecar/vendor/*` (adapter-core and rules, pinned to Agent-App 5e9c7a1, byte-identical to dev-studio's).

## Gate

- `node --check` on every sidecar file and `a2app/app.mjs`.
- `node sidecar/check.mjs`: every declared operation has exactly one runner, every mapped entry is declared, and every mapped tool name appears in the pinned upstream's `toolSources`.

## Data

`lifecycle.dataDir` is `data`. The app's hooks keep the upstream app's state there, linked into the release folder, so replacing the release on an update never touches it. The adapter's own state is `data/a2app-state.json`.

## First user

`openseo` (OpenSEO by Ben Senescu and Every App, MIT).
