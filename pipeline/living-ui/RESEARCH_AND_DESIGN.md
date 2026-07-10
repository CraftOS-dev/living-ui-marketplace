# Research & Design — generating the spec without a human

This document replaces the human interview of [LIVING_UI_GUIDE.md](LIVING_UI_GUIDE.md) Phase 0. It has two parts, run back-to-back from [CREATION_PIPELINE.md](CREATION_PIPELINE.md):

- **Part A — Research** (stage C2): parallel research subagents → a full requirements spec, `runs/<run_id>/SPEC.md`.
- **Part B — Design reference** (stage C3): pick 1–2 state-of-the-art reference products, capture their UX with Playwright → `runs/<run_id>/DESIGN_SPEC.md`.

The human wrote 1–10 sentences; these two parts turn that into something a stranger could build from. This is the most important gap the pipeline closes — do not rush it.

---

## 0. Hard rules

1. **Every SPEC claim must trace to a source**: the request body, a human-pinned reference, a research file in `runs/<run_id>/research/`, or a named Safe Assumption from [QUESTIONNAIRE.md](../../skills/living-ui-creator/references/QUESTIONNAIRE.md). Untraceable claims get cut. This is what keeps generated specs from being confident fiction.
2. **The request text beats research consensus.** If the human asked for something unusual, research context informs *how*, never *whether*.
3. **Scope caps are absolute: ≤6 entities, ≤8 Must features**, buildable in a single session. Research always finds more worth building — overflow goes to `Won't (v1)` with a one-line note, not into scope.
4. **References inform structure, never identity** (README hard rule 7). No copied logos, product names, marketing copy, colors, or fonts. Screenshots dictate where things go and how they behave — never how they look.
5. **Subagent budget: 4 parallel + at most 1 follow-up.** Research must converge, not sprawl.
6. **No feature may require credentials or external services** unless the request's `## Constraints` explicitly says so. (CraftBot's integration bridge exists, but silent external dependencies break the "install and it works" marketplace promise.)

---

## 1. Part A — Research → SPEC.md

### A1 — Decompose the request

From the queue file, extract and write to the top of a draft SPEC.md:

- **Category** — "this is a CRM / habit tracker / invoicing tool / …". Named explicitly; it steers all four subagents.
- **Explicit constraints** — everything in `## Constraints`, verbatim.
- **Pinned references** — everything in `## References`. Pinned items outrank all research findings (rule 2) and are automatic design-reference candidates in Part B.
- **Vague phrases** — list every underspecified phrase ("basic user stuff", "simple dashboard", "make it look good") for expansion in A4.

### A2 — Spawn 4 research subagents in parallel

One message, four Task/Agent calls, web-search-capable agents. Each prompt must be **self-contained** (subagents see nothing of this conversation): include the category, the requirement text, the constraints, and the exact output file path.

**Report plumbing (token-budget rule — research depth is untouchable, its transit is not):** each subagent **writes its full report itself** to `runs/<run_id>/research/<file>.md` using its Write tool, and returns to the runner only (a) a ≤150-word executive summary and (b) a bullet list of build-critical findings. The runner merges from the summaries and greps/reads specific report *sections* only when a SPEC decision genuinely needs the detail. Run 1 paid for every report three times — generated in the subagent, transited into the runner's context in full, then re-transcribed into the research file by the runner — for identical research quality.

Prompt skeletons in [§3.1](#31-research-subagent-prompts). The four lanes:

| # | Lane | Output | Digs up |
|---|---|---|---|
| 1 | Feature landscape | `research/features.md` | "What makes a great `<category>` app in `<year>`" — table-stakes vs differentiators, each backed by ≥3 independent sources; prioritized list with one-line justifications |
| 2 | Competitor / SOTA scan | `research/competitors.md` | Top 3–5 products: positioning, standout features, which features sit in free vs paid tiers (the free tier reveals what's considered *core*); **nominates 2–3 design-reference candidates with public, viewable URLs** (live demos, marketing screenshots, docs) — this feeds Part B |
| 3 | UX & workflow patterns | `research/ux-patterns.md` | Canonical layouts for the category (list/board/split-pane/calendar), navigation models, information hierarchy, signature interactions (inline edit, drag, bulk actions), empty-state and onboarding conventions |
| 4 | Data model & domain rules | `research/data-model.md` | Standard entities, fields, relationships, lifecycle/status enums (e.g. CRM pipeline stages), computed values, common validations |

### A3 — Merge findings

Combine the four files into one candidate feature/entity set, resolving conflicts by precedence:

```
request body  >  pinned references  >  research consensus (≥2 lanes agree)
              >  single-lane finding  >  Safe Assumption
```

Then apply the scope caps (rule 3): rank Must candidates by (a) core to the category per lane 1, (b) needed by another Must, (c) effort. Cut from the bottom into `Should` / `Won't (v1)`.

Allowed once: if merging exposes a real gap (e.g. lanes disagree on the core entity model), send **one** follow-up subagent with a narrow question. Log it.

### A4 — Questionnaire self-interview

Open [QUESTIONNAIRE.md](../../skills/living-ui-creator/references/QUESTIONNAIRE.md) and answer **all 6 categories in writing** (Design & Visual Identity, Data & Entities, Features & Functionality, Layout & Navigation, UX & Polish, Users & Access) as if interviewing yourself on the human's behalf:

- Every vague phrase from A1 gets expanded via the questionnaire's **"Expanding Vague Answers" mappings** — the expansion is recorded, not just applied.
- Every gap the research didn't cover gets a **Safe Assumption** from the questionnaire's list — recorded in the assumptions register with `source: safe-assumption`.
- Answers must be concrete choices ("kanban columns with a modal detail view"), never "TBD" or "either works".

This step preserves the rigor of the guide's mandatory 2-batch interview; the questionnaire is the interviewer, research is the interviewee.

### A5 — Write SPEC.md

Use the template in [§3.2](#32-specmd-template) verbatim. Notes on the sections that bite later:

- **Entities**: every enum-like field's values enumerated explicitly — they become `Literal[...]` in Pydantic per the guide's smoke-test schema contract. Date/email/URL fields flagged for `format` hints. Never a field named `metadata`.
- **Must features**: each gets 2–4 acceptance criteria phrased as *testable assertions* ("creating a deal with no stage defaults it to 'lead'"). These drive the Phase 2–7 tests and the G7 adversarial review — vague criteria now means unverifiable QA later.
- **Assumptions register**: one row per assumption with source and "risk if wrong". This section is surfaced verbatim to the human in the review request — it is the human's chance to catch a wrong guess cheaply.

### A6 — Spec quality gate

Self-review against this rubric. **All boxes required** before setting `status: SPEC_READY`:

- [ ] All 6 questionnaire categories answered; zero "TBD"/"either"/"maybe".
- [ ] 4–8 Must features, each with 2–4 testable acceptance criteria.
- [ ] Scope caps respected (≤6 entities, ≤8 Musts); overflow visible under `Won't (v1)`.
- [ ] Every entity: fields + types + relations; every enum's values enumerated.
- [ ] Every vague phrase from A1 has a recorded expansion in the register.
- [ ] No feature requires credentials/external services absent from `## Constraints`.
- [ ] Spot-check 5 random spec claims — each traces to request/reference/research file/named assumption.
- [ ] The stranger test: someone with only SPEC.md and the guide could build this app without asking a question.

Fail → revise (targeted follow-up research allowed once, per A3) → re-check. **Max 2 revision loops**; still failing → BLOCKED per README §8 with the rubric results pasted into the escalation.

---

## 2. Part B — Design reference → DESIGN_SPEC.md

### B1 — Pick 1–2 reference products

From SPEC.md's Design direction candidates (lane 2 output), in priority order:

1. **Human-pinned reference** — always chosen if present.
2. **Category leader with publicly viewable UI** — live demo, sandbox, or rich marketing/docs screenshots.
3. **Most-imitated UX** — a product whose patterns are the category's conventions (conventional beats idiosyncratic: users already know it, and preset components map onto it cleanly).

Record the choice and one-paragraph rationale in DESIGN_SPEC §1. Two references max; the second only if it covers a screen type the first lacks.

### B2 — Playwright capture

Using the browser tooling (same requirements as [QA_GATES.md §2.2](QA_GATES.md)):

1. Navigate to each reference's demo / marketing / screenshot pages.
2. Capture **viewport-sized** PNGs at **1280×800** (desktop) and **390×844** (mobile) — **never `fullPage: true`** (run 1 captured a 390×10,229px page; as an image read that is enormously expensive for no design value).
3. Save as `runs/<run_id>/reference-shots/<product>-<screen>-<width>.png`.
4. Target **≤6 shots per reference**: the main list/dashboard view, a detail view, a create/edit flow. Skip pricing/login/blog pages.

**Image-read budget:** the shots are run artifacts for traceability — the runner reads **at most one** (a desktop shot of the pinned/primary reference) into context, and only when the textual `ux-patterns.md` research leaves a genuine layout question. DESIGN_SPEC is written primarily from the text research.

**Fallback ladder** when the product hides its UI behind a login, top to bottom until something works:

1. Marketing-site screenshot sections (most SaaS homepages show the product).
2. Official docs / help-center articles (walkthroughs are full of UI screenshots).
3. Official press/media kits.
4. A web image search for `<product> app screenshot` — capture the results page itself as a low-fidelity mosaic.
5. Nothing capturable → write DESIGN_SPEC from the textual descriptions in `research/ux-patterns.md` and record "no visual reference" in §1. **This is not a blocker** — a text-derived design spec is acceptable; an unspecified design is not.

### B3 — Write DESIGN_SPEC.md

Use the template in [§3.3](#33-design_specmd-template) verbatim. The two sections that do the most work:

- **Per-screen layout**: a small ASCII wireframe per screen plus its information hierarchy (what the eye hits first/second/third). Wireframes are the contract Phase 2–7 Step D builds against and G7 reviews against.
- **Component mapping table**: every observed UI pattern mapped to a preset component from [COMPONENTS.md](../../skills/living-ui-creator/references/COMPONENTS.md). A pattern with no preset match is either flagged "compose from Card/primitives" or dropped — the presets are mandatory (guide: never raw HTML elements, never custom CSS for standard elements).

### B4 — Design gate

> **HARD RULE (repeat of §0.4, because this is where it gets violated):**
> Visual identity = CraftBot only. Colors, fonts, spacing, radii, and shadows come from [GLOBAL_LIVING_UI.md](../../agent_file_system/GLOBAL_LIVING_UI.md) + the `global.css` design tokens + preset components — **never from the screenshots**. Screenshots dictate *where things go and how they behave*, never *how they look*. No copied logos, product names, or copy text.

Checklist — all boxes before proceeding to the build stage:

- [ ] Every SPEC Must feature appears on at least one screen in the screen inventory.
- [ ] Every screen has a wireframe and a stated responsive behavior (what collapses/stacks at 360 px and 768 px).
- [ ] Every observed pattern is mapped to a preset component, flagged for composition, or dropped.
- [ ] Zero hex colors, font names, or visual-identity descriptions anywhere in DESIGN_SPEC.md.
- [ ] Shot inventory table lists every file in `reference-shots/` (or §1 records the no-visual-reference fallback).

Fail → fix the spec (not the checklist) → re-check. This gate is cheap; run it honestly.

---

## 3. Templates

### 3.1 Research subagent prompts

Common preamble for all four (fill the angle brackets; keep prompts self-contained):

```
You are a research subagent. Research the topic below using web search.
Ground every claim in a named source (publication/vendor/URL). Be concrete
and selective — a prioritized shortlist with justifications beats an
exhaustive dump.

WRITE your full report as a markdown document to this file using your Write
tool: <absolute path to runs/<run_id>/research/<file>.md>

Then RETURN as your final message only:
1. An executive summary (150 words max).
2. "Build-critical findings:" — a bullet list of the specific facts the app's
   spec/design/build must act on (conventions, constraints, pitfalls).
Do NOT return the full report in your message — it lives in the file.

Product category: <category>
The app being built (verbatim requirement): "<requirement text>"
Constraints: <constraints, or "none stated">
```

Lane-specific tasks appended to the preamble:

**Lane 1 — features.md**
```
Task: What makes a great <category> app in <year>?
1. Table-stakes features — what every credible product has (≥3 sources each).
2. Differentiator features — what the best products add on top.
3. A single prioritized feature list (max ~15) with a one-line justification
   and source per feature.
4. Anti-features: things products in this category regret or users complain about.
```

**Lane 2 — competitors.md**
```
Task: Survey the top 3–5 <category> products (SOTA).
Per product: name, positioning, 3–5 standout features, which features are
free-tier vs paid (free tier ≈ what the market considers core).
Then: nominate 2–3 DESIGN REFERENCE candidates — products whose UI is publicly
viewable — with direct URLs to a live demo, marketing screenshots, or
screenshot-rich docs pages. Prefer products whose UX is widely imitated.
```

**Lane 3 — ux-patterns.md**
```
Task: Document the canonical UX of <category> apps.
1. Dominant layout(s): list / board / split-pane / calendar / dashboard — and when each is used.
2. Navigation model: sidebar, top tabs, breadcrumbs; typical screen inventory.
3. Information hierarchy on the main screen: what users see first/second/third.
4. Signature interactions: inline edit, drag-and-drop, bulk actions, keyboard use.
5. Empty-state and onboarding conventions.
Describe patterns in words precise enough to wireframe from.
```

**Lane 4 — data-model.md**
```
Task: Document the standard domain model of <category> apps.
1. Core entities and their typical fields (with types).
2. Relationships between entities.
3. Lifecycle/status enums and their exact typical values (e.g. deal stages).
4. Computed/derived values products commonly show.
5. Common validations and domain rules.
```

### 3.2 SPEC.md template

```markdown
# SPEC — <App Name> (<slug>)

- Run: <run_id>   Date: <YYYY-MM-DD>
- Source request: queue/<file>   Category: <category>

## 1. Summary
<Elevator pitch. Target user. The 2–3 jobs-to-be-done this app serves.>

## 2. Scope
**In (v1):** <one line per Must/Should feature>
**Out (explicit non-goals):** <from Constraints + deferred items>
**Won't (v1):** <research-suggested features cut by scope caps, one-line note each>

## 3. Entities & data model
| Entity | Fields (name: type) | Relations | Notes |
|---|---|---|---|
<Enum fields list every value explicitly (→ Literal[...]). Flag date/email/URL
fields for format hints. Max 6 entities.>

## 4. Features (MoSCoW)
### Must
#### M1 — <feature name>
<one-paragraph description>
Acceptance criteria:
- [ ] <testable assertion>
- [ ] <testable assertion>
<repeat per Must, max 8>
### Should
<name + one line each — built only if all Musts are done>
### Won't (v1)
<mirror of §2>

## 5. Questionnaire answers
<All 6 QUESTIONNAIRE.md categories, concrete answers, no TBDs.>

## 6. Assumptions register
| # | Assumption | Source (request / reference / research:<file> / safe-assumption) | Risk if wrong |
|---|---|---|---|

## 7. Design direction (handoff to Part B)
<2–3 reference candidates from research/competitors.md + why; pinned human
references listed first.>

## 8. Build notes
<Auth needed? (→ auth module) Integrations? (→ INTEGRATIONS.md, only if
Constraints allow) Anything else that changes the guide's default path.>
```

### 3.3 DESIGN_SPEC.md template

```markdown
# DESIGN SPEC — <App Name> (<slug>)

- Run: <run_id>   Date: <YYYY-MM-DD>
- References: <product(s)> — <chosen because …>   (or "no visual reference — text-derived")

## 1. References & shot inventory
| File (reference-shots/) | Product | Screen | Width | What it informs |
|---|---|---|---|---|

## 2. Navigation model & screen inventory
<Sidebar / topbar / tabs. Then one row per screen: name, purpose, route.>

## 3. Layout per screen
### <Screen name>
Information hierarchy: <first / second / third>
```
+----------------------------------------------+
| <ASCII wireframe>                            |
+----------------------------------------------+
```
Responsive: <what collapses/stacks at 768 px and 360 px>
<repeat per screen>

## 4. Interaction patterns
<Detail view: modal vs side panel vs inline. Drag-and-drop. Bulk actions.
Keyboard affordances. Per SPEC Musts + GLOBAL_LIVING_UI enabled rules.>

## 5. Empty / loading / error conventions
<Per list view: what the empty state says and offers. Loading pattern. Error surfacing.>

## 6. Component mapping
| Observed pattern | Preset component (COMPONENTS.md) | Notes |
|---|---|---|
<unmapped patterns: "compose from Card/primitives" or "dropped — <why>">

## 7. Non-goals of the reference pass
<What was deliberately NOT copied from the references, and why.>
```
