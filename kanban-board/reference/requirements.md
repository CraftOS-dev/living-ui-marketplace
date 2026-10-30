# Kanban Board: requirements

For one person and the one AI agent working for them (CraftBot, through the
agent-app CLI), sharing the same boards. No accounts, nothing leaves the
computer. The person stays accountable for every card; the agent does the
work it is given and hands it back with evidence. There are no agent
profiles: a card belongs to you or to the agent.

Visual language: CraftBot's own. The kit's warm-neutral tokens (page,
surface, border, muted text, the orange accent), Inter, 8px corners, a
sidebar like CraftBot's (the app name with a collapse button, a highlighted
New card, views, a folding Boards section, the agent with its status and on
switch and Settings at the foot), pill choices like the composer's, light
and dark from the host. The board has clear grey steps: the page, darker
columns, cards on the plain surface (in dark mode the columns sink below
the page and the cards rise above it). No emoji, no mascot: lucide line
icons. Colour beyond the greys carries state only (working, waiting on
you, needs attention, in review, proposed, blocked). Everything clickable
shows the hand. Dragging is animated: the card lifts and tilts with the
pointer, the destination column lights up and opens a slot, the other cards
glide out of the way and the card settles into place.

## Work

1. Boards have columns; each column has a category (proposed, backlog, to
   do, in progress, review, done, canceled) that gives it meaning for the
   agent, metrics and permissions, whatever its name.
2. Each column is a contract the person sets: WIP limit, policy, whether
   the agent works it (to-do and in-progress columns only), plan first,
   acceptance criteria required, checklist done to leave, where finished
   work goes, where review sends rework, lease length, attempts.
3. A card is assigned to the person or to the agent (the agent's own
   proposals are nobody's until accepted). New cards are the person's
   unless they choose the agent.
4. Moving a card into a column the agent works hands it to the agent and
   queues it; only an entry queues it (re-saving never does). A card
   assigned to the agent is worked in to-do and in-progress columns.

## The agent

5. The agent claims a card atomically, most urgent first, and holds it
   with a lease it renews; a lease that runs out puts the card back in the
   queue and counts an attempt; after the column's attempts it needs the
   person. Plan and question rounds do not count as attempts.
6. The agent may run several sessions at once; together they work at most
   the person's "cards at once" limit, and never the same card twice.
7. The agent ends every claim with a result (summary, evidence, what it
   could not verify, each acceptance criterion met or not), one question,
   a hand-back with a reason, or a failure; asking is preferred to
   guessing, within limits.
8. The agent never moves a card to Done or Canceled, never decides a
   review, never deletes or archives, never changes the board's
   structure, rules or settings. What it creates is a proposal the person
   accepts. A full WIP limit, a frozen board and a pause refuse its
   writes. These rules are enforced by the server.
9. The agent is woken by one trigger when work waits for it.

## The person

10. Review is fast and honest: the evidence first, then Approve, Request
    changes (with a reason the agent reads; the card goes back to the
    agent) or Reject (it comes back to the person).
11. What needs the person is in one place (questions, plans, criteria,
    hand-backs and failures, proposals, reviews), each with its action
    right there; the person chooses what interrupts them.
12. The person sees what the agent is doing now, live, and can stop it on
    any card or pause it entirely with one switch.
13. Every change is attributed (the person, the agent, a rule, the board)
    with before and after, and can be reverted; Ctrl+Z undoes the person's
    last change.
14. Flow is measured honestly: aging work, cycle-time percentiles,
    throughput, cumulative flow, review wait and first-pass approval,
    split between the agent and the person, and the agent's report card.

## Pages

15. A sidebar and the board first; Inbox, Review, Insights, Activity and
    Settings as listed in `AGENT_APP.md`. Cards open docked on the right
    with the board still live. New cards are written in a tall composer.
16. Every action in the UI has an operation for the agent, and every
    refusal says what to do instead.
