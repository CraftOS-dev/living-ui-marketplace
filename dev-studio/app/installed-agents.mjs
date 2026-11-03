import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveOnPath } from "../node_modules/agent-app-framework/dist/lib/harness.js";
const exec = promisify(execFile);
export const agentPresets = [
  { id: "codex", name: "Codex", help: "https://developers.openai.com/codex/cli/", script: "@openai/codex/bin/codex.js" },
  { id: "claude", name: "Claude Code", help: "https://code.claude.com/docs/en/setup", script: "@anthropic-ai/claude-code/cli.js" },
  { id: "gemini", name: "Gemini CLI", help: "https://geminicli.com/docs/get-started/installation/", script: "@google/gemini-cli/dist/index.js" },
];
export function preset(id) {
  const value = agentPresets.find(item => item.id === id);
  if (!value) throw Error("Choose a supported installed agent.");
  return value;
}
export async function locateAgent(id, env = process.env) {
  const profile = preset(id), executable = resolveOnPath(id, env);
  if (!executable) return null;
  if (!/\.(cmd|bat|ps1)$/i.test(executable)) return { command: executable, prefix: [] };
  // Windows npm shims are shell scripts; use the package's actual JS entry.
  const script = join(dirname(executable), "node_modules", profile.script);
  try { await access(script); return { command: process.execPath, prefix: [script] }; }
  catch { return null; }
}
export async function inspectAgent(id, { locate = locateAgent, run = exec } = {}) {
  const { name, help } = preset(id), launch = await locate(id);
  if (!launch) return { id, name, help, installed: false, authentication: "missing" };
  let authentication = "unknown";
  if (id !== "gemini") {
    try {
      const args = id === "codex" ? ["login", "status"] : ["auth", "status"];
      const result = await run(launch.command, [...launch.prefix, ...args], {
        timeout: 6000, maxBuffer: 65536, windowsHide: true, env: process.env,
      });
      const output = (result.stdout || "") + "\n" + (result.stderr || "");
      authentication = id === "claude"
        ? (JSON.parse(result.stdout).loggedIn ? "ready" : "required")
        : /^Logged in\b/im.test(output) ? "ready" : /not logged in/i.test(output) ? "required" : "unknown";
    } catch (error) {
      const output = String(error.stdout || "") + String(error.stderr || "");
      authentication = /not logged in|not authenticated|"loggedIn"\s*:\s*false/i.test(output)
        ? "required" : "unknown";
    }
  }
  return { id, name, help, installed: true, authentication };
}
export const installedAgents = () => Promise.all(agentPresets.map(item => inspectAgent(item.id)));

export async function presetLaunch(id) {
  const launch = await locateAgent(id);
  if (!launch) throw Error(`${preset(id).name} is not installed. Open its installation guide, then check again.`);
  return launch;
}
export async function loginLaunch(id) {
  const launch = await presetLaunch(id);
  return { executable: launch.command, args: [...launch.prefix,
    ...(id === "codex" ? ["login"] : id === "claude" ? ["auth", "login"] : [])] };
}
export async function codingLaunch(id) {
  const launch = await presetLaunch(id);
  const args = id === "claude"
    ? ["-p", "--output-format", "stream-json", "--verbose", "--allowedTools", "Bash(node *)", "--permission-mode", "dontAsk"]
    : ["--prompt", "{prompt}", "--output-format", "stream-json", "--allowed-tools", "run_shell_command(node)"];
  return { command: launch.command, args: [...launch.prefix, ...args], input: id === "claude" ? "stdin" : "arg" };
}
