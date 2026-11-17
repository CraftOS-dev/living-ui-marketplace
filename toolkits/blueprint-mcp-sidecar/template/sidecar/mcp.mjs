/**
 * MCP client (SYSTEM-OWNED — hash-locked in the ownership canon).
 *
 * The sidecar's only way into the upstream app: JSON-RPC `tools/list` and
 * `tools/call` against the app's own MCP endpoint on loopback, the same entry
 * every other agent of that app uses. Streamable-HTTP replies arrive either as
 * JSON or as an SSE stream; both are read here.
 *
 * Requests carry the PUBLIC host (the port the person and the agent use), so an
 * app that builds links from its request origin builds links that work.
 */
import { request } from "node:http";

export class McpError extends Error {
  constructor(message, code = "upstream_error", data) {
    super(message);
    this.name = "McpError";
    this.code = code;
    this.data = data;
  }
}

function parseReply(status, contentType, text) {
  if (status === 404) throw new McpError("the upstream app has no MCP endpoint at this path", "upstream_unavailable");
  if (status >= 500) throw new McpError(`the upstream app failed (${status})`, "upstream_error");
  let body;
  if (/text\/event-stream/i.test(contentType ?? "")) {
    // The last `data:` frame carrying a JSON-RPC response is the answer.
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      try {
        const frame = JSON.parse(line.slice(5).trim());
        if (frame && (frame.result !== undefined || frame.error !== undefined)) body = frame;
      } catch {
        /* not JSON — keep reading */
      }
    }
  } else {
    try {
      body = JSON.parse(text);
    } catch {
      /* fall through */
    }
  }
  if (!body) throw new McpError(`the upstream app answered ${status} with no JSON-RPC response`, "upstream_error");
  if (body.error) throw new McpError(body.error.message ?? "JSON-RPC error", body.error.code === -32602 ? "invalid_param" : "upstream_error", body.error.data);
  return body.result;
}

export function createMcpClient({ port, path = "/mcp", publicHost, timeoutMs = 600_000 }) {
  let nextId = 0;
  let toolsCache = null;

  function rpc(method, params) {
    const payload = JSON.stringify({ jsonrpc: "2.0", id: ++nextId, method, params });
    // Apps that record who made a call read the User-Agent or the MCP
    // clientInfo title; without one, a runtime's default ("undici") shows up.
    return new Promise((resolvePromise, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port,
          path,
          method: "POST",
          headers: {
            host: publicHost ?? `127.0.0.1:${port}`,
            "user-agent": "a2app-mcp-sidecar/0.1.0",
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            "content-length": Buffer.byteLength(payload),
          },
          timeout: timeoutMs,
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            try {
              resolvePromise(parseReply(res.statusCode ?? 0, res.headers["content-type"], Buffer.concat(chunks).toString("utf8")));
            } catch (e) {
              reject(e);
            }
          });
          res.on("error", reject);
        },
      );
      req.on("timeout", () => req.destroy(new McpError("the upstream app did not answer in time", "upstream_timeout")));
      req.on("error", (e) => reject(e instanceof McpError ? e : new McpError(`the upstream app is not reachable: ${e.message}`, "upstream_unavailable")));
      req.end(payload);
    });
  }

  return {
    async initialize() {
      return rpc("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "a2app-mcp-sidecar", version: "0.1.0" },
      });
    },
    /** Every tool the upstream app serves, by name (cached until `refresh`). */
    async tools({ refresh = false } = {}) {
      if (toolsCache && !refresh) return toolsCache;
      const all = [];
      let cursor;
      do {
        const page = await rpc("tools/list", cursor ? { cursor } : {});
        all.push(...(page?.tools ?? []));
        cursor = page?.nextCursor;
      } while (cursor);
      toolsCache = new Map(all.map((t) => [t.name, t]));
      return toolsCache;
    },
    /** `caller` names the agent behind the call (MCP clientInfo title). */
    async call(name, args, { caller } = {}) {
      const params = { name, arguments: args ?? {} };
      if (caller) params._meta = { "io.modelcontextprotocol/clientInfo": { title: caller } };
      return rpc("tools/call", params);
    },
  };
}
