import test from "node:test";
import assert from "node:assert/strict";
import { agentConfiguration, connectionInstructions } from "../app/agent-connection.mjs";
import { inspectAgent, preset } from "../app/installed-agents.mjs";
import { terminalCommand } from "../src/connection-commands.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test("copied commands preserve spaces, apostrophes and literal shell variables", async () => {
  const root = await mkdtemp(join(tmpdir(), "Studio's $literal folder "));
  const script = join(root, "show arguments.mjs");
  await writeFile(script, "console.log(JSON.stringify(process.argv.slice(2)))");
  const formatted = terminalCommand(`node ${JSON.stringify(script)} ${JSON.stringify(root)}`);
  const windows = process.platform === "win32";
  const result = await promisify(execFile)(windows ? "powershell.exe" : "/bin/sh",
    windows ? ["-NoProfile", "-NonInteractive", "-Command", formatted.text] : ["-c", formatted.text], { windowsHide: true });
  assert.deepEqual(JSON.parse(result.stdout), [windows ? root.replaceAll("\\", "/") : root]);
  assert.equal(formatted.shell, windows ? "PowerShell" : "Terminal");
  assert.doesNotMatch(formatted.text, /\\\\/);
});

test("custom launchers pass a structured command without Codex arguments", () => {
  const configuration = agentConfiguration({ provider: "custom", command: process.execPath,
    args: ["agent.js", "--message", "{prompt}"], input: "arg" });
  assert.equal(configuration.command, process.execPath);
  assert.deepEqual(configuration.args, ["agent.js", "--message", "{prompt}"]);
  assert.throws(() => agentConfiguration({ ...configuration, args: ["agent.js"] }), /\{prompt\}/);
  assert.throws(() => agentConfiguration({ ...configuration, args: "--message" }), /JSON array/);
  assert.throws(() => agentConfiguration({ ...configuration, command: "node\nother-command" }), /executable/);
  assert.throws(() => agentConfiguration({ ...configuration, args: ["bad\0argument"] }), /JSON array/);
});

test("direct instructions discover the protocol without embedding credentials", () => {
  assert.deepEqual(agentConfiguration({ provider: "external", command: "ignored" }), { provider: "external" });
  const info = connectionInstructions();
  assert.match(info.listen, /tasks next --capability studio-development-external --wait 60000/);
  assert.match(info.instructions, /work-release/);
  assert.match(info.instructions, /No Codex or CraftBot installation is required/);
  assert.doesNotMatch(info.instructions, /x-a2app-token|Bearer |ghp_|\bsk-[a-zA-Z0-9]{12}/);
});

test("agent detection distinguishes missing, signed-in, signed-out and unknown without exposing CLI output", async () => {
  const locate = async () => ({ command: "fixture", prefix: [] });
  const ready = await inspectAgent("codex", { locate, run: async () => ({ stderr: "Logged in using ChatGPT\nPRIVATE_FIXTURE_NOT_A_CREDENTIAL" }) });
  assert.equal(ready.authentication, "ready");
  assert.doesNotMatch(JSON.stringify(ready), /PRIVATE_FIXTURE/);
  const signedOut = await inspectAgent("claude", { locate, run: async () => { throw { stdout: '{"loggedIn":false}' }; } });
  assert.equal(signedOut.authentication, "required");
  const unavailable = await inspectAgent("gemini", { locate: async () => null });
  assert.equal(unavailable.installed, false);
  const unknown = await inspectAgent("codex", { locate, run: async () => { throw Error("timeout with private output"); } });
  assert.equal(unknown.authentication, "unknown");
  assert.throws(() => preset("untrusted-command"), /supported installed agent/);
  assert.deepEqual(agentConfiguration({ provider: "claude" }), { provider: "claude" });
});
