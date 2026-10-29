import test from "node:test";
import assert from "node:assert/strict";
import { agentConfiguration, connectionInstructions } from "../app/agent-connection.mjs";

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
