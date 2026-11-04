# Tasks: Kanban Online

Every task cites what it implements. These features already exist in the published app `kanban-online` 2.0.0, so the build tasks are recorded as done.

## Build
- [x] T-1 (F-ACC-1): the kit's sign-in gate dressed as the app: mark, name, and a heading and sub-text per mode (`theme.css`).
- [x] T-2 (F-ACC-2, F-ACC-3): sign-up roles and status in `lib_team.onSignup`: the first account is an active admin; the computer that runs the app and open joining let people in at once; otherwise the account is pending and the `person_waiting` event notifies admins.
- [x] T-3 (F-ACC-4, F-ACC-5, F-ACC-7): the gate screens (`Gate.tsx`): waiting (naming the admins, with a name field, 20 s check and self-reload), suspended, and "The board did not answer". The server's `memberGate` limits waiting and suspended accounts to `me.get`, `me.update` and `app.guide`.
- [x] T-4 (F-ACC-6): the welcome screen with display name, plus the first admin's workspace name and joining choice.
- [x] T-5 (F-FRM-1, F-FRM-2, F-FRM-3): the sidebar (`Sidebar.tsx`): New card, views with counts, folding Boards with viewers, a working dot and need-people counts, agents with status and switches, and the account at the foot. It collapses to a rail, and that choice is remembered.
- [x] T-6 (F-FRM-4): the phone drawer with the menu button's attention dot.
- [x] T-7 (F-FRM-5, F-REV-3): keyboard shortcuts: C, /, Esc and Ctrl/Cmd+Z globally (`App.tsx`), and J/K, A and R on Review.
- [x] T-8 (F-FRM-6, F-SET-2): interruption notices from each person's preferences (up to four, the oldest leaving after 9 s; join requests always shown to admins), and the "What interrupts you" settings.
- [x] T-9 (F-FRM-7): the `--kb-*` tokens mixed from the kit's warm-neutral tokens: grey steps, Inter, 8 px corners, light and dark, identity tones, the hand cursor, lucide icons (`theme.css`, `marks.tsx`).
- [x] T-10 (F-FRM-8): reload onto a new build after a reconnect or a tab show, waiting while a dialog is open (`lib/live.ts`).
- [x] T-11 (F-BRD-1, F-BRD-14): New board from templates with name and key (automatic when empty), and the "No board yet" state (`NewBoard.tsx`, `lib_boards.js`).
- [x] T-12 (F-BRD-2, F-BRD-7): the board view: columns with worker chips and WIP pills, cards, live counts, and viewers (`BoardView.tsx`).
- [x] T-13 (F-BRD-3, F-BRD-4): animated drag and drop: lift, tilt, a placeholder that makes room, settle, press-and-hold on touch, and edge auto-scroll. Others' moves glide in (FLIP).
- [x] T-14 (F-BRD-5): quick add in a column, and the New card dialog with acceptance criteria for agent work (`Composer.tsx`).
- [x] T-15 (F-BRD-6): search, filters (assignee, agent state, priority, labels) and swimlanes by assignee or priority, where a drop reassigns or reprioritizes.
- [x] T-16 (F-BRD-8, F-BRD-9): columns: add, rename, collapse, move, and remove with a move-to confirmation. Column settings hold the contract (stage, who works it, gates, lease, attempts, flow, policy) and save as they change (`ColumnSettings.tsx`).
- [x] T-17 (F-BRD-10, F-BRD-11, F-BRD-12): Board settings: general, freeze, swimlanes, labels, rules (When / If / Then, on/off, remove), and the admin-only delete with its confirmation. The only board is protected (`BoardSettings.tsx`, `lib_auto.js`).
- [x] T-18 (F-BRD-13): handing a card to agents queues it, makes the hander its requester, and asks for criteria when the column requires them (`lib_cards.queueCard`).
- [x] T-19 (F-CRD-1, F-CRD-2): the card panel docked on the right over the live board: title, markdown description, criteria, checklist and properties (`CardPanel.tsx`, `markdown.tsx`).
- [x] T-20 (F-CRD-3): the session box: queued, working (lease, attempt, Stop), plan, question, needs attention, proposed, and review, each with its actions.
- [x] T-21 (F-CRD-4, F-CRD-5): comment, block and unblock, archive and restore, and delete behind "Delete this card?".
- [x] T-22 (F-CRD-6, F-ACT-1, F-ACT-2, F-ACT-3): attributed events with before and after (`lib_model.log`), card activity with folded agent runs, the Activity page with filters and "Load older", per-event revert, and Ctrl/Cmd+Z undo of your own last change within 30 minutes (`lib_app.js`).
- [x] T-23 (F-INB-1, F-INB-2, F-INB-3, F-INB-4): Inbox: "Needs you" groups for mine or everyone, inline actions, "Since you were away" with "Mark all as seen", and the empty states (`Inbox.tsx`).
- [x] T-24 (F-REV-1, F-REV-2): the review queue with the evidence packet and the Approve / Request changes / Reject flows, selecting the next card after each (`pages/Review.tsx`, `lib_cards.js`).
- [x] T-25 (F-INS-1, F-INS-2, F-INS-3, F-INS-4): Insights: board and window choice, KPIs split between agents and people, the agents' report card together and per agent, and the aging WIP, cycle time, throughput and cumulative flow charts (`Insights.tsx`, `insights.flow`).
- [x] T-26 (F-TEAM-1, F-TEAM-2): Team / People: presence and where each person is, open cards, and the admin actions (let in, decline, suspend, restore, make admin or member) with the self and last-admin guards (`Team.tsx`, `lib_team.js`).
- [x] T-27 (F-TEAM-3, F-TEAM-4, F-TEAM-5, F-TEAM-6): Team / Agents: status, current work, the 7-day report card, pause by any member, admin rename and limit, remove (with the confirmation and the hand-back of cards and columns), bring back, and "Add an agent".
- [x] T-28 (F-SET-1, F-SET-3, F-SET-4, F-SET-5): Settings: name, color, sign out; the admin workspace name, joining and cards at once; "Let agents work"; the agent explainer and the shortcut list (`Settings.tsx`).
- [x] T-29 (F-AGT-1, F-AGT-10): the 44 agent operations in `operations.json`, served by `a2app_routes.pb.js` through the View's own handlers. Refusals carry codes and messages, and destructive operations go through the adapter's approval.
- [x] T-30 (F-AGT-2): per-agent identity from the declared name (generic names count as CraftBot), registered on the first call with its own queue, limit and pause (`lib_model.js`).
- [x] T-31 (F-AGT-3, F-AGT-4, F-AGT-5): the work protocol: atomic `work.next` claims (most urgent first, pool cards becoming the claimer's), plan, log, heartbeat, ask, submit, return, fail, release and resume. Leases are expired by `kb_work` (`lib_work.js`).
- [x] T-32 (F-AGT-6, F-AGT-7, F-AGT-8): the server-enforced agent rules: never Done or Canceled, never a review decision, never structure, delete or archive, held-card protection, WIP, frozen and pause refusals, proposals into triage (capped at 20 a day), and questions and hand-backs routed to the requester.
- [x] T-33 (F-AGT-9): `work_waiting` fired by `fireIfNeeded` when work waits for CraftBot or the pool, not while CraftBot has called in the last 90 s, re-fired for newer work or after 10 minutes. It comes with the `work_waiting` playbook.

## Verification
- [x] Framework-files check (`validateFrameworkFiles` of the Agent App CLI) reports no problems for manifest.json, operations.json, AGENT_APP.md, reference/requirements.md and reference/tasks.md.
- [x] ## Operations Design in reference/requirements.md lists exactly the 44 operations of operations.json, each under its declared module.
- [ ] Agent App Framework gate (`agent-app <dir> validate`) passes, including the describe budget on a dev instance.
- [ ] Every declared operation answers through `a2app` on a live instance.
- [ ] The View renders identically to the published build (screenshot comparison).
