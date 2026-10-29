> This earlier API/proxy verifier could not access a browser. The later independent direct-browser pass is documented in DIRECT_UI_VERIFICATION.md and supersedes that environment blocker. The observations below remain separately attributed.

# Independent first-release verification

25 October 2026. Requirements: appended M1–M5 changes and RELEASE_PLAN.md. This is an in-progress independent audit; it is not a release pass. The verifier does not edit implementation, dispatch real agents or submit agent results.

## Current verdict: blocked

The blocker is the independent browser environment, not a demonstrated application failure. A final retry after refreshing CUA documentation returned `apps=[]`, `browsers=[]`; creating a fresh tab on the selected browser returned `Browser is not available: 2`. The walk-verify skill explicitly requires a real independent browser walk and says never to report an unavailable environment as pass. API/data/security checks below have passed where stated; proxy browser evidence remains useful but does not remove this direct-browser limitation. Some final proxy UI and package evidence is still being collected.

Browser inventory returns no apps/browsers in this verifier context. Browser evidence therefore uses the explicitly identified proxy workflow below. Findings come from source audit unless a reproduction or UI artifact is named. All reproduction data is disposable; no real project or credentials were modified.

## Independent assessment of proxy UI evidence

Because the verifier's CUA remains unavailable, the builder executes verifier-directed UI scenarios using its working CUA and saves real screenshots/full DOM snapshots; this verifier independently assesses them and reads resulting fixture files. This is explicitly proxy-driven evidence, not a claim of direct browser control.

Candidate `http://127.0.0.1:65041`, disposable UI-created JavaScript project `C:/Users/ahmad/AppData/Local/Temp/studio-independent-ui-20261025`:

- Welcome screenshot has reachable open/new/clone actions and recent projects.
- Real Monaco editor is visible with starter source, and inspection mode correctly disables command/format/debug execution.
- An unsaved `// UNSAVED_RECOVERY_VERIFY` marker and cursor 5:1 survived opening a genuinely fresh same-origin browser tab. This was used because a normal reload may have been canceled by the beforeunload dialog.
- Saved screenshot/DOM show success feedback, no dirty marker and Save disabled. Independent filesystem read confirms the marker actually reached main.js.
- Parent-reported fresh-tab console warnings/errors were empty; console was not directly accessible to this verifier.

Evidence: `.a2app/evidence/ui-release/{welcome,project,unsaved,recovered,saved}.png` and corresponding `.txt`. Some initial text artifacts are accessibility diffs rather than full snapshots; recovered/saved include full DOM state. Further scenarios are recorded below.

Further independently assessed proxy evidence:

- `conflict-refused` and `conflict-diff` show actual rejected CAS save, retained unsaved editor marker and disk-vs-editor difference. Explicit reload retains the external marker; `mixed-eol-fixed` now shows a clean buffer after the programmatic-load fix.
- `manual-test` shows the real one-test run Passed/exit 0; `manual-stale` shows the same result marked out of date after source changes.
- `light-desktop`, `light-narrow` and `review-narrow` show readable light mode, 390px layout and reachable review/apply controls after the narrow Work-layout fix. Parent measured scrollWidth=viewport=390.
- Full `review-partial` DOM shows only main.test.js applied, with main.js still selectable. Full `review-conflict` DOM includes the human destination marker, current-project/agent comparison, merged textarea and explicit save control (its screenshot is scrolled above the comparison). `review-applied` shows both files applied and actions disabled. Independent filesystem read confirms final main.js contains farewell AND HUMAN_DESTINATION_VERIFY.
- Keyboard wrap evidence shows first/last focus containment. Original focusReturn=null identified a restoration defect; source correction captures the opener before autofocus, but final rebuilt UI recheck is pending.

## Independent execution and provider readbacks

| Route | Actual work / framework task | Independently observed outcome |
| --- | --- | --- |
| Standalone, candidate 57823 | `f4d283aa-6dfa-4d33-be60-4a0d650d0c3a` / `tsk_03dc103262be9c81` | Work ready; task completed under studio-development-standalone. Run `9c10d68d-c1cb-42ab-a5a5-fa7d4f0d2dd3` passed, exit 0, two tests, stale=false. Isolated source/test files contain farewell/Ada assertion; main source was independently unchanged before UI acceptance. |
| Actual native CraftBot, app 42e1dea9d1ba at 3101 | `1c2af2b7-e85f-4851-b98d-305e1e767781` / `tsk_ba333b7aaa7f0884` | Work ready; task completed under studio-development-craftbot. Run `0788bf62-ce3a-4ffa-bf47-e8f70628c8fa` passed, exit 0, two tests, stale=false. Independently read isolated farewell/test changes and main fixture still containing only original greet/test. Native identity matches imported app. |
| Final source question/resume, 62994 | `117a9897-2556-4a67-aecd-fd1d1d354ac8`; initial `tsk_d379e700882476f7`, resumed `tsk_31ed2e630e944513` | Independently observed initial working receipt, preserved question/actual multiplication answer, then a distinct resumed task. Final work ready/task completed; run `c6464ce9-8782-4a0a-baf4-ff40b5efafae` passed two tests/exit 0/stale=false. Isolated source and assertion contain multiply(6,3)=18, while main source remains unchanged. Raw independent readbacks are retained in `question-resume-independent.json`. |
| Promoted native CraftBot revision, 3101 | Same retained work `1c2af2b7-e85f-4851-b98d-305e1e767781`, new task `tsk_f6498d274b74a259` | Independently read ready/completed native receipts after official candidate promotion. Actual run `5e8f3e30-1222-4ae8-b6d8-b21781cc49de` passed three tests/exit 0/stale=false. Isolated files retain farewell/Ada plus the new empty-name assertion; main project still unchanged. Raw task/work/run/files readback is retained in `craftbot-revision-independent.json`. |

Neither provider result was submitted by this verifier. Readbacks were actual A2App records/tasks plus disposable filesystem files, not summaries alone.

The verifier independently executed `scripts/git-delivery-verify.mjs` through actual app operations: init, stage, unstage, commit, history, push to a disposable local bare repository, app clone, peer app commit/push, fetch and fast-forward pull all passed with a clean final working tree. Evidence: `.a2app/evidence/git-delivery.json`. No user repository or external remote was used.

The verifier independently executed `scripts/formatter-verify.mjs` through actual app operations with the selected tools interpreter: Black formatted exactly 65,536 input bytes through stdin; prior preferences were restored. Evidence: `.a2app/evidence/formatter.json`. The 3MiB text/binary metadata case independently matched real hashes and is preserved in `test/safety.test.mjs`.

Runnable independent safety regressions are preserved in `test/safety.test.mjs`: protected case paths, single concurrent writer/provider capability, real Windows registered worktree and tracked fake-secret scrub, managed human save versus review CAS, fsmonitor positive control followed by safe inspection, and large metadata. The initial five passed together; the added large-file case passed its targeted run. These tests explicitly use inert dispatch/synthetic review structures only for domain safety testing and do not claim external provider success.

Final source safety suite expanded to **12/12 passed**, adding zero-byte create/populate/clear, binary conflict resolution, non-UTF8 loss prevention, safe bounded generated-artifact metadata, explicit environment-name references and refusal of revisions after partial acceptance. It verifies refused text merge, wrong-digest byte replacement preserving the human file, correct-digest agent-byte replacement and a recovery checkpoint exactly matching the previous human bytes. The CAS regression still passes after replaceBytes refactoring. Refreshed-server HTTP zero-byte creation and clearing passed independently at 62994, with disk size/content readback (`scripts/empty-file-verify.mjs`, `.a2app/evidence/empty-file.json`).

The non-UTF8 regression initially reproduced a real data-loss risk: a CP1252 byte was decoded into an editable replacement character. After the isUtf8 guard, the original digest remains accurate and text is null, preventing a lossy editor round trip. Artifact tests verify exclusion of fake `.env`, refusal of `../` paths, accurate digest/time metadata and the 100-file bound. Environment tests use only a fake value and verify exclusion unless its variable name is explicitly referenced.

At final source candidate 62994, `scripts/artifact-verify.mjs` independently ran an actual Node build through saved configuration/run operations. The passed/exit-0 run recorded `dist/result.txt` with its actual 25-byte size and SHA-256; disk bytes and `run-artifact` output matched. Reading an unrecorded source path through run-artifact was refused. Evidence: `.a2app/evidence/artifact.json`.

At upgraded native candidate 53689, independent HTTP reflection verified identity `42e1dea9d1ba`, six modules/15 entities, and current work-revise/run-artifact definitions. Zero-byte create/populate/clear passed with disk readback. Evidence: `.a2app/evidence/native-api.json` and `native-empty-file.json`. This candidate verification permits promotion testing; it is separate from final live native acceptance.

Independent A2App walk at 57823 confirms module-level file operations are discoverable, and applied work/reviews truthfully block active-only reporting/cancellation and ready-only application/resolution/rejection. A raw CRUD attempt to change the trusted flag of the verifier's disposable project was rejected read_only_field; readback confirmed the flag unchanged.

## Historical findings and rechecks

The numbered findings document issues raised during development, rather than a list of current unresolved defects. Corrections and independent rechecks are described above/below; remaining UI/package checks are tracked separately.

Recheck update: findings 1, 2 and 3 are resolved by actual reruns of the same disposable reproductions: `.GIT/config` blocked; concurrent starts produce one dispatch/one rejection; tracked fake `.env` absent from worktree. Finding 6 is corrected in source with distinct per-mode capabilities. Finding 5's identified managed-operation race is corrected by shared work lease locks. Finding 12's fsmonitor fixture is now blocked and safe diff flags are present. Process/debug cleanup fixes are in source and need runtime rechecks. Review apply now holds sorted canonical path locks, but checkpoint restore still needs the same protection and review-resolve must also wait for terminal agent delivery. Findings 9–11 await correction/UI verification.

Further recheck: concurrent real human writeDocument plus review-apply kept disk=`human` and returned applied=[]/conflicts=[a.txt]. Windows registerRoot→work-start now reaches worktree=true after normalized roots. A real disposable Node parent and spawned descendant were both dead after killOwned. Three actual JS debugger startups with invalid breakpoint parameters each failed cleanly and did not exhaust the session cap. Checkpoint restore locking, review-resolve terminal-delivery check, newer-editor-text retention, definition URI/opener mapping and reusable breakpoint collection are now present in source; their UI behaviour remains unverified. Definition opener should also forward the target selection/range rather than opening at the recovered/default cursor.

1. **Windows protected Git path bypass (observed).** `safePath` compares `.git` case-sensitively. Actual call on a disposable NTFS fixture allowed `.GIT/config`. This permits managed operations to touch Git internals using case variants. Protected checks and lock keys need platform-consistent canonicalization.
2. **Concurrent agent writers (observed).** Two simultaneous `work-start` calls for different work items on one project both pass the pre-prepare check and dispatch. Isolated test used inert trigger callback, yielded dispatches=2 and two fulfilled starts. Serialize the project lease before preparation/dispatch.
3. **Tracked credential inheritance (observed).** Git worktree preparation inherits committed `.env`; both baseline/inherited snapshots omit sensitive files, so cleanup never removes them. Disposable fake-credential fixture yielded trackedCredentialInherited=true. Remove excluded tracked sensitive files from the isolated working tree without exposing their contents.
4. **Review application is not protected by the save CAS lock.** Destination digests are checked before asynchronous checkpoint/copy operations. A human save between the check and copy can be overwritten. Apply/restore must use the same canonical file lock and revalidate the expected digest at mutation time.
5. **Cancellation can race managed writes/results.** Work scope and active() check status/task before awaiting filesystem/task calls; concurrent cancellation can be followed by an unchecked write or active() resetting status to running/ready. Lock/recheck the lease at mutation boundaries; prevent late completion from resurrecting cancellation. Do not leave isolated command processes mutating a ready-to-review source tree.
6. **Selected provider is not enforced.** Both modes emit `studio-development`, and both standalone bridge/CraftBot can subscribe to it. Payload contains only work ID; either provider can win the claim. Route the selected mode through distinct capabilities or an equivalent enforced claim rule.
7. **Command-stop can falsely claim success.** killOwned ignores Windows taskkill failure; jobStop labels canceled before death and returns after at most one second. stopJobs ignores already canceled/timed-out children. Propagate kill errors, verify liveness and clean still-live children regardless of status label.
8. **Debugger startup failures leak processes/sessions.** JavaScript startup/request failures and later Python initialization failures lack enclosing cleanup; sessions can remain starting and processes alive, exhausting the two-session cap. Dispose process/socket/pending requests and mark failed on every startup error. Failed language initialization likewise leaves a cached uninitialized session.
9. **Saving can discard newer editor input.** saveBuffer captures a buffer before awaiting disk save, then replaces it with that snapshot after return. Text typed during save is overwritten. Update baseline/digest while retaining newer text, or gate editing safely during the save.
10. **Definition navigation lacks a project file opener.** LSP returns file:// locations while models use studio:// URIs; no registered opener loads the target file into Workspace. F12 across files needs UI verification and a validated URI/open-file bridge.
11. **Breakpoint decorations accumulate.** Every breakpoint update creates another decorations collection without clearing/disposal, leaving old gutter dots visible after removal.
12. **Inspection-mode Git can run repository helpers.** git-status/git-diff permit an untrusted project and use repository config unchanged. Disable core.fsmonitor, external diff and textconv for inspection so viewing Git state cannot run project-configured helpers.
13. **Windows registered Git projects silently fall back to plain copies (observed).** detect() returns a forward-slash Git root while fs.realpath returns backslashes. prepare compares strings without path normalization. An actual disposable registerRoot→work-start fixture returned root=`C:\...\source`, gitRoot=`C:/.../source`, worktree=false despite a committed repository. Normalize the roots before comparing and verify the real registration flow reaches detached worktree creation.
14. **Narrow review is hidden by Work layout.** At max-width 640px, active Work tool hides workspace-main. showReview leaves Work active and renders its review inside that hidden main. A ready item's Review action needs to enter a visible review layout so narrow users can inspect/apply.
15. **Modal keyboard containment.** New workspace modals/palette use aria-modal but lack focus containment/restoration. Verify Tab/Shift-Tab stay in the visible dialog and return focus when closed.
16. **Old attempt drain/binding.** Resume marks a task failed and queues another without connector-stop confirmation; settled() checks only terminal task state. Mutations identify work ID rather than an expected attempt/task. An old still-running agent must not acquire a later attempt's write lease. Cover immediate answer/resume/retry in actual provider tests; drain the old run or bind mutations to an attempt.
17. **Revision after partial acceptance retains stale applied tracking (source audit, resolved).** `work-revise` originally accepted ready work with already-applied paths while retaining `w.applied` and the original baseline. The corrected runner refuses with an actionable new-work-item message before dispatch or state mutation; the regression confirms unchanged attempt/status and zero dispatches.

The initial claim that search exposes hidden credential files was retracted: ripgrep currently omits hidden files by default. Explicit sensitive globs may improve consistency, but that is not an established leak.

## Remaining release verification

After fixes and refresh: real JS/TS/Python/non-Git manual workflows; dirty/unsaved conflict and recovery; command/terminal/preview/LSP/debugging; real standalone and CraftBot coding results and selected-file review/apply; cancellation and restart; protected raw CRUD authority; keyboard/narrow/light/dark UI; clean packaged installation. Parent runs actual providers; verifier independently inspects results and storage.
