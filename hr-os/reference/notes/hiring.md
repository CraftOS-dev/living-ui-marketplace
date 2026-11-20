# hiring builder notes (HR OS)

Built 2026-11-04 by the hiring builder. 85 operations in six catalog files
(`cat_hiring_core.js`, `cat_hiring_plans.js`, `cat_hiring_openings.js`,
`cat_hiring_candidates.js`, `cat_hiring_interviews.js`,
`cat_hiring_offers.js`). Migration `1730005000_hiring.js` (16 collections,
seeds the settings row, 8 rejection reasons, 5 offer terms, a default offer
letter, 2 interview kits and the `requisition` and `offer` approval flows).
Libraries `lib_hiring.js` (access, settings, timeline, retention, pay
transparency, home, facts, cron), `lib_hiring_plans.js`,
`lib_hiring_jobs.js`, `lib_hiring_candidates.js`, `lib_hiring_interviews.js`,
`lib_hiring_offers.js`; `events_hiring.js`, `cron_hiring.js`,
`guide_hiring.js`. Frontend `pages/hiring/*`, `components/hiring/*`,
`i18n/hiring.en.ts`. Section for AGENT_APP.md: `reference/agent_app/hiring.md`.

## Decisions and contract changes

1. **Collection `openings`, not `jobs`** (coordinator: `jobs.*` is the agent
   job queue). Every relation to it is named `opening`. Ops group
   `openings.*` (payroll-core's opening year to date figures move to
   `ytd.*`, per the coordinator). Positions field is `positions` (not
   `headcount` or `openings`).
2. **Scorecards** live in `interview_feedback` (SPEC name) but the op group
   is `scorecards.*` (the performance module owns `feedback`).
3. Extra hiring collections beyond SPEC 4: `hiring_config` (one row),
   `staffing_plan_lines`, `hiring_events` (timeline and messages),
   `interview_kits`, `rejection_reasons`, `offer_terms`, `offer_templates`.
   Offer letters use hiring's own `offer_templates`; lifecycle's
   `letter_templates` (kind offer) is not used by hiring.
4. **Referrals** are hiring's (`referrals` collection and ops); SPEC 2 lists
   "employee referral" under lifecycle too: lifecycle should not build a
   second one.
5. Access model: `hiring:full` all of its entities; `hiring:view|edit`
   without team scope all, changes by level; team-scope roles (managers)
   only openings they manage, own or are on the team of; a panel member
   (any role) sees that interview, the candidate's basics and resume and
   writes their scorecard. Pay on hiring records shows to people with hiring
   access to the record; to your AI agent only with `agent_sees_pay`.
6. Your AI agent: moving, rejecting, hiring, scorecards and every offer
   write are `deny`; job posts, summaries, interview times, kits and
   settings rows are `propose`; adding candidates from files and notes are
   allowed. The board sorts by waiting time, applied day or name only.
7. Pay transparency is a warning (issues on the opening, a notice on the
   post's pay field, a warning when scheduling the first EU interview),
   never a block: headcount thresholds differ by law. The rule table is in
   `lib_hiring.js` (as known 2026-11; no web search was allowed).
8. Retention suggestions by country (US 365, GB 180, DE 180, FR 730, NL 28,
   HK 730, SG MY JP IN and SEA 180, others 365; 730 with consent) carry their
   basis; the owner edits them. Retention day = the later of the day added
   and the last application made or closed, plus the days.
9. Google Calendar connection is read from the bridge's
   `GET /api/integrations/available` (no helper for it in
   `_craftbot_bridge.js`), kept five minutes; events use only the allowed
   action `create_google_calendar_event` (the gate derives it into
   `manifest.capabilities.actions`). Updating or deleting calendar events is
   not done (no allowed action used); the UI says when an event is stale.
10. Emails to candidates are queued as `hiring_events` with delivery
    `pending` and sent by the minute job through `send_gmail` with
    `confirmIrreversible: true`, only when "Email candidates" is on.
11. Proposals (CLI test F9): every hiring propose op has a `preview` with a
    label that names the record ("Draft opening Payroll Specialist
    (Northwind India Pvt Ltd) with its job post", "Interview with Jane Doe
    for J0001 Backend engineer"; the time is in the fields). Change ops that name only their record answer
    `nothing_to_change` (400), so the kernel's dry run refuses them before a
    proposal exists; `interviews.schedule` marks `day` and `start` required.
    `can` flags in answers tell your AI agent what it may do: true when the
    op's agent rule is allow or propose (`openings.list` `can_add` is true
    for it). The guide covers a job post with no opening: one
    `openings.add --description` proposal.
12. UI QA round (H1 to H5): the job post saves itself 1.2 s after typing
    stops ("Saved" beside Write and Preview), leaving the Post tab saves
    what is on screen, and Publish (was "Open the opening") waits for saves
    in flight and saves every unsaved field before `openings.set-status`.
    One primary per opening page (the agent draft button is a plain
    button); the work country and region are pickers from
    `countries.list`. Dates and money reach the UI as data only: timeline
    events carry `day`, `start`, `zone` (new fields on `hiring_events`),
    approval payloads carry minor units with the currency (`amount_minor`,
    `pay_min_minor`, `pay_max_minor`, `budget_minor`, structured
    components), open roles carry `salary_min_minor`/`salary_max_minor`
    instead of `pay_text`, and notification bodies, approval titles and
    proposal labels carry no written dates. The UI writes them through
    `format.ts` and `Money` (`PayRange`, `PayAmount` in
    `components/hiring/bits.tsx`). Offer terms in settings show sample
    values (the company's own names, from `hiring.settings` `sample`) as
    chips; only clickable rows hover. Type scale 10.5 (mono labels), 12,
    13, 14, 15.
13. UI QA round 2: adding (or importing) candidates from an opening
    shows its pipeline (N19). One primary per screen, checked by
    `primaries.mjs` (every hiring page and opening tab, four roles, 1440 and
    390, empty and seeded): the opening's Add candidate steps back on the
    Post and Stages tabs (their Save is the primary), empty states offer
    their action as a plain button under the header's primary, selected
    scores and recommendations are outlined instead of filled, and "Ask for
    a new summary" is a plain button. Time stamps are written as the
    viewer's own day (`fmtDay` of the instant, never its UTC date), and
    days in a stage count whole days since it started (N3: a candidate
    added minutes ago no longer shows 1d). Settings rows hover only where
    they are clickable.

## Needs from other builders

- **kernel-frontend (Hire page prefill)**: the offer's Hire button opens
  `#/people/new?entity=&legal_name=&personal_email=&phone=&title=&job_title=&department=&location=&employment_type=&start_day=&pay_basis=&pay_amount=&pay_per=&employee=&from_application=`
  (values from `offers.hire-draft`). `pages/people/Hire.tsx` reads only
  `employee` and `department` today; it should read these and pass
  `from_application` to `people.hire` so the hire links back by itself.
  Until then HR links it from the offer ("Already hired? Link the
  employment", `applications.link-hire`).
- kernel (optional): a bridge helper `available()` in `_craftbot_bridge.js`
  so modules need not call `/api/integrations/available` themselves.
- kernel-backend (triggers): `guide_hiring.js` adds the recipes
  `draft_job_post` and `summarize_interview`; `triggers.json` is the
  kernel's, so the kernel owner runs `node tools/gen_triggers.mjs` in APP
  (checked clean in the hiring scratch copy: 10 of 13 kinds).
- home-reports: hiring exports `homeWidgets` (employee and manager
  "Hiring", manager and admin "Open roles").

## Frappe parity (Recruiting)

Covered: staffing plan and details, job requisition, job opening (and
templates as "like an earlier opening"), job applicant and source,
interview type (kind), interview round (round name per stage and kit),
interview, interviewer, interview feedback with criteria, job offer with
components and terms, offer letter, employee referral, skill expectations
(interview kit criteria). Left out: the appointment letter (lifecycle's
letters), a public careers page and job board posting (no public web on
this platform), and AI screening or ranking (deliberately never).

## Tests

`reference/tests/hiring/`: `t01_empty_sweep.mjs` (every hiring read as nobody,
owner, recruiter, manager, employee and your AI agent; every hiring write
with no and sample params; no 5xx), `t02_flow.mjs` (the whole hire on the
demo seed with a stand-in bridge: Google Calendar and Gmail),
`t03_access.mjs` (scopes and your AI agent's deny, propose and allow paths,
pay switched off), `t04_edges.mjs` (declined and cancelled approvals,
stage edits with people in them, calendar not connected, EU rule, the
`employment.hired` subscriber with bad links, panel changes, retention with
consent, export, facts), `t05_post_ui.mjs` (in a browser: the post
saves itself, survives a reload and a tab switch, and Publish saves what is
on screen; needs the built frontend), `seed_hiring.mjs` (demo data), `shots.mjs`
(Playwright pass), `primaries.mjs` (one black button per screen). They need the scratch-only `cat_test_hiring.js` and
`lib_testhiring.js` (cron and backdate helpers), kept inactive under
`reference/tests/hiring/stubs/`: copy them into `pb/pb_hooks/` of a scratch
copy only, never of APP. Last run on a copy synced with time, leave,
payroll, performance and lifecycle: 278 checks in five files, 0 failed; gate all steps
passed; Playwright pass (owner, recruiter, manager, employee; 1440 and 390;
light and dark) 64 empty and 140 seeded shots with no console errors, no
5xx and no sideways scroll.
