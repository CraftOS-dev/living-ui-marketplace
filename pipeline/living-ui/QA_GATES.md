# QA Gates — the automated verification loop

The gate list every build must pass before a human ever sees it. Executed by the **creation runner** (Claude Code) from [CREATION_PIPELINE.md](CREATION_PIPELINE.md) stage C5 and from [IMPROVEMENT_PIPELINE.md](IMPROVEMENT_PIPELINE.md) stage I5 — identically both times. There is no "improvement builds get a lighter pass".

All paths below are relative to the app folder `<MARKETPLACE_ROOT>/<slug>/`.

---

## 0. Hard rules

1. **Gate order is fixed.** G1 → G8, no reordering, no skipping. Cheap gates run first so expensive ones see fewer broken builds. **G8 (restore to base import-ready state) is the exit — the human only ever receives a folder that CraftBot can import.**
2. **A code fix invalidates the gates its change class touches.** After any fix, re-run per the impact matrix in §4 — not a blanket full cascade. (Run 1 measured full cascades on frontend-only fixes as a real cost driver with zero catch-rate; the matrix keeps the safety, drops the waste.)
3. **Evidence pasted or it didn't happen — but keep it terse.** Every gate result in the QA report includes a one-line summary plus failure excerpts only; never full logs. Use quiet flags: `pytest -q --tb=short`, `tail -5` on test_runner output, one combined server-restart command block per cycle.
4. **Never weaken a gate to pass it** (README hard rule 8). No deleted tests, no lowered thresholds, no skipped viewports. A gate is PASS only when the tool's own output says so — quote it in the QA report rather than summarizing a failure as non-blocking.
5. **The iteration caps are absolute.** Max **5 full iterations**, plus the **2-strike rule**: if the *same identical failure* survives two fix attempts, stop early. Either bound hit → BLOCKED per README §8, with the final QA report attached to the escalation message.
6. **Fresh database for smoke tests.** G5 runs against a clean `living_ui.db` — delete `backend/living_ui.db*` before starting the server. Stale data hides ordering bugs the installer will hit.

---

## 1. Setup

```sh
cd <MARKETPLACE_ROOT>/<slug>

# Substitutes {{PORT}}/{{BACKEND_PORT}}/{{PROJECT_ID}} etc. in place.
# ⚠ The app folder is now PLACEHOLDER-DIRTY. Publish (C7) reverts with
#   `git checkout <slug>/` — never commit in this state.
python setup_local.py            # defaults: backend 3200, frontend 3201

python -m pip install -r backend/requirements.txt
npm install
```

**If `setup_local.py` isn't found here, don't improvise manual setup steps** — that means Stage C4 scaffolded with the wrong mechanism (see CREATION_PIPELINE.md C4's prohibition on the `living_ui_scaffold` action). Go back and rescaffold correctly with `cp -r _template/ <slug>/` in `<MARKETPLACE_ROOT>`; this is a process error to fix at the source, not a QA-stage workaround.

Log the ports in ITERATION_LOG. Server start/stop used by G5/G6:

```sh
# start (background):  cd backend && python -m uvicorn main:app --port 3200
# health check:        curl http://localhost:3200/health
# stop:                kill the uvicorn process (find via the port)
```

---

## 2. The gates

| # | Gate | Command | Pass criteria |
|---|---|---|---|
| G1 | Backend domain tests | `cd backend && python -m pytest tests/ -q --tb=short` | 0 failures, 0 errors; `test -f tests/test_example.py` prints nothing (template stub deleted); **domain-rule tests only** — generic per-entity CRUD is intentionally left to G3/G5 (`test_runner.py` auto-generates it). Write pytest for what the runner can't infer: SPEC acceptance criteria, cross-entity semantics (e.g. items-return-to-pool), ordering, dedupe, smoke-contract tolerances |
| G2 | Internal smoke | `cd backend && python test_runner.py --internal` | `ALL TESTS PASSED` (writes `logs/test_discovery.json` used by G5) |
| G3 | Auto CRUD units | `cd backend && python test_runner.py --unit` | `ALL TESTS PASSED` |
| G4 | Frontend build | `npm run build` | exit 0; zero TypeScript errors; `dist/` produced |
| G5 | External smoke | fresh DB → start uvicorn → `cd backend && python test_runner.py --external --port 3200` | `logs/test_results.json` has `"status": "pass"` and an empty `errors` list — check the JSON directly, not the terminal summary: `python -c "import json,sys; d=json.load(open('logs/test_results.json')); sys.exit(0 if d['status']=='pass' and not d.get('errors') else 1)" && echo G5-PASS \|\| echo G5-FAIL` |
| G6 | Real-browser pass | serve built `dist/` via the running uvicorn; drive with Playwright | all sub-checks in §2.1 |
| G7 | Adversarial review | strict-PM checklist pass (§3) | zero BLOCKER, zero MAJOR findings |
| G8 | Restore to base import-ready state | §7 procedure + audit | placeholders intact, zero runtime artifacts, size sane — the folder imports into CraftBot as a fresh app |

`test_runner.py --compatibility` is deliberately **not** a gate: the template marks it non-required and it has known false positives (regex scan of frontend `fetch()` calls). Run it once as advisory input for G7 if you like; it cannot pass or fail the build.

**G5 failures** are almost always the schema contract — fix per the "Schema contract for the marketplace smoke test" section of [LIVING_UI_GUIDE.md](LIVING_UI_GUIDE.md) (`Literal[...]` enums, format hints, no required query params on DELETE, idempotent DELETE, no FK 4xx on PUT). **Known exception:** if the 422 body shows the literal string `"test"` sent for a field typed `Optional[int]`/`Optional[bool]`/`Optional[datetime]`, that's a `test_runner.py` bug (`_generate_value()` failing to resolve `anyOf`/`oneOf`), not an app bug — fix your local copy of `backend/test_runner.py` and re-run G5 (the impact matrix below requires a `PROPOSAL:` line too, since `_template/`'s copy needs the same fix and can't be edited directly).

### 2.1 G6 sub-checks (browser required — see §2.2)

Run against `http://localhost:<backend-port>` serving the built frontend. Each sub-check produces evidence (console dump, screenshot path, or observed-behavior note) pasted into the QA report.

**Image-read budget:** trust the script's assertions — screenshots are saved as artifacts for the human, not reading material for the runner. Read **at most one** screenshot into context per QA cycle (normally the thumbnail, to sanity-check it). Start from the §9 script skeleton instead of designing the harness from scratch each run.

- **(a) Console clean** — zero errors, zero failed network requests, zero unhandled rejections across the whole session.
- **(b) App initializes** — real UI within a few seconds; not a white screen, error boundary, or stuck loader.
- **(c) CRUD per primary entity** — for every primary entity in SPEC.md: create → visible in UI → edit → **reload the page** → change persisted → delete → gone. Backend-first architecture makes reload-persistence the single most revealing check.
- **(d) Responsive** — render at **360, 768, 1280 px** widths: no clipped controls, no horizontal scrollbar on top-level chrome, no overlapping elements, side panels collapse/stack per DESIGN_SPEC.
- **(e) Empty states** — with a fresh DB, every list/board view shows a designed empty state (per STANDARDS.md), not a blank area or error.
- **(f) Loading feedback** — async operations show spinners/skeletons; no frozen UI on slow ops.
- **(g) Contrast spot-check** — primary text/background and button/label combinations ≥ 4.5:1. Design tokens make this near-automatic; check anything custom.

### 2.2 Browser tooling

Use the session's Playwright MCP browser tools if configured; otherwise write a throwaway Playwright script (`npx playwright ...`) driven via Bash. Save screenshots under `runs/<run_id>/qa/`.

**If neither is available, G6 cannot pass — go BLOCKED.** There is no degraded pass: per the guide, `npm run build` succeeding and `curl /` returning 200 prove the app compiles, not that it works. Render-loop bugs, layout breakage, and runtime errors only surface in a real browser.

---

## 3. G7 — Adversarial review protocol

Fresh-eyes pass. Adopt the persona from [VERIFY.md](../../skills/living-ui-creator/references/VERIFY.md): *a strict product manager who did not build this app and wants reasons to reject it.*

Inputs, walked item by item — every one gets a ✅ or a finding:

1. **SPEC.md acceptance criteria** — every Must feature's criteria, checked against the running app (use G6 evidence; re-drive the browser where evidence is missing).
2. **[STANDARDS.md](../../skills/living-ui-creator/references/STANDARDS.md) "Must Have (Blocking)" list** — data persists, mobile 320px, loading states, no console errors, build succeeds.
3. **[VERIFY.md](../../skills/living-ui-creator/references/VERIFY.md) sections 2–6** — functional, UI/UX, error handling, requirements completeness (nothing missing, nothing over-engineered), code quality.
4. **DESIGN_SPEC.md conformance** — screens, navigation, and interactions match what was specified; deviations are either justified in ITERATION_LOG or findings.
5. **Type-safety escape hatches** — `grep -rn "as any" frontend/` (also check for bare `: any` on API-facing state/params). Every hit is a MAJOR finding unless the QA report justifies it inline (e.g. a genuinely untyped third-party callback) — an `as any` cast on a call into `ApiService` almost always means the form/state type has drifted from the backend schema, exactly the class of bug that produces G5 422s.
6. **Per-entity CRUD reachability** — for every entity in SPEC.md's data model, confirm there's an actual UI surface (button/form/menu reachable from the running app) that calls each of its create/update/delete API client methods — not just that the typed methods exist in `ApiService.ts`/`AppController.ts`. An entity with full API-client CRUD but no UI wiring is a MAJOR finding (the smoke test can't catch this — G5 only proves the route exists, not that a user can reach it).
7. **SPEC §9 amendments honored** — every row of SPEC.md's `## 9. Creation-runner amendments` table (the C2 spec-review repairs) is reflected in the build. §9 outranks §1–8 where they conflict, so a build matching the original weak-model text but not its amendment is a MAJOR finding.

Findings table (goes in the QA report):

| # | Severity | Where (file/screen) | Expected | Actual |
|---|---|---|---|---|

Severities: **BLOCKER** (broken/unusable/data loss), **MAJOR** (spec violation or quality bar miss a reviewer would bounce), **MINOR** (worth fixing, wouldn't block), **NIT** (polish). Gate passes with zero BLOCKER and zero MAJOR; MINOR/NIT findings don't fail the gate but are carried into the review request's "Known limitations" section — never silently dropped.

**`LIVING_UI.md` placeholder check (BLOCKER if non-empty)** — before G7 can pass, `grep -n "<!-- Agent:" LIVING_UI.md` must be empty (same requirement as LIVING_UI_GUIDE.md Phase 9 and CREATION_PIPELINE.md C4's exit condition, checked here mechanically).

---

## 4. Fix–retest loop

```
iteration = 1
run gates in order
  └─ gate fails →
       1. diagnose — logs first (backend/logs/*), then TROUBLESHOOTING.md
          (resolve from CRAFTBOT_ROOT/skills/living-ui-creator/references/)
       2. fix test-first where applicable (failing pytest before the code fix)
       3. re-run per the IMPACT MATRIX below — not a blanket cascade
       4. same identical failure twice fixed, twice back?  → 2-strike stop → BLOCKED
       5. iteration += 1 per fix-and-retest cycle;  > 5 → BLOCKED
all gates green → write final QA report → capture thumbnail (§6) → G8 (§7) → done
```

**Impact matrix** — which gates a fix invalidates (G8 always closes the loop):

| Change class | Re-run |
|---|---|
| Backend model/route/schema | G1, G2, G3, G5 (+ G6 if the behavior is user-visible), G8 |
| Frontend-only (components, controller, styles) | G4, G6, G7 delta-check on affected criteria, G8 |
| `test_runner.py` itself | G5, G8 |
| Docs / manifest / setup_local only | G8 |

A QA-script bug (the harness, not the app) is not an app iteration — fix the script and re-run only the script; don't count it against the 5-iteration bound, but do log it. **If the bug traces to template-owned code** (present in `_template/backend/test_runner.py`, not something you introduced), fixing your local copy isn't the end of it — append a `PROPOSAL:` line to [LESSONS.md](LESSONS.md) in the same iteration (README hard rule 4: the runner never edits `_template/` directly, so this is the only path the fix has back to the source). Skipping this means the same bug silently resurfaces in the next app built from the still-stale template.

Every iteration writes `runs/<run_id>/qa/qa-report-<n>.md` (§5) and one ITERATION_LOG line (`SELF_QA | iteration 2: G5 failed (PUT /api/deals 422), fixed Literal enum | next: rerun G5–G7`).

---

## 5. QA report template — `qa/qa-report-<n>.md`

Copy verbatim; empty sections must say "None." — never delete a heading.

```markdown
# QA report <n> — <slug> — <YYYY-MM-DD HH:MM>

- Run: <run_id>   Pipeline stage: <C5 | I5 round N>
- Iteration <n> of max 5

## Gate results

| Gate | Result | Evidence |
|---|---|---|
| G1 pytest | PASS/FAIL | <summary line, e.g. "34 passed in 2.1s"> |
| G2 internal | PASS/FAIL | |
| G3 unit | PASS/FAIL | |
| G4 build | PASS/FAIL | |
| G5 external | PASS/FAIL | |
| G6 browser | PASS/FAIL | sub-checks: a ✅ b ✅ c ✅ d ✅ e ✅ f ✅ g ✅ |
| G7 adversarial | PASS/FAIL | <#findings by severity> |

## Evidence

<per-gate command output excerpts; per-sub-check notes; screenshot paths>

## Findings (G7)

| # | Severity | Where | Expected | Actual | Disposition |
|---|---|---|---|---|---|

## Fixes applied this iteration

- <file>: <what and why>  (or "None.")

## Verdict

<ALL GATES PASS | CONTINUE (re-running from G<x>) | BLOCKED (bound hit: <which>)>
```

---

## 6. Thumbnail capture

During the final green G6 run (app healthy, browser open):

1. Seed **2–3 realistic demo records** via the UI — an empty app screenshots dead.
2. Viewport **1280×800**, main screen, screenshot → `runs/<run_id>/thumbnail.png`. Sanity-check dimensions/feel against an existing app (e.g. `<MARKETPLACE_ROOT>/crm_system/thumbnail.png`).
3. **Delete the demo records** — G5 already ran, but the human's first local launch should still feel fresh; the publish step also wipes `living_ui.db*`.

---

## 7. G8 — Restore to base import-ready state + audit

The human tests by **importing the app into CraftBot** — so the folder they receive must look exactly like a fresh base app, every time (C6 *and* every I6 round), not just at publish. This gate exists because run 1 shipped a placeholder-substituted folder with `node_modules/` to review: the import threw backend errors and the size blocked upload.

### Procedure

1. **Stop everything.** No uvicorn/vite running; nothing holding `living_ui.db` (a locked db makes the deletes below silently fail — that's how run 1 leaked state).
2. **Delete runtime artifacts** in `<MARKETPLACE_ROOT>/<slug>/`:
   ```sh
   rm -rf node_modules dist package-lock.json .vite \
          backend/__pycache__ backend/.pytest_cache backend/logs backend/uploads
   rm -f  backend/living_ui.db*
   find . -name __pycache__ -type d -exec rm -rf {} +   # catches nested ones (tests/__pycache__)
   ```
3. **Revert placeholder substitutions:**
   - **If the app is committed** (the C4 pre-QA commit): `git checkout -- <slug>/`, then re-apply nothing — the commit is the pristine state.
   - **If not committed** (fallback, proven in run 1's remediation): byte-copy the template-owned files back from `_template/` — `backend/main.py`, `frontend/services/ApiService.ts`, `frontend/services/ConsoleCapture.ts`, `frontend/services/StatePersistence.ts`, `index.html`, `vite.config.ts` — then hand-restore the app-owned substitutions: `config/manifest.json` (`id`, both `ports`, backend `start`/`health`, external-test command, frontend `start` → back to `{{PROJECT_ID}}`/`{{PORT}}`/`{{BACKEND_PORT}}`) and any app file that embeds the backend URL (e.g. `AppController.ts`'s `{{BACKEND_PORT}}` fallback line).
4. **Audit — all four must pass:**
   ```sh
   # (a) placeholders present
   grep -c "{{PROJECT_ID}}\|{{PORT}}\|{{BACKEND_PORT}}" config/manifest.json   # >= 7
   # (b) no substituted values outside setup_local.py's own defaults
   grep -rn "3200\|3201\|local-dev" . --include=*.py --include=*.ts \
        --include=*.tsx --include=*.json --include=*.html
   # (c) no runtime artifacts
   find . \( -name node_modules -o -name dist -o -name __pycache__ \
        -o -name "living_ui.db*" -o -name uploads -o -name .pytest_cache \
        -o -name logs -o -name package-lock.json \)                            # empty
   # (d) size sane
   du -sh .                                                                    # ~<=2 MB (crm_system is 1.2M)
   ```
5. Commit the round's work on `app/<slug>` (unless the human has asked to hold commits).

**Pass criteria:** audit (a)–(d) all green. Any failure: fix and re-run the audit — never hand a dirty folder to the human.

---

## 8. Self-check before leaving QA

- [ ] Final `qa-report-<n>.md` shows every gate PASS with terse evidence.
- [ ] All G7 MINOR/NIT findings listed with dispositions (fixed here, or carried to the review request).
- [ ] `thumbnail.png` exists in the run folder and shows a populated UI.
- [ ] Server processes stopped; no uvicorn/vite left running.
- [ ] **G8 audit green: placeholders intact, zero runtime artifacts, size sane — folder is import-ready.**
- [ ] ITERATION_LOG line written per iteration (≤2 lines each), including this exit.

---

## 9. Appendix — G6 starter script skeleton

Copy and fill the app-specific section; don't design the harness from scratch. Generic checks below are app-agnostic.

```js
const { chromium } = require('playwright');
const results = []; const consoleErrors = []; const failedRequests = [];
const log = (n, ok, d) => { results.push({ n, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} - ${n}${d ? ' :: ' + d : ''}`); };

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.on('console', m => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('requestfailed', r => failedRequests.push(`${r.method()} ${r.url()}`));
  page.on('response', r => r.status() >= 400 && failedRequests.push(`${r.request().method()} ${r.url()} -> ${r.status()}`));

  await page.goto('http://localhost:<port>', { waitUntil: 'networkidle' });
  log('app initializes', !!(await page.textContent('body'))?.includes('<expected text>'));

  // === APP-SPECIFIC: one CRUD flow per primary entity, then: ===
  await page.reload({ waitUntil: 'networkidle' });
  // assert the created state is still present  → the reload-persistence check
  // exercise the touch/tap fallback if the app has drag-and-drop

  for (const w of [360, 768, 1280]) {          // responsive sweep, both screens
    await page.setViewportSize({ width: w, height: 800 });
    const hs = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    log(`no horizontal overflow @${w}`, !hs);
    await page.screenshot({ path: `<run>/qa/g6-${w}.png` });   // artifact only — don't read back
  }

  await page.waitForTimeout(1500);             // let background POSTs settle before close
  await browser.close();
  console.log(`console errors: ${consoleErrors.length}; failed reqs: ${failedRequests.length}`);
  if (results.some(r => !r.ok) || consoleErrors.length || failedRequests.length) process.exitCode = 1;
})();
```
