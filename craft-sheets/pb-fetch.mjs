#!/usr/bin/env node
/**
 * PocketBase binary fetcher (SYSTEM-OWNED — hash-locked in the ownership canon).
 *
 * Puts the pinned PocketBase build at pb/pocketbase (pb/pocketbase.exe on
 * Windows). `manifest.pipeline.install` runs it, and `pb-serve.mjs` runs it on a
 * launch that finds no binary, so an app works on a machine that has nothing but
 * Node and the framework.
 *
 *   1. A binary already in pb/ on the pinned version is kept as is.
 *   2. $A2APP_POCKETBASE_BIN, when set, names a binary to copy in (offline use).
 *   3. Otherwise the official release archive is downloaded once per machine into
 *      $A2APP_HOME/cache/pocketbase/<version>/, its SHA-256 checked against the
 *      pin below, and the binary extracted from it.
 *
 * The pin is the whole supply-chain story: an archive whose hash differs from
 * the one recorded here is refused, never "probably fine".
 */
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

export const POCKETBASE_VERSION = "0.39.7";

/** SHA-256 of each official release archive (github.com/pocketbase/pocketbase
 *  releases, checksums.txt for v0.39.7). */
const ARCHIVES = {
  "win32-x64": ["pocketbase_0.39.7_windows_amd64.zip", "0f32dfda39949cfbec38ea18fe99f1e9e49350ce1efe87537591b44dcee51517"],
  "win32-arm64": ["pocketbase_0.39.7_windows_arm64.zip", "93ea40181210b1db7d7a885caf832cbd8945ab6ae1d43ed2c858bfc4390b4d26"],
  "darwin-x64": ["pocketbase_0.39.7_darwin_amd64.zip", "32ee65426529c5fc48b7899431b9cf22e54c40a2f39f9fde92948bcabebaa933"],
  "darwin-arm64": ["pocketbase_0.39.7_darwin_arm64.zip", "f94b96eac1684d35cad5368334c156673fa21ae28df721e712e1cf3b8176aeb8"],
  "linux-x64": ["pocketbase_0.39.7_linux_amd64.zip", "0fe09a4e1a8f6e5b53d206c2e6b94a5812febcb43082d66d69bc8ba4d8e8429c"],
  "linux-arm64": ["pocketbase_0.39.7_linux_arm64.zip", "ff6296e90bb5545592c5696e9d591fa4570fbdf31aaec58b51c70ce7d15f581d"],
};

const here = dirname(fileURLToPath(import.meta.url));
const exe = process.platform === "win32" ? "pocketbase.exe" : "pocketbase";
const target = join(here, "pb", exe);

function versionOf(binary) {
  try {
    return execFileSync(binary, ["--version"], { encoding: "utf8", timeout: 30_000 }).trim().split(" ").pop();
  } catch {
    return null;
  }
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** The one entry named `name` from a zip archive (stored or deflated). */
function unzipEntry(zip, name) {
  // End of central directory: the last 0x06054b50 signature.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip archive");
  const entries = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error("corrupt zip central directory");
    const method = zip.readUInt16LE(p + 10);
    const compressed = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const entryName = zip.toString("utf8", p + 46, p + 46 + nameLen);
    if (entryName === name) {
      const lNameLen = zip.readUInt16LE(local + 26);
      const lExtraLen = zip.readUInt16LE(local + 28);
      const start = local + 30 + lNameLen + lExtraLen;
      const data = zip.subarray(start, start + compressed);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      throw new Error(`unsupported zip compression method ${method}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${name} not found in the archive`);
}

function install(binaryBytes) {
  mkdirSync(dirname(target), { recursive: true });
  const tmp = target + ".download";
  writeFileSync(tmp, binaryBytes);
  if (process.platform !== "win32") chmodSync(tmp, 0o755);
  rmSync(target, { force: true });
  renameSync(tmp, target);
}

export async function ensurePocketBase({ quiet = false } = {}) {
  const say = (m) => {
    if (!quiet) console.log(m);
  };
  if (existsSync(target) && versionOf(target) === POCKETBASE_VERSION) {
    say(`PocketBase ${POCKETBASE_VERSION} is in place (${target})`);
    return target;
  }

  const offline = process.env.A2APP_POCKETBASE_BIN;
  if (offline) {
    const v = versionOf(offline);
    if (v !== POCKETBASE_VERSION) throw new Error(`A2APP_POCKETBASE_BIN (${offline}) is PocketBase ${v ?? "?"}, not ${POCKETBASE_VERSION}`);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(offline, target);
    if (process.platform !== "win32") chmodSync(target, 0o755);
    say(`copied PocketBase ${POCKETBASE_VERSION} from A2APP_POCKETBASE_BIN`);
    return target;
  }

  const pin = ARCHIVES[`${process.platform}-${process.arch}`];
  if (!pin) throw new Error(`no pinned PocketBase build for ${process.platform}-${process.arch}; set A2APP_POCKETBASE_BIN to a ${POCKETBASE_VERSION} binary`);
  const [asset, expected] = pin;
  const home = process.env.A2APP_HOME || join(homedir(), ".a2app");
  const cacheDir = join(home, "cache", "pocketbase", POCKETBASE_VERSION);
  const cached = join(cacheDir, asset);

  let zip = existsSync(cached) ? readFileSync(cached) : null;
  if (zip && sha256(zip) !== expected) zip = null;
  if (!zip) {
    const url = `https://github.com/pocketbase/pocketbase/releases/download/v${POCKETBASE_VERSION}/${asset}`;
    say(`downloading PocketBase ${POCKETBASE_VERSION} (${asset})…`);
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText} — ${url}`);
    zip = Buffer.from(await res.arrayBuffer());
    const got = sha256(zip);
    if (got !== expected) throw new Error(`refusing ${asset}: SHA-256 ${got} does not match the pinned ${expected}`);
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cached, zip);
  }
  install(unzipEntry(zip, exe));
  const v = versionOf(target);
  if (v !== POCKETBASE_VERSION) throw new Error(`the extracted binary reports version ${v ?? "?"}, not ${POCKETBASE_VERSION}`);
  say(`PocketBase ${POCKETBASE_VERSION} installed at ${target}`);
  return target;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  ensurePocketBase().catch((err) => {
    console.error(`could not install PocketBase: ${err.message}`);
    process.exit(1);
  });
}
