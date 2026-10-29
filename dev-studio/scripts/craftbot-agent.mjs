// One claimed Studio delivery -> one owned chat in an unmodified CraftBot.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { developmentContext } from "./development-client.mjs";
import { developmentInstruction } from "./development-instruction.mjs";
import { request } from "./client.mjs";
import { craftbotSocket, craftbotState, ownedSession, stopCraftbotSession } from "../app/craftbot-connection.mjs";

let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
const task = /task\s+(tsk_[a-zA-Z0-9]+)/.exec(prompt)?.[1];
if (!task) throw Error("A claimed Studio development task is required.");
const configuration = JSON.parse(await readFile(process.argv[3], "utf8"));
const folder = join(process.argv[2], "agent-processes");
await mkdir(folder, { recursive: true });
const file = join(folder, task + ".json");
const state = { task, pid: process.pid, provider: "craftbot", url: configuration.url,
  clientId: "studio-" + randomUUID(), started: new Date().toISOString(), dispatched: false };
const save = () => writeFile(file, JSON.stringify(state));
let socket, stopping = false, dispatchError;
await save();
async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    if (state.session) { await stopCraftbotSession(state, socket); state.stopConfirmed = true; }
    else state.stopConfirmed = !state.dispatched;
  } catch { state.error = "Agent CraftBot stop is not confirmed. Keep CraftBot running and retry task status."; }
  state.finished = new Date().toISOString();
  await save(); socket?.close();
}
try {
  const bootstrap = await developmentContext(task);
  if (!bootstrap) throw Error("This delivery is no longer active.");
  socket = await craftbotSocket(configuration.url);
  let createdResolve, createdReject;
  const created = new Promise((resolve, reject) => { createdResolve = resolve; createdReject = reject; });
  const timer = setTimeout(() => createdReject(Error("CraftBot did not acknowledge the new task chat. Delivery will not be resent automatically.")), 15000);
  socket.on("message", raw => {
    let event; try { event = JSON.parse(raw); } catch { return; }
    if (event.type === "session_created" && event.data?.clientId === state.clientId && ownedSession(event.data.session?.id)) {
      state.session = event.data.session.id;
      save().then(createdResolve, createdReject);
    }
  });
  socket.on("close", () => { dispatchError = Error("CraftBot’s connection closed during this task."); createdReject(dispatchError); });
  socket.on("error", () => { dispatchError = Error("CraftBot’s task connection was interrupted."); });
  state.dispatched = true; await save();
  socket.send(JSON.stringify({ type: "message", sessionId: "new", clientId: state.clientId,
    content: developmentInstruction(bootstrap, prompt) + "\n\nThis is a Studio connector task in your dedicated chat. Use your existing shell tool to run the scoped Node client above. Do not import Studio, change CraftBot, call agent_app actions, use the main chat, or delegate. All coding uses the scoped Studio operations. After work-question or work-finish succeeds stop immediately; Studio will stop this dedicated chat.",
    reasoningEffort: bootstrap.context.effort === "high" ? "high" : "medium" }));
  try { await created; } finally { clearTimeout(timer); }
  let idleSince = null;
  const deadline = Date.now() + 840000;
  while (!stopping) {
    const receipt = await request("/api/_a2app/tasks/" + task);
    if (["completed", "input-required", "canceled", "failed", "pruned"].includes(receipt.status)) {
      state.deliveryAtYield = receipt.status; await stop(); break;
    }
    if (dispatchError) throw dispatchError;
    if (Date.now() > deadline) throw Error("CraftBot exceeded this delivery’s time limit.");
    const host = await craftbotState(configuration.url);
    if (host.busy.includes(state.session)) idleSince = null;
    else { idleSince ??= Date.now(); if (Date.now() - idleSince > 30000) throw Error("CraftBot stopped without submitting changes or asking Studio a question. Check its account and model, then retry."); }
    await new Promise(resolve => setTimeout(resolve, 600));
  }
} catch (error) {
  state.error = "Agent CraftBot: " + error.message;
  process.exitCode = 1;
} finally {
  await stop();
  console.log(JSON.stringify({ task, harness: "craftbot", submitted: state.deliveryAtYield, stopConfirmed: !!state.stopConfirmed }));
}
