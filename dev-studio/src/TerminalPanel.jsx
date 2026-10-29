import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
export default function TerminalPanel({
  operation,
  onChange,
  projectName,
  sessionKey,
  executionEnabled = true,
  onEnableExecution,
}) {
  const host = useRef(null),
    socket = useRef(null),
    terminal = useRef(null),
    session = useRef(null);
  const [resumeId, setResumeId] = useState(() => {
    try {
      return sessionKey ? sessionStorage.getItem(sessionKey) : null;
    } catch {
      return null;
    }
  });
  function remember(id) {
    setResumeId(id);
    try {
      if (sessionKey) {
        if (id) sessionStorage.setItem(sessionKey, id);
        else sessionStorage.removeItem(sessionKey);
      }
    } catch {}
  }
  const [phase, setPhase] = useState("idle"),
    [error, setError] = useState("");
  useEffect(() => {
    setError("");
  }, [executionEnabled, sessionKey]);
  useEffect(
    () => () => {
      socket.current?.close();
      terminal.current?.dispose();
    },
    [],
  );
  async function open() {
    if (!executionEnabled) return;
    setPhase("opening");
    setError("");
    try {
      const grant = resumeId
        ? await operation("terminal-reconnect", { id: resumeId })
        : await operation("open-terminal");
      session.current = grant;
      remember(grant.id);
      const css = getComputedStyle(document.documentElement);
      const term = new Terminal({
        convertEol: false,
        cursorBlink: true,
        fontSize: 13,
        scrollback: 1500,
        theme: {
          background: css.getPropertyValue("--bg-surface").trim(),
          foreground: css.getPropertyValue("--text-primary").trim(),
        },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host.current);
      fit.fit();
      terminal.current = term;
      const ws = new WebSocket(grant.url, [
        "studio-v1",
        "ticket-" + grant.ticket,
      ]);
      socket.current = ws;
      const resize = () => {
        fit.fit();
        if (ws.readyState === WebSocket.OPEN)
          ws.send(
            JSON.stringify({
              type: "resize",
              cols: term.cols,
              rows: term.rows,
            }),
          );
      };
      const observer = new ResizeObserver(resize);
      observer.observe(host.current);
      ws.onopen = () => {
        setPhase("open");
        resize();
        term.focus();
        onChange();
      };
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "output") term.write(msg.data);
        if (msg.type === "exit") {
          remember(null);
          setPhase("closed");
        }
      };
      ws.onerror = () => {
        setError(
          "The terminal connection failed. Close it and open a new terminal.",
        );
      };
      ws.onclose = () => {
        observer.disconnect();
        setPhase("closed");
        onChange();
      };
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: "input", data }));
      });
    } catch (e) {
      if (resumeId) remember(null);
      setError(e.message);
      setPhase("idle");
    }
  }
  async function close() {
    if (session.current)
      await operation("close-terminal", { id: session.current.id });
    socket.current?.close();
    terminal.current?.dispose();
    terminal.current = null;
    session.current = null;
    remember(null);
    setPhase("idle");
    onChange();
  }
  return (
    <section
      className={
        "panel terminal-panel " + (projectName ? "project-terminal-panel" : "")
      }
    >
      <div className="section-heading">
        <div>
          <h2>{projectName || "Interactive terminal"}</h2>
          {(!projectName || phase === "open") && (
            <p>
              {phase === "open"
                ? "Connected · " + session.current?.shell
                : projectName
                  ? "A real shell in " + projectName
                  : "A real shell in the disposable proof folder."}
            </p>
          )}
        </div>
        {["open", "opening"].includes(phase) ? (
          <button
            className="button secondary"
            disabled={phase === "opening"}
            onClick={() => close().catch((e) => setError(e.message))}
          >
            Close terminal
          </button>
        ) : executionEnabled ? (
          <button
            className="button primary"
            onClick={async () => {
              terminal.current?.dispose();
              await open();
            }}
          >
            {resumeId ? "Resume terminal" : "Open terminal"}
          </button>
        ) : null}
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div
        ref={host}
        className={"terminal-host " + (phase === "idle" ? "is-empty" : "")}
        aria-label={
          projectName
            ? "Interactive project terminal"
            : "Interactive proof terminal"
        }
      />
      {phase === "idle" && !executionEnabled && (
        <div className="terminal-locked">
          <p>Enable execution to use this project’s terminal.</p>
          <button
            onClick={() =>
              onEnableExecution?.().catch((e) => setError(e.message))
            }
          >
            Enable execution…
          </button>
        </div>
      )}
      {phase === "idle" && executionEnabled && (
        <div className="terminal-empty">
          <h3>No terminal session</h3>
          {!projectName && (
            <p>
              Open a terminal to check the real shell. Commands have your local
              account’s permissions.
            </p>
          )}
        </div>
      )}
      {phase === "opening" && <p role="status">Starting the shell…</p>}
      {phase === "closed" && (
        <p role="status">
          The connection closed. Resume within 60 seconds to keep this shell;
          otherwise open a new terminal.
        </p>
      )}
    </section>
  );
}
