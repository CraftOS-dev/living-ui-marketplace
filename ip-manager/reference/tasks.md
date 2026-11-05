# Tasks: IP Manager

Every task cites what it implements. These features already exist in the published app `ip-manager` 1.0.0, so the build tasks are recorded as done.

## Build
- [x] T-1 (F-ACC-1, F-ACC-2, F-ACC-6): multi-user access. The kit's sign-in gate, the first account as admin, later sign-ups with the default role, role-driven collection rules and route checks (`u.deny`), and the last-admin guard (`ip_system.pb.js`, migration `1700000100`, `lib/context.tsx`).
- [x] T-2 (F-ACC-3, F-ACC-4): first run. The admin's setup screen (organization, vocabulary pack, home currency, filing offices) and the waiting screen for everyone else (`pages/Onboarding.tsx`, `onboarding.complete`).
- [x] T-3 (F-ACC-5): inventor scope. Only My inventions and My account, with the disclosure rules limiting them to their own.
- [x] T-4 (F-FRM-1, F-FRM-2, F-FRM-4): the shell. The grouped sidebar with counts, the mobile top bar and drawer, and the notifications drawer (`components/shell.tsx`).
- [x] T-5 (F-FRM-3): the command palette on Ctrl/Cmd+K, with number-tolerant search and page jumps (`portfolio.search`).
- [x] T-6 (F-FRM-5, F-AGT-5): Ask CraftBot about the portfolio (`components/craftbot.tsx`, `portfolio_question_asked`).
- [x] T-7 (F-FRM-6): live data. `lib/live.ts` (useCollection, useLiveAsync, useLiveReload, useLiveRecords) follows every write without polling.
- [x] T-8 (F-FRM-7): the Command Center look: tokens, sharp corners, Inter, monospace references, pointer cursors (`theme.css`).
- [x] T-9 (F-TOD-1, F-TOD-2, F-TOD-3, F-TOD-4, F-TOD-5): Today with KPI tiles, my and team deadlines, portfolio counts, agreements, the renewal spend chart, recent activity, Get started and Record an office action (`pages/Today.tsx`, `portfolio.summary`).
- [x] T-10 (F-INB-1, F-INB-2, F-INB-3, F-INB-6): the Inbox with To review, Decided and All, item kinds with source and confidence, preview, partial accept, reject with a note, and agreement drafts into agreements (`pages/Inbox.tsx`, `components/workInbox.tsx`, `inbox.preview`, `inbox.decide`).
- [x] T-11 (F-INB-4): four-eyes. Statutory deadlines from CraftBot proposals go to "awaiting second approval" with notifications, and the first approver cannot give the second (`inbox.decide`).
- [x] T-12 (F-INB-5, F-AGT-2): "Upload for CraftBot" and "Docket this", with the `document_docketing_requested` playbook (`components/documents.tsx`).
- [x] T-13 (F-DL-1, F-DL-2, F-DL-3): Deadlines as list, calendar and table, with windows and counts, filters, and target / due / final dates with kind, source and lock (`pages/Deadlines.tsx`, `components/CalendarMonth.tsx`).
- [x] T-14 (F-DL-4, F-DL-5, F-DL-6, F-DL-7): deadline dialogs. Why this date, close with a reason (next cycle for recurring ones), rule-tier extensions, moves that lock, and reassign, one by one or in bulk (`components/deadlines.tsx`, `deadlines.*`).
- [x] T-15 (F-DL-8, F-DL-9): manual deadlines, and the private ICS calendar feed with rotation (`components/workDeadlines.tsx`, `calendar.feed`, `/api/ics/{token}`).
- [x] T-16 (F-ENG-1, F-ENG-2): the deadline engine. 59 seeded rules, calendar-month arithmetic with month-end clamping, and office closure roll-forward (`lib_engine.js`, `lib_calendar.js`, migration `1700000200`).
- [x] T-17 (F-ENG-3, F-ENG-4): record an event with a preview, and regenerate with an add / update / cancel diff that never moves locked dates (`matters.preview-event`, `matters.record-event`, `matters.regenerate`).
- [x] T-18 (F-ENG-5, F-ENG-6): rules as data with plain summaries, admin edits and "test against a sample date", and office closure days with refresh (`components/adminRules.tsx`, `components/adminCalendars.tsx`, `rules.test`, `calendars.refresh`).
- [x] T-19 (F-PF-1): the Patents, Trademarks, Designs and Copyrights pages with table and grouped views, number-tolerant search, filters, column picker and CSV export (`pages/Portfolio.tsx`, `components/DataTable.tsx`).
- [x] T-20 (F-PF-2): new records by office look-up, template or blank, recording events from the dates entered (`components/matterNew.tsx`, `matters.lookup`, `matters.import-office`).
- [x] T-21 (F-PF-3, F-PF-4, F-PF-5): the matter page with INID facts, the family strip, tabs, national phase / validation / designation / continuation, and delete with a confirmation (`pages/Matter.tsx`, `components/matterTabs.tsx`, `components/matterDialogs.tsx`, `matters.national-phase`).
- [x] T-22 (F-PF-6): family and mark pages (`pages/Family.tsx`).
- [x] T-23 (F-PF-7, F-SET-4): office connections (USPTO ODP, TSDR, EPO OPS, EUIPO, JPO) with write-only secrets, test, sync now, daily sync into the Inbox, sync history and "Not connected" (`lib_offices.js`, `components/adminOffices.tsx`, `offices.*`, `matters.sync`).
- [x] T-24 (F-PRP-1, F-PRP-2): the property tree and property page with the trademark coverage matrix (`pages/Properties.tsx`, `pages/Property.tsx`, `components/catalogCoverage.tsx`, `properties.coverage`).
- [x] T-25 (F-WRK-1, F-WRK-2, F-WRK-3): the work tree and work page with US / JP / EU copyright terms, registrations, clearance and chain of title, grants, and the US registration reminder (`pages/Works.tsx`, `pages/Work.tsx`, `components/catalogClearances.tsx`, `works.copyright-term`).
- [x] T-26 (F-AGR-1, F-AGR-2, F-AGR-3): agreements with type, direction, money terms and schedules, author grants and tabs, and obligation deadlines kept in step (`pages/Agreements.tsx`, `pages/Agreement.tsx`, `components/dealsAgreementForm.tsx`, `agreements.sync`).
- [x] T-27 (F-AGR-4, F-AGR-5): scope grants on hierarchical dimensions, with the conflict check on save and an audited override reason (`components/dealsGrants.tsx`, `lib_rights.js`, `agreements.check-conflicts`).
- [x] T-28 (F-AGR-6, F-AGT-3): "Read a contract" with the `agreement_extraction_requested` playbook (`components/dealsReadContract.tsx`).
- [x] T-29 (F-RGT-1, F-RGT-2, F-RGT-3): the Rights explorer with presets, filters, window, exclusive switch, explained cells, saved searches and CSV export (`pages/Rights.tsx`, `rights.availability`).
- [x] T-30 (F-ROY-1): royalty reports per period, with minimum guarantee recoupment (`components/dealsMoney.tsx`).
- [x] T-31 (F-APR-1, F-APR-2): product approvals as board and list, with stages, rounds, images and decisions (`pages/Approvals.tsx`, `components/dealsApprovals.tsx`, `approvals.decide`).
- [x] T-32 (F-REN-1, F-REN-2, F-REN-3): the renewal decision queue by family or mark, with fees in the home currency, renew / drop classes / let lapse with a rationale / decide later, and the organization default (`pages/Renewals.tsx`, `components/renewShared.tsx`, `renewals.decide`).
- [x] T-33 (F-REN-4, F-REN-5, F-AGT-4): instructions with a provider letter and CSV, the `renewal_instructions_requested` email draft, and payments that close the deadline and create the next cycle (`renewals.instruct`, `renewals.record-payment`).
- [x] T-34 (F-REN-6, F-REN-7, F-SET-5): the 3 / 5 / 10 year forecast, the fee schedule, ECB and manual rates, and immediate re-pricing (`components/renewTabs.tsx`, `components/adminFees.tsx`, `lib_fx.js`, `renewals.forecast`, `fx.refresh`).
- [x] T-35 (F-INV-1, F-INV-2, F-AGT-6): invention disclosure intake, and CraftBot structuring notes into `answers.craftbot_draft` (`components/inventForm.tsx`, `invention_assist_requested`).
- [x] T-36 (F-INV-3, F-INV-4, F-INV-5): the pipeline board and list, weighted scoring, decisions, conversion to a filing, and the 12-month grace deadline (`pages/Inventions.tsx`, `pages/Invention.tsx`, `components/inventReview.tsx`, `disclosures.*`).
- [x] T-37 (F-ENF-1, F-ENF-2, F-ENF-3): watch hits imported or added, side by side with our mark, triage and disputes from hits, plus the disputes register with deadlines and documents (`pages/Enforcement.tsx`, `components/enforceWatch.tsx`, `components/enforceDisputes.tsx`, `import.watch`).
- [x] T-38 (F-ORG-1): the People and companies directory with involvements (`pages/People.tsx`).
- [x] T-39 (F-ORG-2): the eight standard reports, with CSV export and saved views on a schedule (`pages/Reports.tsx`, `lib_reports.js`, `reports.run`).
- [x] T-40 (F-ORG-3, F-ORG-4): the daily digest (in-app, email or Slack through CraftBot), reminders and escalations, digest opt-out and preview (`lib_digest.js`, `ipm_hourly`, `digest.preview`, `digest.send`).
- [x] T-41 (F-SET-1, F-SET-2, F-SET-3): Settings sections by role, organization settings, people and access with role descriptions (`pages/Settings.tsx`, `components/adminOrganization.tsx`, `components/adminAccess.tsx`).
- [x] T-42 (F-SET-6): rights dimensions and invention scoring criteria (`components/adminDimensions.tsx`, `components/adminScoring.tsx`).
- [x] T-43 (F-SET-7): CSV import of matters with a dry run (`components/adminImport.tsx`, `import.matters`).
- [x] T-44 (F-SET-8): the audit log of core-record changes, with before and after (`ip_system.pb.js` audit hooks, `components/adminAudit.tsx`).
- [x] T-45 (F-SET-9): My account with profile, calendar feed, digest and sign out (`components/adminAccount.tsx`).
- [x] T-46 (F-AGT-1, F-AGT-7, F-AGT-8): the 50 operations in `operations.json`, served to agents by `a2app_routes.pb.js` through the same handlers. The CraftBot request lifecycle shows in the UI, and `renewals.decide` goes through the adapter's approval.

## Verification
- [ ] Agent App Framework gate (`agent-app <dir> validate`) passes, including the describe budget on a dev instance.
- [ ] Every declared operation answers through `a2app` on a live instance.
- [ ] The View renders identically to the published build (screenshot comparison).
