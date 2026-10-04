# IP Manager: Binding Requirements

One register for everything an organization owns: patents (and utility models), trademarks, designs, copyrights and the creative works behind them, invention disclosures, and the agreements that license rights in and out. Built for in-house IP teams of any size, general purpose, with an entertainment-friendly vocabulary available. The core is a rules-based deadline engine whose every date can be explained; everything automated (office data sync, CraftBot reading documents and contracts) arrives as a proposal in a review Inbox and changes nothing until a person accepts it.

Design identity: the CraftOS Command Center / Company OS visual language reproduced with kit components. Sharp corners, Inter typography, calm dense tables, monospace for reference and application numbers, tabular figures for dates and money, color reserved for status and severity.

## Verification-observable features

### Auth, roles and first run
1. authMode is multi-user. Unauthenticated visitors see the kit login gate; registering and logging in works.
2. The FIRST account ever created becomes the administrator (role admin). Every account created after that joins the SAME organization with the default sign-up role from settings (Contributor out of the box). A later sign-up never gets the onboarding screen and never becomes admin; that is designed behavior, not a defect.
3. While onboarding is not finished, the admin sees a setup screen (organization name, vocabulary pack, home currency, filing offices) and any other signed-in user sees a "being set up" waiting screen. Finishing setup (`onboarding.complete`) lands the admin on Today.
4. Roles: admin (everything, including settings, office credentials and roles), manager (edit everything plus renewal decisions, fees, calendars, dimensions, deletes), counsel (edit records and deadlines), contributor (read the portfolio, upload documents, create invention disclosures, propose changes), inventor (sees only the inventions they submitted or are named on through a person record linked to their account, plus their account), viewer (read only). Controls a role cannot use are hidden or disabled, and the server rejects the call anyway. Only an admin can change roles; users cannot change their own role; the last admin cannot be demoted.
5. The vocabulary pack changes labels only: general (Properties / Works), entertainment (Franchises / Titles), technology (Product lines / Assets), consumer (Brands / Creative assets).

### Today, Inbox, Deadlines
6. Today shows clickable KPI tiles (overdue, due this week, next 30 days, items to review, renewal decisions), my deadlines (mine or team) within 90 days plus overdue, portfolio counts by IP type and status, renewal spend by month for the next 12 months in the home currency, and recent activity. With an empty portfolio it shows a Get started panel (add a first record, import a spreadsheet, connect office data, invite the team).
7. The Inbox is the only door for automated data. Items are office changes (field diffs, office events, annuity date corrections), CraftBot document proposals (event, dates, citations quoting the source document), agreement drafts, and email proposals. Each item can be previewed (the exact deadlines it would create), accepted in part or whole, or rejected with a note. Accepting creates events and deadlines through the engine; rejecting changes nothing.
8. Four-eyes: when settings.second_reviewer is on, accepting an item that would create a statutory deadline moves it to "awaiting second approval", and a different person must give the second approval. The first approver cannot give both.
9. Deadlines has List (grouped by overdue / this week / this month / later), Calendar and Table views, filters (scope, window, kind, category, jurisdiction, IP type, assignee, text), counts per window, bulk close / reassign / move, manual deadlines, and a private calendar feed URL (ICS) that can be rotated.
10. Every deadline shows target, due and final dates where they exist, its kind (hard, extendable, designated, internal, reminder) and source. "Why this date" explains the rule, base date, offset, end-of-month and office closure roll-forward steps with the citation. Deadlines are never deleted by users: they are closed with a reason (done, not needed, cancelled, transferred, missed), and closing a recurring deadline creates the next cycle.
11. Extensions offer only the tiers the rule allows. Moving a rule deadline by hand locks it so regeneration will not overwrite it.

### Deadline engine
12. 59 shipped rules cover US patents and trademarks (office actions, issue fee, maintenance fees, Section 8/71/15, renewals), EP (exam request, Rule 71(3), renewals, validation, opposition, unitary patent), EUIPO trade marks and designs, JP patents, designs and trademarks (exam request, refusals, appeals, registration fees, annuities, renewals, split trademark fees), PCT (national phase 30/31 months, demand), Paris priority, Madrid renewal and dependency, US copyright registration (17 U.S.C. 412) and US termination windows (Section 203).
13. Dates use calendar-month arithmetic with month-end clamping, office closure days per office (US federal holidays exact, JP official holidays refreshed monthly from the Cabinet Office, EPO/EUIPO/WIPO computed), and roll statutory dates forward to the next open day.
14. Recording an event on a matter (filed, published, office action, granted, registered, and more) previews the deadlines it will create before committing; changing base dates offers a diff (add / update / cancel) before regeneration.
15. Rules are data: Settings lists them with plain-language summaries, lets admins enable, disable, edit and add rules, and tests a rule against a sample date.

### Portfolio
16. Patents (including utility models), Trademarks, Designs and Copyrights pages each show a table and a grouped view (by family, by mark, by work), with search tolerant of number formats, status and jurisdiction filters, and CSV export.
17. New records can be created by looking up an application or registration number at the office (when that office is connected), from a template, or blank. Creating from dates records the matching events so rule deadlines appear.
18. A matter page shows INID-coded facts, the family strip, deadlines, goods and services with use evidence (trademarks), documents, people, agreements that cover it, renewals and costs, and history (events and audit trail). National phase entries, validations, designations and continuations are created from the matter.
19. Office sync (when credentials exist) checks matters daily and on demand; differences arrive in the Inbox. Without credentials the app shows "Not connected" and everything works by hand.

### Properties, works, clearances
20. Properties form a tree with a rights basis (owned outright, acquired, mixed). A property page shows counts, upcoming deadlines, a trademark coverage matrix (classes by jurisdiction with gaps), registrations, works, agreements and documents.
21. Works form a tree (for example series, season, episode). A work page shows copyright terms for the US, Japan and the EU with the basis, registrations, a clearance and chain-of-title checklist with progress (and a standard checklist per work type), rights granted in and out, deadlines, children and documents. Publishing a work in the US adds the 3-month registration reminder automatically.

### Agreements and rights
22. Agreements record type, direction (rights in / rights out), counterparty, term, option, money terms in any currency, payment schedules and author grants. Their dates become obligation deadlines automatically (option end, term end, renewal notice, sell-off, reversion, payments, royalty reports, Section 203 windows) and update when the agreement changes.
23. Scope is a list of grants (grant, holdback, restriction, reservation; exclusive or not) over works, properties or matters, with include/exclude selections on hierarchical dimensions (territory, media, language, channel, category, field of use) and a term. Saving an outgoing grant runs a conflict check; a conflicting grant can be saved only with an override reason, which is audited.
24. The Rights explorer answers "can we license this, where, and for how long": assets by columns of a dimension (with presets such as major markets), filters on other dimensions, a time window and an exclusive switch. Cells show available, partial (free for part of the window, or part of the asked scope such as some categories), unavailable or no rights, and each cell explains its reasons with links to the agreements. A dimension left open means all of it: a toys-only licence makes a territory partial, not unavailable. Searches can be saved and exported.
25. Royalty reports are expected per reporting period and recorded when received; the minimum guarantee recoupment is shown. Product approvals move through stages (concept to final product) with rounds, images, comments and decisions.

### Renewals
26. Renewals shows the decision queue grouped by family or mark with due and grace dates, official fees converted to the home currency, and renew / let lapse / decide later (let lapse needs a rationale and states what will lapse). Trademark renewals can drop classes. The organization default applies when nobody decides.
26a. Official fees ship for USPTO (maintenance fees by entity size, trademark Sections 8, 71, 15 and renewal per class), EPO (renewal years 3 to 20, both the 2024 and the 1 April 2026 schedules), the Unitary Patent (years 2 to 20), EUIPO (EU trade mark renewal with class tiers, EU design renewals from 1 May 2025), JPO (patent annuities as base plus per claim, design annuities, trademark second half and renewal per class) and WIPO Madrid (basic fee plus fee per class beyond three), each with its grace-period surcharge and source. Estimates use the schedule in force on the due date, class counts, claims counts and tiers. Exchange rates load from the ECB at setup and daily; changing a fee, a manual rate or the home currency re-prices open renewals immediately.
27. Instructing produces a provider letter and a CSV; CraftBot can draft the email. Recording payment closes the deadline and creates the next cycle. A 3, 5 or 10 year forecast shows spend per year in the home currency.

### Inventions
28. Inventors and contributors submit invention disclosures (problem, solution, novelty, uses, bar dates, inventors with shares, attachments). CraftBot can structure notes into a draft the submitter chooses to use.
29. The IP team sees a pipeline board (submitted, search, review, approved, drafting, filed), scores disclosures against weighted criteria, and converts one to a filing. A public disclosure or sale date shows the 12-month grace period, and converting adds that deadline.

### Enforcement
30. Watch hits from a provider (imported by CSV or added by hand) are triaged side by side with our mark (dismiss, monitor, escalate, actioned), sorted by opposition deadline; a dispute can be opened from a hit. Disputes have deadlines and documents.

### Organization
31. People and companies is a directory of parties (inventors, authors, talent, licensees, counsel) showing everything each is involved in.
32. Reports: deadlines, portfolio register, agreements ending, chain of title, renewal decisions, renewal forecast, inventions pipeline and audit log, each exportable as CSV and savable (private or shared, with a digest schedule).
33. A daily digest (in app, or by email or Slack through CraftBot) and reminders at configured days before due dates, with escalation of overdue or unassigned statutory deadlines. Users can opt out of the digest.
34. Settings: organization, people and access, office connections (write-only secrets, test, sync now, sync history), rules, office calendars, fees and currency (fee schedule, ECB rates plus manual rates), rights dimensions, invention scoring criteria, CSV import with dry run, audit log, my account (calendar feed, digest preview).
35. Every change to a core record is written to the audit log with who, when and what changed.

### Agent plane (A2APP)
36. `GET /api/_a2app` and `/api/_a2app/describe` expose identity and schema; all custom verbs are in operations.json and listed at `GET /api/_ops`; `renewals.decide` is marked destructive.
37. Five app-to-agent triggers (document docketing, agreement extraction, renewal instruction email draft, portfolio question, invention assist). Firing one shows the request lifecycle honestly; with no agent attached it says no agent is connected, not an endless spinner. CraftBot results arrive as Inbox proposals, never as direct writes to deadlines.

### Global UX
38. Responsive at 400px, 768px and 1280px; the sidebar becomes a mobile menu; tables scroll inside their own container, never the page.
39. Loading, empty and error states everywhere; toasts on changes; confirmation for destructive actions; realtime updates without polling; Ctrl+K opens the command palette.
40. No console errors on first paint with an empty database or during normal navigation.

## Out of scope (deliberate)
- Filing with offices or paying official fees from the app (instructions go to your provider).
- Running trademark watch searches (the app triages reports from your watch provider).
- Legal advice: shipped rules need review by your counsel before you rely on them.
- Sample or demo data.
