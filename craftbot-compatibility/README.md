# CraftBot support for new-framework apps

This host change adds native Agent App format `0.1.0` alongside existing format `2`.
It was applied and tested in `D:\Work\CraftOS\CraftBot`; unrelated checkout changes were preserved.
The reviewable `craftbot-new-framework.patch` contains only the compatibility implementation and its regression tests.

## Host configuration

Use a trusted, built Agent-App checkout. The proof used framework commit
`5e9c7a1e28fd4742cbb49e49188d63031f35c145` and its official `blueprint-react-node`.
The host never selects its lifecycle executable or blueprint from the imported app.

```powershell
$env:CRAFTBOT_FRAMEWORK_ROOT = 'C:\path\to\trusted\Agent-App'
$env:CRAFTBOT_FRAMEWORK_BLUEPRINT = 'blueprint-react-node'
$env:CRAFTBOT_A2APP_CAPABILITIES = 'studio-craftbot-proof,studio-development-craftbot'
python run.py --no-open-browser --frontend-port 8925 --backend-port 8926
```

`CRAFTBOT_FRAMEWORK_ROOT` defaults to the sibling `Agent-App` checkout.
It must contain built `framework/cli/dist/agent-app.js` and `a2app.js` with their dependencies.
Capability delivery defaults to disabled. The comma-separated allowlist explicitly enables app-to-agent work;
standalone requests remain available to their independent framework bridge.
Framework registration is isolated in the host's `agent_app/_framework_home`.

## Behavior

- Import recognizes exact supported format/adapter metadata, keeps the project native, and uses the trusted framework import command for fresh identity, port, credential and system code.
- Imported runtime/database/build state is omitted. The original source stays unchanged.
- The framework owns Node installation/build/serve/stop; no PocketBase kit is copied over it.
- A capability-filtered consumer atomically claims tasks, dispatches a durable CraftBot trigger, maintains progress, and expects the actual agent to write the domain result and complete the task. Development capabilities receive the isolated-work protocol; a question suspends the current delivery and a distinct task resumes it after the human answer.
- Durable delivery bindings support restart reconciliation. Cancellation purges queued work and stops active work. The runtime rechecks canceled rows after its dequeue handoff.
- Shutdown always attempts framework process teardown, including when task HTTP reconciliation fails.
- Existing format-2 import/lifecycle stays on its existing runner. Replacing a PocketBase build in place with a new-framework marketplace package is explicitly rejected; use a fresh native import.

## Reproduce

From CraftBot:

```powershell
python -m unittest app.agent_app.test_framework_host -v
python -m pytest tests/test_trigger_service.py tests/test_trigger_exclusive_missions.py tests/test_trigger_lifecycle_polish.py tests/test_session_trigger_queue.py -q
python -m app.agent_app.test_data_safety
python -m app.agent_app.test_trigger_plane
```

From `dev-studio` with the configured real host running:

```powershell
node scripts/package.mjs
node scripts/craftbot-proof.mjs <absolute-path-to-development-studio-v1.zip>
```

The proof imports through the actual authenticated host WebSocket route, then only queues a review.
It supplies no answer or agent response. It verifies the stored domain result and framework completion.
`scripts/craftbot-lifecycle-proof.mjs` checks a prior imported proof after host restart,
real worker/PTY teardown, relaunch identity and cancellation. Reports live under `.a2app/evidence/` and are excluded from exports.

Observed: 8 new tests, 40 trigger/runtime tests, all 26 format-2 data-safety sections and trigger-plane acceptance pass.
Native import/review/completion, host restart persistence, worker/shell cleanup and cancellation were exercised with the real host.
See `dev-studio/reference/RELEASE_EVIDENCE.md` for current coding, revision, packaging and independent browser checks; milestone-zero receipts remain in `reference/EVIDENCE.md`.
