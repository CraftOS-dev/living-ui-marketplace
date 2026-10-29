# Development Studio — agent guide

This is an **Agent App**: app code plus an A2App adapter plus framework files.
It is built, launched, and operated through two CLIs — never by hand:

- `agent-app` — build, evolve, manage.
- `a2app` — operate a running app (the A2App protocol client; operate only).

## Read first

- `reference/blueprint.md` — YOUR STACK'S MAP: files you own vs. system-owned, schema/migration API, operations, UI kit, gate. Read this before writing code.
- `AGENT_APP.md` — this app's index: plan, entities, operations, conventions, checklist.
- `reference/requirements.md` — the binding spec of what this app must do.

Load the matching framework skill before build or evolve work:
`agent-app skills` lists them; `agent-app skills --install <dir>` installs them here.

## Operate it (no rebuild)

```bash
agent-app . serve                       # launch (never start a server by hand)
a2app .                                 # the app's modules — start here
a2app . <module>                        # its entities and operations
a2app . <module> <entity>               # fields, and the operations that act on it
a2app . <module> <entity> <id>          # one record, and what its state allows
a2app . <module> <entity> <id> <op> …   # invoke, at the path that identifies it
a2app . --find <term>                   # search names, get locations
a2app . data <entity> list|create|…     # raw record access
```

The CLI is a walk: each argument names a place in the app, and every screen
ends by naming the legal next moves — read that line, you never have to guess.

Read and write through the adapter only. Never drive the UI to operate this app;
the UI is for humans and for walk-verify.

## Change its code

```bash
agent-app . dev          # boot the candidate on a hidden port, fresh migration-replayed DB
agent-app . validate     # the gate — must pass; measures the dev instance, records the pass
# walk-verify: a verifier agent that is NOT the builder loads the walk-verify
# skill and drives every reference/requirements.md Feature against the dev URL.
agent-app . stop         # promote refuses while the live app is serving
agent-app . promote      # requires the gate pass; backup, apply to live, destroy dev
agent-app . serve        # bring the changed app back up
```

While the dev instance is up, every `a2app` operate command targets IT — test
data lands in its disposable database, never in live data.

Never build against the live app, never edit an applied migration, never drop a
collection holding user data, and never write a system-owned file listed in
`.a2app/system-hashes.json` — the gate fails on drift.
