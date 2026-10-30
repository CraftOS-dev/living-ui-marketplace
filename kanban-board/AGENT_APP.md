# Kanban Board

> Per-project plan, context and index. Keep it current with every change.

## What this app does

A Kanban board one person shares with their AI agent. Boards have columns;
each column is a small **contract**: what the stage means (its category), a
WIP limit, whether the agent works it, the gates the agent passes (a plan
you approve first, acceptance criteria, a finished checklist), where
finished work goes, where review sends rework, and how long the agent may
hold a card without a heartbeat. A card belongs to **you** or to **the
agent**. Moving a card into a column the agent works hands it over; the
agent takes cards with leases, shows what it is doing live, asks when it
would have to guess, and hands work back with evidence; **you** keep the
decisions: reviews, Done, and the switch that pauses the agent.

The rules the agent is held to are enforced by the server, not by asking
nicely: it never moves a card to Done or Canceled, never decides a review,
is refused by a full WIP limit, a frozen board or a pause, works at most
"cards at once" cards across all its sessions, and what it creates is a
proposal you accept. Every change is an event attributed to you, the agent,
a rule or the board, with before and after, and can be reverted.

The look is CraftBot's own: the kit's warm-neutral tokens with three clear
grey steps on the board (the page, darker columns, cards on the plain
surface; in dark mode the columns sink below the page and the cards rise
above it), a CraftBot-style sidebar (New card like New Task, views, Boards,
and the agent with its live status and on switch at the foot), pill choices
like the composer's, and a card docked on the right. Everything clickable
shows the hand. Cards lift, tilt with the pointer, make room and settle when
dragged; cards the agent moves glide to their new column. Light and dark
follow the host.

The research behind the design (Linear, Jira, GitHub, Trello, Businessmap,
Kanboard, Plane, Fizzy; Linear agents, Jira column agents, Copilot cloud
agent, Jules, kanban-md, agent-kanban; Kanban Guide, HAX, OpenAI and
Anthropic agent governance, MAST, the dotnet/runtime agent study) is in the
repo's `reports/Kanban for humans and AI agents.md` (not shipped).

## Requirements

See `reference/requirements.md` (binding). Feature checklist:

- [x] Sidebar: New card (C), Inbox (what needs you), Review (the queue), Insights, Activity; Boards (a live dot while the agent works there and a count of what needs you); at the foot the agent (status: working on N, N waiting, idle, paused) with its on switch, and Settings; collapses to a rail
- [x] Board: darker columns with a category icon, count against the WIP limit (amber at the limit, red over it), "Agent works here" and gates; cards drag between columns and lanes (the card lifts and tilts with the pointer, the destination column lights up and opens a slot, the other cards glide out of the way, the card flies into place; auto-scroll at the edges); quick add per column; collapse columns; search (/), filter (assignee, agent state, priority, labels), swimlanes by assignee (you, the agent, unassigned) or priority (dropping in another lane reassigns or re-prioritises); the board's live status (the agent on N, queued, need you); add, move, remove columns
- [x] Card face: key, priority, title, what the agent is doing now (live line and a sweeping edge while it works), labels, due, checklist and plan progress, one state chip (Working, Queued, Waiting on you, Plan to approve, Needs criteria, Needs attention, In review, Proposed, Blocked), age dots, you or the agent
- [x] Card panel (docked right, the board stays live): the agent session (working with plan, lease and Stop; queued; a question with suggested answers and a reply box; a plan to approve or revise; acceptance criteria to add; handed back or failed with Retry, give it to the agent, or take over; proposals with Accept or Dismiss), the review packet (criteria met or not, how it was checked, what could not be verified, summary) with Approve, Request changes (reason the agent reads) and Reject; title, status, assignee (one switch: you or the agent), priority, labels, due; markdown description and acceptance criteria; checklist; flag blocked; archive, delete; activity as messages (comments, questions, answers, submissions, decisions), the agent's steps folded into "N steps" like CraftBot's actions, and change lines with revert; comment box (Ctrl+Enter)
- [x] New card dialog: a "New card" heading with the board and column, a Title field (Enter creates; pasting several lines splits title and description), a Description field (markdown), Board, Column, Assignee (You / Agent switch; in a column the agent works the card is the agent's) and Priority; choosing the agent shows Acceptance criteria (marked required when the column needs them) and what happens next; Cancel and Create card in the footer; the page behind dims and blurs
- [x] Inbox: questions and plans (answer and approve inline), needs attention (retry, take over), proposals (accept, dismiss), blocked, overdue, a link to the review queue; "Since you were away": what the agent and rules did since you last looked
- [x] Review queue: list and detail, evidence first; J/K move, A approve, R request changes
- [x] Insights: KPIs (in progress, finished, cycle time median and 85th percentile, review wait, first-pass approval), the agent's report card (runs, approval and first-pass rates, questions, handed back, failed or timed out, run time), aging work in progress against percentile lines, cycle-time scatter with 50/85/95 lines, weekly throughput and cumulative flow, split between the agent and you; per board or all, 7/30/90 days
- [x] Activity: every change by everyone, filters (you, the agent, rules), revert; Ctrl+Z undoes your last change
- [x] Board settings: name, key, description, how-we-work instructions, freeze for the agent, swimlanes, delete; columns (open each contract, reorder, add); labels (rename, recolour, remove); rules (When/If/Then sentence builder, assign to you or the agent, on/off, runs, why a rule was switched off)
- [x] Settings: your name, let the agent work (on switch), cards at once (1, 2, 3 or 5), what interrupts you (questions, attention, reviews: a notice or the inbox), how the agent works with the board, shortcuts
- [x] Templates for new boards: Simple, Agent pipeline, Content studio, Software, Three columns
- [x] V1 installs converted (boards, lists as columns with a guessed category, cards with text, priority, due, labels, checklist and order, labels)
- [x] Every UI action has an operation; the agent uses the same ones

## Entities

| Collection | Purpose | Notes |
|------------|---------|-------|
| settings | One row: `name`, `paused` (the agent), `max_working` (cards the agent works at once, 1..10), `agent_seen` (its last call), `attention` (questions, attention, reviews: interrupt or inbox), `defaults`, `last_seen` (yours, for the digest) | Person only |
| boards | `name`, `key` (card ids KEY-12), `description`, `instructions` (how we work, sent with every agent run), `seq`, `frozen` (the agent may not write), `archived`, `sort`, `swimlanes` | |
| columns | `board`, `name`, `category` (triage, backlog, todo, doing, review, done, canceled), `position`, `wip`, `policy`, `instructions` (for the agent here), `agent` (the agent works it: to-do and started columns only), `plan_first`, `need_criteria`, `need_checklist`, `next`, `return_to`, `lease_minutes`, `max_attempts`, `aging_days`, `collapsed` | The contract; only the person changes it |
| cards | `board`, `column`, `number`, `title`, `description`, `acceptance`, `priority` (0 none, 1 urgent .. 4 low), `labels`, `due`, `estimate`, `checklist`, `position`, `assignee` (`you`, `agent` or '' for the agent's unaccepted proposals), `created_by` (you, agent), `proposed`; agent session: `agent_state` (queued, working, needs_input, needs_attention), `lease_until`, `attempt`, `handoffs`, `run`, `progress`, `plan`, `plan_ok`, `question`, `attention`, `feedback`; review: `review` (packet), `review_state` (pending, approved, changes, rejected), `work_column`; `blocked`, `blocked_reason`, `column_at`, `started_at`, `done_at`, `done_kind` (agent, you, canceled), `cost`, `version`, `archived` | `version` refuses stale writes |
| labels | `board`, `name`, `color` | |
| events | `board`, `card`, `actor`, `actor_kind` (you, agent, rule, system), `kind`, `text`, `field`, `before`, `after`, `run`, `meta`, `reverted` | Append-only; a year is kept |
| runs | `card`, `board`, `column`, `attempt`, `started`, `ended`, `outcome` (working, submitted, asked, planned, returned, failed, expired, stopped, released), `note`, `cost`, `decision`, `decided` | One per claim; the report card and review wait come from here |
| rules | `board`, `name`, `enabled`, `when`, `column`, `days`, `conditions`, `actions`, `position`, `runs`, `last_run`, `paused_reason` | |

Every collection changes only through the operations (`hooks.pb.js`
refuses direct API writes and names the operation to use).

## Operations

63 operations in `operations.json` (`agent-app ops <project>`):
`app.guide|state|status|context|ui`; `settings.get|update`;
`boards.list|get|templates|create|update|delete`;
`columns.add|update|move|remove`; `labels.save|remove`;
`rules.list|save|remove`;
`cards.list|get|add|update|move|assign|comment|check|block|unblock|archive|restore|delete|accept|answer|approve_plan|stop|retry`;
`review.list|approve|changes|reject`;
`work.queue|next|heartbeat|log|plan|ask|submit|return|fail|release|resume`;
`inbox.list|seen`; `insights.flow`; `activity.list|revert|undo`.

**Identity.** The UI sends no agent header: its calls are the person. The
agent-app CLI sends `X-A2App-Agent`: any CLI call is the agent (one agent
works the board). Identity is declared by the caller, so the server-side
rules catch agent mistakes, not malice.

**Who does a card.** Cards you add are yours unless you say otherwise. A
card entering a column the agent works is assigned to the agent and queued
(moving a card there is the handoff). A card assigned to the agent is
worked in to-do and started columns; review, Done and Canceled are yours.
Turning the agent on for a column queues the cards there that are not
yours.

**The work protocol.** `work.next` claims one card atomically (a version
check inside a transaction), most urgent first (no priority last), and
returns everything needed to work it: the card, the board's how-we-work,
the column's policy and instructions, the person's feedback and the recent
conversation, the run id and the lease. Several agent sessions may run at
once (one per trigger fire); together they hold at most `max_working`
cards, and `work.next` never hands out a card another session holds. A
card in a to-do column moves into the next started column when claimed
(WIP permitting, criteria gate permitting). The agent logs steps
(`work.log`), renews the lease (`work.heartbeat`, every third of the
lease), may post a plan (`work.plan`; in a plan-first column the card then
waits for the person), and ends every claim with one of `work.submit`
(summary, evidence, unverified, each acceptance criterion; it moves on to
review or to the next column the agent works, never to Done), `work.ask`
(one question; the card waits on the person and comes back with the
answer), `work.return` (hand back with a reason), `work.fail` (retried up
to the column's attempts, then needs attention) or `work.release`. Plan and
question rounds do not count against the attempts. Every work.* call passes
the `--run` from work.next, so a session whose card was taken over is
refused (stale_run) instead of working on in parallel.

**Sessions that went away.** At the limit, `work.next` lists the held cards
with how long each has been quiet; a card with no heartbeat for 1.5
heartbeat intervals is `resumable`, and `work.resume --card <key>` takes it
over (the old run ends as released, a new run starts on the same attempt).
A card another session still checks in on is refused (code active).

**Waking.** `work_waiting` fires when work is queued, except while the agent
has called within the last 90 s: it is mid-session and loops work.next
itself. The work stays marked, so the minute cron wakes it if it goes quiet
with work waiting.

**Lean reads for the agent.** `boards.get`, `cards.list`, `cards.get` and
the cards written by `cards.add|update|move` answer a CLI caller with a lean
shape (key, title, column, assignee, priority, state, labels, due, version
and so on; a single card adds its text, checklist, plan, review and the last
25 activity lines); `--full true` gives every field. The UI gets the full
shapes. A board read went from ~18,000 to ~5,000 characters.

**Guards.** person_only (structure, assignment, reviews, archive, delete,
settings, revert), human_only (Done and Canceled), wip_full (binding for
the agent), claim_required (cards in started columns change only while the
agent works on them), version_conflict, criteria_required, checklist_open,
board_frozen, agent_paused, proposal_cap (20 a day), question_cap (4 a day
per card), handoffs over 3 go to review.

Routes live in `pb/pb_hooks/ops.pb.js`; logic in `lib_model.js` (identity,
shapes, positions, the activity log), `lib_cards.js` (moves and their
effects, edits, assignment, review), `lib_work.js` (the queue, leases,
cards at once, expiry, waking the agent), `lib_boards.js` (boards, columns,
labels, templates), `lib_auto.js` (rules), `lib_app.js` (settings, the
agent's status and report card, state, inbox, insights, activity, revert),
`lib_guide.js`, `lib_rules.js`, `lib_util.js`.

## The frontend

- `App.tsx`: layout, routes (`#/board?id=`, `#/inbox`, `#/review`, `#/insights`, `#/activity`, `#/settings`), global keys (C, /, Esc, Ctrl+Z), notices.
- `lib/context.tsx`: one `app.state` call feeds the sidebar, badges, the agent's status and notices; the open card, the composer, the optimistic pause switch.
- `lib/live.ts`: one realtime hub; views reload debounced and at most once per `minGap` (the app shares its request budget with the local agent).
- `components/board/`: `BoardView.tsx` (columns, lanes, drag and drop with optimistic moves, filters, quick add; the `Glide` class component measures every card in `getSnapshotBeforeUpdate` and animates moves after the update, flying cards that change column above the columns; the dragged card is moved every frame outside React), `CardFace.tsx`, `ColumnSettings.tsx` (the contract), `BoardSettings.tsx` (general, columns, labels, rules builder).
- `components/card/`: `CardPanel.tsx` (session, properties, text, checklist, activity, composer), `Review.tsx` (packet and decisions).
- `components/`: `Sidebar.tsx`, `Composer.tsx`, `NewBoard.tsx`, `marks.tsx` (category and priority icons, state chip, age dots), `ui.tsx` (controls; `AgentAvatar` is the one agent mark).
- `pages/`: `Inbox.tsx`, `Review.tsx`, `Insights.tsx` (SVG charts and the agent's report card), `Activity.tsx`, `Settings.tsx`.
- `theme.css`: `--kb-*` tokens derived from the kit's `--agent-app-*` (`--kb-col`, `--kb-tile` and friends give the board its grey steps), Inter, the pointer cursor for clickables, drag and glide animations (off under reduced motion), markdown and field styles.
- Phones (under 768px): the sidebar is a drawer (`app.menu`, opened by `MenuButton` at the start of every page header, closed on navigation); page headers shrink their buttons to icons and wrap their controls; the board shows its live status in a strip, columns snap one at a time, and a card is picked up with a 280 ms press and hold (a swipe scrolls, a tap opens it); Review stacks its list and the review with a back button.

## Agent triggers

| Trigger | Fired when | What the agent does |
|---------|------------|--------------------|
| `work_waiting` | A card is queued for the agent (it entered a column the agent works, was assigned to the agent, got an answer, a plan approval, changes requested or a retry); reminded every 10 minutes while work still waits | `work.next` until it gives no card (or says the agent already works its limit), finishing every claim with submit, ask, return or fail; reports what it did and what waits on the person |

One trigger for all waiting work (the trigger plane allows 30 fires an hour
and a cooldown). It needs one approval in CraftBot before it can run.

## External data

None. Everything stays on this computer.

## Background jobs

- `kb_work` (every minute): leases that ran out go back to the queue with an attempt counted (or to the person after the column's max attempts), and the agent is asked again when work still waits.
- `kb_rules` (hourly): idle and due-soon rules, at most once a day per card.
- `kb_prune` (03:23 daily): activity older than a year.

## Gotchas

- Hooks do not hot-reload: restart the app after a hook change.
- PocketBase filters take plain field names: `column = {:c}`, never backticks (SQL in `rows()` may quote).
- The system rate limit is 300 `/api/ops/` calls a minute per address, shared by the UI and the local agent: keep views on `useLive` (debounced, `minGap`) and the shell on the single `app.state` call.
- The PocketBase SDK cancels a request when another goes to the same path: `api.ts` sends `requestKey: null`.
- The kit's Shell wraps the app in `min-h-screen`: the app root sizes itself (`h-[100dvh]`).
- `theme.css` loads before Tailwind, so it declares Tailwind's layer order first (`@layer theme, base, components, utilities`); `.kb-field`, `.kb-tile` and `.kb-col` live in `@layer components` so utilities (`border-0`, the selected card's accent border) override them.
- A move is the one place column-entry effects happen (`lib_cards.place`): stamps, sessions ending, review by drag, the handoff to the agent, rules. Rules' own moves pass `fromRule` so rules never chain.
- Sort the queue in code: priority 0 means none and must come last, so a plain `priority` sort would put it first.
- Never call `.reverse()` (or other in-place array methods) on what `findRecordsByFilter` returns: it is a Go slice, and goja mirrors it (A B C becomes A B A). Copy first: `Array.from(rows).reverse()`.
- Touch drags: a touch keeps sending its moves to the element it started on, and they stop when that element leaves the page. The dragged card stays mounted (hidden) during a drag; cards use `touch-action: manipulation` and a non-passive `touchmove` listener blocks scrolling only once a drag has started.

## Ownership map

- Editable: `frontend/src/app/`, `pb/pb_migrations/` (new files only), `pb/pb_hooks/*.pb.js` and `lib_*.js` (not the `_*.js` system files), `operations.json` (non-system entries), `triggers.json`, this file, `reference/`.
- System-managed (never edit): `frontend/src/kit/`, `frontend/src/main.tsx`, `frontend/src/config.gen.ts`, `frontend/src/app.css`, the underscore hooks (`pb/pb_hooks/_*.js`), `manifest.json`.
