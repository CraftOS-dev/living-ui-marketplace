import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { isAbsolute } from "node:path";
import { stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ROOT, framework, requireHuman } from "./config.mjs";
import { runtimeCall, runtimeInfo, stopRuntime } from "./runtime.mjs";
import {syncRequests,watchRequests,taskReceipt} from "./task-state.mjs";
const exec = promisify(execFile);
export const operations = [
 {name:"terminal-reconnect",module:"execution",description:"Resume an owned terminal within sixty seconds of a lost browser connection.",params:{id:{type:"string",required:true,max:80}}},
  { name: "studio-status", module: "settings", description: "Runtime identity, stored proof and honest milestone status.", readOnly: true, idempotent: true, params: {} },
  { name: "run-local-proof", module: "workspace", description: "Verify file I/O, a file watcher and a managed child process.", params: {} },
  { name: "open-terminal", module: "execution", description: "Open a PTY in the proof folder (local app interface only).", params: {} },
  { name: "close-terminal", module: "execution", description: "Close one app-owned terminal and its process tree.", params: { id: { type: "string", required: true, max: 80 } } },
  { name: "stop-runtime", module: "execution", description: "Stop the owned execution service and terminals.", params: {} },
  { name: "create-proof-request", module: "agents", description: "Queue an evidence review for the selected harness.", params: { mode: { type: "enum", values: ["standalone", "craftbot"], required: true }, title: { type: "string", required: true, max: 160 } } },
  { name: "sync-proof-requests", module: "agents", description: "Reconcile requests with terminal framework-task receipts.", idempotent: true, params: {} },
  { name: "submit-proof-result", module: "agents", entity: "requests", description: "Report reviewed evidence and solve its one-use challenge.", appliesWhen: { field: "status", eq: "queued" }, params: { request: { type: "ref", entity: "requests", required: true }, answer: { type: "number", required: true }, decision: { type: "enum", values: ["passed", "blocked"], required: true }, summary: { type: "string", required: true, max: 2000 } } },
  { name: "inspect-craftbot", module: "settings", description: "Run the installed CraftBot importer classifier against this app.", params: { root: { type: "string", required: true, max: 500 }, python: { type: "string", required: true, max: 500 } } },
].map(op => ({ destructive: false, ...op }));
function receipt(store, kind, status, details) {
  return store.put("proofs", { id: randomUUID(), kind, status, details, created: new Date().toISOString() });
}
export const runners = {
 "terminal-reconnect":async(args,ctx)=>{requireHuman(ctx);return runtimeCall("terminal-reconnect",args);},
  "studio-status": (_args, _ctx, { store }) => ({
    framework, runtime: runtimeInfo(),
    proofs: store.list("proofs").filter(p=>typeof p.kind==="string"&&p.status&&p.created).sort((a,b) => b.created.localeCompare(a.created)).slice(0,20),
    requests: store.list("requests").filter(r=>r.created&&r.agentTask).sort((a,b) => b.created.localeCompare(a.created)).slice(0,20),
    milestone: "Development workspace with isolated agent work; integration diagnostics retained.",
  }),
  "run-local-proof": async (_args, _ctx, { store }) => {
    const details = await runtimeCall("probe");
    return receipt(store, "local-execution", details.passed ? "passed" : "failed", details);
  },
  "open-terminal": async (_args, ctx) => { requireHuman(ctx); return runtimeCall("terminal-open"); },
  "close-terminal": async (args, ctx) => { requireHuman(ctx); return runtimeCall("terminal-close", args); },
  "stop-runtime": async (_args, ctx) => { requireHuman(ctx); return stopRuntime(); },
  "sync-proof-requests": (_args,_ctx,{store}) => syncRequests(store),
  "create-proof-request": async (args, _ctx, { store, trigger }) => {
    await syncRequests(store);
    if(store.list("requests").filter(r=>r.status==="queued"&&r.agentTask).length>=10)throw new Error("Ten reviews are already waiting. Finish or cancel them before adding another.");
    const proof = store.list("proofs").filter(p => p.kind === "local-execution").at(-1);
    if (!proof) throw new Error("Run the local execution proof before requesting an agent review.");
    const request = store.put("requests", { id: randomUUID(), title: args.title, mode: args.mode, status: "queued", left: randomBytes(1)[0] + 10, right: randomBytes(1)[0] + 10, evidence: proof.id, created: new Date().toISOString() });
    try {
      const task = trigger("studio.review-requested", { request: request.id }, "studio-" + args.mode + "-proof");
      request.agentTask = task.taskId; store.put("requests", request); watchRequests(store); return request;
    } catch (err) {
      request.status = "failed"; request.summary = "Dispatch failed; check the connection and create a new request."; store.put("requests", request); throw err;
    }
  },
  "submit-proof-result": async (args, ctx, { store }) => {
    const request = store.get("requests", args.request);
    if (!request || request.status !== "queued") throw new Error("This request is no longer waiting for a result.");
    if (ctx.credentialId === "ui" || ctx.credentialId === "anonymous") throw new Error("An authenticated agent must submit the review.");
    const task=await taskReceipt(request.agentTask);
    if(task.status!=="working") { await syncRequests(store); throw new Error("This framework task is not actively claimed. Cancelled or finished reviews cannot accept a result."); }
    if (args.answer !== request.left + request.right) throw new Error("The challenge answer is incorrect. Read the request again.");
    const proof = store.get("proofs", request.evidence);
    if (!proof) throw new Error("The evidence no longer exists.");
    if (args.decision === "passed" && proof.status !== "passed") throw new Error("The local execution evidence did not pass.");
    request.status = args.decision; request.summary = args.summary; request.agent = ctx.agentName || ctx.credentialId;
    request.finished = new Date().toISOString(); store.put("requests", request);
    receipt(store, request.mode + "-agent", args.decision, { request: request.id, agent: request.agent, summary: request.summary });
    return request;
  },
  "inspect-craftbot": async (args, ctx, { store }) => {
    requireHuman(ctx);
    if (!isAbsolute(args.root) || !await stat(join(args.root, "app/agent_app/manager.py")).then(s=>s.isFile()).catch(()=>false)) {
      throw new Error("That folder is not an available CraftBot source checkout. Choose the folder containing app/agent_app/manager.py, then retry.");
    }
    if (!isAbsolute(args.python) || !await stat(args.python).then(s=>s.isFile()).catch(()=>false)) {
      throw new Error("The Python executable was not found. Choose the absolute interpreter path configured for this CraftBot installation.");
    }
    try {
      const { stdout } = await exec(args.python, [join(ROOT, "scripts/inspect-craftbot.py"), args.root, ROOT], { timeout: 20000, maxBuffer: 100000, windowsHide: true });
      const details = JSON.parse(stdout.trim().split("\n").at(-1));
      return receipt(store, "craftbot-import", details.nativeCompatible ? "passed" : "blocked", details);
    } catch (err) {
      console.error(JSON.stringify({evt:"craftbot-inspection-failed",code:err.code||"invalid-response"}));
      throw new Error(err.killed ? "CraftBot inspection timed out. Check its Python environment and retry." : "CraftBot's importer could not load in that Python environment. Choose the interpreter configured for this installation and retry.");
    }
  },
};
