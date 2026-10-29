> Historical milestone-zero evidence. The completed workspace and current release verification are documented in RELEASE_EVIDENCE.md. Scope statements below describe the original integration lab.

# Milestone 0 evidence
Verified on 24 October 2026, Windows, Node v24.19.0.
## Current result: integration proof passed; native visual follow-up blocked
The new-framework lab builds and runs. Local execution, terminal transport, real standalone delivery and actual CraftBot native import/agent completion pass.
The separately authorized host patch fixes native format/lifecycle/task delivery. An unpatched CraftBot still classifies the app as foreign.
The full development workspace has not been started, and no catalogue entry was published.
## Native CraftBot follow-up
The real host ran from D:\Work\CraftOS\CraftBot on dedicated ports 8925/8926, with the trusted pinned framework checkout and only studio-craftbot-proof enabled for host delivery.
- Clean ZIP source SHA-256: 509874db6472708ebaa66e560642c448134f339bab3a2fd18986fcecd173d9ee (the first successful package; later documentation/proof scripts may change the export hash).
- Native imported app bf4de299aab9, format 0.1.0, port 3100, session agentapp_bf4de299aab9. Fresh identity/port and token were provisioned by the official framework import command using the trusted React/Node blueprint. No PocketBase kit, foreign adoption or relabeling.
- Real request 109cbccb-8535-40a4-86dd-d5021d1d0ab1 linked local proof f9fe675c-5abb-4933-9125-28b7525fffbc. CraftBot calculated 26+212=238, checked the physical marker and SHA-256, and read watcher=true/child exit=0.
- Domain result stored passed at 2026-10-24T20:24:28.505Z; framework task tsk_72a2aa8b2a4ebeb1 completed at 20:24:38.132Z. The proof driver only queued/polled; it supplied no answer or substitute agent.
- After a real host process restart, the native result persisted. At 20:29:55Z the lifecycle proof confirmed actual worker and PTY processes started, both died on host app-stop, the app port closed, relaunch preserved identity, and a claimed task/domain request canceled to canceled.
- New host regressions: 8/8, including actual runtime queued cancellation, a held dequeue-to-turn race, and shutdown despite task HTTP timeout. Existing trigger/runtime pytest: 40/40. All 26 format-2 data-safety sections and trigger-plane acceptance pass.
- Current framework candidate gate: ok=true, unchecked=[], promotable=true. API smoke: all seven groups passed. Standalone repeated at 20:29:06Z with Codex CLI: request 7b9472f1-1f9b-41fe-acdd-c10d53527392/task tsk_eaf8154609d94507, passed/completed, exit 0.
- Independent verifier directly observed native task working then completed and request queued then persisted passed, audited the host changes, and reviewed the regression tests. Its browser runtime returned no available browsers, so the native visual follow-up remains blocked. UI code is unchanged by this follow-up; previous UI verification remains in WALK_VERIFY.md.
Portable host implementation, tests and setup: ../craftbot-compatibility/ in the parent repository. Independent follow-up: WALK_VERIFY_CRAFTBOT.md. Runtime reports remain excluded in .a2app/evidence/.
- Final host after restart: request 8acb76c4-6807-47a3-b0d5-34ecae0a56f2 passed; task tsk_9da100e1ffe661f0 completed at 20:32:15.257Z. Its linked proof is f9fe675c-5abb-4933-9125-28b7525fffbc (the driver separately created proof 56dd397b-9279-43ca-908f-41a8dbaf78ef; it does not imply that newer receipt was reviewed).
- Standalone also ran inside that same CraftBot-imported app: request f2042738-f19f-42b3-89ad-79544e8a8fa2/task tsk_b57f66a2f43b4c3e passed/completed, Codex CLI exit 0, checked at 20:32:26.530Z. Host delivery and standalone bridge operated independently on their distinct capabilities.
## Verified paths
| Check | Evidence |
|---|---|
| Framework source pin | Agent-App 5e9c7a1e28fd4742cbb49e49188d63031f35c145; React/Hono/SQLite blueprint |
| Ownership | server.mjs and a2app-update.js independently SHA-256 compared byte-for-byte with pinned upstream; framework ownership gate passes |
| Framework candidate gate | All checks pass, unchecked=[], promotable=true; fresh database boot via framework dev |
| Local proof | Real file written/read, native fs.watch observed, separate Node child exit0, SHA-256 read back |
| Runtime integration tests | 3/3 pass: real PTY/I/O/origin+ticket rejection+shutdown; actual ticket expiry; parent IPC disconnect closes real shell and listening service |
| App API smoke | 7 groups pass: identity; real proof; agent refused UI-only terminal; authority-field forgery refused; wrong/late result refused and cancellation persisted; real terminal; stopped runtime |
| Standalone actual harness | Codex CLI, framework bridge headless route, normal sandbox/automatic approval review enabled; no permission/sandbox bypass flag |
| Standalone completion | Request 6605bb57-9545-4773-92e8-015be52c88ec; framework task tsk_dd526a98d3bd3466; request passed; task completed; process exit0 at 2026-10-24T19:52:50.074Z |
| Agent's stored result | Calculated 181 + 147 = 328; linked local-execution evidence reports passed=true, watcher=true, childExitCode=0 and a recorded SHA-256 |
| Package independence | ZIP extracted into a clean folder, npm ci completed using the bundled packages, framework import assigned fresh identity/port, dev boot/gate passed without the original framework checkout |
| Browser verification | Separate verifier exercised proof persistence, actual terminal/resize/close/stop, forms and layouts at desktop/768px/390px; both found defects fixed and rechecked |
## Historical CraftBot observation before the host patch
The real local CraftBot host answered /api/state on dedicated test port8926: idle, onboarding complete.
Its actual AgentAppManager._find_project_root was invoked against this app, not mocked.
- App format: string0.1.0.
- Detected native root: null.
- Host classifier SHA-256: 328c3a4391af906adb29b11f69fdd6fc49fba596199900d5873039f32709ba7d.
- Current native and marketplace import gates require numeric2 and run a PocketBase-oriented lifecycle.
That refusal prompted the separately authorized host patch described above; it is retained as historical evidence.
## Harness diagnostics
Claude Code is installed but its auth status reports loggedIn=false/authMethod=none; its delivery attempts did not produce a validated result.
A first Codex attempt under read-only execution timed out. The successful run used the documented --approve-for-me path: workspace sandbox plus automatic approval review. It inspected evidence and submitted through the app's A2App client; it did not edit source.
The test adapter's arithmetic challenge checks this request was read. It is not proof of coding quality or model identity; actual framework dispatch/process evidence establishes the harness used.
## Limits of this proof
Milestone zero is an integration lab, not an IDE. No editor, arbitrary project execution or Git delivery workflow is advertised.
The native integration gate now passes; the independent native browser verdict remains environment-blocked and is not a new visual release approval.
Light theme and synthetic slow-backend/1,000-record load were not browser-certified in this milestone. Dark, narrow/tablet/desktop and the tested runtime/security paths were observed.
Test records in framework dev databases are disposable. The curated facts above and WALK_VERIFY.md preserve what was observed before candidate cleanup.
## Reproduction
    npm ci
    npm run framework -- . import --blueprint blueprint-dev-studio
    npm run framework -- . dev
    npm run framework -- . validate
    npm test
    npm run smoke
    node scripts/standalone-proof.mjs
An authenticated Codex CLI is required for the last command. Claude alternative: append --claude, using a configured authenticated Claude installation.
scripts/client.mjs targets the active framework dev instance, or the live manifest port; STUDIO_URL can select a specific test URL.
Use the Connections form to run the actual importer against the desired CraftBot source folder and its configured Python interpreter.
