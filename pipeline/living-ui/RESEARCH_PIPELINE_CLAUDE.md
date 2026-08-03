# Research Pipeline — Claude Code variant

This is an alternative to [RESEARCH_PIPELINE.md](RESEARCH_PIPELINE.md) for when a **Claude Code session** does the research instead of CraftBot — e.g. because you don't want to route through CraftBot at all, or you find Claude Code's research more reliable. It exists because RESEARCH_PIPELINE.md is deliberately over-specified for a weak model (mechanical shell-one-liner gates, verbatim templates, numeric floors) — none of which a capable model needs. This doc gets you the same result with normal judgment, the way [CREATION_PIPELINE.md](CREATION_PIPELINE.md)'s own C2 spec review already works.

**The output contract is identical either way**: `SPEC.md`, `DESIGN_SPEC.md`, `research/*.md`, `reference-shots/` (or `capture-fallback.md`), ending in a last-logged `HANDOFF` status in `ITERATION_LOG.md`. CREATION_PIPELINE.md's C2 validates the bundle the same way regardless of which doc produced it — pick whichever research doc you're running per-request, the rest of the pipeline doesn't care.

Read [README.md](README.md) (especially §1, the platform contract) and [LESSONS.md](LESSONS.md) first — this doc assumes both. Stages: **R1** start → **R2** decompose → **R3** research subagents → **R4** merge & self-interview → **R5** SPEC.md → **R6** reference capture → **R7** DESIGN_SPEC.md → **R8** handoff.

---

## 0. Hard rules

1. **Every SPEC claim traces to a source**: the request body, a pinned reference, a `research/*.md` file, or a named Safe Assumption ([RESEARCH_PIPELINE.md](RESEARCH_PIPELINE.md) §5.6).
2. **The request text beats research consensus.** Research informs *how*, never *whether*.
3. **Scope caps: ≤6 collections, ≤8 Must features.** Overflow → `Won't (v1)` with a one-line note.
4. **References inform structure, never identity** (README rule 7) — layout and behavior from screenshots, never colors/fonts/logos.
5. **Subagent budget: 4 parallel + at most 1 follow-up.**
6. **Everything you spec must be buildable on the V2 platform** (README §1). The short version, because it kills more specs than anything else: one PocketBase process, data in **collections** with PB field types, no localStorage-only persistence, no inbound webhooks or callback URLs, no OAuth/tokens/API-key entry (connected services are reached through CraftBot's zero-key bridge; external data is *pulled* on load/refresh plus a scheduled sync op), realtime only for the app's own records, no feature that hinges on a browser permission prompt, and a fixed component kit the builder cannot extend or restyle.
7. **You own start → entry into `HANDOFF` only.** Never advance a run whose ITERATION_LOG already shows a creation-owned status (README §3.1 Owner column).
8. **No thin tabs, exhaustive filters, full-depth bonus features.** Don't give a screen its own tab if it'd render with only a line or two of content — fold it in or add depth. Filters should draw on every plausible facet in the data model (tags, flags, derived groupings), not just the 2–4 most obvious fields. Any feature added beyond the human's core ask (e.g. a team builder bolted onto a Pokedex clone) needs acceptance criteria as complete as a Must's, or it should be cut to `Won't (v1)`.
9. **Every collection states an ingress** — user form, bridge pull (+ scheduled sync), file import, or computed. An app built to display external data with no specified ingress is unbuildable.

---

## 1. Stage R1 — Start & setup

There's no queue to claim from — the human pastes a filled-in [NEW_APP_PROMPT.md](NEW_APP_PROMPT.md) block directly, and that message is the request. First, check `runs/` for an in-flight run (ITERATION_LOG last status `RESEARCHING`/`SPEC_READY`) and resume it instead if one exists. Otherwise: compute `run_id: <slug>-<YYYYMMDD>`; create `runs/<run_id>/{research,reference-shots}`; write the ITERATION_LOG header capturing `app_name`/`slug`/`tags`/`auth_mode`/the requirement text verbatim (this is the only copy of the request that persists) with status `RESEARCHING`; read [GLOBAL_LIVING_UI.md](../../../GLOBAL_LIVING_UI.md) for the palette and enabled rules.

**Preflight the handoff toolchain now** — a broken handoff should fail at minute 1, not hour 6: `node --version` (≥ 24) and, if you plan to auto-launch, `where claude` / `which claude`.

**Decide the handoff mode now** (affects R8 only): will you auto-launch a fresh creation session in the background when research finishes, or end the turn and let the human paste the Creation kickoff themselves?

**Exit:** started, run folder exists, log started.

---

## 2. Stage R2 — Decompose the request

From the ITERATION_LOG header, write `runs/<run_id>/research/decomposition.md`: the product category, any hard constraints you can pull out of the requirement text (auth needs, named connected services, explicit non-goals), any products/apps it mentions liking, and every vague phrase worth expanding later (e.g. "basic user stuff", "make it look good").

---

## 3. Stage R3 — Research subagents (parallel)

Spawn **4 subagents in one batch** (the `Agent` tool, `general-purpose` or `Explore`), one per lane. Each prompt must be fully self-contained (category, verbatim requirement, constraints) and instruct the subagent to **write its own report** to `runs/<run_id>/research/<lane>.md` via its own Write tool, returning only a short summary — this keeps full research depth out of your context while still landing on disk for the SPEC and for the creation runner to consult later.

| Lane | File | Digs up |
|---|---|---|
| Feature landscape | `features.md` | Table-stakes vs. differentiator features, each with a source; anti-features (what the category regrets) |
| Competitor / SOTA scan | `competitors.md` | Top 3–5 products, free vs. paid feature split; nominates 2–3 design-reference candidates with public, viewable URLs |
| UX & workflow patterns | `ux-patterns.md` | Canonical layouts, navigation model, signature interactions (incl. touch/mobile equivalents), empty-state conventions |
| Data model & domain rules | `data-model.md` | Standard entities/fields/relations, how "unassigned/not-yet-placed" items are modeled if the category has that concept, lifecycle enums, validations, and where the data typically comes from (manual entry / import / sync) |

If a lane comes back thin or contradicts another, one follow-up subagent is allowed — use your judgment on whether it's worth it rather than a hard retry count.

---

## 4. Stage R4 — Merge & questionnaire self-interview

Merge the four files into one candidate feature/collection set. Resolve conflicts by precedence: `request body > pinned references > research consensus (2+ lanes) > single-lane finding > Safe Assumption`. Apply the scope caps, cutting overflow into `Should`/`Won't (v1)`.

**Run every candidate through the platform filter (hard rule 6) here, not in the SPEC** — anything needing a third-party login, an API key, an inbound webhook, or a browser permission is either re-expressed as a bridge pull + scheduled sync, or cut. Doing this now changes which features survive the scope caps.

Answer all 6 questionnaire categories in writing to `runs/<run_id>/research/questionnaire.md` — Design & Visual Identity, Data & Collections, Features & Functionality, Layout & Navigation, UX & Polish, Users & Access (template: [RESEARCH_PIPELINE.md](RESEARCH_PIPELINE.md) §5.5). Concrete choices, no "TBD"/"either works". Every vague phrase from R2 gets an explicit expansion; every uncovered gap gets a Safe Assumption, recorded with `source: safe-assumption`.

---

## 5. Stage R5 — Write SPEC.md

Use the template in §7.1. The parts worth real attention, since they're what the creation runner and QA gates lean on hardest:

- **Acceptance criteria** name a user action and an observable result, cover edge cases, and at least a few per feature-set verify persistence across reload. ("No blank canvas state" is not a criterion; "a new list opens with 5 tiers labeled S/A/B/C/D, all empty" is.)
- **Collections**: PocketBase field types only (`text`, `editor`, `number`, `bool`, `date`, `select`, `relation`, `file`, `json`); every `select` field's values enumerated; the "unplaced/pool" mechanic is an empty optional `relation`, not a second collection; never a field named `metadata`; rules stated against the run's auth mode; **an ingress per collection**.
- **Assumptions register**: source + a concrete fallback (what changes if the assumption is wrong), not just a restated risk.
- **Build notes (§8)**: the auth mode verbatim, the custom operations worth declaring and which are destructive, any bridge usage plus its scheduled sync cadence.

**Quality bar before setting `status: SPEC_READY`** (judgment call, not a script):
- [ ] All 6 questionnaire categories answered concretely.
- [ ] 4–8 Musts, each with testable acceptance criteria.
- [ ] Scope caps respected; overflow visible under `Won't (v1)`.
- [ ] Every collection fully typed, every `select` enumerated, every ingress stated.
- [ ] Nothing in the spec would require a webhook, a credential, a browser permission, or a change to a platform-owned file.
- [ ] Spot-check a handful of claims — each traces to request/reference/research file/named assumption.
- [ ] The stranger test: someone with only this SPEC could build the app without asking a question.

Not there yet → revise. If you're stuck (the request itself is ambiguous in a way research can't resolve, or its core feature has no legal platform equivalent), BLOCKED per README §8 beats guessing.

---

## 6. Stage R6 — Reference capture

Pick 1–2 references (pinned human reference first, then category leader, then most-imitated UX). Capture with Playwright (MCP tools if configured, else a throwaway script — Playwright resolution and the `waitUntil: 'load'` rule are covered in [QA_GATES.md](QA_GATES.md) §2.1/§2.2) at **1280×800** and **390×844**, viewport only, never full-page, ≤6 shots per reference, saved to `runs/<run_id>/reference-shots/`.

If a reference blocks capture (login wall, bot-blocker), work down: marketing site → docs/help-center screenshots → an alternative competitor with a public UI → a captioned image-search mosaic → give up and write DESIGN_SPEC from `ux-patterns.md` text alone, noting "no visual reference" in DESIGN_SPEC §1 (record what you tried in `research/capture-fallback.md`). Not having screenshots is fine; not trying is not — a prior CraftBot run skipped the attempt entirely and got rejected for it.

---

## 7. Stage R7 — Write DESIGN_SPEC.md

Use the template in §7.2. **Identity rule**: colors, fonts, spacing, radii, shadows come only from the kit's design tokens plus GLOBAL_LIVING_UI.md's palette — screenshots dictate layout and behavior, never appearance. Zero hex colors or font names in this file (user-data colors, e.g. tier-row colors, belong in SPEC §3, not here).

**Quality bar:**
- [ ] Every SPEC Must appears on a screen in the inventory.
- [ ] Every screen has a wireframe and stated responsive behavior (768px, 360px).
- [ ] Every observed pattern maps to a component that actually exists in the kit ([RESEARCH_PIPELINE.md](RESEARCH_PIPELINE.md) §5.7 lists them — `EntityForm`/`EntityTable` cover most CRUD surfaces), is flagged for composition from `Card` + primitives, or is explicitly dropped. Don't invent component names.
- [ ] No visual-identity leakage from the references.

---

## 8. Stage R8 — Handoff

1. Confirm the bundle is complete: `SPEC.md`, `DESIGN_SPEC.md`, `research/decomposition.md` + the 4 lane files + `questionnaire.md`, and either 4+ shots or `capture-fallback.md`. This is the same list CREATION_PIPELINE.md's C2 checks — if something's missing, finish it now rather than let C2 bounce it.
2. Log status `HANDOFF` in ITERATION_LOG.
3. Hand off, either way:
   - **Auto-launch** (for an unattended run): background-launch a fresh session with the exact Creation kickoff prompt from README §5, **pinned to Sonnet 5** (a headless launch has no prior session to inherit a model choice from): `claude -p "<prompt>" --model claude-sonnet-5 --dangerously-skip-permissions > runs/<run_id>/creation.log 2>&1 &`, verify it started, then end the turn.
   - **Hand back to the human** (if you're being supervised): just report the bundle is complete and `status: HANDOFF`, and that pasting the Creation kickoff prompt (README §5) continues the build.

---

## 9. Templates

Both are the same templates as [RESEARCH_PIPELINE.md](RESEARCH_PIPELINE.md) §5.2 / §5.3 — reproduced here in outline for convenience; use the full versions there for the per-cell requirements.

### 9.1 SPEC.md

```markdown
# SPEC — <App Name> (<slug>)

- Run: <run_id>   Date: <YYYY-MM-DD>
- Source request: original kickoff message (verbatim in ITERATION_LOG header)   Category: <category>

## 1. Summary
## 2. Scope
**In (v1):** / **Out:** / **Won't (v1):**
## 3. Collections & data model
| Collection | Fields (name: type) | Relations | Rules | Ingress |
## 4. Features (MoSCoW)
### Must
#### M1 — <name>
Acceptance criteria:
- [ ] ...
### Should
### Won't (v1)
## 5. Questionnaire answers
## 6. Assumptions register
| # | Assumption | Source | Fallback |
## 7. Design direction (handoff to R6/R7)
## 8. Build notes
```

### 9.2 DESIGN_SPEC.md

```markdown
# DESIGN SPEC — <App Name> (<slug>)

- Run: <run_id>   Date: <YYYY-MM-DD>
- References: <product(s)> — <why>

## 1. References & shot inventory
## 2. Navigation model & screen inventory
## 3. Layout per screen (ASCII wireframe + responsive behavior)
## 4. Interaction patterns
## 5. Empty / loading / error conventions
## 6. Component mapping
## 7. Non-goals of the reference pass
```

---

## 10. When things go wrong

Same BLOCKED protocol as everywhere else (README §8): set `status: BLOCKED`, log where you stopped and why, post options to the human, end the turn. Resume-after-crash: read ITERATION_LOG bottom-up, spot-check the last claimed position against reality, continue.

One failure worth catching early rather than late: if the request's core feature has no legal platform equivalent (it fundamentally needs an inbound webhook, a third-party login, or a browser permission), go BLOCKED with 2–3 concrete re-scopes **before** writing the SPEC. A spec built around an impossible mechanism wastes the whole creation run, not just your own.
