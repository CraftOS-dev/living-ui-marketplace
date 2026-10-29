import { craftbotUrl, craftbotAgent, stopCraftbotSession } from "./craftbot-connection.mjs";
import * as fs from "node:fs/promises";
import { join, dirname, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { ROOT, manifest, dataDir, requireHuman } from "./config.mjs";
import {
  authority,
  persist,
  project,
  trusted,
  snapshot,
  git,
  safePath,
  readDocument,
  writeDocument,
  digest,
  checkpoint,
  locked,
  lockedPaths,
  sensitive,
  replaceBytes,
} from "./filesystem.mjs";
import { runtimeCall } from "./runtime.mjs";
import { taskReceipt, frameworkRequest } from "./task-state.mjs";
import { reviewHandoff } from "./review-handoff.mjs";
import { bridgeRecord, connectionState } from "./connector-state.mjs";
import { agentConfiguration, connectionInstructions } from "./agent-connection.mjs";
import { installedAgents, inspectAgent, loginLaunch, preset } from "./installed-agents.mjs";
const s = (max = 1000, required = true) => ({ type: "string", required, max }),
  ref = (entity, required = true) => ({ type: "ref", entity, required });
const op = (name, entity, description, params, extra = {}) => ({
  name,
  module: "agents",
  entity,
  description,
  params,
  destructive: false,
  ...extra,
});
export const workOperations = [
  op(
    "work-create",
    "work",
    "Draft development work with acceptance criteria and context.",
    {
      project: ref("projects"),
      title: s(160),
      goal: s(8000),
      criteria: s(4000),
      context: s(4000, false),
      mode: {
        type: "enum",
        values: ["standalone", "craftbot"],
        required: true,
      },
      effort: { type: "enum", values: ["medium", "high"], required: false },
    },
  ),
  op(
    "work-start",
    "work",
    "Prepare isolated source and queue a new real agent attempt.",
    { work: ref("work") },
  ),
  op(
    "work-context",
    "work",
    "Read the active isolated scope, goal, instructions and saved commands.",
    { work: ref("work") },
    { readOnly: true, idempotent: true },
  ),
  op(
    "work-progress",
    "work",
    "Record an agent's plan or observable progress.",
    { work: ref("work"), message: s(2000) },
  ),
  op("work-question", "work", "Park the attempt for a user answer.", {
    work: ref("work"),
    question: s(2000),
  }),
  op(
    "work-answer",
    "work",
    "Answer and resume the isolated work with a new task delivery.",
    { work: ref("work"), answer: s(4000) },
  ),
  op(
    "work-finish",
    "work",
    "Freeze changes, complete the delivery and publish human review.",
    { work: ref("work"), summary: s(4000) },
  ),
  op(
    "work-sync",
    "work",
    "Reconcile agent delivery with durable work state.",
    { work: ref("work") },
    { idempotent: true },
  ),
  op(
    "work-cancel",
    "work",
    "Revoke managed writes and request connector/process termination.",
    { work: ref("work") },
  ),
  op(
    "connector-control",
    "connections",
    "Start, stop or inspect the selected local agent launcher.",
    {
      action: {
        type: "enum",
        values: ["connect", "disconnect", "status"],
        required: true,
      },
    },
  ),
  op("connector-configure", "connections", "Choose direct A2App or an optional local agent launcher.", {
    provider: { type: "enum", values: ["external", "codex", "claude", "gemini", "custom", "craftbot"], required: true },
    command: s(1000, false), args: { type: "json" },
    input: { type: "enum", values: ["stdin", "arg"] },
  }),
  op("agent-connection-info", "connections", "Read credential-free local connection instructions.", {}, { readOnly: true, idempotent: true }),
  op("agent-catalog", "connections", "Detect installed agents and check account readiness without starting tasks.", {}, { readOnly: true, idempotent: true }),
  op("agent-connect", "connections", "Choose an installed agent and connect it in one step.", {
    provider: { type: "enum", values: ["codex", "claude", "gemini", "craftbot"], required: true },
  }),
  op("agent-sign-in", "connections", "Open the selected agent's own sign-in program in an interactive session.", {
    provider: { type: "enum", values: ["codex", "claude", "gemini"], required: true },
  }),
  op("work-release", "attempts", "A direct agent releases its stopped delivery after a handoff.", {
    work: ref("work"), task: s(100),
  }, { idempotent: true }),
  op(
    "craftbot-configure",
    "connections",
    "Set the local CraftBot host URL for status and cancellation confirmation.",
    { url: s(500) },
  ),
  {
    name: "review-changes",
    module: "changes",
    entity: "reviews",
    description: "Compare isolated files with the recorded baseline.",
    params: { work: ref("work"), path: s(1000, false) },
    readOnly: true,
    idempotent: true,
    destructive: false,
  },
  {
    name: "review-apply",
    module: "changes",
    entity: "reviews",
    description: "Apply selected unchanged files with recoverable checkpoints.",
    params: { work: ref("work"), paths: { type: "json", required: true } },
    destructive: false,
  },
  {
    name: "review-resolve",
    module: "changes",
    entity: "reviews",
    description:
      "Resolve one conflicting file with explicitly chosen merged text.",
    params: {
      work: ref("work"),
      path: s(1000),
      text: s(2097152, false),
      useAgent: { type: "boolean" },
      expected: s(64, false),
      keepMine: { type: "boolean" },
    },
    destructive: false,
  },
  {
    name: "review-reject",
    module: "changes",
    entity: "reviews",
    description:
      "Reject an agent change set while retaining its isolated source.",
    params: { work: ref("work") },
    destructive: false,
  },
];
workOperations.push(
  op(
    "work-revise",
    "work",
    "Request a revision in the retained isolated source.",
    { work: ref("work"), instruction: s(4000) },
  ),
);
const availability = {
  "work-start": ["draft", "failed", "canceled", "ready", "applied", "rejected"],
  "work-progress": ["queued", "running"],
  "work-question": ["queued", "running"],
  "work-answer": ["needs-input"],
  "work-finish": ["queued", "running"],
  "work-cancel": [
    "queued",
    "running",
    "needs-input",
    "finalizing",
    "canceling",
  ],
  "review-apply": ["ready"],
  "review-resolve": ["ready"],
  "review-reject": ["ready"],
  "work-revise": ["ready"],
};
for (const operation of workOperations)
  if (availability[operation.name])
    operation.appliesWhen = {
      field: "status",
      in: availability[operation.name],
    };
const publicWork = (w) =>
  Object.fromEntries(
    [
      "id",
      "project",
      "title",
      "goal",
      "criteria",
      "context",
      "mode",
      "delivery",
      "effort",
      "status",
      "created",
      "started",
      "submitted",
      "finished",
      "handoffError",
      "task",
      "attempt",
      "summary",
      "question",
      "answers",
      "progress",
      "stopConfirmed",
      "applied",
      "revisions",
    ]
      .filter((k) => w[k] !== undefined)
      .map((k) => [k, w[k]]),
  );
function save(store, w) {
  persist();
  store.put("work", publicWork(w));
  if (store.get("reviews", w.id))
    store.put("reviews", { ...store.get("reviews", w.id), status: w.status });
  if (w.attempt)
    store.put("attempts", {
      id: w.attempt,
      work: w.id,
      task: w.task,
      status: w.status,
      summary: w.summary || "",
      started: w.started,
    });
  return publicWork(w);
}
async function active(id, ctx) {
  const w = authority().work[id];
  if (!w) throw new Error("Work item not found.");
  if (ctx.credentialId === "ui")
    throw new Error("A connected agent must report the work result.");
  if (!["queued", "running"].includes(w.status))
    throw new Error("This attempt is no longer accepting agent writes.");
  const task = await taskReceipt(w.task);
  if (task.status !== "working")
    throw new Error("The framework task is not actively claimed.");
  w.status = "running";
  return w;
}
async function changed(w) {
  const current = await snapshot(w.root),
    paths = new Set([
      ...Object.keys(w.baseline),
      ...Object.keys(current.files),
    ]);
  return [...paths]
    .filter((p) => w.baseline[p]?.digest !== current.files[p]?.digest)
    .sort()
    .map((path) => ({
      path,
      before: w.baseline[path] || null,
      after: current.files[path] || null,
      status: !w.baseline[path]
        ? "added"
        : !current.files[path]
          ? "deleted"
          : "modified",
      applied: (w.applied || []).includes(path),
    }));
}
async function scrubInherited(root) {
  // Only this newly created, owned worktree is traversed. Never follow links.
  async function walk(dir) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (e.name.toLowerCase() === ".git") continue;
      const full = join(dir, e.name);
      if (e.isSymbolicLink())
        throw new Error("Tracked symlinks are excluded from isolated work.");
      if (e.isDirectory()) {
        await walk(full);
        if (sensitive(e.name)) await fs.rmdir(full);
      } else if (sensitive(e.name) || dir.split(/[\\/]/).some(sensitive))
        await fs.unlink(full);
    }
  }
  await walk(root);
}
const capability = (w) => "studio-development-" + (["external", "craftbot-chat"].includes(w.delivery) ? w.delivery : w.mode);
const selectedDelivery = (w) => w.mode === "craftbot" ? "craftbot" : authority().preferences.agentCommand?.provider === "craftbot" ? "craftbot-chat" : (authority().preferences.agentCommand?.provider || "codex");
const publishReview = (w) =>
  reviewHandoff(w, {
    readTask: taskReceipt,
    completeTask: (id, body) =>
      frameworkRequest(`/api/_a2app/tasks/${id}/complete`, body),
  });
async function noJobs(w, store) {
  for (const r of store.list("runs").filter((r) => r.work === w.id)) {
    const j = await runtimeCall("job-state", { id: r.id });
    if (["running", "stopping"].includes(j.status))
      throw new Error(
        "Finish or stop the isolated command before applying changes.",
      );
  }
}
async function settled(w) {
  if (w.task) {
    const task = await taskReceipt(w.task);
    if (!["completed", "failed", "canceled", "pruned"].includes(task.status))
      throw new Error(
        "Wait for the agent delivery to finish before accepting changes or starting another writer.",
      );
  }
}
async function prepare(w) {
  const p = trusted(w.project),
    base = await snapshot(p.root),
    attempt = randomUUID(),
    dir = join(dataDir(), "work", w.id, attempt),
    copy = join(dir, "source"),
    baseline = join(dir, "baseline");
  await fs.mkdir(dir, { recursive: true });
  let worktree = false;
  if (
    p.git &&
    p.gitRoot &&
    resolve(p.gitRoot).toLowerCase() === resolve(p.root).toLowerCase()
  ) {
    const head = await git(p.root, ["rev-parse", "--verify", "HEAD"], {
      allowFail: true,
    });
    if (head.code === 0) {
      await git(p.root, ["worktree", "add", "--detach", copy, "HEAD"]);
      worktree = true;
    }
  }
  if (!worktree) await fs.mkdir(copy, { recursive: true });
  await fs.mkdir(baseline, { recursive: true });
  if (worktree) {
    await scrubInherited(copy);
    const inherited = await snapshot(copy);
    for (const path of Object.keys(inherited.files))
      if (!base.files[path]) await fs.unlink(await safePath(copy, path));
  }
  for (const path of Object.keys(base.files)) {
    const source = await safePath(p.root, path, { secret: false });
    for (const destRoot of [copy, baseline]) {
      const dest = await safePath(destRoot, path, {
        missing: true,
        secret: false,
      });
      await fs.mkdir(dirname(dest), { recursive: true });
      await fs.copyFile(source, dest);
    }
  }
  return {
    root: copy,
    baselineRoot: baseline,
    baseline: base.files,
    baseFingerprint: base.fingerprint,
    attempt,
    worktree,
  };
}
async function craftBusy() {
  try {
    const url = authority().preferences.craftbotUrl;
    if (!url) return null;
    const state = await fetch(url + "/api/state", {
      signal: AbortSignal.timeout(2500),
    }).then((r) => r.json());
    return state.busySessions?.includes("agentapp_" + manifest.id) ?? null;
  } catch {
    return null;
  }
}
async function stopConfirmed(w) {
  for (const id of w.pendingRuns || []) {
    try {
      const r = await runtimeCall("job-state", { id });
      if (
        ["running", "stopping"].includes(r.status) ||
        (r.status === "interrupted" && !r.stopConfirmed)
      )
        return false;
    } catch {
      return false;
    }
  }
  if (w.task && !(await taskReceipt(w.task)).claim) return true;
  if (w.delivery === "external") return w.releasedTask === w.task;
  if (w.mode === "craftbot") return (await craftBusy()) === false;
  try {
    const file = join(dataDir(), "agent-processes", w.task + ".json"),
      v = JSON.parse(await fs.readFile(file, "utf8"));
    if (w.delivery === "craftbot-chat") {
      if (v.stopConfirmed) return true;
      // Persisted exact session ownership permits recovery after a worker exit.
      if (!v.session) return !!v.finished && !v.dispatched;
      await stopCraftbotSession(v);
      v.stopConfirmed = true; v.finished = new Date().toISOString();
      await fs.writeFile(file, JSON.stringify(v));
      return true;
    }
    if (v.finished) return true;
    try {
      process.kill(v.pid, 0);
      return false;
    } catch {
      return true;
    }
  } catch {
    return false;
  }
}
const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
export const workRunners = {
  "work-create": (args, ctx, { store }) => {
    requireHuman(ctx);
    project(args.project);
    const w = {
      ...args,
      id: randomUUID(),
      status: "draft",
      created: new Date().toISOString(),
      answers: [],
      applied: [],
    };
    authority().work[w.id] = w;
    return save(store, w);
  },
  "work-start": async (args, ctx, { store, trigger }) => {
    requireHuman(ctx);
    const w = authority().work[args.work];
    if (!w) throw new Error("Work item not found.");
    if (
      ["queued", "running", "needs-input", "finalizing", "canceling"].includes(
        w.status,
      )
    )
      throw new Error("This work already has an active attempt.");
    if (
      Object.values(authority().work).some(
        (v) =>
          v.id !== w.id &&
          v.project === w.project &&
          [
            "queued",
            "running",
            "needs-input",
            "finalizing",
            "canceling",
          ].includes(v.status),
      )
    )
      throw new Error(
        "Finish or cancel the active agent writer for this project first.",
      );
    for (const prior of Object.values(authority().work).filter(
      (v) => v.project === w.project && v.task,
    )) {
      await settled(prior);
      if (!(await stopConfirmed(prior)))
        throw new Error(
          "The previous agent process is still finishing. Try again after it stops.",
        );
    }
    Object.assign(w, await prepare(w), {
      delivery: selectedDelivery(w),
      status: "queued",
      started: new Date().toISOString(),
      summary: "",
      progress: [],
      applied: [],
      question: null,
      submitted: null,
      finished: null,
      handoffError: null,
    });
    w.task = trigger(
      "studio.development-requested",
      { work: w.id, attempt: w.attempt, delivery: randomUUID() },
      capability(w),
    ).taskId;
    return save(store, w);
  },
  "work-context": async (args, ctx, { store }) => {
    const w = authority().work[args.work];
    if (!w) throw new Error("Work item not found.");
    if (
      ctx.credentialId !== "ui" &&
      w.task &&
      (await taskReceipt(w.task)).status === "working" &&
      w.status === "queued"
    ) {
      w.status = "running";
      save(store, w);
    }
    let instructions = "";
    for (const file of ["AGENTS.md", "CLAUDE.md"]) {
      try {
        instructions +=
          `\n${file}:\n` +
          (await fs.readFile(await safePath(w.root, file), "utf8")).slice(
            0,
            6000,
          );
      } catch {}
    }
    return {
      ...publicWork(w),
      isolatedRoot: w.root,
      baselineFingerprint: w.baseFingerprint,
      instructions,
      configs: Object.values(authority().configs).filter(
        (c) => c.project === w.project,
      ),
      protocol:
        "Use project-tree and file-read with work=<id>. Use file-write(work,path,text,expected[,create]) for edits. run-start(config,work) executes a saved command in this isolated copy; run-inspect gives actual output. Never edit the main project or the app source. work-progress records your plan. work-question parks for an answer; stop that run after asking. work-finish freezes managed writes, completes the framework delivery and publishes review in one step; stop immediately after it succeeds, without a second tasks-complete call. Direct A2App agents must then stop their tools and call work-release(work,task) for this delivery. Use work-context again to read user answers. Credential files are excluded.",
    };
  },
  "work-progress": async (args, ctx, { store }) => {
    const w = await active(args.work, ctx);
    w.progress = [
      ...(w.progress || []),
      { at: new Date().toISOString(), message: args.message },
    ].slice(-50);
    return save(store, w);
  },
  "work-question": async (args, ctx, { store }) => {
    const w = await active(args.work, ctx);
    w.question = args.question;
    w.status = "needs-input";
    await frameworkRequest(`/api/_a2app/tasks/${w.task}/progress`, {
      step: "Waiting for the user's answer",
      ask: { question: args.question },
    });
    return save(store, w);
  },
  "work-answer": async (args, ctx, { store, trigger }) => {
    requireHuman(ctx);
    const w = authority().work[args.work];
    if (w?.status !== "needs-input")
      throw new Error("This work item is not waiting for input.");
    if (!(await stopConfirmed(w)))
      throw new Error(
        "The previous agent run is still finishing. Retry the answer when it stops.",
      );
    w.answers = [
      ...(w.answers || []),
      {
        question: w.question,
        answer: args.answer,
        at: new Date().toISOString(),
      },
    ];
    const old = await taskReceipt(w.task);
    if (["working", "input-required"].includes(old.status))
      await frameworkRequest(`/api/_a2app/tasks/${w.task}/complete`, {
        status: "failed",
        reason: "resumed_with_answer",
      });
    w.question = null;
    w.status = "queued";
    w.task = trigger(
      "studio.development-requested",
      { work: w.id, attempt: w.attempt, delivery: randomUUID() },
      capability(w),
    ).taskId;
    return save(store, w);
  },
  "work-finish": async (args, ctx, { store }) => {
    const w = await active(args.work, ctx);
    for (const r of store.list("runs").filter((r) => r.work === w.id)) {
      const state = await runtimeCall("job-state", { id: r.id });
      if (state.status === "running" || state.status === "stopping")
        throw new Error(
          "Stop or finish the isolated command before submitting review.",
        );
    }
    w.changes = await changed(w);
    w.status = "finalizing";
    w.submitted = new Date().toISOString();
    w.summary = args.summary;
    store.put("reviews", {
      id: w.id,
      work: w.id,
      project: w.project,
      status: "finalizing",
      files: w.changes.length,
    });
    save(store, w);
    await publishReview(w);
    return save(store, w);
  },
  "work-sync": async (args, _ctx, { store }) => {
    const w = authority().work[args.work];
    if (!w) throw new Error("Work item not found.");
    if (w.task) {
      if (w.status === "finalizing") await publishReview(w);
      const task = await taskReceipt(w.task);
      if (task.status === "working" && w.status === "queued")
        w.status = "running";
      if (
        ["failed", "canceled", "pruned", "completed"].includes(task.status) &&
        ["queued", "running"].includes(w.status)
      ) {
        w.status = task.status === "canceled" ? "canceled" : "failed";
        w.summary =
          task.status === "completed"
            ? "The harness ended without submitting a reviewable result."
            : "Agent delivery ended: " + (task.reason || task.status);
        if (task.status === "failed" && w.mode === "standalone") {
          const receipt = await fs
            .readFile(
              join(dataDir(), "agent-processes", w.task + ".json"),
              "utf8",
            )
            .then(JSON.parse)
            .catch(() => null);
          if (
            receipt?.error &&
            /^(Codex |Installed Codex CLI|Agent |Configured agent)/.test(receipt.error)
          )
            w.summary += " " + receipt.error.slice(0, 300);
        }
      }
      if (w.status === "canceling") {
        w.stopConfirmed = await stopConfirmed(w);
        if (w.stopConfirmed) w.status = "canceled";
      }
    }
    return {
      ...save(store, w),
      task: w.task ? await taskReceipt(w.task) : null,
    };
  },
  "work-cancel": async (args, ctx, { store }) => {
    requireHuman(ctx);
    const w = authority().work[args.work];
    if (!w) throw new Error("Work item not found.");
    w.status = "canceling";
    w.stopConfirmed = false;
    save(store, w);
    w.pendingRuns = store
      .list("runs")
      .filter((r) => r.work === w.id)
      .map((r) => r.id);
    for (const id of w.pendingRuns) {
      try {
        await runtimeCall("job-stop", { id });
      } catch (e) {
        w.summary = "Stop remains unconfirmed: " + e.message;
      }
    }
    if (w.task) {
      const task = await taskReceipt(w.task);
      if (["submitted", "working", "input-required"].includes(task.status))
        await frameworkRequest(`/api/_a2app/tasks/${w.task}/cancel`, {});
    }
    w.stopConfirmed = await stopConfirmed(w);
    if (w.stopConfirmed) w.status = "canceled";
    return save(store, w);
  },
  "work-release": async (args, ctx, { store }) => {
    if (ctx.credentialId === "ui") throw Error("The connected agent must release its own delivery.");
    const w = authority().work[args.work];
    if (!w || w.delivery !== "external" || w.task !== args.task)
      throw Error("This is not the current direct-agent delivery.");
    const task = await taskReceipt(w.task);
    if (!["input-required", "completed", "failed", "canceled", "pruned"].includes(task.status))
      throw Error("Submit, ask a question, fail or cancel the delivery before releasing it.");
    await noJobs(w, store);
    w.releasedTask = w.task;
    if (w.status === "canceling") { w.stopConfirmed = true; w.status = "canceled"; }
    return save(store, w);
  },
  "agent-connection-info": (_args, ctx) => {
    requireHuman(ctx);
    return connectionInstructions();
  },
  "agent-catalog": async (_args, ctx) => {
    requireHuman(ctx);
    const [installed, craftbot] = await Promise.all([installedAgents(), craftbotAgent(authority().preferences.craftbotUrl)]);
    return { agents: [...installed, craftbot] };
  },
  "agent-sign-in": async (args, ctx) => {
    requireHuman(ctx);
    return runtimeCall("terminal-open", { cwd: ROOT, ...await loginLaunch(args.provider) });
  },
  "agent-connect": async (args, ctx, deps) => {
    requireHuman(ctx);
    const agent = args.provider === "craftbot" ? await craftbotAgent(authority().preferences.craftbotUrl) : await inspectAgent(args.provider);
    if (agent.service && !agent.available) throw Error("Start CraftBot and finish its setup, then check its backend address here.");
    if (!agent.installed) throw Error(`${agent.name} is not installed. Open its installation guide, then check again.`);
    if (agent.authentication === "required") throw Error(`Sign in to ${agent.name} first, then connect.`);
    if (authority().preferences.agentCommand?.provider !== args.provider)
      await workRunners["connector-configure"]({ provider: args.provider }, ctx, deps);
    return workRunners["connector-control"]({ action: "connect" }, ctx, deps);
  },
  "connector-configure": async (args, ctx) => {
    requireHuman(ctx);
    const a = authority();
    if (a.preferences.bridgeJob) {
      const current = await connectionState(a.preferences.bridgeJob, runtimeCall, a.preferences.bridgeHarness || "studio-codex", a.preferences.craftbotUrl);
      if (current.connected || current.connecting || current.bridgeActive) throw Error("Disconnect the current launcher before changing agents.");
    }
    if (Object.values(a.work).some(w => w.mode === "standalone" && ["queued", "running", "needs-input", "finalizing", "canceling"].includes(w.status)))
      throw Error("Finish or cancel current standalone work before changing agents.");
    for (const w of Object.values(a.work).filter(w => w.mode === "standalone" && w.task))
      if (!(await stopConfirmed(w))) throw Error("Wait for the previous agent to stop or release its delivery before changing agents.");
    a.preferences.agentCommand = agentConfiguration(args);
    persist();
    return a.preferences.agentCommand;
  },
  "connector-control": async (args, ctx) => {
    requireHuman(ctx);
    const a = authority(),
      id = a.preferences.bridgeJob;
    if (args.action === "disconnect") {
      if (Object.values(a.work).some(w => ["queued", "running", "needs-input", "finalizing", "canceling"].includes(w.status) && w.delivery === "craftbot-chat"))
        throw Error("Finish or cancel the active CraftBot task before disconnecting.");
      for (const w of Object.values(a.work).filter(w => w.delivery === "craftbot-chat" && w.task))
        if (!(await stopConfirmed(w))) throw Error("Wait for CraftBot to confirm this task has stopped before disconnecting.");
      if (id) await runtimeCall("job-stop", { id });
      a.preferences.bridgeJob = null;
      persist();
      return { connected: false, external: a.preferences.agentCommand?.provider === "external" };
    }
    if (a.preferences.agentCommand?.provider === "external")
      return { connected: false, external: true, message: "Direct A2App · waiting for your agent to claim a task. Studio does not start or stop your external agent process." };
    const harness = a.preferences.bridgeHarness || "studio-codex";
    if (id) {
      const status = await connectionState(id, runtimeCall, harness, a.preferences.craftbotUrl);
      if (status.connected || status.connecting || status.bridgeActive || args.action === "status")
        return status;
    }
    if (args.action === "status")
      return {
        connected: false,
        ...((await bridgeRecord())
          ? {
              message:
                "Another Studio instance already has the standalone connection. Connect from that installation, or disconnect it before using this one.",
            }
          : {}),
      };
    if (await bridgeRecord())
      return {
        connected: false,
        message:
          "Another Studio instance already has the standalone connection. Connect from that installation, or disconnect it before using this one.",
      };
    const home = join(dataDir(), "bridge-home");
    await fs.mkdir(home, { recursive: true });
    const configuration = agentConfiguration(a.preferences.agentCommand);
    if (configuration.provider === "craftbot") {
      const agent = await craftbotAgent(a.preferences.craftbotUrl);
      if (!agent.available) throw Error("Start CraftBot and finish its setup before connecting.");
      configuration.url = agent.address;
    }
    const selectedHarness = "studio-" + configuration.provider;
    const configPath = join(home, "agent-command.json");
    await fs.writeFile(configPath, JSON.stringify(configuration), { mode: 0o600 });
    await fs.writeFile(
      join(home, "harnesses.json"),
      JSON.stringify({
        version: 1,
        default: selectedHarness,
        harnesses: [
          {
            id: selectedHarness,
            name: configuration.provider === "craftbot" ? "CraftBot" : configuration.provider === "custom" ? "Configured agent" : preset(configuration.provider).name,
            routes: [
              {
                mode: "headless",
                command: process.execPath,
                args: [join(ROOT, configuration.provider === "craftbot" ? "scripts/craftbot-agent.mjs" : "scripts/development-agent.mjs"), dataDir(), configPath],
                input: "stdin",
                cwd: "app",
                timeoutMs: 900000,
              },
            ],
          },
        ],
      }),
    );
    const listening = configuration.provider === "craftbot" ? "--capability studio-development-craftbot-chat" : "--capability studio-development-standalone --capability studio-standalone-proof";
    const command =
      process.platform === "win32"
        ? `$env:A2APP_HOME=${quote(home)}; & ${quote(process.execPath)} ${quote(join(ROOT, "node_modules/agent-app-framework/dist/agent-app.js"))} ${quote(ROOT)} bridge start --foreground --harness ${selectedHarness} ${listening}`
        : `A2APP_HOME=${quote(home)} ${quote(process.execPath)} ${quote(join(ROOT, "node_modules/agent-app-framework/dist/agent-app.js"))} ${quote(ROOT)} bridge start --foreground --harness ${selectedHarness} ${listening}`;
    const job = randomUUID();
    await runtimeCall("job-start", {
      id: job,
      command,
      cwd: ROOT,
      timeout: 0,
    });
    a.preferences.bridgeJob = job;
    a.preferences.bridgeHarness = selectedHarness;
    persist();
    // A spawned shell is not a connected harness. Wait for the bridge's own
    // live readiness record; subsequent status polling handles slow startup.
    const deadline = Date.now() + 8000;
    let status;
    do {
      await new Promise((resolve) => setTimeout(resolve, 150));
      status = await connectionState(job, runtimeCall, selectedHarness, a.preferences.craftbotUrl);
      if (!status.connecting) return status;
    } while (Date.now() < deadline);
    return status;
  },
  "craftbot-configure": async (args, ctx) => {
    requireHuman(ctx);
    const a = authority();
    if (a.preferences.agentCommand?.provider === "craftbot" && (await bridgeRecord()))
      throw Error("Disconnect CraftBot before changing its address.");
    if (Object.values(a.work).some(w => w.delivery === "craftbot-chat" && ["queued", "running", "needs-input", "finalizing", "canceling"].includes(w.status)))
      throw Error("Finish or cancel CraftBot work before changing its address.");
    a.preferences.craftbotUrl = craftbotUrl(args.url);
    persist();
    return { url: a.preferences.craftbotUrl };
  },
  "review-changes": async (args, _ctx, { store }) => {
    const w = authority().work[args.work];
    if (!w?.root) throw new Error("Start an agent attempt first.");
    const files = await changed(w);
    let comparison = null;
    if (args.path) {
      if (!files.some((f) => f.path === args.path))
        throw new Error("Choose a changed file.");
      const before = await readDocument(w.baselineRoot, args.path).catch(
          () => ({ text: "", digest: null }),
        ),
        after = await readDocument(w.root, args.path).catch(() => ({
          text: "",
          digest: null,
        })),
        destination = await readDocument(
          project(w.project).root,
          args.path,
        ).catch(() => ({ text: "", digest: null }));
      comparison = {
        path: args.path,
        before,
        after,
        destination,
        conflict:
          destination.digest !== (w.baseline[args.path]?.digest || null),
      };
    }
    const checks = [],
      fingerprints = new Map();
    for (const r of store
      .list("runs")
      .filter((r) => r.work === w.id)
      .slice(-50)) {
      const exclusions = r.fingerprintExclusions || [],
        key = JSON.stringify(exclusions);
      if (!fingerprints.has(key))
        fingerprints.set(
          key,
          (await snapshot(w.root, { excludePaths: exclusions })).fingerprint,
        );
      const fingerprint = fingerprints.get(key);
      const current = await runtimeCall("job-state", { id: r.id }).catch(
          () => ({ status: "interrupted" }),
        ),
        updated = { ...r, ...current, stale: r.fingerprint !== fingerprint };
      store.put("runs", updated);
      checks.push({
        id: r.id,
        name: r.name,
        status: updated.status,
        stale: updated.stale,
        exitCode: updated.exitCode,
      });
    }
    return {
      files,
      comparison,
      baseline: w.baseFingerprint,
      work: publicWork(w),
      checks,
    };
  },
  "review-apply": async (args, ctx, { store }) => {
    requireHuman(ctx);
    const w = authority().work[args.work];
    if (w?.status !== "ready")
      throw new Error("This attempt is not ready for review.");
    await settled(w);
    await noJobs(w, store);
    if (
      !Array.isArray(args.paths) ||
      !args.paths.length ||
      args.paths.length > 500
    )
      throw new Error("Select 1–500 changed files.");
    return lockedPaths(project(w.project).root, args.paths, async () => {
      const files = await changed(w),
        root = project(w.project).root,
        conflicts = [];
      for (const path of args.paths) {
        if (!files.some((f) => f.path === path && !f.applied))
          throw new Error("That file is not an unapplied change.");
        const full = await safePath(root, path, {
            missing: true,
            secret: false,
          }),
          bytes = await fs.readFile(full).catch((e) => {
            if (e.code === "ENOENT") return null;
            throw e;
          });
        if (
          (bytes ? digest(bytes) : null) !== (w.baseline[path]?.digest || null)
        )
          conflicts.push(path);
      }
      if (conflicts.length) return { applied: [], conflicts };
      const applied = [];
      for (const path of args.paths) {
        const from = await safePath(w.root, path, {
            missing: true,
            secret: false,
          }),
          bytes = await fs.readFile(from).catch((e) => {
            if (e.code === "ENOENT") return null;
            throw e;
          });
        await replaceBytes(
          root,
          path,
          bytes,
          w.baseline[path]?.digest || null,
          w.project,
          { alreadyLocked: true },
        );
        applied.push(path);
        w.applied = [...new Set([...(w.applied || []), path])];
        save(store, w);
      }
      if ((await changed(w)).every((f) => (w.applied || []).includes(f.path)))
        w.status = "applied";
      save(store, w);
      return { applied, conflicts: [] };
    });
  },
  "review-resolve": async (args, ctx, { store }) => {
    requireHuman(ctx);
    const w = authority().work[args.work];
    if (w?.status !== "ready")
      throw new Error("This attempt is not ready for review.");
    await settled(w);
    await noJobs(w, store);
    if (!(await changed(w)).some((f) => f.path === args.path))
      throw new Error("Select a changed file.");
    if (!args.keepMine) {
      if (args.useAgent) {
        const from = await safePath(w.root, args.path, {
            missing: true,
            secret: false,
          }),
          bytes = await fs.readFile(from).catch((e) => {
            if (e.code === "ENOENT") return null;
            throw e;
          });
        await replaceBytes(
          project(w.project).root,
          args.path,
          bytes,
          args.expected ?? null,
          w.project,
        );
      } else {
        const source = await readDocument(w.root, args.path).catch(() => null),
          dest = await readDocument(project(w.project).root, args.path).catch(
            () => null,
          );
        if (source?.binary || source?.large || dest?.binary || dest?.large)
          throw new Error(
            "Use the explicit agent-file or project-file choice for binary and size-limited conflicts.",
          );
        await writeDocument(
          project(w.project).root,
          args.path,
          args.text ?? "",
          args.expected ?? null,
          { projectId: w.project },
        );
      }
    }
    w.applied = [...new Set([...(w.applied || []), args.path])];
    if ((await changed(w)).every((f) => w.applied.includes(f.path)))
      w.status = "applied";
    return save(store, w);
  },
  "review-reject": async (args, ctx, { store }) => {
    requireHuman(ctx);
    const w = authority().work[args.work];
    if (w?.status !== "ready")
      throw new Error("This attempt is not ready for review.");
    w.status = "rejected";
    return save(store, w);
  },
};
workRunners["work-revise"] = async (args, ctx, { store, trigger }) => {
  requireHuman(ctx);
  const w = authority().work[args.work];
  if (w?.status !== "ready")
    throw new Error("Only a ready change set can be revised.");
  if (w.applied?.length)
    throw new Error(
      "Some files were already accepted. Start a new work item from the current project for further changes.",
    );
  await settled(w);
  await noJobs(w, store);
  if (!(await stopConfirmed(w)))
    throw new Error("The previous agent run is still finishing.");
  if (
    Object.values(authority().work).some(
      (v) =>
        v.id !== w.id &&
        v.project === w.project &&
        [
          "queued",
          "running",
          "needs-input",
          "finalizing",
          "canceling",
        ].includes(v.status),
    )
  )
    throw new Error(
      "Finish the current project writer before requesting this revision.",
    );
  store.put("attempts", {
    id: w.attempt,
    work: w.id,
    task: w.task,
    status: "revision-requested",
    summary: w.summary,
    started: w.started,
  });
  w.revisions = [
    ...(w.revisions || []),
    { instruction: args.instruction, at: new Date().toISOString() },
  ];
  w.attempt = randomUUID();
  w.status = "queued";
  w.summary = "";
  w.started = new Date().toISOString();
  w.submitted = null;
  w.finished = null;
  w.handoffError = null;
  w.delivery = selectedDelivery(w);
  w.task = trigger(
    "studio.development-requested",
    { work: w.id, attempt: w.attempt, delivery: randomUUID() },
    capability(w),
  ).taskId;
  return save(store, w);
};
// All managed writes, task transitions and cancellation share the same lease.
for (const [name, run] of Object.entries(workRunners)) {
  workRunners[name] = (args, ctx, deps) => {
    const invoke = () =>
      args.work
        ? locked("work:" + args.work, () => run(args, ctx, deps))
        : run(args, ctx, deps);
    return ["work-start", "work-revise"].includes(name)
      ? locked(
          "writer:" + (authority().work[args.work]?.project || args.work),
          invoke,
        )
      : invoke();
  };
}
