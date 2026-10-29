import { useEffect, useState } from "react";
import AgentConnection from "./AgentConnection.jsx";

export default function StudioSettings({
  preferences,
  project,
  connection,
  tools,
  busy,
  onBack,
  onPreferences,
  onConnect,
  onConfigureAgent,
  onAgentInfo,
  onTools,
  onCraftbot,
  onExecution,
  onCheckpoints,
}) {
  const [python, setPython] = useState(preferences.python || "");
  const [craftbot, setCraftbot] = useState(preferences.craftbotUrl || "");
  useEffect(() => setPython(preferences.python || ""), [preferences.python]);
  useEffect(
    () => setCraftbot(preferences.craftbotUrl || ""),
    [preferences.craftbotUrl],
  );
  const theme = preferences.theme || "system";
  return (
    <main className="studio-settings" aria-label="Settings">
      <header className="settings-heading">
        <div>
          <h1>Settings</h1>
          <p>Agents, local tools and your development workspace.</p>
        </div>
        <button onClick={onBack}>
          {project ? "Back to editor" : "Back to projects"}
        </button>
      </header>
      <div className="settings-sections">
        <section aria-labelledby="settings-general">
          <h2 id="settings-general">General</h2>
          <div className="settings-row">
            <label htmlFor="settings-theme">Appearance</label>
            <select
              id="settings-theme"
              value={theme}
              disabled={!!busy}
              onChange={(event) =>
                onPreferences({
                  theme: event.target.value,
                  python: preferences.python || "",
                })
              }
            >
              <option value="system">System</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>
        </section>
        <section aria-labelledby="settings-agents">
          <h2 id="settings-agents">Agents</h2>
          <AgentConnection configuration={preferences.agentCommand} connection={connection}
            busy={busy} onConnect={onConnect} onConfigure={onConfigureAgent} onInfo={onAgentInfo} />
          <details className="settings-disclosure">
            <summary>CraftBot connection</summary>
            <p>
              CraftBot delivers tasks through its host when Studio is launched
              from CraftBot. This address is only needed for that installation.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                onCraftbot(craftbot.trim());
              }}
            >
              <label htmlFor="settings-craftbot">CraftBot host URL</label>
              <div className="settings-input-action">
                <input
                  id="settings-craftbot"
                  value={craftbot}
                  onChange={(event) => setCraftbot(event.target.value)}
                  placeholder="http://127.0.0.1:8926"
                  required
                />
                <button disabled={!!busy}>Save CraftBot host</button>
              </div>
            </form>
          </details>
        </section>
        <section aria-labelledby="settings-tools">
          <h2 id="settings-tools">Development tools</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onPreferences({ theme, python }, "Interpreter saved.");
            }}
          >
            <label htmlFor="settings-python">Python interpreter</label>
            <div className="settings-input-action">
              <input
                id="settings-python"
                value={python}
                onChange={(event) => setPython(event.target.value)}
                placeholder="python or absolute interpreter path"
              />
              <button disabled={!!busy}>Save interpreter</button>
            </div>
            <p className="settings-note">
              Python debugging uses debugpy; formatting uses Black from this
              interpreter.
            </p>
          </form>
          <button disabled={!!busy} onClick={onTools}>
            {busy === "tools-status"
              ? "Checking tools…"
              : "Check installed tools"}
          </button>
          {tools && (
            <dl className="settings-tools-list">
              {Object.entries(tools).map(([name, tool]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>
                    {tool.available
                      ? tool.version
                      : "Not available — " +
                        (tool.message || "install this tool to use it")}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>
        <section aria-labelledby="settings-project">
          <h2 id="settings-project">
            {project ? "Project · " + project.name : "Project"}
          </h2>
          {project ? (
            <>
              <div className="settings-row">
                <div>
                  <strong>Project execution</strong>
                  <p>
                    {project.trusted
                      ? "Commands, terminals and language tools are enabled for this folder."
                      : "Inspection mode. Files can be edited; project commands and language tools stay stopped."}
                  </p>
                </div>
                <div className="settings-control">
                  {project.trusted ? (
                    <span>Enabled</span>
                  ) : (
                    <button onClick={onExecution} disabled={!!busy}>
                      Enable execution
                    </button>
                  )}
                </div>
              </div>
              <div className="settings-row">
                <div>
                  <strong>File recovery</strong>
                  <p>Restore a file from a saved checkpoint.</p>
                </div>
                <button onClick={onCheckpoints} disabled={!!busy}>
                  File checkpoints
                </button>
              </div>
            </>
          ) : (
            <p>
              Open a project to configure execution and access its file recovery
              checkpoints.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
