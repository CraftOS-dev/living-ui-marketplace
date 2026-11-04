#!/usr/bin/env node
/**
 * Copy the Agent App Framework's PocketBase adapter into this toolkit.
 *
 *   node toolkits/blueprint-pocketbase-kit/scripts/sync-upstream.mjs [path-to-Agent-App]   (default: ../Agent-App)
 *   node toolkits/blueprint-pocketbase-kit/scripts/sync-upstream.mjs --check [path]         (exit 1 on drift)
 *
 * The adapter is the framework's, not ours: the files below are copied byte for
 * byte from `toolkits/blueprint-pocketbase-react/template` and pinned in
 * framework.lock.json by SHA-256. The one file this toolkit adapts is the
 * launcher, which also sets the environment variable the marketplace apps' own
 * engine hooks read (CRAFTBOT_APP_ENV) — recorded as a patch so it is re-applied,
 * never hand-edited.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const kit = resolve(here, "..");
const marketplace = resolve(kit, "..", "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const upstreamRepo = resolve(args.find((a) => !a.startsWith("--")) ?? join(marketplace, "..", "Agent-App"));
const upstream = join(upstreamRepo, "toolkits", "blueprint-pocketbase-react", "template");

const VERBATIM = ["pb-fetch.mjs", "pb-check.mjs", "pb/pb_hooks/_a2app.pb.js", "pb/pb_hooks/_a2app_impl.js", "pb/pb_hooks/_a2app_rules.js"];

const SERVE_PATCH = {
  find: "{ stdio: \"inherit\", env: { ...process.env, A2APP_PUBLIC_DIR: publicDir, A2APP_ENV: env } },",
  replace:
    "// The marketplace apps' engine hooks read CRAFTBOT_APP_ENV (\"shadow\" on a dev\n" +
    "    // boot) to skip first-run downloads on disposable instances.\n" +
    "    { stdio: \"inherit\", env: { ...process.env, A2APP_PUBLIC_DIR: publicDir, A2APP_ENV: env, CRAFTBOT_APP_ENV: env === \"dev\" ? \"shadow\" : \"live\" } },",
};

const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const norm = (text) => text.replace(/\r\n/g, "\n");

if (!existsSync(upstream)) {
  console.error(`no Agent App Framework PocketBase blueprint at ${upstream}`);
  process.exit(2);
}

const files = {};
for (const rel of VERBATIM) files[rel] = norm(readFileSync(join(upstream, rel), "utf8"));
const serve = norm(readFileSync(join(upstream, "pb-serve.mjs"), "utf8"));
if (!serve.includes(SERVE_PATCH.find)) {
  console.error("pb-serve.mjs changed upstream: the launcher patch no longer applies — update SERVE_PATCH");
  process.exit(1);
}
files["pb-serve.mjs"] = serve.replace(SERVE_PATCH.find, SERVE_PATCH.replace);

let commit = "unknown";
let branch = "unknown";
let dirty = false;
try {
  commit = execFileSync("git", ["-C", upstreamRepo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  branch = execFileSync("git", ["-C", upstreamRepo, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();
  dirty = execFileSync("git", ["-C", upstreamRepo, "status", "--porcelain", "--", "toolkits/blueprint-pocketbase-react"], { encoding: "utf8" }).trim() !== "";
} catch {
  /* not a git checkout */
}

const lock = {
  repository: "https://github.com/CraftOS-dev/Agent-App",
  source: "toolkits/blueprint-pocketbase-react/template",
  commit,
  branch,
  uncommittedChanges: dirty,
  files: Object.fromEntries(Object.entries(files).map(([rel, text]) => [rel, "sha256:" + sha(text)])),
  patched: { "pb-serve.mjs": "sets CRAFTBOT_APP_ENV for the apps' engine hooks" },
};

const drift = [];
for (const [rel, text] of Object.entries(files)) {
  const dest = join(kit, "template", rel);
  const current = existsSync(dest) ? norm(readFileSync(dest, "utf8")) : null;
  if (current !== text) drift.push(rel);
  if (!check) {
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, text);
  }
}
if (check) {
  if (drift.length) {
    console.error(`out of date with the framework: ${drift.join(", ")} — run sync-upstream.mjs`);
    process.exit(1);
  }
  console.log("the kit's adapter files match the framework");
} else {
  writeFileSync(join(kit, "framework.lock.json"), JSON.stringify(lock, null, 2) + "\n");
  console.log(`synced ${Object.keys(files).length} file(s) from ${upstream} (${branch} ${commit.slice(0, 12)}${dirty ? ", with uncommitted changes" : ""})`);
}
