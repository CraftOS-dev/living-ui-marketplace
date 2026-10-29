# Development Studio

A local development workspace built with the pinned React/Hono/SQLite Agent-App framework. Develop manually or connect any compatible agent through A2App. Optional launchers can start Codex or another local agent command. Studio requires no changes to CraftBot. JavaScript/TypeScript and Python have verified language and debugger integrations; other projects use the editor, Git, terminals and configurable commands.

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

Open **Work** and create a work item with a goal, acceptance criteria and context for your selected agent. You can attach the current file/selection, diagnostics or run output. Start work explicitly.

Open **Settings → Agents**, choose an installed agent and click **Connect**. Studio detects Codex, Claude Code and Gemini CLI, shows sign-in readiness and configures task delivery automatically. **Sign in** opens the agent's own interactive login inside Studio; complete its browser prompts and check sign-in again. Missing agents link to their official installation help. Opening Settings starts no coding work, installs no software and changes no account. After connection, return to Work and start a task; no commands need copying.

**CraftBot:** start CraftBot normally, then choose **Connect CraftBot** in the same agent picker. Studio uses its existing local backend (default `http://127.0.0.1:7926`). If needed, expand **CraftBot address**, enter its backend address, and choose **Save and check**. No importer, host patch, framework checkout or capability configuration is needed. Create work with **Selected agent**, enter your goal and acceptance criteria, and start it. CraftBot receives a dedicated chat for this delivery, edits Studio's isolated copy through A2App, runs saved checks and submits the result. Review the diff and check output, then apply selected files. Questions resume the retained source in a new delivery; cancellation stops only the owned chat and revokes writes. CraftBot must be running on this computer, configured with a working model/account, and able to run Node commands through its existing tools.

The following integration options remain under the collapsed **Advanced connection** section:

- **Direct A2App**: under Advanced connection, choose Direct A2App and **Show protocol instructions** for an existing external session. The agent discovers Studio through the bundled client and atomically polls `tasks next --capability studio-development-external --wait 60000`. No Codex or CraftBot installation is required. It uses the same managed file/check/review operations as every other agent. A direct agent stops its tools and calls `work-release(work,task)` after submitting, asking a question, failing or receiving cancellation. Studio revokes canceled writes immediately and waits for this acknowledgement before another delivery; it cannot terminate a process it does not own.
- **Launch another agent command**: enter its executable and JSON argument array, select standard input or a `{prompt}` argument, save, then Connect. Studio passes the task directly to that process without a shell or provider/model-specific flags. A Windows npm shim may require the Node executable with the CLI's script path as the first argument. The agent must support tools and follow the supplied A2App workflow; configure its authentication/permissions in that agent. A plain chat model without tools is not a coding harness.
- **Installed agents** use managed presets in the ordinary picker. Codex retains its workspace sandbox, automatic approval review and configured model. Claude/Gemini use their own settings and the managed A2App worker. Existing work and settings are preserved. Their availability and sign-in states do not constitute a live coding certification for every provider.

The interface is agent-neutral, like the other marketplace apps: identity/discovery, records and declared operations use A2App, with local credential handling by the bundled client. Connection instructions contain no credential value. General app operation is distinct from listening for development tasks; a queued task stays queued until an agent claims it. Manual development works without a connected agent.

CraftBot's chat connector is implemented entirely in Studio and has been tested against unchanged committed CraftBot code. Native import of this framework package into the older host remains a separate unsupported boundary. Existing native records and integration operations are retained for preservation. See `reference/CRAFTBOT_COMPATIBILITY.md` for the tested route and historical evidence.

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

`npm run package` writes `../.milestone-tools/deliverables/development-studio-v1.zip`. Pinned MIT framework dependencies are bundled. Credentials, databases, project files, runtime logs, node_modules and private evidence are excluded. The package runs without this source checkout or CraftBot. It contains no CraftBot host patch.

Use **Settings** for agent connections, appearance, local tools and project execution/recovery. Internal verification receipts remain available to maintenance tools and are not exposed as IDE screens. See `reference/RELEASE_EVIDENCE.md` for release checks, `reference/RELEASE_PLAN.md` for scope, and `AGENT_APP.md` for the agent protocol. Remote development, simultaneous collaboration, VS Code extensions and marketplace publication are outside this local first release.

If the pinned framework reports a transient Windows backup rename `EPERM` during promotion, use the bounded retry preloader. It still runs the official CLI and requires the same validation and mandatory backup:

```powershell
node --import ./scripts/windows-lifecycle-retry.mjs ./node_modules/agent-app-framework/dist/agent-app.js . promote
```
