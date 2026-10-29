import http from "node:http";
import { mkdir, writeFile, readFile, realpath } from "node:fs/promises";
import { watch } from "node:fs";
import { join } from "node:path";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as pty from "node-pty";
import { WebSocketServer, WebSocket } from "ws";
import {
  jobStart,
  jobState,
  jobStop,
  stopJobs,
  killOwned,
} from "./jobs-worker.mjs";
import { languageQuery, stopLanguages } from "./language-worker.mjs";
import {
  debugStart,
  debugState,
  debugControl,
  stopDebuggers,
} from "./debug-worker.mjs";
const exec = promisify(execFile);
const base = join(process.env.STUDIO_DATA_DIR, "proof-workspace");
await mkdir(base, { recursive: true });
const origins = new Set(JSON.parse(process.env.STUDIO_ORIGINS || "[]"));
const sessions = new Map(),
  tickets = new Map();
const server = http.createServer((_req, res) => {
  res.writeHead(404, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify({ error: "Use the app's authenticated operations." }));
});
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 16384,
  handleProtocols: () => "studio-v1",
});
let shuttingDown = false;
function shellEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/TOKEN|SECRET|API_KEY|PASSWORD|CREDENTIAL|^STUDIO_/.test(
          key.toUpperCase(),
        ),
    ),
  );
}
function terminalGrant(session) {
  const ticket = randomBytes(24).toString("hex");
  tickets.set(ticket, { id: session.id, expires: Date.now() + 15000 });
  setTimeout(() => {
    tickets.delete(ticket);
    if (!session.socket && !session.resumeTimer)
      terminate(session).catch(() => {});
  }, 16000).unref();
  return {
    id: session.id,
    pid: session.pty.pid,
    url: "ws://127.0.0.1:" + server.address().port + "/terminal/" + session.id,
    ticket,
    cwd: session.cwd,
    shell: session.shell,
  };
}
async function terminate(session) {
  if (!session || session.closed) return;
  clearTimeout(session.resumeTimer);
  await killOwned({
    pid: session.pty.pid,
    exitCode: null,
    kill: (signal) => session.pty.kill(signal),
  });
  session.closed = true;
  session.socket?.close(1000, "Terminal closed");
  sessions.delete(session.id);
}
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await Promise.all([...sessions.values()].map(terminate));
  await stopJobs();
  await stopLanguages();
  await stopDebuggers();
  wss.close();
  server.close();
}
server.on("upgrade", (req, socket, head) => {
  const protocols = String(req.headers["sec-websocket-protocol"] || "")
    .split(",")
    .map((s) => s.trim());
  const token = protocols.find((s) => s.startsWith("ticket-"))?.slice(7);
  const grant = token ? tickets.get(token) : null;
  if (
    !origins.has(req.headers.origin) ||
    !grant ||
    grant.expires < Date.now() ||
    req.url !== "/terminal/" + grant.id
  ) {
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    return;
  }
  const session = sessions.get(grant.id);
  if (!session || session.closed) {
    socket.end("HTTP/1.1 410 Gone\r\n\r\n");
    return;
  }
  tickets.delete(token);
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (session.socket?.readyState === WebSocket.OPEN) {
      ws.close(1008, "Already connected");
      return;
    }
    clearTimeout(session.resumeTimer);
    session.resumeTimer = null;
    session.socket = ws;
    ws.send(JSON.stringify({ type: "output", data: session.buffer }));
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (
          msg.type === "input" &&
          typeof msg.data === "string" &&
          msg.data.length <= 8192
        )
          session.pty.write(msg.data);
        else if (
          msg.type === "resize" &&
          Number.isInteger(msg.cols) &&
          Number.isInteger(msg.rows)
        )
          session.pty.resize(
            Math.max(20, Math.min(300, msg.cols)),
            Math.max(5, Math.min(100, msg.rows)),
          );
      } catch {
        session.protocolFailure = true;
        ws.close(1008, "Invalid terminal message");
      }
    });
    ws.on("close", () => {
      if (session.closed || session.socket !== ws) return;
      session.socket = null;
      if (session.protocolFailure) {
        terminate(session).catch(() => {});
        return;
      }
      session.resumeTimer = setTimeout(
        () => terminate(session).catch(() => {}),
        60000,
      );
      session.resumeTimer.unref();
    });
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
process.send?.({ type: "ready", port: server.address().port });
async function localProof() {
  const marker = "studio-" + randomUUID(),
    file = join(base, "runtime-proof-" + randomUUID() + ".txt");
  let watcher;
  const changed = new Promise((resolve) => {
    watcher = watch(base, (_event, name) => {
      if (name === file.slice(base.length + 1)) resolve(true);
    });
  });
  try {
    await writeFile(file, marker, "utf8");
    const watched = await Promise.race([
      changed,
      new Promise((resolve) => setTimeout(() => resolve(false), 2000)),
    ]);
    const { stdout } = await exec(
      process.execPath,
      [
        "-e",
        "process.stdout.write(require('node:fs').readFileSync(process.argv[1],'utf8'))",
        file,
      ],
      { cwd: base, timeout: 5000, windowsHide: true },
    );
    const stored = await readFile(file, "utf8");
    return {
      passed: stdout === marker && stored === marker && watched,
      marker,
      file: await realpath(file),
      watcher: watched,
      childExitCode: 0,
      sha256: createHash("sha256").update(stored).digest("hex"),
      runtimePid: process.pid,
    };
  } finally {
    watcher?.close();
  }
}
process.on("message", async ({ id, method, params }) => {
  try {
    let result;
    if (method === "probe") result = await localProof();
    else if (method === "job-start") result = await jobStart(params);
    else if (method === "job-state") result = await jobState(params.id);
    else if (method === "job-stop") result = await jobStop(params.id);
    else if (method === "language-query") result = await languageQuery(params);
    else if (method === "debug-start") result = await debugStart(params);
    else if (method === "debug-state") result = await debugState(params);
    else if (method === "debug-control") result = await debugControl(params);
    else if (method === "terminal-open") {
      if (sessions.size >= 2)
        throw new Error("Two terminals are already open. Close one first.");
      const id = randomUUID(),
        shell = process.platform === "win32" ? "powershell.exe" : "/bin/sh";
      const cwd = params.cwd || base;
      const terminal = pty.spawn(
        shell,
        process.platform === "win32" ? ["-NoLogo", "-NoProfile"] : [],
        {
          name: "xterm-256color",
          cols: 90,
          rows: 18,
          cwd,
          env: shellEnvironment(),
        },
      );
      const session = {
        id,
        pty: terminal,
        buffer: "",
        socket: null,
        closed: false,
        cwd,
        shell,
      };
      sessions.set(id, session);
      terminal.onData((data) => {
        session.buffer = (session.buffer + data).slice(-65536);
        if (session.socket?.readyState === WebSocket.OPEN)
          session.socket.send(JSON.stringify({ type: "output", data }));
      });
      terminal.onExit(({ exitCode }) => {
        session.closed = true;
        sessions.delete(id);
        if (session.socket?.readyState === WebSocket.OPEN) {
          session.socket.send(JSON.stringify({ type: "exit", exitCode }));
          session.socket.close();
        }
      });
      result = terminalGrant(session);
    } else if (method === "terminal-reconnect") {
      const session = sessions.get(params.id);
      if (!session || session.closed)
        throw new Error(
          "This terminal session is no longer available. Open a new terminal.",
        );
      if (session.socket?.readyState === WebSocket.OPEN)
        throw new Error("This terminal is already connected.");
      result = terminalGrant(session);
    } else if (method === "terminal-close") {
      await terminate(sessions.get(params.id));
      result = { closed: true };
    } else if (method === "shutdown") {
      await shutdown();
      result = { stopped: true, terminalsClosed: sessions.size === 0 };
    } else throw new Error("Unknown runtime action.");
    process.send?.({ type: "reply", id, result });
    if (method === "shutdown") setTimeout(() => process.exit(0), 40);
  } catch (err) {
    process.send?.({
      type: "reply",
      id,
      error: err instanceof Error ? err.message : "Execution failed.",
    });
  }
});
process.on("disconnect", async () => {
  await shutdown();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await shutdown();
  process.exit(0);
});
