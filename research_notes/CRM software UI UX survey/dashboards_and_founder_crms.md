# CRM Dashboards & Analytics Design (A) + Founder / Relationship / Open-Source CRMs (B)

Research date: 2026-10-29. Sources are vendor docs (primary), third-party reviews, and competitor blogs (bias flagged inline). Items older than 2025 are marked **[older]**.

---

## A1. Which KPIs appear on the best CRM home dashboards, and how are they compared with the previous period?

### Takeaway
Vendors converge on a small set: open pipeline (count + value), weighted forecast, won this period, win rate, average deal size, sales cycle length/time-in-stage, deals entering stages (new pipeline), and activity volume. Period-over-period comparison is usually shown on single-number "metric/KPI" tiles, not on the charts. For a rep's *daily* home, vendors show tasks (overdue / due today / due tomorrow) and a deal summary rather than analytics.

### Cited Findings
- **Attio's recommended sales dashboard** (vendor help doc) has five reports in this order: (1) *Deals in stage*: count of deals currently in each stage, optionally segmented by deal value or owner, with Paused/Won/Lost excluded to show active pipeline; (2) *Funnel*: conversion between stages, filtered by "Created at after/before [date]"; (3) *Win rate*: a funnel from "all records" to Won, shown as a conversion %; (4) *Average time to close*: a Time-in-stage report filtered to Won deals, optionally grouped by owner; (5) *Number of deals moving to each stage*: bar chart of stage-changed events, with a variant of "monthly qualified deals with target line." — [Attio: Build a sales reporting dashboard](https://attio.com/help/reference/managing-your-data/dashboard-and-reports/build-a-sales-reporting-dashboard)
- **Pipedrive Insights report families** (vendor KB): Deal Performance (won/lost/open), Deal Conversion (stage funnel + win/loss), Deal Duration ("how long deals spend in each stage to identify bottlenecks"), Deal Progress (movement over time), Deal Products, Deal/Product Revenue Forecast, Activities Performance ("activity volume and outcomes"), Emails Performance, Lead Performance (by status, source, owner), Lead Conversion (lead-to-deal rate), People/Organizations reports. — [Pipedrive: Insights report types](https://support.pipedrive.com/en/article/insights-report-types)
- Pipedrive's Deal Duration report "shows the average time it takes a deal to make it through your pipeline" and "is always measured in days." — [Pipedrive: Deal duration](https://support.pipedrive.com/en/article/insights-reports-deal-duration)
- **HubSpot weighted forecast:** weighted pipeline = deal amount x stage probability; stage probabilities are set in Settings > CRM > Deals > Deal Stages; build via Reports > Create Report > Sales > Pipeline with metric "Weighted deal amount" grouped by deal stage. Suggested forecasting-dashboard reports: Quota attainment vs goal, Weighted pipeline forecast, Time in deal stages, Open deals expected to close this month. (Third-party guide, not HubSpot KB.) — [Coefficient: Weighted pipeline in HubSpot](https://coefficient.io/dashboard-examples/weighted-pipeline-hubspot)
- **HubSpot rep "home" (Sales Workspace, Summary tab):** tasks at the top, switchable between due today / overdue / due tomorrow; task progress shown as a bar chart; a simplified deal pipeline you can drag deals through; today's schedule preview in a right panel. — [HubSpot KB: Sales workspace](https://knowledge.hubspot.com/prospecting/review-sales-activity-in-the-sales-workspace); [HubSpot KB: updated sales workspace](https://knowledge.hubspot.com/sales-workspace/manage-sales-activities-in-the-updated-sales-workspace); detail from [Lightning Step HubSpot workspace guide](https://kb.lightningstep.com/academy/hubspot-sales-workspace-guide)
- **Close** organises reporting around: Opportunity reporting ("by stage, expected close date, and value"), Activity reporting ("calls, emails, texts, and meetings"), Rep-level reporting ("deals closed, activity volume, and conversion rates"), Pipeline stage reports, Leaderboards, Expected revenue views. — [Close Reporting](https://www.close.com/reporting)
- **Salesforce metric components** (third-party guide): a single big number such as "total pipeline value, deals closed this month"; advice: "Pair with a comparison to the prior period for context." Gauges are for "quota attainment, pipeline coverage", and "Skip these when you don't actually have a target." — [Spekit: Salesforce Lightning dashboards](https://spekit.com/salesforce-lightning-dashboards)
- **Velocity formula:** (qualified opportunities x average deal size x win rate) / sales cycle length in days; example 40 x $8,000 x 0.25 / 45 = about $1,778 per day. Average deal size = total closed-won value / number of closed-won deals in the period. (Standard formula, repeated across several vendor blogs; the worked example's exact originating page among these results was not individually verified.) — [Fullenrich: pipeline velocity](https://fullenrich.com/content/pipeline-velocity-formula); [Coefficient: pipeline velocity](https://coefficient.io/sales-operations/pipeline-velocity); [Zoho Motivator: Pipeline velocity dashboard](https://www.zoho.com/motivator/help/dashboards/pipeline-velocity.html)
- **monday CRM "battery" widget** is aimed at monitoring pipeline coverage (progress-to-target style). — [monday CRM dashboard search results / titanapps](https://titanapps.io/blog/monday-com-dashboard-templates)
- **folk** auto-creates starter charts on a new dashboard: "generated revenue, conversion rates, leads by status/industry, and performance by assignee." — [folk Help: Dashboards (beta)](https://help.folk.app/en/articles/9867508-dashboards-beta)

### Inferences
- A good single-user CRM KPI strip is about 5-6 tiles: **Open pipeline** (value + count), **Weighted forecast** (sum of value x stage probability, for deals expected to close this period), **Won this period** (value + count), **Win rate** (won / (won + lost) for deals closed in the period), **Avg deal size** (won value / won count), **Avg sales cycle** (days created to won). Each tile shows a delta vs the previous equal-length period (e.g. "+12% vs last 30 days"). The Salesforce guidance and the Sybill/Gigradar-style "track fewer numbers" advice both favour a short strip.
- "Stale deals" (no activity in N days, or more days in stage than the stage's average) and "overdue tasks" fit better in an *action list* on the home view than as charts. HubSpot's workspace puts tasks first. Attio and Pipedrive express staleness through time-in-stage analytics.
- Leaderboards (Close, monday, Pipedrive "performance by assignee") only matter for teams. A local single-user app should drop them, or reuse the slot for "by source" or "by tag".

### Gaps
- I found no vendor doc listing HubSpot's default "Sales dashboard" template contents verbatim (the HubSpot KB create-dashboard URL returned 404).
- I found no primary source specifying exactly how Pipedrive or HubSpot render the previous-period delta (arrow, %, or colour) on KPI tiles. The "pair with prior period" advice comes from a third-party Salesforce guide.
- I found no source defining a standard "stale deal" threshold.

---

## A2. Which chart types are used for which question?

### Takeaway
Current state of the pipeline is a bar/column by stage (count and/or value). Stage-to-stage conversion is a funnel, which Pipedrive draws as columns with a % per stage. Forecast is a column chart by month of expected close, splitting won and open (optionally weighted). Composition (lead source, win/loss) is a donut/pie capped at about 5-6 slices. Time-in-stage is bars by stage. Trends are lines. Exact numbers and leaderboards are tables.

### Cited Findings
- **Pipeline by stage:** Attio's "Deals in stage" is an Insight bar/count report grouped by stage. — [Attio sales dashboard guide](https://attio.com/help/reference/managing-your-data/dashboard-and-reports/build-a-sales-reporting-dashboard). Salesforce guidance: bar charts are "best for comparing values across categories, like pipeline by stage or deals by rep. Horizontal bars handle long labels better than vertical columns." — [Spekit](https://spekit.com/salesforce-lightning-dashboards)
- **Funnel conversion (Pipedrive):** drawn as a "column-based visualization", one column per stage, each showing "the percentage of deals that reached it", with the "overall win rate displayed at the top of the chart." It requires a pipeline filter (cannot be removed, "required for stage-based reporting"). By default it counts deals "created this year" with Status = Won/Lost. Won deals count as having passed every stage; Lost deals stop at the stage where they were lost. — [Pipedrive: Deal conversion](https://support.pipedrive.com/en/article/insights-reports-deal-conversion)
- **Win/loss (Pipedrive):** "column chart or scorecard". It can be segmented by date fields, owner, pipeline, source channel, contact person, labels; hovering a column shows "the exact number of deals won and lost." — [Pipedrive: Deal conversion](https://support.pipedrive.com/en/article/insights-reports-deal-conversion)
- **Forecast (Pipedrive Deal Revenue Forecast):** column chart, default "Cumulative forecast > Monthly", switchable to non-cumulative. Won deals are placed by won time and open deals by expected close date. The measure can be deal value or "deal weighted value" ("accounts for the stage or deal probability you have set"). Hovering a column shows "a breakdown of your existing and predicted revenue." — [Pipedrive: Revenue forecast](https://support.pipedrive.com/en/article/insights-reports-revenue-forecast)
- **Funnel visual (monday CRM):** a dedicated Funnel Chart widget shows current status counts and "calculates the transitions between status labels (i.e. the conversion % of a deal from 'New' to 'Won')". It is built into Leads and Opportunities board dashboards. — [monday: The Funnel Chart](https://support.monday.com/hc/en-us/articles/8805401342482-The-Funnel-Chart); [monday community: funnel chart widget](https://community.monday.com/t/special-monthly-crm-feature-update-funnel-chart-widget/49274)
- **Leaderboard (monday):** rep names on the left; columns for total deal sum, average deal size, then % of deals that transitioned through each funnel stage. — [monday: Leaderboard widget](https://support.monday.com/hc/en-us/articles/10100407939090)
- **Time in stage (Attio):** bars per stage showing Max, Average or Min time; an optional breakdown attribute (Owner, Date, Category) colour-codes the bars, with a key above the chart. Pro/Enterprise only. — [Attio: Time in stage report](https://attio.com/help/reference/managing-your-data/dashboard-and-reports/set-up-a-time-in-stage-report)
- **Attio report types:** Insight (current state, all plans; group by up to two attributes), Historical values (week-by-week / month-by-month trends), Funnel, Time in stage, Stage changed (records entering a stage in a window). Visible chart forms include bar, pie and line, plus a "Calculated values" table with CSV export. — [Attio: Create reports](https://attio.com/help/reference/managing-your-data/dashboard-and-reports/reports.md)
- **Salesforce chart menu (11 types, third-party summary):** Donut for "proportions: win/loss breakdown, lead-source distribution. Keep to 5 to 6 slices max" (combine small slices into "Other"). Funnel "to group a linear process like Opportunity Stage". Line "for trends over time: monthly revenue, weekly activity counts". Tables "best for leaderboards or when exact numbers matter". Gauge for a value against a target. Keep dashboards to "10-15 components". — [Spekit](https://spekit.com/salesforce-lightning-dashboards)
- **Funnel vs bar (dataviz reference):** a funnel shows flow through "interconnected, sequential stages" with segment width proportional to value. "The biggest value of a funnel chart isn't the overall conversion rate — it's identifying which specific stage has the largest drop-off." Funnels are "best used as a high-level visualization before moving into a deeper investigation". Bar/stacked bar is the more precise alternative. — [Atlassian: Complete guide to funnel charts](https://www.atlassian.com/data/charts/funnel-chart-complete-guide)
- **Chart menus at the lighter end:** folk has exactly five chart types ("Bar, Grouped bar, Stacked bar, Pie, Metrics") with formulas Count / Sum / Average / Ratio. — [folk Help: Dashboards](https://help.folk.app/en/articles/9867508-dashboards-beta). Twenty has Bar (horizontal or vertical; max 100 bars, 50 groups per bar), Pie, Line, Aggregate (single KPI with prefix/suffix and ratio), Table (optionally editable), iFrame, Rich text. — [Twenty docs: Widgets](https://docs.twenty.com/user-guide/dashboards/capabilities/widgets)

### Inferences
- Recommended mapping for a single-user CRM:
  - **Pipeline by stage:** horizontal bars (count + value label). It reads current state more accurately than a funnel, because open-deal counts per stage are not necessarily monotonic.
  - **Stage conversion:** Pipedrive-style columns with "% reached" per stage and overall win rate in the header, computed over deals *closed* in the period.
  - **Forecast:** columns by expected-close month, stacked as Won (solid) + Weighted open (lighter), with optional unweighted open as an outline.
  - **Won vs lost over time:** grouped or stacked columns per month, or a win-rate line.
  - **Lead source mix:** donut capped at 5-6 slices + "Other", or a ranked bar.
  - **Time in stage / deal aging:** horizontal bars of average days per stage, plus a list of open deals sorted by days-in-current-stage.
  - **Activity:** columns per week by type (call/email/meeting/note).
- Activity heatmaps (day-of-week x hour, or a GitHub-style calendar) do not appear in any vendor doc I reviewed. They look like a nice-to-have rather than a standard CRM chart.

### Gaps
- I could not verify a HubSpot or Salesforce first-party doc that recommends a specific chart for forecast (the HubSpot KB URLs I tried returned 404). Salesforce chart guidance here is third-party (Spekit).
- I found no source on "activity heatmaps" in CRM dashboards.
- I did not find Folk or Close docs describing a time-in-stage or aging chart.

---

## A3. Layout patterns, drill-down from chart to records, and filters (period, pipeline, owner)

### Takeaway
There are two distinct surfaces: (1) a personal **"my day" home** (tasks overdue/today/tomorrow, schedule, simplified pipeline), as in HubSpot Sales Workspace; and (2) an **analytics dashboard**, a grid of report cards (KPI tiles + charts) with dashboard-level filters for date range and owner. The best drill-down pattern is Pipedrive's: chart on top, a toggleable Deals / Summary table underneath. Attio and HubSpot also let you click a data point to see the contributing records.

### Cited Findings
- **Pipedrive report layout:** "chart above with a dual-view table below", toggled between "Deals" (detailed list filtered by report criteria) and "Summary" (aggregated results by the selected segment). — [Pipedrive: Deal conversion](https://support.pipedrive.com/en/article/insights-reports-deal-conversion)
- **Attio:** hover tooltips show values and counts; you can drill down to "contributing records from grouped data points"; filters support is / is not / contains with AND/OR groups, a "Current user" filter, and stage-history filters (records that "were" in stages or "entered a stage"). Edits to a report are not visible to teammates until saved. — [Attio: Create reports](https://attio.com/help/reference/managing-your-data/dashboard-and-reports/reports.md)
- **HubSpot dashboard filters:** property filters apply across all single-object and cross-object reports on the dashboard. A dynamic **Date range** quick filter is generated from the date properties used in the dashboard's reports. **Owners / Teams** quick filters are generated by analysing the reports on the dashboard. Tapping a value in a KPI chart "open[s] the drill-down table". — [HubSpot KB: Use dashboard filters](https://knowledge.hubspot.com/dashboards/use-dashboard-filters); [HubSpot KB: Dashboards in the mobile app](https://knowledge.hubspot.com/dashboards/use-dashboards-in-the-mobile-app)
- **HubSpot limitation (user complaint):** an ideas-forum thread titled "Dashboard cannot use date filter when using cross-reporting across contacts and companies" runs to at least 5 pages. — [HubSpot Community idea](https://community.hubspot.com/t5/HubSpot-Ideas/Dashboard-cannot-use-date-filter-when-using-cross-reporting/idi-p/215775/highlight/true/page/5)
- **Twenty dashboards** are structured "Dashboards → Tabs → Widgets". Table and kanban widgets can "Allow editing" (cell editing inside the dashboard, respecting permissions). Status: beta, enabled under Settings → Updates → Early Access. — [Twenty docs: Dashboards overview](https://docs.twenty.com/user-guide/dashboards/overview); [Twenty docs: Widgets](https://docs.twenty.com/user-guide/dashboards/capabilities/widgets)
- **folk dashboards:** per group (People, Companies or Deals); add / reorder (drag and drop) / remove / rename charts; "All charts display all-time data" (no granular date filtering); no drill-down mentioned; export not yet available (PDF via Cmd+P). Premium plan only; beta launched 3 Oct 2024 **[older]**. — [folk Help: Dashboards](https://help.folk.app/en/articles/9867508-dashboards-beta); [folk changelog](https://www.folk.app/changelog/dashboards-launch)
- **NocoDB CRM v2 (2026-03-27):** "charts and KPI cards now supporting click events for parameterized navigation and popup drill-through", i.e. click-to-filtered-records is becoming standard even in lightweight tools. — [NocoDB CRM changelog](https://docs.nocobase.com/solution/crm/changelog)
- **Salesforce guidance (third-party):** group related metrics on one dashboard, keep to 10-15 components, use consistent colours across related components. — [Spekit](https://spekit.com/salesforce-lightning-dashboards)
- **Close:** "Custom Pipeline Views" break the pipeline down "by team, rep, source, or product line"; dashboards can be built "for different teams, roles, or goals". — [Close Reporting](https://www.close.com/reporting)
- **Pipedrive forecast:** the available "view by" periods are constrained by the forecast-period filter. — [Pipedrive: Revenue forecast](https://support.pipedrive.com/en/article/insights-reports-revenue-forecast)

### Inferences
- Recommended layout for a local single-user CRM:
  - **Home ("Today"):** a KPI strip of 4-6 tiles with deltas; an action column (overdue tasks, due today, stale deals, keep-in-touch due); a compact pipeline-by-stage bar.
  - **Reports page:** global filters (period preset: this month / quarter / year / last 30-90 days / custom; pipeline; source/tag); a 2-column card grid. Every chart is clickable: clicking a bar or segment filters a records table under the grid or in a side panel (the Pipedrive pattern), with a Records/Summary toggle and CSV export (the Attio pattern).
- Use preset reports with light configuration (group-by, measure count/sum/avg) rather than a free-form report builder (see A4).
- Avoid folk's "all-time only" limitation. A period filter is table stakes.

### Gaps
- Primary docs for Salesforce dashboard filters and drill-down were not fetched.
- monday CRM dashboard filter behaviour was not verified.

---

## A4. What users complain about in CRM reporting

### Takeaway
Complaints fall into two groups. Heavyweight CRMs are too complex: report builders, too many clicks, built for managers and not for the people entering data. Lightweight CRMs have too little analytics: Streak, and folk's all-time-only dashboards. Small businesses often don't know what to track and end up exporting to spreadsheets or BI tools.

### Cited Findings
- Small-business complaints gathered from Reddit threads: "overcomplicated UI and excessive manual data entry"; having to "click through multiple screens to see contact interaction history instead of viewing a timeline on the contact card"; CRMs "built for sales managers to monitor reps rather than for reps to close deals, with friction designed to generate reports no one reads." (Aggregated commentary, not first-party.) — [Substack: The billion-dollar complaint](https://mihais7.substack.com/p/the-billion-dollar-complaint-a-single); [Reddit snapshot](https://reddit.sentinel-team.org/posts/1swz0ns/snapshots/2026-04-28T17%3A36%3A25.65247Z)
- A forum thread titled "Is anyone else getting fed up with how complicated CRMs have become?" shows the same sentiment among UK small businesses. — [UK Business Forums](https://www.ukbusinessforums.co.uk/threads/is-anyone-else-getting-fed-up-with-how-complicated-crms-have-become.430705/)
- "There is a painful gap between Salesforce's basic reports and a full-blown BI platform"; SMBs "cobble together their reporting using multiple tools" and "don't always know what to track or whether they can trust their data." (Vendor of a reporting add-on, so biased.) — [Coefficient: CRM reporting tools](https://coefficient.io/sales-operations/crm-reporting-tools)
- Streak (Gmail CRM) users "find the inadequate analytics restricting, especially as pipelines grow more complex" (G2, 4.5/5 from 265 reviews). — [G2: Streak reviews](https://g2.com/products/streak/reviews?page=3)
- folk dashboards show all-time data only and have no export. — [folk Help](https://help.folk.app/en/articles/9867508-dashboards-beta)
- HubSpot date filters can't be applied to cross-object reports (long-running ideas thread). — [HubSpot Community](https://community.hubspot.com/t5/HubSpot-Ideas/Dashboard-cannot-use-date-filter-when-using-cross-reporting/idi-p/215775/highlight/true/page/4)
- SuiteCRM was criticised for "Clunky Reports & Charts" and a "Dated Design". — [Marmelab 2025 benchmark](https://marmelab.com/blog/2025/02/03/open-source-crm-benchmark-for-2025.html)
- Attio gates advanced reports by plan: Funnel needs Plus+; Historical values, Time in stage and Stage changed need Pro/Enterprise. — [Attio: Create reports](https://attio.com/help/reference/managing-your-data/dashboard-and-reports/reports.md)
- Capsule frames small-business reporting around one question: "How are we doing?" — [Capsule CRM blog](https://capsulecrm.com/blog/build-your-own-dashboard/)

### Inferences
- A local single-user CRM can avoid both failure modes. Ship opinionated pre-built reports that answer "how am I doing / where is it stuck / what's coming", each with a period filter and click-to-records. Skip any report builder.
- Make sure the analytics that are paywalled elsewhere (funnel conversion, time-in-stage, historical trends) are computed from a stage-change history table. Pipedrive's and Attio's funnel, duration and stage-changed reports all depend on stage history, so the app must record stage transitions with timestamps from day one.

### Gaps
- I did not find a quantified survey (e.g. % of users dissatisfied with CRM reporting) from a reliable primary source. The Copper "28 stats" infographic was not fetched.
- I could not read G2/Capterra review text for HubSpot or Pipedrive reporting directly.

---

## B1. What founder / personal / relationship CRMs do well and badly

### Takeaway
Relationship CRMs win on four things. First, **keep-in-touch cadence per contact** with a daily digest of who to reach out to (Dex, Monica). Second, an auto-built **interaction timeline and last-contacted date** from email, calendar and social sources (Dex, Clay, Affinity). Third, **enrichment and relationship mapping** (Clay, Affinity). Fourth, an **"upcoming" view** of birthdays, reminders and events (Clay). Their weaknesses are information overload from bulk imports (Clay), manual-entry burden without sync (Monica), and weak analytics (Streak, folk).

### Cited Findings
- **Dex** (competitor-authored comparison, so biased toward Dex): reminders and follow-ups; an interaction timeline pulling from email, calendar and social; "pre-meeting brief emails with attendees and recent notes"; SMS/WhatsApp for notes and reminders; AI auto-grouping of contacts; Outlook support added 2026; $12/month billed annually. Best for "following up consistently". — [Dex blog: Dex vs Clay](https://getdex.com/blog/dex-vs-clay)
- Dex keep-in-touch: "set a reminder cadence per contact, and the personal CRM tells you who to reach out to each day (it even gives you daily digests via text)". A browser extension adds people from LinkedIn. Contacts are pulled from LinkedIn, email and phone. — [Dupple: Dex review (Sep 2026)](https://dupple.com/reviews/dex); [Dex: personal CRM networking guide (Apr 2026)](https://getdex.com/blog/personal-crm-networking-guide/)
- **Clay** (the personal CRM at clay.earth; the Dex blog labels it "Clay (Mesh)", suggesting a rebrand, which I did not verify): profile enrichment and aggregation; "relationship mapping, and browsing connections to uncover patterns"; an **Upcoming** view of "birthdays, reminders, and events for the next 30 days"; duplicate suggestions; Nexus AI that can create and update contacts; $10/month personal, $40/month team. — [Dex blog: Dex vs Clay](https://getdex.com/blog/dex-vs-clay)
- Clay syncs "email, calendar, LinkedIn, Twitter, and iPhone contacts" to build profiles automatically. Birthday/anniversary notifications. Nexus AI v3 offers "step-by-step reasoning, advanced search", and can add notes and create groups. — [Geekflare: Clay review](https://geekflare.com/software/clay-review/)
- Clay criticism: "can feel overwhelming with too much information imported"; "less ideal if you're constantly meeting people at events or need to capture leads quickly." — [Wavecnct: 6 best personal CRMs 2025](https://wavecnct.com/blogs/the-6-best-personal-crm-tools-in-2025)
- **Monica** (open source; review written by competitor Dex): fields for addresses, phones, important dates, family relationships, work history, food preferences, pet names, notes; relationships between contacts; per-contact reminder intervals (weekly, monthly, quarterly, yearly) with notifications "at 30 days, 7 days, and day-of"; logging of calls, meals and meetings with custom activity types; a journal whose entries tag contacts ("part diary, part relationship log"); debts, gifts, tasks; import/export. Limits: "no email sync, no calendar sync, no LinkedIn integration, no mobile app, and requires you to manually enter every interaction." — [Dex: Monica review (Apr 2026)](https://getdex.com/blog/monica-review/)
- **Affinity** (investors): relationship-strength scores "from real interactions"; warm-intro discovery via those scores; automatic capture of "every email, meeting, and note"; enrichment from inbox and calendar; one-click deal updates; sharing pipeline status with GPs/LPs. Vendor claim of about 220 hours saved per person per year. — [Affinity product page](https://www.affinity.co/product?utm_id=b2saas); [Affinity: VC](https://www.affinity.co/lp/venture-capital-lp)
- **Streak** (CRM inside Gmail): pipelines with custom stages; each entry is a "box" holding interaction history, files, notes and tasks; explicitly used for "sales, hiring, investor outreach, fundraising, partnerships". G2 4.5/5 (265 reviews), praised for Gmail integration, criticised for "inadequate analytics". — [G2: Streak](https://g2.com/products/streak/reviews?page=3); [Joinsecret: Streak reviews](https://www.joinsecret.com/streak/reviews)
- **folk** positions as "the CRM for people-powered businesses"; data is organised in **groups** (People / Companies / Deals); dashboards are per group, and private groups restrict dashboard access to the creator. — [folk Help: Dashboards](https://help.folk.app/en/articles/9867508-dashboards-beta); [folk: CRM with custom KPI dashboards](https://www.folk.app/articles/crm-with-custom-kpi-dashboards)
- **Founder guidance:** a founder personal CRM should "help you remember who matters and when to reach out". Track five things per contact: "who they are, how you know them, last contact date, next action, and relevant notes". Start with the ~50 people who matter most rather than importing the whole network. — [River: personal CRM for founders](https://rivereditor.com/blogs/personal-crm-for-founders)

### Inferences
- What a local single-user CRM should copy:
  - Per-contact **keep-in-touch cadence** (e.g. every 2 weeks / month / quarter) with a computed **"due to reach out" list** on the home view (Dex, Monica).
  - **Last contacted**, auto-derived from the latest logged interaction, shown on every contact row and card.
  - **Next action** field.
  - **How we met / context** field.
  - **Important dates** (birthdays) feeding an **Upcoming 30 days** panel (Clay).
  - A **timeline on the contact card** (directly answers the Reddit complaint).
  - **Relationships between contacts** ("introduced by", "works with") (Monica, Attio relationship attributes).
- What to avoid:
  - Bulk-import overload (Clay). Encourage starting with a short list.
  - Making manual logging slow (Monica's main weakness). Without sync, one-keystroke "log interaction" and quick-capture are essential.
- Relationship strength (Affinity) depends on large interaction data. A local app could approximate it from recency and frequency of logged interactions, but no source documents such a formula (see Gaps).

### Gaps
- **Covve** was not researched (no results fetched).
- **Notion CRM templates** were not researched.
- Clay's rebrand to "Mesh" appears only in Dex's blog and was not independently verified.
- No source gave Affinity's or Clay's relationship-strength formula.
- Dex and Monica details come largely from Dex's own blog, a competitor; treat comparative claims with caution.

---

## B2. Open-source CRMs: data model, UI quality, what reviewers say; Twenty's UI decisions

### Takeaway
Twenty is the consensus UX leader among open-source CRMs. Marmelab rates it 9/10 in both 2025 and 2026, and it is deliberately Attio-like: custom objects, records, relations, table and kanban views, and a modern, uncluttered UI. Reviewers still call its list UI "bland", and its dashboards are only in beta. EspoCRM is complete and clean but complex to customise. SuiteCRM, Odoo and Krayin are criticised for dated or clunky UX. Atomic CRM (by the benchmark's author) is the minimalist React + shadcn reference.

### Cited Findings
- **Marmelab benchmark 2026** rankings: Twenty 9, Atomic CRM 8, Krayin 7, EspoCRM 7, OroCommerce 6, SuiteCRM 5, Odoo 4, ERPNext 4, Axelor 3. "None of the CRMs we tested earned a perfect score." **Bias note:** Marmelab builds Atomic CRM (react-admin), its #2 pick. — [Marmelab: Best open source CRM 2026](https://marmelab.com/blog/2026/01/09/open-source-crm-benchmark-2026.html)
- **Twenty, per Marmelab:** custom objects and fields via GUI, email/calendar sync, workflow builder, GraphQL/REST APIs. "list UI is bland". Weaknesses: AGPL-3.0, no mobile UI, "lacks SSO and dashboards" (2026). In 2025 Marmelab listed "tags, charts, and dashboard functionality" and an "enormous codebase relative to features". — [Marmelab 2026](https://marmelab.com/blog/2026/01/09/open-source-crm-benchmark-2026.html); [Marmelab 2025](https://marmelab.com/blog/2025/02/03/open-source-crm-benchmark-for-2025.html)
  - **Conflict:** Marmelab 2026 says Twenty lacks dashboards, but Twenty's own docs describe Dashboards (tabs + bar/pie/line/aggregate/table widgets) as **beta, behind Settings → Updates → Early Access**. Most likely the benchmark predates GA or excluded beta features. — [Twenty docs: Dashboards overview](https://docs.twenty.com/user-guide/dashboards/overview)
- **Twenty positioning:** "deliberately Attio-like — with custom objects, records, and relations", free to self-host with no seat count. — [Rework: Attio alternatives 2026](https://resources.rework.com/vi/tools/crm/best-attio-alternatives). The README frames its building blocks as "objects, views, workflows, and agents" and itself as "the CRM you build, ship, and version like the rest of your stack". About 60,000 GitHub stars and 9,800 forks at fetch time. Stack: TypeScript, NestJS, PostgreSQL, Redis, BullMQ, React (Jotai, Linaria, Lingui). — [GitHub: twentyhq/twenty](https://github.com/twentyhq/twenty)
- **Twenty UI review:** "The UI is genuinely good. It feels modern, loads quickly, and doesn't overwhelm you with 40 menu items when you log in." Deal pipelines are drag-and-drop; contact records are "clean and customizable". SuiteCRM by contrast "feels dated, the learning curve is steep". — [SentiSight: Twenty CRM review 2026](https://www.sentisight.ai/twenty-crm-review-is-this-open-source-salesforce-alternative-ready-for-production/)
- Twenty also has favourites in the sidebar, soft delete and bulk actions. — [Marmelab 2025](https://marmelab.com/blog/2025/02/03/open-source-crm-benchmark-for-2025.html)
- **Atomic CRM:** React + shadcn/ui + Supabase; "Only 15k LOC"; MIT; "Great user experience", Kanban pipeline board, advanced search, "Great Mobile UI"; no email/calendar sync; small community. — [Marmelab 2025](https://marmelab.com/blog/2025/02/03/open-source-crm-benchmark-for-2025.html); [Marmelab 2026](https://marmelab.com/blog/2026/01/09/open-source-crm-benchmark-2026.html)
- **EspoCRM:** "Very complete CRM with a clean user interface"; Model studio, roles manager, audit logs, customisable dashboards; "complex filtering UX" (2025); home-made frameworks and limited dev docs; "half-baked mobile support". — [Marmelab 2026](https://marmelab.com/blog/2026/01/09/open-source-crm-benchmark-2026.html); [Marmelab 2025](https://marmelab.com/blog/2025/02/03/open-source-crm-benchmark-for-2025.html)
- **Krayin** (Laravel): Kanban lead view, unlimited custom fields, web forms, customisable dashboard, marketing automation. Marmelab criticises "low information density", a "frustrating user interface" and slow performance. — [Marmelab 2026](https://marmelab.com/blog/2026/01/09/open-source-crm-benchmark-2026.html); [Webkul/Krayin](https://webkul.com/blog/?p=304079)
- **SuiteCRM:** feature-rich with workflow automation; "Dated Design", "Clunky Reports & Charts", "Poor User experience", subpar mobile. — [Marmelab 2026](https://marmelab.com/blog/2026/01/09/open-source-crm-benchmark-2026.html)
- **Odoo CRM:** part of a full ERP; "Too large!" for small businesses; "not always intuitive"; steep learning curve; has a mobile app. — [Marmelab 2025](https://marmelab.com/blog/2025/02/03/open-source-crm-benchmark-for-2025.html)
- **Monica:** self-hosted personal CRM focused on friends and family (see B1); "not a networking tool" and not for sales pipelines. — [Dex: Monica review](https://getdex.com/blog/monica-review/)

### Inferences
- The UX bar for a small-team or local CRM is the **Attio/Twenty pattern**:
  - A left sidebar of objects (People, Companies, Deals, plus custom) and favourites.
  - Each object rendered as a dense **table view** with inline editing, saved views, filters and sort, plus a **kanban view** grouped by a status field.
  - A **record page** with fields on one side and timeline/notes/tasks on the other.
- Reviewers penalise:
  - Bland, low-density lists (Twenty, Krayin), so the table needs visual hierarchy: avatars, status chips, relative dates.
  - Complex filter UX (EspoCRM), so prefer simple chip-based filters.
  - Dated or cluttered navigation (SuiteCRM; "40 menu items").
  - Weak or clunky charts (SuiteCRM).
- Since the repo's memory notes crm-system as the shadcn reference, Atomic CRM (also shadcn) is a relevant open-source comparison for component-level UX.

### Gaps
- I did not fetch Twenty docs on keyboard shortcuts / command menu (Cmd+K) or the record-page layout, so those UI specifics are unverified here.
- No independent review explicitly documents Twenty copying Attio pixel-for-pixel. The "deliberately Attio-like" claim is from Rework, a third-party listicle.
- Twenty's Dashboards GA date is unknown (beta at time of research).

---

## B3. Running multiple founder use cases (sales, fundraising, partnerships, hiring, community) in one CRM

### Takeaway
Products handle this in one of two ways. Some keep **one contact/company base with multiple pipelines or lists**: Streak's per-use-case pipelines, folk's groups, Attio's lists for one-off processes. Others use **dedicated objects** for heavier processes: Attio's Deals, LP, Fund and Commitment objects for investors. Relationship attributes (e.g. "Warm Intro Source") connect people across pipelines.

### Cited Findings
- Streak lets you "manage your sales, hiring, investor outreach, fundraising, partnerships, and more — all from the same system". Each pipeline has its own stages, and each record (box) carries its own history, files, notes and tasks. — [G2: Streak](https://g2.com/products/streak/reviews?page=3)
- **Attio for VCs:**
  - Core objects: People (founders, LPs, scouts, angels, experts), Companies, Deals ("individual funding rounds ... with separate deal terms, timelines, and decision rationale").
  - Custom objects: LP; Managed Funds ("target raise, committed capital, remaining investable capital"); Investor Commitments.
  - "Relationship attributes" capture roles like "Lead Investor, Board Observer, or Warm Intro Source".
  - Lists are secondary, for "managing one-off processes" such as "Advisors introduced to portfolio companies".
  - [Attio: VC industry guide](https://attio.com/help/reference/industry-guides/vc.md)
- Founders use Attio for fundraising: create investors quickly, track commitments by stage and owner, one-click LinkedIn sourcing, and reportedly "the best free-tier experience for first-time raisers". (Third-party listicles.) — [ValueAddVC: fundraising CRM tools](https://valueaddvc.com/blog/best-fundraising-crm-tools-for-founders-7-options-for-managing-your-raise); [The Venture Crew: simple fundraising CRM](https://theventurecrew.substack.com/p/a-simple-crm-to-manage-your-fundraising)
- folk organises work into groups (People, Companies, Deals) with per-group dashboards and permissions. — [folk Help: Dashboards](https://help.folk.app/en/articles/9867508-dashboards-beta)
- Dex says it fits "founders, investors, salespeople, recruiters, and anyone whose work runs on relationships rather than a formal sales pipeline". — [Dupple: Dex review](https://dupple.com/reviews/dex)
- Affinity covers investor deal flow: deal sourcing, one-click deal updates, pipeline status shared with GPs/LPs. — [Affinity: Deal flow management](https://www.affinity.co/lp/deal-flow-management)
- Pipedrive's funnel report requires selecting a single pipeline because stage-based reporting is per pipeline. — [Pipedrive: Deal conversion](https://support.pipedrive.com/en/article/insights-reports-deal-conversion)

### Inferences
- For a local founder CRM, the simplest model that covers all five use cases:
  - **Shared People + Companies.**
  - **Multiple pipelines**: Sales, Fundraising, Hiring, Partnerships, optionally Community. Each has its own ordered stages with a win probability and a "won/lost" terminal flag. A Deal/Opportunity record belongs to exactly one pipeline and links to people and companies.
  - **Pipeline-specific vocabulary**: Fundraising uses "Check size" and stages like Intro → First meeting → Partner meeting → Term sheet → Committed/Passed. Hiring uses Sourced → Screen → Interview → Offer → Hired/Rejected.
- Dashboards and reports should take a **pipeline filter**, as Pipedrive requires for funnels. KPIs like weighted forecast only make sense for revenue-bearing pipelines. A fundraising pipeline instead wants "committed vs target", which is a gauge/battery use case.
- Community and partnerships are often better served by **lists/tags + keep-in-touch cadences** than by staged pipelines, matching Attio's "lists for one-off processes".

### Gaps
- No primary documentation found for Notion CRM templates or Covve multi-pipeline handling.
- No source describes standard fundraising-pipeline stage names. The stages above are an inference, not a cited finding.
- Clay/Dex support for staged pipelines (vs groups only) was not verified.
