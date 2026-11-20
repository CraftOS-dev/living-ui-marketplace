#!/usr/bin/env node
/**
 * Re-vendor the blueprint-pocketbase-kit toolkit's system files into migrated
 * app folders in this repository, and re-record each app's ownership canon.
 *
 *   node tools/agent-app-migrate/sync-system.mjs <app-folder> [...]   (or --all)
 *
 * The repository's counterpart of `agent-app <dir> toolkit-sync` for the copies
 * published here: run it after `toolkits/blueprint-pocketbase-kit` changes (for
 * example after `scripts/sync-upstream.mjs` pulled a new framework adapter), so
 * every published app ships the toolkit's current system files. App-owned files
 * are never touched; manifest.json keeps its content and only its hash is
 * re-recorded.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const marketplace = resolve(here, "..", "..");
const kit = join(marketplace, "toolkits", "blueprint-pocketbase-kit");
const kitManifest = JSON.parse(readFileSync(join(kit, "a2app.toolkit.json"), "utf8"));
const sha = (buf) => "sha256:" + createHash("sha256").update(buf).digest("hex");

let apps = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (process.argv.includes("--all")) {
  apps = readdirSync(marketplace).filter((d) => {
    const t = join(marketplace, d, ".a2app", "toolkit.json");
    return existsSync(t) && JSON.parse(readFileSync(t, "utf8")).id === kitManifest.id;
  });
}
if (apps.length === 0) {
  console.error("usage: sync-system.mjs <app-folder> [...] | --all");
  process.exit(2);
}

for (const app of apps) {
  const dir = resolve(marketplace, app);
  const tk = join(dir, ".a2app", "toolkit.json");
  if (!existsSync(tk) || JSON.parse(readFileSync(tk, "utf8")).id !== kitManifest.id) {
    console.error(`✗ ${app}: not an app on ${kitManifest.id}`);
    process.exitCode = 1;
    continue;
  }
  let changed = 0;
  for (const rel of kitManifest.systemPaths) {
    if (rel === "manifest.json") continue;
    const from = join(kit, "template", rel);
    const to = join(dir, rel);
    const before = existsSync(to) ? readFileSync(to) : null;
    const next = readFileSync(from);
    if (before === null || !before.equals(next)) {
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
      changed++;
    }
  }
  const canon = {};
  for (const rel of kitManifest.systemPaths) canon[rel] = sha(readFileSync(join(dir, rel)));
  writeFileSync(join(dir, ".a2app", "system-hashes.json"), JSON.stringify(canon, null, 2) + "\n");
  console.log(`✓ ${app}: ${changed} system file(s) updated, canon re-recorded`);
}
