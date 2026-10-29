import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
test("missing installed harness produces a safe actionable receipt without a live process", async () => {
  const dir = await mkdtemp(join(tmpdir(), "studio-missing-harness-"));
  const child = spawn(
    process.execPath,
    ["scripts/development-agent.mjs", dir],
    {
      env: {
        ...process.env,
        STUDIO_CODEX_ENTRY: join(dir, "definitely-absent-codex.exe"),
      },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (b) => (output += b));
  child.stderr.on("data", (b) => (output += b));
  // Negative startup fixture only: no actual task is queued or result submitted.
  child.stdin.end("task tsk_missingharnessfixture");
  const code = await new Promise((yes, no) => {
    child.on("error", no);
    child.on("close", yes);
  });
  assert.equal(code, 1);
  const receipt = JSON.parse(
    await readFile(
      join(dir, "agent-processes/tsk_missingharnessfixture.json"),
      "utf8",
    ),
  );
  assert.equal(receipt.error, "Installed Codex CLI could not start.");
  assert.ok(receipt.finished);
  assert.equal(receipt.pid, undefined);
  assert.doesNotMatch(output, /Unhandled|ENOENT|definitely-absent/);
});
