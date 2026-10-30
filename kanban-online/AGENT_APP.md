# Kanban Online

> Per-project plan, context and index. Keep it current with every change.

## What this app does

Kanban boards a **team of people** shares with **several AI agents**. People
sign in; each agent connects through the agent-app CLI under its own name.
Boards have columns; each column is a small **contract**: what the stage
means (its category), a WIP limit, **who works it** (people, any agent, or
one named agent), the gates agents pass (a plan a person approves first,
acceptance criteria, a finished checklist), where finished work goes, where
review sends rework, and how long an agent may hold a card without a
heartbeat.

A card is assigned to a **person**, to **one agent**, to **any agent** (the
pool: the first free agent takes it) or to nobody, and has a **requester**:
the person who handed it to agents and who gets the questions and the
result. Moving a card into a column agents work hands it over. An agent takes
cards with leases, shows what it is doing live, asks its requester when it
would have to guess, and hands work back with evidence; **people** keep the
decisions: reviews, Done, and the switches that pause one agent or all of
them.

The rules agents are held to are enforced by the server, not by asking
nicely: an agent never moves a card to Done or Canceled, never decides a
review, never touches a card another agent holds, is refused by a full WIP
limit, a frozen board or a pause, works at most its "cards at once" across
all its sessions, and what it creates is a proposal a person accepts. Every
change is an event attributed to the person, agent, rule or board that made
it, with before and after, and can be reverted.

The look is CraftBot's own, the same as Kanban Board: three clear grey steps
on the board (the page, darker columns, cards on the plain surface; in dark
mode the columns sink and the cards rise), a CraftBot-style sidebar (New
card, views, Boards, the team's agents with their live status and switches,
and you at the foot), cards that lift, tilt, make room and settle when
dragged, and glide when someone else moves them. People are solid circles in
their colour; agents are soft rounded squares in theirs; "any agent" is a
dashed square. The sign-in page is the kit's, dressed in theme.css.

## Requirements

See `reference/requirements.md` (binding). Feature checklist:

- [x] Sign in / create account (the kit's form, styled: the app's mark and name, a heading per mode, the orange button, a dot-grid ground); the first account is the admin; an account made on this computer always joins at once; one made through a shared link joins at once (the default) or, if the workspace asks for approval, waits for an admin, and every admin gets a notice right away
- [x] Before the boards: a waiting account sees "You are on the list" with the admins who can let it in (and can give its name), and opens the boards by itself when let in; a suspended account sees that; a new account names itself first, and the first admin names the workspace and chooses how people join
- [x] Sidebar: New card (C), Inbox (what needs you), Review, Insights, Activity, Team (admins: how many wait to join); Boards (who is looking at each, a live dot while agents work there, a count of what needs people); Agents: each agent's status line and its own switch, plus the brake that pauses them all; at the foot you (name, role, workspace, how many teammates are online) with Settings, Team and Sign out; collapses to a rail; a drawer on phones
- [x] Board: darker columns with a category icon, count against the WIP limit, "Any agent works here" / "Researcher works here" and gates; drag and drop with the Kanban Board motion; quick add; collapse columns; search (/), filter (each person and agent with cards here, unassigned, agent state, priority, labels); swimlanes by assignee (you, each teammate and agent, any agent, unassigned) or priority; the board's live status (working, queued, need people) and the teammates looking at it
- [x] Card face: key, priority, title, what its agent does now (live line and sweeping edge), labels, due, checklist and plan progress, one state chip, age dots, the avatar of whoever has it (the agent working it, a person, an agent, any agent)
- [x] Card panel: the session named for its agent (working with plan, lease and Stop; queued for one agent or any agent; a question from a named agent anyone may answer; a plan to approve; criteria to add; handed back or failed with Retry, give it to any agent, or take over; proposals by a named agent), the review packet with who did it and whose card it is; title, status, assignee (picker: you, people, any agent, each agent, nobody), requester, priority, labels, due; text, checklist; activity as messages signed by people and agents, each agent's steps folded into "N steps"; comments
- [x] New card dialog: heading, title, description, board, column, assignee picker (you by default; a column agents work decides: its agent, or any agent unless you pick one), priority; picking an agent shows acceptance criteria and what happens next
- [x] Inbox: Mine (cards you asked for or hold, and ones nobody owns) or Everyone; questions and plans with who asked, needs attention, proposals with who proposed, blocked, overdue; "Since you were away" names the teammates, agents and rules
- [x] Review queue: Mine or Everyone; who did the work and whose card it is; J/K, A, R; request changes goes back to the agent that did it, reject goes to the requester
- [x] Insights: KPIs, the agents' report card (all of them, then one row each), aging WIP, cycle time, throughput and cumulative flow split between agents and people
- [x] Activity: Everyone, Me, People, Agents, Rules, or one person or agent (from the Team page); revert; Ctrl+Z undoes your own last change only
- [x] Team: people (online and where, open cards, role; admins let people in, decline, suspend, restore, make admins; the workspace keeps an admin) and agents (status, cards it works now, queue, last seen, a week's report card, its own switch; admins rename, set cards at once, remove and bring back); how to add an agent
- [x] Board settings: name, key, description, how-we-work, freeze for agents, swimlanes, delete (admins); columns; labels; rules (assign to whoever asked, any agent, a person or an agent; conditions on a person, an agent, nobody, or one of them)
- [x] Settings: your name, colour, sign out; what interrupts you; where your inbox opens; the workspace (name, how people join, default cards at once per agent: admins); let agents work; how agents connect; shortcuts
- [x] Presence: each open page reports where its person is (every 45 s and on every move); the board header, sidebar, Team page and app.context show it
- [x] V1 installs converted (boards, lists, cards, labels; the people already signed up stay members, the first is the admin)
- [x] Every UI action has an operation; the agents use the same ones

## Entities

| Collection | Purpose | Notes |
|------------|---------|-------|
| users | PocketBase auth, plus `role` (admin, member), `status` (active, pending, suspended), `tone`, `prefs` (attention, inbox), `seen_at` (for the digest) | Members read each other; a person changes their own name, email and password; only admins change role and status (hooks) |
| settings | One row: `name` (workspace), `joining` (open by default; approval holds people from shared links), `paused` (every agent), `max_working` (default cards at once per agent), `defaults` | Admins; anyone pauses |
| agents | `handle` (unique), `name`, `kind` (craftbot, external), `tone`, `paused`, `max_working` (0 = default), `last_seen`, `archived` (removed) | A new CLI name registers itself; CraftBot is there from the start |
| boards | `name`, `key`, `description`, `instructions`, `seq`, `frozen`, `archived`, `sort`, `swimlanes` | Deleting is admin-only |
| columns | `board`, `name`, `category`, `position`, `wip`, `policy`, `instructions`, `agent_mode` (off, any, one), `agent` (relation, for one), `plan_first`, `need_criteria`, `need_checklist`, `next`, `return_to`, `lease_minutes`, `max_attempts`, `aging_days`, `collapsed` | Review and finished columns are always people's |
| cards | as Kanban Board, with `assignee` (`user:<id>`, `agent:<id>`, `pool` or ''), `requester` (users), `created_by` (`user:`/`agent:` key), `claimed_by` (agents: who holds the lease) | `version` refuses stale writes |
| labels | `board`, `name`, `color` | |
| events | `board`, `card`, `actor` (`user:`, `agent:`, `rule:` key or `system`), `actor_kind` (person, agent, rule, system), `kind`, `text`, `field`, `before`, `after`, `run`, `meta`, `reverted` | Append-only; a year is kept |
| runs | `agent`, `from_pool`, `card`, `board`, `column`, `attempt`, `started`, `ended`, `outcome`, `note`, `cost`, `decision`, `decided` | One per claim; per-agent report cards |
| rules | `board`, `name`, `enabled`, `when`, `column`, `days`, `conditions`, `actions`, `position`, `runs`, `last_run`, `paused_reason` | Assign targets stored as keys |

Board collections are readable by active members only (`@request.auth.status
= "active"`, realtime included) and change only through the operations
(`hooks.pb.js` refuses direct writes). A pending or suspended account reaches
only `me.get`, `me.update` and `app.guide` (`lib_util.memberGate`).

## Operations

70 operations in `operations.json`: the 63 of Kanban Board (settings,
boards, columns, labels, rules, cards, review, work, inbox, insights,
activity) plus `me.get|update`, `people.list|update`,
`agents.list|update|remove`.

**Identity.** People call with their PocketBase token: their calls are the
person (pending and suspended accounts are refused). The agent-app CLI signs
in as the app's machine superuser and names itself with `X-A2App-Agent`
(`A2APP_AGENT`); each name is one agent, the generic names (`a2app-cli`,
`cli`, `craftbot`, ...) are CraftBot, and a new name joins the team the first
time it calls (`agent_joined` event). A removed agent is refused. Names are
declared by the caller, so these rules catch mistakes, not malice.

**Who does a card.** Cards a person adds are theirs unless they say
otherwise (`--assignee me|none|pool|<email>|<handle>`). A card entering a
column worked by one agent is assigned to it; a column worked by any agent
puts it in the pool unless it already names an agent; a card assigned to an
agent or the pool is worked in to-do and started columns. Whoever hands a
card to agents becomes its requester. Handing a column to agents queues the
cards there that are not a person's.

**The work protocol** is Kanban Board's, per agent: `work.next` claims one
card assigned to the caller or to the pool (atomically; a pool card becomes
the caller's, and rework comes back to it); the payload names the requester
and who said what. Each agent has its own cards-at-once limit (its own or
the workspace default), its own pause, its own queue; `held` and `resume`
refuse a card another agent holds (`not_yours`). A pool card whose claim ends
unfinished (release, fail, expired lease) goes back to the pool so another
agent can take it. `work.ask` and `work.return` go to the requester; review
"Request changes" goes back to the agent that did the work.

**Waking.** `work_waiting` fires for work CraftBot can take (assigned to it
or the pool), except while CraftBot called in the last 90 s or is paused.
Other agents poll `work.next` (or run their own schedule).

**Guards.** As Kanban Board, plus admin_only (workspace settings, roles,
suspending, renaming and removing agents, deleting boards), agent_paused
(this agent), agents_paused (the team brake), agent_removed, not_yours,
last_admin, self (no changing your own role or status), pending, suspended.

Routes live in `pb/pb_hooks/ops.pb.js`; logic in `lib_model.js` (identity,
parties, shapes), `lib_team.js` (accounts, sign-up hooks, people, agents,
presence), `lib_cards.js`, `lib_work.js`, `lib_boards.js`, `lib_auto.js`,
`lib_app.js` (settings, report cards, state, inbox, insights, activity,
revert, undo, context), `lib_guide.js`, `lib_rules.js`, `lib_util.js`
(handler plumbing and the member gate).

## The frontend

- `App.tsx`: the `Gate` (waiting, suspended, welcome), layout, routes (`#/board?id=`, `#/inbox`, `#/review`, `#/insights`, `#/activity`, `#/team?agent=`, `#/settings`), global keys, presence heartbeat, notices.
- `components/Gate.tsx`: the screens before the boards; reloads the page when an admin lets a waiting account in (its realtime connection was opened while pending).
- `lib/context.tsx`: one `app.state` call (you, settings, boards, people, agents, what needs you and the team) feeds the sidebar, badges and notices; optimistic pause switches (team and per agent); re-reads every minute for presence.
- `components/people.tsx`: `AssigneeMenu`, `PartyChip`, `assigneeKey`, `usePartyOf`.
- `components/ui.tsx`: `PersonAvatar` (circle), `AgentAvatar` (square, tone), `PoolAvatar` (dashed), `PartyAvatar`, `partyName`.
- `pages/Team.tsx`: people and agents.
- Everything else as Kanban Board (`BoardView.tsx` with `Glide`, `CardPanel.tsx`, `Composer.tsx`, `Insights.tsx`, ...).
- `theme.css`: as Kanban Board, plus `.kb-person`, `.kb-gate` and the sign-in page (unlayered rules on the kit's LoginGate, matched with `:has(input[type=password])`; the mode heading switches on `autocomplete="new-password"`).

## Agent triggers

| Trigger | Fired when | What the agent does |
|---------|------------|--------------------|
| `work_waiting` | A card is queued for CraftBot or any agent; reminded every 10 minutes while it waits | CraftBot runs `work.next` until no card is left for it, finishing every claim; reports what waits on the team, naming the requesters |

## External data

None. Everything stays on this computer (or the host the team shares it from).

## Background jobs

- `kb_work` (every minute): expired leases back to the queue (and the pool), CraftBot asked again when its work waits.
- `kb_rules` (hourly): idle and due-soon rules.
- `kb_prune` (03:23 daily): activity older than a year.

## Gotchas

- All of Kanban Board's (hooks do not hot-reload; plain field names in filters; 300 ops a minute per address; `requestKey: null`; the layer order in theme.css; `Array.from(rows).reverse()`; touch drags keep the dragged card mounted).
- `who()` reads the auth record of the request, which PocketBase loads fresh: an approval takes effect on the next call. The realtime connection keeps the record it opened with, hence the Gate's reload.
- The sign-in styles target the kit's markup (`.min-h-screen.items-center.justify-center:has(> div > div > form input[type=password])`): re-check them when the kit version changes.
- Presence lives in the app store (`kb.ui:<user id>`), not a collection: nothing realtime fires when someone moves, so the frame re-reads `app.state` every minute.
- `users` update requests from non-superusers may not change `role`, `status` or `seen_at` (`lib_team.onSelfUpdate`); sign-up ignores any role or status sent (`onSignup`).
- Joining: a sign-up on this computer is never held (`lib_team.fromThisComputer` mirrors the system hooks' remote check: relay headers or a non-loopback host mean a shared link). In record hooks the HTTP request is `e.requestEvent.request`, not `e.request` (undefined there), so a check written for routes silently fails in a hook.
- Admins learn about people waiting from `app.state.waiting` (a notice the moment someone asks, plus the Team badge); `me.get` gives a waiting account the admins' names.

## Ownership map

- Editable: `frontend/src/app/`, `pb/pb_migrations/` (new files only), `pb/pb_hooks/*.pb.js` and `lib_*.js` (not the `_*.js` system files), `operations.json` (non-system entries), `triggers.json`, this file, `reference/`.
- System-managed (never edit): `frontend/src/kit/`, `frontend/src/main.tsx`, `frontend/src/config.gen.ts`, `frontend/src/app.css`, the underscore hooks (`pb/pb_hooks/_*.js`), `manifest.json`.
