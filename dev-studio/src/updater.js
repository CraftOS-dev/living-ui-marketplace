/**
 * Bridge to the update watcher (AGENT-OWNED; the watcher itself is system-owned,
 * served by server.mjs at /_a2app/update.js from the project root).
 *
 * It is a RUNTIME import — the file exists only on the running server, so the
 * `@vite-ignore` comment keeps the bundler from trying to resolve it at build
 * time. Loading it starts the watch: a CODE change reloads when the page holds
 * nothing unsaved (else offers a banner); a DATA change dispatches
 * `a2app:datachange` on window, which App.jsx listens for. Keep this bridge
 * when you rewrite the View — without it, already-open tabs go stale forever.
 */
const watcher = import(/* @vite-ignore */ "/_a2app/update.js").catch(() => null);

/** Does the page hold anything a reload or re-render would destroy? Falls back
 *  to `true` (assume unsaved) when the watcher is unreachable — the failure
 *  mode must be a skipped refresh, never discarded work. */
export async function hasUnsavedInput() {
  const mod = await watcher;
  return mod === null ? true : mod.hasUnsavedInput();
}
