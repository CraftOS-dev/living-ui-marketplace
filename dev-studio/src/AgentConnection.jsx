import { useEffect, useState } from "react";
import AdvancedAgentConnection from "./AdvancedAgentConnection.jsx";
import TerminalPanel from "./TerminalPanel.jsx";

export default function AgentConnection({ configuration, connection, busy, onConfigure, onConnect, onInfo, onCatalog, onChooseAgent, operation, onDone }) {
  const [agents, setAgents] = useState(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [login, setLogin] = useState(null);
  const [loginSession, setLoginSession] = useState(null);
  const [connectingAgent, setConnectingAgent] = useState(null);
  async function refresh() {
    setChecking(true); setError("");
    try { const result = await onCatalog(); setAgents(result.agents); return result.agents; }
    catch (failure) { setError(failure.message); }
    finally { setChecking(false); }
  }
  useEffect(() => {
    let current = true;
    setChecking(true);
    onCatalog().then(result => { if (current) setAgents(result.agents); })
      .catch(failure => { if (current) setError(failure.message); })
      .finally(() => { if (current) setChecking(false); });
    return () => { current = false; };
  }, []);
  const activeName = connection.agentName || agents?.find(item => item.id === configuration?.provider)?.name || "Agent";
  const active = connection.connected || connection.connecting;
  async function closeLogin() {
    if (loginSession) await operation("close-terminal", { id: loginSession });
    setLoginSession(null); setLogin(null);
  }
  return <div className="agent-setup">
    <p>Choose an agent on this computer. Studio sends it your tasks and brings the changes back for your review.</p>
    <div className="agent-setup-toolbar">
      <h3>Connect an agent</h3>
      <button disabled={checking || !!busy} onClick={refresh}>{checking ? "Checking agents…" : "Check again"}</button>
    </div>
    {error && <p className="notice error" role="alert">{error}</p>}
    {!agents && checking && <p role="status">Looking for installed agents and checking sign-in…</p>}
    {active && <div className="agent-current" role="status">
      <div><strong>{connection.connecting ? "Connecting to " : "Connected to "}{activeName}</strong>
        <p>{connection.connecting ? "Waiting for the agent connection to be ready." : "Ready for development tasks. Starting a task is always your choice."}</p></div>
      <button disabled={!!busy} onClick={onConnect}>{connection.connecting ? "Cancel connection" : "Disconnect"}</button>
    </div>}
    <div className="agent-options">
      {agents?.map(agent => {
        const selected = configuration?.provider === agent.id && active;
        return <article key={agent.id} className="agent-option" aria-label={agent.name}>
          <div className="agent-option-heading"><h4>{agent.name}</h4>
            <span className={selected ? "agent-ready" : ""}>{selected ? connection.connecting ? "Connecting…" : "Connected" : !agent.installed ? "Not installed" : agent.authentication === "required" ? "Sign-in needed" : agent.authentication === "ready" ? "Ready to connect" : "Installed"}</span></div>
          <p>{!agent.installed ? "Install this agent, then return here and check again." : agent.authentication === "required" ? "Sign in with your existing account. Studio handles the connection setup." : "Uses your existing account and model settings."}</p>
          <div className="agent-option-actions">
            {!agent.installed ? <a href={agent.help} target="_blank" rel="noreferrer">Installation guide ↗</a>
              : selected ? null
              : agent.authentication === "required" ? <button disabled={!!busy || active || !!login} onClick={() => setLogin(agent)}>Sign in to {agent.name}</button>
              : <button disabled={!!busy || active || !!login} onClick={async () => { setError(""); setConnectingAgent(agent.id); try { await onChooseAgent(agent.id); } catch (failure) { setError(failure.message); } finally { setConnectingAgent(null); } }}>{connectingAgent === agent.id ? "Connecting…" : "Connect " + agent.name}</button>}
            {agent.installed && agent.authentication === "unknown" && !selected && <button disabled={!!busy || active || !!login} onClick={() => setLogin(agent)}>Sign in</button>}
          </div>
        </article>;
      })}
    </div>
    {login && <section className="agent-login" aria-label={"Sign in to " + login.name}>
      <h3>Sign in to {login.name}</h3>
      <p>Continue to open {login.name}’s own sign-in screen. Follow its browser prompts, then check your sign-in here. Studio does not ask you to copy a command or enter an API key.</p>
      <TerminalPanel projectName={login.name + " sign-in"} openLabel="Continue to sign in" closeLabel="Stop sign-in" connectedLabel="Sign-in session open" emptyLabel="Ready to sign in"
        onChange={() => {}} operation={async (name, args) => {
          if (name === "open-terminal") { const grant = await operation("agent-sign-in", { provider: login.id }); setLoginSession(grant.id); return grant; }
          return operation(name, args);
        }} />
      <div className="agent-option-actions"><button disabled={checking} onClick={async () => {
        const result = await refresh();
        if (result?.find(item => item.id === login.id)?.authentication === "ready") await closeLogin();
      }}>Check sign-in</button><button onClick={() => closeLogin().catch(failure => setError(failure.message))}>Cancel sign-in</button></div>
    </section>}
    {connection.connected && <div className="agent-next"><p><strong>You’re ready.</strong> Open Work, describe what you want to build, and start the task. You’ll review the changes before applying them.</p>
      <button onClick={onDone}>Back to workspace</button></div>}
    {!active && connection.message && !connection.external && <p className="settings-note" role="status">{connection.message}</p>}
    <details className="settings-disclosure agent-advanced">
      <summary>Advanced connection</summary>
      {connection.external && <p>Using an existing external agent session. It can continue to receive work, or you can connect an installed agent above.</p>}
      <AdvancedAgentConnection configuration={configuration} connection={connection} busy={busy} onConfigure={onConfigure} onConnect={onConnect} onInfo={onInfo} />
    </details>
  </div>;
}
