/**
 * Shared sidecar context (SYSTEM-OWNED — hash-locked in the ownership canon).
 *
 * What the toolkit hands the app's own hooks (`a2app/app.mjs`): where things
 * are, and a few process helpers that behave the same on Windows, macOS and
 * Linux. The app's hooks say HOW to install, build and start its upstream; the
 * toolkit decides WHEN, and owns the agent surface around it.
 *
 * The app hook module may export:
 *   install(ctx)        after the pinned upstream is unpacked
 *   build(ctx)          the pipeline build step
 *   detach(dir)         unlink anything the app linked into an upstream tree
 *   start(ctx)          start upstream on ctx.internalPort; resolve once it is
 *                       ready; return { stop(), restart?() }
 *   ops                 sidecar-run operations: { name(args, ctx) → JSON }
 *   before(call, ctx)   a setup problem visible before a tool call (e.g. an
 *                       account not configured): return { code, message,
 *                       status? } to answer with it, or null
 *   explain(result, ctx) the same for a tool's answer ({ op, text, structured,
 *                       isError }): name a missing key instead of passing
 *                       on a result in which nothing could succeed
 *   watch(ctx)          optional app→agent watcher; return { stop() }
 *   conventions         extra describe conventions (short)
 *   credentialHint      how an agent gets a credential
 */
import { execSync, spawn } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readPin, upstreamDir } from "./upstream.mjs";

export const SIDECAR_DIR = dirname(fileURLToPath(import.meta.url));
export const APP_DIR = dirname(SIDECAR_DIR);

/** Longest app folder path the upstream toolchain is known to survive on
 *  Windows: package managers nest deep trees, and both `chdir` and spawning an
 *  .exe fail past MAX_PATH (260) no matter what the registry says. */
export const WINDOWS_MAX_APP_PATH = 100;

export function log(msg) {
  process.stdout.write(`[sidecar] ${msg}\n`);
}

export function guardPath(appDir = APP_DIR) {
  if (process.platform === "win32" && appDir.length > WINDOWS_MAX_APP_PATH) {
    throw new Error(
      `this app's folder path is ${appDir.length} characters long; on Windows its upstream toolchain needs ${WINDOWS_MAX_APP_PATH} or fewer. ` +
        `Install it somewhere shorter, e.g. agent-app install <app> --into C:\\apps\\<app>`,
    );
  }
}

export function dataDir(appDir = APP_DIR) {
  const dir = process.env.A2APP_DATA_DIR ? resolve(process.env.A2APP_DATA_DIR) : join(appDir, "data");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export const LOG_FILE = join(APP_DIR, "logs", "pipeline.log");

/** The last lines of the pipeline log, for an error message. */
function logTail(lines = 60) {
  try {
    return readFileSync(LOG_FILE, "utf8").split(/\r?\n/).slice(-lines).join("\n");
  } catch {
    return "";
  }
}

/** Run a shell command to completion. Its own output goes to logs/pipeline.log,
 *  never to stdout: the framework captures a pipeline step's output in a 1 MiB
 *  buffer, and a package manager plus a bundler plus database migrations
 *  outgrow it, which kills the step with no message. One line is printed per
 *  command, and the log's tail when it fails. There is no stdin, so a tool
 *  that would wait on a prompt fails instead of hanging the pipeline. Retries
 *  help with Windows file locks (a virus scanner holding a fresh file). */
export function run(cmd, { cwd = APP_DIR, env = {}, retries = 0 } = {}) {
  mkdirSync(dirname(LOG_FILE), { recursive: true });
  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    appendFileSync(LOG_FILE, `\n=== ${new Date().toISOString()} ${cmd} (in ${cwd})\n`);
    const fd = openSync(LOG_FILE, "a");
    try {
      execSync(cmd, { cwd, stdio: ["ignore", fd, fd], env: { ...process.env, ...env }, windowsHide: true });
      log(`${cmd} — done in ${Math.round((Date.now() - started) / 1000)} s`);
      return;
    } catch (e) {
      if (attempt >= retries) {
        throw new Error(`${cmd} failed (exit ${e.status ?? "?"}). Last lines of ${LOG_FILE}:\n${logTail()}`);
      }
      log(`retrying (${attempt + 1}/${retries}): ${cmd}`);
    } finally {
      closeSync(fd);
    }
  }
}

/** Start a long-running upstream process under the child guard, which ends it
 *  (with its tree) if this sidecar process disappears. */
export function spawnGuarded(command, args, { cwd = APP_DIR, env = {} } = {}) {
  return spawn(process.execPath, [join(SIDECAR_DIR, "guard.mjs"), String(process.pid), command, ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
    windowsHide: true,
  });
}

/** End a process started by {@link spawnGuarded}, with its whole tree, and
 *  resolve once it has exited. */
export function stopGuarded(child, timeoutMs = 10_000) {
  return new Promise((resolveStop) => {
    if (!child || child.exitCode !== null || child.pid === undefined) return resolveStop();
    const timer = setTimeout(resolveStop, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveStop();
    });
    try {
      // On Windows a plain kill would end the guard alone and orphan the tree.
      if (process.platform === "win32") execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: "ignore" });
      else child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  });
}

/** A free loopback port for the upstream app's internal listener. */
export function freePort() {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolvePort(port));
    });
  });
}

/** Poll a URL until it answers 2xx, or give up. */
export async function waitHttp(url, timeoutMs, isAlive = () => true) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (!isAlive()) return false;
    try {
      const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5000) });
      await res.body?.cancel().catch(() => undefined);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

export async function loadAppHooks(appDir = APP_DIR) {
  const file = join(appDir, "a2app", "app.mjs");
  if (!existsSync(file)) return {};
  return import(pathToFileURL(file).href);
}

export function baseContext(appDir = APP_DIR) {
  const pin = readPin(appDir);
  return {
    appDir,
    pin,
    upstreamDir: upstreamDir(appDir, pin),
    dataDir: dataDir(appDir),
    env: process.env.A2APP_ENV ?? "live",
    log,
    run,
    spawnGuarded,
    stopGuarded,
    waitHttp,
  };
}
