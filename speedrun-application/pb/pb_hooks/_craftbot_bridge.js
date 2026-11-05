/// <reference path="../pb_data/types.d.ts" />
/**
 * COMPATIBILITY MODULE (SYSTEM-OWNED — hash-locked; blueprint-pocketbase-kit).
 * Host services for the app's own hooks, under the name they were written for:
 *
 *   const bridge = require(`${__hooks}/_craftbot_bridge.js`);
 *   const text = bridge.callLLM('Summarize: ...', 'You are terse.');
 *   const obj = JSON.parse(bridge.callLLM(prompt, system, { json: true }) || 'null');
 *   const res = bridge.callAction('send_gmail', { to, subject, body });
 *   const raw = bridge.callIntegration('slack', 'POST', '/chat.postMessage', { ... });
 *
 * callLLM is answered by whichever host is present:
 *   1. CraftBot, when it launched the app (CRAFTBOT_BRIDGE_URL/TOKEN);
 *   2. the Agent App Framework's bridge (`agent-app <dir> bridge start`), which
 *      answers with the connected harness's own model and publishes where it
 *      listens in `.a2app/bridge-llm.json`;
 *   3. neither: '' — every caller already degrades on an empty answer.
 *
 * callAction / callIntegration reach CraftBot's integrations and exist only
 * where CraftBot hosts the app; elsewhere they answer 503 as they always have.
 */

function hostBridge() {
  const url = $os.getenv("CRAFTBOT_BRIDGE_URL");
  const token = $os.getenv("CRAFTBOT_BRIDGE_TOKEN");
  return url && token ? { url: url, token: token } : null;
}

/** The framework bridge's LLM endpoint, when one is running for this app. */
function frameworkLlm() {
  try {
    const raw = toString($os.readFile($filepath.join(__hooks, "..", "..", ".a2app", "bridge-llm.json")));
    const info = JSON.parse(raw);
    if (info && typeof info.url === "string" && typeof info.token === "string") return info;
  } catch (_e) {
    /* no bridge running */
  }
  return null;
}

/**
 * options.json: the reply must be one JSON object (the prompt still describes
 * its shape). Use it whenever the hook JSON.parse()s the reply, never for prose.
 */
function callLLM(prompt, systemMessage, options) {
  const json = !!(options && options.json);
  try {
    const host = hostBridge();
    if (host) {
      const res = $http.send({
        url: host.url + "/api/bridge/llm",
        method: "POST",
        body: JSON.stringify({ prompt: prompt, system_message: systemMessage || "", json_mode: json }),
        headers: { "content-type": "application/json", authorization: "Bearer " + host.token },
        timeout: 120,
      });
      return (res.json && res.json.content) || "";
    }
    const fw = frameworkLlm();
    if (fw) {
      const res = $http.send({
        url: fw.url,
        method: "POST",
        body: JSON.stringify({ prompt: prompt, system: systemMessage || "", json: json }),
        headers: { "content-type": "application/json", authorization: "Bearer " + fw.token },
        timeout: 300,
      });
      return (res.json && typeof res.json.content === "string" && res.json.content) || "";
    }
    return "";
  } catch (_e) {
    return "";
  }
}

function callAction(actionName, params, options) {
  try {
    const host = hostBridge();
    if (!host) return { status: 503, error: "CraftBot integration bridge is unavailable" };
    const res = $http.send({
      url: host.url + "/api/integrations/action",
      method: "POST",
      body: JSON.stringify({
        action: actionName,
        params: params || {},
        confirm_irreversible: !!(options && options.confirmIrreversible),
        dry_run: !!(options && options.dryRun),
      }),
      headers: { "content-type": "application/json", authorization: "Bearer " + host.token },
      timeout: 120,
    });
    const out = res.json || { error: "Empty bridge response" };
    if (out.status === undefined) out.status = res.statusCode || 502;
    return out;
  } catch (err) {
    return { status: 502, error: String(err) };
  }
}

function callIntegration(integration, method, url, body, headers) {
  try {
    const host = hostBridge();
    if (!host) return { status: 503, error: "CraftBot integration bridge is unavailable" };
    const res = $http.send({
      url: host.url + "/api/integrations/proxy",
      method: "POST",
      body: JSON.stringify({ integration: integration, method: method, url: url, body: body || null, headers: headers || {} }),
      headers: { "content-type": "application/json", authorization: "Bearer " + host.token },
      timeout: 120,
    });
    const out = res.json || { error: "Empty bridge response" };
    if (out.status === undefined) out.status = res.statusCode || 502;
    return out;
  } catch (err) {
    return { status: 502, error: String(err) };
  }
}

module.exports = {
  callLLM: callLLM,
  callAction: callAction,
  callIntegration: callIntegration,
};
