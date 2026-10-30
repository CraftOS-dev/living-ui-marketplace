# Kanban Online: requirements

For a team of people and the several AI agents working with them (CraftBot
and any other agent that runs the agent-app CLI under its own name), sharing
the same boards. People sign in; agents connect through the CLI. Every card
has a person accountable for it (its requester); agents do the work they are
given and hand it back with evidence.

Visual language: CraftBot's own, the same as Kanban Board. The kit's
warm-neutral tokens, Inter, 8px corners, a CraftBot-style sidebar (the app
name with a collapse button, a highlighted New card, views, a folding Boards
section, the team's agents with their status and switches, and you at the
foot), pill choices, light and dark from the host. The board has clear grey
steps: the page, darker columns, cards on the plain surface. No emoji: lucide
line icons. Colour beyond the greys carries state and identity only: each
person and agent has a colour; people are solid circles, agents soft rounded
squares, "any agent" a dashed square. Everything clickable shows the hand.
Dragging is animated as in Kanban Board; what teammates and agents move
glides on everyone's screen.

## People and access

1. People create an account with email and password on the sign-in page,
   which looks like the app (its mark and name, a heading per mode).
2. The first account runs the workspace (admin). Nobody is ever stuck on
   their first sign-in on the computer that runs the app: accounts made there
   join at once. Accounts made through a link the owner shared join at once
   too, unless the workspace asks an admin to approve new people; then every
   admin is told at once. Nobody chooses their own role or status.
3. An account waiting for an admin sees only that, with the names of the
   admins who can let it in (and may give its name); when let in, its page
   opens the boards by itself. A suspended account sees only that. Neither
   can read or change anything else, through the app or the API.
4. A new account gives its display name before the boards; the first admin
   also names the workspace and chooses how people join.
5. Admins let people in, decline them, suspend and restore members, and make
   or unmake admins; the workspace always keeps an active admin and nobody
   changes their own role or status.
6. Any member creates and shapes boards; deleting a board, workspace
   settings and agent administration are admins'.

## Agents

7. Each agent is its own identity (the name its CLI sends; generic names are
   CraftBot), registered the first time it calls, with its own queue, its own
   cards-at-once limit (or the workspace default) and its own pause switch.
   Any member pauses one agent or every agent; admins rename agents, set
   their limit, remove them (their cards go back to the pool or to nobody,
   their columns to any agent) and bring them back.
8. A card is assigned to a person, to one agent, to any agent (the pool) or
   to nobody. A column is worked by people, by any agent, or by one agent;
   moving a card into an agent column hands it over and queues it. Whoever
   hands a card to agents becomes its requester.
9. An agent claims only cards assigned to it or to the pool, atomically,
   most urgent first; a pool card becomes the claiming agent's (rework
   comes back to it) and goes back to the pool if that claim ends unfinished.
   No agent touches a card another agent holds.
10. Everything Kanban Board requires of its agent holds for each agent:
    leases and attempts, results with evidence, one question rather than a
    guess, hand-backs, never Done, never a review decision, never structure,
    proposals for what it creates, refusals by WIP limits, frozen boards and
    pauses, all enforced by the server.
11. An agent's questions and hand-backs go to the card's requester; anyone on
    the team may answer, approve a plan, or decide a review.
12. CraftBot is woken by one trigger when work waits for it; other agents
    ask for work themselves.

## The team at work

13. Each person's inbox shows what needs them (cards they asked for or hold,
    and ones nobody owns), or everyone's; the review queue likewise.
14. Each person chooses what interrupts them and where their inbox opens.
15. People see who else is online and where (the board they are on), and
    what each agent is doing now.
16. Every change is attributed to the person, agent, rule or board that made
    it, with before and after, and can be reverted; Ctrl+Z undoes only your
    own last change.
17. Flow is measured honestly, split between agents and people, with a
    report card for the agents together and for each one.

## Pages

18. The sign-in page; the screens before the boards; a sidebar and the board
    first; Inbox, Review, Insights, Activity, Team and Settings as listed in
    `AGENT_APP.md`. Cards open docked on the right with the board still live.
    Phones get the drawer, snapping columns and press-and-hold drags.
19. Every action in the UI has an operation for the agents, and every
    refusal says what to do instead.
