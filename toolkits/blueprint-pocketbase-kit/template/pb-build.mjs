#!/usr/bin/env node
/**
 * The View build (SYSTEM-OWNED — hash-locked; blueprint-pocketbase-kit).
 * `manifest.pipeline.build` runs it; `agent-app serve` and `validate` run that.
 *
 *   node pb-build.mjs           build frontend/ into pb/pb_public/ when its inputs changed
 *   node pb-build.mjs --force   build regardless
 *
 * `serve` builds on every launch, and a strict `tsc` + `vite build` of these
 * apps takes one to three minutes, so the build is skipped when nothing under
 * frontend/ changed since the last one (a SHA-256 over every input file,
 * recorded in .a2app/build-fingerprint.txt) and the built View is still there.
 * A tree whose dependencies were never installed (a fresh import that was not
 * served with --install) gets them installed first, with lifecycle scripts off.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontend = join(here, "frontend");
const built = join(here, "pb", "pb_public", "index.html");
const stamp = join(here, ".a2app", "build-fingerprint.txt");
const SKIP = new Set(["node_modules", "dist", ".vite", "coverage"]);

function fingerprint() {
  const hash = createHash("sha256");
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (SKIP.has(name) || name.endsWith(".tsbuildinfo")) continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else {
        hash.update(relative(frontend, full).replace(/\\/g, "/"));
        hash.update("\0");
        hash.update(readFileSync(full));
        hash.update("\0");
      }
    }
  };
  walk(frontend);
  return hash.digest("hex");
}

function npm(args) {
  // A shell resolves npm(.cmd) on every platform.
  const r = spawnSync(`npm ${args}`, { cwd: here, stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!existsSync(join(frontend, "package.json"))) {
  console.log("no frontend/ to build");
  process.exit(0);
}
const force = process.argv.includes("--force");
const fp = fingerprint();
const previous = existsSync(stamp) ? readFileSync(stamp, "utf8").trim() : "";
if (!force && fp === previous && existsSync(built)) {
  console.log("View is up to date (frontend/ unchanged since the last build)");
  process.exit(0);
}
if (!existsSync(join(frontend, "node_modules"))) {
  npm("--prefix frontend install --ignore-scripts --no-audit --no-fund");
}
npm("--prefix frontend run build");
mkdirSync(dirname(stamp), { recursive: true });
writeFileSync(stamp, fp + "\n");
