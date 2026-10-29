// Studio-side client for CraftBot's existing local browser transport.
// Tokens and global chat transcripts are never persisted or returned to the UI.
import WebSocket from "ws";

export function craftbotUrl(value = "http://127.0.0.1:7926") {
  const u = new URL(value);
  if (u.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(u.hostname) ||
      u.username || u.password || u.pathname !== "/" || u.search || u.hash)
    throw Error("Use CraftBot’s local backend address, for example http://127.0.0.1:7926.");
  return u.origin;
}
async function localJson(url, path) {
  const response = await fetch(craftbotUrl(url) + path, {
    redirect: "error", signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) throw Error("CraftBot did not accept the local connection.");
  return response.json();
}
export async function craftbotState(url) {
  const state = await localJson(url, "/api/state");
  if (!Array.isArray(state.sessions) || !Array.isArray(state.busySessions))
    throw Error("This address is not CraftBot’s backend. Check its backend port.");
  return { version: state.version, needsOnboarding: !!state.needsHardOnboarding,
    sessions: state.sessions.map(s => s.id), busy: state.busySessions };
}
export async function craftbotAgent(url) {
  const address = craftbotUrl(url);
  try {
    const state = await craftbotState(address);
    return { id: "craftbot", name: "CraftBot", service: true, address, installed: true,
      authentication: state.needsOnboarding ? "required" : "ready", available: !state.needsOnboarding };
  } catch {
    return { id: "craftbot", name: "CraftBot", service: true, address, installed: false,
      authentication: "unknown", available: false };
  }
}
export async function craftbotSocket(url) {
  const origin = craftbotUrl(url);
  const { token } = await localJson(origin, "/api/session-token");
  if (typeof token !== "string" || !token) throw Error("CraftBot local authentication is unavailable.");
  const socket = new WebSocket(origin.replace("http:", "ws:") + "/ws",
    ["craftbot", "craftbot-auth." + token], { origin, handshakeTimeout: 4000, maxPayload: 8 * 1024 * 1024 });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", () => reject(Error("Could not open CraftBot’s authenticated connection.")));
  });
  return socket;
}
export function ownedSession(value) {
  return typeof value === "string" && /^[a-f0-9]{12}$/.test(value);
}
export async function stopCraftbotSession(receipt, existingSocket) {
  // Only receipts created by our per-task dispatch can authorize a stop.
  if (receipt.provider !== "craftbot" || !receipt.clientId?.startsWith("studio-") || !ownedSession(receipt.session))
    throw Error("CraftBot task session ownership is not confirmed.");
  const socket = existingSocket?.readyState === WebSocket.OPEN ? existingSocket : await craftbotSocket(receipt.url);
  const ownSocket = socket !== existingSocket;
  try {
    const state = await craftbotState(receipt.url);
    if (!state.sessions.includes(receipt.session)) throw Error("The owned CraftBot session is no longer available; stop is unconfirmed.");
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(Error("CraftBot has not confirmed stopping this task yet.")), 12000);
      function finish(error) { clearTimeout(timer); socket.off("message", message); socket.off("close", closed); error ? reject(error) : resolve(); }
      function closed() { finish(Error("CraftBot disconnected before confirming the stop.")); }
      function message(raw) {
        let event; try { event = JSON.parse(raw); } catch { return; }
        if (event.type === "session_busy" && event.data?.sessionId === receipt.session && event.data.state === "idle" && event.data.busy === false) finish();
      }
      socket.on("message", message); socket.once("close", closed);
      socket.send(JSON.stringify({ type: "session_stop", sessionId: receipt.session }));
    });
    if ((await craftbotState(receipt.url)).busy.includes(receipt.session))
      throw Error("CraftBot still reports this task as running.");
    return true;
  } finally { if (ownSocket) socket.close(); }
}
