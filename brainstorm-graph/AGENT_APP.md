# Brainstorm Graph

> Per-project plan, context and index. Keep it current with every change.

## Plan

A brainstorming board for one person, used in the browser with no accounts or
sign-in. The person opens a **session** named after what they are thinking
about. Its **topic** becomes the root node, and the session grows into a tree
of **nodes**, each a question, an answer or an idea. The same tree has three
views, switched in the toolbar:

- **Graph:** a pannable, zoomable canvas of cards joined by curved lines from
  parent to child. Cards can be dragged.
- **Tree:** a collapsible outline.
- **Summary:** counts by type, an AI summary of the session, and every node
  listed by depth.

The person grows the tree in two ways:

- **By hand:** add a child, edit a node's text or type, drag a card, delete a
  node with its subtree.
- **With the AI buttons:**
  - **Expand** adds follow-up questions under a node.
  - **Answer** answers a question node.
  - **AI Explore** grows the session in 2, 3 or 5 steps, breadth-first or
    depth-first, from the branch tips or from a node the person picks.
  - **Summary** writes a short summary of the session.

An agent works on the same sessions and nodes through the `a2app` CLI. Every
operation does what one click does in the app and writes the same records,
including where a new card lands on the canvas.

**Where to start**
- `a2app <app> data sessions list --sort -updated` lists the sessions, most
  recently changed first, which is the sidebar's order.
- `a2app <app> sessions sessions.get --session_id <id>` shows one session as
  the person sees it. Read it before you add, edit, move or delete nodes.

## Modules

Every operation and every collection an agent can reach belongs to one module. `a2app <app>` lists them; `a2app <app> <module>` lists a module's operations.

| Module | Operations | Collections |
| --- | --- | --- |
| `sessions` | 5 | `sessions` |
| `nodes` | 5 | `nodes` |

## Entities

See `reference/requirements.md` § Data Requirements.

| Collection | Purpose | Notes |
|------------|---------|-------|
| sessions | One brainstorm: `title` (required, at most 255 characters) and `topic` (at most 2000) | The New Session dialog requires both. The app never edits `topic` after creation. Deleting a session deletes its nodes. |
| nodes | One card: `session`, `parent`, `content` (required, at most 2000), `kind`, `x`, `y`, `created_by` | An empty `parent` makes a root. Deleting a node deletes every descendant. `created_by` is `agent` ("Created by AI") or `user`; empty reads as `user`. |

**Types.** The screens show three node types. The stored `kind` uses a
different vocabulary.

| Screen type | Card colour | Stored `kind` |
|---|---|---|
| question | blue | `question` |
| answer | green | `insight` |
| idea | the accent colour | `idea`. A `task` or empty `kind` also shows as idea. The app never writes `task`. |

The operations take and return the screen types (`type`), and also return the
stored `kind`. Only questions get the Answer button.

**Parent links.** Each node has at most one parent in the same session, and
links are the only edges: there are no cross-links.

- A new session has one root, an idea that holds the topic.
- The app's own actions never change a node's `parent` or `session` after
  creation.
- Roots appear in two ways only: at session creation, and when AI Explore runs
  on a session that has no root left.

**Canvas positions.** `x`/`y` place a card on a 3000 × 3000 canvas. `0`/`0`
means "not placed": the screens lay such a card out again on every load.

- **Unplaced roots** take slots at (1500 + 280·k, 400).
- **Children** sit 220 below their parent.
- **Siblings** are spread 280 apart around the parent.
- **Collisions:** a slot whose card box (260 × 160) overlaps another card moves
  down by 220, up to 8 times.

The app stores a computed position when it adds a node by hand (Add node, a new
session's root) and right after each AI button. It also stores one when the
person drags a card. The seed session's nodes start unplaced.

**The 500-node window.** The screens load and lay out only the 500 oldest
nodes of a session. Newer nodes are not shown, and the AI buttons place only
nodes inside that window. When a session has more, `sessions.get` says
`"truncated": true`.

## Operations

Call an operation with `a2app <app> <module> <operation> --param value` (`<app>` is the app directory, its id or its name). A destructive one first answers `approval_required` with an approval key: ask the person, then repeat the call with `--approve <key>`. `a2app <app> --find <word>` locates an operation by name. Every operation below runs on the server in the app's own code: the handler its screens use where they call one, otherwise a server copy of exactly what the screens do.

### sessions

- `sessions.summarize` — AI summary of a brainstorm session (the host's language model; 503 when none is connected). Params: `session_id` (string, required).
- `sessions.outline` *(read-only)* — Return a brainstorm session's full node tree as an indented text outline. Params: `session_id` (string, required).
- `sessions.get` *(read-only)* — One session as the person sees it: title, topic, counts, and every node with its type (question/answer/idea), parent, depth and canvas x/y. Read this before adding, editing or moving nodes. Params: `session_id` (string, required).
- `sessions.create` — Create a session with its root idea node on the canvas, as the New Session dialog does. Use this instead of raw record creates. Params: `title` (string, required), `topic` (string, required).
- `sessions.ai-explore` — The AI Explore dialog: `effort` steps, each one model call adding up to 4 idea nodes under the next branch of a breadth- or depth-first walk, placed on the canvas (the host's language model; 503 when none is connected). Params: `session_id` (string, required), `strategy` (bfs|dfs), `effort` (2|3|5), `start_node_id` (string).

### nodes

- `nodes.add` — Add a child node under a node, placed on the canvas like the Add node dialog. Use this instead of raw record creates. Params: `parent_id` (string, required), `content` (string, required), `type` (question|answer|idea).
- `nodes.edit` — Change a node's text and/or type, as the node editor's Save does. To move a card, update the node's x/y record fields. Params: `node_id` (string, required), `content` (string), `type` (question|answer|idea).
- `nodes.expand` — The Expand button: AI adds up to 3 question children under a node, placed on the canvas (the host's language model; 503 when none is connected). Params: `node_id` (string, required).
- `nodes.ai-answer` — The Answer button: AI answers a question node and adds the answer as a child (the host's language model; 503 when none is connected). Params: `node_id` (string, required).
- `nodes.delete` *(destructive)* — Delete a node and all its descendants, as the delete dialog does. Params: `node_id` (string, required).

### What each operation returns

- **`sessions.get`** returns three parts.
  - `session`: `id`, `title`, `topic`, `created`, `updated`.
  - `stats`: `nodes`, `questions`, `answers`, `ideas` and `levels` (deepest depth + 1). These are the toolbar count and the Summary view's numbers.
  - `nodes`: the nodes in creation order, plus `truncated`. Each node carries `id`, `parent` (id or null), `type`, `kind`, `content`, `created_by` (`agent` or `user`, the card's "Created by AI"/"Created by you"), `depth`, `x`, `y` (where the card is drawn) and `placed` (false while it is still auto-laid out).
- **`sessions.create`** returns `{ session, root }`.
- **`nodes.add`** and **`nodes.edit`** return `{ node }`.
- **`nodes.expand`** returns `{ node_id, created: [node, …] }`.
- **`nodes.ai-answer`** returns `{ node_id, answer: node }`.
- **`sessions.ai-explore`** returns `{ session_id, strategy, effort, start_node_id, steps: [{ node_id, created: [id, …] }, …], created: [node, …] }`. Each step names the branch it grew (`null` for new top-level angles in an empty session). When nothing was added it also carries `"message": "Nothing left to explore"`.
- **`nodes.delete`** returns `{ deleted, ids }`: the node first, then every descendant removed with it.
- **`sessions.outline`** returns `{ title, topic, nodes, outline }`. The outline is indented text with the stored kinds, for example `- [insight] …`.
- **`sessions.summarize`** returns `{ summary }`.

A refusal comes back as `ok: false` with the app's message. The causes are:

- a missing or blank parameter;
- text over the limit;
- a type outside question, answer and idea, or a `strategy` or `effort` outside its listed values;
- an unknown id, answered as `node not found: <id>` or `session not found: <id>` (also for a `start_node_id` in another session);
- `nodes.ai-answer` on a node that is not a question, answered as "Only question nodes can be answered".

### Common jobs

- **Start a brainstorm:** `a2app <app> sessions sessions.create --title "Launch plan" --topic "How do we launch the beta?"`.
  - Both values are trimmed, and both are required.
  - The root idea is placed in the middle of the canvas.
- **Add your own question, answer or idea:** `a2app <app> nodes nodes.add --parent_id <id> --content "Who are the first users?" --type question`.
  - `type` defaults to question.
  - The card is placed below its parent and stored, as the Add node dialog does.
  - Nodes are added under a parent; there is no stand-alone root.
- **Fix a node:** `a2app <app> nodes nodes.edit --node_id <id> --content "…" --type answer`.
  - Give either field or both.
  - With `type` left out, the node is saved as its current screen type, so a `task` becomes `idea`, exactly as an untouched Save does.
- **Use the AI buttons the person would press:**
  - **Expand:** `a2app <app> nodes nodes.expand --node_id <id>` adds up to 3 question children.
  - **Answer:** `a2app <app> nodes nodes.ai-answer --node_id <question id>` adds one answer child.
  - **AI Explore:** `a2app <app> sessions sessions.ai-explore --session_id <id> --strategy dfs --effort 2` takes the dialog's three choices.
    - `effort` is the number of steps (2, 3 or 5; default 3). Each step is one model call that adds up to 4 ideas under one branch.
    - The walk starts at `start_node_id`, or, left out (the dialog's Auto), at every branch tip (a node with no children), shallowest and oldest first. An empty session's first step adds new top-level angles instead.
    - `strategy bfs` (default) takes the oldest branch waiting next, so it grows every tip before going deeper. `dfs` takes the newest, so it keeps drilling into the ideas it just added. The prompt asks for side-by-side angles (bfs) or narrower ideas (dfs).
    - It stops early when nothing is left to grow, or when a later step gets no answer from the model.
- **Read a session:**
  - `sessions.get` is the full picture.
  - `sessions.outline` is a compact text tree in stored kinds.
  - `sessions.summarize` gives the Summary view's AI summary. With no nodes the screen shows "No ideas explored yet." instead and makes no AI call. The operation still calls the model.
- **Delete a node and its subtree:** `a2app <app> nodes nodes.delete --node_id <id>`.
  - It answers `approval_required` first, standing in for the app's confirmation dialog.
  - Deleting the root empties the session. After that only AI Explore can add nodes to it.

### When plain `data` is enough

These are plain record writes in the app too, so `data` does exactly what the
screen does:

- **List sessions:** `a2app <app> data sessions list --sort -updated`.
- **Rename a session:** `a2app <app> data sessions update <id> --title "New title"`. Trim the title first: the app does, and an empty title is refused.
- **Delete a session and all its nodes:** `a2app <app> data sessions delete <id>`.
  - The trash icon asks "Delete session?" first. This record delete has no approval step, so ask the person and wait for their yes before you run it.
- **Move a card:** `a2app <app> data nodes update <id> --x 1780 --y 620`.
  - Read the other cards' positions with `sessions.get` first.
  - Setting `0`/`0` hands the card back to automatic layout.
- **Filtered reads:** for example `a2app <app> data nodes list --filter "session='<id>'" --sort created`.

The app itself never does the following, so do not do them with raw writes:

- create nodes (their position would be left unplaced and shift later);
- change a node's `parent` or `session`;
- edit a session's `topic`;
- write `kind: task`.

### AI operations and the model

`nodes.expand`, `nodes.ai-answer`, `sessions.ai-explore` and
`sessions.summarize` ask a language model through the app's host.

- **Who answers:** CraftBot answers when it launched the app. Under the Agent
  App Framework, `agent-app <dir> bridge start` answers with the connected
  harness's own model.
- **Without a model:** with neither present, each answers HTTP 503 with "AI is
  unavailable (app not running inside CraftBot)" and writes nothing.
- **Latency:** each call can take up to 2 minutes (5 minutes through the
  framework bridge). `sessions.ai-explore` makes one call per step, so
  `--effort 5` can take five times as long.
- **Tip:** you are a model yourself. When the person asks *you* for ideas or
  answers, writing them with `nodes.add` is usually better. Use the AI
  operations when the person asks for the app's AI buttons.

### What the person sees

- **No live refresh.** The person's screen does not update on its own:
  - a session's nodes reload when the person clicks the session in the sidebar;
  - the session list reloads only when they create, rename or delete a session,
    or reload the page.

  After you change something, tell the person to click the session again, or
  reload, to see it.
- **"Created by AI".** Every node an operation creates is stored with
  `created_by: agent`, as are the nodes of the person's own AI buttons, so its
  card shows the robot icon ("Created by AI") after any reload. Nodes the
  person adds read "Created by you". Tell the person what you added.

## Conventions

### Gotchas

- **The browser adapter.** The View is the original frontend running through a
  browser-side adapter, `frontend/src/app/services/apiAdapter.ts`, which does
  two jobs. It translates the frontend's calls into PocketBase record calls and
  the app's AI routes. It also computes canvas placement. The agent operations
  port that placement in `pb/pb_hooks/lib_agent.js` and copy the AI prompts of
  `ops.pb.js`. Change both together.
- **The View's AI routes.** `ops.pb.js` also serves `POST /api/ops/nodes/suggest`,
  `/api/ops/nodes/answer` and `/api/ops/sessions/explore`. They are the View's
  steps behind the AI buttons: they leave new nodes unplaced and write `idea`
  where Expand shows questions, and `sessions/explore` runs one explore step
  per call. They are deliberately not declared to agents; the agent operations
  do the whole button.
- **Errors.** Operation handlers answer errors as `{ error: "…" }` with 400,
  404, 503 or 500. The adapter turns them into the protocol envelope.
- **Hooks do not hot-reload** (`--hooksWatch=false`): restart the app after any
  hook change.

### Ownership map

- **System-owned (hash-locked, from the `blueprint-pocketbase-kit` toolkit — never edit):** `manifest.json`, `pb-serve.mjs`, `pb-fetch.mjs`, `pb-check.mjs`, `pb-build.mjs`, `pb/pb_hooks/_a2app.pb.js`, `pb/pb_hooks/_a2app_impl.js`, `pb/pb_hooks/_a2app_rules.js`, `pb/pb_hooks/_compat_lib.js`, `pb/pb_hooks/_compat_rules.js`, `pb/pb_hooks/_compat_system.js`, `pb/pb_hooks/_system.pb.js`, `pb/pb_hooks/_triggers.pb.js`, `pb/pb_hooks/_triggers_lib.js`, `pb/pb_hooks/_craftbot_bridge.js`.
- **Agent-owned:** `operations.json`, `events.json`, `AGENT_APP.md`, `reference/`, `pb/pb_hooks/a2app_routes.pb.js` (regenerate with `tools/agent-app-migrate` rather than hand-edit), every other file under `pb/pb_hooks/` and `pb/pb_migrations/`, and `frontend/`.

## Checklist

Build and verification tasks live in `reference/tasks.md`.

See `reference/requirements.md` (binding). Feature checklist:

- [x] Sessions sidebar: list (most recently changed first), New Session dialog (title and topic), inline rename, delete with all its nodes after confirmation, collapse
- [x] Graph view: 3000 × 3000 canvas with dot grid, pan, wheel and button zoom (25–200 %), reset and fit, curved parent-to-child lines, draggable cards whose position is stored
- [x] Tree view: collapsible outline with the same node actions
- [x] Summary view: counts by type and depth, AI summary with Refresh, nodes listed by depth
- [x] Node types question, answer and idea with their colours; node detail with edit (type and text); Add node; delete with subtree after confirmation
- [x] Automatic placement of new and unplaced cards (child slots, collision moves down)
- [x] AI buttons: Expand (3 questions), Answer (questions only), AI Explore (2, 3 or 5 steps of up to 4 ideas, breadth- or depth-first, from the branch tips or a chosen node), Summary; nodes they make stay marked "Created by AI"
- [x] Theme follows the host (kit theme bridge)
- [x] Every person's action has an agent path: an operation, or a plain `data` write where the app itself does a plain write
