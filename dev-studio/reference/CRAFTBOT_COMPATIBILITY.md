# CraftBot compatibility
## Current result — 24 October 2026 follow-up
The user separately authorized the host compatibility changes. CraftBot now recognizes the app as native format 0.1.0, imports through a trusted framework CLI/blueprint, and launches it without the PocketBase runner.
Actual clean ZIP import created app bf4de299aab9 on port 3100. Its CraftBot session reviewed request 109cbccb-8535-40a4-86dd-d5021d1d0ab1, stored passed, and completed task tsk_72a2aa8b2a4ebeb1.
Host restart preserved the passed result. Real worker and PTY shell processes stopped, the app port closed, relaunch kept identity, and a claimed review canceled to terminal canceled in both task and domain request.
The portable host patch and setup instructions are in the parent repository's craftbot-compatibility/ directory. Configure a trusted built CRAFTBOT_FRAMEWORK_ROOT and explicitly allow studio-craftbot-proof in CRAFTBOT_A2APP_CAPABILITIES. Unconfigured app-to-agent delivery remains disabled.
Existing format-2 imports remain on the old runner. Format-2 data-safety and trigger-plane suites pass, plus 8 new compatibility/cancellation tests and 40 trigger/runtime tests.
This proves the integration path. Native browser follow-up is environment-blocked; the independent verifier exposes no browser. See EVIDENCE.md and WALK_VERIFY_CRAFTBOT.md. The full workspace has not started.
## Historical result before the authorized host patch
The real importer in the local CraftBot source checkout was executed against this new-framework app.
It returned no native project root. Native package installation, launch and an agent round trip are therefore not passed.
The host was launched on dedicated test ports and its /api/state answered idle with onboarding complete; a fake host was not used.
## Original incompatibilities (corrected by the host patch)
- app/agent_app/manager.py, _find_project_root: only agentAppVersion/livingUIVersion == 2 is a native project.
- _import_project_tree rejects any other value before its native import path.
- Marketplace installation independently requires format 2.
- The native import pipeline invokes the existing PocketBase-oriented runner.kit_sync.
- Current host app-to-agent delivery is the old declared-trigger/request contract, not the new framework task queue/bridge.
The new app's actual format is string "0.1.0". Its backend is Node/Hono/SQLite, with the framework's embedded A2App adapter.
Relabelling the manifest as 2 would bypass classification without making the lifecycle, adapter or agent-delivery contracts compatible.
## Authorized follow-up implemented in CraftBot
1. Recognise a new-framework project by validated version/protocol metadata while preserving existing format-2 apps.
2. Launch/import through the pinned framework lifecycle; do not re-vendor the PocketBase kit over this Node app.
3. Assign fresh identity/port, strip credentials and preserve ownership boundaries through the framework import command.
4. Connect the host's agent-session dispatch to the A2App task claim/progress/completion contract and cancellation.
5. Verify a clean ZIP install, actual host launch, one real agent result and stop/restart cleanup.
6. Keep foreign adoption and conversion explicit; this package must not enter those paths silently.
The original milestone stopped without host edits. The subsequent user request authorized CraftBot source changes; framework system files remain untouched. No catalogue entry has been published.
