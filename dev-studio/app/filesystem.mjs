import * as fs from "node:fs/promises";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  existsSync,
  createReadStream,
} from "node:fs";
import {
  join,
  resolve,
  relative,
  isAbsolute,
  dirname,
  basename,
  extname,
  sep,
} from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { isUtf8 } from "node:buffer";
import { killOwned } from "./jobs-worker.mjs";
import { dataDir } from "./config.mjs";
export const digest = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
let state;
export function authority() {
  if (!state) {
    try {
      state = JSON.parse(
        readFileSync(join(dataDir(), "studio-authority.json"), "utf8"),
      );
    } catch {
      state = {
        projects: {},
        configs: {},
        work: {},
        checkpoints: {},
        preferences: {},
      };
    }
  }
  const port = Number(process.env.VITE_BACKEND_PORT);
  if (
    !state.preferences.craftbotUrl &&
    Number.isInteger(port) &&
    port > 0 &&
    port < 65536
  )
    state.preferences.craftbotUrl = "http://127.0.0.1:" + port;
  return state;
}
export function persist() {
  mkdirSync(dataDir(), { recursive: true });
  const p = join(dataDir(), "studio-authority.json");
  writeFileSync(p + ".tmp", JSON.stringify(authority()), { mode: 0o600 });
  renameSync(p + ".tmp", p);
}
export function project(id) {
  const p = authority().projects[id];
  if (!p) throw new Error("Open this project from the local interface first.");
  return p;
}
export function trusted(id) {
  const p = project(id);
  if (!p.trusted)
    throw new Error(
      "Enable execution for this project in the local interface first.",
    );
  return p;
}
export const ignored = new Set([
  ".git",
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  "dist",
  "build",
  ".next",
  ".cache",
  ".studio",
]);
export const sensitive = (name) =>
  /^\.env(?:\.|$)|^\.agent-token$|^\.principal$|^\.superuser$|^\.npmrc$|^\.ssh$/i.test(
    name,
  );
export async function safePath(
  root,
  path = "",
  { missing = false, secret = true } = {},
) {
  if (
    typeof path !== "string" ||
    path.includes("\0") ||
    isAbsolute(path) ||
    /^[a-zA-Z]:|^[/\\]|(^|[/\\])\.\.([/\\]|$)/.test(path)
  )
    throw new Error("Use a relative path inside the selected project.");
  const segments = path.split(/[/\\]+/).filter((p) => p && p !== ".");
  if (
    segments.some(
      (p) =>
        p.toLowerCase() === ".git" ||
        p.includes(":") ||
        /[. ]$/.test(p) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
    )
  )
    throw new Error("That path is reserved or protected.");
  if (!secret && segments.some(sensitive))
    throw new Error(
      "Credential-bearing files are excluded from agent context.",
    );
  const canonical = await fs.realpath(root);
  let current = canonical;
  for (let i = 0; i < segments.length; i++) {
    current = join(current, segments[i]);
    const stat = await fs.lstat(current).catch((e) => {
      if (e.code === "ENOENT" && missing) return null;
      throw e;
    });
    if (stat?.isSymbolicLink())
      throw new Error(
        "Symlinks and junctions are not editable through the workspace.",
      );
    if (stat) {
      const actual = await fs.realpath(current);
      const rel = relative(canonical, actual);
      if (rel.startsWith(".." + sep) || isAbsolute(rel))
        throw new Error("The resolved path leaves this project.");
    }
  }
  return current;
}
export async function readDocument(root, path, { secret = true } = {}) {
  const full = await safePath(root, path, { secret }),
    st = await fs.stat(full);
  if (!st.isFile()) throw new Error("Select a file.");
  if (st.size > 2 * 1024 * 1024) {
    const hash = createHash("sha256");
    let binary = false;
    for await (const chunk of createReadStream(full)) {
      hash.update(chunk);
      binary ||= chunk.includes(0);
    }
    return {
      path,
      size: st.size,
      large: true,
      binary,
      digest: hash.digest("hex"),
      text: null,
    };
  }
  const bytes = await fs.readFile(full),
    binary = bytes.includes(0) || !isUtf8(bytes),
    extension = extname(path).toLowerCase();
  const mime = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
  }[extension];
  return {
    path,
    size: bytes.length,
    digest: digest(bytes),
    text: binary || mime ? null : bytes.toString("utf8"),
    binary: binary || !!mime,
    image: mime ? `data:${mime};base64,${bytes.toString("base64")}` : null,
    lineEnding: bytes.includes(Buffer.from("\r\n")) ? "CRLF" : "LF",
    encoding: isUtf8(bytes) ? "UTF-8" : "Unsupported encoding",
  };
}
const locks = new Map();
export async function locked(key, fn) {
  key = process.platform === "win32" ? key.toLowerCase() : key;
  const before = locks.get(key) || Promise.resolve();
  let done;
  const next = new Promise((r) => (done = r));
  locks.set(key, next);
  await before;
  try {
    return await fn();
  } finally {
    done();
    if (locks.get(key) === next) locks.delete(key);
  }
}
export async function lockedPaths(root, paths, fn) {
  const keys = [
    ...new Set(paths.map((p) => resolve(root, p).toLowerCase())),
  ].sort();
  const take = (i) =>
    i === keys.length ? fn() : locked(keys[i], () => take(i + 1));
  return take(0);
}
export async function checkpoint(root, path, projectId) {
  const full = await safePath(root, path, { missing: true }),
    bytes = await fs.readFile(full).catch((e) => {
      if (e.code === "ENOENT") return null;
      throw e;
    });
  const id = randomUUID(),
    folder = join(dataDir(), "checkpoints");
  await fs.mkdir(folder, { recursive: true });
  if (bytes) await fs.writeFile(join(folder, id), bytes);
  authority().checkpoints[id] = {
    id,
    project: projectId,
    path,
    exists: bytes !== null,
    digest: bytes ? digest(bytes) : null,
    created: new Date().toISOString(),
  };
  persist();
  return id;
}
export async function writeDocument(
  root,
  path,
  text,
  expected,
  { create = false, projectId, secret = true } = {},
) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 2 * 1024 * 1024)
    throw new Error("Text files are limited to 2 MiB.");
  return locked(resolve(root, path), async () => {
    const full = await safePath(root, path, { missing: true, secret });
    const old = await fs.readFile(full).catch((e) => {
      if (e.code === "ENOENT") return null;
      throw e;
    });
    if (create && old !== null)
      throw new Error("A file already exists at that path.");
    if (!create && (old ? digest(old) : null) !== expected)
      throw new Error(
        "File conflict: the disk changed. Compare the current file before saving again.",
      );
    if (projectId) await checkpoint(root, path, projectId);
    await fs.mkdir(dirname(full), { recursive: true });
    await safePath(root, path, { missing: true, secret });
    const temp = join(dirname(full), ".studio-save-" + randomUUID());
    try {
      await fs.writeFile(temp, text, { flag: "wx" });
      await fs.rename(temp, full);
    } finally {
      await fs.unlink(temp).catch(() => {});
    }
    return readDocument(root, path, { secret });
  });
}
export async function replaceBytes(
  root,
  path,
  bytes,
  expected,
  projectId,
  { alreadyLocked = false } = {},
) {
  const apply = async () => {
    const full = await safePath(root, path, { missing: true, secret: false }),
      old = await fs.readFile(full).catch((e) => {
        if (e.code === "ENOENT") return null;
        throw e;
      });
    if ((old ? digest(old) : null) !== expected)
      throw new Error(
        "File conflict: inspect the destination again before applying.",
      );
    await checkpoint(root, path, projectId);
    await safePath(root, path, { missing: true, secret: false });
    const current = await fs.readFile(full).catch((e) => {
      if (e.code === "ENOENT") return null;
      throw e;
    });
    if ((current ? digest(current) : null) !== expected)
      throw new Error(
        "File conflict: the destination changed while preparing recovery.",
      );
    if (bytes === null) {
      await fs.unlink(full).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
      return;
    }
    await fs.mkdir(dirname(full), { recursive: true });
    const temp = join(dirname(full), ".studio-save-" + randomUUID());
    try {
      await fs.writeFile(temp, bytes, { flag: "wx" });
      await fs.rename(temp, full);
    } finally {
      await fs.unlink(temp).catch(() => {});
    }
  };
  return alreadyLocked ? apply() : lockedPaths(root, [path], apply);
}
export async function tree(root, path = "") {
  const folder = await safePath(root, path),
    entries = await fs.readdir(folder, { withFileTypes: true });
  return entries
    .filter((e) => !ignored.has(e.name) && !e.name.startsWith(".studio-save-"))
    .sort(
      (a, b) =>
        Number(b.isDirectory()) - Number(a.isDirectory()) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 1000)
    .map((e) => ({
      name: e.name,
      path: [path, e.name].filter(Boolean).join("/"),
      kind: e.isSymbolicLink() ? "link" : e.isDirectory() ? "folder" : "file",
    }));
}
export function outputExclusions(paths = []) {
  return [
    ...new Set(
      paths.map((path) => {
        const value = String(path)
          .replaceAll("\\", "/")
          .replace(/^(?:\.\/)+/, "")
          .replace(/\/+$/, "");
        if (
          !value ||
          value === "." ||
          value.startsWith("/") ||
          /^[a-z]:/i.test(value) ||
          value.split("/").includes("..")
        )
          throw new Error(
            "Choose individual output files or folders, not the project root or parent paths.",
          );
        return value;
      }),
    ),
  ];
}
export async function snapshot(
  root,
  { maxFiles = 10000, excludePaths = [] } = {},
) {
  const excluded = outputExclusions(excludePaths);
  const files = {};
  let count = 0,
    total = 0;
  async function walk(path) {
    for (const e of await fs.readdir(join(root, path), {
      withFileTypes: true,
    })) {
      if (
        ignored.has(e.name) ||
        sensitive(e.name) ||
        e.name.startsWith(".studio-save-")
      )
        continue;
      const rel = [path, e.name].filter(Boolean).join("/");
      if (
        excluded.some(
          (output) => rel === output || rel.startsWith(output + "/"),
        )
      )
        continue;
      if (e.isSymbolicLink())
        throw new Error(
          "This source snapshot contains a symlink/junction. Remove it from the managed source tree first.",
        );
      if (e.isDirectory()) await walk(rel);
      else if (e.isFile()) {
        if (++count > maxFiles)
          throw new Error(
            "This project exceeds the 10,000 source-file limit; exclude generated output first.",
          );
        const st = await fs.stat(join(root, rel));
        total += st.size;
        if (st.size > 32 * 1024 * 1024 || total > 256 * 1024 * 1024)
          throw new Error(
            "Source snapshots are limited to 32 MiB per file and 256 MiB total.",
          );
        const b = await fs.readFile(join(root, rel));
        files[rel] = {
          digest: digest(b),
          size: b.length,
          binary: b.includes(0),
        };
      }
    }
  }
  await walk("");
  return {
    files,
    fingerprint: digest(
      JSON.stringify(
        Object.entries(files).sort(([a], [b]) => a.localeCompare(b)),
      ),
    ),
  };
}
export function command(
  executable,
  args = [],
  { cwd, timeout = 15000, max = 2 * 1024 * 1024, env, input } = {},
) {
  return new Promise((yes, no) => {
    const child = spawn(executable, args, {
      cwd,
      env: env || process.env,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let out = "",
      err = "",
      done = false;
    if (input !== undefined) {
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    }
    const timer = setTimeout(async () => {
      try {
        await killOwned(child);
      } catch (e) {
        if (!done) {
          done = true;
          no(e);
        }
        return;
      }
      if (!done) {
        done = true;
        no(new Error("Tool timed out."));
      }
    }, timeout);
    child.stdout.on("data", (d) => {
      out = (out + d).slice(-max);
    });
    child.stderr.on("data", (d) => {
      err = (err + d).slice(-max);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      if (!done) {
        done = true;
        no(
          new Error(
            `Cannot start ${basename(executable)}: ${e.code || e.message}`,
          ),
        );
      }
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (!done) {
        done = true;
        yes({ code, stdout: out, stderr: err });
      }
    });
  });
}
export async function git(
  root,
  args,
  { allowFail = false, timeout = 15000 } = {},
) {
  const r = await command(
    "git",
    [
      "-C",
      root,
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.hooksPath=" + join(dataDir(), "disabled-hooks"),
      "-c",
      "diff.external=",
      "-c",
      "core.quotePath=false",
      ...args,
    ],
    {
      timeout,
      env: {
        ...process.env,
        GIT_EXTERNAL_DIFF: "",
        GIT_CONFIG_COUNT: "0",
        GIT_TERMINAL_PROMPT: "0",
      },
    },
  );
  if (r.code && !allowFail)
    throw new Error(
      (r.stderr || r.stdout || "Git command failed")
        .replace(/https?:\/\/[^\s@]+@/g, "https://[redacted]@")
        .slice(0, 1500),
    );
  return r;
}
export async function detect(root) {
  const has = async (f) => !!(await fs.stat(join(root, f)).catch(() => null));
  const type = (await has("package.json"))
    ? "javascript"
    : (await has("pyproject.toml")) ||
        (await has("requirements.txt")) ||
        (await has("main.py"))
      ? "python"
      : "generic";
  const g = await git(root, ["rev-parse", "--show-toplevel"], {
    allowFail: true,
  });
  let scripts = {};
  try {
    scripts =
      JSON.parse(await fs.readFile(join(root, "package.json"), "utf8"))
        .scripts || {};
  } catch {}
  return {
    profile: type,
    git: g.code === 0,
    gitRoot: g.code === 0 ? g.stdout.trim() : null,
    scripts,
  };
}
export async function registerRoot(path, name) {
  if (!isAbsolute(path))
    throw new Error("Enter an absolute project folder path.");
  const root = await fs.realpath(path);
  if (!(await fs.stat(root)).isDirectory()) throw new Error("Choose a folder.");
  const known = Object.values(authority().projects).find(
    (p) => p.root.toLowerCase() === root.toLowerCase(),
  );
  const p = {
    ...(known || {
      id: randomUUID(),
      trusted: false,
      created: new Date().toISOString(),
    }),
    root,
    name: name || known?.name || basename(root),
    ...(await detect(root)),
    opened: new Date().toISOString(),
  };
  authority().projects[p.id] = p;
  persist();
  return p;
}
export async function search(root, query) {
  if (!query || query.length > 500)
    throw new Error("Enter 1–500 search characters.");
  const args = [
    "--json",
    "--fixed-strings",
    "--max-count",
    "50",
    "--max-filesize",
    "2M",
    "--glob",
    "!{node_modules,.git,.venv,dist,build}/**",
    "--glob",
    "!.env*",
    "--glob",
    "!.agent-token",
    "--",
    query,
    root,
  ];
  const result = await command("rg", args, { cwd: root, max: 1024 * 1024 });
  if (result.code > 1)
    throw new Error("Search failed. Ensure ripgrep is installed.");
  const matches = [];
  for (const line of result.stdout.split("\n")) {
    try {
      const item = JSON.parse(line);
      if (item.type === "match")
        matches.push({
          path: relative(root, item.data.path.text).replaceAll("\\", "/"),
          line: item.data.line_number,
          text: item.data.lines.text.trimEnd(),
        });
    } catch {}
  }
  return { matches: matches.slice(0, 500), truncated: matches.length >= 500 };
}
