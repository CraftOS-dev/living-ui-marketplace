# QA Gates — the automated verification loop (V2)

The gate list every build must pass before a human ever sees it. Executed by the **creation runner** (Claude Code) from [CREATION_PIPELINE.md](CREATION_PIPELINE.md) stage C5 and from [IMPROVEMENT_PIPELINE.md](IMPROVEMENT_PIPELINE.md) stage I5 — identically both times. There is no "improvement builds get a lighter pass".

Notation, as resolved in [README.md](README.md) §2 — every command runs with the working directory at `CRAFTBOT_ROOT`:

```
LUI  = node living-ui-v2/tools/src/cli.ts
RUN  = agent_file_system/workspace/pipeline/living-ui/runs/<run_id>
APP  = <RUN>/app
PORT = the "port" value in <APP>/manifest.json
```

---

## 0. Hard rules

1. **Gate order is fixed.** G1 → G7, no reordering, no skipping. Cheap gates run first so expensive ones see fewer broken builds. **G1 must precede G2** for a mechanical reason, not just an economic one: `lui validate` runs the Vite build, and the build is what populates `pb/pb_public` — without it PocketBase serves nothing and every browser gate fails for the wrong reason. **G7 (package + audit) is the exit — the human only ever receives a ZIP CraftBot can import.**
2. **A code fix invalidates the gates its change class touches.** After any fix, re-run per the impact matrix in §4 — not a blanket full cascade.
3. **Evidence pasted or it didn't happen — but keep it terse.** Every gate result in the QA report includes a one-line summary plus failure excerpts only; never full logs. `lui validate` already prints one line per step plus the offending source line for failures — quote that, not the whole build output. **Never paste or read `logs/pocketbase.log` whole** — it is a full SQL trace (~55 KB for a trivial boot); grep it.
4. **Never weaken a gate to pass it** (README hard rule 8). A gate is PASS only when the tool's own output says so — quote it in the QA report rather than summarizing a failure as non-blocking. `{"status":"skipped"}` from `lui verify`/`lui probe` means Playwright is missing (README §2), **not** that the gate passed.
5. **The iteration caps are absolute.** Max **5 full iterations**, plus the **2-strike rule**: if the *same identical failure* survives two fix attempts, stop early. Either bound hit → BLOCKED per README §8, with the final QA report attached to the escalation message.
6. **Fresh database for the runtime gates.** G2 starts from a deleted `pb/pb_data` so migrations apply from zero, exactly as they will on the human's machine after import. Stale data hides both migration bugs and empty-state bugs.

---

## 1. Setup

The project already exists — C3 scaffolded it and installed its dependencies. Re-assert only what a fresh QA session needs:

```sh
# from CRAFTBOT_ROOT. Deps live in <APP>/frontend/node_modules; --ignore-scripts is
# mandatory (any npm package is allowed in a project, so lifecycle scripts must never run).
npm install --ignore-scripts --no-audit --no-fund --prefix <APP>/frontend
```

Read `PORT` out of `<APP>/manifest.json` and log it in ITERATION_LOG. Server start/stop used by G2–G5:

```sh
# resolve the pinned binary once
node living-ui-v2/tools/src/cli.ts pb path

# start (background), after G1 has produced pb/pb_public:
<pb> serve --http=127.0.0.1:<PORT> --dir <APP>/pb/pb_data --hooksDir <APP>/pb/pb_hooks \
     --migrationsDir <APP>/pb/pb_migrations --publicDir <APP>/pb/pb_public > <APP>/logs/pocketbase.log 2>&1

# health:  curl -s http://127.0.0.1:<PORT>/api/health      → {"message":"API is healthy.","code":200,...}
# stop:    kill the pocketbase process (it holds pb_data — a live process makes G7's deletes fail silently)
```

**If `<APP>/manifest.json` doesn't exist**, C3 never ran or scaffolded somewhere else. Don't improvise a manual project layout — go back to CREATION_PIPELINE C3 and scaffold properly with `lui create`. This is a process error to fix at the source, not a QA-stage workaround.

**Any throwaway script this stage writes (the G5 harness's `OUT` dir, ad-hoc capture scripts) must use an absolute output path.** The shell's working directory persists across tool calls within a session, so an unrelated earlier `cd` can silently redirect a later relative-path write into the wrong folder — this has actually misplaced captured output before (README rule 12).

---

## 2. The gates

| # | Gate | Command | Pass criteria |
|---|---|---|---|
| G1 | Validation gate | `$LUI validate <APP>` | Final line `✓ Gate: all steps passed`, exit 0. Six steps run in order: dependency policy → `tsc --noEmit` → Vite build → migrations against a **fresh temp** `pb_data` → `operations.json` structure + hook-route matching → ownership hashes. Any `⚠ route not declared as an operation: …` warning does not fail G1 but **is a G6 finding** |
| G2 | Fresh-DB launch | delete `<APP>/pb/pb_data`, start PocketBase (§1) | `/api/health` returns 200 within 30 s (it is normally ~1 s), **and** `logs/pocketbase.log` has no error lines: `grep -iE "^\s*Error\|failed to apply\|panic" <APP>/logs/pocketbase.log` prints nothing |
| G3 | Smoke verify | `$LUI verify <APP> --url http://127.0.0.1:<PORT>` | one JSON line with `"status":"pass"`, `checks.loaded`/`checks.mounted`/`checks.noConsoleErrors` all `true`, `consoleErrors: []`. Exit 2 / `"status":"skipped"` is **not** a pass — install Playwright (README §2) or go BLOCKED. Writes `<APP>/logs/verify/home.png`, the thumbnail source (§6) |
| G4 | Operations surface | `$LUI ops <APP>`, then per op `$LUI run <APP> <op> [--param v]`; per collection `$LUI data <APP> <collection> list` | Every declared non-system op returns a 2xx JSON body; every collection lists without error. Destructive ops run **last**, against records seeded for the purpose. Zero undeclared routes (the G1 warning) |
| G5 | Browser walk | `node <RUN>/qa/g5.cjs http://127.0.0.1:<PORT> <RUN>/qa` with `NODE_PATH` set (§2.1) | every sub-check `PASS`, `console errors: 0`, exit 0; `<APP>/logs/frontend_console.log` still empty (the kit relays every console.error/warn and uncaught error into it) |
| G6 | Adversarial review | strict-PM checklist pass (§3) | zero BLOCKER, zero MAJOR findings |
| G7 | Package + audit | §7 procedure (`scripts/package.py` then `scripts/audit.py`) | `G7-PASS`, exit 0 — the ZIP satisfies CraftBot's import contract |

`lui probe` is available as a lighter alternative to a bespoke script for *scripted* checks (`goto`/`click`/`type`/`read`/`wait`/`screenshot`, one JSON line out), but its viewport is fixed at 1280×800, so it **cannot** carry G5's responsive sweep on its own. Use it for exploratory poking; use the §9 script for the gate.

### 2.1 Running the browser gates

Playwright is resolved from the V2 workspace (README §2). ESM resolves bare specifiers relative to the **importing file's** location, so a `.mjs` sitting in `runs/` can never find it — the G5 harness is therefore **CommonJS (`.cjs`)** and run with `NODE_PATH` pointing at the workspace's `node_modules`:

```sh
NODE_PATH="$PWD/living-ui-v2/node_modules" node <RUN>/qa/g5.cjs http://127.0.0.1:<PORT> <RUN>/qa
```

```powershell
$env:NODE_PATH = "$PWD\living-ui-v2\node_modules"
node <RUN>\qa\g5.cjs http://127.0.0.1:<PORT> <RUN>\qa
```

### 2.2 G5 sub-checks

Start from the §9 skeleton — don't design the harness from scratch each run. Each sub-check prints its own `PASS`/`FAIL` line; the script exits non-zero if any fails or any console error was seen.

- **(a) App mounts** — `#root` has children and non-empty text within a few seconds; not a white screen, error boundary, or stuck loader.
- **(b) CRUD per primary collection** — for every collection in the spec's data model: create → visible in UI → edit → **reload the page** → change persisted → delete → gone. PocketBase-backed architecture makes reload-persistence the single most revealing check.
- **(c) Empty state** — against the fresh DB from G2, every list/board view shows a designed empty state with a next action, not a blank area or an error.
- **(d) Loading feedback** — async operations show spinners/skeletons; no frozen UI.
- **(e) Responsive** — render at **360, 768, 1280 px**: no horizontal overflow on top-level chrome (`scrollWidth > clientWidth + 2` is the assertion), no clipped controls, side panels collapse/stack per DESIGN_SPEC.
- **(f) Console clean** — zero console errors, zero page errors, zero ≥400 responses across the whole session.
- **(g) Contrast spot-check** — primary text/background and button/label combinations ≥ 4.5:1. Kit tokens make this near-automatic; check anything custom.

**Never `waitUntil: 'networkidle'`.** A Living UI holds a permanent realtime (SSE) subscription, so the network is *never* idle — the wait hangs until timeout and the gate fails for a reason that has nothing to do with the app. Use `waitUntil: 'load'` plus an explicit `waitForTimeout`.

**Never select a plain-text field with `input[type="text"]`.** The kit's `Input` component renders a native `<input>` with no explicit `type` attribute for ordinary text fields (it only shows up for `type="number"`, `type="email"`, etc.) — the selector silently matches nothing and the script hangs on a 30s timeout. Select on the field's `placeholder` or `label` text instead (the §9 skeleton already does this correctly; this note exists because a run wrote the broken selector anyway, from habit).

**Image-read budget:** trust the script's assertions — screenshots are saved as artifacts for the human, not reading material for the runner. Read **at most one** screenshot into context per QA cycle (normally the thumbnail, to sanity-check it).

---

## 3. G6 — Adversarial review protocol

Fresh-eyes pass. Adopt the persona: *a strict product manager who did not build this app and wants reasons to reject it.* Inputs walked item by item — every one gets a ✅ or a finding.

**Against the spec**

1. **`reference/requirements.md` `## Features`** — every "the user can …" statement is reachable and works in the running app (use G5 evidence; re-drive the browser where evidence is missing).
2. **SPEC.md acceptance criteria** — every Must feature's criteria, checked against the running app.
3. **SPEC §9 amendments honored** — every row of `## 9. Creation-runner amendments` (the C2 spec-review repairs) is reflected in the build. §9 outranks §1–8 where they conflict, so a build matching the original weak-model text but not its amendment is a MAJOR finding.
4. **DESIGN_SPEC conformance** — screens, navigation, and interactions match what was specified; deviations are either justified in ITERATION_LOG or findings.

**Against the platform**

5. **Per-collection CRUD reachability** — for every collection in the data model, confirm there is an actual UI surface (button/form/menu reachable from the running app) for create, update, and delete. A collection reachable only through the PocketBase REST API is a **MAJOR** finding: G4 proves the route exists, not that a user can get to it.
6. **Ingress implemented** — every collection's declared ingress (user form / bridge pull on load or refresh / scheduled op / computed) actually exists. A spec'd bridge pull with no hook route behind it is a MAJOR.
7. **Empty-database first paint** — a freshly imported app has zero records. Nothing at page load may call an op or filtered query that 400s without data; such calls are gated behind existence checks. This is the single most common V2 launch failure — the host's own verifier fails an app on any first-paint console error.
8. **Kit discipline** — `grep -rn "from '" <APP>/frontend/src/app/` shows imports only from `../kit/index.ts` (plus relative app files and real npm packages); no custom fetch layer, no polling loop, no `window.location.reload()`, no raw `<button>`/`<input>`/`<select>` where a kit component exists.
9. **No hardcoded colors** — `grep -rnE "#[0-9a-fA-F]{3,8}\b" <APP>/frontend/src/app/` must be empty. Colors come from `var(--lui-*)` tokens and Tailwind utilities so host style packs and dark mode keep working. (Colors that are the app's *user data* — e.g. a tier row's color — live in the database, not in source.)
10. **Type-safety escape hatches** — `grep -rn "as any\|: any" <APP>/frontend/src/app/`. Every hit is a MAJOR finding unless the QA report justifies it inline (e.g. a genuinely untyped third-party callback). An `as any` on a PB write almost always means the form/state type has drifted from the collection schema.
11. **Operations hygiene** — every custom `routerAdd` route has an `operations.json` entry (G1's warning list must be empty); every data-deleting op is marked `"destructive": true`; op name, route path, and frontend call site agree (`plan.generate` ↔ `/api/ops/plan-generate` ↔ the fetch).
12. **Migration hygiene** — no already-applied migration was edited (each change is a new file); relation fields use `app.findCollectionByNameOrId('x').id`, never a name; collection rules match `manifest.json`'s `authMode`.

**Product quality**

13. **Required UX** — empty states with a next action, loading states, confirmation dialogs for destructive actions (`useConfirm()`, never `window.confirm`), toasts on CRUD, responsive layout.
14. **No thin tabs** — any tab/section that renders with only a line or two of content is a MINOR finding at least; note whether it should be folded into an adjacent tab or given more depth.
15. **Filter completeness** — for any filterable list, check the full field/tag/flag set against the filters actually offered; a filter surface using only the 2–4 most obvious fields when other plausible facets exist (categorical tags, boolean flags, derived groupings) is a MINOR finding.
16. **Secondary-feature depth** — any feature beyond the core Musts is built out to the same completeness bar as a Must; a shallow bolt-on is a MINOR finding.
17. **Sortable table columns** — for any data table backed by more than ~2 sortable-looking numeric or categorical columns, confirm the obviously-sortable ones are actually clickable-to-sort; if none are, that's a MINOR finding.

**Documentation**

18. **`LIVING_UI.md` is current and placeholder-free** — entities table reflects the real collections (not the blueprint's `items` row), operations section lists the real ops, feature checklist is filled. Mechanical check, must print nothing:
    ```sh
    grep -n "features land here as they are planned/built\|Example starter collection\|Replace or extend via pb_migrations" <APP>/LIVING_UI.md
    ```
19. **Visual polish spot-check** — every functional gate can pass on a build that still reads as a generic prototype; this item exists specifically to catch that. Walk the running app screen by screen: is every discrete content section visually contained (`Card` or a clear boundary — not bare stacked text)? Do interactive affordances use real icon components, not Unicode glyph characters (★☆▲▼✕ etc.)? Does imagery match DESIGN_SPEC's stated treatment (large/central art where specified, not a shrunken icon)? A build that's functionally correct but generic-looking is still a finding (name the specific screens) — MINOR at minimum, MAJOR if a screen is materially thinner than DESIGN_SPEC's own stated density for it.

Findings table (goes in the QA report):

| # | Severity | Where (file/screen) | Expected | Actual |
|---|---|---|---|---|

Severities: **BLOCKER** (broken/unusable/data loss), **MAJOR** (spec violation or quality bar miss a reviewer would bounce), **MINOR** (worth fixing, wouldn't block), **NIT** (polish). Gate passes with zero BLOCKER and zero MAJOR; MINOR/NIT findings don't fail the gate but are carried into the review request's "Known limitations" section — never silently dropped.

---

## 4. Fix–retest loop

```
iteration = 1
run gates in order
  └─ gate fails →
       1. diagnose — read the tool's own output first. `lui validate` annotates the
          offending source line under each error; frontend runtime problems land in
          <APP>/logs/frontend_console.log; server problems are grep hits in
          <APP>/logs/pocketbase.log
       2. fix in an app-owned path only (README rule 5)
       3. re-run per the IMPACT MATRIX below — not a blanket cascade
       4. same identical failure twice fixed, twice back?  → 2-strike stop → BLOCKED
       5. iteration += 1 per fix-and-retest cycle;  > 5 → BLOCKED
all gates green → write final QA report → capture thumbnail (§6) → G7 (§7) → done
```

**Impact matrix** — which gates a fix invalidates (G7 always closes the loop):

| Change class | Re-run |
|---|---|
| Migration / collection schema | G1, G2, G3, G4, G5, G7 |
| `pb_hooks/*.pb.js` or `operations.json` | G1, G3, G4, G7 |
| Frontend `app/` only | G1, G3, G5, G6 delta-check on affected criteria, G7 |
| `LIVING_UI.md` / `reference/` only | G7 |

A QA-script bug (the harness, not the app) is not an app iteration — fix the script and re-run only the script; don't count it against the 5-iteration bound, but do log it. **If a bug traces to platform-owned code** (`living-ui-v2/` kit, blueprint, or tools), fixing it locally is forbidden by README rule 4 — append a `PROPOSAL:` line to [LESSONS.md](LESSONS.md) in the same iteration describing the bug and the fix, and work around it inside app-owned paths if you can. Skipping the `PROPOSAL:` means the same bug silently resurfaces in the next app.

Every iteration writes `runs/<run_id>/qa/qa-report-<n>.md` (§5) and one ITERATION_LOG line (`SELF_QA | iteration 2: G1 failed (tsc: Item.due possibly undefined), fixed guard | next: rerun G1, G3, G5`).

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
| G1 validate | PASS/FAIL | <e.g. "all 6 steps ✓"> |
| G2 fresh-DB launch | PASS/FAIL | <health 200 in Ns; 0 error lines in pocketbase.log> |
| G3 verify | PASS/FAIL | <the JSON verdict line> |
| G4 operations | PASS/FAIL | <n ops run, n collections listed> |
| G5 browser walk | PASS/FAIL | sub-checks: a ✅ b ✅ c ✅ d ✅ e ✅ f ✅ g ✅ |
| G6 adversarial | PASS/FAIL | <#findings by severity> |
| G7 package | PASS/FAIL | <G7-PASS line, file count, zip bytes> |

## Evidence

<per-gate command output excerpts; per-sub-check notes; screenshot paths>

## Findings (G6)

| # | Severity | Where | Expected | Actual | Disposition |
|---|---|---|---|---|---|

## Fixes applied this iteration

- <file>: <what and why>  (or "None.")

## Verdict

<ALL GATES PASS | CONTINUE (re-running from G<x>) | BLOCKED (bound hit: <which>)>
```

---

## 6. Thumbnail capture

During the final green G3/G5 run (app healthy, fresh DB):

1. Seed **2–3 realistic demo records** through the UI (or `$LUI data <APP> <collection> create --json '{…}'`) — an empty app screenshots dead.
2. Re-run `$LUI verify <APP> --url http://127.0.0.1:<PORT>`; it writes a 1280×800 viewport capture to `<APP>/logs/verify/home.png`.
3. **Copy it to `<RUN>/thumbnail.png` now** — G7 deletes `<APP>/logs/` and the capture goes with it.
4. **Delete the demo records** — the human's first launch should feel fresh. (G7 drops `pb_data` entirely anyway, but leaving them means the last screenshots and the shipped state disagree.)

---

## 7. G7 — Package the importable ZIP + audit

The human tests by **importing the ZIP into CraftBot** (Living UI panel → import, or asking CraftBot to run `living_ui_import_zip`). The import registers a *new* project: it reassigns `id` and `port`, strips any shipped `.superuser`, re-vendors the kit, and re-canonizes the ownership hashes. So the deliverable needs to be a clean source tree — nothing to "restore", nothing to substitute.

### Procedure

1. **Stop everything.** No PocketBase or Vite process running. Packaging a tree that is still being written to is how half-finished state reaches the human, and leaving servers up fails the §8 self-check regardless.
2. **Thumbnail out first** (§6) — copy `<APP>/logs/verify/home.png` to `<RUN>/thumbnail.png` before packaging, since `logs/` is excluded from the ZIP.
3. **Run the packager.** It walks the app and applies the same skip rules CraftBot's own exporter uses, so the result is guaranteed round-trippable:
   ```sh
   python agent_file_system/workspace/pipeline/living-ui/scripts/package.py <APP> <RUN>/deliverable/<slug>.zip
   ```
   Skipped: `node_modules`, `pb_data`, `pb_public`, `dist`, `build`, `logs`, `__pycache__`, `.git`, `.venv`/`venv`; suffixes `.pyc .pyo .log .db .sqlite .sqlite3 .tsbuildinfo`; names `.env*`, `.superuser`, `credentials.json`, `token.json`, `.jwt_secret`, `.last_launch`.
4. **Run the audit.** It must print `G7-PASS` and exit 0:
   ```sh
   python agent_file_system/workspace/pipeline/living-ui/scripts/audit.py <RUN>/deliverable/<slug>.zip
   ```
   It asserts: forward-slash entry names; `manifest.json` at the ZIP root with `livingUIVersion: 2` and `id`/`name`/`port`/`authMode`/`pipeline` present; `.lui/system-hashes.json` present; `frontend/src/kit/` vendored; `pb/pb_migrations/` present; `reference/requirements.md` present; zero runtime artifacts.
**Nothing is deleted from disk.** The packager *excludes* paths from the archive; `<APP>` keeps its `node_modules`, `pb_data`, and `pb_public`, so the next `lui validate` or server start still works and a later improvement round doesn't have to reinstall. That is deliberate — the V1 ancestor of this gate mutated the app folder in place and needed a documented restore procedure to undo itself.

**Do not build the ZIP with PowerShell.** `Compress-Archive` and `[IO.Compression.ZipFile]::CreateFromDirectory` under Windows PowerShell 5.1 write **backslash** path separators into the archive (49 of 52 entries in a measured blueprint export), which violates the ZIP spec and is a round-trip hazard for any non-Windows consumer. `scripts/audit.py` fails the gate on backslash entries for exactly this reason.

**Pass criteria:** `G7-PASS`. Any failure: fix and re-run the packager and audit — never hand a dirty ZIP to the human.

---

## 8. Self-check before leaving QA

- [ ] Final `qa-report-<n>.md` shows every gate PASS with terse evidence.
- [ ] All G6 MINOR/NIT findings listed with dispositions (fixed here, or carried to the review request).
- [ ] `<RUN>/thumbnail.png` exists and shows a populated UI.
- [ ] No PocketBase/Vite processes left running.
- [ ] **G7 green: `<RUN>/deliverable/<slug>.zip` exists and `audit.py` prints `G7-PASS`.**
- [ ] ITERATION_LOG line written per iteration (≤2 lines each), including this exit.

---

## 9. Appendix — G5 harness skeleton (`<RUN>/qa/g5.cjs`)

Copy this, then replace the app-specific block with one CRUD flow per collection. Generic checks below are app-agnostic and already correct.

```js
/** G5 browser walk. Run from CRAFTBOT_ROOT:
 *   NODE_PATH="$PWD/living-ui-v2/node_modules" node <RUN>/qa/g5.cjs <baseUrl> <outDir>
 * CommonJS on purpose: ESM would resolve 'playwright' relative to THIS file. */
const { chromium } = require('playwright');
const BASE = process.argv[2];
const OUT = process.argv[3];
const results = [], consoleErrors = [];
const log = (n, ok, d) => { results.push({ n, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} - ${n}${d ? ' :: ' + d : ''}`); };

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', m => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 300)));
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message.slice(0, 300)));
  page.on('response', r => r.status() >= 400 && consoleErrors.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().slice(0, 160)}`));

  // NEVER waitUntil:'networkidle' — the realtime SSE stream never goes idle.
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  log('app mounts', await page.evaluate(() => {
    const r = document.getElementById('root');
    return r !== null && r.childElementCount > 0 && r.innerText.trim().length > 0;
  }));

  // === APP-SPECIFIC: one create → edit → reload → delete flow per collection ===
  // Also assert the designed empty state BEFORE creating anything (fresh DB from G2).
  await page.fill('input[placeholder="<the real placeholder>"]', 'persist me');
  await page.click('button:has-text("Add")');
  await page.waitForTimeout(600);
  log('create visible', (await page.innerText('body')).includes('persist me'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1200);
  log('survives reload', (await page.innerText('body')).includes('persist me'));
  // === END APP-SPECIFIC ===

  for (const w of [360, 768, 1280]) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    log(`no horizontal overflow @${w}`, !overflow);
    await page.screenshot({ path: `${OUT}/g5-${w}.png` });   // artifact only — don't read back
  }

  await browser.close();
  console.log(`console errors: ${consoleErrors.length}`);
  consoleErrors.forEach(e => console.log('  ' + e));
  if (results.some(r => !r.ok) || consoleErrors.length) process.exitCode = 1;
})();
```
