# AI and AI agents in CRM software (state as of late Oct 2026)

Scope: concrete AI and agent features in CRMs, and how they are designed: what the agent does on its own, what it proposes for approval, how its work is shown, and how trust, review, undo and audit work. Purpose: inform a CRM app where an external agent (CraftBot) operates the CRM through an API alongside a human.

Source quality legend used below: **[doc]** = vendor help docs or developer changelog (most reliable for behavior); **[vendor-mkt]** = vendor marketing or launch page (claims, not verified behavior); **[3p]** = third-party write-up, partner agency or reviewer (often summarizing docs); **[snippet]** = only a search-result snippet was available, not the full page. Dates are launch or publication dates where found.

---

## Q1. Which tasks do CRM agents automate today?

### Takeaway
By late 2026, every major CRM ships agents for six tasks: (1) web and firmographic enrichment and research into fields; (2) auto-capture of emails and meetings, with summaries written as notes or activities; (3) suggested field updates (stage, amount, close date, next step) extracted from calls; (4) drafted follow-up and outreach emails; (5) natural-language Q&A over CRM data; (6) scheduled digests and hygiene sweeps. Deduplication is still mostly deterministic (exact-match auto-merge) rather than agentic. Forecast commentary, deal-risk scoring and coaching exist mainly at the enterprise tier (Salesforce, Gong). The AI-native CRMs (Lightfield, Day.ai, Clarify, Attio) differ from incumbents mainly in that the record builds itself from conversations instead of being typed in.

### Cited Findings

**AI-native CRMs**
- **Lightfield** (GA in the week of Nov 14, 2025): it reads emails, meeting transcripts, calls and Slack messages and builds the CRM automatically. It is described as "schema-less from Day One". Agents do meeting prep, follow-up generation, pipeline updates from conversation signals, and stale-deal detection with drafted "revival" emails. One user claims they revived "40+ stalled opportunities in a single two-hour session." [3p] — [SaaStr](https://www.saastr.com/saastr-ai-app-of-the-week-lightfield-the-ai-native-crm-that-killed-tomes-25-million-users-to-build-something-better/); GA date — [Lightfield changelog](https://lightfield.com/blog/suggested-record-updates-support-in-lightfield)
- Lightfield answers questions in natural language "with citations to the actual conversations". Pricing: $36/user/mo (10k records) and $99/user/mo (50k records). [3p] — [SaaStr](https://www.saastr.com/saastr-ai-app-of-the-week-lightfield-the-ai-native-crm-that-killed-tomes-25-million-users-to-build-something-better/). It raised a $47M Series A led by a16z — [Digital Today](https://www.digitaltoday.co.kr/cn/view/102174/lightfield-raises-47-million-in-series-a-for-ai-agent-crm) [snippet]
- **Day.ai** (Series A $20M; launched "CRMx" for "agent-first sales teams"): it ingests "email threads, calendar invites, half-filled CRM fields, and call recordings" into a "context graph", meaning natural-language representations of every signal and relationship. — [Sarah Guo / Conviction Substack, Feb 2026](https://saranormous.substack.com/p/crm-was-built-for-humans-day-was) [3p, investor-authored]; funding — [ContentGrip](https://www.contentgrip.com/day-ai-raises-20m-autonomous-crm/) [snippet]
- Day.ai converts dialogue into "contacts, companies, deals, notes, and timelines that update as new conversations land". It infers stakeholder roles, sentiment and champions/blockers, and "suggests next best actions". "Ask Day" answers questions "with supporting snippets". It drafts emails, mutual action plans and business cases "ready for human edit and send". It ships an API, SDK and MCP server. Pricing is per *agent*: Free, Turbo $24/mo, Professional $60/mo, Executive $200/mo. — [folk review of Day AI](https://www.folk.app/articles/day-ai-review) [3p, competitor-authored]
- **Clarify** "Customer Relationship Agents" (Product Hunt launch, around June 2026): agents for "pipeline digests, lead enrichment, data hygiene, call coaching", plus lead routing, account research, follow-up drafts, outbound plays and record updates. The founder's example is a "deal creation agent that looks at call transcript, email, + usage data". — [Product Hunt launch + maker comments](https://www.producthunt.com/p/clarify-6/customer-relationship-agents-by-clarify); [ChatGate, Jun 24 2026](https://chatgate.ai/post/customer-relationship-agents-by-clarify) [3p]
- Clarify agents are set up from a prompt: "describe the workflow, let Rep configure the trigger, instructions, and tools, review it, then turn it on." — [ChatGate](https://chatgate.ai/post/customer-relationship-agents-by-clarify) [snippet/3p]
- **Attio** (several features):
  - *AI attributes* come in four kinds. "Summarize record" works from existing attribute values only. "Web agent" does real-time web research. "Prompt completion" is a custom prompt with attribute variables. "Classify record" fills select or multi-select fields. AI attributes cannot read notes or emails. — [Attio help: AI attributes](https://attio.com/help/reference/attio-ai/ai-attributes) [doc]
  - *Research agent* is a block in Workflows. It does ICP fit, decision-maker identification, funding history and leadership-change monitoring, writes results into records, and uses existing Attio data as context. It was originally launched in Aug 2024 (an **older** item, page updated Aug 2026). — [Attio blog](https://attio.com/blog/introducing-attio-ai-research-agent) [vendor-mkt]
  - *Ask Attio* is a chat over workspace data. Its 2026 updates added inline data tables, compact record links, web-source display, list queries, regenerate and favorites. — [Attio changelog "Ask Attio updates"](https://attio.com/changelog/2026/ask-attio-updates) [snippet; page 404'd on fetch]. As of Sep 23, 2026, Ask Attio shows "how many credits any thread uses", and a "Workflow custom agent block" exposes model choice (Opus 5.5, GPT 6 Sol/Luna, Gemini Flash 3.8). — [Attio changelog Sep 23 2026](https://attio.com/changelog/2026/changelog-september-23-2026) [doc]
- **folk**: a *Follow-up Assistant* detects email or WhatsApp threads that have gone inactive with a pending next step and sends a notification with a pre-written follow-up "in your tone of voice". A *Research Assistant* enriches company fields (industry, size, founding date, funding, links, location, description) via People Data Labs and writes research notes via Perplexity. It runs on one record or in bulk from table and pipeline views. — [folk.app](https://folk.app) [vendor-mkt/snippet]
- **Clay** (enrichment workbench feeding CRMs): every column is either an enrichment provider call or an AI prompt (Claygent). Its *waterfall* runs Provider A on every row, then B only where A missed, then C, and so on. Claygent is a web-browsing agent for data no provider has. — [LeadMagic Clay guide](https://leadmagic.io/guides/clay-data-enrichment-guide) [3p]. Claygent model tiers are Helium, Neon (best for multi-field extraction) and Argon (deep research), at about 3 credits/row. — [Clay community model cheat sheet](https://community.clay.com/x/support/w4vlh7bke9zv/clay-model-selection-cheat-sheet-for-use-cases) [snippet]

**Incumbents**
- **HubSpot Breeze**: at INBOUND (Sep 3, 2025) HubSpot announced 15+ Breeze agents, including the Customer Agent ("AI front office concierge") and the Prospecting Agent ("24/7 BDR"), plus Breeze Studio and Marketplace. — [BusinessWire](https://businesswire.com/news/home/20250903907062/en/HubSpot-unveils-blueprint-to-building-hybrid-human-AI-teams-with-200-product-updates-at-INBOUND-2025) [vendor press]
  - *Prospecting Agent* researches accounts from signals and drafts personalized emails. — [HubSpot product page](https://www.hubspot.com/products/sales/ai-prospecting-agent) [vendor-mkt]
  - *Data Agent*: smart properties draw on web research, the company website, other properties, and activities/transcripts. They fill on demand ("Smart fill"), in bulk, through the workflow action "Data Agent: Fill Smart Property", or on a daily/weekly/monthly schedule. — [HubSpot KB: Create smart properties](https://knowledge.hubspot.com/properties/create-smart-properties) [doc]. Cost is 10 credits per execution, and customers have "automated more than 1.1 million research and insight tasks". — [SpotDev](https://www.spotdev.co.uk/blog/hubspot-breeze-closing-and-data-agents) [3p partner]
  - *Closing Agent / Smart Deal Progression* (public beta Apr 14, 2026, with GA expected summer 2026): reads the meeting transcript plus deal history. It suggests updates to deal stage, close date, amount, next steps and conversation outcome, drafts a follow-up email, and surfaces action items with transcript citations. — [SpotDev](https://www.spotdev.co.uk/blog/hubspot-breeze-closing-and-data-agents) [3p]; [Rework, Spring 2026 Spotlight](https://resources.rework.com/news/sales-tech/hubspot-spring-2026-smart-deal-progression-aeo-revops) [3p]
  - *Record summaries*: the Breeze summary card on contact, company, deal and ticket records draws on activities, notes, ownership and property values. It "is automatically generated and cannot be manually customized". — [HubSpot KB: Summarize records](https://knowledge.hubspot.com/records/summarize-records) [doc]
  - *Deduplication*: the duplicates tool compares property values daily and surfaces pairs to merge or reject, individually or in bulk, with custom matching rules. — [HubSpot KB: Manage duplicates](https://knowledge.hubspot.com/records/manage-duplicate-records) [doc]. Auto-merge covers exact 1:1 property matches only (Ops Pro/Enterprise, around Mar 2025). — [Orange Marketing recap](https://blog.orangemarketing.com/top-hubspot-updates-monday-recap-march-24-2025) [snippet]
- **Salesforce Agentforce**:
  - *SDR agent* (Agentforce for sales development) is "first point of contact for inbound leads, conduct personalized outreach, answer customer questions, and even book meetings". It also handles stale-opportunity re-engagement and is monitored via "Control Center" and an "Agent Analytics dashboard". — [Trailhead: Get to know Agentforce SDR](https://trailhead.salesforce.com/content/learn/modules/agentforce-sdr-setup-and-customization/get-to-know-agentforce-sdr) [doc]. It "sends an initial outreach email to each prospect and follows up with timely nudges if there is no reply", and admins can preview drafts for selected leads before activation. — [Trailhead: Configure SDR agent](https://trailhead.salesforce.com/content/learn/modules/agentforce-sdr-setup-and-customization/configure-and-activate-your-sdr-agent) [doc]
  - *Sales Coach* sits on the opportunity record. It runs pitch practice (recorded with camera and mic) and role-plays the buyer in negotiation stages, then gives feedback in sections: overall impression, what went well, growth opportunities. GA since around late 2024 (**older**). — [Trailhead: Agentforce Sales Coach](https://trailhead.salesforce.com/content/learn/modules/agentforce-for-sales-coaching-setup-and-customization/get-to-know-agentforce-sales-coach) [snippet]
- **Pipedrive**: the *AI Sales Assistant* (beta) gives deal summaries, recent changes and linked deals, plus prompt-based insights. — [Pipedrive AI sales assistant](https://pipedrive.com/en/features/ai-sales-assistant) [vendor-mkt/snippet]. *Nova* (launched Sep 16, 2026) does pre-call prep from deal history and emails, records and transcribes calls, identifies follow-ups, and **proposes** updates to deal stage, deal value and expected close date. Its GA vs beta status is reported inconsistently. — [LetsDataScience news](https://letsdatascience.com/news/pipedrive-launches-nova-ai-assistant-for-crm-updates-52a0540c) [3p]
- **Close**: Close Notetaker transcribes and summarizes calls. "Chloe", the built-in assistant, drafts post-call follow-up emails using CRM history and also provides follow-up suggestions, lead summaries, and "autofill for CRM fields". — [close.com/ai](https://close.com/ai) [vendor-mkt/snippet; page 404'd on fetch]; [AIIndigo on Chloe](https://aiindigo.com/blog/an-honest-look-at-chloe-by-close-is-ai-sales-automation-actually-working-in-2026) [snippet]
- **Zoho Zia Agents / "Digital Employees"**: these qualify leads, send emails and update records. They are provisioned as named users (see Q3). — [Zoho community post](https://help.zoho.com/portal/id/community/topic/zia-agents-in-zoho-crm-a-better-way-to-set-up-digital-employees) [doc-ish]
- **monday CRM**: an SDR Agent (announced at Elevate, Sep 2025) handles "data enrichment, initial outreach, and prospect handoffs". A seats-plus-AI-credits pricing model followed in 2026. — [UC Today](https://uctoday.com/collaboration/elevate-2025-monday-com-announce-ai-products-monday-agents-and-campaigns) [3p/snippet]
- **Affinity** (relationship intelligence, VC/PE): the *Ascend* "Data Update agent" reads meeting notes and proposes field updates within about 1 minute of note creation. It excludes provider-enriched fields such as Crunchbase and PitchBook. — [Affinity support: Review and approve agent suggestions](https://support.affinity.co/s/article/Review-and-approve-agent-suggestions) [doc]
- **Copper**: I found no 2025-2026 primary source on Copper's AI features (see Gaps).

**Email and meeting tools that write into the CRM**
- **Gong AI Data Extractor**: it "pulls details from calls and emails" into Gong and optionally into mapped CRM fields. It runs on accounts and deals active in the last 30 days, recalculates when a new relevant conversation arrives, and allows at most 20 extractors per workspace. It can only write to existing CRM fields, not create them. — [Gong help: AI Data Extractor](https://help.gong.io/docs/ai-data-extractor) [doc]
- **Fathom**: at the end of every call it logs an AI summary as an activity on the matched contact, account or opportunity in HubSpot or Salesforce. Custom field mapping covers values such as budget and next steps. "Deal View" (Business plan) aggregates calls per deal with an AI deal summary. — [Fathom CRM integrations](https://www.fathom.ai/integrations-crm) [vendor-mkt/snippet]
- **Granola**: it has native one-way integrations with Attio, HubSpot and Affinity, pushing notes to the CRM. — [Granola integrations guide](https://www.granola.ai/blog/granola-integrations-complete-guide-connecting-meeting-tools) [snippet]. The Attio sync writes *only notes* to existing People, Company or Deal records. It creates no records, changes no fields and does not move deal stages. — [Granola: Connect Granola to Attio](https://www.granola.ai/blog/connect-granola-attio-complete-integration-guide) [vendor doc-ish]
- **Superhuman** (owned by Grammarly since 2025): Auto Drafts writes follow-ups "in your voice". Auto Labels and CRM context come from HubSpot, Salesforce and Pipedrive on the Business plan ($33/user/mo). — [GTM Directory: Superhuman](https://thegtmdirectory.com/tools/superhuman/md) [3p/snippet]

### Inferences
- The universal pattern is **conversation in, structured CRM out**. Notes and summaries are the safe automatic output; field changes come out as proposals.
- Enrichment and research have converged on "**AI field = a column defined by a prompt + data sources**" (Attio AI attributes, HubSpot smart properties, Clay AI columns). This is a natural primitive for CraftBot: the agent fills declared AI fields, and each field declares its sources and refresh policy.
- Dedup, forecast commentary and lead scoring are thinner on agentic features than enrichment and capture. Deterministic matching still dominates dedup.
- Pricing has moved to **credits per agent run** (Attio 1 or 10 credits; HubSpot 10 credits; Clay about 3 credits/row; monday credits). Vendors now surface per-thread or per-run cost (Attio, Sep 2026). A CRM operated by an external agent should probably expose a run/cost ledger too.

### Gaps
- No primary 2025-2026 sources found for Copper AI, Zoho Zia's legacy features (anomaly detection, best time to contact), or Pipedrive's AI email writer specifics.
- Agentforce forecast and deal-risk commentary was not verified from Salesforce docs.
- Day.ai's details come from investor- and competitor-authored pages; I found no Day.ai help docs.

---

## Q2. How are AI-generated values shown (badges, sparkles, confidence, sources, attribution, review queues)?

### Takeaway
The most concrete shipped patterns are:
- **hover-to-see-sources** on the generated value (Attio confidence dot with reasoning and web sources; HubSpot "AI" button with a "Sources" tab; HubSpot Closing Agent "hover to see which part of the call");
- **inline source next to a suggested change** (Lightfield);
- **current → proposed diff with per-field checkboxes** in a dedicated agent activity tab (Affinity);
- **actor attribution in the activity log** linked to an agent run with its reasoning (Clarify) or to a dedicated agent user identity (Zoho).

Generic "sparkle" iconography is common, but I did not find it documented precisely. Attio explicitly shows no badge on AI cells apart from the confidence dot.

### Cited Findings
- **Attio**: the Web agent shows "a small colored dot" next to a result (green high, yellow medium, red low confidence). Hovering reveals "the agent's reasoning and the web sources it used". Otherwise generated values sit in normal cells "without special badges or icons". If the AI can't return a value, the cell stays blank and no credit is charged. — [Attio help: AI attributes](https://attio.com/help/reference/attio-ai/ai-attributes) [doc]
- **Attio Ask Attio** shows the "web source information showing which sources informed an answer", plus inline tables and record links in chat. — [Attio changelog](https://attio.com/changelog/2026/ask-attio-updates) [snippet]
- **HubSpot smart properties** appear as normal columns. Hovering shows an "AI" button that opens a details panel with a "Sources" tab. Values "cannot be manually overwritten once generated—only removed or regenerated". — [HubSpot KB: Create smart properties](https://knowledge.hubspot.com/properties/create-smart-properties) [doc; summarized by fetch tool]
- **HubSpot Closing Agent** suggestions appear in three places: email notifications, the deal index page, and the deal record. Reps can "hover over a recommendation to see exactly which part of the call it came from." — [SpotDev](https://www.spotdev.co.uk/blog/hubspot-breeze-closing-and-data-agents) [3p]
- **Lightfield** suggested record updates appear on all related account, opportunity and contact records. Users "see the source of the new value in-line as you accept or reject each suggestion" (Nov 14, 2025). Summary fields "update automatically when new email activity occurs". — [Lightfield changelog](https://lightfield.com/blog/suggested-record-updates-support-in-lightfield) [doc]
- **Affinity** has a review queue at Ascend → **Agent Activity**, grouped by record and by source meeting note. Each item shows the *current value with last-update timestamp* and the *proposed value*, with per-field checkboxes, "Select all", "Edit" and "Reset". It links back to the source via "View Note". Applied items move to a read-only **Activity History** marked with a green check (plus an edit icon if the human changed the value) or a gray minus for declined. History logs "Suggested Value (edited)" next to the applied value and shows "Previous → Suggested" transitions. — [Affinity support](https://support.affinity.co/s/article/Review-and-approve-agent-suggestions) [doc]
- **Clarify** keeps an "activity log of every change on a record, including the actor", and "actions from agents are associated with an agent run, which includes the entire reasoning context". — [Product Hunt maker comment (Patrick Thompson, founder)](https://www.producthunt.com/p/clarify-6/customer-relationship-agents-by-clarify)
- **Zoho Digital Employees** act under their own identity (an `@ziaagent.ai` email), so the audit trail distinguishes "exactly which actions were performed by the agent versus by human users". — [Zoho community post](https://help.zoho.com/portal/id/community/topic/zia-agents-in-zoho-crm-a-better-way-to-set-up-digital-employees)
- **Salesforce** trust patterns include **Transparency**: "AI-generated content is directly and transparently disclosed". The Einstein Trust Layer's **audit trail** means "AI interactions are captured in event logs". — [Trailhead: Agentforce guardrails and trust patterns](https://trailhead.salesforce.com/content/learn/modules/trusted-agentic-ai/explore-agentforce-guardrails-and-trust-patterns) [doc]
- **Day.ai / Lightfield / Ask Day** answer with supporting snippets or "citations to the actual conversations". — [folk on Day AI](https://www.folk.app/articles/day-ai-review) [3p]; [SaaStr on Lightfield](https://www.saastr.com/saastr-ai-app-of-the-week-lightfield-the-ai-native-crm-that-killed-tomes-25-million-users-to-build-something-better/) [3p]
- **Clay** practitioners prompt Claygent to "Return the email AND the source URL. Do NOT guess… If no verified source, return empty". In other words, source URLs are a prompt convention, not a guaranteed UI feature. — [LeadMagic Clay guide](https://leadmagic.io/guides/clay-data-enrichment-guide) [3p]
- A practitioner recommendation (Oct 8, 2026): "The quote matters more than anything else in the design". Each suggestion should carry the transcript quote, one-click accept/reject, separate "suggested" properties, and a daily digest in Slack or email. — [Pravin Kumar](https://www.pravinkumar.co/blog/should-ai-meeting-notes-write-directly-to-your-crm-2026) [3p practitioner]
- ZoomInfo's guide says review-queue items should show "old value, new value, evidence source, and reason queued", and every write should be stamped with source and timestamp. — [ZoomInfo Pipeline (updated Oct 22 2026)](https://pipeline.zoominfo.com/operations/ai-agents-in-crm) [vendor-authored guidance]

### Inferences
- Converged display grammar for an agent-written value: **value + provenance affordance (dot/icon) → hover/panel with sources, reasoning, timestamp, run id**. For proposals: **current vs proposed + evidence quote + accept / edit / reject**, recorded afterwards as an immutable history row that keeps what was suggested and what was applied.
- Attio and HubSpot both avoid loud "AI" badges on every cell. Provenance is on demand (hover), not ambient. Confidence is shown only by Attio, and only for web research.
- For CraftBot, attribution should be by **actor identity** (agent user, Zoho-style) plus a **run id that links to its reasoning/context** (Clarify-style). Then every field-history row can answer "who, when, why, from what source".

### Gaps
- I found no documentation of a consistent "sparkle" icon convention, or of HubSpot/Salesforce labels on AI-written property history entries ("Updated by Breeze"). I could not verify how HubSpot field history attributes Data Agent writes.
- Gong's docs do not say whether evidence quotes or confidence are shown for extracted values.

---

## Q3. What does the human approve vs what runs automatically? (approval queues, accept/dismiss, guardrails, permissions)

### Takeaway
Industry practice has settled on a **risk tier by field and action**:
- **Automatic**: notes and summaries, activity logging, enrichment into dedicated AI fields, exact-match dedup.
- **Suggest-and-approve**: revenue fields (stage, amount, close date, forecast), owner changes, record creation from transcripts.
- **Configurable autonomy for outbound email**: start in review mode, graduate to autonomous.

Several products make autonomy a **per-tool or per-agent setting** (Clarify per tool; HubSpot Prospecting per enrollment). Agents are increasingly **first-class users with roles and permissions** (Zoho Digital Employees; MCP servers acting as the authenticated user).

### Cited Findings
**Suggest-and-approve (human writes the change)**
- HubSpot Closing Agent: "Reps review, edit, approve or reject each CRM update, follow-up email or action item before anything is written". No automatic CRM writes. A Super Admin must opt the account in. — [SpotDev](https://www.spotdev.co.uk/blog/hubspot-breeze-closing-and-data-agents) [3p]
- Pipedrive Nova: "Representatives must review, edit, and approve all suggested changes before they're written". The CPTO said: "What actually helps a rep isn't more automation. It's more confidence." — [LetsDataScience](https://letsdatascience.com/news/pipedrive-launches-nova-ai-assistant-for-crm-updates-52a0540c) [3p]
- Lightfield: suggestions are accepted or rejected one by one, with the source inline. No auto-apply is mentioned. — [Lightfield changelog](https://lightfield.com/blog/suggested-record-updates-support-in-lightfield) [doc]
- Affinity: "the agent never writes directly". Suggestions route to "the person who created the meeting note". Agents only propose changes to fields that user can already edit. Admins turn Ascend on or off org-wide, users toggle "Monitoring" per agent, and monitoring is **off by default**. — [Affinity support](https://support.affinity.co/s/article/Review-and-approve-agent-suggestions) [doc]
- Day.ai's interaction model: "The AI proposes, the interface responds, the human approves or adjusts". Email drafts are refined through conversation before sending. — [Conviction Substack](https://saranormous.substack.com/p/crm-was-built-for-humans-day-was) [3p]

**Configurable autonomy**
- HubSpot Prospecting Agent has two modes: **"review before sending"** (a rep approves each draft) and **"fully autonomous"** (sends without review). The recommended path is to start in review mode for the first 50-100 emails. — [HubSpot product page](https://www.hubspot.com/products/sales/ai-prospecting-agent) [vendor]; [SpotDev guide](https://www.spotdev.co.uk/blog/hubspot-breeze-prospecting-agent) [3p]
- Clarify: agents run "fully autonomously or require your approval before acting". Write-capable tools can be set to **require approval or deny, per tool, per agent**. The founder framed this as the answer to the "confidently-wrong write" concern: the agent pauses and asks instead of "silently shipping" a change. — [Product Hunt](https://www.producthunt.com/p/clarify-6/customer-relationship-agents-by-clarify)
- Practitioner case (Cotera's Ibby Syed, around 2024, **older**): deal-stage automation ran in "suggest mode" for a month with **87% acceptance**, then switched to "auto-mode with notifications". About 4% of changes were corrected afterwards, versus a 30-40% wrong-stage rate under manual upkeep. — [Cotera](https://cotera.co/articles/pipedrive-crm-automation-ai) [3p practitioner]

**Fully automatic writes**
- Gong AI Data Extractor writes mapped CRM fields automatically. "When new or better information is found, the previous value is overwritten". The docs describe no rep approval step ("reps do not need to do anything"). — [Gong help](https://help.gong.io/docs/ai-data-extractor) [doc]
- Fathom auto-logs a summary activity per call. — [Fathom](https://www.fathom.ai/integrations-crm) [vendor-mkt]
- Granola offers either a manual push per meeting (user confirms the suggested record) or a folder-level auto-sync with no per-meeting review. Either way it writes notes only. — [Granola](https://www.granola.ai/blog/connect-granola-attio-complete-integration-guide)
- HubSpot Data Agent writes smart-property values automatically, including on a schedule. — [HubSpot KB](https://knowledge.hubspot.com/properties/create-smart-properties) [doc]
- Attio AI attributes are **manual-trigger only** (per cell, bulk "Recalculate with AI", or per column). Automatic runs require a workflow with AI blocks. — [Attio help](https://attio.com/help/reference/attio-ai/ai-attributes) [doc]

**Agent identity, permissions and guardrails**
- Zoho Digital Employees each have a unique `@ziaagent.ai` user with "its own profile and role, just like a regular user", which shapes "exactly what it can see and do". By default they trigger "whenever a record is assigned to the digital employee", with optional extra criteria or a custom button. Only standalone CRM Enterprise+ plans in US and IN data centers support them. — [Zoho community](https://help.zoho.com/portal/id/community/topic/zia-agents-in-zoho-crm-a-better-way-to-set-up-digital-employees)
- Salesforce:
  - Agents are organized as **topics** (jobs to be done) that limit which **actions** are available.
  - Topic instructions are written as "Always… / Never… / If x, then y…".
  - Trust patterns include **Limit Email Frequency**, an opt-out for recipients, and AI→human handoffs (e.g., "copying a sales manager on AI-generated emails").
  - The SDR agent type has admin-defined engagement rules.
  - The Trust Layer provides data masking, zero data retention, toxicity detection and audit logs.

  — [Trailhead trust patterns](https://trailhead.salesforce.com/content/learn/modules/trusted-agentic-ai/explore-agentforce-guardrails-and-trust-patterns) [doc]
- ZoomInfo's three-tier framework (Oct 2026):
  - **Tier 1 auto**: enrichment, standardization, job-change flags, exact-match dedup.
  - **Tier 2 auto + review queue for edge cases**: lead-to-account matching, scoring, routing, fuzzy dedup. Items are queued on low match confidence, personal email domains, owner conflicts, or score changes on strategic accounts.
  - **Tier 3 human decision**: opportunity creation, stage, close date, amount, closed-won/lost, owner reassignment.
  - Controls: per-agent field write scopes; "never overwrite rep-entered or verified values without higher-confidence replacement"; source stamping; bulk rollback for tier 1 and 2 writes; track override rates monthly and "promote rarely-overridden actions up a tier".

  — [ZoomInfo Pipeline](https://pipeline.zoominfo.com/operations/ai-agents-in-crm) [vendor-authored]
- Kumar's list of what is safe to write directly: call summary, logged meeting activity, topic tags from a fixed list, draft tasks marked as drafts. Approval-only: stage, amount, close date, forecast category, primary competitor, fields that trigger routing or alerts, and qualification fields (authority/need/timeline). — [Pravin Kumar](https://www.pravinkumar.co/blog/should-ai-meeting-notes-write-directly-to-your-crm-2026) [3p]
- HubSpot users ask for limits: a community thread titled "Can you stop Breeze Assistant from making edits in the CRM?" (Jul 14, 2026), with sibling threads "How to set rules and limitations on Breeze Assistant". — [HubSpot Community, Breeze tag](https://community.hubspot.com/tag/breeze/1536) [snippet; thread content not read]

### Inferences
- A sensible CraftBot default matrix:
  - **auto**: create notes and activities, fill agent-owned AI fields, create tasks marked as agent-created;
  - **propose**: any change to a human-entered field, any revenue/stage/owner field, merges, deletes;
  - **configurable per tool**: outbound email.

  Autonomy should be adjustable per operation type (Clarify) and graduate on measured acceptance rate (Cotera, ZoomInfo).
- Suggestions should route to the **owner or creator of the source context** (Affinity) rather than to a global admin queue. They should also be visible in context on the record (Lightfield, HubSpot), not only in a central inbox.
- Making the agent a **named user with a role** (Zoho; MCP "acts as user") gives permissions and audit for free. That is a good fit for an external agent calling an API.

### Gaps
- I could not confirm whether Agentforce SDR has a per-email "review before send" mode or a manager-CC setting. Trailhead pages fetched did not specify it, and the implementation guide PDF was not fetched.
- I could not read the HubSpot community thread's answer about restricting Breeze Assistant edits.

---

## Q4. How do these products expose the CRM to external agents (MCP, agent APIs, Agentforce actions)? Typical operations?

### Takeaway
By 2026, hosted, OAuth-authenticated MCP servers are standard: HubSpot (GA Apr 13, 2026), Salesforce (hosted MCP GA Apr 2026), Attio (mcp.attio.com), Day.ai, and Clarify (listed in Claude's connector directory). They act **with the connecting user's permissions**. Typical operations are search/list/get, create/update/upsert records, add notes, tasks and activities, list membership, semantic search over emails, notes and calls, and simple reporting or read-only SQL. Writes typically require **client-side confirmation**. Rate limits for writes and semantic search are much lower than for reads.

### Cited Findings
- **HubSpot remote MCP server GA (Apr 13, 2026)**:
  - Auth is OAuth 2.1 with PKCE, and "users can only access or modify records they already have permission to view or edit".
  - **Read**: contacts, companies, deals, tickets, line items, quotes, invoices, orders, carts, products, subscriptions, segments; marketing content; and activities (calls, meetings, notes, tasks, emails).
  - **Write**: create and update contacts, companies, deals, tickets, line items and products, plus activities.
  - Activities are blocked if "sensitive data" is on.
  - A `get_user_details` tool reports which objects and tools are available.

  — [HubSpot developer changelog](https://developers.hubspot.com/changelog/remote-hubspot-mcp-server-is-now-generally-available) [doc]
  - tl;dv says writes run through "a blocking confirmation that names the object, the property, the current value and the new value". It also says the tool list isn't fixed: "two accounts returned twenty-one tools each, and not the same twenty-one". — [tl;dv HubSpot MCP](https://tldv.io/blog/hubspot-mcp/) [3p/snippet]. *Conflict:* HubSpot's changelog describes no confirmation mechanism, so the confirmation is likely client-side.
- **Attio hosted MCP** (`mcp.attio.com/mcp`, OAuth, "same permissions as your Attio user account"):
  - Records: `list-objects, search-records, list-records, get-records-by-ids, create-record, upsert-record, update-record, merge-records, list-attribute-definitions`
  - Activities: `list-activities, create-/update-/upsert-activity-record…`
  - Lists: `list-lists, create-list, add-record-to-list, update-list-entry-by-id/by-record-id…`
  - Comments: `create-comment, list-comments, list-comment-replies, delete-comment`
  - Notes: `create-note, search-notes-by-metadata, semantic-search-notes, get-note-body, update-note`
  - Tasks: `list-tasks, create-task, update-task, delete-task`
  - Meetings/calls: `search-meetings, semantic-search-call-recordings, get-call-recording`
  - Emails: `search-emails-by-metadata, semantic-search-emails, get-email-content`
  - Workspace: `list-workspace-members, list-workspace-teams, whoami`
  - Reporting and SQL: `run-basic-report`; `query-particle-sql` (read-only)
  - "Write operations request user confirmation".
  - Rate limits: read 100/s, write 25/s, merge 5/s, search 300/min, semantic search, reporting and SQL 2/s each.

  — [Attio MCP docs](https://docs.attio.com/mcp/overview) [doc]. Reads auto-approve while writes request confirmation. — [Truto](https://www.truto.one/blog/best-mcp-server-for-attio-in-2026) [3p]. About 41 tools in total. — [Reply.io](https://reply.io/blog/attio-mcp/) [snippet]
- **Salesforce**: hosted MCP servers were GA in April 2026 inside Salesforce's perimeter (OAuth 2.0 + PKCE, Enterprise Edition+). Agentforce 3 includes a native MCP *client* for calling external MCP servers. — [Atlan](https://atlan.com/know/ai-agent/mcp-server-for-salesforce/) [3p/snippet]. MCP support was first announced Jun 2025. — [Salesforce Developers blog](https://developer.salesforce.com/blogs/2025/06/introducing-mcp-support-across-salesforce.html) [doc, not fetched]
- **Day.ai** offers "an API, SDK, and MCP server". — [folk on Day AI](https://www.folk.app/articles/day-ai-review) [3p]
- **Clarify** is listed in Claude's connector directory and "passes native agent and MCP". Its agents also *consume* external MCP servers for reads and writes beyond the CRM. — [Breakcold](https://www.breakcold.com/blog/crm-for-ai-agents) [3p/snippet]; [ChatGate](https://chatgate.ai/post/customer-relationship-agents-by-clarify) [3p]
- Community MCP servers for Attio expose similar verbs, e.g. 14 tools including `get_workspace_schema`, `search_/get_/create_/update_company|person`, `manage_person_emails/tags` and `create_note`. — [Glama: Attio Simple MCP](https://glama.ai/mcp/servers/@mlemos/attio-simple-mcp-server/blob/dbb96b8be37643e10360affca265e750718c4020/README.md) [snippet]

### Inferences
- The typical operation set CraftBot will expect:
  - schema discovery (objects and attribute definitions);
  - search (keyword + semantic);
  - get-by-ids;
  - **upsert** (idempotent create-or-update keyed on domain or email, which avoids duplicates);
  - update;
  - merge;
  - list membership;
  - note, task and activity create;
  - comments;
  - whoami / available tools;
  - a basic report or read-only query.
- The two server-side safety features vendors rely on are **acting as the authenticated user** (permission inheritance) and **rate-limiting writes and merges far below reads**. Confirmation is mostly delegated to the MCP client. A CRM built for an external agent should not rely on the client: enforce proposal-vs-direct-write server-side per field or operation.
- Merge as a first-class tool (Attio `merge-records`, 5/s) is notable. It is the riskiest operation an external agent gets.

### Gaps
- I did not fetch Salesforce hosted MCP docs, so the tool list and whether writes can be gated server-side are unverified.
- I found no evidence that any vendor's MCP server natively supports a "propose change" (suggestion) operation as opposed to a direct write. This appears to be an unmet pattern, though absence of evidence is not proof.

---

## Q5. Known failures and user complaints, and design patterns that avoid them

### Takeaway
The main failure modes are:
- **confidently wrong writes to high-stakes fields** (a "we might look at this next quarter" becoming a close date);
- **overwriting human-entered values** (Gong documents overwrite-on-new-info);
- **hallucinated enrichment** when provider data is missing;
- **shallow or "regurgitated" summaries**;
- **lack of control over assistant edits** (HubSpot community);
- **unpredictable credit costs**.

The design countermeasures in shipped products are evidence quotes on suggestions, suggest-mode before auto-mode, write scopes per field, "don't overwrite human values" fill rules, separate AI-owned fields, actor + run attribution, history of suggested vs applied values, and bulk rollback.

### Cited Findings
- **Believable mistakes**: "Models summarize what was said, not what was meant or agreed. A prospect saying 'we might look at this next quarter' can become a close date". Transcripts also misattribute speakers, and automation can erase "carefully entered data". — [Pravin Kumar, Oct 2026](https://www.pravinkumar.co/blog/should-ai-meeting-notes-write-directly-to-your-crm-2026)
- **Overwrite by design**: Gong AI Data Extractor overwrites the previous value when "new or better information is found". The docs specify no protection for manual edits. — [Gong help](https://help.gong.io/docs/ai-data-extractor) [doc]. HubSpot smart property values "cannot be manually overwritten once generated—only removed or regenerated", which is the opposite lock: humans can't correct AI fields in place. — [HubSpot KB](https://knowledge.hubspot.com/properties/create-smart-properties) [doc, as summarized]
- **Hallucinated enrichment**: "when an agent can't resolve a company record, it fills the void with invented data". Recommended mitigation: preserve human overrides or write to a parallel "enriched_*" field. Also, "ten million contacts at 70% accuracy create more damage than five million at 90%". — [Explorium](https://www.explorium.ai/blog/data-for-gtm/ai-agents-traditional-enrichment-failure/) and related vendor content [vendor/snippet]. Clay community threads ask "does Claygent hallucinate if I input too many steps", and practitioners instruct it to return empty instead of guessing. — [Clay community](https://community.clay.com/x/support/amg4sruei9sl/does-claygent-hallucinate-if-i-input-too-many-step) [title only]; [LeadMagic](https://leadmagic.io/guides/clay-data-enrichment-guide)
- **Shallow summaries / over-promise**: Reddit users reportedly say Breeze tools "over-promise and under-deliver", and that Copilot "often just regurgitates basic information from a contact's properties". — [eesel AI Breeze review](https://www.eesel.ai/blog/hubspot-breeze-ai-review) [3p, competitor-authored, second-hand]. HubSpot's record summary "cannot be manually customized". — [HubSpot KB](https://knowledge.hubspot.com/records/summarize-records) [doc]
- **Control over assistant edits**: a HubSpot Community thread asks "Can you stop Breeze Assistant from making edits in the CRM?" (Jul 14, 2026). — [HubSpot Community](https://community.hubspot.com/tag/breeze/1536) [snippet]
- **Silent corruption fear**: a Product Hunt commenter raised the risk of a "confidently-wrong write" corrupting source-of-truth data. Clarify's answer was per-tool approval and a pause to ask. — [Product Hunt](https://www.producthunt.com/p/clarify-6/customer-relationship-agents-by-clarify)
- **Revenue blast radius**: a wrong opportunity stage "can change a rep's comp" and "shift pipeline coverage". — [ZoomInfo](https://pipeline.zoominfo.com/operations/ai-agents-in-crm)
- **Cost unpredictability**: HubSpot smart properties consume credits "even when a value isn't filled". — [HubSpot KB](https://knowledge.hubspot.com/properties/create-smart-properties). By contrast, Attio does not charge when no value is returned. — [Attio help](https://attio.com/help/reference/attio-ai/ai-attributes). Clarify's usage pricing becomes "less predictable than per-seat models if workflows run too broadly". — [ChatGate](https://chatgate.ai/post/customer-relationship-agents-by-clarify)
- **Process risk**: "automating messy ownership can amplify confusion". — [ChatGate](https://chatgate.ai/post/customer-relationship-agents-by-clarify)
- **Privacy and data-scope controls**:
  - HubSpot blocks activity objects via MCP when "sensitive data" is on. — [HubSpot changelog](https://developers.hubspot.com/changelog/remote-hubspot-mcp-server-is-now-generally-available)
  - Summaries and smart properties require explicit toggles for CRM data and "customer conversation data". — [HubSpot KB summaries](https://knowledge.hubspot.com/records/summarize-records); [HubSpot KB smart properties](https://knowledge.hubspot.com/properties/create-smart-properties)
  - Salesforce offers zero data retention and data masking. — [Trailhead](https://trailhead.salesforce.com/content/learn/modules/trusted-agentic-ai/explore-agentforce-guardrails-and-trust-patterns)
  - Affinity excludes provider-enriched fields from agent edits. — [Affinity](https://support.affinity.co/s/article/Review-and-approve-agent-suggestions)
- **Patterns that work** (consolidated, each sourced above):
  - Evidence quote or source inline with the suggestion (Lightfield, HubSpot Closing Agent, Kumar).
  - Current vs proposed with last-updated timestamp and edit-before-apply (Affinity).
  - Immutable history recording suggested vs applied (Affinity).
  - Actor attribution, plus a run with reasoning context (Clarify); agent as a named user (Zoho).
  - Per-tool approval/deny (Clarify).
  - Review-first then autonomous (HubSpot Prospecting; Cotera's suggest-mode → auto-mode).
  - Fill rules: never overwrite rep-entered values without a higher-confidence replacement; per-agent field write scopes; source stamping; bulk rollback (ZoomInfo).
  - Off-by-default monitoring per agent (Affinity).
  - Return-empty-on-no-source (Attio blank cell; Clay prompt convention).
  - Confidence indicator (Attio dot).

### Inferences
- The dominant unresolved tension: **AI-owned fields** (HubSpot smart properties, which humans can't edit) versus **AI-assisted human fields** (Gong overwrites human values). A clean design for CraftBot is a per-field **lock/ownership flag**:
  - `human` (agent may only propose);
  - `agent` (agent writes freely, with provenance);
  - `shared` (agent may fill only if empty or if the source is newer and the human hasn't touched it).

  Combine it with field history that records actor, run id and source, and with one-click revert.
- Track **acceptance and override rate per suggestion type**, and use it both as a trust signal in the UI and as a gate for promoting an action to autonomous.

### Gaps
- Few first-hand user complaints (Reddit/G2) were directly readable. Most complaint evidence is second-hand via competitor blogs or practitioner essays. No quantitative studies of hallucination rates in CRM enrichment were found.
- No documented **undo** feature (as opposed to history) was found in any vendor's agent UI. Bulk rollback appears as a recommendation (ZoomInfo), not as a documented shipped feature.

---

## Q6. Triggers: what events kick off agent work?

### Takeaway
Shipped triggers fall into these families:
- **meeting/call ended** (transcript available);
- **email received or thread gone quiet**;
- **note created**;
- **record created or assigned** (to the agent);
- **enrollment** (rep enrolls contacts into the agent);
- **schedule** (daily/weekly digests, refresh cycles);
- **manual** (button, cell, bulk);
- **"signal"** (funding, job change, intent).

Manual and workflow-triggered remain the default for costly research. Post-meeting is the dominant trigger for suggested updates.

### Cited Findings
- **Meeting/call ended**:
  - HubSpot Smart Deal Progression activates "after every sales call ends—no rep action required". — [Rework](https://resources.rework.com/news/sales-tech/hubspot-spring-2026-smart-deal-progression-aeo-revops)
  - Fathom logs a summary at the end of every call. — [Fathom](https://www.fathom.ai/integrations-crm)
  - Pipedrive Nova proposes updates after calls. — [LetsDataScience](https://letsdatascience.com/news/pipedrive-launches-nova-ai-assistant-for-crm-updates-52a0540c)
- **Note created**: the Affinity Data Update agent proposes changes "within ~1 minute of note creation". — [Affinity](https://support.affinity.co/s/article/Review-and-approve-agent-suggestions)
- **New conversation on an active deal**: Gong recalculates when a new relevant conversation occurs, for accounts or deals with a call in the last month or an inbound email. — [Gong help](https://help.gong.io/docs/ai-data-extractor)
- **Email activity**: Lightfield summary fields update automatically "when new email activity occurs". — [Lightfield changelog](https://lightfield.com/blog/suggested-record-updates-support-in-lightfield)
- **Inactivity / stale thread**: folk's Follow-up Assistant fires when a conversation "has gone inactive and there's a pending next step". — [folk](https://folk.app). Lightfield identifies stale deals and drafts revival emails. — [SaaStr](https://www.saastr.com/saastr-ai-app-of-the-week-lightfield-the-ai-native-crm-that-killed-tomes-25-million-users-to-build-something-better/)
- **Record assigned to agent**: Zoho Digital Employees trigger by default "whenever a record is assigned to the digital employee". Other options are extra criteria or a custom button. — [Zoho](https://help.zoho.com/portal/id/community/topic/zia-agents-in-zoho-crm-a-better-way-to-set-up-digital-employees). Agentforce SDR engagement rules define when the agent starts on a lead. — [Trailhead](https://trailhead.salesforce.com/content/learn/modules/trusted-agentic-ai/explore-agentforce-guardrails-and-trust-patterns)
- **Enrollment**: the HubSpot Prospecting Agent runs on contacts a rep enrolls, choosing a review or autonomous mode at enrollment. — [SpotDev guide](https://www.spotdev.co.uk/blog/hubspot-breeze-prospecting-agent)
- **Record created / workflow event**: Attio AI attributes need workflow automations with AI blocks "triggered by events like record creation" to run automatically. — [Attio help](https://attio.com/help/reference/attio-ai/ai-attributes). Attio's research agent examples include lead qualification on signup and recurring checks for funding or leadership changes. — [Attio blog](https://attio.com/blog/introducing-attio-ai-research-agent)
- **Schedule**: HubSpot smart properties offer scheduled auto-fill (daily/weekly/monthly at set times). — [HubSpot KB](https://knowledge.hubspot.com/properties/create-smart-properties). Clarify agents "run on a schedule or a signal", e.g. pipeline digests. — [Product Hunt](https://www.producthunt.com/p/clarify-6/customer-relationship-agents-by-clarify)
- **Manual**: Attio (per cell, bulk, column); HubSpot "Smart fill" and bulk enrich; folk research on a single record or in bulk. — [Attio help](https://attio.com/help/reference/attio-ai/ai-attributes); [HubSpot KB](https://knowledge.hubspot.com/properties/create-smart-properties); [folk](https://folk.app)
- **Delivery channel for results**: HubSpot Closing Agent suggestions arrive by email notification and on the deal index and record. — [SpotDev](https://www.spotdev.co.uk/blog/hubspot-breeze-closing-and-data-agents). A daily Slack or email digest is the practitioner-recommended format. — [Pravin Kumar](https://www.pravinkumar.co/blog/should-ai-meeting-notes-write-directly-to-your-crm-2026)

### Inferences
- For an external agent like CraftBot, the CRM should emit **events or webhooks** for at least these: record created, record assigned to the agent, note/activity created, meeting ended / transcript attached, email received, deal stage changed, record inactive for N days (stale), and a scheduled tick. Each agent run should be logged with its trigger (ZoomInfo: "log trigger, data read, and change made").
- Stage-change-triggered agent work was rarely documented explicitly in sources found. Stale-deal and post-meeting triggers dominate.

### Gaps
- No vendor documentation found that lists "deal stage changed" as a built-in agent trigger, as opposed to a generic workflow trigger. Salesforce and HubSpot workflow engines can do this, but I did not verify agent-specific docs.
- Trigger details for Agentforce SDR engagement rules (lead criteria, timing, frequency caps) were not available in the fetched Trailhead pages.
