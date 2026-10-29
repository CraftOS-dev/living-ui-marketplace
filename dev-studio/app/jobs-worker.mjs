import { spawn, execFile } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
const jobs = new Map();
export const cleanEnvironment = (names = []) =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) =>
        names.includes(k) ||
        !/TOKEN|SECRET|API_KEY|PASSWORD|CREDENTIAL|^STUDIO_|^A2APP_/.test(
          k.toUpperCase(),
        ),
    ),
  );
export async function killOwned(child) {
  if (!child?.pid || child.exitCode !== null) return;
  const alive = () => {
    try {
      process.kill(child.pid, 0);
      return true;
    } catch (e) {
      return e.code !== "ESRCH";
    }
  };
  let failure;
  if (process.platform === "win32")
    await new Promise((r) =>
      execFile(
        "taskkill.exe",
        ["/PID", String(child.pid), "/T", "/F"],
        { windowsHide: true, timeout: 8000 },
        (err) => {
          failure = err;
          r();
        },
      ),
    );
  else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (e) {
      failure = e;
      child.kill("SIGKILL");
    }
  }
  for (let i = 0; i < 80 && alive(); i++)
    await new Promise((r) => setTimeout(r, 50));
  if (alive())
    throw new Error(
      "The owned process has not stopped" +
        (failure ? "; process termination failed." : "."),
    );
}
export async function jobStart({
  id,
  command,
  cwd,
  timeout = 600000,
  envNames = [],
}) {
  const folder = join(process.env.STUDIO_DATA_DIR, "runs");
  await mkdir(folder, { recursive: true });
  const executable =
    process.platform === "win32" ? "powershell.exe" : "/bin/sh";
  const args =
    process.platform === "win32"
      ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command]
      : ["-c", command];
  const child = spawn(executable, args, {
    cwd,
    env: cleanEnvironment(envNames),
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const state = {
    id,
    status: "running",
    pid: child.pid,
    started: new Date().toISOString(),
    output: "",
    exitCode: null,
    timeoutMs:
      timeout === 0 ? null : Math.min(Math.max(timeout, 1000), 3600000),
  };
  const job = { child, state };
  jobs.set(id, job);
  const save = () =>
    writeFile(join(folder, id + ".json"), JSON.stringify(state)).catch(
      () => {},
    );
  const output = (data) => {
    state.output = (state.output + data.toString()).slice(-262144);
  };
  child.stdout.on("data", output);
  child.stderr.on("data", output);
  const timer =
    timeout === 0
      ? null
      : setTimeout(
          async () => {
            state.stopReason = "timed-out";
            state.status = "stopping";
            try {
              await killOwned(child);
              state.status = "timed-out";
              state.stopConfirmed = true;
            } catch (e) {
              state.stopError = e.message;
            }
            await save();
          },
          Math.min(Math.max(timeout, 1000), 3600000),
        );
  child.on("error", (err) => {
    state.status = "failed";
    state.output += `\nCould not start command: ${err.code || "tool unavailable"}`;
  });
  child.on("close", async (code) => {
    clearTimeout(timer);
    state.exitCode = code;
    state.finished = new Date().toISOString();
    if (state.stopReason) {
      state.status = state.stopReason;
      state.stopConfirmed = true;
    } else if (state.status === "running")
      state.status = code === 0 ? "passed" : "failed";
    await save();
  });
  await save();
  return { ...state };
}
export async function jobState(id) {
  if (jobs.has(id)) return { ...jobs.get(id).state };
  const state = JSON.parse(
    await readFile(
      join(process.env.STUDIO_DATA_DIR, "runs", id + ".json"),
      "utf8",
    ),
  );
  if (state.status === "running") {
    state.status = "interrupted";
    state.finished = new Date().toISOString();
    state.output +=
      "\nThe execution service restarted; this run is interrupted.";
  }
  return state;
}
export async function jobStop(id) {
  const job = jobs.get(id);
  if (job && job.child.exitCode === null) {
    job.state.stopReason = "canceled";
    job.state.status = "stopping";
    try {
      await killOwned(job.child);
      job.state.status = "canceled";
      job.state.stopConfirmed = true;
    } catch (e) {
      job.state.stopError = e.message;
      throw e;
    }
  }
  return jobState(id);
}
export async function stopJobs() {
  await Promise.all(
    [...jobs.values()].map(async (j) => {
      if (j.child.exitCode === null) {
        j.state.stopReason = "interrupted";
        await killOwned(j.child);
        j.state.status = "interrupted";
        j.state.stopConfirmed = true;
      }
    }),
  );
}
