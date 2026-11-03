/**
 * The update watcher (SYSTEM-OWNED — hash-locked in the ownership canon).
 *
 * Served by `server.mjs` at `/_a2app/update.js`. A View loads it with one line
 * and an already-open tab stops being a lie:
 *
 *     <script type="module" src="/_a2app/update.js"></script>
 *
 * A loaded page can be wrong in two unrelated ways, and they need opposite
 * cures. This polls identity and tells them apart:
 *
 *   CODE changed   (`appVersion` / `schemaVersion` moved) — the page is running
 *                  superseded JavaScript. Only a reload fixes that.
 *   DATA changed   (`dataVersion` moved) — the code is current but the rows are
 *                  stale, typically because an agent wrote through A2App. The
 *                  page must RE-READ. Reloading would fix it too, and would also
 *                  throw away whatever the person is halfway through typing, for
 *                  a change that was never about their page.
 *
 * Before `dataVersion` existed there was no marker for the second case at all:
 * `appVersion` fingerprints the served bytes and `schemaVersion` the model, so
 * both are byte-identical after a record is created. An open tab could not
 * observe agent writes, at any poll rate.
 *
 * ON RELOADING. An earlier version of this file never reloaded, on the grounds
 * that reloading someone mid-invoice destroys unrecoverable work. That reasoning
 * still holds and is still enforced — but it is enforced by checking whether
 * there IS anything to lose, rather than by assuming there always is. A code
 * change now reloads immediately when the page holds no unsaved input, and falls
 * back to the same dismissible banner when it does. See {@link hasUnsavedInput}:
 * if that check cannot prove the page is safe, the person is asked.
 *
 * Loading the module starts the watch. `watchForUpdates` is exported for a View
 * that wants its own affordance instead.
 */

/** Poll interval while the tab is visible. Long enough to be invisible in a
 *  server log, short enough that someone who tabs back after a promote is told
 *  before they type into a form the new version has changed. */
const POLL_MS = 20_000;
/**
 * Poll interval while the tab is HIDDEN — slow, and the answer is discarded.
 *
 * A hidden tab has nobody to show a banner to, so it does not need versions. But
 * it is still a tab the person has open, and the app counts viewers from these
 * probes: go fully silent and a backgrounded tab ages out of the count, after
 * which `open --if-needed` opens a duplicate on top of the one they already had.
 * Kept under the server's viewer TTL so a parked tab stays counted, and slow
 * enough that a browser full of parked apps is still not a poll storm.
 */
const HIDDEN_POLL_MS = 45_000;
/** After a failed probe — a restart is exactly when probes fail, and a tight
 *  retry loop against a booting server helps nobody. */
const RETRY_MS = 5_000;
const BANNER_ID = "a2app-update-banner";

/**
 * This tab's opaque viewer id, sent with every probe.
 *
 * It lets the app answer "is anyone actually looking at me?" so the CLI can
 * decide whether opening a browser would reach a person or just pile up another
 * duplicate tab. It is random per page load, never persisted, and never
 * correlated with an account — the server keeps a count, not a guest list.
 */
const VIEWER_ID =
  globalThis.crypto?.randomUUID?.() ?? `v_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

/** The identity fields that together mean "the CODE you loaded is superseded".
 *  `appVersion` is the marker that moves for a View change; `schemaVersion` is
 *  included because a model change also invalidates what a loaded page believes,
 *  and an adapter that publishes no `appVersion` still gets that much. */
function codeVersionOf(identity) {
  if (identity === null || typeof identity !== "object") return null;
  const app = identity.appVersion ?? "";
  const schema = identity.schemaVersion ?? "";
  const both = `${app}|${schema}`;
  return both === "|" ? null : both;
}

/** The marker that moves when records change. Absent on an older adapter, in
 *  which case data watching is simply off rather than wrongly triggered. */
function dataVersionOf(identity) {
  if (identity === null || typeof identity !== "object") return null;
  const data = identity.dataVersion;
  return typeof data === "string" && data !== "" ? data : null;
}

async function probe(base) {
  const res = await fetch(`${base}/api/_a2app`, {
    cache: "no-store",
    headers: { accept: "application/json", "x-a2app-viewer": VIEWER_ID },
  });
  if (!res.ok) throw new Error(`identity responded ${res.status}`);
  const identity = await res.json();
  return { code: codeVersionOf(identity), data: dataVersionOf(identity) };
}

/**
 * Does this page hold anything a reload would destroy?
 *
 * The question the no-auto-reload rule was really protecting against. A field is
 * "unsaved" when it differs from the value the markup shipped with, so a form
 * the View just rendered with defaults reads as clean while a half-typed invoice
 * reads as dirty. An open `<dialog>` counts too: a confirmation someone is
 * looking at is state, even with nothing typed into it.
 *
 * Deliberately conservative — anything it cannot classify counts as unsaved, so
 * the failure mode is an unnecessary banner rather than lost work.
 */
export function hasUnsavedInput(doc = document) {
  try {
    if (doc.querySelector("dialog[open]") !== null) return true;

    for (const el of doc.querySelectorAll("input, textarea")) {
      if (el.disabled || el.readOnly) continue;
      const type = (el.type ?? "").toLowerCase();
      if (type === "hidden" || type === "submit" || type === "button" || type === "reset") continue;
      if (type === "checkbox" || type === "radio") {
        if (el.checked !== el.defaultChecked) return true;
        continue;
      }
      if (el.value !== el.defaultValue) return true;
    }

    for (const el of doc.querySelectorAll("select")) {
      if (el.disabled) continue;
      if (el.multiple) {
        for (const option of el.options) {
          if (option.selected !== option.defaultSelected) return true;
        }
        continue;
      }
      // A single select with no `selected` attribute anywhere still has an
      // option selected — the browser picks the first one. Comparing
      // `selected !== defaultSelected` therefore called EVERY such dropdown
      // dirty, which made every page holding one permanently unreloadable and
      // silently blocked its data refresh too. Compare against the value the
      // control would have had on load instead: the explicitly marked option if
      // there is one, else the first.
      const options = Array.from(el.options);
      const initial = options.find((o) => o.defaultSelected) ?? options[0];
      if (initial !== undefined && el.value !== initial.value) return true;
    }

    for (const el of doc.querySelectorAll("[contenteditable=''],[contenteditable='true']")) {
      if ((el.textContent ?? "").trim() !== "") return true;
    }
    return false;
  } catch {
    // An unreadable DOM is not a page we can prove is safe.
    return true;
  }
}

/**
 * The default affordance when a reload cannot be taken safely: one dismissible
 * bar, bottom-left, out of the way of the primary action most Views put
 * bottom-right.
 *
 * Styles are inline and namespaced rather than injected as a stylesheet, so this
 * cannot collide with — or be restyled out of existence by — the app's own CSS.
 * `role="status"` with `aria-live="polite"` announces it to a screen reader
 * without interrupting whatever the person is doing.
 */
function showBanner(onReload) {
  if (document.getElementById(BANNER_ID) !== null) return;

  const bar = document.createElement("div");
  bar.id = BANNER_ID;
  bar.setAttribute("role", "status");
  bar.setAttribute("aria-live", "polite");
  bar.style.cssText = [
    "position:fixed",
    "left:1rem",
    "bottom:1rem",
    "z-index:2147483000",
    "display:flex",
    "gap:.75rem",
    "align-items:center",
    "max-width:min(30rem,calc(100vw - 2rem))",
    "padding:.6rem .75rem",
    "border-radius:10px",
    "border:1px solid rgba(128,128,128,.4)",
    "background:Canvas",
    "color:CanvasText",
    "color-scheme:light dark",
    "box-shadow:0 6px 24px rgba(0,0,0,.18)",
    "font:14px/1.4 system-ui,sans-serif",
  ].join(";");

  const text = document.createElement("span");
  text.style.cssText = "flex:1";
  // Say WHY it was not taken automatically, so the banner reads as a deliberate
  // hold rather than as the app failing to update itself.
  text.textContent = "A new version is available. Your unsaved changes are holding the update.";

  const reload = document.createElement("button");
  reload.type = "button";
  reload.textContent = "Reload";
  reload.style.cssText =
    "font:inherit;cursor:pointer;padding:.3rem .7rem;border-radius:8px;border:1px solid currentColor;background:transparent;color:inherit";
  reload.addEventListener("click", onReload);

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.textContent = "×";
  dismiss.title = "Dismiss";
  dismiss.setAttribute("aria-label", "Dismiss");
  dismiss.style.cssText =
    "font:inherit;cursor:pointer;padding:.1rem .4rem;border:none;background:none;color:inherit;opacity:.7";
  // Dismiss silences THIS version only: the watcher reports each version once,
  // so a later promote raises a fresh notice. Someone who said "not now" has not
  // said "never tell me".
  dismiss.addEventListener("click", () => bar.remove());

  bar.append(text, reload, dismiss);
  document.body.appendChild(bar);
}

/**
 * Reload now if nothing would be lost; otherwise offer it.
 *
 * The whole of the auto-reload decision, in one place, so there is exactly one
 * path from "code changed" to `location.reload()` and it is guarded.
 */
function reloadWhenSafe() {
  if (hasUnsavedInput()) {
    showBanner(() => location.reload());
    return;
  }
  location.reload();
}

/**
 * Watch for a newer version of the app and surface it. Returns a `stop()`.
 *
 * - `onUpdate(version)` replaces the CODE-change behaviour, including the
 *   auto-reload. A handler that calls `location.reload()` is writing that line
 *   itself, in app-owned code, with the consequence in view.
 * - `onDataChange(version)` is called when records changed. There is no default:
 *   only the View knows how to re-read itself without discarding a form its user
 *   is in the middle of, so the framework reports and the View decides. A
 *   `a2app:datachange` event is dispatched on `window` either way, so a View can
 *   subscribe without owning the watcher.
 */
export function watchForUpdates(options = {}) {
  const base = options.base ?? "";
  const pollMs = options.pollMs ?? POLL_MS;
  const onUpdate = options.onUpdate ?? reloadWhenSafe;
  const onDataChange = options.onDataChange ?? null;

  let loadedCode = null; // the code version this page is running
  let notifiedCode = null; // the newest code version already reported
  let seenData = null; // the data version as of the last re-read
  let timer = null;
  let stopped = false;

  const schedule = (ms) => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(tick, ms);
  };

  async function tick() {
    if (stopped) return;
    // Hidden: heartbeat only. There is nobody to show a banner to and nothing to
    // re-render, so the answer is discarded — but the probe still tells the app
    // this tab exists, which is what stops `open --if-needed` from opening a
    // second window over a tab the person merely switched away from.
    if (document.visibilityState === "hidden") {
      try {
        await probe(base);
      } catch {
        /* a heartbeat that misses is not worth reporting or retrying fast */
      }
      schedule(HIDDEN_POLL_MS);
      return;
    }
    let version;
    try {
      version = await probe(base);
    } catch {
      // A restart — which is exactly when the version is about to change — looks
      // like this. Keep the baseline and try again; never report an unreachable
      // app as an update.
      schedule(RETRY_MS);
      return;
    }
    // A probe issued before stop() resolves after it. Without this, stopping the
    // watch would still let one last banner appear over a page that asked to be
    // left alone.
    if (stopped) return;

    // Data first: it is the cheap, non-destructive one, and when a deploy
    // changes both, re-reading before the reload costs nothing.
    if (version.data !== null) {
      if (seenData === null) seenData = version.data;
      else if (version.data !== seenData) {
        seenData = version.data;
        try {
          window.dispatchEvent(new CustomEvent("a2app:datachange", { detail: { dataVersion: version.data } }));
          if (onDataChange !== null) onDataChange(version.data);
        } catch (err) {
          console.error("[a2app] data-change handler failed", err);
        }
      }
    }

    if (version.code !== null) {
      if (loadedCode === null) loadedCode = version.code;
      // Each version is reported ONCE. Polling is how we find out; it must not
      // be how often the app nags. Without this a handler that draws its own UI
      // (or logs, or posts) would fire on every tick for as long as the tab
      // stayed open on a superseded build.
      if (version.code !== loadedCode && version.code !== notifiedCode) {
        notifiedCode = version.code;
        try {
          onUpdate(version.code);
        } catch (err) {
          // A broken handler must not kill the watch, and must not be silent.
          console.error("[a2app] update handler failed", err);
        }
      }
    }
    schedule(pollMs);
  }

  // Re-check the moment the tab is looked at again, rather than up to a poll
  // interval later — returning to a tab is when staleness is noticed.
  const onVisible = () => {
    if (document.visibilityState === "visible") schedule(0);
  };
  document.addEventListener("visibilitychange", onVisible);

  // Say goodbye on the way out so the viewer count drops immediately instead of
  // when the entry expires. `pagehide` (not `unload`) is the event that still
  // fires reliably on mobile and with bfcache, and `keepalive` is what lets the
  // request outlive the page that sent it.
  const onLeave = () => {
    const url = `${base}/api/_a2app?viewer=${encodeURIComponent(VIEWER_ID)}&leaving=1`;
    try {
      // sendBeacon is the one request a closing page is guaranteed to get out —
      // a `keepalive` fetch is cancelled with the renderer often enough to be
      // useless here (it does not survive a tab close in Chromium). It cannot
      // set headers, hence the query string.
      if (navigator.sendBeacon?.(url)) return;
      void fetch(url, { method: "POST", cache: "no-store", keepalive: true });
    } catch {
      // Best effort: a missed goodbye just means the entry lapses on its TTL.
    }
  };
  window.addEventListener("pagehide", onLeave);

  void tick();

  return function stop() {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("pagehide", onLeave);
  };
}

/* Loading the module starts the watch — `<script type="module"
   src="/_a2app/update.js">` is the whole integration. Guarded so that a View
   which also calls `watchForUpdates()` explicitly ends up with one watcher, not
   two racing to draw the same banner. */
if (!globalThis.__a2appUpdateWatch) {
  globalThis.__a2appUpdateWatch = watchForUpdates();
}
