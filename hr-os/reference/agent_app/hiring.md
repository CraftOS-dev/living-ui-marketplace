### Hiring

Staffing plans and requisitions, job openings with their own pipeline,
candidates, interviews with kits and scorecards, offers to the kernel's hire,
referrals, retention review. Your AI agent drafts job posts and neutral
interview summaries (proposals), adds candidates from files it was given and
proposes interview times. It never scores, ranks, compares, screens out,
rejects or hires a candidate, and never writes a scorecard or a
recommendation: every decision is a person's (EU AI Act Annex III 4(a), NYC
LL144, Colorado SB26-189, GDPR Article 22).

#### Requirements

- [x] Staffing plans per entity with lines per department and job title: planned headcount and budget against the people there today (from the job records in effect), requested and hired
- [x] Requisitions (new role, growth, replacement) with pay range, budget, hiring manager and justification; approval kind `requisition` (seeded flow: HR administrator or owner); declined ones go back to draft with the note; filled when the hires are in
- [x] Job openings from an approved requisition, like an earlier opening (template), or direct; markdown post that saves itself as it is typed (Publish saves what is on screen first), drafted or improved by your AI agent (job `draft_job_post`, a proposal on `openings.update`, or `openings.add --description` when no opening exists); place, remote mode, employment type, positions, hiring manager and team
- [x] Pay range in the entity's currency with a pay transparency warning by work place (US states CA, CO, WA, NY, IL, MN, VT, MA, MD, HI, DC, NJ and remote US roles; Canada BC, PE, ON; EU member states before the first interview); never a block
- [x] Pipeline stages per opening (default Applied, Screen, Interview, Offer, Hired from settings; rename, add, reorder, remove with a "where do they go" step); the hired stage is reached only by hiring
- [x] Candidates: one per email (duplicate check as you type, refused on add, never duplicated by an import), protected resume (PDF, Word, text or image), source and source detail, links, tags, consent for future roles with its date, retention day by the entity's country
- [x] CSV import with a dry run (row report: new, already here, rows to fix, columns left out); CSV export (people only)
- [x] Board per opening: drag a card between stages; on a phone, "Move to"; cards in waiting order, never by merit
- [x] Bulk move, reject with a reason (and its message template), message; withdraw, reopen; open interviews are cancelled when an application closes; an open offer blocks a rejection
- [x] Candidate profile: details, resume viewer, applications with stage chain, interviews and scorecards (as the viewer may see them), offers, timeline with notes
- [x] Interviews: panel of members (each gets a scorecard), day, time and time zone, place or link, kind, kit; the panel is told; Google Calendar event through the bridge action `create_google_calendar_event` when Google Calendar is connected in CraftBot (otherwise not offered)
- [x] Interview kits (criteria and questions), shared or per opening
- [x] Scorecards: recommendation strong no to strong yes, a score of 1 to 4 per kit criterion, notes; nobody on a panel sees the others' scorecards for that interview until theirs is submitted
- [x] Neutral interview summary by your AI agent (trigger `interview_summary`, a proposal on `interviews.summary`)
- [x] Offers: pay, start day, bonuses and allowances, terms from offer terms, letter from a template (markdown with placeholders; print page `#/print/hiring/offer/<id>`); approval kind `offer`; sent (optionally emailed), accepted or declined; `offer.accepted` emitted; Hire opens the kernel hire page with the offer's values; `people.hire --from_application` links back (`employment.hired`), the opening closes when filled and the requisition becomes filled; a hire made outside the flow is linked with `applications.link-hire`
- [x] Referrals: anyone refers someone for an open role (with a resume); the referrer sees only submitted, in process, hired or not moving forward, and is told when their referral is hired
- [x] Hiring home: open roles as compact rows with candidates per stage, what needs you (scorecards you owe, ready to hire, offers to move, approved requisitions without an opening, retention review), interviews today and this week
- [x] Settings: default stages, rejection reasons with messages, offer terms, letter templates with a sample preview, interview kits, retention days by country (suggested, with the basis), candidate email on or off, Google Calendar status
- [x] Retention: a daily job flags candidates past their day with nothing in process and tells the people who run hiring; a person deletes (never automatic)
- [x] Me facts on the profile and Home: interviews this week and scorecards owed (`profileFacts`); Inbox sections "Scorecards to write" and "Ready to hire"; Home widgets
- [x] Access: hiring full sees everything in its entities; a hiring view or edit role without team scope sees all and changes by its level; managers (team scope) see only openings they manage, own or are on the team of; any member on a panel sees that interview, the candidate's basics and resume, and writes their scorecard

#### Entities

| Collection | Purpose | Notes |
|------------|---------|-------|
| hiring_config | One row: default stages, retention days by country, default and consent days, candidate email on or off | |
| rejection_reasons | Why applications close | kind company or candidate, subject and message template |
| offer_terms | Terms to pick for offers | an offer keeps its own copy |
| offer_templates | Offer letter templates | markdown with `{{placeholders}}`, one default |
| staffing_plans, staffing_plan_lines | Planned headcount and budget | per entity; lines per department and job title |
| requisitions | Requests for new people | number R0001, approval kind `requisition` |
| openings | Job openings | number J0001, `stages` json [{key, name, kind, kit}], `team` json of member ids |
| interview_kits | Criteria and questions | shared (no opening) or per opening |
| candidates | People in hiring | unique email, protected `resume`, consent, `country` and `retain_until` |
| applications | A candidate on an opening | stage key, status active, hired, rejected, withdrawn; `hired_employment` |
| hiring_events | The candidate timeline | notes, moves, messages (`delivery` none, pending, sent, failed) |
| interviews | Interviews | day, start, time zone, `at` and `end_at` UTC, `interviewers` json, summary |
| interview_feedback | Scorecards, one per interviewer | recommendation, `scores` json by criterion key, status pending, draft, submitted |
| offers | Offers | number OF0001, minor-unit pay, `components` and `terms` json, frozen `letter` once sent |
| referrals | Referrals | referrer employee and member, candidate, application |

#### Operations

Groups: `hiring` (home, settings, settings-update, retention, people, calendar),
`staffing-plans`, `requisitions`, `openings` (list, get, board, open-roles,
add, update, stages, set-status, delete, draft-post), `interview-kits`,
`candidates` (list, get, check, add, update, note, resume, resume-set,
import, export, delete), `applications` (list, get, add, move, reject,
withdraw, reopen, message, link-hire), `interviews` (list, get, schedule,
update, cancel, set-status, calendar, summary, summarize), `scorecards`
(mine, get, save), `offers` (list, get, create, update, submit, send,
respond, withdraw, letter, hire-draft), `offer-terms`, `offer-templates`,
`rejection-reasons`, `referrals` (add, mine, list).

People only for your AI agent: moving, rejecting, withdrawing, reopening,
messaging, linking hires, scorecards, every offer write, sending
requisitions for approval, publishing openings, deleting candidates,
exporting, settings, calendar events, referrals. Proposals: openings.add,
openings.update (job posts), openings.stages, interview-kits.save,
interviews.schedule, interviews.update, interviews.summary, staffing plans,
rejection reasons, offer terms, letter templates. Allowed directly:
candidates.add, candidates.update, candidates.import, candidates.resume-set,
candidates.note, applications.add (always the first stage),
requisitions.save (drafts).

#### Triggers

`job_post_draft` (person asks from the job post) and
`interview_summary` (person asks from the interview); recipes in
`pb/pb_hooks/guide_hiring.js`. Event emitted: `offer.accepted { application,
offer, candidate }`. Subscriptions: `employment.hired` (links the hire),
approval kinds `requisition` and `offer`.

#### External data

| Source | Used for | Auth | Called from |
|--------|----------|------|-------------|
| CraftBot bridge `create_google_calendar_event` | Interview calendar events, when Google Calendar is connected | bridge token | `lib_hiring_interviews.js` (a person's action) |
| CraftBot bridge `GET /api/integrations/available` | Whether Google Calendar is connected (kept five minutes) | bridge token | `lib_hiring_interviews.js` |
| CraftBot bridge `send_gmail` | Candidate messages and offer letters, when candidate email is on | bridge token | `lib_hiring.js` (minute job) |
