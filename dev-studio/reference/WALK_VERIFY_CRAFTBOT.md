# Independent CraftBot verification — Milestone 0

24 October 2026. Scope: the appended requirement permitting CraftBot compatibility changes, native clean-package import, managed lifecycle and real agent task delivery. This verifier did not build the implementation, submit an agent result or start another harness run.

## Current verdict: blocked

**Native integration/data path: pass. Browser check: blocked by environment.** The lifecycle audit findings below were corrected and their targeted regressions passed. Native browser verification is blocked because CUA currently reports no available apps or browsers; this must not be represented as a visual pass. App UI source is unchanged from the earlier independently walked lab; this follow-up changes the host, proof scripts and documentation.

## Final proof after host restart

The verifier independently read final persisted records and framework tasks from the actual native imported app, without issuing another request or submitting any result:

| Mode | Request | Framework task | Stored outcome |
| --- | --- | --- | --- |
| CraftBot | `8acb76c4-6807-47a3-b0d5-34ecae0a56f2` | `tsk_9da100e1ffe661f0` | Request passed at 20:32:08.740Z; task completed at 20:32:15.257Z |
| Standalone Codex CLI | `f2042738-f19f-42b3-89ad-79544e8a8fa2` | `tsk_b57f66a2f43b4c3e` | Request passed at 20:32:22.227Z; bridge task completed at 20:32:26.481Z, exitCode=0 |
| Cancellation | `1b61f9e4-a106-4b07-a0ab-ff9ed785b31b` | `tsk_5cfe743134628832` | Task canceled after actual claim; request persisted canceled with finished timestamp and cancellation summary |

Both completed review requests link actual local receipt `f9fe675c-5abb-4933-9125-28b7525fffbc`. The verifier independently read its proof file: marker matches `studio-753669cf-d0cd-4603-9f80-f5f849d00e4b`, and independently computed SHA-256 matches `778b7dc8b127614384747c9e42325a6e822a24739fe675ce9130c8353d5a369a`. Receipt records watcher=true and childExitCode=0. CraftBot solved 151+57=208; standalone solved 126+138=264. This is genuine shared app operation with both delivery routes, not a simulated response.

The current app identity still resolves to `bf4de299aab9` at port 3100. The original request remains stored passed after restart. The verifier also read parent-run `.a2app/evidence/craftbot-lifecycle.json`, which records restart persistence, worker/PTY startup then cleanup, closed app port, same identity after relaunch, and canceled task/request, all passed. Those historical lifecycle process observations are parent-run evidence; their stored outcomes and regression implementations were independently inspected here. Sanitized CraftBot and imported-app standalone evidence reports agree with the persisted completed tasks.

## Independently observed native proof

- Actual installed app folder: `D:/Work/CraftOS/CraftBot/agent_file_system/workspace/agent_app/development_studio_m0_native_proof_78177ecf`.
- A2App identity at port 3100 returned app `bf4de299aab9`, name `Development Studio M0 native proof`, adapter 0.1.0.
- Request `109cbccb-8535-40a4-86dd-d5021d1d0ab1` was read as queued while its framework task `tsk_72a2aa8b2a4ebeb1` was working with progress `CraftBot session agentapp_bf4de299aab9 reviewing evidence`.
- Subsequent independent reads returned request status=passed, agent=local, finished=`2026-10-24T20:24:28.505Z`. The summary identifies linked proof `f9fe675c-5abb-4933-9125-28b7525fffbc`, independently matched marker/SHA-256, watcher=true, childExitCode=0, and challenge 26+212=238.
- Framework task subsequently returned completed at `2026-10-24T20:24:38.132Z` with its actual result summary. The sanitized `.a2app/evidence/craftbot.json` agrees with these directly read records.
- The durable binding read during execution named the actual task, trigger 5194, app session and claim timestamp. No fabricated host or manually submitted result was used by this verifier.

## Audit findings

1. **Stop could skip process teardown when task reconciliation failed — resolved.** Initial `FrameworkHost.stop` awaited cancellation and task HTTP reads before invoking CLI stop, so a stale binding/offline task API could raise and leave owned processes running. Updated code wraps reconciliation in try/except and invokes CLI stop in finally, preserving the binding for later reconciliation. The timeout regression confirms CLI stop is called and the unresolved binding is retained.

2. **Cancellation must remove queued runtime work, not only its durable store row — resolved.** Initial `cancel_run` called `runtime.request_stop(session)` then `store.cancel(trigger)`. The runtime explicitly preserves ordinary queued triggers; the consumer could later execute the still-enqueued APP_REQUEST despite its canceled store row. Updated code purges the exact trigger before stopping an active turn, while the consumer synchronously filters canceled rows immediately before claim/spawn. This also closes the dequeue-to-turn handoff window. Real SessionRuntime regressions cover waiting-in-queue and held-pop_due_batch cancellation; the latter confirms the callback never executes and the row remains cancelled.

3. **Failed/stale trigger monitor needed active-run teardown — corrected in source.** The current monitor now calls cancel_run before failing the framework task when the trigger is missing, FAILED/DEAD or cancelled/superseded/stale. Recheck it alongside cancellation fixes.

The verifier read the updated source and the actual `test_framework_host.py` regression implementation plus `.milestone-tools/framework-host-tests.log`: all 8 tests passed, including both real-runtime cancellation cases and API-unavailable teardown. No remaining concrete source defect was identified in these corrected paths.

Additional regression logs independently read: `trigger-runtime-tests.log` reports 40 passed; `craftbot-regression.log` reports Data-safety acceptance ALL GREEN through section 26; `craftbot-trigger-regression.log` reports Trigger-plane acceptance ALL GREEN. These are parent-run tests, not additional verifier-created results.

## Environment limitation

`cua.createBrowserTab('iab', 'http://127.0.0.1:3100', ...)` reports browser unavailable. `cua.getState()` returns `{apps: [], browsers: []}`. Thus native UI transitions, refresh/reopen persistence and console were not observed in this follow-up. Previous standalone lab UI verification remains documented in WALK_VERIFY.md but is not a substitute for this native-instance check.

Actual host stop/restart/cancel tests are now recorded as passed in the lifecycle report above. No source audit defect remains open. The browser limitation remains explicitly unresolved; the full workspace remains outside this milestone.
