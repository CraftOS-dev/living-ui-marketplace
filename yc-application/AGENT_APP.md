# YC Application

A pipeline that takes founders from their links to a submitted Y Combinator
application. Your AI agent reads the founders' website, profiles and files,
fills every answer it can, asks the founders only for what it cannot find,
reviews each answer the way a YC partner reads it, checks the whole
application against YC's own guidance, estimates the chance of getting in,
and types the application into YC's form. A founder presses Submit.

Design and research: `reports/YC application tools landscape and design.md`
and `research_notes/YC application tools landscape and design/` in the
CraftBot repository (the checklist and the odds model come from
`yc_do_it_right_checklist.md`).

## Requirements

See `reference/requirements.md` (binding). Feature checklist:

- [x] Pipeline page: Gather, Team, Answers, Review, Founder video, Submit, each state worked out from the data
- [x] Gather: links and files as sources; one press asks your AI agent to read them and fill the application (trigger `gather_requested`)
- [x] The YC form (Founders, Company, Progress, Idea, Equity, Curious) with yes/no gates, the 50 character one-liner, monthly revenue, numbers, category
- [x] Founder profiles (most impressive thing, hack story, things built, awards) per founder
- [x] Your AI agent never overwrites a founder's words: its text becomes a suggestion; its own answers stay unconfirmed until a founder reads them
- [x] Reviewer: every answer read by the host LLM in JSON mode (marketing speak, jargon, vague, overclaim, machine-written, off the question, missing parts, a shorter version), then the whole application (founder signal, fit, insight, demand, history, inconsistencies)
- [x] Checks: about 50 checks from YC's guidance, decided from structured facts or the reviewer's structured verdicts, never from word lists; "Do these before you apply" from the failing ones
- [x] Odds: the 100 point model (seven factors, caps, modifiers, five bands anchored on YC's published rates), with the moves worth most
- [x] Founder confirmations: video rules, full-time if accepted, one application, vesting, IP, roles, monthly revenue
- [x] Tell your AI agent: a message thread (trigger `message_sent`)
- [x] Submit: ready check, your AI agent fills YC's form in its browser and stops before Submit (trigger `fill_form_requested`), "I submitted" freezes what was sent and locks the answers, status after (interview, decision), next batch
- [x] Copy by hand and Markdown export
- [x] Batch and deadline: a new install starts on the next YC batch; the batch list and "Apply again" follow the calendar
- [x] A neutral, high-contrast look with YC's orange and logo, in light and dark

## Entities

| Collection | Purpose | Notes |
|------------|---------|-------|
| settings | One row (`ycsettings00001`): batch, deadline, status, confirmations, gather and fill state, the whole-application review, what was sent | batch names and YC's published deadlines live in `lib_batches.js` (add each new deadline to `KNOWN`); the view adds `batches` and `next_batch` |
| founders | The team: role, links, technical, full-time, equity, who added it, confirmed | equity 0 means not given |
| answers | One row per question key; founder profiles use `fp.<founder id>.<field>` | origin person/agent/system, confirmed, suggestion, need, judge (JSON), judge_state |
| sources | Links and files your AI agent reads | file path returned as `disk_path` |
| messages | Founders' messages to your AI agent and its replies | |
| activity | Who changed what | |

Every collection is closed to the raw API (rules null) and refuses direct
writes (hooks.pb.js); screens and agents use the operations.

## Operations

Generated from the catalog (`pb/pb_hooks/cat_*.js`) by `node tools/gen.mjs`
into `pb/pb_hooks/routes.pb.js`, `operations.json` and
`frontend/src/app/lib/ops.gen.ts`. Every route runs through `lib_ops.js`
(caller, parameters, handler, JSON errors with a `code`, live-update flush).
Start with `app.guide`. Areas: app, pipeline, settings, activity, questions,
answers, founders, sources, review, gather, messages, submit, export.
Founders-only operations (`agent: 'deny'`): answers.confirm, answers.accept,
answers.use-shorter, founders.confirm, gather.start, messages.send,
submit.fill, submit.done, submit.next-batch.

## Triggers

Written from the recipes in `lib_guide.js` by `node tools/gen_triggers.mjs`:

| Trigger | Fired by | Your AI agent |
|---------|----------|---------------|
| gather_requested | Gather and fill | reads every source, adds founders, fills answers, asks for the rest, checks the deadline |
| message_sent | Tell your AI agent | does what the message asks, replies |
| fill_form_requested | Fill YC's form | types the packet into apply.ycombinator.com in the Mini Browser, reports each section, never presses Submit |

## Background work

`hooks.pb.js` cron `yc_review` runs `lib_judge.work` for 55 s every minute,
waking on an in-memory flag when an answer is saved: answers in batches of
six, then the whole application when anything changed. Outside CraftBot the
host LLM is unreachable: answers read "offline" and are retried. Cron
`yc_messages` relays messages written while your AI agent was being asked.
On the first request after a start and hourly (cron `yc_batch`), `lib_batches.ensure`
moves an application nobody has touched (no founders, sources, answers,
messages or activity) to the next batch still open, so a new install never
starts on a passed deadline. Past the last deadline in `KNOWN` the batch is
worked out from YC's quarterly cadence and has no deadline until your AI
agent reads it on ycombinator.com/apply (gather recipe, step 7) or a founder
types it. Once anyone works on the application the batch stays; a passed
deadline shows as late, because YC still reads late applications.

## External data

| Source | Used for | Auth | Called from |
|--------|----------|------|-------------|
| CraftBot host LLM (`_craftbot_bridge.callLLM`, JSON mode) | Reviewing answers and the whole application | bridge token | lib_judge.js |

No third-party HTTP. Websites, LinkedIn and YC's form are read and filled by
your AI agent in its own tools, never by the app.

## Look

The Expenses tracker's layout on a neutral, high-contrast base,
`frontend/src/app/theme.css`: a grey page holding one rounded panel, white
cards with a visible border, grey rows inside them and near-black text, in
Manrope. The header has YC's logo, a five-step stepper (Links & files, Team,
Answers, Polish, Submit; one hash route each, `lib/router.ts`) and pills for
the odds and the days left. Beside every step a rail holds the next thing to
do, the odds gauge and "Tell your AI agent". YC's orange (#fb651e) and black
appear only where the eye should go: the main actions, the current step, the
odds gauge and the dots that mark something needing attention. Colors come
only from the app's `--yc-*` tokens, so the look is the same in every
CraftBot style pack; light and dark follow CraftBot's mode. Type scale
12/13/14/15/26 on a 4px grid. No emoji, no em dashes in copy, "your AI
agent". This look replaced the Hacker News look of the first brief
(`reference/requirements.md` item 2).

## Ownership map

- Editable: `frontend/src/app/`, `pb/pb_migrations/`, `pb/pb_hooks/ops.pb.js` and the app's own `lib_*.js`, `cat_*.js`, `hooks.pb.js`, `routes.pb.js` (generated), `operations.json` (generated, non-system entries), `triggers.json` (generated), `tools/`, this file, `reference/`.
- System-managed (never edit): `frontend/src/kit/`, `frontend/src/config.gen.ts`, the underscore hooks (`pb/pb_hooks/_*.js`), `manifest.json`.
