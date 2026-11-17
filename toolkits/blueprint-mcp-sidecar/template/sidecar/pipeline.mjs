#!/usr/bin/env node
/**
 * Pipeline steps (SYSTEM-OWNED — hash-locked in the ownership canon).
 *
 *   node sidecar/pipeline.mjs install   pinned upstream + sidecar deps + app install hook
 *   node sidecar/pipeline.mjs build     app build hook
 *
 * `manifest.pipeline` runs these; both are safe to repeat. Uses Node built-ins
 * only, because it runs before the sidecar's own dependencies exist.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APP_DIR, SIDECAR_DIR, baseContext, guardPath, loadAppHooks, log, run } from "./context.mjs";
import { ensureUpstream, isCurrent } from "./upstream.mjs";

/** `npm ci` the sidecar's vendored, hash-pinned dependencies — once per lock. */
function installSidecarDeps() {
  const lock = readFileSync(join(SIDECAR_DIR, "package-lock.json"));
  const stamp = join(SIDECAR_DIR, "node_modules", ".a2app-lock-sha256");
  const want = createHash("sha256").update(lock).digest("hex");
  if (existsSync(stamp) && readFileSync(stamp, "utf8").trim() === want) {
    log("sidecar dependencies are in place");
    return;
  }
  run("npm ci --no-audit --no-fund --ignore-scripts", { cwd: SIDECAR_DIR, retries: 1 });
  writeFileSync(stamp, want + "\n");
}

async function main() {
  const step = process.argv[2];
  if (step !== "install" && step !== "build") {
    process.stderr.write("usage: node sidecar/pipeline.mjs install|build\n");
    process.exit(2);
  }
  guardPath();
  const app = await loadAppHooks();
  if (step === "install") {
    await ensureUpstream(APP_DIR, { log, detach: app.detach });
    installSidecarDeps();
    if (app.install) await app.install(baseContext());
    return;
  }
  if (!isCurrent(APP_DIR)) throw new Error("the pinned upstream is not unpacked yet — run the install step first");
  if (app.build) await app.build(baseContext());
}

main().catch((err) => {
  process.stderr.write(`pipeline failed: ${err?.message ?? err}\n`);
  process.exit(1);
});
