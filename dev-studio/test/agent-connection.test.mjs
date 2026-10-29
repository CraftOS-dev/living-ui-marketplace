import test from "node:test";
import assert from "node:assert/strict";
import { agentConfiguration, connectionInstructions } from "../app/agent-connection.mjs";
import { inspectAgent, preset } from "../app/installed-agents.mjs";

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
