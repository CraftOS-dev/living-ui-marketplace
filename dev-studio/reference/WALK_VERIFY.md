# Independent browser verification — Milestone 0

24 October 2026. Candidate: `.milestone-tools/package-proof`, framework dev instance `http://127.0.0.1:60014`, app identity `96b2985b21c4`. Verifier is a separate agent from the builder. Only disposable candidate data was used.

## Verdict: incomplete

The implemented lab has a working local execution workflow. The two initial UI/operation defects below were corrected and passed targeted re-verification. Overall Milestone 0 remains incomplete until actual CraftBot installation/launch/agent round trip is evidenced. This walk did not simulate either host.

## Targeted re-verification

Updated source candidate `http://127.0.0.1:54690`, identity `59bb058d439e`, checked after both fixes:

- Invalid source root now returns `That folder is not an available CraftBot source checkout. Choose the folder containing app/agent_app/manager.py, then retry.` It shows once inline, preserves input and clears on changing destination. No traceback or duplicate toast.
- Persisted cancelled request `64d61120-c203-47a8-b78d-651a3f668f9d` has status `canceled`, cancellation summary and finished timestamp. A2App record discovery reports `submit-proof-result blocked: status is "canceled", not "queued"`.
- The real standalone parent-run receipt is visible in Overview and Connections as Passed, including the actual submitted review. Data API confirms request `6605bb57-9545-4773-92e8-015be52c88ec` is passed with summary and finished timestamp. The independent verifier did not fabricate/submit the result or duplicate the external run.
- No error/warning console entries appeared in the recheck. Both initial findings are closed.

## Observed passes

- Health endpoint and A2App identity returned the intended identity and framework dev instance.
- All three persistent navigation destinations rendered without a first-paint failure.
- Run local proof showed pending feedback, then recorded a real file path, SHA-256, watcher=true and childExitCode=0. The new receipt `73703413-f051-4ee3-a7e2-7b6fd9f91eef` survived refresh and closing/reopening the browser tab, and was read back through `data proofs list`.
- Terminal empty state includes an action and local-account-permissions explanation. Open terminal launched PowerShell in the disposable proof folder. `Write-Output 'WALK_VERIFY_TERMINAL_OK'` displayed the actual marker.
- Terminal width followed layout changes: `$Host.UI.RawUI.WindowSize.Width` returned 40 at 390px and 126 after returning to desktop.
- Close terminal worked. Stop service showed a confirmation naming terminal/process loss and retained evidence. Confirming with an active terminal showed closed/stopped; process 17312 was absent afterward, and studio-status returned running=false.
- Whitespace-only review title was refused with `Enter a request title.`; no new task was queued.
- Invalid CraftBot-path failure preserved both form values and restored usable controls.
- All six modules were discoverable. Proof/request fields and submit operation signatures were discoverable. Workspace, agents, execution and settings operation declarations were present. Workbench/changes are explicitly deferred placeholders rather than advertised working screens.
- Dark layout was readable at desktop, tablet 768px and narrow 390px. Overview, Connections and live terminal had no horizontal page overflow (390px viewport: document clientWidth=scrollWidth=380).
- Browser console contained no error/warning entries during this walk. Temporary viewport override was reset.

## Initial findings — resolved

1. **Invalid CraftBot root produces a raw Python traceback instead of actionable guidance.** On Connections, enter `C:\does-not-exist-walk-verify` for source folder and `python` for Python, then Inspect compatibility. The UI displays the full command plus `ModuleNotFoundError: No module named 'app'`, duplicated inline and in a toast. The user needs a concise missing/invalid source-folder explanation and a clear correction; internal traceback can remain in optional technical details. This long error also persists when switching to unrelated Overview/Execution screens.

2. **Cancelled framework task remains an actionable queued request to A2App.** Existing candidate request `855c3d1f-230d-48f1-ac02-b1f777a37730` is shown as Cancelled in the UI with `The framework task was cancelled.` But studio-status returns request status=queued, and `agents requests <id>` exposes `submit-proof-result` under HERE without a blocked reason. Reconcile/capability-gate cancelled work, or explicitly explain the intended cancellation/submission contract. No result was submitted by the verifier.

## Unverified / outside this browser walk

- Actual CraftBot native installation/launch/round trip: known host-import compatibility blocker, not a pass.
- Real standalone automatic dispatch and agent-only result submission: parent-run integration proof; its stored result and browser presentation were independently read back in the recheck. Update-without-reload was not observed during the run itself.
- Invalid/replayed/expired/foreign-origin terminal ticket rejection and app-parent disconnect cleanup: protocol/runtime tests required; ordinary browser actions cannot prove these attacks.
- Clean package dependency installation/build: parent-run packaging proof, although this walk did exercise its served candidate.
- Light theme: browser exposed viewport/visibility capabilities only and no app theme control was available. Dark verified; light not claimed.
- Slow/offline backend simulation and 1,000-record volume were not induced.
- No create/update/delete CRUD UI is advertised for evidence; records are intentionally server-managed and append-only.

The targeted UI/operations recheck passed. A UI pass alone does not complete Milestone 0; native CraftBot is still a release gate.
