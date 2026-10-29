import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker.js?worker";
import JsonWorker from "monaco-editor/language/json/json.worker.js?worker";
import CssWorker from "monaco-editor/language/css/css.worker.js?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker.js?worker";
self.MonacoEnvironment = {
  getWorker: (_id, label) =>
    label === "typescript" || label === "javascript"
      ? new TsWorker()
      : label === "json"
        ? new JsonWorker()
        : ["css", "scss", "less"].includes(label)
          ? new CssWorker()
          : ["html", "handlebars", "razor"].includes(label)
            ? new HtmlWorker()
            : new EditorWorker(),
};
const language = (path) =>
  ({
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    json: "json",
    md: "markdown",
    css: "css",
    html: "html",
    rs: "rust",
    go: "go",
    sh: "shell",
    ps1: "powershell",
    yml: "yaml",
    yaml: "yaml",
    sql: "sql",
    c: "c",
    cpp: "cpp",
    h: "cpp",
    java: "java",
    cs: "csharp",
    xml: "xml",
  })[path.split(".").at(-1)] || "plaintext";
let provider;
const contexts = new Map();
function ensureProviders() {
  if (provider) return;
  provider = [];
  // The project service supplies hovers; avoid duplicate built-in signatures.
  const typescript = monaco.languages.typescript;
  for (const defaults of [
    typescript?.javascriptDefaults,
    typescript?.typescriptDefaults,
  ])
    defaults?.setModeConfiguration({
      ...defaults.modeConfiguration,
      hovers: false,
    });
  for (const lang of ["python", "javascript", "typescript"]) {
    provider.push(
      monaco.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: ["."],
        provideCompletionItems: async (model, position) => {
          const c = contexts.get(model.uri.toString());
          if (!c?.trusted) return { suggestions: [] };
          try {
            const data = await c.query({
              project: c.project,
              path: c.path,
              text: model.getValue(),
              action: "completion",
              line: position.lineNumber - 1,
              character: position.column - 1,
            });
            const items = Array.isArray(data.result)
                ? data.result
                : data.result?.items || [],
              word = model.getWordUntilPosition(position);
            return {
              suggestions: items.slice(0, 150).map((item) => ({
                label: item.label,
                kind: item.kind || monaco.languages.CompletionItemKind.Text,
                insertText:
                  item.textEdit?.newText || item.insertText || item.label,
                detail: item.detail || "",
                range: {
                  startLineNumber: position.lineNumber,
                  endLineNumber: position.lineNumber,
                  startColumn: word.startColumn,
                  endColumn: word.endColumn,
                },
              })),
            };
          } catch {
            return { suggestions: [] };
          }
        },
      }),
    );
    provider.push(
      monaco.languages.registerHoverProvider(lang, {
        provideHover: async (model, position) => {
          const c = contexts.get(model.uri.toString());
          if (!c?.trusted) return null;
          try {
            const data = await c.query({
              project: c.project,
              path: c.path,
              text: model.getValue(),
              action: "hover",
              line: position.lineNumber - 1,
              character: position.column - 1,
            });
            const contents = data.result?.contents;
            return {
              contents: (Array.isArray(contents) ? contents : [contents])
                .filter(Boolean)
                .map((v) => ({
                  value: typeof v === "string" ? v : v.value || "",
                })),
            };
          } catch {
            return null;
          }
        },
      }),
    );
    provider.push(
      monaco.languages.registerDefinitionProvider(lang, {
        provideDefinition: async (model, position) => {
          const c = contexts.get(model.uri.toString());
          if (!c?.trusted) return [];
          try {
            const data = await c.query({
                project: c.project,
                path: c.path,
                text: model.getValue(),
                action: "definition",
                line: position.lineNumber - 1,
                character: position.column - 1,
              }),
              items = Array.isArray(data.result) ? data.result : [data.result];
            return items
              .filter((i) => i?.relativePath)
              .map((i) => ({
                uri: monaco.Uri.parse(
                  "studio://" + c.project + "/" + i.relativePath,
                ),
                range: {
                  startLineNumber:
                    (i.range || i.targetSelectionRange).start.line + 1,
                  startColumn:
                    (i.range || i.targetSelectionRange).start.character + 1,
                  endLineNumber:
                    (i.range || i.targetSelectionRange).end.line + 1,
                  endColumn:
                    (i.range || i.targetSelectionRange).end.character + 1,
                },
              }));
          } catch {
            return [];
          }
        },
      }),
    );
  }
}
export default function CodeEditor({
  buffer,
  onChange,
  onSave,
  onCursor,
  onSelection,
  theme = "dark",
  split = false,
  query,
  trusted,
  diagnostics = [],
  onBreakpoint,
  onOpen,
  breakpoints = [],
}) {
  const host = useRef(),
    second = useRef(),
    editor = useRef(),
    model = useRef(),
    decorations = useRef([]),
    applying = useRef(false),
    latest = useRef({
      onChange,
      onSave,
      onCursor,
      onBreakpoint,
      onOpen,
      onSelection,
    });
  latest.current = {
    onChange,
    onSave,
    onCursor,
    onBreakpoint,
    onOpen,
    onSelection,
  };
  useEffect(() => {
    ensureProviders();
    const uri = monaco.Uri.parse(
        "studio://" + buffer.project + "/" + buffer.path,
      ),
      m = monaco.editor.createModel(
        buffer.text || "",
        language(buffer.path),
        uri,
      );
    model.current = m;
    contexts.set(uri.toString(), {
      project: buffer.project,
      path: buffer.path,
      query,
      trusted,
    });
    const options = {
      model: m,
      editContext: false,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      fontFamily: "Cascadia Code, Consolas, monospace",
      lineNumbers: "on",
      glyphMargin: true,
      scrollBeyondLastLine: false,
      wordWrap: "off",
      theme: theme === "light" ? "vs" : "vs-dark",
      ariaLabel: "Code editor for " + buffer.path,
    };
    const ed = monaco.editor.create(host.current, options);
    editor.current = ed;
    if (buffer.cursor) ed.setPosition(buffer.cursor);
    const a = m.onDidChangeContent(() => {
      if (!applying.current) latest.current.onChange(m.getValue());
    });
    const b = ed.onDidChangeCursorPosition((e) =>
      latest.current.onCursor?.(e.position),
    );
    const selectionListener = ed.onDidChangeCursorSelection((e) =>
      latest.current.onSelection?.({
        path: buffer.path,
        startLine: e.selection.startLineNumber,
        endLine: e.selection.endLineNumber,
        text: m.getValueInRange(e.selection),
      }),
    );
    const c = ed.onMouseDown((e) => {
      if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN)
        latest.current.onBreakpoint?.(e.target.position.lineNumber);
    });
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
      latest.current.onSave(),
    );
    const other = split ? monaco.editor.create(second.current, options) : null;
    const breakpointActions = [ed, other].filter(Boolean).map((instance) =>
      instance.addAction({
        id: "studio.toggleBreakpoint",
        label: "Toggle breakpoint (F9)",
        keybindings: [monaco.KeyCode.F9],
        contextMenuGroupId: "navigation",
        run: (current) =>
          latest.current.onBreakpoint?.(current.getPosition()?.lineNumber || 1),
      }),
    );
    if (other)
      other.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
        latest.current.onSave(),
      );
    const secondGutter = other?.onMouseDown((event) => {
      if (
        event.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN
      )
        latest.current.onBreakpoint?.(event.target.position.lineNumber);
    });
    decorations.current = [ed, other]
      .filter(Boolean)
      .map((instance) => instance.createDecorationsCollection());
    const nav = monaco.editor.registerEditorOpener({
      openCodeEditor: async (_source, resource, selection) => {
        if (
          resource.scheme !== "studio" ||
          resource.authority !== buffer.project
        )
          return false;
        await latest.current.onOpen?.(
          decodeURIComponent(resource.path.slice(1)),
          selection,
        );
        return true;
      },
    });
    return () => {
      selectionListener.dispose();
      breakpointActions.forEach((action) => action.dispose());
      secondGutter?.dispose();
      decorations.current.forEach((collection) => collection.clear());
      decorations.current = [];
      a.dispose();
      b.dispose();
      c.dispose();
      nav.dispose();
      other?.dispose();
      ed.dispose();
      m.dispose();
      contexts.delete(uri.toString());
    };
  }, [buffer.project, buffer.path, split]);
  useEffect(() => {
    if (model.current && model.current.getValue() !== buffer.text) {
      const pos = editor.current.getPosition();
      applying.current = true;
      try {
        model.current.setValue(buffer.text || "");
      } finally {
        applying.current = false;
      }
      editor.current.setPosition(pos);
    }
  }, [buffer.project, buffer.path, buffer.syncVersion]);
  useEffect(() => {
    if (editor.current && buffer.cursor) {
      editor.current.setPosition(buffer.cursor);
      editor.current.revealPositionInCenter(buffer.cursor);
    }
  }, [buffer.reveal]);
  useEffect(() => {
    monaco.editor.setTheme(theme === "light" ? "vs" : "vs-dark");
  }, [theme]);
  useEffect(() => {
    if (model.current) {
      contexts.set(model.current.uri.toString(), {
        project: buffer.project,
        path: buffer.path,
        query,
        trusted,
      });
      monaco.editor.setModelMarkers(
        model.current,
        "studio-lsp",
        diagnostics.map((d) => ({
          severity:
            d.severity === 1
              ? monaco.MarkerSeverity.Error
              : monaco.MarkerSeverity.Warning,
          message: d.message,
          startLineNumber: d.range.start.line + 1,
          startColumn: d.range.start.character + 1,
          endLineNumber: d.range.end.line + 1,
          endColumn: d.range.end.character + 1,
        })),
      );
    }
  }, [diagnostics, trusted, query]);
  useEffect(() => {
    for (const collection of decorations.current)
      collection.set(
        breakpoints.map((line) => ({
          range: new monaco.Range(line, 1, line, 1),
          options: {
            isWholeLine: false,
            glyphMarginClassName: "studio-breakpoint",
          },
        })),
      );
  }, [breakpoints, buffer.project, buffer.path, split]);
  return (
    <div className={"editor-split " + (split ? "is-split" : "")}>
      <div ref={host} className="monaco-host" />
      {split && <div ref={second} className="monaco-host" />}
    </div>
  );
}
export function DiffView({ before, after, path, theme = "dark" }) {
  const host = useRef();
  useEffect(() => {
    const editor = monaco.editor.createDiffEditor(host.current, {
        automaticLayout: true,
        readOnly: true,
        renderSideBySide: true,
        minimap: { enabled: false },
        theme: theme === "light" ? "vs" : "vs-dark",
        ariaLabel: "Change comparison for " + path,
      }),
      a = monaco.editor.createModel(before || "", language(path)),
      b = monaco.editor.createModel(after || "", language(path));
    editor.setModel({ original: a, modified: b });
    return () => {
      editor.dispose();
      a.dispose();
      b.dispose();
    };
  }, [before, after, path, theme]);
  return <div ref={host} className="diff-host" />;
}
