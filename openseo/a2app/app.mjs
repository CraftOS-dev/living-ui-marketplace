/**
 * OpenSEO hooks for the MCP sidecar toolkit (app-owned).
 *
 * OpenSEO is by Ben Senescu and Every App, Inc. (https://openseo.so,
 * https://github.com/every-app/open-seo, MIT). This file never changes it: it
 * says how to install, build and start the pinned release exactly the way
 * OpenSEO's own self-hosting does, in its single-person local mode
 * (AUTH_MODE=local_noauth), on a private loopback port:
 *
 *   install  pnpm install --frozen-lockfile (the version OpenSEO pins)
 *   build    OpenSEO's report widgets + vite build (its Docker image's steps)
 *   start    D1 migrations (when new) → vite preview on 127.0.0.1 →
 *            OpenSEO's own selfhost scheduler loop (rank checks, AI visibility)
 *
 * OpenSEO keeps everything in its local Cloudflare runtime state; that folder
 * is linked out to the app's dataDir, so replacing the release on an update
 * never touches the data. Keys live in <dataDir>/settings.env, set by the
 * person or through the `setup.set_api_keys` operation.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/* ------------------------------------------------------------ settings */

/** The settings this install understands, as the operation's params name them. */
const KEYS = {
  dataforseo_api_key: "DATAFORSEO_API_KEY",
  openrouter_api_key: "OPENROUTER_API_KEY",
  openrouter_model: "OPENROUTER_MODEL",
  openrouter_base_url: "OPENROUTER_BASE_URL",
  google_client_id: "GOOGLE_CLIENT_ID",
  google_client_secret: "GOOGLE_CLIENT_SECRET",
  google_maps_api_key: "GOOGLE_MAPS_API_KEY",
  context_api_key: "CONTEXT_API_KEY",
};

const SETTINGS_HEADER = `# OpenSEO settings for this install (read on every start).
# OpenSEO is by Ben Senescu and Every App, Inc. — https://openseo.so
#
# DATAFORSEO_API_KEY   base64 of "login:password" from https://app.dataforseo.com/api-access
#                      (or ask your agent: app set_keys --dataforseo_login ... --dataforseo_password ...)
# OPENROUTER_API_KEY   optional: SAM, OpenSEO's in-app assistant (any OpenAI-compatible server via OPENROUTER_BASE_URL)
# GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET   optional: Search Console + GA4 (redirect URIs: see app status)
# GOOGLE_MAPS_API_KEY  optional: the Local SEO map     CONTEXT_API_KEY   optional: audits that render JavaScript
# OPENSEO_TELEMETRY    on|off (default off): OpenSEO's anonymous usage heartbeat — turn it on to help OpenSEO count installs
`;

function settingsFile(ctx) {
  return join(ctx.dataDir, "settings.env");
}

function readSettings(ctx) {
  const out = {};
  const file = settingsFile(ctx);
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (v !== "") out[m[1]] = v;
  }
  return out;
}

function writeSettings(ctx, settings) {
  const body = Object.entries(settings)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  writeFileSync(settingsFile(ctx), SETTINGS_HEADER + "\n" + body + "\n", { mode: 0o600 });
}

/** Settings plus the values this install always sets. A secret OpenSEO needs
 *  to encrypt stored Google tokens is generated once and kept. */
function effectiveEnv(ctx) {
  const s = readSettings(ctx);
  if (!s.BETTER_AUTH_SECRET) {
    s.BETTER_AUTH_SECRET = randomBytes(32).toString("hex");
    writeSettings(ctx, s);
  }
  const env = { ...s };
  delete env.OPENSEO_TELEMETRY;
  env.AUTH_MODE = "local_noauth";
  if ((s.OPENSEO_TELEMETRY ?? "off").toLowerCase() !== "on") env.OPENSEO_TELEMETRY_DISABLED = "1";
  return env;
}

/** OpenSEO reads its environment from these files, as in its own local setup. */
function writeUpstreamEnv(ctx) {
  const env = effectiveEnv(ctx);
  const text = "# Written by the agent-app sidecar from data/settings.env on every start. Edit that file, not this one.\n" +
    Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
  for (const rel of [".env.local", ".dev.vars", join("dist", "server", ".dev.vars"), join("dist", "open_seo_audit", ".dev.vars")]) {
    const file = join(ctx.upstreamDir, rel);
    if (rel.startsWith("dist") && !existsSync(join(file, ".."))) continue;
    writeFileSync(file, text, { mode: 0o600 });
  }
  return env;
}

/* --------------------------------------------------------------- tools */

function pnpm(ctx) {
  const pkg = JSON.parse(readFileSync(join(ctx.upstreamDir, "package.json"), "utf8"));
  const m = /^pnpm@([0-9][^+]*)/.exec(pkg.packageManager ?? "");
  return `npx --yes pnpm@${m ? m[1] : "10"}`;
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

/* ---------------------------------------------------------------- data */

const STATE_LINK = [".wrangler", "state"];

function dataState(ctx) {
  return join(ctx.dataDir, "openseo-state");
}

/** OpenSEO's local runtime state (D1, KV, R2, Durable Objects, Workflows) lives
 *  in <upstream>/.wrangler/state; make that a link to <dataDir>/openseo-state. */
function linkData(ctx) {
  const target = dataState(ctx);
  mkdirSync(target, { recursive: true });
  const parent = join(ctx.upstreamDir, STATE_LINK[0]);
  const link = join(parent, STATE_LINK[1]);
  mkdirSync(parent, { recursive: true });
  if (existsSync(link) || isLink(link)) {
    if (isLink(link)) unlinkSync(link);
    else {
      // A real folder (state written before the link existed): keep it.
      if (readdirSync(target).length === 0) {
        for (const name of readdirSync(link)) renameSync(join(link, name), join(target, name));
      }
      rmSync(link, { recursive: true, force: true });
    }
  }
  symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
}

function isLink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

export function detach(dir) {
  const link = join(dir, ...STATE_LINK);
  if (isLink(link)) unlinkSync(link);
}

function migrate(ctx) {
  const dir = join(ctx.upstreamDir, "drizzle", "sqlite");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".sql")).sort() : [];
  const want = sha256(files.join("\n"));
  const stamp = join(ctx.dataDir, "openseo-migrations.sha256");
  if (existsSync(stamp) && readFileSync(stamp, "utf8").trim() === want) return;
  ctx.log(`applying OpenSEO's database migrations (${files.length})`);
  ctx.run(`${pnpm(ctx)} exec wrangler d1 migrations apply DB --local`, { cwd: ctx.upstreamDir, env: { CI: "true" }, retries: 1 });
  writeFileSync(stamp, want + "\n");
}

/* ------------------------------------------------------------- pipeline */

export async function install(ctx) {
  ctx.run(`${pnpm(ctx)} install --frozen-lockfile --config.confirmModulesPurge=false`, {
    cwd: ctx.upstreamDir,
    env: { CI: "true" },
    retries: 2,
  });
}

export async function build(ctx) {
  writeUpstreamEnv(ctx);
  // Only AUTH_MODE reaches the built bundle (OpenSEO's envPrefix); keys do not.
  const want = sha256(`${ctx.pin.sha256}\nAUTH_MODE=local_noauth`);
  const stamp = join(ctx.upstreamDir, "dist", ".a2app-build.sha256");
  if (existsSync(stamp) && readFileSync(stamp, "utf8").trim() === want && existsSync(join(ctx.upstreamDir, "dist", "server"))) {
    ctx.log("OpenSEO is already built for this release");
  } else {
    ctx.run(`${pnpm(ctx)} run build:report-widgets`, { cwd: ctx.upstreamDir });
    ctx.run(`${pnpm(ctx)} exec vite build`, { cwd: ctx.upstreamDir });
    writeFileSync(stamp, want + "\n");
  }
  // A fresh database takes OpenSEO's ~70 migrations, about two minutes on
  // Windows: too long for a boot, fine for a build. Start then finds none new.
  linkData(ctx);
  migrate(ctx);
}

/* ---------------------------------------------------------------- start */

export async function start(ctx) {
  linkData(ctx);
  migrate(ctx);

  let child = null;
  let scheduler = null;

  const boot = async () => {
    writeUpstreamEnv(ctx);
    child = ctx.spawnGuarded(
      process.execPath,
      [join(ctx.upstreamDir, "node_modules", "vite", "bin", "vite.js"), "preview", "--host", "127.0.0.1", "--port", String(ctx.internalPort), "--strictPort"],
      { cwd: ctx.upstreamDir, env: { PORT: String(ctx.internalPort) } },
    );
    const alive = () => child.exitCode === null;
    const ok = await ctx.waitHttp(`${ctx.internalOrigin}${ctx.pin.healthPath ?? "/api/health"}`, 100_000, alive);
    if (!ok) throw new Error(`OpenSEO did not become ready on port ${ctx.internalPort}`);
    // OpenSEO's own scheduler loop: pokes its cron every five minutes so rank
    // checks and AI visibility runs fire on their schedules.
    const { runSelfhostScheduler } = await import(pathToFileURL(join(ctx.upstreamDir, "scripts", "selfhost-scheduler.mjs")).href);
    scheduler = new AbortController();
    runSelfhostScheduler({ port: ctx.internalPort, signal: scheduler.signal, log: (m) => ctx.log(m) }).catch((e) => {
      if (!scheduler.signal.aborted) ctx.log(`scheduler stopped: ${e?.message ?? e}`);
    });
  };

  const stop = async () => {
    scheduler?.abort();
    await ctx.stopGuarded(child);
  };

  await boot();
  return {
    stop,
    /** `whileStopped` runs between stop and boot (e.g. on OpenSEO's database). */
    async restart({ whileStopped } = {}) {
      await stop();
      if (whileStopped) await whileStopped();
      await boot();
    },
  };
}

/** OpenSEO's dashboard backs off a provider fetch that failed: 5 minutes with
 *  nothing cached, shown as "Too many requests" (DashboardCacheService +
 *  data_refresh_claims). Without a key every fetch fails, so once the person
 *  adds a key, those back-offs would hide it for 5 more minutes. Clearing the
 *  claims (rows of in-flight and paused refreshes, nothing else) lets the
 *  dashboard use the new key at once. Run only while OpenSEO is stopped. */
function clearRefreshPauses(ctx) {
  ctx.run(`${pnpm(ctx)} exec wrangler d1 execute DB --local --command "DELETE FROM data_refresh_claims"`, {
    cwd: ctx.upstreamDir,
    env: { CI: "true" },
  });
}

/* ------------------------------------------------- setup problems, named */

/** What to do when OpenSEO reports a key this install has not set. */
function keyHelp(name, ctx) {
  if (name === "DATAFORSEO_API_KEY") {
    return "This needs DataForSEO, OpenSEO's data provider, and no DataForSEO account is set for this install. " +
      "Ask the person for their DataForSEO API login and API password (app.dataforseo.com/api-access; pay as you go), " +
      "then run: app set_keys --dataforseo_login <login> --dataforseo_password <password>. Operations marked (paid) bill that account.";
  }
  if (name === "OPENROUTER_API_KEY") {
    return "This needs an AI model for OpenSEO, and none is set for this install. Ask the person for an OpenRouter API key " +
      "(openrouter.ai/keys) or the address of an OpenAI-compatible server, then run: app set_keys --openrouter_api_key <key> " +
      "(plus --openrouter_base_url <url> for another server).";
  }
  if (name.startsWith("GOOGLE_CLIENT")) return googleHelp(ctx);
  if (name === "GOOGLE_MAPS_API_KEY") {
    return `The Local SEO map needs a Google Maps key (${docUrl(ctx, "GOOGLE_MAPS_SETUP.md")}). Ask the person for one, then run: app set_keys --google_maps_api_key <key>.`;
  }
  if (name === "CONTEXT_API_KEY") {
    return "Rendering JavaScript during an audit needs a Context.dev key. Ask the person for one, then run: app set_keys --context_api_key <key>; or audit without --renderJavaScript.";
  }
  return `This needs ${name}, which is not set for this install. See app status.`;
}

/** OpenSEO's own documentation, at the pinned release. */
function docUrl(ctx, file) {
  return `${ctx.pin.repository}/blob/${ctx.pin.tag ?? ctx.pin.commit}/docs/${file}`;
}

function googleHelp(ctx) {
  return "Search Console and GA4 are not set up for this install. The person needs a Google OAuth client: " +
    `follow OpenSEO's guides ${docUrl(ctx, "SELF_HOSTING_GOOGLE_SEARCH_CONSOLE.md")} and ${docUrl(ctx, "SELF_HOSTING_GOOGLE_ANALYTICS.md")}, ` +
    `with these redirect URIs: ${ctx.publicOrigin}/api/gsc/oauth/callback and ${ctx.publicOrigin}/api/ga4/oauth/callback. ` +
    "Then run: app set_keys --google_client_id <id> --google_client_secret <secret>, and the person connects their " +
    `Google account in OpenSEO (${ctx.publicOrigin}, project settings → Integrations).`;
}

const KEY_NAMES = /\b(DATAFORSEO_API_KEY|OPENROUTER_API_KEY|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|GOOGLE_MAPS_API_KEY|CONTEXT_API_KEY)\b/;

/** OpenSEO reports a missing key in its own words, sometimes inside an answer
 *  whose every item failed. When the key really is unset here, that is a
 *  setup problem with one next step, not a result. A batch where anything
 *  succeeded stays a result. */
export function explain({ text, structured, isError }, ctx) {
  const json = structured ? JSON.stringify(structured) : "";
  const hay = `${text}\n${json}`;
  const m = KEY_NAMES.exec(hay);
  if (!m || !/missing|not set|not configured|required|unavailable/i.test(hay)) return null;
  if (!isError && /"ok":\s*true/.test(json)) return null;
  if (effectiveEnv(ctx)[m[1]]) return null;
  return { code: "key_missing", status: 409, message: keyHelp(m[1], ctx) };
}

/** Search Console and GA4 answer "not connected" in three shapes when this
 *  install has no Google client at all — and the connect links they give lead
 *  nowhere until it has one. Say so before calling. IndexNow needs no Google. */
export function before(call, ctx) {
  if ((call.module === "search-console" || call.module === "analytics") && call.tool !== "submit_indexnow_urls") {
    const env = effectiveEnv(ctx);
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return { code: "not_configured", status: 409, message: googleHelp(ctx) };
  }
  return null;
}

/* ----------------------------------------------------- sidecar operations */

/** OpenSEO's own market list (src/shared/keyword-locations.ts): the country
 *  locationCode and default languageCode every research operation takes. */
function countries(ctx) {
  const src = readFileSync(join(ctx.upstreamDir, "src", "shared", "keyword-locations.ts"), "utf8");
  const body = src.slice(src.indexOf("LOCATION_OPTIONS"), src.indexOf("SERP_LANGUAGE_OPTIONS"));
  const out = [];
  const re = /\{\s*code:\s*(\d+),\s*label:\s*"([^"]+)",\s*shortLabel:\s*"([^"]+)",\s*languageCode:\s*"([^"]+)",?(\s*googleAdsOnly:\s*true,?)?\s*\}/g;
  for (let m; (m = re.exec(body)); ) {
    out.push({ locationCode: Number(m[1]), country: m[2], short: m[3], languageCode: m[4], ...(m[5] ? { keywordDifficulty: false } : {}) });
  }
  return out;
}

async function listCountries(args, ctx) {
  const q = String(args.query ?? "").trim().toLowerCase();
  const all = countries(ctx);
  const rows = q ? all.filter((c) => c.country.toLowerCase().includes(q) || c.short.toLowerCase() === q || String(c.locationCode) === q) : all;
  const lines = rows.map((c) => `${c.country} (${c.short}): --locationCode ${c.locationCode} --languageCode ${c.languageCode}${c.keywordDifficulty === false ? "  [Google Ads data: no difficulty or intent]" : ""}`);
  return {
    text: `${rows.length} of OpenSEO's ${all.length} markets${q ? ` matching "${q}"` : ""}:\n${lines.join("\n")}\nFor a city or region: serp search_serp_locations (needs DataForSEO).`,
  };
}

function keyState(env) {
  const has = (k) => (env[k] ? "set" : "not set");
  return {
    dataforseo: has("DATAFORSEO_API_KEY"),
    openrouter: has("OPENROUTER_API_KEY"),
    google_search_console_and_ga4: env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? "set" : "not set",
    google_maps: has("GOOGLE_MAPS_API_KEY"),
    context: has("CONTEXT_API_KEY"),
  };
}

async function status(_args, ctx) {
  const env = effectiveEnv(ctx);
  let health = null;
  try {
    const res = await fetch(`${ctx.internalOrigin}${ctx.pin.healthPath ?? "/api/health"}`, { signal: AbortSignal.timeout(5000) });
    health = await res.json();
  } catch {
    health = { status: "unreachable" };
  }
  let version = null;
  try {
    version = JSON.parse(readFileSync(join(ctx.upstreamDir, "package.json"), "utf8")).version;
  } catch {
    /* not installed */
  }
  return {
    openseo: {
      by: ctx.pin.authors,
      website: ctx.pin.website,
      repository: ctx.pin.repository,
      license: ctx.pin.license,
      version,
      release: ctx.pin.tag,
      mode: "local, single person (AUTH_MODE=local_noauth)",
    },
    open_in_browser: ctx.publicOrigin,
    mcp_endpoint: `${ctx.publicOrigin}${ctx.pin.mcpPath ?? "/mcp"}`,
    health: { status: health?.status ?? "unknown", checks: health?.checks ?? {} },
    keys: keyState(env),
    telemetry: env.OPENSEO_TELEMETRY_DISABLED ? "off" : "on",
    settings_file: settingsFile(ctx),
    google_redirect_uris: [`${ctx.publicOrigin}/api/gsc/oauth/callback`, `${ctx.publicOrigin}/api/ga4/oauth/callback`],
    tools: { missing_upstream: ctx.drift?.missing ?? [], not_mapped: ctx.drift?.unmapped ?? [] },
  };
}

async function setApiKeys(args, ctx) {
  const s = readSettings(ctx);
  let changed = 0;
  if (args.dataforseo_login !== undefined || args.dataforseo_password !== undefined) {
    if (!args.dataforseo_login || !args.dataforseo_password) {
      throw new ctx.OperationError("invalid_param", "Give both dataforseo_login and dataforseo_password, or dataforseo_api_key.", 400);
    }
    s.DATAFORSEO_API_KEY = Buffer.from(`${args.dataforseo_login}:${args.dataforseo_password}`).toString("base64");
    changed++;
  }
  for (const [param, key] of Object.entries(KEYS)) {
    if (args[param] === undefined || (param === "dataforseo_api_key" && args.dataforseo_login !== undefined)) continue;
    const v = String(args[param]).trim();
    if (v === "") delete s[key];
    else s[key] = v;
    changed++;
  }
  if (args.telemetry !== undefined) {
    s.OPENSEO_TELEMETRY = args.telemetry === true || args.telemetry === "true" ? "on" : "off";
    changed++;
  }
  if (changed === 0) {
    throw new ctx.OperationError("invalid_param", "Nothing to set: pass at least one key (an empty value clears it).", 400);
  }
  writeSettings(ctx, s);
  // OpenSEO reads keys at start: restart it (the View is back in a few
  // seconds), dropping the dashboard's back-offs from the keyless attempts.
  await ctx.upstream.restart({ whileStopped: () => clearRefreshPauses(ctx) });
  return { restarted: true, ...(await status({}, ctx)) };
}

/* ---------------------------------------------------------------- guide */

/** OpenSEO's own agent skills (plugins/openseo/skills/<name>/SKILL.md). */
function playbooks(ctx) {
  const dir = join(ctx.upstreamDir, "plugins", "openseo", "skills");
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const file = join(dir, name, "SKILL.md");
    if (!existsSync(file)) continue;
    const m = /^description:\s*"?(.*?)"?\s*$/m.exec(readFileSync(file, "utf8"));
    const desc = (m?.[1] ?? "").split(/(?<=\.)\s/)[0];
    out.push({ name, file, about: desc.length > 110 ? desc.slice(0, 109).trimEnd() + "…" : desc });
  }
  return out;
}

function moduleOfOps(ctx) {
  const ops = JSON.parse(readFileSync(join(ctx.appDir, "operations.json"), "utf8")).operations ?? [];
  return new Map(ops.map((o) => [o.name, o.module]));
}

async function guide(args, ctx) {
  const list = playbooks(ctx);
  const topic = String(args.topic ?? "").trim();
  if (topic) {
    const p = list.find((x) => x.name === topic);
    if (!p) throw new ctx.OperationError("not_found", `No playbook "${topic}". Playbooks: ${list.map((x) => x.name).join(", ")}.`, 404);
    const body = readFileSync(p.file, "utf8").replace(/^---[\s\S]*?---\s*/, "");
    const where = moduleOfOps(ctx);
    const used = [...new Set([...body.matchAll(/`([a-z][a-z0-9_]+)`/g)].map((m) => m[1]))].filter((n) => where.has(n));
    return {
      playbook: topic,
      by: "OpenSEO (Ben Senescu and Every App, MIT): its own agent skill, unchanged",
      how: "The tools it names are this app's operations: a2app <app> <module> <tool> --param value. Where they are: " +
        used.map((n) => `${n} → ${where.get(n)}`).join(", ") + ".",
      text: body,
    };
  }

  const env = effectiveEnv(ctx);
  const keys = keyState(env);
  const lines = [
    "OpenSEO — by Ben Senescu and Every App (openseo.so, MIT), running unchanged. Every operation is one of OpenSEO's own MCP tools, same name.",
    "",
    `Set up now: DataForSEO ${keys.dataforseo}, AI model ${keys.openrouter}, Google ${keys.google_search_console_and_ga4}.`,
    ...(keys.dataforseo === "set" ? [] : ["  Paid research needs DataForSEO: ask the person for their DataForSEO API login and password, then: app set_keys --dataforseo_login … --dataforseo_password …"]),
    "",
    "Start: projects list_projects (nearly every operation takes --projectId). No project yet: projects create_project --name … --domain … (market codes: serp list_countries --query <country>).",
    "Read projects get_project_context before research; write durable findings back with update_project_context.",
    "Calling: a2app <app> <module> <operation> --param value. A module's list shows each operation's required params; --help shows all of them.",
    "  Lists: JSON or comma-separated. Long values from a file: --html @report.html (or @- for stdin).",
    "",
    `Results (--view on every OpenSEO operation): text (default) = OpenSEO's compact answer for agents, cut at ${textLimit.toLocaleString("en-US")} characters with truncated{} saying so, plus ids and url (OpenSEO's page for it);`,
    "  full = all of the text; data = OpenSEO's JSON. --field text prints the text raw; --out <file> saves instead of printing. Lists are paged: the text says when there is more.",
    "Money: (paid) operations bill DataForSEO. OpenSEO's estimates are in credits: 1,000 credits = $1 (hosted prices; self-hosted pays DataForSEO a little less).",
    "  Before run_rank_tracker / run_ai_visibility_check: estimate first, tell the person the figure, pass the cap.",
    "Approval: deletions, public sharing and recurring charges answer approval_required. Tell the person the real effect in plain words. A key works once.",
    "Background jobs: run_site_audit → get_audit_status → get_audit_issues; run_ai_visibility_check → get_ai_visibility_run; run_rank_tracker → get_rank_tracker.",
    "Errors (branch on code): key_missing / not_configured → ask the person, the message says for what; invalid_param → fix that parameter; not_found → list first; upstream_refused → OpenSEO's own reason.",
    "",
    "Playbooks, OpenSEO's own skills: app guide --topic <name>",
    ...list.map((p) => `  ${p.name} — ${p.about}`),
  ];
  return { text: lines.join("\n") };
}

export const ops = {
  guide,
  status,
  set_api_keys: setApiKeys,
  list_countries: listCountries,
};

/** OpenSEO's text answers are written for agents; past this many characters
 *  the sidecar cuts them at a line and says so (`--view full` for all). */
export const textLimit = 12_000;

export const credentialHint = "Read the app's .agent-token file in the app folder.";

export const conventions = {
  about: "OpenSEO by Ben Senescu & Every App (openseo.so, MIT), unchanged; every operation is its own MCP tool of the same name.",
  start: "Run `app guide` first.",
};
