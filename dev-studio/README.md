# Development Studio

A local development workspace built with the pinned React/Hono/SQLite Agent-App framework. Develop manually, connect your installed Codex CLI, or assign work to CraftBot. JavaScript/TypeScript and Python have verified language and debugger integrations; other projects use the editor, Git, terminals and configurable commands.

## Start

Requires Node 22+, npm and Git for repository operations. Windows is the verified release platform.

```powershell
npm ci
# Only for a newly extracted package: provision fresh identity, port and authority.
npm run framework -- . import --blueprint blueprint-dev-studio
npm run framework -- . serve
```

Open the URL printed by the framework. Existing installations keep their identity and data: use `serve` without importing again. Stop with `npm run framework -- . stop`.

## Everyday workflow

1. Choose **Open folder**, **Clone repository** or **New project**. Empty, JavaScript and Python starters are included. Opening a folder does not install dependencies or execute it.
2. Edit files in Monaco; use Ctrl+P for files/commands, Ctrl+S to save and Ctrl+O to open a folder. Tabs, cursor, layout and unsaved recovery persist in this browser. External edits require an explicit conflict decision.
3. Explicitly enable execution for a trusted project. Add saved install/develop/build/test/lint/custom commands, select a working directory and run them. The Runs panel shows actual output, exit code, source freshness, detected preview URLs and declared artifacts. Develop commands run until stopped; other checks have a ten-minute limit.
4. Use the Terminal panel for interactive commands. Up to two project terminals are allowed app-wide. Refresh reconnects using a fresh ticket within a 60-second grace period; closing a terminal stops its owned process tree.
5. Open a JavaScript or Python file, set a breakpoint and start Debugger. JavaScript/TypeScript language services and Pyright provide diagnostics, completion, hover and definition navigation. Python debugging requires `debugpy` in the selected interpreter; Python formatting requires `black` there. Settings shows tool availability.
6. Use Git to inspect/stage/unstage changes, commit, fetch, fast-forward pull or push. Remote operations are explicit and use installed Git credentials.

## Agent development

Open **Work**, create a work item with a goal, acceptance criteria and context, then choose Standalone or CraftBot. You can attach the current file/selection, diagnostics or run output. Start work explicitly.

Standalone uses your installed, authenticated Codex CLI. The connector supports app folders outside Git while retaining the CLI workspace sandbox and automatic approval review. Click **Connect** in **Agent work**. The app starts the framework bridge on the dedicated standalone capability. Manual development works with no agent connected.

CraftBot uses the native imported app and the host's capability consumer. Install the compatibility patch described in `../craftbot-compatibility/README.md`, configure a trusted built framework checkout and enable `studio-development-craftbot` plus `studio-craftbot-proof`. Then import the package through CraftBot. The host URL defaults to its inherited local backend port; Settings supports an explicit local override.

Both agents use the same A2App contract: inspect context, edit a separate worktree/copy, run saved checks, report progress, ask questions and submit retained changes. Answering a question resumes the same isolated source with a distinct task delivery. A revision retains that source and attempt history. Cancellation revokes managed writes and waits for process-stop confirmation.

Standalone tasks default to **Standard** reasoning for everyday development. Choose **Thorough** for complex work; the installed CLI's configured model is retained. Task activity shows real elapsed time and the latest reported activity or running check. Submitting changes freezes further agent writes and completes the delivery before **Ready for review** appears, so Apply does not wait for a separate agent completion. A disrupted handoff stays **Preparing review** while reconnecting. The standalone connection shows connected only after its bridge reports ready.

Review actual file differences and check freshness before accepting selected files. Unsaved buffers block apply; destination changes require an explicit merge/keep/use-agent decision. Applied or deleted files have recovery checkpoints. Reject keeps the isolated source and history while leaving the main project unchanged. After partial acceptance, start new work from the current project rather than revising the old baseline.

## Verification and distribution

```powershell
npm test
npm run framework -- . dev
npm run framework -- . validate
node scripts/workspace-smoke.mjs
node scripts/execution-smoke.mjs
npm run package
```

Developer candidates have disposable databases. Use the framework's `validate`, stop-live, `promote`, `serve` lifecycle to release changes. Never edit framework-owned files. Smoke/proof drivers create disposable fixture projects; actual agent proof scripts require configured harnesses and may consume their normal usage.

`npm run package` writes `../.milestone-tools/deliverables/development-studio-v1.zip`. Pinned MIT framework dependencies are bundled. Credentials, databases, project files, runtime logs, node_modules and private evidence are excluded. The package runs without this source checkout or CraftBot; CraftBot import needs the host patch.

Use **Settings** for agent connections, appearance, local tools and project execution/recovery. Internal verification receipts remain available to maintenance tools and are not exposed as IDE screens. See `reference/RELEASE_EVIDENCE.md` for release checks, `reference/RELEASE_PLAN.md` for scope, and `AGENT_APP.md` for the agent protocol. Remote development, simultaneous collaboration, VS Code extensions and marketplace publication are outside this local first release.

If the pinned framework reports a transient Windows backup rename `EPERM` during promotion, use the bounded retry preloader. It still runs the official CLI and requires the same validation and mandatory backup:

```powershell
node --import ./scripts/windows-lifecycle-retry.mjs ./node_modules/agent-app-framework/dist/agent-app.js . promote
```
