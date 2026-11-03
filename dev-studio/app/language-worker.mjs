import { spawn } from "node:child_process";
import { join, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FramedPeer } from "./json-rpc.mjs";
import { cleanEnvironment, killOwned } from "./jobs-worker.mjs";
const uriKey = (uri) =>
  process.platform === "win32"
    ? decodeURIComponent(uri).toLowerCase()
    : decodeURIComponent(uri);
const ROOT = fileURLToPath(new URL("../", import.meta.url)),
  sessions = new Map();
export async function languageQuery({
  root,
  path,
  text,
  action = "diagnostics",
  line = 0,
  character = 0,
}) {
  const python = extname(path) === ".py",
    language = python
      ? "python"
      : /\.tsx?$/.test(path)
        ? "typescript"
        : "javascript",
    key = root + ":" + (python ? "python" : "typescript");
  let session = sessions.get(key);
  if (!session || session.child.exitCode !== null) {
    if (sessions.size >= 8)
      throw new Error(
        "Close unused language sessions before opening more projects.",
      );
    const entry = python
      ? join(ROOT, "node_modules/pyright/langserver.index.js")
      : join(ROOT, "node_modules/typescript-language-server/lib/cli.mjs");
    const child = spawn(process.execPath, [entry, "--stdio"], {
      cwd: root,
      env: cleanEnvironment(),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    child.stderr.on("data", () => {});
    session = { child, documents: new Map(), diagnostics: {}, peer: null };
    session.peer = new FramedPeer(child, {
      onEvent: (m) => {
        if (m.method === "textDocument/publishDiagnostics")
          session.diagnostics[uriKey(m.params.uri)] = m.params.diagnostics;
      },
    });
    sessions.set(key, session);
    try {
      await session.peer.request(
        "initialize",
        {
          processId: process.pid,
          rootUri: pathToFileURL(root).href,
          capabilities: {
            textDocument: {
              completion: { completionItem: { snippetSupport: false } },
              publishDiagnostics: { relatedInformation: true },
            },
          },
          workspaceFolders: [
            { uri: pathToFileURL(root).href, name: "project" },
          ],
          initializationOptions: {
            hostInfo: "Development Studio",
            tsserver: {
              path: join(
                ROOT,
                "node_modules/studio-typescript-service/lib/tsserver.js",
              ),
            },
            disableAutomaticTypingAcquisition: true,
          },
        },
        8000,
      );
    } catch (e) {
      sessions.delete(key);
      await killOwned(child);
      throw e;
    }
    session.peer.notify("initialized", {});
  }
  const uri = pathToFileURL(join(root, path)).href,
    version = (session.documents.get(uri) || 0) + 1;
  if (version === 1)
    session.peer.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: language, version, text },
    });
  else
    session.peer.notify("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
  session.documents.set(uri, version);
  if (action === "diagnostics") {
    await new Promise((r) =>
      setTimeout(r, Math.min(version === 1 ? 900 : 350, 1000)),
    );
    return {
      language,
      diagnostics: session.diagnostics[uriKey(uri)] || [],
      server: python ? "Pyright" : "TypeScript language server",
    };
  }
  const method = {
    completion: "textDocument/completion",
    hover: "textDocument/hover",
    definition: "textDocument/definition",
  }[action];
  if (!method) throw new Error("Unknown language query.");
  const result = await session.peer.request(method, {
    textDocument: { uri },
    position: { line, character },
  });
  return { language, result };
}
export async function stopLanguages() {
  await Promise.all([...sessions.values()].map((s) => killOwned(s.child)));
  sessions.clear();
}
