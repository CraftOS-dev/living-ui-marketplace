# Research Board

> Per-project plan, context and index. Keep it current with every change.

## What this app does

Boards for research: each board is a free canvas of cards (notes, web links,
YouTube videos, images, videos, documents, quotes) grouped by sections and
joined by links that say how two cards relate (relates, supports,
contradicts, leads to).

The whole UI is a sidebar and the board. The sidebar lists the boards to
switch to and manages them (new, rename, description, duplicate, export,
delete) with the workspace settings behind one button; the board fills the
rest of the window edge to edge. There are no other pages. The look is
flat and compact (hairline borders, 6 to 8px corners, 32px controls), high
contrast and nearly colorless: ink for actions and selection, green and red
only for links that support or contradict, the accent only for what the AI
agent proposes. No emoji: every kind wears a line icon
(`frontend/src/app/lib/kinds.ts`).

An AI agent operates the app through the `agent-app` CLI with the same
operations the UI calls, and the app hands work back through two triggers:
summarize cards, and review a board (notes on what is missing, proposed
links the person keeps or rejects, a short review). The UI says "your AI
agent"; what it adds is marked as added by the agent.

**Start every agent session with `agent-app run <project> app.guide`**: it
returns the boards, the conventions and ready-to-run recipes.

## Requirements

See `reference/requirements.md`. Feature checklist:

- [x] Sidebar of boards: create inline, rename (double click), description, duplicate (with files and links), export as Markdown, delete; collapses to give the board the whole window
- [x] Board canvas in the Research OS map style: dotted stage, pan, wheel and pinch zoom around the pointer, fit (F), eased glides, minimap only when the board is larger than the view, zoom controls, link legend
- [x] Cards: note (edited in place), link (page title, description and picture read once), YouTube (title, channel, still; YouTube's player in the inspector), image, video (real player), document (PDF viewer in the inspector), quote (serif passage + source), section (frame that carries the cards inside it)
- [x] Add from the toolbar's tools (click: in view; drag: at the drop point), the Add button, a double click (note), files dropped from the computer, a dragged address, or paste (image, address, text)
- [x] Move (selected cards together, sections carry their cards), resize, nudge with arrow keys, tidy a selection into a grid, group a selection in a section
- [x] Links: drag a card's top dot onto another, pick the kind; curved links with arrowheads colored by kind, labels, flip, remove; proposals dashed and flowing until kept or rejected
- [x] Selection: click, Shift+click, Shift+drag area (also inside sections), Ctrl+A; panel to tag, move or copy to another board, duplicate, delete
- [x] Delete goes to a trash with Undo (bar and Ctrl+Z); the hourly job empties cards trashed over a day ago
- [x] Find on the board (dims the rest, steps through matches), show or hide kinds (filter menu)
- [x] Inspector: content, title, address, text, source, AI summary (ask, follow, cancel, ask again, remove), tags with suggestions, color, links with keep/reject, star
- [x] Inspector, link, selection and review panels dock on the right of the board (a bottom sheet on phones); menus always stay inside the window
- [x] Every UI action has a CLI operation

## Entities

| Collection | Purpose | Notes |
|------------|---------|-------|
| settings | One row: `title` (workspace name), `link_previews` | The title starts from `pb/pb_hooks/setup.json` (marketplace field `APP_TITLE`) on first read |
| boards | `name`, `description`, `color`, `viewport` (last view), `sort`, review state (`review_state`, `review_request`, `review_note`, `review_focus`, `review_at`) | Deleting a board cascades to its cards and links |
| cards | `board`, `kind`, `title`, `body`, `url`, `file`, `source`, `thumb`, `meta` (site, description, author, video_id, filename, size, ext), `tags` (json list), `color`, `x`/`y`/`w`/`h`/`z`, `starred`, `added_by`, digest (`digest`, `digest_state`, `digest_error`, `digest_at`), `trashed` | World coordinates; sections have `z = -1` |
| links | `board`, `source`, `target`, `kind`, `label`, `status` (confirmed, proposed), `added_by`, `reason` | One link per pair of cards, either direction; cascades with its cards |

## Operations

45 operations in `operations.json`. Groups: `app.guide`; `settings.*`;
`summary.home`; `boards.list|get|create|update|delete|duplicate|export`;
`cards.list|get|preview|add|update|move|delete|restore|duplicate|transfer|tag`;
`tags.list|rename|delete`; `links.add|update|delete|decide`;
`digests.request|cancel|clear|list|start|complete|fail`;
`reviews.request|cancel|dismiss|list|start|complete|fail`.

Routes live in `pb/pb_hooks/ops.pb.js` (settings, summary, boards),
`ops_cards.pb.js` (cards, tags, links) and `ops_agent.pb.js` (digests,
reviews); logic in the `lib_*.js` modules (required inside each handler).

## Agent triggers

| Trigger | Fired when | What the agent does |
|---------|------------|--------------------|
| `digests_waiting` | A card's summary is asked for (`digests.request`); the minute cron re-asks when a fire was refused by the cooldown or lost to a restart | Reads each waiting card's source and writes `digests.complete`, or `digests.fail` with a reason |
| `reviews_waiting` | A board review is asked for (`reviews.request`), same re-ask | Adds a few notes, proposes links (`links.add --proposed true`) and saves `reviews.complete`, or `reviews.fail` |

Work the agent took but left unfinished is failed by `rb_agent` once the
agent has made no op call for 4 minutes, or after 20 minutes regardless
(`lib_agent.settleStale`). App hooks never read the `agent_requests` queue.

## External data

| Source | Used for | Called from |
|--------|----------|-------------|
| The page at a link the person or agent adds | Its title, description, site name and preview picture (Open Graph, else `<title>`), read once, first 400 KB; never for local or private addresses; off in Settings | `lib_unfurl.js` |
| YouTube oEmbed (`www.youtube.com/oembed`) | A YouTube card's title and channel | `lib_unfurl.js` |
| YouTube stills (`i.ytimg.com`) | A YouTube card's picture (loaded by the browser) | `lib_unfurl.js` writes the address |

## Background jobs

- `rb_agent` (every minute): asks the agent about waiting summaries and reviews only when an ask is outstanding, and settles work it left busy. In-memory flags keep it off the database when nothing is pending.
- `rb_trash` (hourly at :17): deletes cards trashed more than a day ago (files and links go with them).

## Gotchas

- Hooks do not hot-reload: restart the app after any hook change.
- `require()` costs about 1.6 ms per call in the hooks VM: `lib_cards.serialize` and `jsonField` run per card and stay require-free; `cards.move` validates without requiring per card.
- A file attached with `record.set('file', f)` does not show in `getString('file')` until the record is saved; `checkComplete(rec, attached)` takes that fact as a parameter.
- Handlers run in isolated VMs: helpers used by record hooks live in `lib_rules.js` and are required inside each hook.
- Inside `runInTransaction` only the transaction handle (`tx`) is used.
- The install-time workspace name comes through `setup.json` (JSON-escaped by the installer); a name substituted into JS would break on an apostrophe.
- The board keeps optimistic positions only for cards whose move is still on its way (`pending`), so a live reload mid-drag does not snap cards back.
- Ids just created on the board (cards, links) are "expected" for a few seconds so the selection is not cleared before the live reload delivers them.
- Links are drawn between the section frames and the cards; drawn under the sections they would vanish behind the frames' wash.
- An address with a board id the live list does not know yet (a board just created or duplicated) gets a 2 s grace period before the app falls back to the last or first board.
- Popovers measure themselves after opening and shift or open upward to stay inside the window (the sidebar's menus sit at the left edge).
- The UI subscribes to all collections once at startup (`lib/live.ts`); an open page reloads itself when the served app script changes, waiting while a dialog is open or something is being typed.
- Colors: `lib/themeColors.ts` derives every `--rb-*` token from the host theme with contrast checks: surfaces, borders at a fifth of the way to the text, secondary text at 8:1, the stage and its grid, link colors (only supports and contradicts carry a hue) and the optional card tints. Card kinds are deliberately neutral (`--rb-kind-*` resolve to ink tones). Never hardcode a hex color in components.

## Ownership map

- Editable: `frontend/src/app/`, `pb/pb_migrations/` (new files only), `pb/pb_hooks/*.pb.js`, `lib_*.js` and `setup.json` (not the `_*.js` system files), `operations.json` (non-system entries), `triggers.json`, this file, `reference/`.
- System-managed (never edit): `frontend/src/kit/`, `frontend/src/main.tsx`, `frontend/src/config.gen.ts`, the underscore hooks (`pb/pb_hooks/_*.js`), `manifest.json`.
