# OpenSEO — Requirements

> Part A (what must exist) and Part B (how it is built) for the OpenSEO agent app.
> OpenSEO is by Ben Senescu and Every App, Inc. (https://openseo.so, MIT). This app adopts it unchanged.

## Introduction

### Purpose

Make OpenSEO, the open-source alternative to Semrush and Ahrefs, an Agent App. A person installs it from the marketplace and uses OpenSEO's own UI, and any agent that speaks `a2app` drives all of OpenSEO's capabilities with the framework's guarantees: approval, idempotency, audit and a bounded describe.

### Scope

**In scope:**
- downloading and running the pinned OpenSEO release unchanged, on Windows, macOS and Linux, without Docker or a Cloudflare account;
- the A2App agent surface, one operation per OpenSEO MCP tool;
- two setup operations;
- the data, keys and update lifecycle.

**Not in scope:** any SEO feature of our own, and any change to OpenSEO's code or UI.

### Approval

2026-11-17 — approved by the owner in conversation. The terms:
- adopt OpenSEO, never build our own;
- fork-equivalent packaging with generous credit to OpenSEO;
- plug in the A2App adapter and framework files;
- keep OpenSEO's own MCP endpoint open;
- open decisions resolved for the best user experience. Those are approval on deletions, public sharing and recurring charges; telemetry off by default; no triggers in this version.

## Product Description

### Product Perspective

The app is OpenSEO `v0.1.27`, a TanStack Start app on Cloudflare Workers code. It runs locally under workerd through `vite preview`, in OpenSEO's single-person local mode, with a sidecar (toolkit `blueprint-mcp-sidecar`) in front on the app's port.

- **The person** uses OpenSEO's UI.
- **Agents** use the A2App surface. Each operation calls OpenSEO's MCP tool of the same name, which runs the same services as OpenSEO's UI.
- **MCP clients** may still use OpenSEO's `/mcp` on the same port.

### User Characteristics

- **The person:** a founder, marketer or SEO consultant who wants SEO data without a $100+/month subscription.
- **The agent:** works on that person's behalf, through the `a2app` CLI or a harness plugin.

### Constraints

- OpenSEO's files are never edited. The release is verified by SHA-256 before use.
- On Windows the app folder path must be 100 characters or fewer (deep `node_modules` paths, MAX_PATH).
- First install needs network access: GitHub for the release, npm for dependencies.
- SEO data features need the person's own DataForSEO account.

### Assumptions

- Node 20+ with npm (and so npx) is installed. pnpm is fetched at the version OpenSEO pins.
- One person per install; OpenSEO's multi-user modes are not used.

## Features

### Module: Projects (projects)

- F-PRJ-1: An agent lists projects (`list_projects`) and creates one with a name, domain and market (`create_project`).
- F-PRJ-2: An agent reads and edits a project's shared memory (`get_project_context`, `update_project_context`), and OpenSEO's UI shows the same memory.
- F-PRJ-3: An agent drafts and saves a project's website setup (`research_project_website`, `save_project_website_setup`).
- F-PRJ-4: `whoami` reports the account and local mode.

### Module: Keywords (keywords, serp, domains)

- F-KW-1: An agent researches keywords for 1–5 seeds (`research_keywords`), given as plain strings or JSON.
- F-KW-2: An agent saves, lists and removes saved keywords. Removing needs the person's approval.
- F-KW-3: An agent reads keyword metrics, live SERPs, ranked keywords, SERP competitors, domain overviews and backlinks through the operations of the same names.
- F-KW-4: An agent finds a market's `locationCode` and `languageCode` with `list_countries`. It reads OpenSEO's own market list and needs no key.
- F-KW-6: Every OpenSEO operation answers `{text, ids?, url?, truncated?}` by default, or all of the text (`--view full`), or OpenSEO's structured JSON (`--view data`).
- F-KW-5: Without a DataForSEO key, a research operation answers `key_missing` (409) with the one next step: ask the person for the DataForSEO login and run `app.set_keys`. It never answers an "ok" result in which every item failed.

### Module: AI visibility (ai-setup, ai-results)

- F-AI-1: An agent sets up AI visibility tracking. `save_ai_visibility_tracker` and `set_ai_visibility_schedule` need the person's approval.
- F-AI-2: An agent estimates costs, runs a one-off check within a cost cap, and reads results, answers, sources and trends.

### Module: Rank tracking (ranks)

- F-RNK-1: An agent creates a rank tracker (with the person's approval), adds and pins keywords, estimates and runs checks within a credit cap, and reads positions and history.
- F-RNK-2: Scheduled rank checks and AI visibility runs fire on their schedules while the app runs, via OpenSEO's own scheduler loop.

### Module: Local SEO (local)

- F-LOC-1: An agent searches local businesses, reads Maps/Local Finder results, business profiles, reviews, questions and posts, and maps a local rank grid.

### Module: Google (search-console, analytics)

- F-GGL-1: Once Google is connected in OpenSEO's UI, an agent reads Search Console performance, inspects URLs, submits IndexNow URLs and reads every GA4 report OpenSEO offers.
- F-GGL-2: With no Google OAuth client set for the install, every Search Console and GA4 operation answers `not_configured` (409) with the setup steps and this install's redirect URIs. IndexNow is not affected.
- F-GGL-3: Reports and other records an agent creates are attributed in OpenSEO to "AI agent via Agent App" (or "<agent name> via Agent App" when the credential names one), never to a runtime's default label.

### Module: Audits (audits)

- F-AUD-1: An agent starts a site audit, polls its status, and reads its issues (each with how to fix it), pages and Lighthouse results.
- F-AUD-2: Deleting an audit needs the person's approval.

### Module: Reports (reports)

- F-REP-1: An agent saves, lists, reads and deletes HTML reports and templates. Deletions and public sharing need approval.

### Module: App (app)

- F-APP-1: `app.guide` returns one compact overview: credit, what is set up now (with the next step for a missing key), first steps, results/money/approval/error rules, and the list of OpenSEO's playbooks. `--topic <name>` returns that OpenSEO skill word for word, with the module of every tool it names.
- F-SET-1: `app.status` reports:
  - OpenSEO's version, release, authors, website and licence;
  - its health checks and which keys are set (never their values);
  - the settings file;
  - the Google OAuth redirect URIs;
  - any tool drift.
- F-SET-2: `app.set_keys` stores DataForSEO (login + password, or the base64 key), OpenRouter, Google, Maps and Context keys and the telemetry choice, then restarts OpenSEO and clears the dashboard's refresh back-offs left by keyless attempts, so the new key shows at once. An empty value clears a key.

### Module: Frame (sidecar)

- F-FRM-1: Opening the app's URL shows OpenSEO's own UI, with its in-app assistant's WebSocket working through the sidecar.
- F-FRM-2: `POST /mcp` on the app's port reaches OpenSEO's own MCP server.
- F-FRM-3: The app answers `/api/_a2app` only once OpenSEO is healthy. Stopping the app stops OpenSEO's processes.

## Non-Functional Requirements

- **Boot:** health within 120 s of start. Measured: OpenSEO ready in about 7 s, plus migrations on a new release.
- **Pipeline:** install and build each under 10 minutes. Measured: about 1.5 minutes each.
- **Operations:** overhead under 50 ms on top of OpenSEO's own tool time.
- **Binding:** every listener binds 127.0.0.1.
- **Data:** survives an OpenSEO update (`data/openseo-state`).

## Data Requirements

- **No entities.** OpenSEO's data (projects, keywords, trackers, audits, AI visibility, reports, Google connections) lives in its local D1/KV/R2/Durable Object state at `data/openseo-state`, linked into the release folder.
- **Adapter state:** `data/a2app-state.json` (idempotency, approvals, tasks, audit).
- **Settings and keys:** `data/settings.env`, mode 0600.

## External Interfaces

- **OpenSEO release:** GitHub archive `every-app/open-seo` `v0.1.27` (pinned SHA-256).
- **OpenSEO's own outbound services** (OpenSEO decides when to call them):
  - DataForSEO;
  - OpenRouter (or any OpenAI-compatible server);
  - Google (OAuth, Search Console, GA4, Maps);
  - Context.dev;
  - IndexNow endpoints;
  - the sites the person audits (OpenSEO's robots-aware crawler);
  - PostHog, only if the person turns telemetry on.
- **A2App:** identity, describe, `POST /api/ops/<name>`, tasks/events/context/whoami (adapter-core).
- **MCP:** OpenSEO's streamable HTTP endpoint at `/mcp`.

## Out of Scope

- Any change to OpenSEO's code, UI or behaviour.
- OpenSEO's hosted, password, Cloudflare Access and Every App modes, and multi-person use.
- Public report sharing (OpenSEO offers it only on its hosted service).
- JavaScript-rendered audits without a Context.dev key (no local browser binding).
- App-to-agent triggers. OpenSEO emits no events, and its UI has no place for an "ask your agent" control without changing it.
- Installing through CraftBot's legacy marketplace Add button (format 2 / PocketBase only).

## Quality of Life

- Plain-string lists (`--keywords "a, b"`, `--seeds "x, y"`) are converted to the shapes OpenSEO expects.
- Every operation's `--help` carries OpenSEO's full tool and parameter descriptions, its limits (e.g. "min 10"), and a shape for every JSON parameter.
- Setup problems, OpenSEO's validation and its refusals answer 409 (unknown ids 404) with the recovery in the message, so the CLI never dumps the parameter help.
- Results are bounded: OpenSEO's compact agent text by default (two to three times smaller than its JSON), cut at 12,000 characters with the cut reported. `--view full` / `--view data` give everything, for `--out`.
- One status call says what is missing and how to fix it, including the exact OAuth redirect URIs.
- Keys can be given to the agent instead of editing files.

## System Overview

```
agent ── a2app ──┐                         person ── browser ──┐
                 ▼                                              ▼
   127.0.0.1:<port>   sidecar/serve.mjs (@a2app/adapter-core)
     /api/_a2app*, /api/ops/*  → operation → MCP tools/call → OpenSEO /mcp
     everything else (UI, API, WebSockets, /mcp) → OpenSEO, untouched
                 ▼
   127.0.0.1:<internal>   OpenSEO v0.1.27 (vite preview / workerd, AUTH_MODE=local_noauth)
                          + OpenSEO's selfhost scheduler loop (every 5 min)
                          state → data/openseo-state
```

**Pipeline:**
- **install** (`sidecar/pipeline.mjs install`): verify and unpack the release → `npm ci` the sidecar's vendored deps → `pnpm install --frozen-lockfile` in `upstream/`.
- **build:** OpenSEO's report widgets + `vite build`, skipped when unchanged.
- **start** (`sidecar/serve.mjs`): link the data → D1 migrations when the release has new ones → preview + scheduler → the adapter.

## UI Design

The UI is OpenSEO's own, served unchanged: its design system, layout, screens and states are OpenSEO's (see openseo.so and the upstream repository).

This app adds no screen. It only puts OpenSEO on the app's port, so it behaves identically at every width, with OpenSEO's own responsive layout. While OpenSEO restarts after a key change, a page request answers in plain text that OpenSEO is restarting.

## Quality Conformance

- **Q1 Completeness & IA:** N/A for this package. OpenSEO's information architecture is used as released. Agent completeness: every OpenSEO tool is an operation, and the gate fails on drift.
- **Q2 Design system:** N/A. OpenSEO's own design system, unchanged.
- **Q3 Layout & composition:** N/A. OpenSEO's own layout.
- **Q4 Interaction:** N/A. OpenSEO's own interactions.
- **Q5 State & feedback:** Agent side: OpenSEO's validation messages pass through as `invalid_param`, and its refusals as `upstream_refused`. Long jobs are polled with OpenSEO's own status operations.
- **Q6 Motion:** N/A. OpenSEO's own.
- **Q7 Content:** Operation help is OpenSEO's own tool descriptions. Summaries are plain, 80 characters or fewer, and mark paid calls "(paid)".
- **Q8 Accessibility:** N/A. OpenSEO's own UI.
- **Q9 Responsiveness:** N/A. OpenSEO's own UI.
- **Q10 Performance:** Measured on Windows: install about 51 s, build about 54 s, boot about 7 s, tool calls 24–94 ms through MCP.
- **Q11 Caching & freshness:** The tool list is cached per boot. The release archive is cached per machine, keyed by SHA-256. Builds and migrations are skipped when their inputs are unchanged.
- **Q12 Data integrity:** The data lives outside the release folder. An update unlinks it before removing the old tree. The adapter keeps idempotency on disk across restarts.
- **Q13 API:** A2App 0.1.0 via adapter-core. Every describe level is under 2,000 characters (the largest module, analytics, is about 1,630). OpenSEO's MCP endpoint is passed through.
- **Q14 Architecture:** Spec form 3 (sidecar). Toolkit-owned system files are hash-locked. App-owned OpenSEO hooks, tool map and generator live in `a2app/`. `modificationLock` is on.
- **Q15 Resilience:**
  - A child guard ends OpenSEO's process tree if the sidecar dies.
  - Installs retry on Windows file locks.
  - Prompts never hang the pipeline (no stdin).
  - A 502 page shows while OpenSEO restarts.
- **Q16 Security & privacy:**
  - Every listener binds loopback.
  - Agent writes need the agent token.
  - Deletions, public sharing and recurring charges need approval.
  - Keys sit in a 0600 file and are never echoed.
  - The release is hash-verified.
  - OpenSEO's telemetry is off by default.
  - OpenSEO's own no-login local mode is by its design, for one person on one machine.
- **Q17 Observability:** Structured JSON lines on stdout (boot, http, drift). OpenSEO's own logs pass through. `app.status` reports health and drift.
- **Q18 Version control:** Only the agent layer is versioned here. OpenSEO is pinned by tag and SHA-256, never vendored. `upstream/` and `data/` are git-ignored.

## Conventions and overrides

- Operation names are OpenSEO's MCP tool names, so OpenSEO's own skills apply verbatim.
- `destructive` here means "needs the person's approval". It differs from OpenSEO's `destructiveHint`, which also covers routine saves the skills make constantly.
- Lists accept JSON arrays or comma-separated text; plain strings fill single-field objects.

## Process Flows

1. **First install:** `agent-app install openseo` → `serve --install` (download + verify + unpack → deps → build) → start → `open`.
2. **Setup:**
   1. `app guide` (or `app.status`) reports DataForSEO as "not set".
   2. The person gives the login to the agent.
   3. `app.set_keys` stores it and restarts OpenSEO.
   4. Status shows "set".
3. **Audit:**
   1. `list_projects`, or `create_project`.
   2. `run_site_audit` (maxPages ≥ 10).
   3. `get_audit_status` until completed.
   4. `get_audit_issues`.
   5. Optionally `save_report`.
4. **Paid run:**
   1. `estimate_rank_tracker_cost`.
   2. Tell the person the figure.
   3. `run_rank_tracker --maxCostCredits <cap>`.
   4. `get_rank_tracker`.
5. **Update:**
   1. Edit `upstream.json`.
   2. Run the pipeline install (the data is kept).
   3. `gen-operations.mjs`.
   4. `check.mjs`.
   5. `agent-app validate`.

## Operations Design

`operations.json` is generated by `a2app/gen-operations.mjs` from OpenSEO's live `tools/list` and `a2app/tools.map.json`.
- **Generated from OpenSEO:** parameters, `readOnly` and `idempotent` come from each tool's schema and annotations.
- **From the map:** module, summary and approval.

| Module | Operations |
| --- | --- |
| projects | whoami, list_projects, create_project, research_project_website, save_project_website_setup, get_project_context, update_project_context |
| keywords | list_saved_keywords, remove_saved_keywords*, get_suggested_keywords, research_keywords, save_keywords, get_keyword_metrics |
| serp | list_countries (sidecar), get_serp_results, search_serp_locations, get_ranked_keywords, find_serp_competitors |
| domains | get_domain_overview, get_domain_keyword_suggestions, get_backlinks_overview, get_backlinks_profile |
| ai-setup | get_ai_visibility_tracker, explore_prompt, generate_ai_visibility_prompts, research_ai_visibility_prompts, complete_ai_research_setup, save_ai_visibility_tracker*, estimate_ai_visibility_cost, set_ai_visibility_schedule* |
| ai-results | run_ai_visibility_check, get_ai_visibility_run, get_ai_visibility_results, get_ai_visibility_answer, get_ai_visibility_sources, get_ai_visibility_trend, export_ai_visibility_data |
| ranks | create_rank_tracker*, get_rank_tracker, get_rank_history, add_rank_tracking_keywords, remove_rank_tracking_keywords*, pin_rank_tracking_keywords, estimate_rank_tracker_cost, run_rank_tracker |
| local | search_local_businesses, get_local_serp_results, get_google_business_questions, get_business_profile, get_business_reviews, get_business_updates, list_business_categories, get_local_rank_grid |
| search-console | list_search_console_sites, set_search_console_site, get_search_console_performance, inspect_urls, submit_indexnow_urls |
| analytics | list_google_analytics_properties, set_google_analytics_property, get_google_analytics_organic_overview, get_google_analytics_organic_landing_pages, get_google_analytics_page_performance, get_google_analytics_key_events, get_google_analytics_traffic_acquisition, get_google_analytics_audience_breakdown, get_google_analytics_ecommerce_performance, get_google_analytics_site_search, get_google_analytics_measurement_health, get_search_opportunities |
| audits | run_site_audit, list_site_audits, delete_site_audit*, get_audit_status, get_audit_issues, get_audit_pages, get_audit_lighthouse |
| reports | save_report, list_reports, get_report, set_report_sharing*, delete_report*, list_report_templates, save_report_template, delete_report_template* |
| app | app.guide, app.status, app.set_keys (all sidecar) |

`*` marks an operation that needs the person's approval (`destructive: true`).
