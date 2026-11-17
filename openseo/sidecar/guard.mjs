/**
 * Child guard (SYSTEM-OWNED — hash-locked in the ownership canon).
 *
 *   node sidecar/guard.mjs <parentPid> <command> [args...]
 *
 * Runs one upstream process for the sidecar and ends it, with its whole tree,
 * when the sidecar is gone. `agent-app stop` terminates the sidecar's process
 * tree, which already includes this guard; the guard is for the other case — a
 * sidecar that crashed or was killed alone would otherwise leave the upstream
 * server holding its port and its database files.
 */
import { execFileSync, spawn } from "node:child_process";

const [parentArg, command, ...args] = process.argv.slice(2);
const parent = Number(parentArg);
if (!Number.isInteger(parent) || parent <= 0 || !command) {
  process.stderr.write("usage: node guard.mjs <parentPid> <command> [args...]\n");
  process.exit(2);
}

const child = spawn(command, args, { stdio: "inherit", detached: process.platform !== "win32" });

function killTree() {
  if (child.exitCode !== null || child.pid === undefined) return;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(-child.pid, "SIGTERM");
    }
  } catch {
    /* already gone */
  }
}

function parentAlive() {
  try {
    process.kill(parent, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

const timer = setInterval(() => {
  if (!parentAlive()) {
    killTree();
    process.exit(0);
  }
}, 2000);

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    killTree();
    process.exit(0);
  });
}

child.on("exit", (code, signal) => {
  clearInterval(timer);
  process.exit(code ?? (signal ? 1 : 0));
});
child.on("error", (err) => {
  process.stderr.write(`guard: could not start ${command}: ${err.message}\n`);
  clearInterval(timer);
  process.exit(1);
});
