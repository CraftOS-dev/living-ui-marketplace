import { developmentInstruction } from "./development-instruction.mjs";
// Installed CLI connector. Credentials remain with the CLI; output is not exported.
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, dataDir } from "../app/config.mjs";
import { developmentContext } from "./development-client.mjs";
import { request } from "./client.mjs";
import { agentConfiguration } from "../app/agent-connection.mjs";
import { codingLaunch } from "../app/installed-agents.mjs";
const configuration = agentConfiguration(process.argv[3]
  ? JSON.parse(await readFile(process.argv[3], "utf8")) : {});
const custom = configuration.provider !== "codex";
const launch = custom && configuration.provider !== "custom" ? await codingLaunch(configuration.provider) : configuration;
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
const task = /task\s+(tsk_[a-zA-Z0-9]+)/.exec(prompt)?.[1];
if (!task) throw new Error("A claimed framework task is required.");
const started = new Date().toISOString();
const bootstrap = await developmentContext(task).catch(() => null);
const effort = bootstrap?.context.effort === "high" ? "high" : "medium";
const instruction = developmentInstruction(bootstrap, prompt);
const folder = join(process.argv[2] || dataDir(), "agent-processes");
await mkdir(folder, { recursive: true });
const child = spawn(
  custom ? launch.command : (process.env.STUDIO_CODEX_ENTRY || "codex"),
  custom ? launch.args.map(arg => arg.replaceAll("{prompt}", instruction)) : [
    "exec",
    "--ephemeral",
    "--json",
    "--skip-git-repo-check",
    "--approve-for-me",
    "-c",
    `model_reasoning_effort="${effort}"`,
    "-",
  ],
  {
    cwd: ROOT,
    env: process.env,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  },
);
const state = {
  task,
  pid: child.pid,
  started,
  spawned: new Date().toISOString(),
  reasoningEffort: effort,
  provider: configuration.provider,
  scopedContext: !!bootstrap,
};
const initialWrite = writeFile(
  join(folder, task + ".json"),
  JSON.stringify(state),
);
child.stdin.on("error", () => {});
child.stdin.end(!custom || launch.input === "stdin" ? instruction : undefined);
let events = 0;
let diagnostic = "";
let closing = false;
let checking = false;
// Once the app has accepted a submission/question, no additional model turn is
// useful. Release this task's owned process promptly, including its tool child.
const handoffWatch = bootstrap
  ? setInterval(async () => {
      if (checking || closing) return;
      checking = true;
      try {
        const current = await request("/api/_a2app/tasks/" + task);
        if (closing || child.exitCode !== null || child.signalCode) return;
        if (
          ["completed", "input-required", "canceled"].includes(current.status)
        ) {
          closing = true;
          state.yieldedAt = new Date().toISOString();
          state.deliveryAtYield = current.status;
          if (child.pid && process.platform === "win32") {
            const stop = spawn(
              "taskkill.exe",
              ["/PID", String(child.pid), "/T", "/F"],
              { windowsHide: true, stdio: "ignore" },
            );
            stop.on("error", () => child.kill());
          } else child.kill("SIGTERM");
        }
      } catch {
        /* A temporary disconnection does not declare task completion. */
      } finally {
        checking = false;
      }
    }, 500)
  : null;
child.stdout.on("data", (d) => {
  events += d.toString().split("\n").length - 1;
});
child.stderr.on("data", (data) => {
  // Classify known startup failures without persisting raw harness output.
  diagnostic = (diagnostic + data.toString()).slice(-4096);
});
child.on("error", () => {
  state.error = custom ? "Configured agent could not start. Check its executable path (use node plus the CLI script for a Windows npm shim)." : "Installed Codex CLI could not start.";
});
child.on("close", async (code) => {
  closing = true;
  if (handoffWatch) clearInterval(handoffWatch);
  await initialWrite;
  if (code !== 0 && !state.error && !state.deliveryAtYield) {
    state.error = custom ? "Configured agent exited before completing delivery. Check its command, task input and authentication in your terminal." : /login|authenticat|unauthoriz|401/i.test(diagnostic)
      ? "Codex authentication is unavailable. Run codex login in your local terminal, then retry."
      : /quota|usage limit|rate limit|429/i.test(diagnostic)
        ? "Codex usage is unavailable. Check your CLI account limits, then retry."
        : "Codex exited before completing this delivery. Check codex --version and codex login status in your local terminal, then retry.";
  }
  state.finished = new Date().toISOString();
  state.exitCode = code;
  await writeFile(join(folder, task + ".json"), JSON.stringify(state));
  console.log(
    JSON.stringify({ harness: configuration.provider, task, exitCode: code, events }),
  );
  process.exitCode = state.deliveryAtYield
    ? 0
    : Number.isInteger(code) && code >= 0
      ? code
      : 1;
});
await initialWrite;
