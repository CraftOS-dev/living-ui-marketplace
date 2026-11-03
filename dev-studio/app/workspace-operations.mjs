import { inspectArtifacts } from "./artifacts.mjs";
import * as fs from "node:fs/promises";
import { watch } from "node:fs";
import { join, dirname, isAbsolute, basename, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { ROOT, dataDir, requireHuman } from "./config.mjs";
import {
  authority,
  persist,
  project,
  trusted,
  registerRoot,
  safePath,
  readDocument,
  writeDocument,
  tree,
  snapshot,
  outputExclusions,
  git,
  search,
  checkpoint,
  digest,
  command,
  locked,
  lockedPaths,
} from "./filesystem.mjs";
import { runtimeCall } from "./runtime.mjs";
import { taskReceipt } from "./task-state.mjs";
import { pickProjectFolder } from "./folder-picker.mjs";
const s = (required = true, max = 500) => ({ type: "string", required, max });
const ref = (entity, required = true) => ({ type: "ref", entity, required });
const p = ref("projects");
const path = s(true, 1000),
  work = ref("work", false);
const op = (name, module, entity, description, params, extra = {}) => ({
  name,
  module,
  entity,
  description,
  params,
  destructive: false,
  ...extra,
});
const watchers = new Map();
function watchProject(p, store) {
  if (watchers.has(p.id)) return;
  let timer;
  try {
    const watcher = watch(p.root, { recursive: true }, (_kind, name) => {
      const normalized = String(name || "").replaceAll("\\", "/");
      if (
        normalized
          .split("/")
          .some((n) =>
            [
              ".git",
              "node_modules",
              ".venv",
              "dist",
              "build",
              ".a2app",
            ].includes(n),
          ) ||
        join(p.root, String(name || "")).startsWith(dataDir())
      )
        return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        p.changedAt = new Date().toISOString();
        store.put("projects", p);
      }, 200);
    });
    watcher.on("error", () => {});
    watcher.unref();
    watchers.set(p.id, watcher);
  } catch {}
}
export const workspaceOperations = [
  op(
    "project-browse",
    "workspace",
    undefined,
    "Choose a project folder with the Windows picker (local interface only).",
    { initial: s(false, 1000) },
  ),
  op(
    "workspace-state",
    "workspace",
    undefined,
    "Saved projects, configurations, runs and work.",
    {},
    { readOnly: true, idempotent: true },
  ),
  op(
    "project-open",
    "workspace",
    "projects",
    "Register an existing local folder without changing its files.",
    { path, name: s(false, 120) },
  ),
  op(
    "project-create",
    "workspace",
    "projects",
    "Create an empty, JavaScript or Python starter in a new folder.",
    {
      path,
      kind: {
        type: "enum",
        values: ["empty", "javascript", "python"],
        required: true,
      },
    },
  ),
  op(
    "project-clone",
    "workspace",
    "projects",
    "Clone a repository into a new local destination.",
    { url: s(true, 2000), path },
  ),
  op(
    "project-trust",
    "workspace",
    "projects",
    "Allow or revoke local execution for this project.",
    { project: p, enabled: { type: "boolean", required: true } },
  ),
  op(
    "project-tree",
    "workbench",
    undefined,
    "Browse a folder's actual files.",
    { project: ref("projects", false), work, path: s(false, 1000) },
    { readOnly: true, idempotent: true },
  ),
  op(
    "file-read",
    "workbench",
    undefined,
    "Read a file, hash or image preview.",
    { project: ref("projects", false), work, path },
    { readOnly: true, idempotent: true },
  ),
  op(
    "file-write",
    "workbench",
    undefined,
    "Save text only if the expected disk hash still matches.",
    {
      project: ref("projects", false),
      work,
      path,
      text: s(false, 2097152),
      expected: s(false, 64),
      create: { type: "boolean" },
    },
  ),
  op(
    "file-move",
    "workbench",
    "files",
    "Move or rename one file or folder inside its project.",
    { project: p, path, to: path },
  ),
  op(
    "file-trash",
    "workbench",
    "files",
    "Move a file to recoverable app storage; directories must be empty.",
    { project: p, path },
    { destructive: true },
  ),
  op(
    "folder-create",
    "workbench",
    "files",
    "Create a directory inside the selected project.",
    { project: p, path },
  ),
  op(
    "project-search",
    "workbench",
    "searches",
    "Find literal text in project source files.",
    { project: p, query: s(true, 500) },
    { readOnly: true, idempotent: true },
  ),
  op(
    "replace-preview",
    "workbench",
    "searches",
    "Preview literal replacements with expected hashes.",
    { project: p, query: s(true, 500), replacement: s(true, 5000) },
    { readOnly: true, idempotent: true },
  ),
  op(
    "replace-apply",
    "workbench",
    "searches",
    "Apply only the selected, unchanged replacement previews.",
    {
      project: p,
      query: s(true, 500),
      replacement: s(true, 5000),
      files: { type: "json", required: true },
    },
  ),
  op(
    "checkpoint-list",
    "changes",
    "checkpoints",
    "List recoverable file versions.",
    { project: p },
    { readOnly: true, idempotent: true },
  ),
  op(
    "checkpoint-restore",
    "changes",
    "checkpoints",
    "Restore one file version after checking its current hash.",
    { checkpoint: ref("checkpoints"), expected: s(false, 64) },
    { destructive: true },
  ),
  op(
    "git-status",
    "changes",
    "repositories",
    "Inspect branch and staged/unstaged changes.",
    { project: p },
    { readOnly: true, idempotent: true },
  ),
  op(
    "git-diff",
    "changes",
    "repositories",
    "Read the current file diff and history.",
    { project: p, path: s(false, 1000), staged: { type: "boolean" } },
    { readOnly: true, idempotent: true },
  ),
  op(
    "git-init",
    "changes",
    "repositories",
    "Explicitly initialize Git in this project.",
    { project: p },
  ),
  op(
    "git-stage",
    "changes",
    "repositories",
    "Stage or unstage a selected path.",
    { project: p, path, unstage: { type: "boolean" } },
  ),
  op(
    "git-commit",
    "changes",
    "repositories",
    "Commit the staged changes with a message.",
    { project: p, message: s(true, 1000) },
  ),
  op(
    "git-remote",
    "changes",
    "repositories",
    "Explicit fetch, fast-forward pull, or push.",
    {
      project: p,
      action: {
        type: "enum",
        values: ["fetch", "pull", "push"],
        required: true,
      },
      remote: s(false, 80),
    },
  ),
  op(
    "config-save",
    "execution",
    "configs",
    "Save a named command and working directory.",
    {
      project: p,
      id: s(false, 100),
      name: s(true, 120),
      command: s(true, 4000),
      cwd: s(false, 1000),
      envNames: { type: "json" },
      artifactPaths: { type: "json" },
      kind: {
        type: "enum",
        values: [
          "install",
          "develop",
          "build",
          "test",
          "lint",
          "format",
          "custom",
        ],
        required: true,
      },
    },
  ),
  op(
    "run-start",
    "execution",
    "configs",
    "Run a trusted saved command, optionally in an agent copy.",
    { config: ref("configs"), work },
  ),
  op(
    "run-inspect",
    "execution",
    "runs",
    "Read output, actual exit and whether source changed.",
    { run: ref("runs") },
    { idempotent: true },
  ),
  op(
    "run-stop",
    "execution",
    "runs",
    "Stop this owned command and its child processes.",
    { run: ref("runs") },
  ),
  op(
    "project-terminal",
    "execution",
    "runs",
    "Open a local terminal at the trusted project root.",
    { project: p },
  ),
  op(
    "tools-status",
    "settings",
    undefined,
    "Inspect installed Git, ripgrep, Node, Python and connector tools.",
    {},
    { readOnly: true, idempotent: true },
  ),
  op(
    "preferences-save",
    "settings",
    undefined,
    "Save theme and Python interpreter preferences.",
    {
      theme: {
        type: "enum",
        values: ["system", "dark", "light"],
        required: true,
      },
      python: s(false, 1000),
    },
  ),
  op(
    "format-text",
    "workbench",
    "files",
    "Format a JS/TS/JSON/Markdown or Python buffer.",
    { project: p, path, text: s(false, 2097152) },
    { readOnly: true, idempotent: true },
  ),
];
export async function scope(
  args,
  ctx,
  { write = false, execute = false } = {},
) {
  if (args.work) {
    const w = authority().work[args.work];
    if (!w) throw new Error("Unknown isolated work item.");
    if (ctx.credentialId !== "ui") {
      if (w.status !== "running" || !w.task)
        throw new Error("This work item has no active write lease.");
      const task = await taskReceipt(w.task);
      if (task.status !== "working")
        throw new Error("The agent task is no longer actively claimed.");
    }
    if (write && !["running", "ready", "needs-input"].includes(w.status))
      throw new Error("This work item is closed.");
    if (execute) trusted(w.project);
    return {
      root: w.root,
      project: project(w.project),
      work: w,
      secret: ctx.credentialId === "ui",
    };
  }
  if (ctx.credentialId !== "ui" && write)
    throw new Error("Agents write only inside an active isolated work item.");
  const pr = execute ? trusted(args.project) : project(args.project);
  return { root: pr.root, project: pr, secret: ctx.credentialId === "ui" };
}
function putProject(store, p) {
  store.put("projects", p);
  store.put("repositories", { id: p.id, project: p.id, root: p.root });
}
async function suggestions(p, store) {
  if (Object.values(authority().configs).some((c) => c.project === p.id))
    return;
  const configs =
    p.profile === "javascript"
      ? Object.keys(p.scripts)
          .filter((k) =>
            ["dev", "start", "build", "test", "lint", "format"].includes(k),
          )
          .map((k) => ({
            name: k,
            command: `npm run ${k}`,
            kind: k === "dev" || k === "start" ? "develop" : k,
          }))
      : p.profile === "python"
        ? [
            { name: "Run Python", command: "python main.py", kind: "develop" },
            {
              name: "Test Python",
              command: "python -m unittest discover -v",
              kind: "test",
            },
          ]
        : [];
  for (const c of configs) {
    c.id = randomUUID();
    c.project = p.id;
    c.cwd = "";
    authority().configs[c.id] = c;
    store.put("configs", c);
  }
  persist();
}
export const workspaceRunners = {
  "project-browse": async (args, ctx) => {
    requireHuman(ctx);
    return pickProjectFolder(args.initial || "");
  },
  "workspace-state": (_a, _c, { store }) => {
    for (const p of Object.values(authority().projects)) watchProject(p, store);
    return {
      projects: Object.values(authority().projects).sort((a, b) =>
        b.opened.localeCompare(a.opened),
      ),
      configs: Object.values(authority().configs),
      runs: store
        .list("runs")
        .filter((r) => r.started)
        .sort((a, b) => b.started.localeCompare(a.started))
        .slice(0, 100)
        .map((r) => ({ ...r, output: r.output?.slice(-500) })),
      work: store
        .list("work")
        .filter((w) => w.created)
        .sort((a, b) => b.created.localeCompare(a.created))
        .slice(0, 100),
      preferences: authority().preferences,
    };
  },
  "project-open": async (args, ctx, { store }) => {
    requireHuman(ctx);
    const p = await registerRoot(args.path, args.name);
    putProject(store, p);
    watchProject(p, store);
    await suggestions(p, store);
    return p;
  },
  "project-create": async (args, ctx, deps) => {
    requireHuman(ctx);
    if (!isAbsolute(args.path))
      throw new Error("Enter an absolute path for the new folder.");
    await fs.mkdir(args.path, { recursive: false });
    const files =
      args.kind === "javascript"
        ? {
            "package.json":
              JSON.stringify(
                {
                  name: basename(args.path)
                    .toLowerCase()
                    .replace(/[^a-z0-9-]/g, "-"),
                  private: true,
                  type: "module",
                  scripts: { test: "node --test", start: "node main.js" },
                },
                null,
                2,
              ) + "\n",
            "main.js":
              "export function greet(name) { return `Hello, ${name}!`; }\nconsole.log(greet('world'));\n",
            "main.test.js":
              "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {greet} from './main.js';\ntest('greeting', () => assert.equal(greet('world'), 'Hello, world!'));\n",
          }
        : args.kind === "python"
          ? {
              "main.py":
                "def greet(name):\n    return f'Hello, {name}!'\n\nif __name__ == '__main__':\n    print(greet('world'))\n",
              "test_main.py":
                "import unittest\nfrom main import greet\n\nclass GreetingTest(unittest.TestCase):\n    def test_greeting(self):\n        self.assertEqual(greet('world'), 'Hello, world!')\n",
            }
          : {};
    for (const [name, content] of Object.entries(files))
      await fs.writeFile(join(args.path, name), content, { flag: "wx" });
    return workspaceRunners["project-open"]({ path: args.path }, ctx, deps);
  },
  "project-clone": async (args, ctx, deps) => {
    requireHuman(ctx);
    if (!isAbsolute(args.path))
      throw new Error("Use an absolute destination path.");
    if (await fs.stat(args.path).catch(() => null))
      throw new Error("Clone into a new, nonexistent folder.");
    const u = new URL(args.url);
    if (
      !["https:", "http:", "file:"].includes(u.protocol) ||
      u.username ||
      u.password
    )
      throw new Error(
        "Use an HTTPS or file repository URL without embedded credentials.",
      );
    await git(dirname(args.path), ["clone", "--", args.url, args.path], {
      timeout: 120000,
    });
    return workspaceRunners["project-open"]({ path: args.path }, ctx, deps);
  },
  "project-trust": (args, ctx, { store }) => {
    requireHuman(ctx);
    const p = project(args.project);
    p.trusted = args.enabled;
    persist();
    putProject(store, p);
    return p;
  },
  "project-tree": async (args, ctx) => {
    const v = await scope(args, ctx);
    return { entries: await tree(v.root, args.path || "") };
  },
  "file-read": async (args, ctx) => {
    const v = await scope(args, ctx);
    return readDocument(v.root, args.path, { secret: v.secret });
  },
  "file-write": async (args, ctx) => {
    const v = await scope(args, ctx, { write: true });
    return writeDocument(
      v.root,
      args.path,
      args.text ?? "",
      args.expected ?? null,
      {
        create: !!args.create,
        projectId: args.work ? null : v.project.id,
        secret: v.secret,
      },
    );
  },
  "folder-create": async (args, ctx) => {
    requireHuman(ctx);
    const root = project(args.project).root,
      full = await safePath(root, args.path, { missing: true });
    if (full === root) throw new Error("Name a child folder.");
    await fs.mkdir(full, { recursive: false });
    return { path: args.path, created: true };
  },
  "file-move": async (args, ctx) => {
    requireHuman(ctx);
    const root = project(args.project).root,
      from = await safePath(root, args.path),
      to = await safePath(root, args.to, { missing: true });
    if (from === root || to === root || !args.path || !args.to)
      throw new Error("The project root cannot be moved.");
    if (await fs.stat(to).catch(() => null))
      throw new Error("The destination already exists.");
    await fs.rename(from, to);
    return { path: args.to, moved: true };
  },
  "file-trash": async (args, ctx) => {
    requireHuman(ctx);
    const root = project(args.project).root,
      full = await safePath(root, args.path);
    if (full === root || !args.path)
      throw new Error("The project root cannot be removed.");
    const st = await fs.stat(full);
    if (st.isDirectory()) {
      await fs.rmdir(full);
      return { path: args.path, removedEmptyFolder: true };
    }
    const id = await checkpoint(root, args.path, args.project);
    await fs.unlink(full);
    return { path: args.path, checkpoint: id, trashed: true };
  },
  "project-search": (args) => search(project(args.project).root, args.query),
  "replace-preview": async (args) => {
    const root = project(args.project).root,
      result = await search(root, args.query),
      files = [];
    for (const path of [...new Set(result.matches.map((m) => m.path))]) {
      const d = await readDocument(root, path);
      if (d.text !== null)
        files.push({
          path,
          expected: d.digest,
          before: d.text,
          after: d.text.split(args.query).join(args.replacement),
          count: d.text.split(args.query).length - 1,
        });
    }
    return { files, truncated: result.truncated };
  },
  "replace-apply": async (args, ctx) => {
    requireHuman(ctx);
    if (!Array.isArray(args.files) || args.files.length > 100)
      throw new Error("Select up to 100 previewed files.");
    const root = project(args.project).root;
    for (const f of args.files) {
      const d = await readDocument(root, f.path);
      if (d.digest !== f.expected)
        throw new Error(`Conflict in ${f.path}; preview replacements again.`);
    }
    const changed = [];
    for (const f of args.files) {
      const d = await readDocument(root, f.path);
      await writeDocument(
        root,
        f.path,
        d.text.split(args.query).join(args.replacement),
        f.expected,
        { projectId: args.project },
      );
      changed.push(f.path);
    }
    return { changed };
  },
  "checkpoint-list": (args) => ({
    items: Object.values(authority().checkpoints)
      .filter((c) => c.project === args.project)
      .sort((a, b) => b.created.localeCompare(a.created))
      .slice(0, 100),
  }),
  "checkpoint-restore": async (args, ctx) => {
    requireHuman(ctx);
    const c = authority().checkpoints[args.checkpoint];
    if (!c) throw new Error("Checkpoint not found.");
    const root = project(c.project).root;
    return lockedPaths(root, [c.path], async () => {
      const full = await safePath(root, c.path, { missing: true });
      const current = await fs.readFile(full).catch((e) => {
        if (e.code === "ENOENT") return null;
        throw e;
      });
      if ((current ? digest(current) : null) !== (args.expected ?? null))
        throw new Error(
          "File conflict: inspect its current version before restoring.",
        );
      await checkpoint(root, c.path, c.project);
      if (c.exists) {
        await fs.mkdir(dirname(full), { recursive: true });
        await fs.copyFile(join(dataDir(), "checkpoints", c.id), full);
      } else
        await fs.unlink(full).catch((e) => {
          if (e.code !== "ENOENT") throw e;
        });
      return { restored: c.path };
    });
  },
  "git-status": async (args) => {
    const root = project(args.project).root;
    const result = await git(root, ["status", "--porcelain=v1", "-z"], {
      allowFail: true,
    });
    if (result.code)
      return { available: false, files: [], branch: "No Git repository" };
    const fields = result.stdout.split("\0").filter(Boolean),
      files = [];
    for (let i = 0; i < fields.length; i++) {
      const row = fields[i];
      files.push({ index: row[0], working: row[1], path: row.slice(3) });
      if (/[RC]/.test(row.slice(0, 2))) i++;
    }
    const branch = (
      await git(root, ["branch", "--show-current"], { allowFail: true })
    ).stdout.trim();
    return { available: true, branch: branch || "Detached HEAD", files };
  },
  "git-diff": async (args) => {
    const root = project(args.project).root;
    if (args.path) await safePath(root, args.path, { missing: true });
    const diff = await git(
      root,
      [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        ...(args.staged ? ["--cached"] : []),
        "--",
        ...(args.path ? [args.path] : []),
      ],
      { allowFail: true },
    );
    const history = await git(root, ["log", "-20", "--format=%h %s"], {
      allowFail: true,
    });
    return { diff: diff.stdout, history: history.stdout };
  },
  "git-init": async (args, ctx, { store }) => {
    requireHuman(ctx);
    const p = project(args.project);
    await git(p.root, ["init"]);
    p.git = true;
    p.gitRoot = (
      await git(p.root, ["rev-parse", "--show-toplevel"])
    ).stdout.trim();
    persist();
    putProject(store, p);
    return { initialized: true };
  },
  "git-stage": async (args, ctx) => {
    requireHuman(ctx);
    const root = trusted(args.project).root;
    await safePath(root, args.path, { missing: true });
    await git(
      root,
      args.unstage ? ["reset", "--", args.path] : ["add", "--", args.path],
    );
    return workspaceRunners["git-status"](args);
  },
  "git-commit": async (args, ctx) => {
    requireHuman(ctx);
    const pr = trusted(args.project),
      root = pr.root;
    const outside = await git(
      root,
      ["diff", "--cached", "--name-only", "--relative"],
      { allowFail: true },
    );
    if (outside.stdout.split("\n").some((p) => p.startsWith("../")))
      throw new Error(
        "Staged changes outside this project must be committed from their repository root.",
      );
    const r = await git(root, ["commit", "-m", args.message]);
    return { output: r.stdout };
  },
  "git-remote": async (args, ctx) => {
    requireHuman(ctx);
    const root = trusted(args.project).root,
      remote = args.remote || "origin";
    if (!/^[a-zA-Z0-9_.-]+$/.test(remote) || remote.startsWith("-"))
      throw new Error("Choose a named Git remote.");
    const result = await git(
      root,
      [args.action, ...(args.action === "pull" ? ["--ff-only"] : []), remote],
      { timeout: 120000 },
    );
    return { output: (result.stdout + result.stderr).slice(-5000) };
  },
  "config-save": async (args, ctx, { store }) => {
    requireHuman(ctx);
    const p = project(args.project);
    await safePath(p.root, args.cwd || "");
    if (
      args.envNames &&
      (!Array.isArray(args.envNames) ||
        args.envNames.length > 50 ||
        args.envNames.some(
          (n) => typeof n !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(n),
        ))
    )
      throw new Error(
        "Environment references must be up to 50 variable names, never values.",
      );
    if (
      args.artifactPaths &&
      (!Array.isArray(args.artifactPaths) || args.artifactPaths.length > 20)
    )
      throw new Error("Choose up to 20 relative artifact paths.");
    for (const path of args.artifactPaths || [])
      await safePath(p.root, path, { missing: true, secret: false });
    outputExclusions(args.artifactPaths || []);
    const c = {
      ...args,
      id: args.id || randomUUID(),
      cwd: args.cwd || "",
      envNames: args.envNames || [],
    };
    if (args.id && authority().configs[args.id]?.project !== args.project)
      throw new Error("Configuration belongs to a different project.");
    authority().configs[c.id] = c;
    persist();
    return store.put("configs", c);
  },
  "run-start": async (args, ctx, { store }) => {
    const c = authority().configs[args.config];
    if (!c) throw new Error("Configuration not found.");
    if (!args.work) requireHuman(ctx);
    const v = await scope({ project: c.project, work: args.work }, ctx, {
      execute: true,
    });
    if (v.project.id !== c.project)
      throw new Error("Configuration belongs to a different project.");
    const cwd = await safePath(v.root, c.cwd || "");
    const fingerprintExclusions = outputExclusions(
      c.artifactPaths ||
        ["dist", "build", "out", "coverage"].map((path) =>
          [c.cwd, path].filter(Boolean).join("/"),
        ),
    );
    const source = await snapshot(v.root, {
      excludePaths: fingerprintExclusions,
    });
    const id = randomUUID();
    const result = await runtimeCall("job-start", {
      id,
      command: c.command,
      cwd,
      envNames: c.envNames || [],
      timeout: c.kind === "develop" ? 0 : 600000,
    });
    return store.put("runs", {
      ...result,
      project: c.project,
      work: args.work || null,
      config: c.id,
      name: c.name,
      command: c.command,
      cwd: c.cwd,
      artifactPaths: c.artifactPaths,
      fingerprint: source.fingerprint,
      fingerprintExclusions,
      root: v.root,
    });
  },
  "run-inspect": async (args, _ctx, { store }) => {
    const run = store.get("runs", args.run);
    if (!run?.root) throw new Error("Run not found.");
    let result;
    try {
      result = await runtimeCall("job-state", { id: args.run });
    } catch {
      result = {
        status: run.status === "running" ? "interrupted" : run.status,
      };
    }
    const stale =
      (
        await snapshot(run.root, {
          excludePaths: run.fingerprintExclusions || [],
        })
      ).fingerprint !== run.fingerprint;
    const artifacts = await inspectArtifacts(
      run.root,
      run.artifactPaths ||
        ["dist", "build", "out", "coverage"].map((p) =>
          [run.cwd, p].filter(Boolean).join("/"),
        ),
      run.started,
    );
    return store.put("runs", {
      ...run,
      ...result,
      stale,
      artifacts: artifacts.files,
      artifactWarnings: artifacts.warnings,
      artifactsTruncated: artifacts.truncated,
    });
  },
  "run-stop": async (args, ctx, { store }) => {
    requireHuman(ctx);
    const run = store.get("runs", args.run);
    if (!run) throw new Error("Run not found.");
    const result = await runtimeCall("job-stop", { id: args.run });
    return store.put("runs", { ...run, ...result });
  },
  "project-terminal": async (args, ctx) => {
    requireHuman(ctx);
    const p = trusted(args.project);
    return runtimeCall("terminal-open", { cwd: p.root });
  },
  "tools-status": async () => {
    const tools = {};
    for (const [name, exe, args] of [
      ["node", process.execPath, ["--version"]],
      ["git", "git", ["--version"]],
      ["ripgrep", "rg", ["--version"]],
      ["python", authority().preferences.python || "python", ["--version"]],
      ["codex", "codex", ["--version"]],
    ]) {
      try {
        const r = await command(exe, args, { timeout: 4000 });
        tools[name] = {
          available: r.code === 0,
          version: (r.stdout || r.stderr).split("\n")[0].slice(0, 150),
        };
      } catch (e) {
        tools[name] = { available: false, message: e.message };
      }
    }
    return tools;
  },
  "preferences-save": (args, ctx) => {
    requireHuman(ctx);
    authority().preferences = { ...authority().preferences, ...args };
    persist();
    return authority().preferences;
  },
  "format-text": async (args, ctx) => {
    requireHuman(ctx);
    trusted(args.project);
    const ext = extname(args.path).toLowerCase();
    if (ext === ".py") {
      const python = authority().preferences.python || "python",
        r = await command(python, ["-m", "black", "--quiet", "-"], {
          timeout: 8000,
          input: args.text || "",
        });
      if (r.code)
        throw new Error(
          "Python formatting needs Black in the selected Python interpreter: python -m pip install black",
        );
      return { text: r.stdout };
    }
    const prettier = await import("prettier");
    return {
      text: await prettier.format(args.text || "", { filepath: args.path }),
    };
  },
};

workspaceOperations.push(
  op(
    "run-artifact",
    "execution",
    "runs",
    "Read a recorded generated artifact without executing it.",
    { run: ref("runs"), path },
    { readOnly: true, idempotent: true },
  ),
);
workspaceRunners["run-artifact"] = async (args, ctx, { store }) => {
  requireHuman(ctx);
  const r = store.get("runs", args.run);
  if (!r?.artifacts?.some((a) => a.path === args.path))
    throw new Error(
      "Inspect the run and choose one of its recorded artifacts.",
    );
  return readDocument(r.root, args.path, { secret: false });
};
for (const name of ["file-write", "run-start"]) {
  const run = workspaceRunners[name];
  workspaceRunners[name] = (args, ctx, deps) =>
    args.work
      ? locked("work:" + args.work, () => run(args, ctx, deps))
      : run(args, ctx, deps);
}
