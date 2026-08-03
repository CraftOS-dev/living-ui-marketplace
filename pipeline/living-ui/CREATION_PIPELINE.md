# Creation Pipeline — handed-off research to a delivered Living UI V2 app

The standing operating procedure for mode **CREATE** (runner: **Claude Code**; `AUTO` is a deprecated alias): take one handed-off request from claim to an importable ZIP the human can run in CraftBot. Read [README.md](README.md) (rules, platform contract, paths, state machine) and [LESSONS.md](LESSONS.md) first — this doc assumes both.

Research and design happen **before** this pipeline, in [RESEARCH_PIPELINE.md](RESEARCH_PIPELINE.md) (stages R1–R8, run by CraftBot). This pipeline is normally launched headless by that pipeline's R8 stage; the manual Creation kickoff (README §5) enters it identically.

Stages: **C1** claim → **C2** handoff validation & spec review → **C3** scaffold & compile the binding spec → **C4** build → **C5** self-QA → **C6** human review gate → **C7** package & deliver → **C8** retrospective.

Notation (README §2): `LUI = node living-ui-v2/tools/src/cli.ts`, `RUN = agent_file_system/workspace/pipeline/living-ui/runs/<run_id>`, `APP = <RUN>/app`. Every command runs with the working directory at `CRAFTBOT_ROOT`.

---

## 0. Hard rules

1. **Stage order is fixed.** No stage starts before the previous one's exit condition is met and logged. In particular: no scaffold before C2's bundle validation passes, no review request before all QA gates are green, no packaging as final before `APPROVED`.
2. **Track progress with TodoWrite**: one item per stage at C1, expanded with one item per feature at C4. The todo list and ITERATION_LOG must agree.
3. **The V2 ownership rule is absolute and mechanically enforced.** Edit only `frontend/src/app/`, `pb/pb_migrations/`, `pb/pb_hooks/ops.pb.js` (+ new `*.pb.js`), `operations.json` (non-`system` entries), `LIVING_UI.md`, `reference/`. Everything else in the project is hashed at scaffold time and fails `lui validate`'s ownership step if touched. Never edit anything under `living-ui-v2/` itself (README rule 4).
4. **All README hard rules remain in force** — especially rule 3 (per-pipeline state ownership), rule 6 (human contact only at C6/BLOCKED), rule 9 (everything under `runs/<run_id>/`), and rule 10 (the human only ever receives an audited ZIP).
5. **Iteration bounds are absolute**: QA loop ≤5 iterations + 2-strike (C5). Bound hit → BLOCKED, never "one more try".
6. **Research-owned statuses are off-limits.** `RESEARCHING` and `SPEC_READY` belong to the research runner (CraftBot). Never advance a run whose ITERATION_LOG last status is one of those. If nothing under `runs/` shows `HANDOFF` or a creation-owned status, report "nothing handed off yet" and stop.

---

## 1. Stage C1 — Claim

1. Apply the README §7 pre-run self-check, including the Node/`lui`/Playwright preflight. The in-flight scan covers **creation-owned states only**: `HANDOFF` (with no live launcher session working it), `BUILDING`, `SELF_QA`, `IMPROVING`, `PACKAGING` — resume beats claim (README §8).
2. Otherwise find the run under `runs/` whose ITERATION_LOG last status is `HANDOFF`. None → report "nothing handed off yet" and stop (hard rule 6). (There's at most one — README rule 3.)
3. The run folder `runs/<run_id>/` already exists — the research runner created it, and its ITERATION_LOG header carries the original `app_name`/`slug`/`tags`/`auth_mode`/requirement verbatim (there's no separate request file). **Do not log a new status yet** — C2 does that, so a stuck handoff (launch died before Claude started) stays distinguishable from a claimed one.
4. Create the folders this pipeline will fill and append to the existing ITERATION_LOG:
   ```sh
   mkdir -p <RUN>/qa <RUN>/deliverable
   ```
   ```
   <timestamp> | HANDOFF | CLAIMED (creation) by <session label>; resuming from research handoff | next: C2 validate bundle
   ```
5. Read [GLOBAL_LIVING_UI.md](../../../GLOBAL_LIVING_UI.md) now — its palette and enabled rules bind everything downstream (README rule 7: take its palette and rules, not its V1 mechanisms).

**Exit:** claim logged; status still `HANDOFF`.

---

## 2. Stage C2 — Handoff validation & spec review

The research was done by a much weaker model. Your job here: verify the bundle is mechanically complete, then review its content like a tech lead reviewing a junior's spec — repair what you can, escalate what you can't.

### 2a. Mechanical bundle check

Same manifest the research runner ran at R8 — all lines must PASS:

```powershell
$r='agent_file_system/workspace/pipeline/living-ui/runs/<run_id>'
foreach ($f in 'SPEC.md','DESIGN_SPEC.md','ITERATION_LOG.md','research/decomposition.md','research/features.md','research/competitors.md','research/ux-patterns.md','research/data-model.md','research/questionnaire.md') {
  if (Test-Path "$r/$f") { "PASS $f" } else { "FAIL $f" } }
$png=(Get-ChildItem "$r/reference-shots" -Filter *.png -ErrorAction SilentlyContinue).Count
$fb=Test-Path "$r/research/capture-fallback.md"
if ($png -ge 4 -or $fb) { "PASS shots ($png png, fallback=$fb)" } else { "FAIL shots" }
```

Any FAIL → log status `BLOCKED` with `reason: creation: handoff bundle incomplete — <failing items> — rerun research`, message to the human, stop. (There is no live research session to bounce to; the human re-kicks the research pipeline with a fresh NEW_APP_PROMPT.md.)

### 2b. Spec review

Read the original requirement (verbatim in the ITERATION_LOG header), SPEC.md, and DESIGN_SPEC.md, and check:

- **Coverage** — every sentence of the requirement maps to a Must/Should/Won't; every stated constraint is respected.
- **Testability** — acceptance criteria name a user action and an observable result; persistence criteria exist.
- **Data-model sufficiency** — SPEC §3 supports every Must. Collections and fields use the PocketBase vocabulary (`text`, `editor`, `number`, `bool`, `date`, `select`, `relation`, `file`, `json`); every `select` field enumerates its values; relations are explicit; nothing is named `metadata`; **every collection states an ingress** (user form / bridge pull / scheduled op / computed from other collections).
- **Platform legality** — nothing spec'd as client-side-only or localStorage-backed; no inbound webhooks or callback URLs; no OAuth flow, token entry, or API-key prompt (external data comes through the CraftBot bridge); no feature that depends on a browser permission prompt; nothing that would require editing a system-owned file.
- **Auth coherence** — the `auth_mode` in the log header matches what the spec assumes; if the spec describes per-user data, `multi-user` must be the mode and owner-scoped rules must be specified.
- **Assumption plausibility** — SPEC §6 rows are sane and their fallbacks concrete.
- **Internal consistency** — build notes don't contradict the entities; DESIGN_SPEC screens cover every Must; no visual-identity leakage (hex colors/fonts) in DESIGN_SPEC; component mapping names components that actually exist in `living-ui-v2/kit/src/index.ts`.

**Repairs are amendments, never silent fixes.** Append a section to SPEC.md:

```markdown
## 9. Creation-runner amendments
| # | Change | Why | Evidence |
|---|---|---|---|
```

One row per gap you repaired (added criteria, fixed data model, re-scoped a Must, corrected a platform contradiction). Where SPEC §1–8 and §9 conflict, **§9 wins**. Amend up to moderate gaps yourself — a strong model repairing weak-model output is the designed path, cheaper than a research rerun. Escalate (BLOCKED) only when the *request itself* is ambiguous enough that amending would be guessing the human's intent, or on a 2a failure.

**Exit:** manifest all-PASS quoted in ITERATION_LOG; review done; §9 present (an empty table with a "no amendments needed" row is a valid outcome); log status **`BUILDING`** — this is deliberately the creation runner's first status write, and it must happen within minutes of session start so a run sitting at `HANDOFF` reliably signals a dead launch.

---

## 3. Stage C3 — Scaffold & compile the binding spec

Status is already `BUILDING`. Nothing is written by hand here — the tooling owns scaffolding.

1. **Scaffold.** Pick a free port (8090 is the tool default; step up if something already listens). `--auth` comes from the log header's `auth_mode`, and it is not casually changeable later because every collection rule depends on it.
   ```sh
   node living-ui-v2/tools/src/cli.ts create "<App Name>" \
     --dir <RUN> --folder app --port <PORT> --auth <none|multi-user> --json
   ```
   This copies the blueprint, vendors the kit, substitutes identity placeholders, bootstraps the machine superuser (which also initializes `pb_data` and applies the starter migration), and writes the ownership hash canon. It prints one JSON line — record `id`, `slug`, and `port` in ITERATION_LOG.

   **Never call the `living_ui_scaffold` action** — that is CraftBot's tool for direct chat-driven builds. It registers a project in CraftBot's own list *and dispatches a build to that project's separate session*, which would race this run and put the app outside `runs/<run_id>/`.

   Mechanical check — must print the project's own files, not an error:
   ```sh
   test -f <APP>/manifest.json && test -f <APP>/.lui/system-hashes.json \
     && echo scaffold-ok || echo "SCAFFOLD FAILED — do not proceed"
   ```

2. **Compile `reference/requirements.md`** — this is V2's **binding spec contract**. CraftBot's own creation wizard writes this file, and everything downstream reads it: the launch verifier walks the app against it, and `living-ui-modify` reads it whenever the human later asks CraftBot to change the app. A delivered app without it is a dead end for its own future.

   Write `<APP>/reference/requirements.md` with **exactly these six sections**, compiled from SPEC.md (§9 amendments outrank §1–8) and DESIGN_SPEC.md:

   ```markdown
   # <App Name> — Requirements

   ## Overview
   What the app is, who uses it, the core experience. (SPEC §1.)

   ## Features
   Every user-facing capability as a concrete "the user can …" statement with enough
   detail to build from — controls involved, expected outcome. One per SPEC Must,
   then any built Shoulds. Fold the acceptance criteria in as the outcome clauses.

   ## Data
   Every collection: fields with PB types, relations, rules, and lifecycle (how records
   are created/updated/deleted through the UI). For EVERY collection state its INGRESS —
   user form, bridge pull from a named connected service (on load/refresh and/or a
   scheduled op), file import, or computed from other collections. (SPEC §3.)

   ## Design
   The binding visual contract: layout regions per screen, navigation model, empty
   states, responsive behavior at 768px and 360px. Concrete choices, no "agent decides".
   (DESIGN_SPEC §2–§5.) Visual identity is kit tokens — never restate hex colors here.

   ## Operations
   What the agent-facing verb surface must support: the custom ops to declare beyond
   plain collection CRUD, which are destructive, and any scheduled operations.
   (SPEC §8 + DESIGN_SPEC §6.)

   ## Quality of Life
   Power-user touches appropriate to THIS app — shortcuts, drag & drop, bulk actions,
   context menus, responsiveness. Concrete and scoped, not a generic checklist.
   ```

   Rules: every statement concrete and checkable; no filler ("user-friendly", "modern", "polished"); preserve every decision the SPEC made; where the SPEC is silent, decide here and say so. This file and SPEC.md must not disagree — if compiling surfaces a contradiction, that's an amendment row in SPEC §9.

3. **Mirror into `LIVING_UI.md`.** Fill the project's own `LIVING_UI.md` — what the app does, the feature checklist (unchecked), the entities table (replacing the blueprint's `items` row), the ownership map. Keep it current after every feature; it is the plan/context/index a future session reads first.

4. **Install dependencies.**
   ```sh
   npm install --ignore-scripts --no-audit --no-fund --prefix <APP>/frontend
   ```
   `--ignore-scripts` is mandatory: any npm package is allowed in `dependencies`, so lifecycle scripts must never run.

5. **Baseline gate.** Run `node living-ui-v2/tools/src/cli.ts validate <APP>` on the untouched scaffold. It must print `✓ Gate: all steps passed`. A red baseline is an environment problem (Node version, missing PocketBase binary, broken install), **not** an app problem — resolve it before writing a single line of app code, or you will spend the whole build debugging the wrong layer.

**Exit:** `scaffold-ok`; `reference/requirements.md` written with all six sections; `LIVING_UI.md` seeded; deps installed; baseline `lui validate` green and quoted in ITERATION_LOG.

---

## 4. Stage C4 — Build

Follow [living-ui-v2/docs/agent-guide.md](../../../../living-ui-v2/docs/agent-guide.md) — it is the ground truth for build mechanics. Its §2 loop, per feature, in this order:

1. **Schema** — a new migration in `pb/pb_migrations/`; never edit an applied one. Follow the starter migration's pattern for field types and `autodate` created/updated. Rules match `manifest.json`'s `authMode`. Relation fields use the target collection's **id** (`app.findCollectionByNameOrId('words').id`) — save the target collection first. This is the #1 migration mistake.
2. **Operations** (only if the feature needs a verb beyond CRUD) — a `routerAdd` route in `pb/pb_hooks/ops.pb.js` **plus** a matching `operations.json` entry. Read bodies with `e.requestInfo().body`. Mark data-deleting ops `"destructive": true`. Pick the kebab-case names once, before writing any of the three call sites (op name ↔ route path ↔ frontend fetch).
3. **UI** — in `frontend/src/app/`, importing only from `../kit/index.ts`. Reach for the presets before hand-rolling: `EntityForm`/`EntityTable` for CRUD surfaces, `useConfirm()` for destructive confirmations, `DropdownMenu`/`Drawer`/`Tooltip`, `SearchInput`/`TagInput`/`DateInput`/`NumberInput`, `SortableList` + `reorderAndSave`, `FileUpload`/`ImageInput`, `Sparkline`/`MiniBarChart`. Data through `useCollection` (realtime — never poll, never reload), writes through `getPbClient().call(...)`.
4. **Gate** — `node living-ui-v2/tools/src/cli.ts validate <APP>` after every meaningful change. Fix, repeat.

Pipeline-specific amendments to the guide — these are the only deltas; everything else is the guide, unmodified:

| The guide says | In this pipeline |
|---|---|
| Read `reference/requirements.md` and `LIVING_UI.md` | Both exist already (C3). `reference/requirements.md` is binding; where you need more depth than it carries, consult SPEC.md (**§9 amendments outrank §1–8**) and DESIGN_SPEC.md |
| "Ask the user" / a wizard interviewed them | **Never ask** (README rule 6). Consult SPEC §9 → SPEC → DESIGN_SPEC. If all three are silent, apply a Safe Assumption from [RESEARCH_PIPELINE.md](RESEARCH_PIPELINE.md) §5.6, add it to SPEC §6's register, and log it |
| Build the features in `requirements.md` | Feature order = SPEC §4 Musts in dependency order. Shoulds queue after — built only if **all** Musts are done and QA-stable |
| Layout is up to you | Layout, navigation, and interactions come from DESIGN_SPEC (wireframes + component mapping). Visual identity from kit tokens only |
| `lui validate` is the gate | True during the build. **Full verification is Stage C5** — [QA_GATES.md](QA_GATES.md) is a strict superset; don't declare done on a green `lui validate` alone |
| `living_ui_notify_ready` / `living_ui_walk_verify` finish the build | **Not available here** — those are CraftBot actions, and this session is a standalone Claude Code run. Their equivalents are QA_GATES G2/G3 (`lui verify`) and G5 (the browser walk) |
| Keep `LIVING_UI.md` current | Unchanged, and enforced: G6 checks it for leftover blueprint placeholders |

Log one ITERATION_LOG line per completed feature (schema applied + ops declared + UI wired + gate green counts as complete; not before). This is the stage where a run most often goes dark for over an hour — apply the README §4 heartbeat rule (a line at least every 10 minutes even mid-feature) so a human checking in can tell the run is alive.

**Exit:** all Must features built with a green `lui validate`; `reference/requirements.md` still matches what was built; `LIVING_UI.md` filled in (entities, ops, checklist — no blueprint placeholder rows, quote the G6 §3.18 grep in the log line); log shows every feature.

---

## 5. Stage C5 — Self-QA

Set `status: SELF_QA`. Execute [QA_GATES.md](QA_GATES.md) end-to-end (setup → G1–G6 → fix–retest loop per the impact matrix → thumbnail → **G7 package + audit**). Apply the README §4 heartbeat rule here too — a gate that takes a while (G5/G6 especially) still needs a log line at least every 10 minutes.

- **Exit:** final `qa/qa-report-<n>.md` shows all gates PASS **including G7** (`audit.py` prints `G7-PASS`); `<RUN>/thumbnail.png` captured; QA self-check (QA_GATES §8) done.
- **Escape hatch:** loop bound or 2-strike hit → BLOCKED with the final QA report attached.

---

## 6. Stage C6 — Human review gate

Before writing the review request, run the README §4 timestamp-format check against `ITERATION_LOG.md` — must return 0.

Set `status: AWAITING_HUMAN_REVIEW`. Write `runs/<run_id>/REVIEW_REQUEST.md` from this template, post its content as the message to the human, and **end the turn** — the runner does nothing further until the human replies.

```markdown
# Ready for review — <App Name> (<slug>) — round <review_round>

## What was built
| # | Must feature | Status | Where to see it |
|---|---|---|---|
<one row per SPEC Must; Shoulds listed separately if built>

## How to test
Import this ZIP into CraftBot:

    <RUN>/deliverable/<slug>.zip   (<size>, <file count> files)

Use the Living UI panel's import button, or ask CraftBot to run
`living_ui_import_zip`. The import registers it as a NEW project with a fresh
id and port, strips shipped credentials, and re-vendors the kit; it lands
STOPPED, then launches from the panel (or via `living_ui_notify_ready`).
Auth mode: <none | multi-user>.
G7 audit: G7-PASS — manifest v2 at root, kit vendored, no node_modules/pb_data/logs.

## Look at these first
<2–3 flows that best exercise the app, one line each>

## Known limitations & assumptions
<SPEC §6 assumptions register, verbatim, + SPEC §9 creation-runner amendments,
verbatim, + G6 MINOR/NIT findings with dispositions>
(empty → "None.")

## QA evidence
<final qa-report gate table>

---
Reply **APPROVED** to finish, or list issues (one per line) and I'll run an
improvement round. Round limit: 5.
```

**Reply routing:**

- Reply is `APPROVED` (case-insensitive), alone or with clearly non-blocking notes → confirm the notes are non-blocking (if any doubt, treat as issues) → Stage C7. Log the approval.
- Anything else → the reply is the issue list → [IMPROVEMENT_PIPELINE.md](IMPROVEMENT_PIPELINE.md) stage I1.
- No reply (session ends) → ITERATION_LOG already shows `AWAITING_HUMAN_REVIEW`; a future session in either mode picks it up cleanly.

---

## 7. Stage C7 — Package & deliver

Set `status: PACKAGING`. The heavy lifting already happened: G7 has produced an audited ZIP after every QA cycle, so this stage is a final re-assertion plus the handover message. Steps in order:

1. **Final gate.** `node living-ui-v2/tools/src/cli.ts validate <APP>` — must print `✓ Gate: all steps passed`. If deps were removed since the last run, reinstall first (`npm install --ignore-scripts --prefix <APP>/frontend`).
2. **Re-run G7** (QA_GATES §7): stop every process, thumbnail out, `scripts/package.py`, then `scripts/audit.py` — must print `G7-PASS`. Never ship a ZIP produced before the last code change.
3. **Confirm the run folder is complete** — `SPEC.md`, `DESIGN_SPEC.md`, `research/`, `reference-shots/`, `qa/qa-report-*.md`, `REVIEW_REQUEST.md`, `thumbnail.png`, `deliverable/<slug>.zip`. `runs/` is git-ignored, so the ZIP plus LESSONS.md are the only durable outputs; anything not in one of them is lost.
4. **Close out the run:** final ITERATION_LOG line, status `DONE`, with the deliverable path and round count stated inline.

**Escape hatches:** `audit.py` fails → BLOCKED with its printed failure list; the source tree is intact locally, nothing is lost. Never hand over a ZIP that failed its audit "for the human to look at anyway".

---

## 8. Stage C8 — Retrospective

Mandatory, even (especially) after a rough run. Append one entry to [LESSONS.md](LESSONS.md) in its required format, answering all four:

1. **What did human review catch that self-QA missed?** Each miss becomes a `[qa-gap]` bullet — these are the pipeline's most valuable output besides the app itself.
2. **What research/design step paid off, and what wasted time?**
3. **What ambiguity forced a judgment call?** Anything the docs didn't decide for you becomes a `PROPOSAL:` line.
4. **Grade the research handoff.** What did SPEC.md/DESIGN_SPEC.md get wrong or omit that you only discovered while building — i.e. what did SPEC §9 have to amend, and what slipped past even C2? Each becomes a `[handoff]` bullet.

**Propagation duty:** for every `[research]`, `[design]`, or `[handoff]` lesson, also add (or strengthen) a numbered order in [RESEARCH_PIPELINE.md](RESEARCH_PIPELINE.md) **§2 Standing corrections** — that section is the only lessons channel the research runner reads, so a lesson that stays here never reaches it. This is the one sanctioned edit to RESEARCH_PIPELINE.md; log it in the LESSONS entry.

If the answer to all four is genuinely "nothing" — a clean, boring run — write the one-line entry `No new lessons (clean run).` rather than inventing filler.

---

## 9. End-of-run self-check

Before reporting done:

- [ ] ITERATION_LOG: final status `DONE`, with the deliverable path and round count in the closing line.
- [ ] README §4 timestamp-format check re-run — still 0.
- [ ] `scripts/audit.py <RUN>/deliverable/<slug>.zip` prints `G7-PASS`.
- [ ] `reference/requirements.md` inside the ZIP matches what was actually built.
- [ ] No PocketBase/Vite processes left running.
- [ ] LESSONS.md entry appended; `[research]`/`[design]`/`[handoff]` bullets propagated to RESEARCH_PIPELINE §2.

Report to the human: *"<App Name> ready — import `<RUN>/deliverable/<slug>.zip` into CraftBot. Review round count: <n>. Lessons recorded: <count or 'clean run'>."*

---

## 10. When things go wrong

| Stage | Failure | Action |
|---|---|---|
| C1 | No run under `runs/` shows `HANDOFF`, or its folder/ITERATION_LOG is malformed | BLOCKED — the research handoff is broken; ask the human to re-kick the research pipeline |
| C2 | Bundle mechanically incomplete (manifest FAIL) | BLOCKED with `reason: creation: handoff bundle incomplete — rerun research` |
| C2 | SPEC gaps too fundamental to amend (request intent unclear) | BLOCKED with the specific ambiguity + 2–3 interpretation options for the human |
| C3 | `lui create` fails, or the baseline `lui validate` is red on an untouched scaffold | Environment problem, not an app problem: re-check Node ≥ 24, `lui pb path`, and the install. Still red → BLOCKED with the full gate output — do not start building on a broken baseline |
| C4 | A Must feature turns out to need an un-requested external service, credentials, or an inbound webhook | Don't build it silently and don't drop it silently — BLOCKED with options (drop to Won't / re-express it as a bridge pull + scheduled op / human authorizes something else) |
| C4 | A fix seems to require editing a system-owned file (kit, `main.tsx`, `manifest.json`, `_system.pb.js`) | That's a platform change, not an app change: wrap/compose in `app/` instead. If genuinely impossible, BLOCKED + a `PROPOSAL:` line in LESSONS.md |
| C5 | QA bound hit | BLOCKED with final qa-report (automatic per QA_GATES) |
| C6 | Human reply ambiguous (mixes praise, issues, and "maybe"s) | Treat as issues → improvement round; I2 handles clarification |
| C7 | `audit.py` fails | BLOCKED with its failure list; fix the tree and re-package — never ship an unaudited ZIP |
| any | Anything not on this table | README §8 BLOCKED protocol — when in doubt, escalate with options rather than improvise past a rule |
