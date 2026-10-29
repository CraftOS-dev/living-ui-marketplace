import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT } from "./config.mjs";

export async function bridgeRecord() {
  try {
    const record = JSON.parse(
      await readFile(join(ROOT, ".a2app/bridge.json"), "utf8"),
    );
    if (!Number.isInteger(record.pid) || record.pid < 1) return null;
    process.kill(record.pid, 0);
    return record;
  } catch {
    return null;
  }
}
export async function connectionState(job, runtimeCall, harness = "studio-codex") {
  if (!job) return { connected: false };
  let state;
  try {
    state = await runtimeCall("job-state", { id: job });
  } catch {
    return {
      connected: false,
      message: "The standalone connection stopped. Connect again to continue.",
    };
  }
  const record = await bridgeRecord();
  if (state.status === "running") {
    if (
      record?.harness === harness &&
      Date.parse(record.startedAt) >= Date.parse(state.started) - 1000
    )
      return { connected: true, pid: record.pid, job };
    return {
      connected: false,
      connecting: true,
      job,
      message: "Starting the standalone connection…",
    };
  }
  return {
    connected: false,
    status: state.status,
    message: record
      ? "Another Studio instance already has the standalone connection. Connect from that installation, or disconnect it before using this one."
      : "The agent launcher did not stay running. Check that its executable is installed and authenticated, then connect again.",
  };
}
