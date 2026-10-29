import { useEffect, useState } from "react";

export default function AdvancedAgentConnection({ configuration, connection, busy, onConfigure, onConnect, onInfo }) {
  const [provider, setProvider] = useState(configuration?.provider === "custom" ? "custom" : "external");
  const [command, setCommand] = useState(configuration?.command || "");
  const [args, setArgs] = useState(JSON.stringify(configuration?.args || []));
  const [input, setInput] = useState(configuration?.input || "stdin");
  const [info, setInfo] = useState(null);
  const [feedback, setFeedback] = useState("");
  const serialized = JSON.stringify(configuration || { provider: "codex" });
  useEffect(() => {
    const current = JSON.parse(serialized);
    setProvider(current.provider === "custom" ? "custom" : "external"); setCommand(current.command || "");
    setArgs(JSON.stringify(current.args || [])); setInput(current.input || "stdin");
  }, [serialized]);
  async function save(event) {
    event.preventDefault(); setFeedback("");
    let parsed;
    try { parsed = JSON.parse(args); } catch { setFeedback('Arguments must be valid JSON, for example ["--print", "{prompt}"].'); return; }
    const result = await onConfigure({ provider, ...(provider === "custom" ? { command, args: parsed, input } : {}) });
    if (result) setFeedback("Agent connection saved. No task was started.");
  }
  async function showInstructions() {
    const value = await onInfo(); if (value) setInfo(value);
  }
  return <>
    <p>For existing external sessions and agents with a custom integration. Most users can choose an installed agent above.</p>
    <form onSubmit={save}>
      <label htmlFor="agent-provider">Task delivery</label>
      <select id="agent-provider" value={provider} onChange={event => { setProvider(event.target.value); setFeedback(""); }} disabled={!!busy}>
        <option value="external">Direct A2App · use your own agent</option>
        <option value="custom">Launch another agent command</option>
      </select>
      {provider === "external" && <p className="settings-note">Give the connection instructions below to your agent, then start a Studio work item. Your agent polls for tasks; Studio does not launch it. No Codex or CraftBot is required.</p>}
      {provider === "custom" && <>
        <label htmlFor="agent-command">Agent executable</label>
        <input id="agent-command" value={command} onChange={event => setCommand(event.target.value)} placeholder="Executable name or absolute path" required />
        <label htmlFor="agent-input">Task input</label>
        <select id="agent-input" value={input} onChange={event => setInput(event.target.value)}>
          <option value="stdin">Standard input</option>
          <option value="arg">Prompt argument</option>
        </select>
        <label htmlFor="agent-args">Arguments (JSON array)</label>
        <textarea id="agent-args" value={args} onChange={event => setArgs(event.target.value)} rows={3} spellCheck={false} />
        <p className="settings-note">Use your agent’s headless command. For a prompt argument include {"{prompt}"} in an array item. Arguments are passed directly, without a shell. On Windows, npm CLIs may need the Node executable with their script path as the first argument. Configure login and permissions in your agent.</p>
      </>}
      <button disabled={!!busy}>Save agent connection</button>
    </form>
    {feedback && <p className="settings-note" role="status">{feedback}</p>}
    {(configuration?.provider === "custom" || configuration?.provider === "external") && <div className="settings-row">
      <span role="status">{connection.external ? "Direct A2App · agent polls for work" : connection.connecting ? "Starting launcher…" : connection.connected ? "Launcher connected" : "Launcher stopped"}</span>
      {!connection.external && <button disabled={!!busy} onClick={onConnect}>{connection.connecting ? "Cancel connection" : connection.connected ? "Disconnect" : "Connect"}</button>}
    </div>}
    {connection.message && !connection.connected && <p className="settings-note" role="status">{connection.message}</p>}
    <button disabled={!!busy} onClick={showInstructions}>{info ? "Refresh protocol instructions" : "Show protocol instructions"}</button>
    {info && <div className="agent-connection-instructions">
      <p>Copy this to an agent running on the same computer. The bundled client authenticates locally; credentials are never included in this text.</p>
      <textarea aria-label="Agent connection instructions" readOnly value={info.instructions} rows={9} spellCheck={false} />
      <button onClick={async () => {
        try { await navigator.clipboard.writeText(info.instructions); setFeedback("Connection instructions copied."); }
        catch { setFeedback("Select the instructions above and copy them to your agent."); }
      }}>Copy instructions</button>
    </div>}
  </>;
}
