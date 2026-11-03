/**
 * One fetch wrapper for the whole View (AGENT-OWNED): 10 s timeout on every
 * call, JSON in and out, and errors surfaced as messages a screen can show.
 * Idempotent GETs retry once on network failure with a short jittered delay;
 * writes never retry (the UI disables the control instead, so a retry is the
 * user's call).
 */
export async function api(path, init = {}, { retryGet = true } = {}) {
  const isGet = !init.method || init.method === "GET";
  try {
    const res = await fetch(path, {
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(10_000),
      ...init,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) {
      let message = String(
        json?.message ?? `The app answered with an error (HTTP ${res.status}).`,
      ).replace(/^Operation "[^"]+" threw:\s*/, "");
      if (path === "/api/ops/project-open" && /ENOENT|ENOTDIR/.test(message))
        message =
          "That folder could not be found. Browse to an existing folder or check the path.";
      if (
        path === "/api/ops/format-text" &&
        /ENOENT|python|black/i.test(message)
      ) {
        let documentPath = "";
        try {
          documentPath = JSON.parse(init.body || "{}").path || "";
        } catch {}
        if (documentPath.endsWith(".py"))
          message =
            "Python formatting is unavailable. Choose a valid Python interpreter in Settings and install Black in that interpreter.";
      }
      throw Object.assign(new Error(message), {
        status: res.status,
        code: json?.code,
        approvalKey: json?.approvalKey,
      });
    }
    return json;
  } catch (err) {
    if (isGet && retryGet && !(err && "status" in err)) {
      await new Promise((r) => setTimeout(r, 300 + Math.random() * 300));
      return api(path, init, { retryGet: false });
    }
    if (err?.name === "TimeoutError")
      throw new Error("The app took too long to answer.");
    if (err instanceof TypeError)
      throw new Error("The app is not reachable right now.");
    throw err;
  }
}
