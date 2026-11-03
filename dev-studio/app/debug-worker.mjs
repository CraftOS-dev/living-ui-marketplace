import { spawn } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { FramedPeer } from "./json-rpc.mjs";
import { killOwned, cleanEnvironment } from "./jobs-worker.mjs";
const sessions = new Map();
export async function debugStart({
  root,
  path,
  kind,
  python = "python",
  breakpoints = [],
}) {
  const active = [...sessions.values()].filter(
    (s) => !["terminated", "failed"].includes(s.status),
  );
  if (active.length >= 2)
    throw new Error("Stop an active debugger before starting another.");
  const id = randomUUID(),
    s = {
      id,
      status: "starting",
      kind,
      root,
      path,
      frames: [],
      variables: [],
      output: "",
      child: null,
      pending: new Map(),
      seq: 0,
    };
  sessions.set(id, s);
  const output = (d) => {
    s.output = (s.output + d.toString()).slice(-65536);
  };
  try {
    if (kind === "javascript") {
      const child = spawn(
        process.execPath,
        ["--inspect-brk=127.0.0.1:0", join(root, path)],
        {
          cwd: root,
          env: cleanEnvironment(),
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
          detached: process.platform !== "win32",
        },
      );
      s.child = child;
      child.stdout.on("data", output);
      child.stderr.on("data", (d) => {
        output(d);
        if (d.toString().includes("Waiting for the debugger to disconnect")) {
          s.status = "terminated";
          s.socket?.close();
        }
      });
      const url = await new Promise((yes, no) => {
        const timer = setTimeout(
          () => no(new Error("Node inspector did not start.")),
          6000,
        );
        child.stderr.on("data", (d) => {
          const m = /ws:\/\/127\.0\.0\.1:[^\s]+/.exec(d.toString());
          if (m) {
            clearTimeout(timer);
            yes(m[0]);
          }
        });
        child.once("error", (e) => {
          clearTimeout(timer);
          no(e);
        });
      });
      const socket = new WebSocket(url);
      s.socket = socket;
      await new Promise((yes, no) => {
        socket.once("open", yes);
        socket.once("error", no);
      });
      socket.on("message", (b) => {
        const m = JSON.parse(b);
        if (m.id) {
          const p = s.pending.get(m.id);
          if (p) {
            clearTimeout(p.timer);
            s.pending.delete(m.id);
            m.error ? p.no(new Error(m.error.message)) : p.yes(m.result);
          }
        }
        if (m.method === "Debugger.paused") {
          s.status = "paused";
          s.frames = m.params.callFrames;
        }
        if (m.method === "Debugger.resumed") {
          s.status = "running";
          s.frames = [];
        }
      });
      s.request = (method, params = {}) =>
        new Promise((yes, no) => {
          const n = ++s.seq,
            timer = setTimeout(() => {
              s.pending.delete(n);
              no(new Error("Debugger request timed out."));
            }, 5000);
          s.pending.set(n, { yes, no, timer });
          socket.send(JSON.stringify({ id: n, method, params }));
        });
      await s.request("Runtime.enable");
      await s.request("Debugger.enable");
      for (const line of breakpoints)
        await s.request("Debugger.setBreakpointByUrl", {
          url: pathToFileURL(join(root, path)).href,
          lineNumber: Math.max(0, line - 1),
        });
      await s.request("Runtime.runIfWaitingForDebugger");
    } else {
      const child = spawn(python, ["-m", "debugpy.adapter"], {
        cwd: root,
        env: cleanEnvironment(),
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
      s.child = child;
      child.stderr.on("data", output);
      let initialized;
      const ready = new Promise((r) => (initialized = r));
      const peer = new FramedPeer(child, {
        dap: true,
        onEvent: (m) => {
          if (m.event === "initialized") initialized();
          if (m.event === "output") output(m.body.output);
          if (m.event === "stopped") {
            s.status = "paused";
            s.thread = m.body.threadId;
          }
          if (m.event === "continued") s.status = "running";
          if (m.event === "terminated" || m.event === "exited")
            s.status = "terminated";
        },
      });
      s.peer = peer;
      try {
        await peer.request(
          "initialize",
          {
            adapterID: "debugpy",
            clientID: "development-studio",
            linesStartAt1: true,
            columnsStartAt1: true,
            pathFormat: "path",
          },
          6000,
        );
      } catch {
        await killOwned(child);
        s.status = "failed";
        throw new Error(
          "Python debugging requires debugpy in the selected interpreter: python -m pip install debugpy",
        );
      }
      const launched = peer.request(
        "launch",
        {
          name: "Development Studio",
          type: "python",
          request: "launch",
          program: join(root, path),
          cwd: root,
          python: [python],
          console: "internalConsole",
          stopOnEntry: true,
          justMyCode: true,
        },
        12000,
      );
      launched.catch(() => {});
      await Promise.race([
        ready,
        new Promise((_, no) =>
          setTimeout(
            () => no(new Error("Python debugger initialization timed out.")),
            6000,
          ),
        ),
      ]);
      await peer.request("setBreakpoints", {
        source: { path: join(root, path) },
        breakpoints: breakpoints.map((line) => ({ line })),
        sourceModified: false,
      });
      await peer.request("configurationDone");
      await launched;
    }
    s.child.once("close", () => {
      s.status = "terminated";
    });
    return debugState({ id });
  } catch (e) {
    s.status = "failed";
    s.socket?.close();
    await killOwned(s.child);
    throw e;
  }
}
export async function debugState({ id, frame = 0 }) {
  const s = sessions.get(id);
  if (!s) throw new Error("Debugger session ended when the runtime restarted.");
  let frames = [],
    variables = [];
  if (s.status === "paused") {
    if (s.kind === "javascript") {
      frames = s.frames.map((f) => ({
        id: f.callFrameId,
        name: f.functionName || "(anonymous)",
        path: f.url?.replace(/^file:\/\//, ""),
        line: f.location.lineNumber + 1,
      }));
      const f = s.frames[frame] || s.frames[0],
        scope = f?.scopeChain.find(
          (x) => x.type === "local" || x.type === "block",
        );
      if (scope) {
        const data = await s.request("Runtime.getProperties", {
          objectId: scope.object.objectId,
          ownProperties: true,
        });
        variables = (data.result || [])
          .slice(0, 100)
          .map((v) => ({
            name: v.name,
            value: String(
              v.value?.value ?? v.value?.description ?? v.value?.type,
            ),
          }));
      }
    } else {
      const data = await s.peer.request("stackTrace", {
        threadId: s.thread,
        startFrame: 0,
        levels: 30,
      });
      frames = (data.stackFrames || []).map((f) => ({
        id: f.id,
        name: f.name,
        path: f.source?.path,
        line: f.line,
      }));
      if (frames.length) {
        const scopes = await s.peer.request("scopes", {
          frameId: frames[frame]?.id || frames[0].id,
        });
        const local =
          scopes.scopes.find((v) => v.name === "Locals") || scopes.scopes[0];
        if (local) {
          const v = await s.peer.request("variables", {
            variablesReference: local.variablesReference,
          });
          variables = (v.variables || [])
            .slice(0, 100)
            .map((v) => ({ name: v.name, value: v.value }));
        }
      }
    }
  }
  return {
    id,
    status: s.status,
    kind: s.kind,
    path: s.path,
    frames,
    variables,
    output: s.output,
    pid: s.child?.pid,
  };
}
export async function debugControl({ id, action }) {
  const s = sessions.get(id);
  if (!s) throw new Error("Debug session not found.");
  if (action === "stop") {
    if (s.peer)
      await s.peer
        .request("disconnect", { terminateDebuggee: true })
        .catch(() => {});
    s.socket?.close();
    await killOwned(s.child);
    s.status = "terminated";
    return debugState({ id });
  }
  if (action !== "pause") {
    s.status = "running";
    s.frames = [];
  }
  if (s.kind === "javascript") {
    const method = {
      continue: "Debugger.resume",
      next: "Debugger.stepOver",
      stepIn: "Debugger.stepInto",
      stepOut: "Debugger.stepOut",
      pause: "Debugger.pause",
    }[action];
    if (!method) throw new Error("Unknown debug control.");
    await s.request(method);
  } else {
    const cmd = {
      continue: "continue",
      next: "next",
      stepIn: "stepIn",
      stepOut: "stepOut",
      pause: "pause",
    }[action];
    if (!cmd) throw new Error("Unknown debug control.");
    await s.peer.request(cmd, { threadId: s.thread || 1 });
  }
  return debugState({ id });
}
export async function stopDebuggers() {
  await Promise.all(
    [...sessions.values()].map((s) =>
      debugControl({ id: s.id, action: "stop" }),
    ),
  );
}
