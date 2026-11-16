// Assemble <app>/AGENT_APP.md: the kernel frame (kept as kernel-core wrote it, up to "## Modules") plus one
// section per module generated from the code: its guide section (guide_<module>.js), its operations with
// your AI agent's rule per op (cat_*.js), its triggers with each recipe's summary (events_*.js + guide),
// its cron (cron_<module>.js), the events it emits, its settings keys and import targets, and, when a
// seeded server is given, the Next item kinds it raises (next.list on that server, by module). The
// external data table comes from manifest.json capabilities.
//   node gen_agent_md.mjs <app dir> [--port 3192]   (refuses em and en dashes in the result)
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const APP = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
const pi = args.indexOf('--port');
const PORT = pi >= 0 ? Number(args[pi + 1]) : null;
const HOOKS = join(APP, 'pb', 'pb_hooks');
const require = createRequire(join(HOOKS, 'x.js'));
const load = (f) => require(join(HOOKS, f));
const files = readdirSync(HOOKS);

// Which builder owns each catalog file (SPEC 15): kernel-records' files carry other prefixes.
const RECORDS = /^cat_(records|deals_core|files|theses)_?/;
const moduleOfCat = (f) => {
  if (/^cat_(app|auth|settings|kernel)_/.test(f)) return 'kernel';
  if (RECORDS.test(f)) return 'records';
  return /^cat_([a-z0-9]+)_/.exec(f)[1];
};
const ORDER = ['kernel', 'records', 'network', 'intake', 'deals', 'diligence', 'committee', 'portfolio', 'funds', 'markets', 'home'];
const LABEL = { kernel: 'kernel-core', records: 'kernel-records' };

const ops = {};
for (const f of files.filter((n) => /^cat_[a-z0-9_]+\.js$/.test(n)).sort()) {
  const m = moduleOfCat(f);
  for (const o of load(f)) (ops[m] ??= []).push(o);
}
const guide = (m) => (existsSync(join(HOOKS, `guide_${m}.js`)) ? load(`guide_${m}.js`) : null);
const events = (m) => (existsSync(join(HOOKS, `events_${m}.js`)) ? load(`events_${m}.js`) : null);
const cron = (m) => (existsSync(join(HOOKS, `cron_${m}.js`)) ? load(`cron_${m}.js`) : []);
const lines = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v.map(String) : [String(v)]);

// Next kinds per module from a seeded server (optional).
let nextKinds = {};
if (PORT !== null) {
  const { client } = await import('file:///' + join(APP, 'tools', 'dev', 'api.mjs').replace(/\\/g, '/'));
  const api = client({ port: PORT, app: APP });
  const seen = {};
  for (const as of ['owner', 'partner@venture.test', 'finance@venture.test', 'platform@venture.test']) {
    const r = await api.call('next.list', { limit: 200 }, { as });
    for (const it of r.body?.items ?? []) ((seen[it.module] ??= new Set())).add(it.kind);
  }
  nextKinds = Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, [...v].sort()]));
}

const rule = (o) => (o.agent === 'deny' ? 'people' : o.agent === 'propose' ? 'propose' : 'allow');
function opsBlock(list) {
  const groups = {};
  for (const o of list) {
    const [g, v] = o.name.split('.');
    (groups[g] ??= []).push(v + (o.agent === 'deny' ? '*' : o.agent === 'propose' ? '+' : ''));
  }
  const c = { allow: 0, propose: 0, people: 0 };
  const kinds = new Set();
  for (const o of list) {
    c[rule(o)]++;
    if (o.agent === 'propose' && o.kind) kinds.add(o.kind);
  }
  const out = [];
  out.push(`- **Operations (${list.length})**: ${c.allow} your AI agent runs, ${c.propose} it proposes${kinds.size ? ' (' + [...kinds].sort().join(', ') + ')' : ''}, ${c.people} people only. Verbs marked + are proposals for your AI agent, * are people only.`);
  for (const g of Object.keys(groups).sort()) out.push(`  - \`${g}\`: ${groups[g].join(', ')}`);
  return out;
}

const sections = [];
const kernelOps = ops.kernel?.length ?? 0;
for (const m of ORDER) {
  if (m === 'kernel') continue;
  const list = ops[m] ?? [];
  const gmod = m === 'records' ? 'records' : m;
  const g = guide(gmod);
  const ev = events(gmod);
  const cr = cron(gmod);
  if (list.length === 0 && g === null) continue;
  const out = [];
  out.push(`### ${g?.title ?? m} (\`${m}\`${LABEL[m] ? ', ' + LABEL[m] : ''})`);
  out.push('');
  for (const r of lines(g?.section)) out.push('- ' + r);
  out.push(...opsBlock(list));
  const trig = ev?.triggers ?? {};
  if (Object.keys(trig).length > 0) {
    out.push('- **Triggers** (one per task; the full recipe is app.guide --recipe <trigger>):');
    for (const [k, t] of Object.entries(trig)) {
      const steps = lines(g?.[k]);
      out.push(`  - \`${k}\` { ${t.param || 'no params'} }: ${steps[0] ?? t.description}`);
    }
  }
  if (nextKinds[m]?.length) out.push(`- **Next items**: ${nextKinds[m].join(', ')}`);
  else if (ev?.needsYou) out.push('- **Next items**: yes (needsYou)');
  if (cr.length > 0) out.push(`- **Cron (firm zone)**: ${cr.map((c) => `\`${c.name}\` ${c.schedule}${c.catchUp ? ' (catch-up)' : ''}`).join('; ')}`);
  const emits = lines(g?.events);
  if (emits.length > 0) out.push(`- **Events it emits**: ${emits.join('; ')}`);
  const on = Object.keys(ev?.on ?? {});
  if (on.length > 0) out.push(`- **Events it listens to**: ${on.join(', ')}`);
  if (ev?.today) out.push('- **app.today block**: yes');
  const sk = ev?.settingsKeys ?? {};
  for (const [k, v] of Object.entries(sk)) out.push(`- **Settings** \`modules.${k}\`: ${Object.keys(v).join(', ')}`);
  const im = ev?.imports ?? {};
  if (Object.keys(im).length > 0) out.push(`- **Import targets**: ${Object.entries(im).map(([k, v]) => `\`${k}\` (${v.label})`).join(', ')}`);
  out.push('');
  sections.push(out.join('\n'));
}

// The kernel frame as kernel-core wrote it, with its op count refreshed.
const old = readFileSync(join(APP, 'AGENT_APP.md'), 'utf8');
const head = old.slice(0, old.indexOf('## Modules')).replace(/Kernel op groups \(\d+ ops\)/, `Kernel op groups (${kernelOps} ops)`);
const total = Object.values(ops).reduce((n, l) => n + l.length, 0);
const kinds = ORDER.flatMap((m) => Object.keys(events(m === 'records' ? 'records' : m)?.triggers ?? {}));
const man = JSON.parse(readFileSync(join(APP, 'manifest.json'), 'utf8'));
const HOSTS = {
  'api.frankfurter.dev': ['Exchange rates (ECB), dated and cached by day', 'none', '`lib_fx.js`'],
  'cdn.jsdelivr.net': ['Exchange rates fallback (currency-api)', 'none', '`lib_fx.js`'],
  'www.sec.gov': ['SEC EDGAR Form D filings for radars (declared User-Agent, under 10 requests a second)', 'none', '`lib_markets_pull.js`'],
  'hacker-news.firebaseio.com': ['Show HN launches for radars', 'none', '`lib_markets_pull.js`'],
  'news.ycombinator.com': ['The Show HN discussion link kept as a signal source', 'none', '`lib_markets_pull.js`'],
  'api.github.com': ['GitHub repository search for radars (unauthenticated)', 'none', '`lib_markets_pull.js`'],
};
const ACTIONS = {
  search_gmail: 'Gmail: the deals and updates labels, capture headers',
  get_gmail: 'Gmail: one message (headers only for capture)',
  download_gmail_attachment: 'Gmail: decks and update files',
  send_gmail: 'Gmail: approved messages only (confirm irreversible)',
  list_google_calendar_events: "Google Calendar: the owner's events (Today, briefs, notes)",
};
const ext = [
  '## External data',
  '',
  '| Source | Used for | Auth | Called from |',
  '|--------|----------|------|-------------|',
  ...(man.capabilities?.external_hosts ?? []).map((h) => `| ${h} | ${HOSTS[h]?.[0] ?? ''} | ${HOSTS[h]?.[1] ?? 'none'} | ${HOSTS[h]?.[2] ?? ''} |`),
  ...(man.capabilities?.actions ?? []).map((a) => `| CraftBot \`${a}\` | ${ACTIONS[a] ?? ''} | CraftBot's connected account | \`lib_mail.js\`, \`lib_network_capture.js\`, \`lib_outbound.js\` |`),
  '',
  'Nothing pushes into the app: mail and calendar are pulled on cron. A provider failure answers HTTP 200 with `{ status: "error" }`; every call checks it. Outside CraftBot the bridge answers 503 and the app says "Connect Gmail in CraftBot" once, in Settings, Capture.',
  '',
].join('\n');
const tail = old.slice(old.indexOf('## Generated files'));
const tailNoExt = tail.replace(/## External data[\s\S]*?(?=## Ownership map)/, ext + '\n');

const body = [
  head.trimEnd(),
  '',
  '## Modules',
  '',
  `${total} operations, ${kinds.length} triggers (the kernel's question_asked plus the modules' ${kinds.length - 1}; one per task: Agent triggers above). Generated from the code by \`reference/tests/home/gen_agent_md.mjs\` (the guide sections are each module's own words in \`guide_<module>.js\`; \`app.guide --module <module>\` serves the same with the recipes in full).`,
  '',
  sections.join('\n'),
  tailNoExt.trimEnd(),
  '',
].join('\n');
if (/[\u2013\u2014]/.test(body)) {
  const at = body.search(/[\u2013\u2014]/);
  console.error('AGENT_APP.md would contain an en or em dash near: ' + body.slice(Math.max(0, at - 80), at + 20));
  process.exit(1);
}
writeFileSync(join(APP, 'AGENT_APP.md'), body);
console.log(`AGENT_APP.md: ${total} operations, ${sections.length} module sections, ${body.length} characters${PORT !== null ? ', Next kinds from :' + PORT : ''}`);
