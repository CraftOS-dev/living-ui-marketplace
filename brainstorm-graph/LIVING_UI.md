# {{PROJECT_NAME}}

> Per-project plan / context / index. The building agent keeps this current
> (spec A3). Only agent-owned areas are listed under "Editable".

## What this app does

{{PROJECT_DESCRIPTION}}

A visual brainstorming tool: each session is a mind-map tree growing from
a central question. Nodes are typed (idea / question / insight / task),
edited in place, and branched with ＋. Agents can read a whole session as
an indented outline via the `sessions.outline` op.

## Requirements

Feature checklist:

- [x] Sessions (create with title + central topic, delete, sidebar list)
- [x] Root node auto-created from the session topic
- [x] Tree layout canvas (root left, children fan out; SVG curve edges)
- [x] Node kinds with colors: idea, question, insight, task
- [x] Add child node (＋ on hover), edit node, delete branch (cascade)
- [x] Free node positioning (drag cards; position persists, auto-layout otherwise)
- [x] Outline view toggle (indented tree, click to edit)
- [x] AI session summary (✨ Summarize — CraftBot LLM bridge, graceful 503 outside)
- [x] AI idea suggestions (✨ on a node creates 3 child ideas via the bridge)
- [x] AI answer for question nodes (💡 attaches the answer as an insight child)
- [x] AI explore (✨ Explore proposes 4 uncovered angles for the session)
- [x] Edit session title / central topic
- [x] Seeded welcome session so the canvas is not empty
- [x] `sessions.outline` op — full tree as indented text for agents

## Entities

| Collection | Purpose | Notes |
|------------|---------|-------|
| sessions   | Brainstorm sessions | title, topic |
| nodes      | Tree nodes | session (rel), parent (self-rel, cascade), content, kind |

## Operations

Declared in `operations.json`; discoverable at `GET /api/_ops`.

- `sessions.outline` — session's node tree as an indented text outline.
- `sessions.summarize` — AI summary via CraftBot LLM bridge.
- `nodes.suggest` — create 3 AI-suggested child ideas under a node.

## Ownership map

- Editable: `frontend/src/app/`, `pb/pb_migrations/`, `pb/pb_hooks/ops.pb.js`,
  `operations.json` (non-system entries), this file.
- System-managed (never edit): `frontend/src/kit/`, `frontend/src/main.tsx`,
  `pb/pb_hooks/_system.pb.js`, `manifest.json`, build configs.
