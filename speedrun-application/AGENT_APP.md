# a16z speedrun Application

A pipeline that takes founders from their links to a submitted a16z speedrun
application for the next open cohort (see `lib_cohorts.js`). Your AI
agent reads the founders' website, profiles and files, fills every answer it
can, asks the founders only for what it cannot find, reviews each answer the
way a speedrun investor reads it, checks the whole application against
speedrun's published guidance, estimates the chance of getting in, and types
the application into speedrun's form. A founder presses Submit application.

Cloned from the YC Application app (e8bebd6c) on 2026-10-30 and rebuilt for
speedrun's form and guidance. Sources, read 2026-10-30: the live form at
speedrun.a16z.com/apply/form (its fields and limits from the page's own
code), speedrun.a16z.com/faq, /apply and /the-deal, and speedrun's Substack
roundtables ("What we look for in applications", "What founders ask us
before applying", "Read before applying"). Each check's `why` quotes its
source.

## Requirements

See `reference/requirements.md` (binding). Feature checklist:

- [x] Pipeline page: Links and files, Team, Answers, Polish, the team video, Submit, each state worked out from the data
- [x] Gather: links and files as sources; one press asks your AI agent to read them and fill the application (trigger `gather_requested`)
- [x] speedrun's SR008 form: Team (full-time or part-time, full-time founders, FTE, the team answer), Startup Details (100 character one-liner, 800 character description, categories, location, founded month, website, anything else), Additional Information (team video, deck, traction with revenue and usage metrics, funding history with investors, the active round, referral, where you heard of speedrun), with the form's yes/no blocks as nested gates
- [x] Founders, CEO first: every per-founder field of the form (first and last name, email, phone, country, state, city, citizenship, college, highest education, years of experience, technical end-to-end, LinkedIn, GitHub, X, portfolio) and each founder's relevant experience (1000 characters)
- [x] Full-time or part-time and the number of full-time founders are written from the team page until someone writes them by hand
- [x] Your AI agent never overwrites a founder's words: its text becomes a suggestion; its own answers stay unconfirmed until a founder reads them
- [x] Reviewer: every answer read by the host LLM in JSON mode (buzzwords, jargon, vague, overclaim, the best news buried, wins undersold, machine-written, off the question, missing parts, a shorter version), then the whole application (track record, founder-market fit, earned insight, differentiation, momentum, built together, complementary skills, inconsistencies)
- [x] Checks: about 50 checks from speedrun's guidance, decided from structured facts or the reviewer's structured verdicts, never from word lists, with structured metric sanity (bounded retention falls over time, DAU <= WAU <= MAU, a D30 of 60% or more); "Do these before you apply" from the failing ones
- [x] Odds: a 100 point model weighted to the team (40 founders, 15 insight, 20 momentum, 15 writing, 10 show us more), caps, a referral modifier, five bands anchored on speedrun's "fewer than 0.4% of applicants are accepted"
- [x] Founder confirmations: the team video's four points, the San Francisco residency, full-time during the residency, one application, IP, roles, metrics measured not projected
- [x] Tell your AI agent: a message thread (trigger `message_sent`)
- [x] Submit: ready check, your AI agent fills speedrun's form in its browser step by step and stops before Submit application (trigger `fill_form_requested`), "I submitted" freezes what was sent and locks the answers, status after (interview, decision), next cohort
- [x] Copy by hand and Markdown export
- [x] speedrun's wordmark (copied from speedrun.a16z.com, not redrawn) and its blue on the Expenses tracker's neutral base, light and dark

## Entities

| Collection | Purpose | Notes |
|------------|---------|-------|
| settings | One row (`srsettings00001`): cohort, deadline, status, confirmations, gather and fill state, the whole-application review, what was sent | |
| founders | The team, CEO first: the form's per-founder fields, technical, full-time, years, who added it, confirmed | `name` is always first_name + last_name; technical, full_time and years are '' until given (unknown is not "no") |
| answers | One row per question key; each founder's relevant experience is `fp.<founder id>.experience` | origin person/agent/system, confirmed, suggestion, need, judge (JSON), judge_state; rows answers hold a JSON list |
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
Founders-only operations (`agent: 'deny'`): confirms.set, answers.confirm,
answers.accept, answers.use-shorter, founders.confirm, gather.start,
messages.send, submit.fill, submit.done, submit.next-cohort.

## Triggers

Written from the recipes in `lib_guide.js` by `node tools/gen_triggers.mjs`:

| Trigger | Fired by | Your AI agent |
|---------|----------|---------------|
| gather_requested | Fill my application | reads every source, adds founders, fills answers, asks for the rest, checks the deadline |
| message_sent | Tell your AI agent | does what the message asks, replies |
| fill_form_requested | Fill the form | types the packet into speedrun.a16z.com/apply/form in the Mini Browser step by step, reports each step, never presses Submit application |

## Background work

`hooks.pb.js` cron `sr_review` runs `lib_judge.work` for 55 s every minute,
but LLM calls are authorized only by an explicit `answers.recheck` request.
The Review again controls first flush pending saves, then store a fixed
`settings.review_request` snapshot. The worker reviews its answers in batches
of six and then that application snapshot once. Edits never enqueue work;
old field and application feedback remains visible with freshness indicators.
Duplicate requests join the active run. Failures keep the last feedback and
require another click; no automatic retries. Startup cancels legacy automatic
queues without deleting any feedback. Cron `sr_messages` relays queued messages.
Cron `sr_cohort` (hourly, and once on the first request after a start) moves
an application nobody has touched to the next open cohort (`lib_cohorts.js`).

## External data

| Source | Used for | Auth | Called from |
|--------|----------|------|-------------|
| CraftBot host LLM (`_craftbot_bridge.callLLM`, JSON mode) | Reviewing answers and the whole application | bridge token | lib_judge.js |

No third-party HTTP. Websites, LinkedIn and speedrun's form are read and
filled by your AI agent in its own tools, never by the app.

## Look

The Expenses tracker's design system on a neutral zinc base, with speedrun's
blue (#016ccc light, #0179e3 dark, from speedrun.a16z.com's own blue scale)
only on main actions, the current step, the odds gauge and attention dots;
white labels on blue. The top bar carries speedrun's wordmark
(components/SpeedrunLogo.tsx) and "Application". Type scale 12/13/14/15/26.
No emoji, no em dashes in copy, "your AI agent".

## Ownership map

- Editable: `frontend/src/app/`, `pb/pb_migrations/`, `pb/pb_hooks/ops.pb.js` and the app's own `lib_*.js`, `cat_*.js`, `hooks.pb.js`, `routes.pb.js` (generated), `operations.json` (generated, non-system entries), `triggers.json` (generated), `tools/`, this file, `reference/`.
## Change 2026-10-31: Manual review

- Review again controls on Team, Answers, Polish and reviewed answer cards; autosaves never enqueue reviews.
- Last field and application verdicts remain visible through edits and requested reruns, with changed-since-review and progress notices.
- Additive `settings.review_request` JSON stores the explicit request and frozen saved inputs; transaction guard joins duplicate requests.
- Worker reviews only the requested snapshot; edits during a run remain saved and are not requeued. Failed calls preserve feedback and require an explicit retry.
- Pending autosaves finish before a button captures inputs. Old shorter-version text cannot replace a newer edited answer.
- Regression checks: `node reference/manual-review-regression.mjs` and the existing chat regression suite, followed by dev browser checks and independent verification.

## Change 2026-10-31: Reset and chat lifecycle

- Confirmed `app.reset` now clears all chat messages, including queued messages and agent replies, with its existing reset fields.
- Request status is consumed only through the platform's frontend `useAgentRequest` subscription; app hooks never inspect or mutate the host queue.
- The chat badge handles pending, claimed, done, rejected, failed and answered states without labeling terminal work as waiting.
- Added destructive `messages.remove --message <id> --confirm true` for owner-approved, single-message cleanup; unrelated records remain untouched.
- No schema changes. Regression checks: `node reference/chat-regression.mjs` (mock unit checks) plus dev API and browser checks before promotion.

- System-managed (never edit): `frontend/src/kit/`, `frontend/src/config.gen.ts`, the underscore hooks (`pb/pb_hooks/_*.js`), `manifest.json`.

## Change 2026-11-03: Cohorts follow speedrun's calendar

- New `pb/pb_hooks/lib_cohorts.js`: `KNOWN` holds the deadlines read on speedrun.a16z.com/apply (SR007, SR008); later cohorts follow speedrun's two a year (odd ones close mid-May, even ones November 1) with two weeks of slack, and have no deadline until your AI agent or a founder sets it. Add each newly published deadline to `KNOWN`.
- A new install starts on the next open cohort, and an application nobody has touched (no founder, link, answer, message or activity) moves on when its deadline passes: once on the first request after a start (`routerUse`) and hourly (cron `sr_cohort`).
- `settings.get` gains `cohorts` (the open cohort and the three after it) and `next_cohort`; the Submit step's cohort picker and "Apply again" use them instead of a hard-coded list.
- `settings.update` and `submit.next-cohort` given a cohort without a deadline take speedrun's known date, otherwise none, with a note to check speedrun.a16z.com/apply. A founder's cohort or deadline change is written to the activity trail.
- No schema changes.
