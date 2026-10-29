import { useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";

function FileLabel({ path }) {
  const parts = path.replaceAll("\\", "/").split("/");
  const name = parts.pop();
  return (
    <span className="tool-file-label">
      <span>{name}</span>
      <small>{parts.join("/")}</small>
    </span>
  );
}

export function SearchSidebar({
  query,
  onQuery,
  replacement,
  onReplacement,
  busy,
  onSearch,
  result,
  onResult,
  onPreview,
  onOpen,
}) {
  const [replaceOpen, setReplaceOpen] = useState(false);
  const groups = new Map();
  for (const match of result?.matches || []) {
    if (!groups.has(match.path)) groups.set(match.path, []);
    groups.get(match.path).push(match);
  }
  return (
    <section
      className="tool-sidebar search-sidebar"
      aria-label="Project search"
    >
      <div className="ws-section-title">
        <h2>Search</h2>
        <span title="Literal text search. Generated folders and credential files are excluded.">
          <Icon name="info" size={14} />
        </span>
      </div>
      <form
        className="tool-search-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await onSearch();
          if (r) onResult({ ...r, query });
        }}
      >
        <button
          type="button"
          className="tool-icon replace-toggle"
          aria-label={replaceOpen ? "Hide Replace" : "Show Replace"}
          aria-expanded={replaceOpen}
          onClick={() => setReplaceOpen((v) => !v)}
        >
          <Icon name={replaceOpen ? "chevronDown" : "chevronRight"} size={14} />
        </button>
        <div className="tool-input-row">
          <input
            autoFocus
            aria-label="Search project"
            placeholder="Search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            required
          />
          <button
            className="tool-icon"
            aria-label="Search"
            title="Search (Enter)"
            disabled={!query || !!busy}
          >
            <Icon name="search" size={14} />
          </button>
        </div>
        {replaceOpen && (
          <div className="tool-input-row replace-input">
            <input
              aria-label="Replace with"
              placeholder="Replace"
              value={replacement}
              onChange={(e) => onReplacement(e.target.value)}
            />
            <button
              type="button"
              className="tool-icon"
              aria-label="Preview replace"
              title="Preview replacements"
              disabled={!query || !!busy}
              onClick={onPreview}
            >
              <Icon name="replace" size={15} />
            </button>
          </div>
        )}
      </form>
      <p className="tool-panel-hint" role="status">
        {busy === "project-search"
          ? "Searching…"
          : !result
            ? "Enter a term to search files."
            : result.matches.length
              ? `${result.matches.length} ${result.matches.length === 1 ? "result" : "results"} in ${groups.size} ${groups.size === 1 ? "file" : "files"}`
              : `No results for “${result.query}”.`}
      </p>
      <div className="tool-search-results">
        {[...groups].map(([path, matches]) => (
          <details className="tool-file-group" key={path} open>
            <summary title={path}>
              <FileLabel path={path} />
              <span className="tool-count">{matches.length}</span>
            </summary>
            {matches.map((m, i) => (
              <button
                className="tool-search-hit"
                key={i}
                title={`${path}:${m.line}\n${m.text}`}
                onClick={() => onOpen(path, { lineNumber: m.line })}
              >
                <span>{m.line}</span>
                <code>{m.text}</code>
              </button>
            ))}
          </details>
        ))}
      </div>
    </section>
  );
}

export function SourceControlSidebar({
  git,
  busy,
  trusted,
  message,
  onMessage,
  onRefresh,
  onEnable,
  onInitialize,
  onCommit,
  onRemote,
  onHistory,
  onDiff,
  onStage,
}) {
  const menu = useRef(null);
  useEffect(() => {
    const dismiss = (event) => {
      if (menu.current && !menu.current.contains(event.target))
        menu.current.open = false;
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  const staged = [],
    changes = [];
  for (const f of git?.files || []) {
    const conflict = ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(
      f.index + f.working,
    );
    if (!conflict && f.index !== " " && f.index !== "?") staged.push(f);
    if (conflict || f.working !== " ") changes.push(f);
  }
  const group = (title, files, stagedGroup) =>
    files.length > 0 && (
      <details className="scm-group" open>
        <summary>
          {title}
          <span className="tool-count">{files.length}</span>
        </summary>
        {files.map((f) => (
          <div className="scm-file" key={f.path}>
            <button
              className="scm-file-open"
              title={f.path}
              onClick={() => onDiff(f.path, stagedGroup)}
            >
              <Icon name="code" size={13} />
              <FileLabel path={f.path} />
              <span className="scm-status">
                {stagedGroup
                  ? f.index
                  : f.working === "?"
                    ? "U"
                    : f.working === " "
                      ? f.index
                      : f.working}
              </span>
            </button>
            <button
              className="tool-icon scm-file-action"
              aria-label={`${stagedGroup ? "Unstage" : "Stage"} ${f.path}`}
              title={stagedGroup ? "Unstage file" : "Stage file"}
              disabled={!!busy || !trusted}
              onClick={() => onStage(f.path, stagedGroup)}
            >
              <Icon name={stagedGroup ? "minus" : "plus"} size={14} />
            </button>
          </div>
        ))}
      </details>
    );
  return (
    <section className="tool-sidebar scm-sidebar" aria-label="Source control">
      <div className="ws-section-title scm-heading">
        <h2>Source control</h2>
        <div className="tool-heading-actions">
          <button
            className="tool-icon"
            aria-label="Refresh Git"
            title="Refresh"
            disabled={!!busy}
            onClick={onRefresh}
          >
            <Icon name="refresh" size={14} />
          </button>
          <details
            className="scm-menu"
            ref={menu}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                menu.current.open = false;
                menu.current.querySelector("summary").focus();
              }
            }}
          >
            <summary
              aria-label="More source control actions"
              title="More actions"
            >
              ⋯
            </summary>
            <div className="scm-menu-items">
              {["fetch", "pull", "push"].map((action) => (
                <button
                  key={action}
                  disabled={!!busy || !trusted || !git?.available}
                  onClick={() => {
                    menu.current.open = false;
                    onRemote(action);
                  }}
                >
                  {action[0].toUpperCase() + action.slice(1)}
                </button>
              ))}
              <button
                disabled={!git?.available || !!busy}
                onClick={() => {
                  menu.current.open = false;
                  onHistory();
                }}
              >
                View history &amp; diff
              </button>
            </div>
          </details>
        </div>
      </div>
      {git && !trusted && (
        <div className="tool-trust-note">
          <span>Inspection mode</span>
          <button disabled={!!busy} onClick={onEnable}>
            Enable execution…
          </button>
        </div>
      )}
      {!git ? (
        <p className="tool-panel-hint" role="status">
          Inspecting repository…
        </p>
      ) : !git.available ? (
        <div className="scm-compose">
          <p className="tool-panel-hint">No Git repository.</p>
          <button disabled={!!busy || !trusted} onClick={onInitialize}>
            Initialize Git
          </button>
        </div>
      ) : (
        <>
          <div className="scm-branch" title={git.branch}>
            <Icon name="branch" size={13} />
            <span>{git.branch}</span>
          </div>
          <div className="scm-compose">
            <textarea
              aria-label="Commit message"
              placeholder="Message (commit staged changes)"
              rows={2}
              value={message}
              onChange={(e) => onMessage(e.target.value)}
            />
            <button
              className="ws-primary scm-commit"
              disabled={!trusted || !message.trim() || !staged.length || !!busy}
              onClick={onCommit}
            >
              <Icon name="check" size={14} />
              Commit staged{staged.length ? ` (${staged.length})` : ""}
            </button>
          </div>
          {group("Staged Changes", staged, true)}
          {group("Changes", changes, false)}
          {!git.files.length && <p className="tool-panel-hint">No changes.</p>}
        </>
      )}
    </section>
  );
}
