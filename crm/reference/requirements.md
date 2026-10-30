# CRM: requirements

The research behind this design is `../../reports/CRM software UI UX survey.md`
(late 2026: Attio, Folk, HubSpot, Pipedrive, Salesforce, Close, Twenty,
Affinity, Clay, founder and open-source CRMs, AI agents in CRMs).

## Who it is for

One person (a founder, a freelancer, a small team lead) who keeps people,
companies and deals for several processes at once (sales, fundraising,
hiring, partnerships, community) together with an AI agent (CraftBot) that
works through the same operations. Local, single user, no login. The agent
is a second actor with its own identity: every change carries who made it,
in which agent run, and can be undone.

## Principles (from the research)

1. **Agents propose, the person approves, history remembers.** The server
   decides per operation whether an agent call writes or becomes a
   proposal (no vendor enforces this server-side; the client asking is not
   enough). Notes, interactions, tasks, new records and empty fields are
   written directly (tagged as the agent's, revertible). Stage moves,
   closing, deal value and close date, changing a value the person entered,
   merges, deletes and outbound email become proposals with the current
   value, the proposed value, an evidence quote, a source and a reason.
   The person can promote a kind of change to automatic once the
   acceptance rate shown next to it justifies it.
2. **Every change has an actor, a run and an inverse.** One activity log
   with undo/redo per change, revert of a whole agent run, Ctrl+Z.
   Deleted people, companies and deals go to a 90-day trash. Merges are
   reversible (undo) and the old id keeps resolving to the survivor.
3. **Identity on natural keys.** People are keyed on normalized email,
   companies on root domain. Upserts write when exactly one record
   matches, create when none does, and refuse (409 with the candidates)
   when several do. A person with a work email gets their company matched
   or created from the domain (free-mail domains are skipped). A duplicate
   review lists likely pairs (same email/domain, same name at the same
   company) to merge or dismiss. Merge precedence: the primary's values
   win, blanks are filled from the secondary, emails/phones/domains/tags
   are unioned, every link moves to the primary.
4. **Stage history from day one.** Every stage change is an event (deal,
   from, to, when, who). Time in stage, funnels, cycle length and rotting
   come from it. Stages have a win probability, a kind (open, won, lost),
   a rotting limit and a target time. Weighted value = value x probability
   (stage probability unless overridden). Each deal has its own currency;
   the home-currency value is frozen when the deal closes; amounts in
   different currencies are never added raw.
5. **Who to contact today.** Interactions (email, call, meeting, message)
   update last interaction and relationship strength (recency and
   frequency with decay, shown as 3 bars). Keep-in-touch cadence per person
   resets from the last interaction (Dex semantics). A Today queue joins
   tasks (overdue, today, upcoming, snoozed, done) with attention items:
   rotting deals, open deals without a next step, keep-in-touch due,
   proposals waiting, birthdays.
6. **Charts, not walls of tables.** Home is a dashboard (KPI strip with
   deltas against the previous period, pipeline by stage, forecast, won and
   lost by month, activity, relationships, sources, needs attention, AI
   agent). Reports are preset with a chart above a table, period and
   pipeline filters, click-through, CSV export, formulas in tooltips.

## Data

| Collection | Holds |
|---|---|
| settings | workspace name, your name, home currency, keep-in-touch default, policy (autonomy per change kind, house rules, daily brief), setup done |
| people | first/last name, emails[], primary_email (unique), phones[], title, company, linkedin, location, birthday, how_met, source, tags[], keep_in_touch days, last_interaction, next_touch, strength, custom{}, prov{field: {by, at, run, source}}, agent_state, deleted, merged_into |
| companies | name, domains[], primary_domain (unique), industry, size, location, description, linkedin, source, tags[], last_interaction, strength, custom{}, prov{}, agent_state, deleted, merged_into |
| employments | person, company, title, start, end, current (job history; a past champion at a new company is a warm lead) |
| pipelines | name, kind (sales, fundraising, hiring, partnerships, other), currency, target, position, archived |
| stages | pipeline, name, position, kind (open, won, lost), probability, rot_days, target_days, color |
| deals | name, pipeline, stage, status, value (minor units), currency, home_value (frozen at close), probability override, expected_close, closed_at, lost_reason, company, source, next_step, next_step_date, stage_entered, last_activity, position, tags[], custom{}, prov{}, deleted, merged_into |
| deal_people | deal, person, role |
| stage_events | deal, pipeline, from, to, at, actor, run |
| lists, list_entries | lighter processes (Community, Newsletter VIPs) over people or companies |
| fields | custom fields per object: key, label, type (text, number, currency, date, select, multi_select, checkbox, url, rating), options, ai_prompt |
| notes | body, person/company/deal, pinned, by, run |
| interactions | kind (email, call, meeting, message), direction, at, subject, summary, people[], company, deal, source, ext_id (dedupe of synced items), by, run, agent_state |
| tasks | title, notes, due, done_at, snoozed_until, person/company/deal, kind, by, run |
| emails | to, cc, subject, body, status (draft, queued, sent, failed), person, deal, by, run, sent_at, error |
| proposals | kind, object, target, changes[{field, label, from, to}], payload, evidence, source, reason, confidence, status (pending, accepted, edited, rejected), decided_at, applied, run |
| views | saved views: object, filters, match, sort, columns, mode, pipeline |
| aliases | merged id -> surviving id |
| dupe_ignores | pairs the person said are not duplicates |
| fx_rates | currency rates to the home currency (manual or ECB) |
| asks | questions and jobs for the AI agent |
| activity | every change with actor, run, diff and undo |

## Operations (the agent and the UI call the same ones)

Discover: app.guide, app.context, app.summary, app.dashboard, schema
(fields). Read: people/companies/deals list (filter grammar below), get,
timeline, search (everything), reports.*. Capture (written directly):
notes, interactions.log, tasks, records.create and upsert, filling empty
fields, AI fields. Change (proposal for the agent by default): update of a
value the person set, deals.move, deals.close, deals.reopen, deal value,
close date and probability, records.delete, records.merge, emails.send.
Review: proposals.list, proposals.decide (person only), proposals.stats.
Undo: activity.undo, activity.redo, activity.revert_run (the agent may
revert its own runs). Policy and lock-like settings are the person's only.

Filters: a list of conditions `{field, op, value}` joined by `match: all|any`.
Ops: is, is_not, contains, not_contains, starts_with, empty, not_empty, gt,
gte, lt, lte, before, after, within_days, older_than_days, in, has_tag.
Fields include computed ones (strength, last_interaction, next_touch,
company, in_list, open_deals) and custom fields (`custom.<key>`).

## Agent triggers

| Trigger | When | Agent does |
|---|---|---|
| agent_asked | the person asks a question or gives a job (research, draft an email, import from email, prepare a brief, explain a report) | answers from the CRM with links, or does the job through the ops |
| research_requested | the person asks the agent to research people or companies (button, bulk, new records when auto-research is on) | fills empty fields with sources; proposes changes to the person's values |
| interaction_logged | a meeting or call is logged with notes and meeting review is on | proposes deal updates (stage, value, close date, next step), creates follow-up tasks, drafts a follow-up email |
| emails_queued | the person sends an email from the CRM | sends it through its own email integration and marks it sent (or failed with the reason) |

## Screens

Icon rail: Home, Today, People, Companies, Deals, Review, Reports; Activity
and Setup at the foot; a New button. Title bar: view, workspace, status
chips, search (Ctrl K), Ask AI, undo, redo.

- **Home**: range (this month, last month, this quarter, year to date, 12
  months); KPIs: open pipeline, weighted forecast, won, win rate, average
  deal size, sales cycle; pipeline by stage; forecast by month; won and lost
  by month; activity per week by kind; relationships (strength mix, going
  cold); sources; needs attention; coming up; AI agent. The money numbers
  count revenue pipelines only (all kinds but fundraising and hiring), so a
  round or a salary never reads as sales; each fundraising pipeline gets a
  panel (committed against the round target, weighted in talks, stages) and
  each hiring pipeline one (hired, in process, candidates by stage).
- **Today**: tasks by Overdue, Today, Upcoming, Snoozed, Done, with
  attention items; J/K, X done, S snooze, Enter open; quick add.
- **People / Companies**: sidebar (all, keep in touch due, recently added,
  lists, saved views); a dense table (32px rows, avatars, strength bars,
  relative dates, tags), inline editing, column chooser, sorting, filter
  chips, bulk actions (tag, add to list, research with AI, merge, delete),
  CSV import and export; a 500px peek; a full record page.
- **Record page**: two panes scrolling on their own. Main: header (avatar,
  name, highlight strip of key fields, actions: log interaction L, note N,
  task T, email E, research with AI), tabs Overview (Focus: proposals,
  open tasks, pinned notes, next step; then the timeline), Activity, Notes,
  Tasks, Emails, and People/Deals for companies and deals. Deal pages show
  a stage bar with days in each stage. Details sidebar: every field inline
  editable with an AI mark on agent-written values (hover: run, time,
  source), lists, tags, custom fields, job history, strength.
- **Deals**: pipeline switcher; board (stage header with color, count,
  total and weighted; cards with company, value, close date, next-activity
  icon, time in stage turning red past the target, rotting tint, AI mark
  when a proposal waits), drag between stages, won/lost drop zones; table
  view; peek.
- **Review**: pending proposals grouped by record, current vs proposed,
  evidence quote, source, reason, confidence; Y accept, N reject, E edit;
  accept all; history with acceptance rates per kind and the switch to
  make a kind automatic.
- **Reports**: pipeline, conversion, forecast, win and loss (with lost
  reasons), time in stage, sources, activity, relationships.
- **Activity**: every change with undo/redo; AI runs with revert.
- **Setup**: workspace, pipelines and stages, fields, lists, currencies,
  AI agent (autonomy per kind, house rules, auto-research, meeting review,
  daily brief), import/export, trash.

Look: the sibling agent apps' shell (52px rail, title bar, flat panels split
by hairlines, 28px controls, 32px rows, tabular numbers, near-monochrome;
color for stages, strength, money won/lost, warnings and the accent for
selection and the AI agent; lucide line icons; light/dark from the host
theme; phone layout with a bottom bar). Light motion: views fade, charts
grow once, numbers count up.

## Look (the CRM app)

The CRM app is the same product as CRM System in the Company OS visual
language: a cream page with floating surface blocks, sharp corners, Inter,
small uppercase labels and the CraftBot orange accent; Home adds the
revenue trend, the network constellation, the pipeline flow diagram and
the month calendar, and a Network view maps people, companies and deals.
Fresh installs start empty (no demo data).
