import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { ROOT, dataDir, allowedOrigins } from "./config.mjs";
let worker, ready;
let info = null;
const pending = new Map();
export const runtimeInfo = () => info || { running: false };
export async function runtimeCall(method, params = {}) {
  if (!worker || !worker.connected) {
    worker = fork(join(ROOT, "app/runtime-worker.mjs"), [], {
      cwd: ROOT, env: { ...process.env, STUDIO_DATA_DIR: dataDir(), STUDIO_ORIGINS: JSON.stringify(allowedOrigins()) },
      stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true,
    });
    const child = worker;
    ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The execution service did not start within ten seconds.")), 10000);
      child.on("message", msg => {
        if (msg.type === "ready") { clearTimeout(timer); info = { running: true, pid: child.pid, port: msg.port }; resolve(info); }
        if (msg.type === "reply") {
          const call = pending.get(msg.id);
          if (!call) return;
          clearTimeout(call.timer); pending.delete(msg.id);
          msg.error ? call.reject(new Error(msg.error)) : call.resolve(msg.result);
        }
      });
      child.once("error", err => { clearTimeout(timer); reject(err); });
      child.once("exit", () => {
        clearTimeout(timer); info = null; reject(new Error("The execution service stopped."));
        for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error("The execution service stopped; retry the action.")); }
        pending.clear(); if (worker === child) worker = null;
      });
    });
    // Terminal-library errors must not forward potentially sensitive user output.
    child.stderr.on("data", () => {});
  }
  await ready;
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("The execution action timed out.")); }, 30000);
    pending.set(id, { resolve, reject, timer });
    worker.send({ id, method, params });
  });
}
export async function stopRuntime() {
  if (!worker?.connected) return { stopped: true };
  const child = worker;
  const result = await runtimeCall("shutdown");
  await new Promise(resolve => {
    const timer = setTimeout(() => { child.kill(); resolve(); }, 3000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
  return result;
}
