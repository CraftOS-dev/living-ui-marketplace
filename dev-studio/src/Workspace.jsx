import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { api } from "./api.js";
import { useToast } from "./toast.jsx";
import { useConfirm } from "./ConfirmDialog.jsx";
import Icon from "./Icon.jsx";
import ProjectStart from "./ProjectStart.jsx";
import TaskActivity from "./TaskActivity.jsx";
import StudioSettings from "./StudioSettings.jsx";
import { SearchSidebar, SourceControlSidebar } from "./WorkbenchPanels.jsx";
import {
  recoverBuffers,
  persistBuffer,
  forgetBuffer,
} from "./editor-recovery.js";
import "./workspace.css";
import "./workbench-design.css";
const Editor = lazy(() => import("./CodeEditor.jsx"));
const Diff = lazy(() =>
  import("./CodeEditor.jsx").then((m) => ({ default: m.DiffView })),
);
const Terminal = lazy(() => import("./TerminalPanel.jsx"));
// These two actions are invoked only after their explicit in-app confirmation.
const op = async (name, args = {}, timeoutMs = 30000) => {
  const call = (approval) =>
    api("/api/ops/" + name, {
      method: "POST",
      body: JSON.stringify(args),
      headers: {
        "content-type": "application/json",
        ...(approval ? { "x-a2app-approval": approval } : {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  try {
    return (await call()).result;
  } catch (e) {
    if (
      e.status === 428 &&
      e.approvalKey &&
      ["file-trash", "checkpoint-restore"].includes(name)
    )
      return (await call(e.approvalKey)).result;
    throw e;
  }
};
function readWorkspaceLayout() {
  try {
    return JSON.parse(localStorage.getItem("studio-layout") || "{}");
  } catch {
    return {};
  }
}
const empty = {
  projects: [],
  configs: [],
  runs: [],
  work: [],
  preferences: {},
};
const dirty = (b) => b && !b.binary && !b.large && b.text !== b.baseText;
const limitedComparison = (c) =>
  [c.before, c.after, c.destination].some((d) => d?.binary || d?.large);
const humanStatus = (s) =>
  ({
    "needs-input": "Needs your answer",
    ready: "Ready for review",
    canceling: "Stop requested",
    canceled: "Stopped",
    queued: "Queued",
    running: "Running",
    finalizing: "Preparing review",
    passed: "Passed",
    failed: "Failed",
    interrupted: "Interrupted",
    applied: "Applied",
    rejected: "Rejected",
    draft: "Draft",
  })[s] || s;
function Status({ status }) {
  return (
    <span className={"ws-status tone-" + status}>{humanStatus(status)}</span>
  );
}
const Markdown = lazy(() => import("./MarkdownPreview.jsx"));
function terminalLayout(project) {
  let saved = {};
  try {
    saved = JSON.parse(
      localStorage.getItem("studio-terminals-" + project) || "{}",
    );
  } catch {}
  let second = saved.tabs?.includes(2);
  try {
    second ||= !!sessionStorage.getItem("studio-terminal-" + project + "-2");
  } catch {}
  return {
    tabs: second ? [1, 2] : [1],
    active: second && saved.active === 2 ? 2 : 1,
  };
}
function rememberTerminals(project, tabs, active) {
  try {
    localStorage.setItem(
      "studio-terminals-" + project,
      JSON.stringify({ tabs, active }),
    );
  } catch {}
}
export default function Workspace() {
  const [remembered] = useState(readWorkspaceLayout);
  const settingsReturnArea = useRef(
    remembered.area === "Settings" ? "Files" : remembered.area || "Files",
  );
  const dialogOpener = useRef(null);
  const folderPickerActive = useRef(false);
  const [folderBrowsing, setFolderBrowsing] = useState(false);
  const toast = useToast(),
    [confirm, confirmElement] = useConfirm();
  const [state, setState] = useState(empty),
    [projectId, setProjectId] = useState(
      () =>
        sessionStorage.getItem("studio-current-project") ??
        localStorage.getItem("studio-project") ??
        "",
    ),
    [area, setArea] = useState(remembered.area || "Files"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  const [tree, setTree] = useState({}),
    [treePending, setTreePending] = useState(new Set()),
    [treeFailures, setTreeFailures] = useState({}),
    [expanded, setExpanded] = useState(new Set([""])),
    [buffers, setBuffers] = useState([]),
    [active, setActive] = useState(""),
    [split, setSplit] = useState(!!remembered.split),
    [preview, setPreview] = useState(false),
    [view, setView] = useState("editor");
  const [modal, setModal] = useState(null),
    [fields, setFields] = useState({}),
    [searchText, setSearchText] = useState(""),
    [searchResult, setSearchResult] = useState(null),
    [replacement, setReplacement] = useState(""),
    [replaceFiles, setReplaceFiles] = useState(null),
    [replaceSpec, setReplaceSpec] = useState(null),
    [replaceSelected, setReplaceSelected] = useState(new Set());
  const [git, setGit] = useState(null),
    [gitDiff, setGitDiff] = useState(null),
    [commitMessage, setCommitMessage] = useState("");
  const [workId, setWorkId] = useState(""),
    [review, setReview] = useState(null),
    [selectedChanges, setSelectedChanges] = useState(new Set()),
    [merged, setMerged] = useState(""),
    [answer, setAnswer] = useState("");
  const [bottom, setBottom] = useState(remembered.bottom || "Runs"),
    [run, setRun] = useState(null),
    [debug, setDebug] = useState(null),
    [diagnostics, setDiagnostics] = useState([]),
    [languageError, setLanguageError] = useState(""),
    [breakpoints, setBreakpoints] = useState({}),
    [terminalTab, setTerminalTab] = useState(
      () => terminalLayout(projectId).active,
    ),
    [terminals, setTerminals] = useState(() => terminalLayout(projectId).tabs),
    [bottomOpen, setBottomOpen] = useState(remembered.bottomOpen !== false);
  const [selection, setSelection] = useState(null);
  const [agentOpen, setAgentOpen] = useState(remembered.agentOpen === true);
  const [revision, setRevision] = useState("");
  const [artifact, setArtifact] = useState(null);
  const [connection, setConnection] = useState({ connected: false }),
    [tools, setTools] = useState(null),
    [palette, setPalette] = useState(false),
    [quickPath, setQuickPath] = useState(""),
    [conflict, setConflict] = useState(null);
  const project = state.projects.find((p) => p.id === projectId),
    buffer = buffers.find((b) => b.path === active),
    work = state.work.find((w) => w.id === workId),
    theme = state.preferences.theme || "system";
  const resolvedTheme =
    theme === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  useEffect(() => {
    if (work?.project === projectId)
      sessionStorage.setItem("studio-work-" + projectId, workId);
  }, [workId, work?.project, projectId]);
  const latest = useRef({ buffers, projectId, active, project, area });
  latest.current = { buffers, projectId, active, project, area };
  function openSettings() {
    if (area !== "Settings") settingsReturnArea.current = area;
    setArea("Settings");
  }
  async function toggleStandaloneConnection() {
    if (connection.external) { openSettings(); return; }
    const result = await act("connector-control", {
      action:
        connection.connected || connection.connecting
          ? "disconnect"
          : "connect",
    });
    if (result) setConnection(result);
  }
  const refresh = useCallback(async () => {
    try {
      const data = await op("workspace-state");
      setState(data);
      if (
        latest.current.projectId &&
        !data.projects.some((p) => p.id === latest.current.projectId)
      )
        setProjectId("");
      setError("");
      return data;
    } catch (e) {
      setError(e.message);
    }
  }, []);
  async function act(name, args = {}, success) {
    setBusy(name);
    setError("");
    try {
      const value = await op(name, args);
      await refresh();
      if (success) toast("success", success);
      return value;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setBusy("");
    }
  }
  useEffect(() => {
    document.title = "Development Studio";
    refresh();
    op("connector-control", { action: "status" })
      .then(setConnection)
      .catch(() => {});
  }, [refresh]);
  useEffect(() => {
    if (area !== "Settings" && (!agentOpen || work?.mode === "craftbot"))
      return;
    let stopped = false;
    const timer = setInterval(() => {
      op("connector-control", { action: "status" })
        .then((status) => {
          if (!stopped) setConnection(status);
        })
        .catch(() => {
          if (!stopped)
            setConnection({
              connected: false,
              message:
                "The app connection was interrupted. Reconnect when it is available.",
            });
        });
    }, 3000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [agentOpen, work?.mode, area]);
  useEffect(() => {
    localStorage.setItem(
      "studio-layout",
      JSON.stringify({ area, split, bottom, bottomOpen, agentOpen }),
    );
  }, [area, split, bottom, bottomOpen, agentOpen]);
  useEffect(() => {
    if (active && projectId)
      localStorage.setItem("studio-active-" + projectId, active);
  }, [active, projectId]);
  useEffect(() => {
    if (!modal && !palette) return;
    const opener = dialogOpener.current || document.activeElement,
      dialog = document.querySelector(modal ? ".ws-modal" : ".command-palette");
    const stops = () =>
      [
        ...dialog.querySelectorAll(
          'button:not([disabled]),input,select,textarea,[tabindex="0"]',
        ),
      ].filter((e) => e.getClientRects().length);
    const initialFocus =
      stops().find((element) => element.matches("input,textarea,select")) ||
      stops()[0];
    initialFocus?.focus();
    const trap = (e) => {
      if (document.querySelector('[role="alertdialog"]')) return;
      if (e.key !== "Tab") return;
      const nodes = stops(),
        first = nodes[0],
        last = nodes.at(-1);
      if (
        e.shiftKey &&
        (document.activeElement === first ||
          !dialog.contains(document.activeElement))
      ) {
        e.preventDefault();
        last?.focus();
      } else if (
        !e.shiftKey &&
        (document.activeElement === last ||
          !dialog.contains(document.activeElement))
      ) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap, true);
    return () => {
      document.removeEventListener("keydown", trap, true);
      opener?.focus?.();
    };
  }, [modal, palette]);
  useEffect(() => {
    setPreview(false);
  }, [active, projectId]);
  useEffect(() => {
    if (!modal) setError("");
  }, [modal]);
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);
  const loadTree = useCallback(
    async (path = "", id = latest.current.projectId) => {
      if (!id) return;
      setTreePending((previous) => new Set(previous).add(path));
      setTreeFailures((previous) => ({ ...previous, [path]: null }));
      try {
        const r = await op("project-tree", { project: id, path });
        if (id === latest.current.projectId)
          setTree((previous) => ({ ...previous, [path]: r.entries }));
      } catch (e) {
        if (id === latest.current.projectId) {
          setError(e.message);
          setTreeFailures((previous) => ({ ...previous, [path]: e.message }));
        }
      } finally {
        if (id === latest.current.projectId)
          setTreePending((previous) => {
            const next = new Set(previous);
            next.delete(path);
            return next;
          });
      }
    },
    [],
  );
  useEffect(() => {
    localStorage.setItem("studio-project", projectId);
    sessionStorage.setItem("studio-current-project", projectId);
    setTree({});
    setTreePending(new Set());
    setTreeFailures({});
    const layout = terminalLayout(projectId);
    setTerminals(layout.tabs);
    setTerminalTab(layout.active);
    setReplaceSpec(null);
    setExpanded(new Set([""]));
    setRun(null);
    setReview(null);
    setView("editor");
    setActive("");
    setBuffers([]);
    setGit(null);
    setSearchResult(null);
    setWorkId(sessionStorage.getItem("studio-work-" + projectId) || "");
    setDiagnostics([]);
    setConflict(null);
    if (!projectId) return;
    let canceled = false;
    loadTree("", projectId);
    recoverBuffers(projectId)
      .then((items) => {
        if (canceled) return;
        setBuffers(items);
        setActive(
          items.find(
            (b) =>
              b.path === localStorage.getItem("studio-active-" + projectId),
          )?.path ||
            items[0]?.path ||
            "",
        );
      })
      .catch((e) => setError("Could not load recovered buffers: " + e.message));
    return () => {
      canceled = true;
    };
  }, [projectId, loadTree]);
  useEffect(() => {
    let timer;
    const onData = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        await refresh();
        if (latest.current.projectId) {
          await loadTree("");
          for (const b of latest.current.buffers) {
            try {
              const disk = await op("file-read", {
                project: b.project,
                path: b.path,
              });
              setBuffers((items) =>
                items.map((item) =>
                  item.path !== b.path
                    ? item
                    : dirty(item)
                      ? { ...item, conflict: disk.digest !== item.digest }
                      : {
                          ...item,
                          ...disk,
                          baseText: disk.text || "",
                          syncVersion: (item.syncVersion || 0) + 1,
                          conflict: false,
                        },
                ),
              );
            } catch {
              setBuffers((items) =>
                items.map((item) =>
                  item.path === b.path ? { ...item, conflict: true } : item,
                ),
              );
            }
          }
        }
      }, 250);
    };
    window.addEventListener("a2app:datachange", onData);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("a2app:datachange", onData);
    };
  }, [refresh, loadTree]);
  useEffect(() => {
    const handler = (e) => {
      if (latest.current.buffers.some(dirty)) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
  useEffect(() => {
    const handler = (e) => {
      if (folderPickerActive.current) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        showPalette();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        openModal("open");
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (latest.current.area === "Settings") return;
        const current = latest.current.buffers.find(
          (b) => b.path === latest.current.active,
        );
        if (current) saveBuffer(current);
      }
      if (e.key === "Escape") {
        setPalette(false);
        setModal(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    if (!workId) return;
    const row = state.work.find((w) => w.id === workId);
    if (
      !row ||
      !["queued", "running", "finalizing", "canceling"].includes(row.status)
    )
      return;
    let stopped = false,
      timer;
    const poll = async () => {
      try {
        await op("work-sync", { work: workId });
        if (!stopped) await refresh();
      } catch (e) {
        if (!stopped) setError(e.message);
      }
      if (!stopped) timer = setTimeout(poll, 2500);
    };
    timer = setTimeout(poll, 1000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [workId, state.work.find((w) => w.id === workId)?.status, refresh]);
  useEffect(() => {
    // Another browser can accept or reject the same retained attempt.
    // Keep the open comparison's authority in sync with the live work record.
    setReview((previous) => {
      if (!previous) return previous;
      const current = state.work.find((w) => w.id === previous.work.id);
      if (!current) return previous;
      return {
        ...previous,
        work: current,
        files: previous.files.map((file) => ({
          ...file,
          applied: (current.applied || []).includes(file.path),
        })),
      };
    });
  }, [state.work]);
  useEffect(() => {
    if (!run || run.status !== "running") return;
    let stopped = false,
      timer;
    const poll = async () => {
      try {
        const r = await op("run-inspect", { run: run.id });
        if (!stopped) {
          setRun(r);
          await refresh();
          if (r.status === "running") timer = setTimeout(poll, 1000);
        }
      } catch (e) {
        if (!stopped) setError(e.message);
      }
    };
    timer = setTimeout(poll, 400);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [run?.id, run?.status, refresh]);
  useEffect(() => {
    setDebug(null);
    if (!projectId) return;
    const key = "studio-debug-" + projectId;
    const id = sessionStorage.getItem(key);
    if (!id) return;
    let canceled = false;
    op("debug-inspect", { id })
      .then((result) => {
        if (!canceled) setDebug(result);
      })
      .catch(() => {
        if (!canceled) sessionStorage.removeItem(key);
      });
    return () => {
      canceled = true;
    };
  }, [projectId]);
  useEffect(() => {
    if (
      debug &&
      ["terminated", "failed"].includes(debug.status) &&
      sessionStorage.getItem("studio-debug-" + projectId) === debug.id
    )
      sessionStorage.removeItem("studio-debug-" + projectId);
  }, [debug?.id, debug?.status, projectId]);
  useEffect(() => {
    if (!debug || ["terminated", "failed"].includes(debug.status)) return;
    let stopped = false,
      timer;
    const poll = async () => {
      try {
        const r = await op("debug-inspect", { id: debug.id });
        if (!stopped) {
          setDebug(r);
          timer = setTimeout(poll, 700);
        }
      } catch (e) {
        if (!stopped) {
          setLanguageError(e.message);
          setDebug((d) => ({ ...d, status: "failed" }));
        }
      }
    };
    timer = setTimeout(poll, 600);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [debug?.id, debug?.status]);
  useEffect(() => {
    if (
      !buffer ||
      buffer.text === null ||
      !project?.trusted ||
      !/\.(jsx?|tsx?|mjs|py)$/.test(buffer.path)
    ) {
      setDiagnostics([]);
      return;
    }
    let canceled = false;
    const timer = setTimeout(async () => {
      try {
        const data = await op("language-query", {
          project: projectId,
          path: buffer.path,
          text: buffer.text,
          action: "diagnostics",
        });
        if (!canceled) {
          setDiagnostics(data.diagnostics || []);
          setLanguageError("");
        }
      } catch (e) {
        if (!canceled) setLanguageError(e.message);
      }
    }, 800);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [projectId, buffer?.path, buffer?.text, project?.trusted]);
  function showPalette() {
    dialogOpener.current = document.activeElement;
    setPalette(true);
  }
  function openModal(kind, initial = {}) {
    if (
      area === "Settings" &&
      ["open", "new", "clone", "file", "config", "preview"].includes(kind)
    )
      setArea("Files");
    if (kind === "work") {
      setAgentOpen(true);
      setArea("Work");
    }
    dialogOpener.current = document.activeElement;
    setFields(initial);
    setModal(kind);
    setError("");
  }
  function changeField(name, value) {
    setFields((f) => ({ ...f, [name]: value }));
  }
  async function browseProjectFolder() {
    if (folderPickerActive.current) return;
    folderPickerActive.current = true;
    setFolderBrowsing(true);
    setError("");
    try {
      const selection = await op(
        "project-browse",
        { initial: fields.path || "" },
        360000,
      );
      if (!selection.canceled) changeField("path", selection.path);
    } catch (err) {
      setError(err.message);
    } finally {
      folderPickerActive.current = false;
      setFolderBrowsing(false);
    }
  }
  async function openFile(path, selection) {
    if (area === "Settings") setArea("Files");
    const position = selection
      ? {
          lineNumber: selection.startLineNumber || selection.lineNumber || 1,
          column: selection.startColumn || selection.column || 1,
        }
      : null;
    try {
      if (latest.current.buffers.some((b) => b.path === path)) {
        if (position)
          setBuffers((items) =>
            items.map((b) =>
              b.path === path
                ? { ...b, cursor: position, reveal: Date.now() }
                : b,
            ),
          );
        setActive(path);
        setView("editor");
        setPalette(false);
        return;
      }
      const data = await op("file-read", {
        project: latest.current.projectId,
        path,
      });
      const b = {
        ...data,
        project: latest.current.projectId,
        text: data.text ?? "",
        baseText: data.text ?? "",
        binary: data.binary,
        large: data.large,
        cursor: position || { lineNumber: 1, column: 1 },
        reveal: Date.now(),
      };
      setBuffers((items) => [...items, b]);
      setActive(path);
      setView("editor");
      setPreview(!!data.image);
      setPalette(false);
      await persistBuffer(b);
    } catch (e) {
      setError(e.message);
    }
  }
  async function saveBuffer(b = buffer, expected = b?.digest) {
    if (!b || b.binary || b.large) return;
    setError("");
    try {
      const value = await op("file-write", {
        project: b.project,
        path: b.path,
        text: b.text,
        expected,
      });
      setBuffers((items) =>
        items.map((item) => {
          if (item.path !== b.path || item.project !== b.project) return item;
          const saved = {
            ...item,
            ...value,
            text: item.text,
            baseText: value.text,
            conflict: false,
          };
          persistBuffer(saved).catch(() =>
            setError("Recovery storage unavailable."),
          );
          return saved;
        }),
      );
      toast("success", b.path + " saved.");
      await loadTree("");
    } catch (e) {
      setError(e.message);
      setBuffers((items) =>
        items.map((item) =>
          item.path === b.path ? { ...item, conflict: true } : item,
        ),
      );
    }
  }
  function edit(text, external = false) {
    setBuffers((items) =>
      items.map((item) => {
        if (item.path !== active) return item;
        const changed = {
          ...item,
          text,
          ...(external ? { syncVersion: (item.syncVersion || 0) + 1 } : {}),
        };
        persistBuffer(changed).catch(() =>
          setError(
            "Recovery storage is unavailable. Save your file before closing this tab.",
          ),
        );
        return changed;
      }),
    );
  }
  function cursor(position) {
    setBuffers((items) =>
      items.map((b) => {
        if (b.path !== active) return b;
        const v = { ...b, cursor: position };
        persistBuffer(v).catch(() => {});
        return v;
      }),
    );
  }
  async function closeFile(b) {
    if (
      dirty(b) &&
      !(await confirm({
        title: "Close " + b.path + " without saving?",
        body: "The unsaved editor changes will be discarded. The disk file stays unchanged.",
        confirmLabel: "Discard editor changes",
        danger: true,
      }))
    )
      return;
    setBuffers((items) => items.filter((v) => v.path !== b.path));
    await forgetBuffer(b.project, b.path);
    if (active === b.path)
      setActive(buffers.find((v) => v.path !== b.path)?.path || "");
  }
  async function compareDisk() {
    try {
      const disk = await op("file-read", {
        project: projectId,
        path: buffer.path,
      });
      setConflict({ path: buffer.path, disk });
      setView("conflict");
    } catch (e) {
      setError(e.message);
    }
  }
  async function toggleFolder(path) {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path);
    else {
      next.add(path);
      await loadTree(path);
    }
    setExpanded(next);
  }
  function treeRows(path = "", level = 0) {
    return (tree[path] || []).map((e) => (
      <div key={e.path}>
        <button
          className={"file-row " + (e.path === active ? "selected" : "")}
          style={{ paddingLeft: 12 + level * 14 }}
          onClick={() =>
            e.kind === "folder"
              ? toggleFolder(e.path)
              : e.kind === "file"
                ? openFile(e.path)
                : setError("Linked folders are excluded from managed editing.")
          }
        >
          <span
            className={"file-" + e.name.split(".").at(-1).toLowerCase()}
            aria-hidden="true"
          >
            {e.kind === "folder" ? (
              <>
                <span>{expanded.has(e.path) ? "▾" : "▸"}</span>
                <Icon name="folder" size={14} />
              </>
            ) : e.kind === "link" ? (
              "↗"
            ) : (
              <Icon name="code" size={14} />
            )}
          </span>
          <span>{e.name}</span>
          {buffers.some((b) => b.path === e.path && dirty(b)) && (
            <span aria-label="Unsaved">●</span>
          )}
        </button>
        {e.kind === "folder" &&
          expanded.has(e.path) &&
          treeRows(e.path, level + 1)}
      </div>
    ));
  }
  async function enableExecution() {
    if (project.trusted) return true;
    if (
      !(await confirm({
        title: "Enable execution in " + project.name + "?",
        body: "Commands, terminals and installed language/debug tools will run with your local account permissions. The project folder is not a sandbox.",
        confirmLabel: "Enable execution",
      }))
    )
      return false;
    return !!(await act(
      "project-trust",
      { project: projectId, enabled: true },
      "Project execution enabled.",
    ));
  }
  async function inspectGit() {
    setArea("Git");
    const g = await act("git-status", { project: projectId });
    if (g) setGit(g);
  }
  async function showReview(id = workId, path) {
    const r = await act("review-changes", {
      work: id,
      ...(path ? { path } : {}),
    });
    if (r) {
      setReview(r);
      setAgentOpen(true);
      setWorkId(id);
      setArea("Files");
      setView("review");
      if (!path)
        setSelectedChanges(
          new Set(r.files.filter((f) => !f.applied).map((f) => f.path)),
        );
      if (r.comparison) setMerged(r.comparison.after.text || "");
    }
  }
  async function acceptChanges() {
    const paths = [...selectedChanges];
    const blocked = buffers.filter((b) => dirty(b) && paths.includes(b.path));
    if (blocked.length) {
      setError(
        "Save or close these unsaved buffers before applying agent changes: " +
          blocked.map((b) => b.path).join(", "),
      );
      return;
    }
    const result = await act("review-apply", { work: workId, paths });
    if (result?.conflicts?.length) {
      setError(
        "Destination changes need an explicit resolution: " +
          result.conflicts.join(", "),
      );
      await showReview(workId, result.conflicts[0]);
    } else if (result) {
      toast(
        "success",
        `${result.applied.length} file(s) applied with recovery checkpoints.`,
      );
      await showReview(workId);
      await loadTree("");
    }
  }
  async function startRun(config) {
    const value = await act("run-start", { config });
    if (value) {
      setRun(value);
      setBottom("Runs");
      setBottomOpen(true);
    }
  }
  async function startDebug() {
    if (!buffer) return;
    if (dirty(buffer)) {
      setError("Save this buffer before debugging its disk version.");
      return;
    }
    const kind = buffer.path.endsWith(".py") ? "python" : "javascript",
      value = await act("debug-start", {
        project: projectId,
        path: buffer.path,
        kind,
        breakpoints: breakpoints[buffer.path] || [],
      });
    if (value) {
      sessionStorage.setItem("studio-debug-" + projectId, value.id);
      setDebug(value);
      setBottom("Debugger");
      setBottomOpen(true);
    }
  }
  function toggleBreakpoint(line) {
    setBreakpoints((previous) => {
      const current = previous[active] || [];
      return {
        ...previous,
        [active]: current.includes(line)
          ? current.filter((v) => v !== line)
          : [...current, line],
      };
    });
  }
  async function submitModal(e) {
    e.preventDefault();
    let value;
    if (modal === "open")
      value = await act("project-open", { path: fields.path });
    if (modal === "new")
      value = await act("project-create", {
        path: fields.path,
        kind: fields.kind || "empty",
      });
    if (modal === "clone")
      value = await act("project-clone", {
        path: fields.path,
        url: fields.url,
      });
    if (["open", "new", "clone"].includes(modal) && value) {
      setProjectId(value.id);
      setModal(null);
      return;
    }
    if (modal === "file") {
      value = await act("file-write", {
        project: projectId,
        path: fields.path,
        text: "",
        create: true,
      });
      if (value) await openFile(fields.path);
    }
    if (modal === "folder")
      value = await act("folder-create", {
        project: projectId,
        path: fields.path,
      });
    if (modal === "move") {
      value = await act("file-move", {
        project: projectId,
        path: fields.path,
        to: fields.to,
      });
      if (value) {
        const rename = (path) =>
          path === fields.path || path.startsWith(fields.path + "/")
            ? fields.to + path.slice(fields.path.length)
            : path;
        setBuffers((items) =>
          items.map((b) => {
            const path = rename(b.path);
            if (path === b.path) return b;
            const moved = { ...b, path };
            forgetBuffer(b.project, b.path)
              .then(() => persistBuffer(moved))
              .catch(() => {});
            return moved;
          }),
        );
        setActive((path) => rename(path));
      }
    }
    if (modal === "config")
      value = await act("config-save", {
        project: projectId,
        ...fields,
        name: fields.name,
        command: fields.command,
        cwd: fields.cwd || "",
        kind: fields.kind || "custom",
        ...(fields.artifactPaths?.length
          ? {
              artifactPaths: (Array.isArray(fields.artifactPaths)
                ? fields.artifactPaths.join(",")
                : fields.artifactPaths
              )
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean),
            }
          : {}),
        envNames: (Array.isArray(fields.envNames)
          ? fields.envNames.join(",")
          : fields.envNames || ""
        )
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
      });
    if (modal === "work") {
      value = await act("work-create", {
        project: projectId,
        title: fields.title,
        goal: fields.goal,
        criteria: fields.criteria,
        context: fields.context || "",
        mode: fields.mode || "standalone",
        effort: fields.effort || "medium",
      });
      if (value) setWorkId(value.id);
    }
    if (modal === "preview") {
      try {
        const u = new URL(fields.url);
        if (
          u.protocol !== "http:" ||
          !["localhost", "127.0.0.1"].includes(u.hostname) ||
          u.origin === location.origin
        )
          throw new Error(
            "Use a separate loopback HTTP port for the project preview.",
          );
        window.open(u.href, "_blank", "noopener,noreferrer");
        value = true;
      } catch (e) {
        setError(e.message);
      }
    }
    if (value) {
      setModal(null);
      await loadTree("");
    }
  }
  const projectConfigs = state.configs.filter((c) => c.project === projectId),
    projectWork = state.work.filter((w) => w.project === projectId),
    projectRuns = state.runs.filter((r) => r.project === projectId);
  return (
    <div className="workspace-shell" data-theme={resolvedTheme}>
      <header className="workspace-header">
        <a
          className="workspace-brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setArea("Files");
            setProjectId("");
          }}
        >
          <Icon name="code" size={17} />
          <span>Development Studio</span>
        </a>
        {project && <span className="header-project-name">{project.name}</span>}
        <button
          className="command-search"
          onClick={() => setPalette(true)}
          aria-label="Open command palette"
        >
          <Icon name="search" size={14} />
          <span>Files and commands</span> <kbd>Ctrl P</kbd>
        </button>
        <div className="header-actions">
          <button onClick={() => openModal("open")}>Open folder</button>
          {project && (
            <button
              className="agent-toggle"
              aria-label="Toggle agent work"
              aria-expanded={agentOpen}
              onClick={() => {
                setAgentOpen(!agentOpen);
                if (agentOpen && area === "Work") setArea("Files");
              }}
            >
              <Icon name="work" /> Agent work
            </button>
          )}
          <button onClick={openSettings} aria-label="Open Settings">
            <Icon name="settings" size={14} /> Settings
          </button>
        </div>
      </header>
      {error && !modal && (
        <div className="workspace-alert" role="alert">
          <span>{error}</span>
          {error.includes("Settings") && (
            <button
              onClick={() => {
                openSettings();
                setError("");
              }}
            >
              Open Settings
            </button>
          )}
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      {area === "Settings" && (
        <StudioSettings
          preferences={state.preferences}
          project={project}
          connection={connection}
          tools={tools}
          busy={busy}
          onBack={() => setArea(settingsReturnArea.current)}
          onPreferences={(args, success) =>
            act("preferences-save", args, success)
          }
          onConnect={toggleStandaloneConnection}
          onConfigureAgent={async (args) => {
            const value = await act("connector-configure", args);
            if (value) setConnection(await op("connector-control", { action: "status" }));
            return value;
          }}
          onAgentInfo={() => act("agent-connection-info")}
          onTools={async () => setTools(await act("tools-status"))}
          onCraftbot={(url) =>
            act("craftbot-configure", { url }, "CraftBot URL saved.")
          }
          onExecution={enableExecution}
          onCheckpoints={async () => {
            const result = await act("checkpoint-list", { project: projectId });
            if (result) {
              setFields({ items: result.items });
              setModal("checkpoints");
            }
          }}
        />
      )}
      {!project ? (
        <ProjectStart
          hidden={area === "Settings"}
          projects={state.projects}
          onOpen={() => openModal("open")}
          onNew={() => openModal("new")}
          onClone={() => openModal("clone")}
          onSelect={setProjectId}
          onCommands={showPalette}
          onSettings={openSettings}
        />
      ) : (
        <div
          className={"workspace-body" + (agentOpen ? " has-agent-panel" : "")}
          hidden={area === "Settings"}
        >
          <nav className="activity-bar" aria-label="Workspace tools">
            {[
              ["Files", "files"],
              ["Search", "search"],
              ["Git", "branch"],
              ["Work", "work"],
              ["Settings", "settings"],
            ].map(([name, icon]) => (
              <button
                key={name}
                className={area === name ? "active" : ""}
                onClick={() => {
                  if (name === "Settings") {
                    openSettings();
                    return;
                  }
                  if (name === "Work") setAgentOpen(true);
                  else if (matchMedia("(max-width: 1000px)").matches)
                    setAgentOpen(false);
                  name === "Git" ? inspectGit() : setArea(name);
                }}
                title={name}
                aria-label={name}
                aria-current={area === name ? "page" : undefined}
              >
                <span aria-hidden="true">
                  <Icon name={icon} size={19} />
                </span>
                <small>{name}</small>
              </button>
            ))}
          </nav>
          <aside className="workspace-sidebar">
            <div className="project-selector">
              <label className="sr-only" htmlFor="project-picker">
                Current project
              </label>
              <select
                id="project-picker"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                {state.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <span className="project-profile">
                {project.profile} ·{" "}
                {project.trusted ? "execution enabled" : "inspection mode"}
              </span>
            </div>
            {area === "Files" && (
              <>
                <div className="ws-section-title">
                  <h2>Explorer</h2>
                  <div>
                    <button
                      aria-label="New file"
                      title="New file"
                      onClick={() => openModal("file")}
                    >
                      <Icon name="plus" size={14} />
                    </button>
                    <button
                      aria-label="New folder"
                      title="New folder"
                      onClick={() => openModal("folder")}
                    >
                      <Icon name="folder" size={14} />
                    </button>
                    <button
                      aria-label="Refresh files"
                      onClick={() => loadTree("")}
                    >
                      <Icon name="refresh" size={14} />
                    </button>
                  </div>
                </div>
                <div className="file-tree">
                  {treeRows()}
                  {treePending.has("") && !tree[""] && (
                    <p className="tool-panel-hint" role="status">
                      Loading files…
                    </p>
                  )}
                  {treeFailures[""] && (
                    <p className="tool-panel-hint">
                      Could not load files. Use Refresh files to retry.
                    </p>
                  )}
                  {tree[""] && !tree[""].length && !treePending.has("") && (
                    <div className="ws-empty compact">
                      <p>No source files yet.</p>
                      <button onClick={() => openModal("file")}>
                        Create a file
                      </button>
                    </div>
                  )}
                </div>
                <div className="sidebar-foot">
                  <span>{project.root}</span>
                  <button
                    onClick={() => openModal("move", { path: active })}
                    disabled={!active}
                  >
                    Rename / move
                  </button>
                  <button
                    onClick={async () => {
                      if (
                        active &&
                        (!dirty(buffer) ||
                          (await confirm({
                            title: "Discard unsaved editor text?",
                            body: "Save the file first to keep your unsaved edits. Only disk contents are recoverable after deletion.",
                            confirmLabel: "Discard unsaved text",
                            danger: true,
                          }))) &&
                        (await confirm({
                          title: "Move " + active + " to recovery?",
                          body: "The file will be removed from the project. Its previous contents remain in Checkpoints.",
                          confirmLabel: "Move to recovery",
                          danger: true,
                        }))
                      ) {
                        const result = await act("file-trash", {
                          project: projectId,
                          path: active,
                        });
                        if (result) {
                          setBuffers((items) =>
                            items.filter((v) => v.path !== active),
                          );
                          await forgetBuffer(projectId, active);
                          setActive(
                            buffers.find((v) => v.path !== active)?.path || "",
                          );
                          await loadTree("");
                        }
                      }
                    }}
                    disabled={!active}
                  >
                    Delete file
                  </button>
                </div>
              </>
            )}
            {area === "Search" && (
              <SearchSidebar
                key={projectId}
                query={searchText}
                onQuery={setSearchText}
                result={searchResult}
                onResult={setSearchResult}
                replacement={replacement}
                onReplacement={setReplacement}
                busy={busy}
                onSearch={() =>
                  act("project-search", {
                    project: projectId,
                    query: searchText,
                  })
                }
                onPreview={async () => {
                  const r = await act("replace-preview", {
                    project: projectId,
                    query: searchText,
                    replacement,
                  });
                  if (r) {
                    setReplaceSpec({ query: searchText, replacement });
                    setReplaceFiles(r.files);
                    setReplaceSelected(new Set(r.files.map((f) => f.path)));
                    setView("replace");
                  }
                }}
                onOpen={openFile}
              />
            )}
            {area === "Git" && (
              <SourceControlSidebar
                key={projectId}
                git={git}
                busy={busy}
                trusted={project.trusted}
                message={commitMessage}
                onMessage={setCommitMessage}
                onRefresh={inspectGit}
                onEnable={enableExecution}
                onInitialize={() =>
                  act(
                    "git-init",
                    { project: projectId },
                    "Git initialized.",
                  ).then(inspectGit)
                }
                onCommit={() =>
                  act(
                    "git-commit",
                    { project: projectId, message: commitMessage },
                    "Staged changes committed.",
                  ).then(inspectGit)
                }
                onRemote={async (action) => {
                  if (
                    action !== "push" ||
                    (await confirm({
                      title: "Push this repository?",
                      body: "Git will publish committed changes to its configured origin remote.",
                      confirmLabel: "Push commits",
                    }))
                  )
                    await act(
                      "git-remote",
                      { project: projectId, action },
                      "Git " + action + " completed.",
                    );
                }}
                onHistory={async () => {
                  const d = await act("git-diff", { project: projectId });
                  if (d) {
                    setGitDiff(d);
                    setView("git");
                  }
                }}
                onDiff={async (path, staged) => {
                  const d = await act("git-diff", {
                    project: projectId,
                    path,
                    staged,
                  });
                  if (d) {
                    setGitDiff(d);
                    setView("git");
                  }
                }}
                onStage={(path, unstage) =>
                  act("git-stage", { project: projectId, path, unstage }).then(
                    inspectGit,
                  )
                }
              />
            )}
            {area === "Work" && (
              <>
                <div className="ws-section-title">
                  <h2>Development work</h2>
                  <button
                    aria-label="New work item"
                    onClick={() => openModal("work")}
                  >
                    ＋
                  </button>
                </div>
                {projectWork.map((w) => (
                  <button
                    className={
                      "work-list-item " + (workId === w.id ? "selected" : "")
                    }
                    key={w.id}
                    onClick={() => {
                      setWorkId(w.id);
                      if (["ready", "applied", "rejected"].includes(w.status))
                        showReview(w.id);
                    }}
                  >
                    <strong>{w.title}</strong>
                    <span>
                      {w.mode}
                      <Status status={w.status} />
                    </span>
                  </button>
                ))}
                {!projectWork.length && (
                  <div className="ws-empty compact">
                    <h3>No work items</h3>
                    <p>
                      Define a goal and acceptance criteria. The agent works in
                      an isolated copy.
                    </p>
                    <button onClick={() => openModal("work")}>
                      Create work item
                    </button>
                  </div>
                )}
              </>
            )}
          </aside>
          <main className="workspace-main">
            {!project.trusted && (
              <div className="trust-strip">
                <span>
                  <strong>Inspection mode.</strong> Editing is available.
                  Commands and language tools are stopped.
                </span>
                <button onClick={enableExecution}>Enable execution</button>
              </div>
            )}
            <div className="editor-tabs" role="tablist" aria-label="Open files">
              {buffers.map((b) => (
                <div
                  className={
                    "editor-tab " +
                    (active === b.path && view === "editor" ? "active" : "")
                  }
                  key={b.path}
                >
                  <button
                    role="tab"
                    aria-selected={active === b.path && view === "editor"}
                    onClick={() => {
                      setActive(b.path);
                      setView("editor");
                    }}
                  >
                    {b.path.split("/").at(-1)}
                    {dirty(b) && <span aria-label="unsaved"> ●</span>}
                  </button>
                  <button
                    aria-label={"Close " + b.path}
                    onClick={() => closeFile(b)}
                  >
                    ×
                  </button>
                </div>
              ))}
              {["review", "git", "replace", "conflict"].includes(view) && (
                <div className="editor-tab active">
                  <button role="tab" aria-selected="true">
                    {view === "review"
                      ? "Change review"
                      : view === "git"
                        ? "Git diff & history"
                        : view === "replace"
                          ? "Review replacements"
                          : "Resolve disk conflict"}
                  </button>
                  <button
                    aria-label="Close comparison"
                    onClick={() => setView("editor")}
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
            <section
              className="editor-area"
              aria-label="Development workbench"
              data-dirty={buffers.some(dirty) ? "true" : undefined}
            >
              {view === "artifact" && artifact && (
                <div className="text-preview">
                  <div className="comparison-heading">
                    <h2>{artifact.path}</h2>
                    <p>
                      Generated output from {artifact.run} · {artifact.size}{" "}
                      bytes · SHA-256 {artifact.digest}
                    </p>
                    <button onClick={() => setView("editor")}>
                      Close artifact
                    </button>
                  </div>
                  {artifact.image ? (
                    <img src={artifact.image} alt={artifact.path} />
                  ) : artifact.text !== null ? (
                    <pre>{artifact.text}</pre>
                  ) : (
                    <p>
                      Binary or size-limited output. The file remains on disk in
                      the run's working copy.
                    </p>
                  )}
                </div>
              )}
              {view === "editor" &&
                (buffer ? (
                  <>
                    <div className="editor-toolbar">
                      <span className="breadcrumb">
                        {project.name} / {buffer.path}
                      </span>
                      <div>
                        <button
                          disabled={!dirty(buffer) || !!busy}
                          onClick={() => saveBuffer()}
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setSplit(!split)}
                          aria-pressed={split}
                        >
                          Split
                        </button>
                        <button
                          onClick={() => setPreview(!preview)}
                          aria-pressed={preview}
                        >
                          Preview
                        </button>
                        <button
                          disabled={!!busy || !project.trusted || buffer.binary}
                          onClick={async () => {
                            const requested = {
                              project: projectId,
                              path: buffer.path,
                              text: buffer.text,
                            };
                            const r = await act("format-text", {
                              project: projectId,
                              path: buffer.path,
                              text: buffer.text,
                            });
                            if (r) {
                              const current = latest.current.buffers.find(
                                (b) =>
                                  b.project === requested.project &&
                                  b.path === requested.path,
                              );
                              if (
                                latest.current.projectId !==
                                  requested.project ||
                                latest.current.active !== requested.path ||
                                current?.text !== requested.text
                              ) {
                                toast(
                                  "info",
                                  "The file changed while formatting. Your edits were kept; run Format again.",
                                );
                                return;
                              }
                              edit(r.text, true);
                            }
                          }}
                        >
                          Format
                        </button>
                        <button
                          disabled={
                            !project.trusted ||
                            !/\.(js|mjs|cjs|py)$/.test(buffer.path)
                          }
                          onClick={startDebug}
                        >
                          Debug
                        </button>
                      </div>
                    </div>
                    {buffer.conflict && (
                      <div className="conflict-strip" role="status">
                        The disk file changed. Your unsaved text is preserved.
                        <button onClick={compareDisk}>Compare disk</button>
                      </div>
                    )}
                    {buffer.large ? (
                      <div className="ws-empty">
                        <h2>Large file</h2>
                        <p>
                          This file is {Math.round(buffer.size / 1024)} KiB.
                          In-editor editing is limited to 2 MiB; use a project
                          terminal for larger files.
                        </p>
                      </div>
                    ) : buffer.binary ? (
                      <div className="asset-preview">
                        {buffer.image ? (
                          <img src={buffer.image} alt={buffer.path} />
                        ) : (
                          <p>
                            {buffer.encoding === "Unsupported encoding"
                              ? "Unsupported text encoding; convert a copy to UTF-8 before editing"
                              : "Binary file"}{" "}
                            · {buffer.size} bytes ·{" "}
                            {buffer.digest?.slice(0, 12)}
                          </p>
                        )}
                      </div>
                    ) : preview && buffer.path.endsWith(".md") ? (
                      <Suspense
                        fallback={
                          <p className="tool-panel-hint" role="status">
                            Loading preview…
                          </p>
                        }
                      >
                        <Markdown
                          text={buffer.text}
                          path={buffer.path}
                          onOpen={openFile}
                        />
                      </Suspense>
                    ) : preview ? (
                      <div className="text-preview">
                        <pre>{buffer.text}</pre>
                      </div>
                    ) : (
                      <Suspense
                        fallback={
                          <div className="editor-loading" role="status">
                            Loading editor…
                          </div>
                        }
                      >
                        <Editor
                          buffer={buffer}
                          onChange={edit}
                          onSave={() => saveBuffer()}
                          onCursor={cursor}
                          onSelection={setSelection}
                          theme={resolvedTheme}
                          split={split}
                          onOpen={openFile}
                          query={(args) => op("language-query", args)}
                          trusted={project.trusted}
                          diagnostics={diagnostics}
                          onBreakpoint={toggleBreakpoint}
                          breakpoints={breakpoints[active] || []}
                        />
                      </Suspense>
                    )}
                  </>
                ) : (
                  <div className="workbench-empty">
                    <h2>No file open</h2>
                    <p>Select a file in Explorer or use Quick Open.</p>
                    <div>
                      <button onClick={() => setPalette(true)}>
                        Quick Open <kbd>Ctrl P</kbd>
                      </button>
                      <button onClick={() => openModal("file")}>
                        New file
                      </button>
                    </div>
                    <dl>
                      <div>
                        <dt>Save</dt>
                        <dd>Ctrl S</dd>
                      </div>
                      <div>
                        <dt>Open folder</dt>
                        <dd>Ctrl O</dd>
                      </div>
                      <div>
                        <dt>Find in file</dt>
                        <dd>Ctrl F</dd>
                      </div>
                    </dl>
                  </div>
                ))}
              {view === "conflict" && conflict && buffer && (
                <div className="comparison-pane">
                  <div className="comparison-heading">
                    <h2>{conflict.path}: disk → editor</h2>
                    <p>The right side is your recovered/unsaved editor text.</p>
                    <div>
                      <button
                        onClick={async () => {
                          if (
                            await confirm({
                              title: "Replace the current disk version?",
                              body: "Your editor text will replace the version shown on the left. A later disk change will still be rejected.",
                              confirmLabel: "Save editor version",
                            })
                          ) {
                            await saveBuffer(buffer, conflict.disk.digest);
                            setView("editor");
                          }
                        }}
                      >
                        Save editor over compared disk
                      </button>
                      <button
                        onClick={async () => {
                          if (
                            await confirm({
                              title: "Discard unsaved editor changes?",
                              body: "The current disk version will replace this editor buffer.",
                              confirmLabel: "Reload disk",
                              danger: true,
                            })
                          ) {
                            const b = {
                              ...buffer,
                              ...conflict.disk,
                              baseText: conflict.disk.text,
                              syncVersion: (buffer.syncVersion || 0) + 1,
                              conflict: false,
                            };
                            setBuffers((items) =>
                              items.map((v) => (v.path === b.path ? b : v)),
                            );
                            await persistBuffer(b);
                            setView("editor");
                          }
                        }}
                      >
                        Reload disk
                      </button>
                    </div>
                  </div>
                  <Suspense fallback={<p>Loading comparison…</p>}>
                    <Diff
                      before={conflict.disk.text}
                      after={buffer.text}
                      path={buffer.path}
                      theme={resolvedTheme}
                    />
                  </Suspense>
                </div>
              )}
              {view === "git" && (
                <div className="comparison-pane">
                  <div className="comparison-heading">
                    <h2>Git changes & history</h2>
                    <p>
                      Working files remain on disk. Commit operates on staged
                      changes.
                    </p>
                  </div>
                  <pre className="git-diff">
                    {gitDiff?.diff ||
                      "No tracked diff for this selection. New untracked files can be opened in the explorer."}
                  </pre>
                  <div className="comparison-heading">
                    <h3>Recent commits</h3>
                    <pre>{gitDiff?.history || "No commits yet."}</pre>
                  </div>
                </div>
              )}
              {view === "replace" && (
                <div className="comparison-pane">
                  <div className="comparison-heading">
                    <h2>Review replacements</h2>
                    <p>
                      {JSON.stringify(replaceSpec?.query)} →{" "}
                      {JSON.stringify(replaceSpec?.replacement)}. Files changed
                      since preview are refused.
                    </p>
                    <button
                      className="ws-primary"
                      disabled={!replaceSelected.size || !!busy}
                      onClick={async () => {
                        const targets = replaceFiles
                          .filter((f) => replaceSelected.has(f.path))
                          .map((f) => f.path);
                        if (
                          latest.current.buffers.some(
                            (b) => targets.includes(b.path) && dirty(b),
                          )
                        ) {
                          setError(
                            "Save or close unsaved files before applying replacements.",
                          );
                          return;
                        }
                        const r = await act(
                          "replace-apply",
                          {
                            project: projectId,
                            query: replaceSpec.query,
                            replacement: replaceSpec.replacement,
                            files: replaceFiles
                              .filter((f) => replaceSelected.has(f.path))
                              .map((f) => ({
                                path: f.path,
                                expected: f.expected,
                              })),
                          },
                          "Selected replacements saved with checkpoints.",
                        );
                        if (r) {
                          const documents = await Promise.allSettled(
                            r.changed.map((path) =>
                              op("file-read", { project: projectId, path }),
                            ),
                          );
                          if (latest.current.projectId !== projectId) return;
                          const changed = new Map(
                            documents
                              .filter((v) => v.status === "fulfilled")
                              .map((v) => [v.value.path, v.value]),
                          );
                          setBuffers((previous) =>
                            previous.map((b) => {
                              const doc = changed.get(b.path);
                              if (!doc) return b;
                              if (dirty(b)) return { ...b, conflict: true };
                              const updated = {
                                ...b,
                                ...doc,
                                baseText: doc.text,
                                syncVersion: (b.syncVersion || 0) + 1,
                                conflict: false,
                              };
                              persistBuffer(updated).catch(() => {});
                              return updated;
                            }),
                          );
                          const results = await op("project-search", {
                            project: projectId,
                            query: searchText,
                          }).catch(() => null);
                          if (latest.current.projectId !== projectId) return;
                          setSearchResult(
                            results ? { ...results, query: searchText } : null,
                          );
                          setReplaceFiles(null);
                          setView("editor");
                        }
                      }}
                    >
                      Apply selected replacements
                    </button>
                  </div>
                  {replaceFiles?.map((f) => (
                    <details key={f.path}>
                      <summary>
                        <label className="check-label">
                          <input
                            type="checkbox"
                            checked={replaceSelected.has(f.path)}
                            onChange={(e) =>
                              setReplaceSelected((v) => {
                                const n = new Set(v);
                                e.target.checked
                                  ? n.add(f.path)
                                  : n.delete(f.path);
                                return n;
                              })
                            }
                          />
                          {f.path} · {f.count}{" "}
                          {f.count === 1 ? "occurrence" : "occurrences"}
                        </label>
                      </summary>
                      <div className="replacement-columns">
                        <pre>{f.before}</pre>
                        <pre>{f.after}</pre>
                      </div>
                    </details>
                  ))}
                </div>
              )}
              {view === "review" && review && (
                <div className="review-pane">
                  <div className="comparison-heading">
                    <div className="inline-actions">
                      <h2>{review.work.title}</h2>
                      <Status status={review.work.status} />
                    </div>
                    <details className="review-report">
                      <summary>Agent report</summary>
                      <p>
                        {review.work.summary ||
                          "Inspect the actual changes and execution evidence."}
                      </p>
                    </details>
                    <details>
                      <summary>Acceptance criteria</summary>
                      <p>{review.work.criteria}</p>
                    </details>
                    <div className="review-checks">
                      {projectRuns
                        .filter((r) => r.work === workId)
                        .map((r) => (
                          <button
                            key={r.id}
                            onClick={async () => {
                              setRun(await act("run-inspect", { run: r.id }));
                              setBottom("Runs");
                              setBottomOpen(true);
                            }}
                          >
                            <Status status={r.status} />
                            {r.name}
                            {r.started
                              ? " · " + new Date(r.started).toLocaleString()
                              : ""}
                            {" · " + r.id.slice(0, 6)}
                            {r.stale ? " · out of date" : ""}
                          </button>
                        ))}
                    </div>
                    <div className="inline-actions">
                      <button
                        className="ws-primary"
                        disabled={
                          review.work.status !== "ready" ||
                          !selectedChanges.size ||
                          !!busy
                        }
                        onClick={acceptChanges}
                      >
                        Apply selected files ({selectedChanges.size})
                      </button>
                      <button
                        disabled={review.work.status !== "ready" || !!busy}
                        onClick={async () => {
                          if (
                            await confirm({
                              title: "Reject this change set?",
                              body: "Main project files stay unchanged. The isolated source and attempt history remain available.",
                              confirmLabel: "Reject changes",
                            })
                          ) {
                            await act("review-reject", { work: workId });
                            await showReview(workId);
                          }
                        }}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                  <div className="review-file-list">
                    {review.files.map((f) => (
                      <div key={f.path}>
                        <label className="check-label">
                          <input
                            type="checkbox"
                            aria-label={"Accept " + f.path}
                            disabled={f.applied}
                            checked={selectedChanges.has(f.path) && !f.applied}
                            onChange={(e) =>
                              setSelectedChanges((v) => {
                                const n = new Set(v);
                                e.target.checked
                                  ? n.add(f.path)
                                  : n.delete(f.path);
                                return n;
                              })
                            }
                          />
                        </label>
                        <button onClick={() => showReview(workId, f.path)}>
                          {f.path}
                          <small>
                            {f.applied ? "applied" : f.status}
                            {f.after?.binary || f.before?.binary
                              ? " · binary"
                              : ""}
                          </small>
                        </button>
                      </div>
                    ))}
                    {!review.files.length && (
                      <p className="ws-empty compact">
                        No source differences in this attempt.
                      </p>
                    )}
                  </div>
                  {review.comparison && (
                    <>
                      <div className="diff-caption">
                        {review.comparison.conflict
                          ? "Destination changed: current project → agent version"
                          : "Recorded baseline → isolated agent version"}
                      </div>
                      {limitedComparison(review.comparison) ? (
                        <p className="ws-empty">
                          Binary or size-limited content differs. Acceptance
                          copies the actual bytes after checking the destination
                          hash.
                        </p>
                      ) : (
                        <Suspense fallback={<p>Loading diff…</p>}>
                          <Diff
                            before={
                              review.comparison.conflict
                                ? review.comparison.destination.text
                                : review.comparison.before.text
                            }
                            after={review.comparison.after.text}
                            path={review.comparison.path}
                            theme={resolvedTheme}
                          />
                        </Suspense>
                      )}
                      {review.comparison.conflict &&
                        review.work.status === "ready" && (
                          <div className="conflict-resolution">
                            <h3>Resolve {review.comparison.path}</h3>
                            <p>
                              Your project changed after this attempt began.
                              Choose explicitly; unsaved editor buffers must be
                              saved first.
                            </p>
                            {!limitedComparison(review.comparison) && (
                              <label>
                                Merged result
                                <textarea
                                  value={merged}
                                  onChange={(e) => setMerged(e.target.value)}
                                  rows={8}
                                />
                              </label>
                            )}
                            <div className="inline-actions">
                              <button
                                hidden={limitedComparison(review.comparison)}
                                disabled={buffers.some(
                                  (b) =>
                                    b.path === review.comparison.path &&
                                    dirty(b),
                                )}
                                onClick={async () => {
                                  const r = await act("review-resolve", {
                                    work: workId,
                                    path: review.comparison.path,
                                    text: merged,
                                    expected:
                                      review.comparison.destination.digest,
                                  });
                                  if (r) showReview(workId);
                                }}
                              >
                                Save merged result
                              </button>
                              <button
                                disabled={buffers.some(
                                  (b) =>
                                    b.path === review.comparison.path &&
                                    dirty(b),
                                )}
                                onClick={async () => {
                                  const r = await act("review-resolve", {
                                    work: workId,
                                    path: review.comparison.path,
                                    useAgent: true,
                                    expected:
                                      review.comparison.destination.digest,
                                  });
                                  if (r) showReview(workId);
                                }}
                              >
                                Use agent file
                              </button>
                              <button
                                onClick={async () => {
                                  await act("review-resolve", {
                                    work: workId,
                                    path: review.comparison.path,
                                    text: "",
                                    keepMine: true,
                                  });
                                  showReview(workId);
                                }}
                              >
                                Keep my project version
                              </button>
                            </div>
                          </div>
                        )}
                    </>
                  )}
                </div>
              )}
            </section>
            <div className={"bottom-panel " + (!bottomOpen ? "collapsed" : "")}>
              <div
                className="bottom-tabs"
                role="tablist"
                aria-label="Execution panels"
              >
                {["Runs", "Terminal", "Problems", "Debugger"].map((name) => (
                  <button
                    key={name}
                    role="tab"
                    aria-selected={bottom === name && bottomOpen}
                    className={bottom === name ? "active" : ""}
                    onClick={() => {
                      setBottom(name);
                      setBottomOpen(true);
                    }}
                  >
                    {name}
                    {name === "Problems" && diagnostics.length
                      ? ` (${diagnostics.length})`
                      : ""}
                  </button>
                ))}
                <button
                  className="collapse-bottom"
                  onClick={() => setBottomOpen(!bottomOpen)}
                  aria-label={
                    bottomOpen
                      ? "Collapse execution panel"
                      : "Expand execution panel"
                  }
                >
                  {bottomOpen ? "⌄" : "⌃"}
                </button>
              </div>
              {bottomOpen && bottom !== "Terminal" && (
                <div className="bottom-content">
                  {bottom === "Runs" && (
                    <div className="runs-panel">
                      <div className="run-config-list">
                        <div className="ws-section-title">
                          <h3>Commands</h3>
                          <button
                            aria-label="Add run configuration"
                            onClick={() => openModal("config")}
                          >
                            ＋
                          </button>
                        </div>
                        {projectConfigs.map((c) => (
                          <div key={c.id}>
                            <button
                              disabled={!project.trusted || !!busy}
                              onClick={() => startRun(c.id)}
                              aria-label={"Run " + c.name}
                            >
                              ▷
                            </button>
                            <button onClick={() => openModal("config", c)}>
                              <strong>{c.name}</strong>
                              <small>{c.command}</small>
                            </button>
                          </div>
                        ))}
                        <details>
                          <summary>Previous runs</summary>
                          {projectRuns.map((r) => (
                            <button
                              key={r.id}
                              onClick={async () =>
                                setRun(await act("run-inspect", { run: r.id }))
                              }
                            >
                              {r.name} · {humanStatus(r.status)}
                            </button>
                          ))}
                        </details>
                      </div>
                      <div className="run-output">
                        {run ? (
                          <>
                            <div className="output-heading">
                              <strong>{run.name}</strong>
                              <Status status={run.status} />
                              <span>exit {run.exitCode ?? "—"}</span>
                              {run.stale && (
                                <span className="stale-label">
                                  Out of date: source changed
                                </span>
                              )}
                              {run.status === "running" && (
                                <button
                                  onClick={async () =>
                                    setRun(
                                      await act("run-stop", { run: run.id }),
                                    )
                                  }
                                >
                                  Stop process tree
                                </button>
                              )}
                              <button
                                onClick={async () =>
                                  setRun(
                                    await act("run-inspect", { run: run.id }),
                                  )
                                }
                              >
                                Refresh result
                              </button>
                            </div>
                            <div className="inline-actions">
                              {[
                                ...new Set(
                                  (run.output || "").match(
                                    /http:\/\/(?:127\.0\.0\.1|localhost):\d+[^\s<>"']*/g,
                                  ) || [],
                                ),
                              ]
                                .filter((url) => {
                                  try {
                                    return (
                                      new URL(url).origin !== location.origin
                                    );
                                  } catch {
                                    return false;
                                  }
                                })
                                .map((url) => (
                                  <button
                                    key={url}
                                    onClick={() =>
                                      window.open(
                                        url,
                                        "_blank",
                                        "noopener,noreferrer",
                                      )
                                    }
                                  >
                                    Open preview: {url}
                                  </button>
                                ))}
                            </div>
                            {run.artifacts?.length > 0 && (
                              <details>
                                <summary>
                                  Generated artifacts ({run.artifacts.length})
                                </summary>
                                {run.artifacts.map((a) => (
                                  <button
                                    key={a.path}
                                    onClick={async () => {
                                      const d = await act("run-artifact", {
                                        run: run.id,
                                        path: a.path,
                                      });
                                      if (d) {
                                        setArtifact({ ...d, run: run.name });
                                        setView("artifact");
                                      }
                                    }}
                                  >
                                    {a.path} · {a.size} bytes
                                    {a.updatedDuringRun
                                      ? ""
                                      : " · existing output"}
                                  </button>
                                ))}
                                {run.artifactsTruncated && (
                                  <p>Showing the first 100 artifacts.</p>
                                )}
                              </details>
                            )}
                            <pre>
                              {run.output || "Waiting for command output…"}
                            </pre>
                          </>
                        ) : (
                          <div className="ws-empty compact">
                            <h3>No run selected</h3>
                            <p>
                              Choose a saved command or add install, build,
                              test, lint or custom commands. Nothing runs just
                              because a project was opened.
                            </p>
                            <button onClick={() => openModal("preview")}>
                              Open web preview
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {bottom === "Problems" && (
                    <div className="problems-panel">
                      {languageError && <p role="status">{languageError}</p>}
                      {diagnostics.length ? (
                        diagnostics.map((d, i) => (
                          <button
                            key={i}
                            onClick={() => {
                              setView("editor");
                              toast(
                                "info",
                                `Line ${d.range.start.line + 1}: ${d.message}`,
                              );
                            }}
                          >
                            <span>
                              {d.severity === 1 ? "Error" : "Warning"}
                            </span>
                            <strong>
                              {active}:{d.range.start.line + 1}
                            </strong>
                            {d.message}
                          </button>
                        ))
                      ) : (
                        <div className="ws-empty compact">
                          <p>
                            {project.trusted
                              ? "No published diagnostics for the current file."
                              : "Enable project execution to start language tools."}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                  {bottom === "Debugger" && (
                    <div className="debug-panel">
                      {debug ? (
                        <>
                          <div className="debug-toolbar">
                            <Status status={debug.status} />
                            {[
                              ["continue", "Continue"],
                              ["next", "Step over"],
                              ["stepIn", "Step in"],
                              ["stepOut", "Step out"],
                              ["pause", "Pause"],
                              ["stop", "Stop"],
                            ].map(([action, label]) => (
                              <button
                                key={action}
                                disabled={
                                  !!busy ||
                                  ["terminated", "failed"].includes(
                                    debug.status,
                                  ) ||
                                  (action === "stop"
                                    ? false
                                    : action === "pause"
                                      ? debug.status !== "running"
                                      : debug.status !== "paused")
                                }
                                onClick={async () => {
                                  const r = await act("debug-control", {
                                    id: debug.id,
                                    action,
                                  });
                                  if (r) setDebug(r);
                                }}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                          <div className="debug-columns">
                            <section>
                              <h3>Call stack</h3>
                              {debug.frames.map((f, i) => (
                                <button
                                  key={f.id}
                                  onClick={async () =>
                                    setDebug(
                                      await act("debug-inspect", {
                                        id: debug.id,
                                        frame: i,
                                      }),
                                    )
                                  }
                                >
                                  {f.name} · line {f.line}
                                </button>
                              ))}
                            </section>
                            <section>
                              <h3>Locals</h3>
                              {debug.variables.map((v) => (
                                <p key={v.name}>
                                  <code>{v.name}</code> = {v.value}
                                </p>
                              ))}
                            </section>
                            <pre>{debug.output}</pre>
                          </div>
                        </>
                      ) : (
                        <div className="ws-empty compact">
                          <h3>Debugger not started</h3>
                          <p>
                            Open a Node JavaScript or Python file, click the
                            editor gutter or press F9 to add breakpoints, save
                            it, and choose Debug.
                          </p>
                          {active && (
                            <button
                              disabled={!project.trusted}
                              onClick={startDebug}
                            >
                              Debug current file
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div
                className="persistent-terminals"
                hidden={!bottomOpen || bottom !== "Terminal"}
              >
                <div className="terminal-tabs">
                  {terminals.map((t) => (
                    <button
                      key={t}
                      aria-pressed={terminalTab === t}
                      onClick={() => {
                        setTerminalTab(t);
                        rememberTerminals(projectId, terminals, t);
                      }}
                    >
                      Terminal {t}
                    </button>
                  ))}
                  {terminals.length < 2 && (
                    <button
                      onClick={() => {
                        setTerminals([1, 2]);
                        setTerminalTab(2);
                        rememberTerminals(projectId, [1, 2], 2);
                      }}
                    >
                      ＋ Second terminal
                    </button>
                  )}
                </div>
                {terminals.map((t) => (
                  <div hidden={terminalTab !== t} key={projectId + ":" + t}>
                    <Suspense fallback={<p>Loading terminal…</p>}>
                      <Terminal
                        projectName={project.name}
                        executionEnabled={project.trusted}
                        onEnableExecution={enableExecution}
                        sessionKey={"studio-terminal-" + projectId + "-" + t}
                        operation={(name, args) =>
                          name === "open-terminal"
                            ? op("project-terminal", { project: projectId })
                            : op(name, args)
                        }
                        onChange={() => {}}
                      />
                    </Suspense>
                  </div>
                ))}
              </div>
            </div>
          </main>
          {agentOpen && (
            <aside className="agent-panel" aria-label="Agent work">
              <div className="agent-heading">
                <span className="agent-spark">
                  <Icon name="work" size={22} />
                </span>
                <div>
                  <h2>Agent work</h2>
                  <p>Tasks and change review</p>
                </div>
                <button
                  className="close-agent"
                  aria-label="Close agent work"
                  onClick={() => {
                    setAgentOpen(false);
                    if (area === "Work") setArea("Files");
                  }}
                >
                  ×
                </button>
              </div>
              <div className="connector-strip">
                <span
                  className={
                    "connector-dot " +
                    (work?.mode !== "craftbot" && connection.connected
                      ? "connected"
                      : "")
                  }
                />
                <span>
                  {work?.mode === "craftbot"
                    ? "CraftBot · native delivery"
                    : connection.external
                      ? work?.delivery === "external" && work.status === "running" ? "Direct A2App: task claimed" : "Direct A2App: agent polls for work"
                    : connection.connecting || busy === "connector-control"
                      ? connection.connected
                        ? "Standalone: disconnecting…"
                        : "Standalone: connecting…"
                      : connection.connected
                        ? "Standalone: connected"
                        : "Standalone: disconnected"}
                </span>
                <button
                  disabled={!!busy}
                  onClick={async () => {
                    if (work?.mode === "craftbot") {
                      openSettings();
                      return;
                    }
                    await toggleStandaloneConnection();
                  }}
                >
                  {work?.mode === "craftbot"
                    ? "Settings"
                    : connection.external
                      ? "Connection setup"
                    : connection.connecting
                      ? "Cancel connection"
                      : connection.connected
                        ? "Disconnect"
                        : "Connect"}
                </button>
              </div>
              {work?.mode !== "craftbot" &&
                !connection.connected &&
                connection.message && (
                  <p className="hint" role="status">
                    {connection.message}
                  </p>
                )}
              <details className="connector-note">
                <summary>Connection setup</summary>
                <p>
                  Use any compatible agent through A2App, or choose an optional
                  local launcher in Settings. CraftBot’s native host delivery is
                  available when this app is imported there.
                </p>
                <button onClick={openSettings}>Agent settings</button>
              </details>
              {work ? (
                <div className="current-work">
                  <div className="ws-section-title">
                    <h3>{work.title}</h3>
                    <Status status={work.status} />
                  </div>
                  <p>{work.goal}</p>
                  <TaskActivity work={work} runs={projectRuns} />
                  {work.status === "failed" && work.handoffError && (
                    <p className="notice" role="alert">
                      {work.handoffError}
                    </p>
                  )}
                  <details>
                    <summary>Acceptance & context</summary>
                    <p>{work.criteria}</p>
                    <p>{work.context}</p>
                  </details>
                  <div className="inline-actions">
                    {[
                      "draft",
                      "failed",
                      "canceled",
                      "ready",
                      "rejected",
                      "applied",
                    ].includes(work.status) && (
                      <button
                        className="ws-primary"
                        disabled={!project.trusted || !!busy}
                        onClick={() =>
                          act(
                            "work-start",
                            { work: work.id },
                            "Isolated attempt queued for " + work.mode + ".",
                          )
                        }
                      >
                        {work.status === "draft"
                          ? "Start agent work"
                          : "New attempt"}
                      </button>
                    )}
                    {[
                      "queued",
                      "running",
                      "needs-input",
                      "finalizing",
                    ].includes(work.status) && (
                      <button
                        onClick={() =>
                          act(
                            "work-cancel",
                            { work: work.id },
                            "Write lease revoked; connector termination requested.",
                          )
                        }
                      >
                        Cancel work
                      </button>
                    )}
                    {["ready", "applied", "rejected"].includes(work.status) && (
                      <button onClick={() => showReview(work.id)}>
                        Review changes
                      </button>
                    )}
                  </div>
                  {work.status === "ready" && !work.applied?.length && (
                    <div className="question-card">
                      <label>
                        Request a revision
                        <textarea
                          value={revision}
                          onChange={(e) => setRevision(e.target.value)}
                          placeholder="Describe the adjustment before accepting these files."
                          rows={3}
                        />
                      </label>
                      <button
                        disabled={!revision.trim() || !!busy}
                        onClick={async () => {
                          const r = await act("work-revise", {
                            work: work.id,
                            instruction: revision,
                          });
                          if (r) {
                            setRevision("");
                            setReview(null);
                            setView("editor");
                          }
                        }}
                      >
                        Request revision
                      </button>
                    </div>
                  )}
                  {work.status === "canceling" && (
                    <p className="notice" role="status">
                      Managed writes are blocked. Waiting for confirmed
                      connector termination.{" "}
                      <button
                        onClick={() => act("work-sync", { work: work.id })}
                      >
                        Check stop state
                      </button>
                    </p>
                  )}
                  {work.summary && (
                    <details
                      className="work-summary"
                      open={
                        work.status === "failed" || work.status === "canceled"
                      }
                    >
                      <summary>Agent report</summary>
                      <p>{work.summary}</p>
                    </details>
                  )}
                  {work.question && (
                    <form
                      className="question-card"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const r = await act(
                          "work-answer",
                          { work: work.id, answer },
                          "Answer saved; a new delivery will resume this attempt.",
                        );
                        if (r) setAnswer("");
                      }}
                    >
                      <h4>The agent needs your answer</h4>
                      <p>{work.question}</p>
                      <label>
                        Answer
                        <textarea
                          value={answer}
                          onChange={(e) => setAnswer(e.target.value)}
                          required
                          rows={4}
                        />
                      </label>
                      <button className="ws-primary" disabled={!!busy}>
                        Answer and resume
                      </button>
                    </form>
                  )}
                  <div className="work-timeline">
                    {work.progress?.map((p, i) => (
                      <div key={i}>
                        <time>{new Date(p.at).toLocaleTimeString()}</time>
                        <p>{p.message}</p>
                      </div>
                    ))}
                    {work.status === "queued" && !work.progress?.length && (
                      <p className="hint">
                        Waiting for the chosen connector to claim the task.
                        Queued does not mean the agent has started.
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="agent-intro">
                  <h3>No task selected</h3>
                  <p>
                    Create a task for an isolated copy of this project. Review
                    its changes before applying them.
                  </p>
                  <button
                    className="ws-primary"
                    onClick={() => openModal("work")}
                  >
                    New development work
                  </button>
                  <div className="agent-suggestions">
                    {[
                      "Plan development work",
                      "Implement a feature",
                      "Diagnose a failing check",
                      "Write tests",
                      "Review existing code",
                    ].map((title) => (
                      <button
                        key={title}
                        onClick={() => openModal("work", { title })}
                      >
                        {title}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <button
                className="new-work-footer"
                onClick={() => openModal("work")}
              >
                ＋ New work item
              </button>
            </aside>
          )}
        </div>
      )}
      <footer className="workspace-statusbar">
        <span>
          {project
            ? `⑂ ${git?.branch || project.profile}  ·  ${project.name}`
            : "Ready · local workspace"}
        </span>
        <span>
          {busy
            ? ({
                "format-text": "Formatting file",
                "run-inspect": "Refreshing result",
                "run-start": "Starting command",
                "debug-start": "Starting debugger",
                "debug-inspect": "Refreshing debugger",
                "debug-control": "Updating debugger",
                "project-search": "Searching files",
                "preferences-save": "Saving settings",
                "tools-status": "Checking tools",
                "work-start": "Starting agent work",
                "work-answer": "Sending answer",
                "review-changes": "Loading changes",
                "review-apply": "Applying changes",
              }[busy] || busy.replaceAll("-", " ")) + "…"
            : buffer?.image
              ? `Image · ${buffer.size} bytes`
              : buffer?.binary
                ? `Binary · ${buffer.size} bytes`
                : buffer
                  ? `${dirty(buffer) ? "Unsaved · " : ""}${buffer.encoding || "UTF-8"} · ${buffer.lineEnding || "LF"} · ${buffer.cursor?.lineNumber || 1}:${buffer.cursor?.column || 1}`
                  : "Files stay on disk. Agents work in isolated copies."}
        </span>
        <button onClick={() => setBottomOpen(!bottomOpen)}>
          {project?.trusted ? "Execution enabled" : "Inspection mode"}
        </button>
      </footer>
      {palette && (
        <div
          className="ws-modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPalette(false);
          }}
        >
          <section
            className="command-palette"
            role="dialog"
            aria-modal="true"
            aria-label="Quick open and commands"
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (quickPath && project) openFile(quickPath);
              }}
            >
              <label>
                Open file by relative path
                <input
                  autoFocus
                  value={quickPath}
                  onChange={(e) => setQuickPath(e.target.value)}
                  placeholder="src/main.ts"
                  list="known-project-files"
                />
              </label>
              <datalist id="known-project-files">
                {Object.values(tree)
                  .flat()
                  .filter((e) => e.kind === "file")
                  .map((e) => (
                    <option key={e.path} value={e.path} />
                  ))}
              </datalist>
              <button disabled={!project || !quickPath}>Open file</button>
            </form>
            <div>
              {[
                ["Open folder", () => openModal("open")],
                ["New project", () => openModal("new")],
                ["New file", () => openModal("file"), true],
                ["Add run command", () => openModal("config"), true],
                ["New agent work", () => openModal("work"), true],
                ["Open web preview", () => openModal("preview"), true],
                ["Open Settings", openSettings],
              ].map(([name, fn, requiresProject]) => (
                <button
                  key={name}
                  disabled={requiresProject && !project}
                  title={
                    requiresProject && !project
                      ? "Open a project first"
                      : undefined
                  }
                  onClick={() => {
                    setPalette(false);
                    fn();
                  }}
                >
                  {name}
                  <span>↵</span>
                </button>
              ))}
            </div>
            <button onClick={() => setPalette(false)}>
              Close <kbd>Esc</kbd>
            </button>
          </section>
        </div>
      )}
      {modal && (
        <div className="ws-modal-backdrop">
          <section
            className="ws-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ws-modal-title"
          >
            <div className="ws-section-title">
              <h2 id="ws-modal-title">
                {
                  {
                    open: "Open an existing folder",
                    new: "Create a new project",
                    clone: "Clone a repository",
                    file: "Create a file",
                    folder: "Create a folder",
                    move: "Rename or move",
                    config: "Run configuration",
                    work: "New development work",
                    preview: "Open a web preview",
                    checkpoints: "Recover file versions",
                  }[modal]
                }
              </h2>
              <button
                aria-label="Close dialog"
                disabled={folderBrowsing}
                onClick={() => setModal(null)}
              >
                ×
              </button>
            </div>
            {modal === "checkpoints" ? (
              <div className="checkpoint-list">
                {fields.items?.length ? (
                  fields.items.map((c) => (
                    <article key={c.id}>
                      <strong>{c.path}</strong>
                      <small>{new Date(c.created).toLocaleString()}</small>
                      <button
                        onClick={async () => {
                          let expected = null;
                          try {
                            expected = (
                              await op("file-read", {
                                project: projectId,
                                path: c.path,
                              })
                            ).digest;
                          } catch {}
                          if (
                            await confirm({
                              title: "Restore " + c.path + "?",
                              body: "This file version will replace the current disk file. The current file is checkpointed first.",
                              confirmLabel: "Restore version",
                              danger: true,
                            })
                          )
                            await act(
                              "checkpoint-restore",
                              { checkpoint: c.id, expected },
                              "File restored.",
                            );
                        }}
                      >
                        Restore
                      </button>
                    </article>
                  ))
                ) : (
                  <p>
                    No recoverable versions yet. Saving, applying or deleting
                    files creates them.
                  </p>
                )}
              </div>
            ) : (
              <form onSubmit={submitModal}>
                {["open", "new", "clone"].includes(modal) && (
                  <>
                    <label htmlFor="project-folder-path">
                      {modal === "open"
                        ? "Absolute project folder"
                        : "Absolute path for a new folder"}
                    </label>
                    <div className="project-folder-input">
                      <input
                        id="project-folder-path"
                        autoFocus
                        disabled={folderBrowsing}
                        value={fields.path || ""}
                        onChange={(e) => changeField("path", e.target.value)}
                        placeholder="C:\Projects\my-app"
                        required
                      />
                      {modal === "open" && (
                        <button
                          type="button"
                          disabled={folderBrowsing || !!busy}
                          onClick={browseProjectFolder}
                        >
                          <Icon name="folder" size={14} />
                          {folderBrowsing ? "Browsing…" : "Browse…"}
                        </button>
                      )}
                    </div>
                    {folderBrowsing && (
                      <p className="hint" role="status">
                        Choose a folder in the Windows dialog, or cancel it to
                        return here.
                      </p>
                    )}
                    <p className="hint">
                      {modal === "open"
                        ? "Opening does not install dependencies, initialize Git or change your files."
                        : "The destination must not already exist."}
                    </p>
                  </>
                )}
                {modal === "new" && (
                  <label>
                    Starter
                    <select
                      value={fields.kind || "empty"}
                      onChange={(e) => changeField("kind", e.target.value)}
                    >
                      <option value="empty">
                        Empty folder · any toolchain
                      </option>
                      <option value="javascript">
                        JavaScript · Node + real test
                      </option>
                      <option value="python">
                        Python · application + unittest
                      </option>
                    </select>
                  </label>
                )}
                {modal === "clone" && (
                  <label>
                    Repository URL
                    <input
                      value={fields.url || ""}
                      onChange={(e) => changeField("url", e.target.value)}
                      placeholder="https://github.com/owner/project.git"
                      required
                    />
                  </label>
                )}
                {["file", "folder", "move"].includes(modal) && (
                  <label>
                    Relative path
                    <input
                      autoFocus
                      value={fields.path || ""}
                      onChange={(e) => changeField("path", e.target.value)}
                      required
                      placeholder="src/example.js"
                    />
                  </label>
                )}
                {modal === "move" && (
                  <label>
                    New relative path
                    <input
                      value={fields.to || ""}
                      onChange={(e) => changeField("to", e.target.value)}
                      required
                    />
                  </label>
                )}
                {modal === "config" && (
                  <>
                    <label>
                      Name
                      <input
                        autoFocus
                        value={fields.name || ""}
                        onChange={(e) => changeField("name", e.target.value)}
                        required
                      />
                    </label>
                    <label>
                      Command
                      <input
                        value={fields.command || ""}
                        onChange={(e) => changeField("command", e.target.value)}
                        required
                        placeholder="npm test"
                      />
                    </label>
                    <div className="form-columns">
                      <label>
                        Working directory
                        <input
                          value={fields.cwd || ""}
                          onChange={(e) => changeField("cwd", e.target.value)}
                          placeholder="Project root"
                        />
                      </label>
                      <label>
                        Purpose
                        <select
                          value={fields.kind || "custom"}
                          onChange={(e) => changeField("kind", e.target.value)}
                        >
                          {[
                            "install",
                            "develop",
                            "build",
                            "test",
                            "lint",
                            "format",
                            "custom",
                          ].map((k) => (
                            <option key={k}>{k}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label>
                      Artifact paths
                      <input
                        value={
                          Array.isArray(fields.artifactPaths)
                            ? fields.artifactPaths.join(", ")
                            : fields.artifactPaths || ""
                        }
                        onChange={(e) =>
                          changeField("artifactPaths", e.target.value)
                        }
                        placeholder="dist, build, out, coverage"
                      />
                    </label>
                    <label>
                      Environment variable references
                      <input
                        value={
                          Array.isArray(fields.envNames)
                            ? fields.envNames.join(", ")
                            : fields.envNames || ""
                        }
                        onChange={(e) =>
                          changeField("envNames", e.target.value)
                        }
                        placeholder="DATABASE_URL, API_KEY"
                      />
                    </label>
                    <p className="hint">
                      Names refer to existing host variables. Values are never
                      saved here. Commands run only after execution is enabled.
                      The same saved configuration can run in an agent's
                      isolated copy.
                    </p>
                  </>
                )}
                {modal === "work" && (
                  <>
                    <label>
                      Title
                      <input
                        autoFocus
                        value={fields.title || ""}
                        onChange={(e) => changeField("title", e.target.value)}
                        maxLength={160}
                        required
                      />
                    </label>
                    <label>
                      Goal
                      <textarea
                        value={fields.goal || ""}
                        onChange={(e) => changeField("goal", e.target.value)}
                        rows={4}
                        required
                        placeholder="Describe the result you want."
                      />
                    </label>
                    <label>
                      Acceptance criteria
                      <textarea
                        value={fields.criteria || ""}
                        onChange={(e) =>
                          changeField("criteria", e.target.value)
                        }
                        rows={3}
                        required
                        placeholder="How will we verify it works?"
                      />
                    </label>
                    <label>
                      Context
                      <textarea
                        value={fields.context || ""}
                        onChange={(e) => changeField("context", e.target.value)}
                        rows={2}
                        placeholder={
                          active
                            ? `Relevant file: ${active}`
                            : "Files, errors, logs or project instructions"
                        }
                      />
                    </label>
                    <div className="inline-actions">
                      <button
                        type="button"
                        disabled={!buffer}
                        onClick={() =>
                          changeField(
                            "context",
                            ("File: " + buffer.path + "\n" + buffer.text).slice(
                              0,
                              4000,
                            ),
                          )
                        }
                      >
                        Attach active file
                      </button>
                      <button
                        type="button"
                        disabled={!selection?.text}
                        onClick={() =>
                          changeField(
                            "context",
                            (
                              "Selection: " +
                              selection.path +
                              ":" +
                              selection.startLine +
                              "-" +
                              selection.endLine +
                              "\n" +
                              selection.text
                            ).slice(0, 4000),
                          )
                        }
                      >
                        Attach selection
                      </button>
                      <button
                        type="button"
                        disabled={!run?.output}
                        onClick={() =>
                          changeField(
                            "context",
                            (
                              "Run: " +
                              run.name +
                              " (" +
                              run.status +
                              ")\n" +
                              run.output
                            ).slice(-4000),
                          )
                        }
                      >
                        Attach run output
                      </button>
                      <button
                        type="button"
                        disabled={!diagnostics.length}
                        onClick={() =>
                          changeField(
                            "context",
                            diagnostics
                              .map(
                                (d) =>
                                  `${active}:${d.range.start.line + 1} ${d.message}`,
                              )
                              .join("\n")
                              .slice(0, 4000),
                          )
                        }
                      >
                        Attach problems
                      </button>
                    </div>
                    <label>
                      Agent connection
                      <select
                        value={fields.mode || "standalone"}
                        onChange={(e) => changeField("mode", e.target.value)}
                      >
                        <option value="standalone">
                          Your agent · A2App or local launcher
                        </option>
                        <option value="craftbot">
                          CraftBot · native host connection
                        </option>
                      </select>
                    </label>
                    {(fields.mode || "standalone") === "standalone" && (!state.preferences.agentCommand || state.preferences.agentCommand.provider === "codex") && (
                      <label>
                        Reasoning
                        <select
                          value={fields.effort || "medium"}
                          onChange={(e) =>
                            changeField("effort", e.target.value)
                          }
                        >
                          <option value="medium">
                            Standard · everyday development
                          </option>
                          <option value="high">
                            Thorough · complex work, takes longer
                          </option>
                        </select>
                      </label>
                    )}
                    <p className="hint">
                      A draft does not execute. Start it when ready; the agent
                      edits an isolated source copy.
                    </p>
                  </>
                )}
                {modal === "preview" && (
                  <>
                    <label>
                      Development server URL
                      <input
                        autoFocus
                        value={fields.url || ""}
                        onChange={(e) => changeField("url", e.target.value)}
                        placeholder="http://127.0.0.1:5173"
                        required
                      />
                    </label>
                    <p className="hint">
                      Opens in a separate tab and origin. Project code does not
                      receive the IDE's local UI authority.
                    </p>
                  </>
                )}
                {error && (
                  <p className="ws-inline-error" role="alert">
                    {error}
                  </p>
                )}
                <div className="modal-actions">
                  <button
                    type="button"
                    disabled={folderBrowsing}
                    onClick={() => setModal(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="ws-primary"
                    disabled={!!busy || folderBrowsing}
                  >
                    {busy
                      ? "Working…"
                      : modal === "work"
                        ? "Create draft"
                        : modal === "config"
                          ? "Save command"
                          : modal === "open"
                            ? "Open folder"
                            : modal === "preview"
                              ? "Open preview"
                              : {
                                  new: "Create project",
                                  clone: "Clone repository",
                                  file: "Create file",
                                  folder: "Create folder",
                                  move: "Move / rename",
                                }[modal] || "Save"}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}
      {confirmElement}
    </div>
  );
}
