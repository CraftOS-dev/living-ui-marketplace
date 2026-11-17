/**
 * Upstream fetcher (SYSTEM-OWNED — hash-locked in the ownership canon).
 *
 * Puts the app's upstream source — the exact release `upstream.json` pins — at
 * `<app>/<upstream.dir>`, unchanged. The sidecar never edits upstream code: it
 * downloads the authors' own release archive, checks it, and unpacks it.
 *
 *   1. A tree already unpacked from the pinned archive (its marker records the
 *      same SHA-256) is kept as is.
 *   2. Otherwise the archive is read from $A2APP_HOME/cache/upstream/, or
 *      downloaded there once per machine, and its SHA-256 checked against the
 *      pin. An archive whose hash differs is refused, never "probably fine".
 *   3. The old tree is removed and the new one unpacked straight into place
 *      under an `.a2app-unpacking` marker (renaming a freshly unpacked folder
 *      fails on Windows while a virus scanner holds its files). A marker left
 *      behind means an interrupted unpack, which the next run redoes.
 *
 * Links the app makes inside the tree (e.g. a data directory linked out to the
 * app's dataDir) are unlinked first by the app's `detach` hook, so removing an
 * old tree can never reach the data it pointed at.
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { inflateRawSync } from "node:zlib";

const MARKER = ".a2app-upstream.json";
const UNPACKING = ".a2app-unpacking";

export function readPin(appDir) {
  const pin = JSON.parse(readFileSync(join(appDir, "upstream.json"), "utf8"));
  for (const key of ["name", "archive", "sha256", "dir"]) {
    if (typeof pin[key] !== "string" || pin[key] === "") throw new Error(`upstream.json: "${key}" is required`);
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(pin.dir)) throw new Error(`upstream.json: "dir" must be a plain folder name`);
  pin.sha256 = pin.sha256.replace(/^sha256:/, "").toLowerCase();
  return pin;
}

export function upstreamDir(appDir, pin = readPin(appDir)) {
  return join(appDir, pin.dir);
}

/** True when the unpacked tree is the pinned release, complete. */
export function isCurrent(appDir, pin = readPin(appDir)) {
  const dir = upstreamDir(appDir, pin);
  if (existsSync(join(dir, UNPACKING))) return false;
  try {
    return JSON.parse(readFileSync(join(dir, MARKER), "utf8")).sha256 === pin.sha256;
  } catch {
    return false;
  }
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function cacheFile(pin) {
  const home = process.env.A2APP_HOME && process.env.A2APP_HOME.trim() !== "" ? resolve(process.env.A2APP_HOME) : join(homedir(), ".a2app");
  const safe = `${pin.name}-${pin.tag ?? "release"}`.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  return join(home, "cache", "upstream", `${safe}-${pin.sha256.slice(0, 12)}.zip`);
}

async function archiveBytes(pin, log) {
  const cached = cacheFile(pin);
  if (existsSync(cached)) {
    const buf = readFileSync(cached);
    if (sha256(buf) === pin.sha256) return buf;
    rmSync(cached, { force: true });
  }
  log(`downloading ${pin.name} ${pin.tag ?? ""} from ${pin.archive}`);
  const res = await fetch(pin.archive, { redirect: "follow" });
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText} — ${pin.archive}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha256(buf);
  if (got !== pin.sha256) {
    throw new Error(`refusing ${pin.name}: the archive's SHA-256 ${got} does not match the pinned ${pin.sha256}`);
  }
  mkdirSync(dirname(cached), { recursive: true });
  writeFileSync(cached, buf);
  return buf;
}

/** Every entry of a zip archive: name, method, sizes, data offset, unix mode. */
function zipEntries(zip) {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip archive (no end of central directory)");
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error("corrupt zip central directory");
    const method = zip.readUInt16LE(p + 10);
    const compressed = zip.readUInt32LE(p + 20);
    const size = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const external = zip.readUInt32LE(p + 38);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLen);
    const dataAt = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    out.push({ name, method, compressed, size, dataAt, mode: (external >>> 16) & 0xffff });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function unpack(zip, dest) {
  const entries = zipEntries(zip);
  const first = entries[0]?.name.split("/")[0] ?? "";
  const root = first !== "" && entries.every((e) => e.name.startsWith(first + "/")) ? first + "/" : "";
  const base = resolve(dest) + sep;
  let files = 0;
  for (const e of entries) {
    const rel = e.name.slice(root.length);
    if (rel === "") continue;
    const target = resolve(dest, rel);
    if (!(target + (rel.endsWith("/") ? sep : "")).startsWith(base)) throw new Error(`archive entry escapes the target: ${e.name}`);
    if (rel.endsWith("/")) {
      mkdirSync(target, { recursive: true });
      continue;
    }
    const raw = zip.subarray(e.dataAt, e.dataAt + e.compressed);
    const data = e.method === 0 ? raw : e.method === 8 ? inflateRawSync(raw) : null;
    if (data === null) throw new Error(`unsupported zip method ${e.method} for ${e.name}`);
    if (data.length !== e.size) throw new Error(`size mismatch unpacking ${e.name}`);
    mkdirSync(dirname(target), { recursive: true });
    // A symlink in the archive is written as a small text file naming its
    // target — what git does with core.symlinks=false — never as a link.
    const isLink = (e.mode & 0o170000) === 0o120000;
    writeFileSync(target, data, isLink || !(e.mode & 0o111) ? undefined : { mode: 0o755 });
    files++;
  }
  return files;
}

/**
 * Make `<app>/<dir>` the pinned release. `detach(dir)` is the app's hook to
 * unlink anything it linked into an existing tree before that tree is removed.
 */
export async function ensureUpstream(appDir, { log = console.log, detach } = {}) {
  const pin = readPin(appDir);
  const dir = upstreamDir(appDir, pin);
  if (isCurrent(appDir, pin)) {
    log(`${pin.name} ${pin.tag ?? ""} is in place (sha256 ${pin.sha256.slice(0, 12)}…)`);
    return { dir, changed: false };
  }
  const zip = await archiveBytes(pin, log);
  if (existsSync(dir)) {
    if (detach) await detach(dir);
    // Never follow a link out of the tree: unlink a top-level link, then remove.
    if (lstatSync(dir).isSymbolicLink()) unlinkSync(dir);
    else rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, UNPACKING), new Date().toISOString());
  const files = unpack(zip, dir);
  writeFileSync(
    join(dir, MARKER),
    JSON.stringify({ name: pin.name, tag: pin.tag ?? null, commit: pin.commit ?? null, sha256: pin.sha256, unpacked: new Date().toISOString() }, null, 2) + "\n",
  );
  rmSync(join(dir, UNPACKING), { force: true });
  log(`unpacked ${pin.name} ${pin.tag ?? ""}: ${files} files (sha256 ${pin.sha256.slice(0, 12)}… verified)`);
  return { dir, changed: true };
}
