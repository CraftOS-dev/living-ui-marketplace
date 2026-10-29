# Independent direct browser verification

25 October 2026. Separate verifier context `/root/release_browser_verify`; no implementation edits or agent dispatch. Binding requirements: `requirements.md`, its M1–M5 additions and `RELEASE_PLAN.md`. This report supplements the independent API, provider, safety, Git and formatter evidence in `WALK_VERIFY_RELEASE.md`.

## Verdict: pass for the final source browser walkthrough

Source candidate `http://127.0.0.1:62994/`, health identity `59bb058d439e`, was directly controlled through CUA in this independent context. The earlier verifier's browser-environment blocker does not apply to this new context. After official final native promotion/relaunch, this verifier also directly smoke-tested `http://127.0.0.1:3101/`: health identity `42e1dea9d1ba`, app version `av_ee9144fcfc94fc4b`, correct persisted rejected-review state and disabled Apply/Reject, retained real revision/test evidence, reachable Diagnostics and return to Workspace, and empty console warning/error reads. Final clean-package installation remains a separate release check; this browser verdict does not assert an unobserved clean installation.

All new records and disk edits used explicitly disposable fixtures. The verifier created JavaScript and Python starter projects through the real welcome UI at `C:/Users/ahmad/AppData/Local/Temp/studio-direct-browser-release-20261025` and `C:/Users/ahmad/AppData/Local/Temp/studio-direct-python-release-20261025`. No real project or secret was modified. Actual agent results were inspected, never fabricated or submitted by this verifier.

## Directly observed

- Welcome/new project, recent-project picker, explorer and Monaco editor render correctly. New projects begin in inspection mode with formatting/debugging disabled. Execution requires an explicit modal naming local-account permissions.
- Typed an unsaved JavaScript marker, then opened a genuinely fresh same-origin tab. The exact marker and cursor 5:1 recovered. Saving cleared the dirty marker; independent filesystem reading confirmed actual bytes on disk.
- With a dirty buffer, changed that disposable file externally, then clicked Save. CAS refused the write and preserved editor text. Compare disk opened a real Monaco comparison. Explicit Reload disk required confirmation and retained the external disk marker.
- Saved Python edits persisted on disk and through reload. Two clean tabs reopened after asynchronous recovery, preserving the selected test file/cursor 2:22. The initial loading shell briefly has no tabs; this was not mistaken for final data loss.
- Opened two real PowerShell terminals. Distinct commands printed `DIRECT_TERMINAL_ONE` and `DIRECT_TERMINAL_TWO`; each output survived tab switching. Closed each owned terminal and reopened terminal one successfully. The terminal occupies the available panel height after the builder's layout correction.
- Node debugger started paused at line 1; Step over paused at line 2; Continue produced `Hello, world!` and terminated. A second launch with a gutter breakpoint at line 2 stopped there after Continue; Step in opened greet at line 1 and displayed the real local `name = world`. Stop terminated it. Removing the breakpoint removed its red gutter dot. Python debugpy, using the installed tools interpreter, paused at line 1, stepped to line 4, then continued to actual output and termination. Call stacks and Python locals categories appeared.
- F12 on Python's `from main import greet` opened the actual main.py definition at 1:5. Invalid unsaved Python `BROKEN =` produced Problems (1) with Pyright's expected-expression diagnostic. Restoring the exact original text removed the diagnostic and dirty state.
- JavaScript Ctrl-Space after `console.` displayed typed Console method completion. Ctrl-K, Ctrl-I displayed the console.log signature and documentation. Split showed two Monaco panes of the current file.
- The saved Python test command ran a real unittest: passed, exit 0, one test. After a saved source edit, Refresh result labeled that successful run `Out of date: source changed`.
- The restarted actual loopback web preview at `http://127.0.0.1:55309/` rendered `MANUAL_WEB_PREVIEW_VERIFIED`.
- At 390×844, Files/editor/debugger and Work remain reachable, with document scrollWidth exactly 390. At 768×1024, light mode is readable and document width exactly 768. System theme and the default viewport were restored.
- Modal Shift-Tab wrapped from Close dialog to the final Open folder button; Tab wrapped back. Escape closed the modal and returned focus to its Open folder opener.
- Source and native UI console warning/error reads were empty during this walk. Actions showed pending state, success feedback or explicit conflict errors rather than silent failure.

## Actual agent output and review consistency

Native app `http://127.0.0.1:3101/` displayed the real CraftBot work `1c2af2b7-e85f-4851-b98d-305e1e767781`, its revision summary, progress, real three-test/exit-0 evidence and actual main.js Monaco diff. At 390px, internal review scrolling reached selected-file controls, Apply/Reject and the diff without page overflow.

The builder separately exercised native unsaved-buffer application refusal and rejection. Its proxy screenshots are `ui-release/native-{unsaved-block,real-diff,rejected}`. This verifier independently opened a fresh native tab afterwards: the work and review both persisted as Rejected; Apply and Reject were disabled, and revision/progress evidence remained available.

An already-open older native review initially retained a stale Ready header after a rejection in another tab, while its agent panel updated to Rejected. This was reported to the builder. After the source fix/rebuild, this verifier reproduced a real two-tab rejection using retained standalone question/resume work `117a9897-2556-4a67-aecd-fd1d1d354ac8`. The second tab rejected through the confirmation UI. The first open review then updated, without manual reload, to Rejected in both header and agent panel, with Apply/Reject disabled. An independent disk read confirmed the main project retained greet and did not gain multiply; the isolated result remains retained. The builder then promoted the source correction to native; final native smoke verification is recorded above and in `native-final-promoted.{png,txt}`.

## Evidence and limits

Real screenshots and full DOM snapshots are under `.a2app/evidence/direct-ui/`: `recovered`, `conflict`, `terminal-one`, `node-debug`, `python-debug`, `diagnostics`, `stale-check`, `clean-tabs-restored`, `narrow`, `tablet-light`, `web-preview`, `native-review-narrow`, `native-review`, `native-rejected`, and `external-rejection-fixed`.

This direct browser pass is combined with prior independent execution/provider/operations/safety results and explicitly identified builder-driven proxy scenarios. It does not relabel those prior API or proxy checks as direct browser actions. No new external agent execution, marketplace publication or final-package installation was performed by this verifier.

## Final development-service follow-up

Independently audited the final app-owned timeout change: saved configurations of kind `develop` and the standalone bridge pass timeout 0; `jobStart` records this as `timeoutMs: null` and creates no timer. Other saved commands retain the 600,000ms bound. Explicit stop and runtime shutdown retain owned-process termination.

At refreshed source candidate `http://127.0.0.1:50346`, independently ran `scripts/develop-lifetime-verify.mjs` through actual human HTTP operations. It created a fresh disposable project/configuration, started real `node service.mjs`, read `INDEPENDENT_SERVICE_READY` while status was running and timeoutMs was null, verified an ordinary check recorded timeoutMs 600000, then stopped the service. The returned status was canceled with stopConfirmed true; an independent OS liveness check confirmed the service PID was gone. Evidence: `.a2app/evidence/develop-lifetime-independent.json`.

Independently reran the targeted real runtime regression `development services outlive bounded checks and still stop explicitly`: passed. The bounded job timed out and confirmed termination while the persistent service remained running, then explicit stop terminated that service.

Also audited the optional Windows lifecycle preloader. It retains the original rename operation and only retries EPERM/EBUSY/EACCES for a source whose resolved name starts with the destination plus `.staging-`, where the destination's parent is `.a2app/backups`. Other operations/errors throw immediately; matching retries stop after eight seconds. It does not skip a backup, change its contents or bypass a gate. This helper assessment is source audit, not a simulated sharing-violation runtime claim. No follow-up defects found.
