#!/usr/bin/env node
/**
 * PocketBase launcher (SYSTEM-OWNED — hash-locked in the ownership canon).
 *
 * `manifest.pipeline.start` is `node pb-serve.mjs`; this is the entry point the
 * framework's `serve` AND `dev` spawn. One launcher, one code path, three
 * redirected inputs from the launch contract:
 *
 *   PORT            the port to bind (`serve` passes manifest.port; `dev` a
 *                   hidden one). Falls back to manifest.port when run by hand.
 *   A2APP_DATA_DIR  the data directory (`serve` passes pb/pb_data; `dev` a
 *                   fresh per-boot directory). Defaults to pb/pb_data.
 *   A2APP_ENV       "live" or "dev". Defaults to "live".
 *
 * Environment semantics — "live loads code at boot":
 *   live  hooks are pinned (--hooksWatch=false) and the static View is served
 *         from a SNAPSHOT of pb/pb_public taken at this boot (.a2app/public).
 *         PocketBase serves static files from disk per request, so without the
 *         snapshot a mid-iteration edit to the View would reach live users on
 *         their next refresh — before any gate or verify has seen it.
 *   dev   the tree itself is served: pb/pb_public directly (edit → refresh)
 *         and hooks under watch (auto-restart on edit where the OS supports
 *         it; PocketBase documents no effect on Windows — re-run `dev` there).
 *
 * A superuser is ensured in the target data directory BEFORE serving, from the
 * project-local `.superuser` credential (minted on first use, mode 0600,
 * gitignored). Without one, PocketBase prints an unauthenticated admin-installer
 * URL and pops the setup page — on every fresh dev database, and on the live
 * first serve. Failure to ensure it refuses to serve rather than serving an
 * installable admin takeover.
 *
 * `node pb-serve.mjs --migrate` is the toolkit's `lifecycle.promote`: it applies
 * pending migrations to the data directory and exits. The output is WATCHED,
 * not trusted: PocketBase's `migrate up` can exit 0 on failure and wedge
 * silently on a panic, so a panic line fails the run and a hard timeout bounds
 * it.
 *
 * Why a launcher rather than raw commands in the manifest: `serve` spawns the
 * start command through the OS shell, and `pb/pocketbase serve --http
 * 127.0.0.1:${PORT}` is not portable across shells (cmd.exe expands neither
 * `${PORT}` nor `/`-separated executables). Node resolves both.
 */
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pbDir = join(here, "pb");

// The adapter (pb/pb_hooks/_a2app*.js) targets the PocketBase 0.39 JSVM API and
// the blueprint is pinned to that line (pb-fetch.mjs holds the exact build).
// Other lines moved hook and DAO APIs, so a mismatched binary fails deep inside
// a hook with an opaque ReferenceError. This is the required series.
const SUPPORTED_SERIES = "0.39.";

const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
const port = process.env.PORT ?? manifest.port;
const env = process.env.A2APP_ENV ?? "live";
const dataDir = process.env.A2APP_DATA_DIR ?? join(pbDir, "pb_data");
const hooksDir = join(pbDir, "pb_hooks");
const migrationsDir = join(pbDir, "pb_migrations");
const publicSrc = join(pbDir, "pb_public");

const migrateMode = process.argv.includes("--migrate");
if (!migrateMode && !port) {
  console.error("no port to bind: set PORT in the environment or `port` in manifest.json");
  process.exit(1);
}

// PocketBase ships as `pocketbase` on POSIX and `pocketbase.exe` on Windows;
// both live in `pb/` (see the pipeline `install` step).
const binary = join(pbDir, process.platform === "win32" ? "pocketbase.exe" : "pocketbase");
// `pocketbase --version` prints "pocketbase[.exe] version 0.39.7"; the version
// is the last token.
const versionOf = () => {
  try {
    return execFileSync(binary, ["--version"], { encoding: "utf8" }).trim().split(" ").pop();
  } catch {
    return "";
  }
};
let version = existsSync(binary) ? versionOf() : "";
if (!version.startsWith(SUPPORTED_SERIES)) {
  // A launch on a machine that never ran the pipeline's install step (or that
  // holds another PocketBase line) fetches the pinned build itself.
  const { ensurePocketBase } = await import("./pb-fetch.mjs");
  try {
    await ensurePocketBase();
  } catch (err) {
    console.error(`PocketBase ${SUPPORTED_SERIES}x is not at ${binary} and could not be fetched: ${err.message}`);
    process.exit(1);
  }
  version = versionOf();
}

// Assert the binary is on the supported series.
if (!version.startsWith(SUPPORTED_SERIES)) {
  console.error(
    `PocketBase ${version} is not supported: this app's adapter targets the ${SUPPORTED_SERIES}x JSVM API. ` +
      `Run \`node pb-fetch.mjs\` to put the pinned build in pb/.`,
  );
  process.exit(1);
}

// PocketBase resolves these relative to the binary when unset; passing them
// explicitly means the launcher — not the binary's location — defines the
// layout. The migrations dir must exist (a scaffolded app has none yet).
mkdirSync(migrationsDir, { recursive: true });

/** Recursive copy without fs.cpSync — cpSync silently crashes on Windows when
 *  the source path contains non-ASCII characters (exit 0xC0000409, no JS error;
 *  the framework's own fsx.ts documents the same finding). */
function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    const from = join(src, name);
    const to = join(dest, name);
    if (statSync(from).isDirectory()) copyDir(from, to);
    else copyFileSync(from, to);
  }
}

/**
 * Watched PocketBase invocation for migrations. `migrate up` is not trusted to
 * report its own failure: it can exit 0 after an error and wedge on a recovered
 * panic. A panic line fails the run; a hard timeout bounds it.
 */
function runMigrate() {
  const child = spawn(binary, ["migrate", "up", "--dir", dataDir, "--migrationsDir", migrationsDir, "--hooksDir", hooksDir], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let sawPanic = false;
  const watch = (chunk) => {
    const text = chunk.toString();
    output += text;
    process.stdout.write(text);
    if (/panic|RECOVERED FROM PANIC/i.test(text)) {
      sawPanic = true;
      child.kill("SIGKILL");
    }
  };
  child.stdout.on("data", watch);
  child.stderr.on("data", watch);
  const timeout = setTimeout(() => {
    console.error("migrate up exceeded 120s — killing it. A wedged migration usually means a panic inside a migration file.");
    sawPanic = true;
    child.kill("SIGKILL");
  }, 120_000);
  child.on("error", (err) => {
    clearTimeout(timeout);
    console.error(`failed to run migrate: ${err.message}`);
    process.exit(1);
  });
  child.on("exit", (code) => {
    clearTimeout(timeout);
    if (sawPanic) {
      console.error("migration FAILED (panic or timeout — see output above). The live database was left as the migration engine left it; the pre-promote backup is the way back.");
      process.exit(1);
    }
    process.exit(code ?? 1);
  });
}

if (migrateMode) {
  runMigrate();
} else {
  // Ensure a superuser exists in the TARGET data directory before serving.
  // The command bootstraps the database if the directory is empty — which, for
  // a dev boot, is also what replays the full migration chain into it.
  const superuserFile = join(here, ".superuser");
  let creds = null;
  if (existsSync(superuserFile)) {
    try {
      const parsed = JSON.parse(readFileSync(superuserFile, "utf8"));
      if (typeof parsed.email === "string" && typeof parsed.password === "string") creds = parsed;
    } catch {
      /* unreadable — refuse below rather than silently minting a second credential */
    }
    if (creds === null) {
      console.error(`${superuserFile} exists but is not readable JSON {email, password} — fix or delete it`);
      process.exit(1);
    }
  } else {
    creds = { email: "agent@a2app.local", password: randomBytes(24).toString("base64url") };
  }
  try {
    execFileSync(binary, ["superuser", "upsert", creds.email, creds.password, "--dir", dataDir, "--migrationsDir", migrationsDir, "--hooksDir", hooksDir], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    });
  } catch (err) {
    // Fail closed: serving without a superuser makes PocketBase print an
    // unauthenticated admin-installer link and open the setup page.
    console.error(`could not ensure a superuser in ${dataDir} — refusing to serve.`);
    console.error(String(err.stdout ?? "") + String(err.stderr ?? "") || err.message);
    process.exit(1);
  }
  if (!existsSync(superuserFile)) {
    writeFileSync(superuserFile, JSON.stringify(creds, null, 2) + "\n", { mode: 0o600 });
  }

  // The View: live serves a boot-time snapshot; dev serves the tree.
  let publicDir = publicSrc;
  if (env === "live" && existsSync(publicSrc)) {
    const snapshot = join(here, ".a2app", "public");
    rmSync(snapshot, { recursive: true, force: true });
    copyDir(publicSrc, snapshot);
    publicDir = snapshot;
  }

  // CORS: PocketBase answers `Access-Control-Allow-Origin: *` by default, which
  // would let any page the user visits read this loopback app. Only the app's
  // own origins (and any the host adds) are granted.
  const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`]
    .concat(String(process.env.A2APP_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean))
    .join(",");

  const child = spawn(
    binary,
    [
      "serve",
      "--http",
      `127.0.0.1:${port}`,
      "--dir",
      dataDir,
      "--hooksDir",
      hooksDir,
      "--migrationsDir",
      migrationsDir,
      "--publicDir",
      publicDir,
      "--origins",
      origins,
      // Live must never hot-load an unverified edit; dev wants exactly that.
      `--hooksWatch=${env === "dev"}`,
      `--dev=${env === "dev"}`,
    ],
    // The adapter fingerprints the View it is actually serving (identity
    // `appVersion`), which on live is the boot snapshot, not pb/pb_public.
    // The marketplace apps' engine hooks read CRAFTBOT_APP_ENV ("shadow" on a dev
    // boot) to skip first-run downloads on disposable instances.
    { stdio: "inherit", env: { ...process.env, A2APP_PUBLIC_DIR: publicDir, A2APP_ENV: env, CRAFTBOT_APP_ENV: env === "dev" ? "shadow" : "live" } },
  );

  // Forward termination so a direct SIGINT/SIGTERM reaches PocketBase; `serve`/
  // `stop` signal the whole process tree, but a launcher stopped on its own must
  // not orphan the child.
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));

  child.on("error", (err) => {
    console.error(`failed to launch PocketBase: ${err.message}`);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
}
