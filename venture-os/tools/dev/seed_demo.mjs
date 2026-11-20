/**
 * The Venture OS demo firm, seeded through operations only (owned by the home builder; used by QA and demos).
 *
 *   node tools/dev/seed_demo.mjs <app dir> <port> [bridge port] [--fresh]
 *
 * Larkspur Ventures (USD, New York): two funds (Fund I 2023 USD 60M investing, Fund II 2025 USD 120M
 * raising to a USD 150M final close), 12 LPs, 15 portfolio companies with 18 months of KPIs (Kestrel
 * Robotics breaks out, Lumora Energy runs short of cash, Tidewater Health is written down), each with a
 * founder update for the last month, asks, board meetings with decks and update requests; inbound over
 * 12 months by email, upload, scouts, radars and CSV; deals in every stage of Deal flow, SPV, Fund raise
 * and Program, each room with a deck, notes, a checklist with answers and a memo; three IC meetings (two
 * closed with decisions, conditions and an anti-portfolio, one live today with votes due); quarterly
 * capital calls with one Fund I call late and a Fund II call half paid, two paid distributions; Fund I
 * and Fund II quarters closed and sent, Fund I's last quarter with your AI agent's draft marks; reserve
 * plans and scenarios; three theses with candidates, maps and grids; LP interactions, intros, tasks,
 * comments, proposals, sent mail and drafts, and work your AI agent finished. Every date is relative to
 * today, so the story holds whenever it runs.
 *
 * The firm is a demo: settings mail.demo is set right after setup, so it never reads Gmail or the
 * calendar, every send is recorded as sent without leaving the app, and no trigger ever fires (a demo
 * firm never asks your AI agent). The work your AI agent finished in the story (deck readings, briefs,
 * marks, letters, answers) is written here directly through its own ops; every switch that lets the app
 * ask it on its own stays off, and the seed checks the mock bridge saw no fire: the demo firm ends with
 * no pending agent work. --fresh stops the app and the
 * mock bridge, wipes the scratch database and starts both (never the delivered app folder, never a
 * live port).
 * Sign in as owner@venture.test (Olivia Hart), password demo-pass-1, PIN 123456; the team uses the same
 * password and PIN (partner@, partner2@, principal@, analyst@, finance@, platform@venture.test).
 */
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { client, DEMO } from './api.mjs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const FRESH = process.argv.includes('--fresh');
const APP = resolve(args[0] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const PORT = Number(args[1] ?? process.env.VO_PORT ?? 3193);
const BRIDGE = args[2] !== undefined ? Number(args[2]) : null;
const DEV = join(APP, 'tools', 'dev');
for (const p of [PORT, BRIDGE]) if (p !== null && ((p >= 3100 && p <= 3179) || p >= 3900)) throw new Error('refusing port ' + p + ' (live or shadow)');

/* ------------------------------------------------------------------ time */

const ZONE = 'America/New_York';
const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
/** Today in New York. */
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const dayAdd = (d, n) => isoDay(Date.parse(d + 'T00:00:00Z') + n * DAY);
const monthEnd = (y, m) => isoDay(Date.UTC(y, m, 0));
/** Quarter index (year * 4 + q) of a day; its start and end days. */
const qIndex = (d) => Number(d.slice(0, 4)) * 4 + Math.floor((Number(d.slice(5, 7)) - 1) / 3);
const qStart = (qi) => `${Math.floor(qi / 4)}-${pad((qi % 4) * 3 + 1)}-01`;
const qEnd = (qi) => monthEnd(Math.floor(qi / 4), (qi % 4) * 3 + 3);
const CQ = qIndex(TODAY);
/** The UTC instant of a New York wall time on a day. */
function nyAt(day, hhmm) {
  const guess = Date.parse(`${day}T${hhmm}:00Z`);
  const off = (ms) => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms));
    const g = (t) => Number(p.find((x) => x.type === t).value);
    return (Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - ms) / 60000;
  };
  return guess - off(guess) * 60000;
}
/** The last 18 complete months, oldest first, as month-end days. */
const MONTHS = (() => {
  const y = Number(TODAY.slice(0, 4));
  const m = Number(TODAY.slice(5, 7));
  const out = [];
  for (let i = 18; i >= 1; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(monthEnd(d.getUTCFullYear(), d.getUTCMonth() + 1));
  }
  return out;
})();

/* -------------------------------------------------------------- servers */

const sh = (script, ...a) => execFileSync('bash', [join(DEV, script), ...a.map(String)], { stdio: 'pipe' }).toString();
const listening = async (port, path) => {
  try {
    const r = await fetch(`http://127.0.0.1:${port}${path}`);
    return r.status < 500;
  } catch {
    return false;
  }
};

/** Today's four meeting hours in New York (business hours before 08:00; late in the day the earliest ones have ended). */
function demoSlots() {
  const nowH = Number(new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hourCycle: 'h23', hour: '2-digit' }).format(new Date()));
  let slots = nowH < 8 ? [9, 11, 14, 16] : [nowH + 1, nowH + 2, nowH + 3, nowH + 5].filter((h) => h <= 22);
  for (let back = nowH - 1; slots.length < 4; back -= 2) slots.unshift(Math.max(0, back));
  return slots.sort((a, b) => a - b);
}

/** The demo calendar (today's meetings and yesterday's first meeting), relative to now. */
function writeFixtures() {
  const dir = join(APP, 'logs', 'demo_fixtures');
  mkdirSync(join(dir, 'calendar'), { recursive: true });
  mkdirSync(join(dir, 'gmail'), { recursive: true });
  const fx = join(DEV, 'fixtures');
  for (const sub of ['decks', 'updates']) {
    if (!existsSync(join(fx, sub))) continue;
    mkdirSync(join(dir, sub), { recursive: true });
    for (const f of readdirSync(join(fx, sub))) copyFileSync(join(fx, sub, f), join(dir, sub, f));
  }
  const now = Date.now();
  const hoursTo = (day, hhmm) => (nyAt(day, hhmm) - now) / 3600000 + 0.02;
  const me = { email: DEMO.owner, displayName: 'Olivia Hart', responseStatus: 'accepted', self: true };
  const ev = (id, summary, day, hhmm, minutes, others, extra = {}) => ({ id, summary, start_in_hours: hoursTo(day, hhmm), duration_minutes: minutes, organizer: { email: DEMO.owner, displayName: 'Olivia Hart', self: true }, attendees: [me, ...others], ...extra });
  const yesterday = dayAdd(TODAY, -1);
  // Today's meetings sit ahead of now (business hours before 08:00); late in the day the earliest ones have ended.
  const slots = demoSlots().map((h) => pad(h) + ':00');
  const events = [
    ev('demo_kestrel_board', 'Kestrel Robotics board meeting', TODAY, slots[0], 60, [
      { email: 'nadia@kestrelrobotics.com', displayName: 'Nadia Volkova', responseStatus: 'accepted' },
      { email: 'ben@kestrelrobotics.com', displayName: 'Ben Achterberg', responseStatus: 'accepted' },
    ], { location: 'Kestrel Robotics, Pittsburgh' }),
    ev('demo_orchard_partners', 'Orchard AI: partner meeting', TODAY, slots[1], 45, [
      { email: 'priya@orchard-ai.com', displayName: 'Priya Natarajan', responseStatus: 'accepted' },
      { email: 'leo@orchard-ai.com', displayName: 'Leo Grant', responseStatus: 'accepted' },
      { email: 'partner@venture.test', displayName: 'Daniel Reyes', responseStatus: 'accepted' },
    ], { hangoutLink: 'https://meet.google.com/demo-orchard', description: 'Series A, USD 12M. Partner meeting.' }),
    ev('demo_cascade_lp', 'Cascade Teachers Pension: quarterly check-in', TODAY, slots[2], 45, [
      { email: 'h.morales@cascadepension.example', displayName: 'Helena Morales', responseStatus: 'accepted' },
      { email: 'finance@venture.test', displayName: 'Priya Raman', responseStatus: 'accepted' },
    ]),
    ev('demo_pallas_intro', 'Pallas Microgrid intro call', TODAY, slots[3], 30, [{ email: 'sofia@pallasmicrogrid.com', displayName: 'Sofia Lindqvist', responseStatus: 'accepted' }], { hangoutLink: 'https://meet.google.com/demo-pallas' }),
    ev('demo_rivet_first', 'Rivet Health first meeting', yesterday, '15:00', 45, [
      { email: 'marcus@rivethealth.com', displayName: 'Marcus Bell', responseStatus: 'accepted' },
      { email: 'principal@venture.test', displayName: 'Sam Okafor', responseStatus: 'accepted' },
    ]),
  ];
  writeFileSync(join(dir, 'calendar', 'events.json'), JSON.stringify(events, null, 1));
  writeFileSync(join(dir, 'gmail', 'messages.json'), '[]');
  writeFileSync(join(dir, 'rules.json'), '{}');
  return dir;
}

async function startBridge(fixtures) {
  if (await listening(BRIDGE, '/__mock/health')) {
    const h = await (await fetch(`http://127.0.0.1:${BRIDGE}/__mock/health`)).json();
    if (resolve(h.fixtures) !== resolve(fixtures)) console.log(`note: a mock bridge already runs on ${BRIDGE} with ${h.fixtures}; Today shows its calendar. Use --fresh for the demo calendar.`);
    return;
  }
  const out = join(APP, 'logs', 'mock_' + BRIDGE);
  mkdirSync(out, { recursive: true });
  const child = spawn(process.execPath, [join(DEV, 'mock_bridge.mjs'), String(BRIDGE), fixtures, out], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  for (let i = 0; i < 40 && !(await listening(BRIDGE, '/__mock/health')); i++) await new Promise((r) => setTimeout(r, 250));
}

if (FRESH) {
  sh('stop.sh', PORT);
  if (BRIDGE !== null) sh('stop.sh', BRIDGE);
  sh('reset.sh', APP);
}
if (BRIDGE !== null) await startBridge(writeFixtures());
if (!(await listening(PORT, '/api/health'))) console.log(sh('serve.sh', APP, PORT, ...(BRIDGE !== null ? [BRIDGE] : [])).trim());

/* ------------------------------------------------------------------ api */

const api = client({ port: PORT, app: APP });
let fails = 0;
let calls = 0;
async function op(name, params, as, opts = {}) {
  calls++;
  const r = await api.call(name, params, Object.assign({ as }, opts));
  if (r.status !== 200) {
    fails++;
    console.log(`  FAILED ${name} as ${as}: ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
    return null;
  }
  return r.body;
}
const O = 'owner';
const A = 'agent';
const T = {
  daniel: 'partner@venture.test',
  mei: 'partner2@venture.test',
  sam: 'principal@venture.test',
  lena: 'analyst@venture.test',
  priya: 'finance@venture.test',
  ava: 'platform@venture.test',
};
const pin = { pin: true };
const J = (v) => JSON.stringify(v);
const T0 = Date.now();
const step = (s) => console.log(`- ${s} (${Math.round((Date.now() - T0) / 1000)} s, ${calls} ops)`);
const fmt = (n) => n.toLocaleString('en-US');
/** A company's top line in words: ARR, else monthly revenue, else pre-revenue. */
const topLine = (r) => (r.arr !== null ? `ARR USD ${fmt(r.arr)}` : r.revenue !== null ? `Revenue USD ${fmt(r.revenue)} a month` : 'Pre-revenue; the trial program is on budget');

/** A person uploads files (multipart, as the page does): files is [[name, bytes]]. */
async function upload(name, params, files, as) {
  calls++;
  const email = as === O ? DEMO.owner : as;
  if (!api.tokens.has(email)) await api.call('auth.me', {}, { as });
  const fd = new FormData();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) fd.append(k, typeof v === 'object' ? J(v) : String(v));
  for (const [fname, bytes] of files) fd.append('file', new Blob([bytes], { type: fname.endsWith('.pdf') ? 'application/pdf' : 'text/plain' }), fname);
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/ops/${name.replace('.', '/')}`, { method: 'POST', body: fd, headers: { authorization: api.tokens.get(email) } });
    const text = await res.text();
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 500 + i * 250));
      continue;
    }
    if (res.status !== 200) {
      fails++;
      console.log(`  FAILED ${name} as ${as}: ${res.status} ${text.slice(0, 400)}`);
      return null;
    }
    return JSON.parse(text);
  }
  fails++;
  return null;
}

/** A small PDF of 16:9 slides with a real text layer: pages [{ title, lines }]. */
function pdfOf(title, pages) {
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
  const kids = [];
  for (const p of pages) {
    const ops = ['BT', '/F2 30 Tf', '60 460 Td', '(' + esc(p.title) + ') Tj', 'ET'];
    let y = 400;
    for (const l of p.lines) {
      ops.push('BT', '/F1 18 Tf', '60 ' + y + ' Td', '(' + esc(l) + ') Tj', 'ET');
      y -= 30;
    }
    ops.push('BT', '/F1 11 Tf', '60 30 Td', '(' + esc(title) + ') Tj', 'ET');
    const s = ops.join('\n');
    objs.push('<< /Length ' + Buffer.byteLength(s, 'latin1') + ' >>\nstream\n' + s + '\nendstream');
    objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 540] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + (objs.length) + ' 0 R >>');
    kids.push(objs.length);
  }
  objs[1] = '<< /Type /Pages /Kids [' + kids.map((k) => k + ' 0 R').join(' ') + '] /Count ' + kids.length + ' >>';
  objs.push('<< /Title (' + esc(title) + ') /Producer (Venture OS demo) >>');
  let out = '%PDF-1.4\n';
  const off = [];
  objs.forEach((o, i) => {
    off.push(Buffer.byteLength(out, 'latin1'));
    out += i + 1 + ' 0 obj\n' + o + '\nendobj\n';
  });
  const x = Buffer.byteLength(out, 'latin1');
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + off.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R /Info ' + objs.length + ' 0 R >>\nstartxref\n' + x + '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}
const fileName = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const money = (n) => 'USD ' + (n >= 1e6 ? (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1) + 'M' : Math.round(n / 1000) + 'K');
/** The fires the mock bridge recorded (a demo firm must have none). */
async function bridgeFires() {
  if (!BRIDGE) return [];
  try {
    return (await (await fetch(`http://127.0.0.1:${BRIDGE}/__mock/fires`)).json()).fires ?? [];
  } catch {
    return [];
  }
}

const st = await api.call('setup.status', {}, {});
if (st.body && (st.body.setup_done === true || st.body.needs_setup === false)) {
  console.log('This database is already set up. Seed an empty one: add --fresh (wipes the scratch database).');
  process.exit(2);
}
const t0 = Date.now();

/* ------------------------------------------------------------- the firm */

step('firm, team, funds');
const FUND1 = 'Larkspur Fund I';
const FUND2 = 'Larkspur Fund II';
const fund1FirstClose = dayAdd(qStart(CQ - 15), 59);
const fund2FirstClose = qStart(CQ - 6);
await op('setup.complete', { firm_name: 'Larkspur Ventures', base_currency: 'USD', zone: ZONE, fund_name: FUND1, fund_size: '60000000', fund_vintage: Number(fund1FirstClose.slice(0, 4)), owner_name: 'Olivia Hart', email: DEMO.owner, password: DEMO.password, pin: DEMO.pin }, undefined);
// A demo firm never touches the owner's Gmail or calendar: set before any send, request, capture or sweep.
await op('settings.update', { mail: { demo: true } }, O);
const sg = await op('settings.get', {}, O);
if (!sg || !sg.mail || sg.mail.demo !== true) {
  console.log('settings mail.demo did not take; refusing to seed a firm that could read Gmail.');
  process.exit(3);
}
// Every switch that lets the app ask your AI agent on its own stays off (a demo firm never asks it anyway).
const SWITCHES = Object.keys(sg.agent_policy ?? {});
const firesAtStart = (await bridgeFires()).length;
await op('auth.update-profile', { title: 'Managing Partner' }, O);
const team = [
  [T.daniel, 'partner', 'Daniel Reyes', 'General Partner'],
  [T.mei, 'partner', 'Mei Tanaka', 'General Partner'],
  [T.sam, 'principal', 'Sam Okafor', 'Principal'],
  [T.lena, 'analyst', 'Lena Fischer', 'Analyst'],
  [T.priya, 'finance', 'Priya Raman', 'CFO'],
  [T.ava, 'platform', 'Ava Brooks', 'Head of Platform'],
];
for (const [email, role, name, title] of team) {
  const inv = await op('members.invite', { email, name, role, title }, O, pin);
  if (inv === null) continue;
  const j = await api.call('auth.accept-invite', { email, code: inv.code, password: DEMO.password });
  if (j.status === 200) api.setToken(email, j.body.token);
  await op('pin.set', { password: DEMO.password, new_pin: DEMO.pin }, email);
}
const LPA = { confirmed: true, mgmt_fee_ppm: 20000, fee_basis: 'committed', carry_ppm: 200000, waterfall: 'european', hurdle_ppm: 80000, catch_up_ppm: 1000000, gp_commit_ppm: 20000, investment_period_years: 5, term_years: 10 };
await op('entities.save', { entity: FUND1, short_name: 'Fund I', legal_name: 'Larkspur Ventures Fund I, L.P.', first_close_day: fund1FirstClose, status: 'investing', target: '60000000', lpa: J(LPA) }, O);
await op('entities.save', { kind: 'fund', name: FUND2, short_name: 'Fund II', legal_name: 'Larkspur Ventures Fund II, L.P.', currency: 'USD', vintage: Number(fund2FirstClose.slice(0, 4)), size: '120000000', target: '120000000', status: 'investing', first_close_day: fund2FirstClose, lpa: J(LPA) }, O);

/* ------------------------------------------------------------------ LPs */

step('LPs, commitments, wire details');
const LPS = [
  // name, kind, country, contact, email, Fund I, Fund II, fee paying
  ['Northgate University Endowment', 'endowment', 'US', 'Rachel Kim', 'rkim@northgate-endowment.example', 12000000, 20000000, true],
  ['Cascade Teachers Pension Plan', 'pension', 'US', 'Helena Morales', 'h.morales@cascadepension.example', 10000000, 20000000, true],
  ['Meridian Fund of Funds', 'fund_of_funds', 'GB', 'Oliver Grant', 'oliver@meridianfof.example', 9000000, 15000000, true],
  ['Halvorsen Family Office', 'family_office', 'NO', 'Ingrid Halvorsen', 'ingrid@halvorsen.example', 6000000, 8000000, true],
  ['Whitcombe Foundation', 'foundation', 'US', 'James Whitcombe', 'james@whitcombe.example', 5000000, 8000000, true],
  ['Aster Insurance Group', 'insurer', 'US', 'Carla Diaz', 'cdiaz@asterinsurance.example', 5000000, 12000000, true],
  ['Kinsale Capital Partners', 'fund_of_funds', 'IE', 'Niamh Byrne', 'niamh@kinsalecp.example', 4000000, 10000000, true],
  ['Brightwater Family Trust', 'family_office', 'US', 'Paul Brightwater', 'paul@brightwater.example', 3000000, 6000000, true],
  ['Oakhurst Health System', 'corporate', 'US', 'Dana Price', 'dprice@oakhurst.example', 2500000, 5000000, true],
  ['Sora Holdings', 'corporate', 'JP', 'Kenji Sato', 'k.sato@soraholdings.example', 1500000, 10000000, true],
  ['Elm Street Angels', 'individual', 'US', 'Grace Elm', 'grace@elmstreet.example', 1000000, 4000000, true],
  ['Larkspur GP Commitment', 'gp', 'US', 'Olivia Hart', DEMO.owner, 1000000, 2000000, false],
];
for (const [name, kind, country, contact, email, f1, f2, fee] of LPS) {
  const lp = await op('lps.upsert', { name, kind, country, contacts: J([{ name: contact, email, role: 'Investor relations', primary: true, notices: true }]) }, T.priya);
  if (lp === null) continue;
  const id = (lp.lp ?? lp).id;
  await op('commitments.save', { fund: FUND1, lp: id, amount: f1.toFixed(2), fee_paying: fee, closing_day: fund1FirstClose, side_letter: name.startsWith('Cascade') ? J(['mfn', 'reporting']) : '[]' }, T.priya);
  await op('commitments.save', { fund: FUND2, lp: id, amount: f2.toFixed(2), fee_paying: fee, closing_day: fund2FirstClose, side_letter: name.startsWith('Northgate') ? J(['co_invest']) : '[]' }, T.priya);
}
for (const [fund, acct] of [
  [FUND1, '004417889201'],
  [FUND2, '004417889377'],
]) {
  await op('bank.change', { entity: fund, bank_name: 'First Harbor Bank', account_name: fund.replace('Larkspur', 'Larkspur Ventures') + ', L.P.', account_number: acct, routing: '026009593', swift: 'FHBKUS33', bank_address: '100 Harbor Street, Boston MA' }, T.priya, pin);
  const bl = await op('bank.list', { entity: fund }, T.priya);
  const blocks = bl?.blocks ?? [];
  const block = blocks.find((b) => (b.status ?? b.state) !== 'approved') ?? blocks[0];
  if (block) await op('bank.approve', { block: block.id }, O, pin);
}

/* ------------------------------------------------------------- portfolio */

step('portfolio companies and holdings');
// key, name, domain, sector, country, founded, model, fund, rounds [[call index, amount, instrument, valuation]], founder
const PORT_COS = [
  ['kestrel', 'Kestrel Robotics', 'kestrelrobotics.com', 'robotics', 'US', 2021, 'saas', 1, [[0, 2000000, 'priced', 14000000], [6, 1500000, 'priced', 42000000]], ['nadia@kestrelrobotics.com', 'Nadia Volkova', 'CEO']],
  ['tidewater', 'Tidewater Health', 'tidewaterhealth.com', 'healthcare', 'US', 2020, 'saas', 1, [[1, 1500000, 'safe_cap', 12000000], [11, 500000, 'safe_cap', 12000000]], ['erin@tidewaterhealth.com', 'Erin Walsh', 'CEO']],
  ['brightline', 'Brightline Payments', 'brightlinepay.com', 'fintech', 'US', 2021, 'transactional', 1, [[1, 2500000, 'priced', 20000000], [9, 1000000, 'priced', 60000000]], ['marco@brightlinepay.com', 'Marco Silva', 'CEO']],
  ['fernhill', 'Fernhill Bio', 'fernhillbio.com', 'biotech', 'US', 2022, 'other', 1, [[2, 3000000, 'priced', 24000000], [10, 1500000, 'priced', 30000000]], ['amara@fernhillbio.com', 'Amara Osei', 'CEO']],
  ['quarry', 'Quarry Data', 'quarrydata.io', 'data infrastructure', 'US', 2021, 'saas', 1, [[3, 2000000, 'safe_cap', 16000000]], ['josh@quarrydata.io', 'Josh Lerner', 'CEO']],
  ['lumora', 'Lumora Energy', 'lumoraenergy.com', 'climate', 'US', 2021, 'saas', 1, [[4, 2000000, 'priced', 18000000], [12, 750000, 'safe_cap', 18000000]], ['hana@lumoraenergy.com', 'Hana Okoro', 'CEO']],
  ['pinecrest', 'Pinecrest Logistics', 'pinecrestlogistics.com', 'logistics', 'US', 2020, 'saas', 1, [[5, 1750000, 'priced', 15000000]], ['will@pinecrestlogistics.com', 'Will Harper', 'CEO']],
  ['arclight', 'Arclight Security', 'arclightsec.com', 'cybersecurity', 'US', 2022, 'saas', 1, [[6, 2250000, 'safe_cap', 18000000]], ['dev@arclightsec.com', 'Dev Malhotra', 'CEO']],
  ['northbeam', 'Northbeam Analytics', 'northbeam.dev', 'developer tools', 'GB', 2022, 'saas', 1, [[7, 1500000, 'safe_cap', 12000000]], ['ellie@northbeam.dev', 'Ellie Turner', 'CEO']],
  ['corvid', 'Corvid Labs', 'corvidlabs.ai', 'ai', 'US', 2023, 'saas', 1, [[8, 2000000, 'safe_cap', 16000000]], ['ravi@corvidlabs.ai', 'Ravi Shankar', 'CEO']],
  ['saltmarsh', 'Saltmarsh Foods', 'saltmarshfoods.com', 'food', 'US', 2021, 'marketplace', 1, [[9, 1250000, 'priced', 11000000]], ['tess@saltmarshfoods.com', 'Tess Carver', 'CEO']],
  ['halcyon', 'Halcyon AI', 'halcyonlegal.ai', 'legal tech', 'US', 2023, 'saas', 2, [[0, 3000000, 'priced', 24000000]], ['iris@halcyonlegal.ai', 'Iris Chen', 'CEO']],
  ['gridwell', 'Gridwell', 'gridwell.energy', 'climate', 'DE', 2023, 'saas', 2, [[1, 2500000, 'safe_cap', 20000000]], ['jonas@gridwell.energy', 'Jonas Weber', 'CEO']],
  ['juniper', 'Juniper Care', 'junipercare.com', 'healthcare', 'US', 2024, 'saas', 2, [[3, 2000000, 'safe_cap', 14000000]], ['maya@junipercare.com', 'Maya Ortiz', 'CEO']],
  ['cobalt', 'Cobalt Ledger', 'cobaltledger.com', 'fintech', 'US', 2022, 'saas', 2, [[4, 3500000, 'priced', 32000000]], ['sam@cobaltledger.com', 'Samir Haddad', 'CEO']],
];
// Fund I calls twice a year (two quarters of fees and the investments due in them); its first quarter and this one alone.
const FUND1_GROUPS = [[0], [1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15]];
const groupOf = (k) => FUND1_GROUPS.find((g) => g.includes(k));
const callDay = (fundNo, k) => (fundNo === 1 ? dayAdd(qStart(CQ - 15 + groupOf(k)[0]), 14) : dayAdd(qStart(CQ - 6 + k), 14));
for (const [, name, domain, sector, hq_country, founded_year, business_model] of PORT_COS) await op('companies.upsert', { name, domain, sector, hq_country, founded_year, business_model, kind: 'startup' }, O);
for (const c of PORT_COS) await op('people.upsert', { email: c[9][0], name: c[9][1], title: c[9][2], company: c[2] }, O);
const hRows = ['Company,Fund,Instrument,Amount,Day,Valuation,Currency'];
for (const c of PORT_COS) for (const [k, amount, instr, val] of c[8]) hRows.push([c[1], c[7] === 1 ? FUND1 : FUND2, instr, amount, dayAdd(callDay(c[7], k), 14), val, 'USD'].join(','));
await op('imports.run', { target: 'holdings', csv: hRows.join('\n'), file_name: 'larkspur_holdings.csv' }, O);
const HOLD = {};
const hl = await op('holdings.list', { status: 'all', limit: 200 }, O);
for (const r of hl?.rows ?? []) {
  const c = PORT_COS.find((x) => x[2] === r.company.domain || x[1] === r.company.name);
  if (c) HOLD[c[0]] = r.id;
}
await op('holdings.update', { holding: HOLD.kestrel, board_role: 'seat', pro_rata: true, major_investor: true }, O);

step('KPIs, 18 months');
/** One company's monthly story: arr (or revenue), net burn, cash, headcount, customers. */
function story(key) {
  const n = MONTHS.length;
  const lin = (a, b) => (i) => a + ((b - a) * i) / (n - 1);
  const geo = (a, b) => (i) => a * Math.pow(b / a, i / (n - 1));
  const S = {
    kestrel: { arr: geo(620000, 8100000), burn: lin(380000, 690000), cash0: 7200000, raise: { at: 11, amount: 25000000 }, hc: lin(24, 58), cust: geo(9, 74) },
    tidewater: { arr: (i) => (i < 6 ? 1900000 + i * 55000 : 2230000 - (i - 6) * 80000), burn: (i) => (i < 12 ? 330000 : 205000), cash0: 6940000, raise: { at: 7, amount: 500000 }, hc: (i) => (i < 12 ? 31 : 22), cust: (i) => (i < 6 ? 64 + i : 70 - (i - 6) * 2) },
    brightline: { arr: geo(2400000, 6800000), burn: lin(450000, 520000), cash0: 15800000, hc: lin(38, 57), cust: geo(120, 310) },
    fernhill: { arr: null, burn: lin(560000, 640000), cash0: 16200000, raise: { at: 4, amount: 6000000 }, hc: lin(18, 26), cust: null },
    quarry: { arr: geo(1100000, 2400000), burn: lin(210000, 235000), cash0: 6500000, raise: { at: 9, amount: 1500000 }, hc: lin(14, 21), cust: geo(41, 96) },
    lumora: { arr: geo(900000, 1250000), burn: lin(415000, 480000), cash0: 8940000, raise: { at: 10, amount: 750000 }, hc: lin(26, 29), cust: geo(11, 15) },
    pinecrest: { arr: geo(1400000, 2050000), burn: lin(255000, 268000), cash0: 7260000, hc: lin(19, 23), cust: geo(48, 77) },
    arclight: { arr: geo(800000, 3100000), burn: lin(290000, 340000), cash0: 10500000, hc: lin(15, 27), cust: geo(22, 81) },
    northbeam: { arr: geo(500000, 1120000), burn: lin(175000, 188000), cash0: 6600000, hc: lin(9, 13), cust: geo(60, 190) },
    corvid: { arr: geo(300000, 3600000), burn: lin(240000, 405000), cash0: 9800000, raise: { at: 8, amount: 2000000 }, hc: lin(8, 24), cust: geo(35, 610) },
    saltmarsh: { revenue: geo(118000, 212000), burn: lin(150000, 142000), cash0: 5600000, hc: lin(16, 19), cust: geo(210, 480) },
    halcyon: { arr: geo(400000, 2250000), burn: lin(260000, 330000), cash0: 10800000, hc: lin(11, 22), cust: geo(14, 63) },
    gridwell: { arr: geo(200000, 900000), burn: lin(205000, 230000), cash0: 9200000, hc: lin(8, 14), cust: geo(3, 12) },
    juniper: { arr: geo(150000, 610000), burn: lin(160000, 190000), cash0: 5600000, hc: lin(7, 12), cust: geo(9, 41) },
    cobalt: { arr: geo(1200000, 3050000), burn: lin(330000, 360000), cash0: 14500000, hc: lin(21, 33), cust: geo(85, 205) },
  }[key];
  const rows = [];
  let cash = S.cash0;
  for (let i = 0; i < n; i++) {
    const burn = Math.round(S.burn(i) / 1000) * 1000;
    cash = cash - burn + (S.raise && S.raise.at === i ? S.raise.amount : 0);
    rows.push({ month: MONTHS[i], arr: S.arr ? Math.round(S.arr(i) / 1000) * 1000 : null, revenue: S.revenue ? Math.round(S.revenue(i) / 100) * 100 : null, burn, cash: Math.round(cash / 1000) * 1000, hc: Math.round(S.hc(i)), cust: S.cust ? Math.round(S.cust(i)) : null });
  }
  return rows;
}
const kRows = [];
for (const c of PORT_COS) {
  const rows = story(c[0]);
  rows.forEach((r, i) => {
    // The last month arrives as each founder's update, read by your AI agent (staged, then verified).
    if (i === rows.length - 1) return;
    if (r.arr !== null) kRows.push([c[2], r.month, 'arr', r.arr, 'USD']);
    if (r.revenue !== null) kRows.push([c[2], r.month, 'revenue', r.revenue, 'USD']);
    kRows.push([c[2], r.month, 'net_burn', r.burn, 'USD']);
    kRows.push([c[2], r.month, 'cash', r.cash, 'USD']);
    kRows.push([c[2], r.month, 'headcount', r.hc, '']);
    if (r.cust !== null) kRows.push([c[2], r.month, 'customers', r.cust, '']);
  });
}
for (let i = 0; i < kRows.length; i += 195) {
  const csv = ['Company,Period end,Metric,Value,Currency'].concat(kRows.slice(i, i + 195).map((r) => r.join(','))).join('\n');
  await op('imports.run', { target: 'kpi_values', csv, file_name: 'portfolio_kpis.csv' }, O);
}
await op('alerts.run', {}, O);

/* ----------------------------------------------------------------- capital */

step('capital calls, payments, a distribution');
const inv = (key, amount) => ({ type: 'investment', holding: HOLD[key], amount: amount.toFixed(2), label: PORT_COS.find((c) => c[0] === key)[1] });
const fees = (from, to) => ({ type: 'fees', from_day: from, to_day: to });
const FUND1_CALLS = [];
for (const g of FUND1_GROUPS) {
  const p = [fees(g[0] === 0 ? fund1FirstClose : qStart(CQ - 15 + g[0]), qEnd(CQ - 15 + g[g.length - 1]))];
  for (const c of PORT_COS.filter((x) => x[7] === 1)) for (const [ck, amount] of c[8]) if (g.includes(ck)) p.push(inv(c[0], amount));
  if (g.includes(13)) p.push({ type: 'expenses', amount: '60000.00', label: 'Annual audit and tax' });
  FUND1_CALLS.push([callDay(1, g[0]), p]);
}
const FUND2_CALLS = [];
for (let k = 0; k < 6; k++) {
  const qi = CQ - 6 + k;
  const p = [fees(k === 0 ? fund2FirstClose : qStart(qi), qEnd(qi))];
  for (const c of PORT_COS.filter((x) => x[7] === 2)) for (const [ck, amount] of c[8]) if (ck === k) p.push(inv(c[0], amount));
  FUND2_CALLS.push([callDay(2, k), p]);
}
async function issueCall(fund, notice, purposes) {
  const d = await op('calls.draft', { fund, purposes: J(purposes), notice_day: notice }, T.priya);
  if (d === null) return null;
  const id = (d.event ?? d).id;
  await op('calls.preview', { event: id }, T.priya);
  await op('calls.issue', { event: id }, T.priya, pin);
  const g = await op('calls.get', { event: id }, T.priya);
  return g ? g.event : null;
}
const late = [];
for (const [fund, list] of [
  [FUND1, FUND1_CALLS],
  [FUND2, FUND2_CALLS],
]) {
  for (let k = 0; k < list.length; k++) {
    const e = await issueCall(fund, list[k][0], list[k][1]);
    if (e === null) continue;
    const lastOfFund1 = fund === FUND1 && k === list.length - 1;
    for (const l of e.lines ?? []) {
      if (lastOfFund1 && (l.lp_name === 'Kinsale Capital Partners' || l.lp_name === 'Elm Street Angels')) {
        late.push(l.id);
        continue;
      }
      if ((l.total_minor ?? 1) === 0) continue;
      await op('payments.record', { line: l.id, day: dayAdd(e.due_day, -((l.lp_name ?? '').length % 4)) }, T.priya);
    }
  }
}
// Fund II: this quarter's call for Halcyon AI's Series A extension, issued a week ago, half paid.
const half = await issueCall(FUND2, dayAdd(TODAY, -7), [fees(qStart(CQ), qEnd(CQ)), inv('halcyon', 2400000)]);
if (half !== null) {
  const order = ['Northgate University Endowment', 'Cascade Teachers Pension Plan', 'Halvorsen Family Office', 'Whitcombe Foundation', 'Oakhurst Health System', 'Larkspur GP Commitment'];
  for (const l of half.lines ?? []) if (order.includes(l.lp_name)) await op('payments.record', { line: l.id, day: dayAdd(TODAY, -2) }, T.priya);
}
// Fund I: a secondary of part of Kestrel Robotics in its Series B (five quarters ago) and of part of
// Brightline Payments (last quarter), each distributed and paid out to every LP.
for (const [key, amount, day, narrative] of [
  ['kestrel', 1500000, dayAdd(qStart(CQ - 5), 35), 'Proceeds from the sale of 8% of our Kestrel Robotics shares in its Series B secondary.'],
  ['brightline', 4200000, dayAdd(qStart(CQ - 1), 40), 'Proceeds from the partial secondary sale of Brightline Payments shares to Harbor Growth Partners.'],
]) {
  const di = await op('distributions.draft', { fund: FUND1, amount: amount.toFixed(2), holding: HOLD[key], proceeds: amount.toFixed(2), notice_day: day, narrative }, T.priya);
  if (di === null) continue;
  const id = (di.event ?? di).id;
  await op('distributions.preview', { event: id }, T.priya);
  await op('distributions.issue', { event: id }, T.priya, pin);
  const g = await op('calls.get', { event: id }, T.priya);
  for (const l of g?.event?.lines ?? []) if ((l.total_minor ?? 1) !== 0) await op('payments.record', { line: l.id, day: g.event.due_day, reference: 'Wire ' + (g.event.number ?? 'out') }, T.priya);
}

/* ------------------------------------------------------------------ marks */

step('marks: two closed quarters and the open one');
const MARKS = {
  q1: { kestrel: [9000000, 'round_adjusted'], tidewater: [2000000, 'calibrated_round'], brightline: [7000000, 'round_adjusted'], fernhill: [4500000, 'calibrated_round'], quarry: [3000000, 'multiples'], lumora: [2750000, 'calibrated_round'], pinecrest: [1750000, 'calibrated_round'], arclight: [3400000, 'multiples'], northbeam: [1500000, 'calibrated_round'], corvid: [3000000, 'round_adjusted'], saltmarsh: [1250000, 'calibrated_round'] },
  q2: { kestrel: [14500000, 'round_adjusted'], tidewater: [800000, 'write_down'], brightline: [7600000, 'round_adjusted'], fernhill: [4500000, 'calibrated_round'], quarry: [3200000, 'multiples'], lumora: [2000000, 'write_down'], pinecrest: [1750000, 'calibrated_round'], arclight: [3900000, 'multiples'], northbeam: [1500000, 'calibrated_round'], corvid: [4400000, 'round_adjusted'], saltmarsh: [1250000, 'calibrated_round'] },
  q3: { kestrel: [18200000, 'multiples'], tidewater: [600000, 'write_down'], brightline: [4900000, 'round_adjusted'], fernhill: [4500000, 'calibrated_round'], quarry: [3300000, 'multiples'], lumora: [1400000, 'write_down'], pinecrest: [1750000, 'calibrated_round'], arclight: [4300000, 'multiples'], northbeam: [1600000, 'multiples'], corvid: [5600000, 'round_adjusted'], saltmarsh: [1250000, 'calibrated_round'] },
};
const WHY = {
  round_adjusted: 'Calibrated to the latest priced round, adjusted for verified ARR growth since.',
  calibrated_round: 'Held at the entry round: KPIs on plan, no new priced round.',
  multiples: 'Verified ARR at the median EV/ARR of listed peers, less a 30% private discount.',
  write_down: 'Revenue below plan for two quarters and runway under a year; marked to a recapitalisation value.',
};
async function closeQuarter(qi, set, finish, fund = FUND1) {
  const q = await op('quarters.open', { fund, period_end: qEnd(qi) }, T.priya);
  if (q === null) return null;
  const qid = (q.quarter ?? q).id;
  // A person asked your AI agent for the quarter's marks: it drafts them (the open quarter), or finance did (finished quarters).
  for (const [key, [value, method]] of Object.entries(set)) {
    const who = finish ? T.priya : A;
    await op('marks.draft', { quarter: qid, holding: HOLD[key], method, value: value.toFixed(2), rationale: WHY[method], inputs: J([{ label: 'Verified ARR or revenue', value: 'see KPIs', source: 'Portfolio KPIs, ' + qEnd(qi) }]) }, who);
  }
  if (!finish) return qid;
  await op('marks.approve', { quarter: qid }, T.daniel, pin);
  await op('quarters.freeze', { quarter: qid }, T.priya, pin);
  const story = fund === FUND1 ? 'Kestrel Robotics led the gains on a priced round; Tidewater Health was marked down after two quarters below plan.' : 'Halcyon AI was marked up on its Series A extension; the other three companies are held at their entry rounds while they build.';
  await op('reports.letter-draft', { quarter: qid, paragraphs: J(['The quarter closed with every company reporting. Net TVPI and DPI are shown beside gross MOIC in the attached statement.', story]) }, A);
  await op('reports.finalize', { quarter: qid }, T.daniel, pin);
  await op('reports.send', { quarter: qid }, T.priya);
  return qid;
}
await closeQuarter(CQ - 3, MARKS.q1, true);
await closeQuarter(CQ - 2, MARKS.q2, true);
await closeQuarter(CQ - 1, MARKS.q3, false);
// Fund II: its holdings held at entry, then Halcyon AI marked up on its extension terms; both quarters sent.
await closeQuarter(CQ - 3, { halcyon: [3000000, 'calibrated_round'], gridwell: [2500000, 'calibrated_round'], juniper: [2000000, 'calibrated_round'] }, true, FUND2);
await closeQuarter(CQ - 2, { halcyon: [3450000, 'round_adjusted'], gridwell: [2500000, 'calibrated_round'], juniper: [2000000, 'calibrated_round'], cobalt: [3500000, 'calibrated_round'] }, true, FUND2);

/* -------------------------------------------------------- portfolio work */

step('portfolio: update requests, founder updates, asks, board meetings, reserves');
// Monthly update requests to every founder (Fernhill Bio quarterly): this period's request goes out now.
for (const c of PORT_COS) await op('requests.schedule', { companies: J([c[2]]), cadence: c[0] === 'fernhill' ? 'quarterly' : 'monthly', to: J([c[9][0]]), metrics: J(c[0] === 'saltmarsh' ? ['revenue', 'net_burn', 'cash', 'headcount'] : ['arr', 'net_burn', 'cash', 'headcount']) }, O);
// Every founder's update for the last month; your AI agent stages the numbers with quotes and a person verifies
// them (Kestrel Robotics and Corvid Labs still wait in Verify).
const HIGHLIGHT = {
  kestrel: 'Signed two national 3PLs; the Series C process starts in January.',
  tidewater: 'The recap closed; we cut the team to 22 and focus on the two largest payers.',
  brightline: 'Launched instant payouts in Canada; volume up 9% on the month.',
  fernhill: 'The second pilot batch met spec; we start the IND-enabling study next quarter.',
  quarry: 'Shipped usage-based pricing; three customers upgraded in the first week.',
  lumora: 'Two utilities slipped their purchase orders to Q1; we are raising a bridge.',
  pinecrest: 'Renewed our largest customer for three years.',
  arclight: 'SOC 2 Type II done; pipeline doubled after the conference.',
  northbeam: 'Self-serve signups up 30%; first EU bank customer live.',
  corvid: 'Crossed 600 customers; GPU costs down 18% after the model switch.',
  saltmarsh: 'Added 40 grocery stores in the Southeast; margin steady at 31%.',
  halcyon: 'Closed the Series A extension; four AmLaw 100 firms in pilot.',
  gridwell: 'Commissioned our first grid-scale project in Bavaria.',
  juniper: 'Launched in Texas; 41 agencies on the platform.',
  cobalt: 'Multi-entity consolidation shipped; net retention 124%.',
};
const ASKS = {
  kestrel: [['hire', 'VP Sales for the Series C push', 'in_progress', T.ava], ['customer', 'Intro to Cargoline operations team', 'done', T.daniel, 'Intro made; pilot scoped']],
  tidewater: [['fundraising', 'Lead for the bridge round', 'in_progress', T.sam], ['advice', 'Review of the recap plan', 'done', T.priya, 'Plan approved by the board'], ['customer', 'Two regional payers to pilot', 'open', T.sam]],
  brightline: [['customer', 'Harbor Bank treasury team', 'done', DEMO.owner, 'Intro made; pilot signed'], ['hire', 'Head of compliance', 'open', T.ava], ['advice', 'Canadian licensing counsel', 'in_progress', T.priya]],
  fernhill: [['fundraising', 'Series B leads with a biotech focus', 'open', T.mei], ['advice', 'CRO contract review', 'done', T.mei, 'Terms renegotiated'], ['hire', 'VP Manufacturing', 'in_progress', T.ava]],
  quarry: [['customer', 'Data teams at mid-market retailers', 'in_progress', T.lena], ['hire', 'Senior data engineers', 'open', T.ava], ['intro', 'Snowflake partner team', 'done', T.daniel, 'Partner listing live']],
  lumora: [['fundraising', 'Bridge: insiders and two new leads', 'in_progress', T.mei], ['advice', 'Cash plan to 12 months', 'open', T.priya], ['customer', 'Utility procurement contacts', 'done', T.mei, 'Two meetings held']],
  pinecrest: [['customer', 'Intro to Summit Freight', 'done', DEMO.owner, 'Intro made'], ['hire', 'CFO, part time', 'open', T.ava], ['advice', 'Pricing for the enterprise tier', 'in_progress', T.daniel]],
  arclight: [['hire', 'CISO advisory board members', 'open', T.ava], ['customer', 'Harbor Logistics security team', 'done', T.daniel, 'Intro made; POC running'], ['intro', 'Wiz partnerships lead', 'in_progress', T.daniel]],
  northbeam: [['customer', 'UK fintech design partners', 'open', T.mei], ['hire', 'Head of sales, London', 'in_progress', T.ava], ['advice', 'EU data residency', 'done', T.lena, 'Counsel memo shared']],
  corvid: [['intro', 'GPU cloud credits contact', 'done', T.ava, 'Credits granted'], ['customer', 'Grocery chains for the forecasting pilot', 'open', T.daniel]],
  saltmarsh: [['customer', 'Regional grocery buyers', 'in_progress', T.mei], ['hire', 'Head of supply chain', 'open', T.ava], ['advice', 'Co-packer contract', 'done', T.priya, 'Signed at better terms']],
  halcyon: [['hire', 'General counsel', 'open', T.ava], ['customer', 'Law firm innovation leads', 'done', T.daniel, 'Four pilots started'], ['intro', 'Corporate legal ops networks', 'in_progress', T.daniel]],
  gridwell: [['intro', 'Heads of grid planning at German utilities', 'in_progress', T.mei], ['hire', 'US country manager', 'open', T.ava], ['advice', 'US entity setup', 'done', T.priya, 'Entity formed']],
  juniper: [['customer', 'Home health agency operators', 'open', T.sam], ['hire', 'Clinical advisor', 'in_progress', T.ava], ['intro', 'Medicaid managed care plans', 'done', T.sam, 'Two plans engaged']],
  cobalt: [['fundraising', 'Series B banker shortlist', 'open', DEMO.owner], ['advice', 'Pricing review', 'done', T.daniel, 'New tiers launched'], ['customer', 'Mid-market CFO roundtable', 'in_progress', T.priya]],
};
const UPD = {};
for (const c of PORT_COS) {
  const last = story(c[0]).at(-1);
  const top = last.arr !== null ? `ARR closed at USD ${fmt(last.arr)}` : last.revenue !== null ? `Revenue was USD ${fmt(last.revenue)}` : 'We are still pre-revenue and on budget';
  const ask = (ASKS[c[0]] ?? []).find((a) => a[2] === 'open') ?? ASKS[c[0]]?.[0];
  const text = `Hi all,\n\n${HIGHLIGHT[c[0]]}\n\n${top}, net burn was USD ${fmt(last.burn)} and we ended the month with USD ${fmt(last.cash)} in the bank. We are ${last.hc} people${last.cust !== null ? ` and ${last.cust} customers` : ''}.\n\nAsks: ${c[0] === 'kestrel' ? 'introductions to heads of operations at third-party logistics firms with more than 20 sites' : ask ? ask[1].toLowerCase() : 'none this month'}.\n\n${c[9][1].split(' ')[0]}`;
  const u = await op('updates.add', { company: c[2], subject: `${c[1]}: ${new Date(MONTHS.at(-1) + 'T00:00:00Z').toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })} update`, text }, c[7] === 1 ? T.daniel : T.mei);
  if (u !== null) UPD[c[0]] = { id: (u.update ?? u).id, last };
}
// Your AI agent read each update the partners added (they asked) and staged its values with their quotes.
for (const key of Object.keys(UPD)) {
  {
    const { id, last } = UPD[key];
    const m = MONTHS.at(-1);
    const vals = [];
    if (last.arr !== null) vals.push({ key: 'arr', period_end: m, value: String(last.arr), currency: 'USD', quote: `ARR closed at USD ${fmt(last.arr)}` });
    if (last.revenue !== null) vals.push({ key: 'revenue', period_end: m, value: String(last.revenue), currency: 'USD', quote: `Revenue was USD ${fmt(last.revenue)}` });
    vals.push({ key: 'net_burn', period_end: m, value: String(last.burn), currency: 'USD', quote: `net burn was USD ${fmt(last.burn)}` });
    vals.push({ key: 'cash', period_end: m, value: String(last.cash), currency: 'USD', quote: `USD ${fmt(last.cash)} in the bank` });
    vals.push({ key: 'headcount', period_end: m, value: last.hc, quote: `We are ${last.hc} people` });
    if (last.cust !== null) vals.push({ key: 'customers', period_end: m, value: last.cust, quote: `${last.cust} customers` });
    await op('kpis.stage', { update: id, values: J(vals) }, A);
    UPD[key].staged = true;
  }
}
for (const [key, u] of Object.entries(UPD)) if (u.staged && key !== 'kestrel' && key !== 'corvid') await op('kpis.verify', { update: u.id }, PORT_COS.find((c) => c[0] === key)[7] === 1 ? T.daniel : T.mei);
await op('alerts.run', {}, O);
// Asks: the ones in the updates plus the work the team took on (open, in progress and done).
await op('asks.save', { company: 'kestrelrobotics.com', kind: 'intro', title: 'Heads of operations at large 3PLs', owner: 'me', due_day: dayAdd(TODAY, 3), update: UPD.kestrel?.id, quote: 'introductions to heads of operations at third-party logistics firms' }, O);
await op('asks.save', { company: 'corvidlabs.ai', kind: 'hire', title: 'VP Engineering candidates', owner: 'me' }, T.ava);
for (const c of PORT_COS)
  for (const [kind, title, status, owner, outcome] of ASKS[c[0]] ?? []) {
    const a = await op('asks.save', { company: c[2], kind, title, owner, due_day: status === 'done' ? undefined : dayAdd(TODAY, 7 + title.length % 21) }, O);
    const id = a ? (a.ask ?? a).id : null;
    if (id && status !== 'open') await op('asks.update', { ask: id, status, outcome }, O);
  }
const ca = await op('asks.list', { company: 'corvidlabs.ai' }, O);
const vpe = (ca?.asks ?? []).find((a) => a.title.startsWith('VP Engineering'));
if (vpe) await op('asks.update', { ask: vpe.id, status: 'in_progress', outcome: 'Three candidates shared; two in interviews' }, T.ava);
// Your AI agent found an ask in Juniper Care's update: a proposal waiting.
await op('asks.save', { company: 'junipercare.com', kind: 'customer', title: 'Agencies in Florida for the next launch', update: UPD.juniper?.id, why: 'The update asks for help with the next state.', evidence: 'Asks: home health agency operators', confidence: 0.7 }, A);
// Board meetings: last quarter's with its deck and note, and the next one (Kestrel's is today; Lumora's tomorrow).
const BOARD = {};
for (const [i, c] of PORT_COS.entries()) {
  const deckBytes = pdfOf(`${c[1]}: board meeting`, [
    { title: c[1] + ': board meeting', lines: [`Quarter ending ${qEnd(CQ - 1)}`, c[9][1] + ', ' + c[9][2]] },
    { title: 'KPIs', lines: (() => {
      const r = story(c[0]).at(-2);
      return [topLine(r), `Net burn USD ${fmt(r.burn)} a month`, `Cash USD ${fmt(r.cash)}`, `Headcount ${r.hc}`];
    })() },
    { title: 'Decisions', lines: ['Approve the operating plan for next year', 'Approve the option grants of the quarter'] },
  ]);
  const f = await upload('files.upload', { company: c[2], folder: 'Board' }, [[`${fileName(c[1])}_board_${qEnd(CQ - 1).slice(0, 7)}.pdf`, deckBytes]], O);
  const fileId = f?.files?.[0]?.id;
  await op('board.save', { company: c[2], day: dayAdd(qEnd(CQ - 1), 20 + (i % 10)), time: '10:00', title: 'Board meeting', note: `Reviewed the quarter: ${HIGHLIGHT[c[0]].charAt(0).toLowerCase() + HIGHLIGHT[c[0]].slice(1)} The board approved the plan and the option grants.`, deck: fileId }, O);
  const next = c[0] === 'kestrel' ? TODAY : c[0] === 'lumora' ? dayAdd(TODAY, 1) : dayAdd(TODAY, 9 + ((i * 5) % 40));
  const b = await op('board.save', { company: c[2], day: next, time: c[0] === 'kestrel' ? pad(demoSlots()[0]) + ':00' : '10:00', title: c[0] === 'lumora' ? 'Board meeting: bridge round' : 'Board meeting' }, O);
  if (b) BOARD[c[0]] = (b.meeting ?? b).id;
}
// Your AI agent's briefs for the board meetings within two days (a partner asked for each).
for (const key of Object.keys(BOARD).filter((k) => k === 'kestrel' || k === 'lumora')) {
  const r = story(key).at(-1);
  await op('board.brief-save', { meeting: BOARD[key], brief: J({ sections: [
    { title: 'KPIs', points: [{ text: topLine(r) }, { text: `Net burn USD ${fmt(r.burn)}; cash USD ${fmt(r.cash)}` }] },
    { title: 'Since the last meeting', points: [{ text: HIGHLIGHT[key] }] },
    { title: 'Questions', points: [{ text: key === 'lumora' ? 'Which insiders take their pro rata in the bridge?' : 'What has to be true to raise the next round in six months?' }] },
  ] }) }, A);
}
for (const key of Object.keys(BOARD)) {
  const b = await op('board.list', { company: PORT_COS.find((c) => c[0] === key)[2] }, O);
  const m = (b?.meetings ?? []).find((x) => x.id === BOARD[key]);
  if (m && m.brief_state !== 'ready') {
    const r = story(key).at(-1);
    await op('board.brief-save', { meeting: BOARD[key], brief: J({ sections: [{ title: 'KPIs', points: [{ text: topLine(r) }, { text: `Net burn USD ${fmt(r.burn)}; cash USD ${fmt(r.cash)}` }] }, { title: 'Since the last meeting', points: [{ text: HIGHLIGHT[key] }] }] }) }, A);
  }
}
// Reserve plans and scenarios for both funds.
const RES = [
  [FUND1, 'kestrel', 6, 2, 4000000, [[1, 40000000, 220000000, 10, 'Series C plan in the October board deck'], [2, 80000000, 600000000, 8, 'Partner estimate from public comparables']], 'Defend 6% through the Series C and D.'],
  [FUND1, 'corvid', 5, 1, 1500000, [[1, 25000000, 140000000, 10, 'Founder guidance in the September update']], 'Follow on in the Series B.'],
  [FUND1, 'arclight', 4, 1, 1000000, [[1, 20000000, 100000000, 10, 'Series B timing from the board meeting']], 'Pro rata in the Series B.'],
  [FUND1, 'brightline', 3, 1, 1000000, [[1, 30000000, 180000000, 8, 'Banker conversations in August']], 'Small follow-on; already sold part in a secondary.'],
  [FUND1, 'lumora', 8, 1, 750000, [[1, 5000000, 20000000, 5, 'Bridge terms under discussion']], 'Bridge only with a new lead.'],
  [FUND2, 'halcyon', 8, 2, 4000000, [[1, 18000000, 90000000, 10, 'Series B plan from the extension memo'], [2, 40000000, 250000000, 8, 'Comparable legal AI rounds']], 'Keep 8% through the Series B and C.'],
  [FUND2, 'cobalt', 9, 1, 3500000, [[1, 25000000, 120000000, 10, 'Banker shortlist in the November update']], 'Full pro rata in the Series B.'],
  [FUND2, 'gridwell', 10, 1, 2000000, [[1, 12000000, 48000000, 10, 'Company plan for the Series A']], 'Lead the Series A if the Bavaria project performs.'],
  [FUND2, 'juniper', 10, 1, 1500000, [[1, 10000000, 40000000, 10, 'Company plan for the Series A']], 'Follow on at the Series A.'],
];
for (const [fund, key, target, rounds, allocated, asm, notes] of RES) await op('reserves.plan-save', { fund, holding: HOLD[key], target: String(target), rounds, allocated: String(allocated), assumptions: J(asm.map(([round, raise, post, pool, source]) => ({ round, raise: String(raise), post_money: String(post), pool: String(pool), source }))), notes }, T.priya);
await op('scenarios.save', { fund: FUND1, name: 'Kestrel raises a USD 60M Series C', holdings: J([{ holding: HOLD.kestrel, target: '6', rounds: 1, allocated: '5000000', assumptions: [{ round: 1, raise: '60000000', post_money: '320000000', pool: '8', source: 'Banker conversations in October' }] }]), notes: 'Upside case: a larger round at a higher price.' }, T.priya);
await op('scenarios.save', { fund: FUND1, name: 'No follow-on in Lumora', holdings: J([{ holding: HOLD.lumora, target: '0', rounds: 0, allocated: '0', assumptions: [] }]), notes: 'If the bridge has no new lead, the reserve goes to Kestrel and Corvid.' }, T.priya);
await op('scenarios.save', { fund: FUND2, name: 'Halcyon Series B in 2027', holdings: J([{ holding: HOLD.halcyon, target: '8', rounds: 1, allocated: '5000000', assumptions: [{ round: 1, raise: '25000000', post_money: '140000000', pool: '10', source: 'Partner estimate after the extension' }] }]), notes: 'Earlier and larger Series B.' }, T.priya);
// Your AI agent proposes a reserve plan for Quarry Data.
await op('reserves.plan-save', { fund: FUND1, holding: HOLD.quarry, target: '5', rounds: 1, allocated: '1200000', assumptions: J([{ round: 1, raise: '15000000', post_money: '75000000', pool: '10', source: 'Quarry Data October update: Series A in the spring' }]), notes: 'Pro rata in the Series A.', why: 'The October update says the Series A starts in the spring.', evidence: 'We plan to raise our Series A in the spring.', confidence: 0.7 }, A);

/* ------------------------------------------------------------------ theses */

step('theses, radars, candidates');
const THESES = [
  { name: 'Industrial automation', statement: 'Software and robots that let mid-size operators automate without a capex project.', criteria: [{ key: 'sector', op: 'in', values: ['robotics', 'logistics', 'industrial'] }, { key: 'round_type', op: 'in', values: ['seed', 'series_a'], required: true }, { key: 'hq_country', op: 'in', values: ['US', 'CA', 'GB', 'DE'] }], query: 'warehouse automation robotics' },
  { name: 'Fintech infrastructure', statement: 'APIs that move, hold and reconcile money for vertical software.', criteria: [{ key: 'sector', op: 'in', values: ['fintech', 'payments'] }, { key: 'round_type', op: 'in', values: ['seed', 'series_a'] }, { key: 'business_model', op: 'in', values: ['saas', 'transactional'] }], query: 'payments ledger api' },
  { name: 'Climate software', statement: 'Software that makes clean energy assets earn more.', criteria: [{ key: 'sector', op: 'in', values: ['climate', 'energy'] }, { key: 'round_type', op: 'in', values: ['pre_seed', 'seed', 'series_a'] }], query: 'grid battery dispatch software' },
];
const CANDIDATES = {
  'Industrial automation': [
    ['Forgeline Systems', 'forgeline.io', 'Vision QA cells for contract manufacturers, seed round filed', 'funding'],
    ['Palletwise', 'palletwise.com', 'Autonomous pallet movers leased per hour to 3PLs', 'launch'],
    ['Torque Analytics', 'torqueanalytics.com', 'Predictive maintenance for CNC fleets; hiring 8 engineers', 'hiring'],
  ],
  'Fintech infrastructure': [
    ['Ledgerloop', 'ledgerloop.dev', 'Double-entry ledger API for marketplaces', 'product'],
    ['Settlewise', 'settlewise.com', 'Instant payouts for vertical SaaS platforms in the UK', 'incorporation'],
  ],
  'Climate software': [
    ['Voltaic Grid', 'voltaicgrid.com', 'Battery dispatch software for community grids', 'funding'],
    ['Carbonfold', 'carbonfold.io', 'Scope 3 accounting for mid-size manufacturers', 'repo'],
  ],
};
for (const t of THESES) {
  const th = await op('theses.save', { name: t.name, statement: t.statement, criteria: J(t.criteria) }, T.mei);
  if (th === null) continue;
  const thesisId = (th.thesis ?? th).id;
  const rd = await op('radars.save', { thesis: thesisId, sources: J(['companies_house']), query: t.query, schedule: 'weekly mon 08:00' }, T.mei);
  if (rd === null) continue;
  const radarId = (rd.radar ?? rd).id;
  await op('radars.run', { radar: radarId }, T.mei);
  for (const [name, domain, summary, kind] of CANDIDATES[t.name]) await op('signals.add', { radar: radarId, name, domain, summary, kind, source_url: `https://${domain}/`, context: J({ founders: 'Second-time founders', traction: 'Early design partners' }) }, A);
}

/* ----------------------------------------------------------------- inbound */

step('inbound deals over 12 weeks');
const NAMES = [
  // name, domain, sector, one-liner
  ['Aurora Fleet', 'aurorafleet.com', 'logistics', 'Telematics and maintenance for electric delivery fleets'],
  ['Brisk Claims', 'briskclaims.com', 'insurtech', 'Claims intake automation for regional insurers'],
  ['Tessera Bio', 'tesserabio.com', 'biotech', 'Protein design platform for enzyme manufacturers'],
  ['Lantern Learning', 'lanternlearning.com', 'edtech', 'Tutoring copilots for community colleges'],
  ['Hearth Home', 'hearthhome.co', 'proptech', 'Home maintenance subscriptions for first-time buyers'],
  ['Driftwood Studios', 'driftwoodstudios.com', 'gaming', 'Cozy multiplayer games for mobile'],
  ['Copperline', 'copperline.io', 'fintech', 'Treasury automation for mid-market CFOs'],
  ['Nimbus Compliance', 'nimbuscompliance.com', 'regtech', 'SOC 2 evidence collection for startups'],
  ['Rivet Health', 'rivethealth.com', 'healthcare', 'Prior authorization automation for specialty clinics'],
  ['Solace Mental Health', 'solacehealth.co', 'healthcare', 'Measurement-based care for therapy practices'],
  ['Wavelength Audio', 'wavelengthaudio.com', 'consumer', 'Spatial audio tools for podcast studios'],
  ['Summit Freight', 'summitfreight.com', 'logistics', 'Freight audit and payment for shippers'],
  ['Opal Security', 'opalsecurity.dev', 'cybersecurity', 'Access reviews for engineering teams'],
  ['Bluefin Logistics', 'bluefinlogistics.com', 'logistics', 'Cold chain visibility for seafood exporters'],
  ['Heliotrope Bio', 'heliotropebio.com', 'biotech', 'Plant-based pigments for food makers'],
  ['Cirrus Data', 'cirrusdata.dev', 'data infrastructure', 'Streaming ETL priced per row'],
  ['Marlow Payments', 'marlowpay.com', 'fintech', 'Embedded payments for veterinary software'],
  ['Tandem Health', 'tandemhealth.io', 'healthcare', 'Care coordination for home health agencies'],
  ['Orchard AI', 'orchard-ai.com', 'ai', 'Forecasting copilots for grocery buyers'],
  ['Wildflower Commerce', 'wildflowercommerce.com', 'ecommerce', 'Wholesale storefronts for independent brands'],
  ['Keystone Grid', 'keystonegrid.com', 'climate', 'Interconnection studies in days instead of months'],
  ['Rowan Robotics', 'rowanrobotics.com', 'robotics', 'Robotic depalletizing for food distributors'],
  ['Ember Analytics', 'emberanalytics.io', 'data infrastructure', 'Product analytics for B2B apps'],
];
const PASSED = [
  ['Glimmer Social', 'glimmersocial.app', 'consumer', 'traction'],
  ['Quarrytown Media', 'quarrytown.media', 'media', 'thesis_fit'],
  ['Pebble Pay', 'pebblepay.co', 'fintech', 'market'],
  ['Atlas Kitchens', 'atlaskitchens.com', 'food', 'thesis_fit'],
  ['Juno Wellness', 'junowellness.com', 'consumer', 'traction'],
  ['Sprocket HR', 'sprockethr.com', 'hr tech', 'market'],
  ['Vireo Travel', 'vireotravel.com', 'travel', 'timing'],
  ['Kiln Ceramics', 'kilnceramics.com', 'consumer', 'thesis_fit'],
  ['Parallax AR', 'parallaxar.io', 'consumer', 'product'],
  ['Moxie Pets', 'moxiepets.com', 'consumer', 'valuation'],
  ['Cartwheel Kids', 'cartwheelkids.com', 'edtech', 'traction'],
  ['Strata Legal', 'stratalegal.ai', 'legal tech', 'team'],
  ['Halo Fitness', 'halofitness.app', 'consumer', 'market'],
  ['Brickyard Homes', 'brickyardhomes.com', 'proptech', 'valuation'],
  ['Telescope Recruiting', 'telescoperecruit.com', 'hr tech', 'traction'],
  ['Fable Books', 'fablebooks.co', 'media', 'thesis_fit'],
  ['Comet Delivery', 'cometdelivery.com', 'logistics', 'market'],
  ['Sable Fashion', 'sablefashion.com', 'ecommerce', 'thesis_fit'],
  ['Verdant Farms', 'verdantfarms.ag', 'agtech', 'timing'],
  ['Pixel Forge', 'pixelforge.gg', 'gaming', 'traction'],
  ['Lumen Notes', 'lumennotes.app', 'productivity', 'market'],
];
const HELD = [
  ['Ridgeback Drones', 'ridgebackdrones.com', 'robotics'],
  ['Tidal Ledger', 'tidalledger.com', 'fintech'],
];
const FRESH_IN = [
  // ready (your AI agent read it), one past its reply day, two just in
  { name: 'Quill Robotics', domain: 'quillrobotics.com', sector: 'robotics', founder: ['Ana Ruiz', 'ana@quillrobotics.com'], days: 2, read: true, text: 'Hi Olivia, Quill Robotics builds mobile picking arms for mid-size warehouses. We are raising a USD 4,000,000 seed round on a post-money SAFE with a USD 20,000,000 cap. ARR is USD 900,000 with 6 paying customers, growing 14% month over month. Team of 12, CTO from a robotics PhD lab. Deck attached on request. Ana', facts: [['round_type', 'seed', 'raising a USD 4,000,000 seed round'], ['raise_minor', '4000000', 'raising a USD 4,000,000 seed round', 'USD'], ['post_money_minor', '20000000', 'USD 20,000,000 cap', 'USD'], ['arr_minor', '900000', 'ARR is USD 900,000', 'USD'], ['customers', 6, '6 paying customers'], ['growth_mom_ppm', '14', 'growing 14% month over month'], ['team_size', 12, 'Team of 12'], ['currency', 'USD', 'USD 4,000,000']] },
  { name: 'Ferro Analytics', domain: 'ferroanalytics.com', sector: 'industrial', founder: ['Tomas Brandt', 'tomas@ferroanalytics.com'], days: 4, read: true, text: 'Hello, Ferro Analytics predicts furnace failures for steel mini-mills. Raising USD 2,500,000 seed. Revenue is USD 40,000 a month from 3 mills. Team of 7. Tomas', facts: [['round_type', 'seed', 'Raising USD 2,500,000 seed'], ['raise_minor', '2500000', 'Raising USD 2,500,000 seed', 'USD'], ['customers', 3, 'from 3 mills'], ['team_size', 7, 'Team of 7'], ['currency', 'USD', 'USD 2,500,000']] },
  { name: 'Vantage Ledger', domain: 'vantageledger.com', sector: 'fintech', founder: ['Priyanka Rao', 'priyanka@vantageledger.com'], days: 5, read: true, text: 'Hi team, Vantage Ledger is a reconciliation API for marketplaces. We are raising a USD 6,000,000 Series A. ARR USD 1,800,000 with 41 customers. Priyanka', facts: [['round_type', 'series_a', 'raising a USD 6,000,000 Series A'], ['raise_minor', '6000000', 'raising a USD 6,000,000 Series A', 'USD'], ['arr_minor', '1800000', 'ARR USD 1,800,000', 'USD'], ['customers', 41, 'with 41 customers'], ['currency', 'USD', 'USD 6,000,000']] },
  { name: 'Maple Wealth', domain: 'maplewealth.co', sector: 'fintech', founder: ['Chris Doyle', 'chris@maplewealth.co'], days: 11, read: true, text: 'Hi Olivia, Maple Wealth is a robo-advisor for nurses. Raising USD 1,500,000 pre-seed. 2,000 users on the waitlist. Chris', facts: [['round_type', 'pre_seed', 'Raising USD 1,500,000 pre-seed'], ['raise_minor', '1500000', 'Raising USD 1,500,000 pre-seed', 'USD'], ['currency', 'USD', 'USD 1,500,000']] },
  { name: 'Ironbark Materials', domain: 'ironbarkmaterials.com', sector: 'climate', founder: ['Ruth Ng', 'ruth@ironbarkmaterials.com'], days: 0, read: false, text: 'Hello, Ironbark Materials makes low-carbon cement additives. We are raising a seed round; our deck is attached. Ruth', deck: [
    { title: 'Ironbark Materials', lines: ['Low-carbon cement additives for ready-mix producers', 'Seed round, 2026'] },
    { title: 'Problem', lines: ['Cement is about 8% of global CO2 emissions', 'Ready-mix producers face carbon limits from 2028'] },
    { title: 'Product', lines: ['A mineral additive that replaces 30% of clinker', 'Same strength at 28 days in our plant trials'] },
    { title: 'Traction', lines: ['3 paid pilots with regional ready-mix producers', 'Letters of intent worth USD 1.1M a year', 'Revenue to date USD 180K'] },
    { title: 'Team', lines: ['Ruth Ng, CEO: 9 years in materials R&D', 'Owen Pike, CTO: built two additive plants'] },
    { title: 'The ask', lines: ['Raising USD 2.5M seed on a SAFE', 'Valuation cap USD 14M', 'Use: first production line and certification'] },
  ] },
  { name: 'Pallas Microgrid', domain: 'pallasmicrogrid.com', sector: 'climate', founder: ['Sofia Lindqvist', 'sofia@pallasmicrogrid.com'], days: 0, read: false, text: 'Hi Mei, as discussed at the conference: Pallas Microgrid runs campus microgrids as a service. Raising a USD 5,000,000 seed; deck attached. Sofia', deck: [
    { title: 'Pallas Microgrid', lines: ['Campus microgrids as a service', 'Seed round, 2026'] },
    { title: 'Market', lines: ['4,000 US campuses with backup diesel and rising tariffs', 'Microgrid spend of USD 9B a year by 2030 (industry estimate)'] },
    { title: 'Model', lines: ['We build, own and run the microgrid', '15-year energy contracts, no upfront cost to the campus'] },
    { title: 'Traction', lines: ['2 campuses live, 5 signed', 'Contracted revenue USD 3.4M over the contract terms', 'Gross margin 38% on live sites'] },
    { title: 'Team', lines: ['Sofia Lindqvist, CEO: led 40 grid projects at a utility', 'Marco Diaz, CFO: project finance'] },
    { title: 'The ask', lines: ['Raising USD 5M seed, priced', 'Pre-money valuation USD 20M', 'Use: 4 new sites and the operations team'] },
  ] },
];
// Spread arrivals over 12 weeks, rising week on week, the latest weeks busiest.
const weeksBack = (i, n) => Math.floor(((n - 1 - i) / n) * 12 * 7);
const ALL_IN = [...NAMES.map((x) => ({ kind: 'deal', x })), ...PASSED.map((x) => ({ kind: 'pass', x })), ...HELD.map((x) => ({ kind: 'hold', x }))];
// interleave so passes and deals mix across weeks
ALL_IN.sort((a, b) => (a.x[1] < b.x[1] ? -1 : 1));
const SRC = ['ana.lopez@foundry-angels.example', 'mark.ellis@seedcamp-friends.example', 'jules@operatorcollective.example', 'nina.patel@northgate-endowment.example', 'tom@techstars-alumni.example'];
const ITEMS = {};
// Three of the people who send deals are the firm's scouts; their emails are filed as scout submissions.
const SCOUTS = [
  ['Ana Lopez', 'ana.lopez@foundry-angels.example', 'Robotics and industrial angel, Pittsburgh'],
  ['Jules Moreau', 'jules@operatorcollective.example', 'Operator collective, fintech and B2B'],
  ['Tom Fischer', 'tom@techstars-alumni.example', 'Accelerator alumni network'],
];
for (const [name, email, note] of SCOUTS) await op('scouts.save', { name, email, status: 'active', note }, O);
await op('scouts.save', { name: 'Rhea Kapoor', email: 'rhea@climate-angels.example', status: 'paused', note: 'Climate angel; paused while on sabbatical' }, O);
const sender = (i) => ({ name: SRC[i % SRC.length].split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), email: SRC[i % SRC.length] });
/** How an item came: a scout's email, a deck a member uploaded after a meeting, or plain email. */
const channelOf = (i) => {
  const s = SRC[i % SRC.length];
  if (SCOUTS.some((x) => x[1] === s) && i % 2 === 0) return { channel: 'scout', scout: s };
  return i % 7 === 3 ? { channel: 'upload' } : { channel: 'email' };
};
// A year of earlier inbound, passed at a first look (the deal flow chart reads twelve months).
const OLDER = [];
{
  const A1 = ['Alder', 'Basin', 'Cobble', 'Dune', 'Ember', 'Fjord', 'Glade', 'Hollow', 'Isle', 'Jetty', 'Knoll', 'Lark', 'Mesa', 'Nook', 'Orbit', 'Prairie', 'Quay', 'Ridge', 'Shoal', 'Thicket', 'Upland', 'Vale', 'Willow', 'Yarrow'];
  const A2 = [['Pay', 'fintech', 'pay.com'], ['Health', 'healthcare', 'health.com'], ['Robotics', 'robotics', 'robotics.com'], ['Data', 'data infrastructure', 'data.io'], ['Grid', 'climate', 'grid.energy'], ['Commerce', 'ecommerce', 'commerce.com'], ['Labs', 'ai', 'labs.ai'], ['Freight', 'logistics', 'freight.com']];
  const REASONS = ['thesis_fit', 'traction', 'market', 'valuation', 'team', 'timing'];
  const CH = ['email', 'email', 'email', 'upload', 'scout', 'sourced', 'email', 'csv', 'email', 'scout'];
  // Two a month from the fourth month back (passed today, so they weigh on the Inbox's reply time: kept few).
  for (let i = 0; i < 18; i++) {
    const a = A1[i % A1.length];
    const [b, sector, tld] = A2[(i * 5 + Math.floor(i / A1.length)) % A2.length];
    const daysAgo = 95 + Math.floor((i * 265) / 18) + (i % 4);
    OLDER.push({ name: a + ' ' + b, domain: (a + tld).toLowerCase(), sector, daysAgo, channel: CH[i % CH.length], reason: REASONS[(i * 7) % REASONS.length] });
  }
}
for (let i = 0; i < OLDER.length; i++) {
  const x = OLDER[i];
  const at = new Date(nyAt(dayAdd(TODAY, -x.daysAgo), pad(9 + (i % 8)) + ':' + pad((i * 11) % 60))).toISOString();
  const via = x.channel === 'scout' ? { scout: SCOUTS[i % 3][1] } : x.channel === 'email' ? { source_person: J(sender(i)) } : {};
  const it = await op('intake.add', Object.assign({ company: x.domain, name: x.name, channel: x.channel, received_at: at }, via), x.channel === 'sourced' ? T.mei : O);
  x.id = it?.id ?? it?.item?.id;
}
for (const reason of new Set(OLDER.map((x) => x.reason))) {
  const items = OLDER.filter((x) => x.reason === reason && x.id).map((x) => x.id);
  if (items.length > 0) await op('intake.pass', { items: J(items), reason, email: false, note: 'Passed at a first look' }, [T.daniel, T.mei, O, T.sam][items.length % 4]);
}
for (let i = 0; i < ALL_IN.length; i++) {
  const { kind, x } = ALL_IN[i];
  const daysAgo = Math.max(3, weeksBack(i, ALL_IN.length) + (i % 3));
  const at = new Date(nyAt(dayAdd(TODAY, -daysAgo), pad(9 + (i % 8)) + ':' + pad((i * 7) % 60))).toISOString();
  await op('companies.upsert', { name: x[0], domain: x[1], sector: x[2], kind: 'startup', hq_country: 'US' }, O);
  const ch = channelOf(i);
  const it = await op('intake.add', Object.assign({ company: x[1], name: x[0], source_person: J(sender(i)), received_at: at }, ch), O);
  if (it === null) continue;
  ITEMS[x[1]] = it.number ?? it.item?.number ?? it.id;
  if (kind === 'pass') await op('intake.pass', { item: it.id ?? it.item?.id, reason: x[3], email: false, note: 'Outside what we back right now' }, [T.daniel, T.mei, O][i % 3]);
  if (kind === 'hold') await op('intake.hold', { item: it.id ?? it.item?.id, days: 60, note: 'Revisit after their pilot results' }, T.mei);
}
// The fresh ones (your AI agent reads the email; two still waiting for it).
for (const f of FRESH_IN) {
  await op('companies.upsert', { name: f.name, domain: f.domain, sector: f.sector, kind: 'startup', hq_country: 'US' }, O);
  const at = new Date(Date.now() - f.days * DAY - 3600000 * 2).toISOString();
  const params = { company: f.domain, name: f.name, channel: 'email', text: f.text, source_person: J({ name: f.founder[0], email: f.founder[1] }), received_at: at };
  // The two still waiting came with a deck (a real text layer), so their triage reads a deck.
  const it = f.deck ? await upload('intake.add', params, [[fileName(f.name) + '_deck.pdf', pdfOf(f.name + ': seed deck', f.deck)]], f.name === 'Pallas Microgrid' ? T.mei : O) : await op('intake.add', params, f.name === 'Pallas Microgrid' ? T.mei : O);
  if (it === null) continue;
  ITEMS[f.domain] = it.number ?? it.id;
  f.id = it.id ?? it.item?.id;
}
// Your AI agent read the ones the partners added (they asked); the rest wait for Ask your AI agent.
for (const f of FRESH_IN.filter((x) => x.read && x.id !== undefined)) {
  {
    await op('triage.facts-save', { item: f.id, company: J({ name: f.name, domain: f.domain }), one_liner: f.text.split('. ')[0].replace(/^(Hi|Hello)[^,]*, /, '').slice(0, 120), founders: J([{ name: f.founder[0], email: f.founder[1], title: 'CEO' }]), missing: J(['financials', 'competition']), questions: J(['What does a first deployment cost the customer?', 'Who else is in the round?']), facts: J(f.facts.map(([key, value, quote, currency]) => Object.assign({ key, value, grade: 'founder_reported', quote }, currency ? { currency } : {}))) }, A);
    f.done = true;
  }
}

/* -------------------------------------------------------------------- deals */

step('deals across the stages');
const POINT = { sam: T.sam, daniel: T.daniel, mei: T.mei, olivia: DEMO.owner };
const STAGES = ['screen', 'first_meeting', 'diligence', 'partner_meeting', 'ic', 'term_sheet'];
// domain, final stage, point, round, raise, post, check, instrument
const PIPE = [
  ['aurorafleet.com', 'screen', 'sam', 'seed', 3000000, 15000000, 1000000, 'safe_cap'],
  ['briskclaims.com', 'screen', 'daniel', 'seed', 2500000, 12000000, 750000, 'safe_cap'],
  ['tesserabio.com', 'screen', 'mei', 'seed', 5000000, 25000000, 1500000, 'priced'],
  ['lanternlearning.com', 'screen', 'sam', 'pre_seed', 1500000, 9000000, 500000, 'safe_cap'],
  ['hearthhome.co', 'screen', 'olivia', 'seed', 3500000, 18000000, 1000000, 'safe_cap'],
  ['driftwoodstudios.com', 'screen', 'daniel', 'seed', 2000000, 10000000, 500000, 'safe_cap'],
  ['copperline.io', 'screen', 'mei', 'series_a', 10000000, 50000000, 3000000, 'priced'],
  ['nimbuscompliance.com', 'screen', 'sam', 'seed', 3000000, 16000000, 1000000, 'safe_cap'],
  ['rivethealth.com', 'first_meeting', 'sam', 'seed', 4000000, 20000000, 1500000, 'safe_cap'],
  ['solacehealth.co', 'first_meeting', 'mei', 'seed', 3000000, 15000000, 1000000, 'safe_cap'],
  ['wavelengthaudio.com', 'first_meeting', 'daniel', 'seed', 2500000, 12500000, 750000, 'safe_cap'],
  ['summitfreight.com', 'first_meeting', 'olivia', 'series_a', 8000000, 40000000, 2500000, 'priced'],
  ['opalsecurity.dev', 'first_meeting', 'daniel', 'seed', 3500000, 17500000, 1000000, 'safe_cap'],
  ['bluefinlogistics.com', 'diligence', 'olivia', 'series_a', 9000000, 45000000, 3000000, 'priced'],
  ['heliotropebio.com', 'diligence', 'mei', 'seed', 4000000, 20000000, 1500000, 'priced'],
  ['cirrusdata.dev', 'diligence', 'daniel', 'seed', 3000000, 15000000, 1000000, 'safe_cap'],
  ['marlowpay.com', 'diligence', 'mei', 'series_a', 12000000, 60000000, 3500000, 'priced'],
  ['tandemhealth.io', 'diligence', 'sam', 'seed', 3500000, 18000000, 1000000, 'safe_cap'],
  ['orchard-ai.com', 'partner_meeting', 'daniel', 'series_a', 12000000, 60000000, 4000000, 'priced'],
  ['wildflowercommerce.com', 'partner_meeting', 'mei', 'seed', 4000000, 22000000, 1500000, 'safe_cap'],
  ['keystonegrid.com', 'partner_meeting', 'olivia', 'seed', 5000000, 25000000, 2000000, 'priced'],
  ['rowanrobotics.com', 'ic', 'daniel', 'seed', 5000000, 25000000, 2000000, 'priced'],
  ['emberanalytics.io', 'ic', 'mei', 'seed', 4000000, 32000000, 1500000, 'safe_cap'],
];
const DEALS = {};
// Deals entered their stages over the last weeks (logged with on_day), so days in stage and stalls are real.
const SPREAD = [3, 9, 16, 24, 31, 5, 12, 38, 2, 27];
let spreadAt = 0;
/** The days a deal's moves happened, oldest first: the last one `last` days ago, each earlier one 4 days before. */
const movedDays = (n, last) => Array.from({ length: n }, (_, k) => dayAdd(TODAY, -(last + 4 * (n - 1 - k))));
for (const [domain, final, point, round_type, raise, post, check, instrument] of PIPE) {
  const item = ITEMS[domain];
  let deal = null;
  if (item !== undefined) {
    const a = await op('intake.advance', { item, point: POINT[point], fund: FUND2 }, POINT[point]);
    deal = a?.deal ?? null;
    if (deal !== null) await op('deals.update', { deal: deal.number ?? deal.id, round_type, raise: String(raise), post_money: String(post), check: String(check), instrument, currency: 'USD' }, POINT[point]);
  }
  if (deal === null) continue;
  DEALS[domain] = deal.number ?? deal.id;
  const to = final === 'ic' ? 'partner_meeting' : final;
  const steps = STAGES.slice(1, STAGES.indexOf(to) + 1);
  const days = movedDays(steps.length, SPREAD[spreadAt++ % SPREAD.length]);
  for (const [k, s] of steps.entries()) await op('deals.move', { deal: DEALS[domain], stage: s, on_day: days[k] }, POINT[point]);
}
// Deals that came by referral or our own sourcing, straight into the pipeline.
const DIRECT = [
  ['Larch Robotics', 'larchrobotics.com', 'robotics', 'sourced', 'sam', 'seed', 'outbound'],
  ['Corbel AI', 'corbel.ai', 'ai', 'sourced', 'daniel', 'pre_seed', 'referral'],
  ['Tern Freight', 'ternfreight.com', 'logistics', 'sourced', 'olivia', 'seed', 'event'],
  ['Halyard Health', 'halyardhealth.co', 'healthcare', 'sourced', 'mei', 'seed', 'referral'],
  ['Sorrel Payments', 'sorrelpay.com', 'fintech', 'sourced', 'sam', 'seed', 'co_investor'],
  ['Basalt Energy', 'basaltenergy.com', 'climate', 'partner_meeting', 'mei', 'series_a', 'referral'],
  ['Northstar Ledger', 'northstarledger.com', 'fintech', 'partner_meeting', 'olivia', 'series_a', 'referral'],
  ['Mosaic Health', 'mosaichealth.co', 'healthcare', 'partner_meeting', 'daniel', 'seed', 'referral'],
  ['Granite Seven', 'graniteseven.com', 'cybersecurity', 'first_meeting', 'daniel', 'seed', 'referral'],
  ['Fennel Foods', 'fennelfoods.com', 'food', 'screen', 'mei', 'seed', 'inbound'],
  ['Wren Insurance', 'wreninsurance.com', 'insurtech', 'diligence', 'sam', 'seed', 'referral'],
  ['Pylon Health', 'pylonhealth.com', 'healthcare', 'partner_meeting', 'daniel', 'series_a', 'co_investor'],
];
for (const d of DIRECT) {
  const [name, domain, sector, stage, point, round_type, source] = d;
  await op('companies.upsert', { name, domain, sector, kind: 'startup', hq_country: 'US' }, O);
  const big = round_type === 'series_a';
  const c = await op('deals.create', { company: domain, name, source, point: POINT[point], fund: FUND2, round_type, raise: big ? '10000000' : '3500000', post_money: big ? '55000000' : '18000000', check: big ? '3000000' : '1000000', currency: 'USD', instrument: big ? 'priced' : 'safe_cap' }, POINT[point]);
  if (c === null) continue;
  DEALS[domain] = c.deal?.number ?? c.number;
  if (stage !== 'sourced') {
    const steps = ['screen', ...STAGES.slice(1)].slice(0, ['screen', ...STAGES.slice(1)].indexOf(stage) + 1);
    const days = movedDays(steps.length, SPREAD[spreadAt++ % SPREAD.length]);
    for (const [k, s] of steps.entries()) await op('deals.move', { deal: DEALS[domain], stage: s, on_day: days[k] }, POINT[point]);
  }
}
// Passed and held deals (closed after a first look or diligence).
for (const [domain, status, reason] of [
  ['wavelengthaudio.com', 'passed', 'Market too small for a venture outcome'],
  ['driftwoodstudios.com', 'passed', 'Outside the thesis'],
  ['tandemhealth.io', 'hold', 'Waiting for their Medicare pilot results'],
  ['fennelfoods.com', 'passed', 'Margins'],
  ['lanternlearning.com', 'hold', 'Revisit after the spring pilots'],
]) if (DEALS[domain]) await op('deals.status', { deal: DEALS[domain], status, reason }, O);

/* --------------------------------------------------------------- committee */

step('investment committee: last week and today');
async function memo(dealRef, summary, thesis, rec, as) {
  const m = await op('memos.open', { deal: dealRef }, as);
  if (m === null) return null;
  const id = (m.memo ?? m).id;
  await op('memos.block-save', { memo: id, section: 'summary', text: summary }, as);
  await op('memos.block-save', { memo: id, section: 'thesis', text: thesis }, as);
  await op('memos.block-save', { memo: id, section: 'recommendation', text: rec }, as);
  await op('memos.submit', { memo: id }, as);
  return id;
}
const itemOf = async (meeting, dealRef) => {
  const g = await op('meetings.get', { meeting }, O);
  return (g?.meeting?.items ?? []).find((x) => x.deal && (x.deal.number === dealRef || x.deal.id === dealRef)) ?? null;
};
/** Every voter's vote, the reveal and the decision on one agenda item. */
async function decide(meeting, dealRef, votes, outcome, extra) {
  const it = await itemOf(meeting, dealRef);
  if (it === null) return null;
  await op('meetings.item-save', { item: it.id, cooling_hours: 0 }, O);
  for (const [who, choice, rationale] of votes) await op('votes.cast', { item: it.id, choice, rationale }, who, pin);
  await op('votes.reveal', { item: it.id }, O, pin);
  return op('decisions.record', Object.assign({ item: it.id, outcome }, extra), O, pin);
}
// IC-001, five weeks ago: Pylon Health (invest; closing now), Halcyon AI's extension (follow-on, invest) and
// Heliotrope Bio (pass, in the anti-portfolio with what happened since).
const hx = await op('deals.create', { company: 'halcyonlegal.ai', name: 'Halcyon AI: Series A extension', source: 'portfolio', point: T.daniel, fund: FUND2, round_type: 'series_a', raise: '6000000', post_money: '36000000', check: '2400000', currency: 'USD', instrument: 'priced' }, T.daniel);
if (hx !== null) DEALS['halcyonlegal.ai'] = hx.deal?.number ?? hx.number;
if (DEALS['heliotropebio.com']) await op('deals.move', { deal: DEALS['heliotropebio.com'], stage: 'partner_meeting' }, T.mei);
for (const d of ['pylonhealth.com', 'heliotropebio.com']) if (DEALS[d]) await op('deals.move', { deal: DEALS[d], stage: 'ic' }, O);
const m0 = (await op('meetings.list', {}, O))?.next ?? null;
if (m0 !== null) {
  await op('meetings.save', { meeting: m0.id, facilitator: DEMO.owner }, O);
  if (DEALS['halcyonlegal.ai']) await op('meetings.add-item', { meeting: m0.id, deal: DEALS['halcyonlegal.ai'], kind: 'follow_on' }, O);
  await memo(DEALS['pylonhealth.com'], 'Pylon Health automates referral intake for multi-site specialty practices. USD 2.6M ARR, 118% net retention, 31 practices live.', 'Specialty practices lose a third of referrals to slow intake; Pylon turns intake into a same-day workflow.', 'Invest USD 3M in the Series A at USD 55M post.', T.daniel);
  await memo(DEALS['heliotropebio.com'], 'Heliotrope Bio makes plant-based pigments for food makers. Two pilot customers, USD 180K revenue.', 'Natural colours replace synthetic dyes as US states ban them.', 'Pass: the plant needs USD 30M before revenue scales.', T.mei);
  await memo(DEALS['halcyonlegal.ai'], 'Halcyon AI extends its Series A by USD 6M at USD 36M post after doubling ARR in two quarters.', 'Our pro rata keeps Fund II at 8% in the category leader for contract review.', 'Invest USD 2.4M, our full pro rata.', T.daniel);
  const pd = await decide(m0.id, DEALS['pylonhealth.com'], [[O, '5', 'Retention and expansion are best in class'], [T.daniel, '5', 'Clear path to USD 10M ARR'], [T.mei, '4', 'Sales cycle is long']], 'invest', { rule: 'majority', conditions: J([{ text: 'Customer calls with three practices', owner: T.daniel, due_day: dayAdd(TODAY, -28) }]) });
  await decide(m0.id, DEALS['heliotropebio.com'], [[O, '2', 'Capital intensity'], [T.daniel, '2', 'Too early'], [T.mei, '4', 'Strong science']], 'pass', { rule: 'majority', reason: 'market', note: 'The plant needs USD 30M before revenue scales' });
  await decide(m0.id, DEALS['halcyonlegal.ai'], [[O, '5', 'Doubling ARR'], [T.daniel, '5', 'Keep our ownership'], [T.mei, '4', 'Price is full but fair']], 'invest', { rule: 'majority' });
  await op('meetings.save', { meeting: m0.id, day: dayAdd(TODAY, -35), time: '10:00' }, O);
  await op('meetings.close', { meeting: m0.id }, O);
  for (const c of pd?.decision?.conditions ?? []) await op('conditions.complete', { condition: c.id, proof: 'Calls with Brookline Ortho, Vista Cardiology and Summit Derm: all renewing' }, T.daniel);
  const hd = await op('decisions.get', { deal: DEALS['heliotropebio.com'] }, O);
  if (hd?.decision) await op('decisions.review-note', { decision: hd.decision.id, event: 'raised', text: 'Raised a USD 9M seed extension led by a food-industry corporate fund.', source_url: 'https://heliotropebio.com/news', source_name: 'Heliotrope Bio', day: dayAdd(TODAY, -6) }, O);
  // The invest decisions moved both deals to Term sheet; Pylon has signed and Halcyon's extension is funded.
  if (DEALS['pylonhealth.com']) await op('deals.move', { deal: DEALS['pylonhealth.com'], stage: 'closed', note: 'Documents signed; funded from the next Fund II call' }, T.daniel);
  if (DEALS['halcyonlegal.ai']) {
    await op('deals.move', { deal: DEALS['halcyonlegal.ai'], stage: 'closed', note: 'Extension closed' }, T.daniel);
    await op('deals.status', { deal: DEALS['halcyonlegal.ai'], status: 'invested', reason: "Funded from this quarter's Fund II call" }, T.daniel);
  }
}
// IC-002, a week ago: Rowan Robotics (invest, with conditions) and Ember Analytics (pass).
for (const d of ['rowanrobotics.com', 'emberanalytics.io']) if (DEALS[d]) await op('deals.move', { deal: DEALS[d], stage: 'ic' }, O);
const m1 = (await op('meetings.list', {}, O))?.next ?? null;
if (m1 !== null) {
  await op('meetings.save', { meeting: m1.id, facilitator: DEMO.owner }, O);
  await memo(DEALS['rowanrobotics.com'], 'Rowan Robotics automates depalletizing for food distributors with a robot leased per site. USD 1.1M ARR across 9 distribution centers.', 'Distributors cannot hire for the dock; a lease removes the capex barrier.', 'Invest USD 2M in the seed at USD 25M post.', T.daniel);
  await memo(DEALS['emberanalytics.io'], 'Ember Analytics sells product analytics to B2B apps. USD 600K ARR.', 'Crowded market; their edge is warehouse-native pricing.', 'Pass unless the price comes down.', T.mei);
  for (const [d, votes, outcome, extra] of [
    ['rowanrobotics.com', [[O, '5', 'Best hardware unit economics we have seen'], [T.daniel, '5', 'Customers renew and expand'], [T.mei, '4', 'Service cost is the risk']], 'invest', { rule: 'majority', conditions: J([{ text: 'Reference call with the former VP Engineering', owner: DEMO.owner, due_day: TODAY }, { text: 'Pro rata rights in the term sheet', owner: T.daniel, due_day: dayAdd(TODAY, -2) }]) }],
    ['emberanalytics.io', [[O, '2', 'Crowded'], [T.daniel, '2', 'Price'], [T.mei, '4', 'Strong founders']], 'pass', { rule: 'majority', reason: 'valuation', note: 'Price too high for the traction' }],
  ]) {
    const it = await itemOf(m1.id, DEALS[d]);
    if (it === null) continue;
    await op('meetings.item-save', { item: it.id, cooling_hours: 0 }, O);
    for (const [who, choice, rationale] of votes) await op('votes.cast', { item: it.id, choice, rationale }, who, pin);
    await op('votes.reveal', { item: it.id }, O, pin);
    await op('decisions.record', Object.assign({ item: it.id, outcome }, extra), O, pin);
  }
  await op('meetings.save', { meeting: m1.id, day: dayAdd(TODAY, -7), time: '10:00' }, O);
  await op('meetings.close', { meeting: m1.id }, O);
  const dg = await op('decisions.get', { deal: DEALS['rowanrobotics.com'] }, O);
  const done = (dg?.decision?.conditions ?? []).find((c) => c.text.startsWith('Pro rata'));
  if (done) await op('conditions.complete', { condition: done.id, proof: 'Term sheet section 4.2' }, T.daniel);
}
// IC-003, today and live: Northstar Ledger (every vote in), Basalt Energy (your vote due), Mosaic Health (cooling).
for (const d of ['northstarledger.com', 'basaltenergy.com', 'mosaichealth.co']) if (DEALS[d]) await op('deals.move', { deal: DEALS[d], stage: 'ic' }, O);
const m2 = (await op('meetings.list', {}, O))?.next ?? null;
if (m2 !== null) {
  await op('meetings.save', { meeting: m2.id, facilitator: DEMO.owner, day: TODAY, time: '10:00' }, O);
  await memo(DEALS['northstarledger.com'], 'Northstar Ledger runs the month-end close for multi-entity companies. USD 3.2M ARR, 128% net retention.', 'The close is the last spreadsheet process in finance.', 'Invest USD 3M in the Series A.', DEMO.owner);
  await memo(DEALS['basaltenergy.com'], 'Basalt Energy builds bidding and dispatch software for long-duration storage. Four utility pilots.', 'Storage capacity triples by 2030 and needs its own software stack.', 'Invest USD 3M in the Series A.', T.mei);
  await memo(DEALS['mosaichealth.co'], 'Mosaic Health gives physician groups revenue cycle analytics. USD 900K ARR.', 'Groups lose 4% of revenue to denials they never see.', 'Invest USD 1M in the seed.', T.daniel);
  const ns = await itemOf(m2.id, DEALS['northstarledger.com']);
  if (ns) {
    await op('meetings.item-save', { item: ns.id, cooling_hours: 0 }, O);
    for (const [who, choice, why] of [[O, '4', 'Clear pain, fair price'], [T.daniel, '5', 'Retention is exceptional'], [T.mei, '4', 'Competition from ERPs']]) await op('votes.cast', { item: ns.id, choice, rationale: why }, who, pin);
  }
  const bs = await itemOf(m2.id, DEALS['basaltenergy.com']);
  if (bs) {
    await op('meetings.item-save', { item: bs.id, cooling_hours: 0 }, O);
    for (const [who, choice, why] of [[T.daniel, '4', 'Strong pilots'], [T.mei, '5', 'Category leader']]) await op('votes.cast', { item: bs.id, choice, rationale: why }, who, pin);
  }
  if (ns) await op('meetings.start', { meeting: m2.id, item: ns.id }, O);
}

/* ---------------------------------------------------- your AI agent's work */

step("your AI agent's prepared work");
// A note proposal: Orchard AI's raise grew in the partner meeting prep.
if (DEALS['orchard-ai.com']) await op('deals.update', { deal: DEALS['orchard-ai.com'], raise: '15000000', post_money: '75000000', why: 'The founders raised the round size in their latest email.', evidence: 'We are now raising USD 15M at USD 75M post, led by Harbor Growth.', confidence: 0.8 }, A);
// Diligence answers to confirm (public sources).
if (DEALS['bluefinlogistics.com']) {
  const dd = await op('dd.get', { deal: DEALS['bluefinlogistics.com'] }, A);
  const say = {
    team_leadership: ['CEO and COO ran operations at a global shipping line; CTO built cold chain sensors.', 'about'],
    market_competitors: ['Tive, Controlant and Emerson; none prices per shipment.', 'compare'],
    cust_logos: ['Three of the five largest Alaskan seafood exporters.', 'customers'],
  };
  const answers = (dd?.questions ?? []).filter((q) => say[q.key] !== undefined).map((q) => ({ question: q.id, value: say[q.key][0], grade: 'public', sources: [`https://bluefinlogistics.com/${say[q.key][1]}`] }));
  if (answers.length > 0) await op('dd.answer', { answers: J(answers) }, A);
}
// A pass email your AI agent drafted for a person to approve.
const passOne = PASSED[0];
const pi = await op('intake.add', { company: 'cinderstudio.com', name: 'Cinder Studio', channel: 'email', text: 'Hi, Cinder Studio makes AI video editing for creators. Raising USD 2M. Lee', source_person: J({ name: 'Lee Park', email: 'lee@cinderstudio.com' }), received_at: new Date(Date.now() - 6 * DAY).toISOString() }, T.daniel);
if (pi !== null) {
  const pid = pi.id ?? pi.item?.id;
  const pp = await op('intake.pass', { item: pid, reason: 'thesis_fit', criterion: 'Consumer creator tools', revisit_milestone: 'A B2B product line' }, T.daniel);
  if (pp) {
    await op('passes.draft', { pass: (pp.pass ?? pp).id, subject: 'Re: Cinder Studio', body: 'Hi Lee,\n\nThank you for sending us Cinder Studio. We liked how fast creators adopted the editor and the quality of the demo.\n\nWe are not the right investor for consumer creator tools: our fund backs software sold to businesses.\n\nWhat would change our view: a product line sold to agencies or brands.\n\nBest,\nDaniel' }, A);
  }
}
void passOne;
// Today's calendar and the brief for the Orchard AI meeting (asked for explicitly, so it is ready whatever the hour).
await op('companies.upsert', { name: 'Cascade Teachers Pension Plan', domain: 'cascadepension.example', kind: 'investor', hq_country: 'US' }, O);
for (const [email, name, title] of [
  ['priya@orchard-ai.com', 'Priya Natarajan', 'CEO'],
  ['leo@orchard-ai.com', 'Leo Grant', 'CTO'],
  ['h.morales@cascadepension.example', 'Helena Morales', 'Head of private markets'],
]) await op('people.upsert', { email, name, title, company: email.split('@')[1] }, O);
// The demo calendar comes from the scratch mock bridge (this seed refuses live ports), so demo mode
// is lifted for this one read and set again at once.
await op('settings.update', { mail: { demo: false } }, O);
await op('capture.sync', { what: 'calendar' }, O);
await op('settings.update', { mail: { demo: true } }, O);
const cal = await op('calendar.list', {}, O);
const orch = (cal?.events ?? []).find((e) => (e.title ?? '').startsWith('Orchard AI'));
// Your AI agent wrote the brief a partner asked for (in the demo it writes it as its own work: nothing fires).
if (orch && !(orch.brief && orch.brief.state === 'ready')) {
  const br = await op('briefs.request', { event: orch.id }, A);
  await op('briefs.save', { brief: br?.brief?.id ?? '', sections: J({ who: [{ name: 'Priya Natarajan', email: 'priya@orchard-ai.com', text: 'CEO. Ran demand planning at a national grocery chain for six years.' }, { name: 'Leo Grant', email: 'leo@orchard-ai.com', text: 'CTO. Built forecasting systems at a large delivery marketplace.' }], history: 'Inbound via an angel network; first meeting three weeks ago; diligence on data access is done.', deal: 'Series A, USD 12M at USD 60M post; our check USD 4M.', questions: ['How do forecast errors translate into waste saved per store?', 'What does the integration cost a new grocer?', 'Who else is in the round?'], news: [] }) }, A);
}

/* ------------------------------------------------------------- network */

step('network: touches with founders, portfolio CEOs and connectors');
// Founders of pipeline companies (Orchard AI's and the portfolio CEOs are on file already).
for (const [email, name, title] of [
  ['hannah@northstarledger.com', 'Hannah Cole', 'CEO'],
  ['omar@basaltenergy.com', 'Omar Haddad', 'CEO'],
  ['erik@bluefinlogistics.com', 'Erik Sorensen', 'CEO'],
  ['lucia@keystonegrid.com', 'Lucia Romero', 'CEO'],
  ['tom@rowanrobotics.com', 'Tom Becker', 'CEO'],
  ['grace@summitfreight.com', 'Grace Liu', 'CEO'],
  ['marcus@rivethealth.com', 'Marcus Bell', 'CEO'],
  ['dana@marlowpay.com', 'Dana Whitfield', 'CEO'],
  ['ines@copperline.io', 'Ines Moreau', 'CEO'],
]) await op('people.upsert', { email, name, title, company: email.split('@')[1] }, O);
// member, kind, people, days ago, subject, direction (emails): calls and meetings logged for each member.
const TOUCHES = [
  // Pipeline founders the deal teams know (warm, direct).
  [T.daniel, 'meeting', ['priya@orchard-ai.com', 'leo@orchard-ai.com'], 21, 'Orchard AI first meeting'],
  [T.daniel, 'call', ['priya@orchard-ai.com'], 6, 'Round size and lead'],
  [T.daniel, 'email', ['priya@orchard-ai.com'], 3, 'Updated round terms', 'in'],
  [DEMO.owner, 'meeting', ['hannah@northstarledger.com'], 34, 'Northstar Ledger first meeting'],
  [DEMO.owner, 'meeting', ['hannah@northstarledger.com'], 12, 'Partner meeting prep'],
  [DEMO.owner, 'email', ['hannah@northstarledger.com'], 2, 'IC timing', 'out'],
  [T.mei, 'meeting', ['omar@basaltenergy.com'], 16, 'Basalt Energy site visit'],
  [T.mei, 'email', ['omar@basaltenergy.com'], 4, 'Utility pilot data', 'in'],
  [DEMO.owner, 'call', ['erik@bluefinlogistics.com'], 5, 'Diligence call'],
  [DEMO.owner, 'email', ['erik@bluefinlogistics.com'], 9, 'Data room access', 'in'],
  [DEMO.owner, 'meeting', ['lucia@keystonegrid.com'], 28, 'Keystone Grid partner meeting'],
  [T.sam, 'call', ['marcus@rivethealth.com'], 14, 'Intro call'],
  [T.mei, 'call', ['dana@marlowpay.com'], 40, 'Reference check on the CFO'],
  [T.lena, 'email', ['grace@summitfreight.com'], 120, 'Following up', 'out'],
  // Portfolio CEOs (board work), and two of them who know founders in the pipeline (one-hop paths).
  [T.daniel, 'meeting', ['nadia@kestrelrobotics.com'], 40, 'Kestrel Robotics board meeting'],
  [T.daniel, 'meeting', ['nadia@kestrelrobotics.com'], 10, 'Kestrel Robotics board meeting'],
  [T.mei, 'call', ['nadia@kestrelrobotics.com'], 25, 'Hiring plan'],
  [T.ava, 'meeting', ['nadia@kestrelrobotics.com', 'tom@rowanrobotics.com'], 18, 'Robotics founders dinner'],
  [DEMO.owner, 'meeting', ['marco@brightlinepay.com'], 20, 'Brightline Payments board meeting'],
  [T.sam, 'meeting', ['marco@brightlinepay.com', 'ines@copperline.io'], 26, 'Fintech founders breakfast'],
  [T.mei, 'meeting', ['hana@lumoraenergy.com'], 8, 'Bridge round options'],
  [T.daniel, 'call', ['iris@halcyonlegal.ai'], 11, 'Series A extension'],
  [DEMO.owner, 'meeting', ['sam@cobaltledger.com'], 45, 'Cobalt Ledger board meeting'],
  [T.sam, 'email', ['erin@tidewaterhealth.com'], 30, 'Recap plan', 'in'],
  [T.ava, 'call', ['ravi@corvidlabs.ai'], 7, 'VP Engineering search'],
];
for (const [who, kind, people, ago, subject, direction] of TOUCHES) await op('interactions.log', Object.assign({ kind, people: J(people), member: who, at: dayAdd(TODAY, -ago), subject }, direction ? { direction } : {}), O);
// Strength rows are derived (the minute job); compute them now so Network shows them at once.
await op('network.recompute', {}, O);

/* --------------------------------------------------------------- markets */

step('market maps, one per thesis');
// thesis, segments, tiles [domain, segment, role, name, website]: portfolio, pipeline and passed come from deals
// and holdings; tracked and competitor are placed (a company not on file is added with its name and website).
const MAPS = [
  ['Industrial automation', ['Warehouse robots', 'Freight and fleets', 'Operations software'], [
    ['kestrelrobotics.com', 'Warehouse robots'],
    ['rowanrobotics.com', 'Warehouse robots'],
    ['larchrobotics.com', 'Warehouse robots'],
    ['quillrobotics.com', 'Warehouse robots'],
    ['ridgebackdrones.com', 'Warehouse robots'],
    ['ironhandrobotics.com', 'Warehouse robots', 'competitor', 'Ironhand Robotics', 'https://ironhandrobotics.com'],
    ['pinecrestlogistics.com', 'Freight and fleets'],
    ['aurorafleet.com', 'Freight and fleets'],
    ['summitfreight.com', 'Freight and fleets'],
    ['bluefinlogistics.com', 'Freight and fleets'],
    ['ternfreight.com', 'Freight and fleets'],
    ['cargolinesystems.com', 'Freight and fleets', 'competitor', 'Cargoline Systems', 'https://cargolinesystems.com'],
    ['ferroanalytics.com', 'Operations software'],
    ['emberanalytics.io', 'Operations software'],
    ['gantryvision.com', 'Operations software', 'tracked', 'Gantry Vision', 'https://gantryvision.com'],
  ]],
  ['Fintech infrastructure', ['Payments', 'Ledgers and close', 'Treasury'], [
    ['brightlinepay.com', 'Payments'],
    ['marlowpay.com', 'Payments'],
    ['sorrelpay.com', 'Payments'],
    ['pebblepay.co', 'Payments'],
    ['paywellrails.com', 'Payments', 'competitor', 'Paywell Rails', 'https://paywellrails.com'],
    ['cobaltledger.com', 'Ledgers and close'],
    ['northstarledger.com', 'Ledgers and close'],
    ['vantageledger.com', 'Ledgers and close'],
    ['tidalledger.com', 'Ledgers and close'],
    ['closebook.io', 'Ledgers and close', 'competitor', 'Closebook', 'https://closebook.io'],
    ['copperline.io', 'Treasury'],
    ['treasurly.com', 'Treasury', 'competitor', 'Treasurly', 'https://treasurly.com'],
    ['fundline.io', 'Treasury', 'tracked', 'Fundline', 'https://fundline.io'],
  ]],
  ['Climate software', ['Grid software', 'Storage', 'Materials'], [
    ['lumoraenergy.com', 'Grid software'],
    ['gridwell.energy', 'Grid software'],
    ['keystonegrid.com', 'Grid software'],
    ['pallasmicrogrid.com', 'Grid software'],
    ['voltlinesystems.com', 'Grid software', 'competitor', 'Voltline Systems', 'https://voltlinesystems.com'],
    ['fluxgrid.io', 'Grid software', 'tracked', 'Fluxgrid', 'https://fluxgrid.io'],
    ['basaltenergy.com', 'Storage'],
    ['cellstack.energy', 'Storage', 'competitor', 'Cellstack Energy', 'https://cellstack.energy'],
    ['ampwise.io', 'Storage', 'tracked', 'Ampwise', 'https://ampwise.io'],
    ['ironbarkmaterials.com', 'Materials'],
    ['heliotropebio.com', 'Materials'],
    ['kilnworks.co', 'Materials', 'tracked', 'Kilnworks Carbon', 'https://kilnworks.co'],
  ]],
];
const MAPID = {};
for (const [thesis, segments, tiles] of MAPS) {
  const m = await op('maps.save', { name: thesis, thesis, segments: J(segments) }, T.mei);
  if (m === null) continue;
  const mapId = (m.map ?? m).id;
  MAPID[thesis] = mapId;
  for (const [company, segment, role, name, website] of tiles) await op('maps.place', Object.assign({ map: mapId, company, segment }, role ? { role } : {}, name ? { name, website, source_url: website } : {}), T.mei);
}

/* ------------------------------------------------------------ deal rooms */

step('deal rooms: founders, decks, notes, checklists, memos');
// Founders and one-liners of every company in the pipeline.
const FOUNDERS = {
  'aurorafleet.com': ['Maya Brooks', 'maya@aurorafleet.com'],
  'briskclaims.com': ['Owen Price', 'owen@briskclaims.com'],
  'tesserabio.com': ['Lena Park', 'lena@tesserabio.com'],
  'lanternlearning.com': ['Andre Willis', 'andre@lanternlearning.com'],
  'hearthhome.co': ['Julia Romero', 'julia@hearthhome.co'],
  'driftwoodstudios.com': ['Kai Nakamura', 'kai@driftwoodstudios.com'],
  'copperline.io': ['Ines Moreau', 'ines@copperline.io'],
  'nimbuscompliance.com': ['Ravi Menon', 'ravi@nimbuscompliance.com'],
  'rivethealth.com': ['Marcus Bell', 'marcus@rivethealth.com'],
  'solacehealth.co': ['Hannah Ward', 'hannah@solacehealth.co'],
  'wavelengthaudio.com': ['Theo Grant', 'theo@wavelengthaudio.com'],
  'summitfreight.com': ['Grace Liu', 'grace@summitfreight.com'],
  'opalsecurity.dev': ['Sasha Ivanova', 'sasha@opalsecurity.dev'],
  'bluefinlogistics.com': ['Erik Sorensen', 'erik@bluefinlogistics.com'],
  'heliotropebio.com': ['Clara Vos', 'clara@heliotropebio.com'],
  'cirrusdata.dev': ['Noah Feld', 'noah@cirrusdata.dev'],
  'marlowpay.com': ['Dana Whitfield', 'dana@marlowpay.com'],
  'tandemhealth.io': ['Priscilla Grant', 'priscilla@tandemhealth.io'],
  'orchard-ai.com': ['Priya Natarajan', 'priya@orchard-ai.com'],
  'wildflowercommerce.com': ['Zoe Martin', 'zoe@wildflowercommerce.com'],
  'keystonegrid.com': ['Lucia Romero', 'lucia@keystonegrid.com'],
  'rowanrobotics.com': ['Tom Becker', 'tom@rowanrobotics.com'],
  'emberanalytics.io': ['Felix Hart', 'felix@emberanalytics.io'],
  'larchrobotics.com': ['Ivan Petrov', 'ivan@larchrobotics.com'],
  'corbel.ai': ['Mira Shah', 'mira@corbel.ai'],
  'ternfreight.com': ['Diego Alvarez', 'diego@ternfreight.com'],
  'halyardhealth.co': ['Nora Quinn', 'nora@halyardhealth.co'],
  'sorrelpay.com': ['Ben Adler', 'ben@sorrelpay.com'],
  'basaltenergy.com': ['Omar Haddad', 'omar@basaltenergy.com'],
  'northstarledger.com': ['Hannah Cole', 'hannah@northstarledger.com'],
  'mosaichealth.co': ['Ruth Alvarez', 'ruth@mosaichealth.co'],
  'graniteseven.com': ['Victor Lang', 'victor@graniteseven.com'],
  'fennelfoods.com': ['Amelia Reed', 'amelia@fennelfoods.com'],
  'wreninsurance.com': ['Jordan Ellis', 'jordan@wreninsurance.com'],
  'pylonhealth.com': ['Samira Patel', 'samira@pylonhealth.com'],
  'halcyonlegal.ai': ['Iris Chen', 'iris@halcyonlegal.ai'],
};
const LINES = Object.fromEntries(NAMES.map((x) => [x[1], x[3]]));
Object.assign(LINES, {
  'larchrobotics.com': 'Autonomous forklifts retrofitted onto existing fleets',
  'corbel.ai': 'Agents that reconcile purchase orders against invoices',
  'ternfreight.com': 'Drayage booking and tracking for port truckers',
  'halyardhealth.co': 'Remote monitoring for post-surgical patients',
  'sorrelpay.com': 'Payouts and split payments for vertical marketplaces',
  'basaltenergy.com': 'Bidding and dispatch software for long-duration storage',
  'northstarledger.com': 'Month-end close for multi-entity companies',
  'mosaichealth.co': 'Revenue cycle analytics for physician groups',
  'graniteseven.com': 'Runtime security for Kubernetes workloads',
  'fennelfoods.com': 'Ready-to-cook meal kits for grocery chains',
  'wreninsurance.com': 'Embedded renters insurance for property managers',
  'pylonhealth.com': 'Referral intake automation for specialty practices',
  'halcyonlegal.ai': 'AI contract review for in-house legal teams',
});
const RIVALS = { logistics: 'project44, FourKites and in-house spreadsheets', insurtech: 'Snapsheet, CCC and legacy core vendors', biotech: 'Arzeda, Cradle and contract research labs', edtech: 'Khanmigo, Chegg and campus tutoring centres', proptech: 'Frontdoor, Angi and local handymen', gaming: 'Supercell, Playtika and indie studios', fintech: 'Stripe, Modern Treasury and bank portals', regtech: 'Vanta, Drata and auditors', healthcare: 'Epic modules, Waystar and outsourced billing', consumer: 'Descript, Adobe and free tools', cybersecurity: 'Wiz, Sysdig and open-source scanners', 'data infrastructure': 'Fivetran, Airbyte and in-house pipelines', ai: 'Palantir, o9 and in-house analysts', ecommerce: 'Faire, Shopify B2B and trade shows', climate: 'Fluence, AutoGrid and utility in-house teams', robotics: 'Locus, Symbotic and manual labour', food: 'HelloFresh, store-brand kits and prepared foods', 'legal tech': 'Ironclad, Harvey and outside counsel' };
const SECTOR = Object.fromEntries([...NAMES.map((x) => [x[1], x[2]]), ...DIRECT.map((x) => [x[1], x[2]])]);
SECTOR['halcyonlegal.ai'] = 'legal tech';
const TERMS = {};
for (const [domain, , point, round_type, raise, post, check] of PIPE) TERMS[domain] = { point, round_type, raise, post, check };
for (const [, domain, , , point, round_type] of DIRECT) TERMS[domain] = { point, round_type, raise: round_type === 'series_a' ? 10000000 : 3500000, post: round_type === 'series_a' ? 55000000 : 18000000, check: round_type === 'series_a' ? 3000000 : 1000000 };
TERMS['halcyonlegal.ai'] = { point: 'daniel', round_type: 'series_a', raise: 6000000, post: 36000000, check: 2400000 };
const LATE = ['diligence', 'partner_meeting', 'ic', 'term_sheet', 'closed'];
const nameOf = (domain) => [...NAMES, ...DIRECT.map((x) => [x[0], x[1]])].find((x) => x[1] === domain)?.[0] ?? (domain === 'halcyonlegal.ai' ? 'Halcyon AI' : domain);
/** A deal's figures, derived from its round so every screen tells the same story. */
function roomOf(domain) {
  const t = TERMS[domain];
  const f = { pre_seed: 0.05, seed: 0.2, series_a: 0.32 }[t.round_type] ?? 0.2;
  const arr = Math.round((t.raise * f) / 10000) * 10000;
  const customers = Math.max(3, Math.round(arr / 45000));
  const team = Math.round(t.raise / 300000) + 5;
  const burn = Math.round(t.raise / 22 / 5000) * 5000;
  return { name: nameOf(domain), line: LINES[domain] ?? '', sector: SECTOR[domain] ?? 'software', ...t, arr, customers, team, burn, growth: t.round_type === 'series_a' ? 9 : 14, founder: FOUNDERS[domain] };
}
const dealInfo = {};
for (const [domain, number] of Object.entries(DEALS)) {
  if (!TERMS[domain]) continue;
  const g = await op('deals.get', { deal: number }, O);
  if (g === null) continue;
  dealInfo[domain] = { number, id: g.deal?.id ?? g.id, stage: g.deal?.stage ?? g.stage, status: g.deal?.status ?? g.status };
}
const daysBackFor = (stage) => ({ sourced: 2, screen: 6, first_meeting: 12, diligence: 20, partner_meeting: 26, ic: 33, term_sheet: 40, closed: 45 })[stage] ?? 10;
for (const [domain, info] of Object.entries(dealInfo)) {
  const r = roomOf(domain);
  const who = POINT[r.point];
  const late = LATE.includes(info.stage);
  // Founders on the deal (people records the network and the brief read).
  if (r.founder) await op('deals.people', { deal: info.number, add: J([{ person: { name: r.founder[0], email: r.founder[1] }, role: 'founder' }]) }, who);
  // The deck the founders sent, in the room.
  const deck = pdfOf(`${r.name}: ${r.round_type === 'series_a' ? 'Series A' : r.round_type === 'pre_seed' ? 'Pre-seed' : 'Seed'} deck`, [
    { title: r.name, lines: [r.line, '', `${r.round_type === 'series_a' ? 'Series A' : r.round_type === 'pre_seed' ? 'Pre-seed' : 'Seed'} round, ${TODAY.slice(0, 7)}`, r.founder ? `${r.founder[0]}, CEO  |  ${r.founder[1]}` : ''] },
    { title: 'Traction', lines: [`ARR: ${money(r.arr)}`, `Paying customers: ${r.customers}`, `Revenue growth: ${r.growth}% month over month`, `Net burn: ${money(r.burn)} a month`] },
    { title: 'Team', lines: [`Team of ${r.team}, ${Math.ceil(r.team / 2)} in engineering`, 'Founders full time; four-year vesting with a one-year cliff'] },
    { title: 'Market', lines: [`Competitors: ${RIVALS[r.sector] ?? 'incumbents and spreadsheets'}`] },
    { title: 'The round', lines: [`Raising ${money(r.raise)} at ${money(r.post)} post-money`, `Use of funds: 55% product, 30% go to market, 15% operations`, `Runway after the round: ${Math.round(r.raise / r.burn)} months`] },
  ]);
  await upload('files.upload', { deal: info.number, folder: 'Deck', origin: 'email' }, [[`${fileName(r.name)}_deck.pdf`, deck]], who);
  if (late) await upload('files.upload', { deal: info.number, folder: 'Financials' }, [[`${fileName(r.name)}_financial_model.pdf`, pdfOf(`${r.name}: financial model summary`, [{ title: 'Plan', lines: [`ARR today ${money(r.arr)}; plan ${money(r.arr * 3)} in 24 months`, `Net burn ${money(r.burn)} a month`, `Gross margin ${r.sector === 'robotics' ? 48 : 72}%`] }])]], who);
  // A meeting note: a first call early, a partner meeting later.
  const day = dayAdd(TODAY, -daysBackFor(info.stage));
  const firstCall = { team: `${r.founder?.[0] ?? 'The CEO'} (CEO) with a technical cofounder; ${r.team} people.`, product: r.line + '.', market: `Competes with ${RIVALS[r.sector] ?? 'incumbents'}.`, traction: `ARR ${money(r.arr)}, ${r.customers} paying customers, ${r.growth}% a month.`, round: `Raising ${money(r.raise)} at ${money(r.post)} post; our check would be ${money(r.check)}.`, next_steps: late ? 'Reference calls and a data room.' : 'Send the deck to the partners; second call with the CTO.' };
  await op('notes.create', { deal: info.number, template: 'first_call', title: 'First call with ' + (r.founder?.[0] ?? r.name), meeting_day: dayAdd(day, -10), consent: 'informed', sections: J(firstCall), save: true }, who);
  if (late) {
    await op('notes.create', { deal: info.number, template: 'partner_meeting', title: 'Partner meeting', meeting_day: day, consent: 'informed', sections: J({ summary: `${r.name}: ${r.line.toLowerCase()}. The partners liked the pace of the team.`, strengths: `Growth of ${r.growth}% a month with ${r.customers} customers; founders who sold to this buyer before.`, concerns: `Burn of ${money(r.burn)} a month; competition from ${(RIVALS[r.sector] ?? 'incumbents').split(',')[0]}.`, questions: 'How fast does a new customer go live? What does churn look like after year one?', next_steps: 'Two customer references and the cohort data.' }), save: true }, who);
    const ref = r.founder ? `Former colleague of ${r.founder[0]}` : 'A customer';
    await op('notes.create', { deal: info.number, template: 'reference', title: 'Reference call', meeting_day: dayAdd(day, 3), consent: 'informed', sections: J({ who: ref, relationship: 'Worked together for four years', strengths: 'Ships fast, recruits well, honest about problems.', concerns: 'Can over-commit on the roadmap.', again: 'Yes, without hesitation.' }), save: true }, who);
  }
  // The checklist for the round, with the answers the team confirmed.
  await op('dd.template-apply', { deal: info.number }, who);
  const dd = await op('dd.get', { deal: info.number }, who);
  const qs = Object.fromEntries((dd?.questions ?? []).map((q) => [q.key, q]));
  const ans = [
    ['traction_arr', String(r.arr), 'USD'], ['traction_customers', String(r.customers)], ['traction_growth', String(r.growth), '%'], ['fin_raise', String(r.raise), 'USD'], ['fin_burn', String(r.burn), 'USD'],
    ['team_size', String(r.team)], ['market_competitors', RIVALS[r.sector] ?? 'Incumbents and spreadsheets'], ['team_fulltime', 'yes'], ['product_live', 'yes'], ['product_edge', r.line],
    ['team_technical', 'yes'], ['team_vesting', 'yes'], ['team_leadership', 'CEO, CTO, VP Sales and a finance lead in place'], ['market_why_now', 'Buyers replaced manual work after the labour squeeze of the last three years'],
    ['fin_runway', String(Math.round(r.raise / r.burn))], ['legal_jurisdiction', 'Delaware C corporation'], ['legal_ip_assigned', 'yes'], ['cust_segment', r.line.split(' for ')[1] ?? 'Mid-market operators'],
  ].slice(0, late ? 18 : 10);
  const answers = ans.filter(([k]) => qs[k] !== undefined && qs[k].answer === null).map(([k, value, unit]) => Object.assign({ question: qs[k].id, value, grade: 'founder_reported', note: 'From the deck and the founder call' }, unit ? { unit } : {}));
  if (answers.length > 0) await op('dd.answer', { answers: J(answers) }, who);
  // The memo: a draft summary early, the full case once partners met.
  const g = await op('memos.get', { deal: info.number }, who);
  if (!g?.memo) {
    const m = await op('memos.open', { deal: info.number }, who);
    const id = m ? (m.memo ?? m).id : null;
    if (id) {
      const SECTIONS = [
        ['summary', `${r.name}: ${r.line.toLowerCase()}. ${money(r.arr)} ARR with ${r.customers} customers, raising ${money(r.raise)} at ${money(r.post)} post.`],
        ['company', `${r.name} sells ${r.line.toLowerCase()}; founded three years ago, ${r.team} people.`],
        ['team', `${r.founder?.[0] ?? 'The CEO'} leads a team of ${r.team}; the CTO built the core product at a prior company.`],
        ['market', `Buyers today use ${(RIVALS[r.sector] ?? 'incumbents and spreadsheets').toLowerCase()}; the segment grows about 20% a year.`],
        ['traction', `ARR ${money(r.arr)}, growing ${r.growth}% a month; ${r.customers} paying customers.`],
        ['product', `${r.line}. Live with every customer; a new customer goes live in under a month.`],
        ['business_model', 'Annual subscriptions priced per site, with usage above the plan billed monthly.'],
        ['competition', `${RIVALS[r.sector] ?? 'Incumbents'}; ${r.name} wins on time to value.`],
        ['round_terms', `${money(r.raise)} at ${money(r.post)} post; our check ${money(r.check)} for ${((r.check / r.post) * 100).toFixed(1)}%.`],
        ['risks', `Competition from ${(RIVALS[r.sector] ?? 'incumbents').split(',')[0]}; burn of ${money(r.burn)} a month.`],
      ];
      for (const [section, text] of SECTIONS.slice(0, late || info.status !== 'open' ? 10 : 6)) await op('memos.block-save', { memo: id, section, text }, who);
    }
  }
}
// Diligence answers your AI agent found in public sources, waiting for a person (Keystone Grid and Orchard AI).
for (const domain of ['keystonegrid.com', 'orchard-ai.com', 'marlowpay.com']) {
  const info = dealInfo[domain];
  if (!info) continue;
  const dd = await op('dd.get', { deal: info.number }, A);
  const open = (dd?.questions ?? []).filter((q) => q.answer === null && q.type === 'text').slice(0, 2);
  const answers = open.map((q) => ({ question: q.id, value: q.key.startsWith('tech') ? 'Python services on AWS; models trained on customer data under contract' : q.key.startsWith('legal') ? 'Delaware C corporation; standard NVCA documents' : 'Mid-market operators in North America', grade: 'public', sources: [`https://${domain}/about`] }));
  if (answers.length > 0) await op('dd.answer', { answers: J(answers) }, A);
}

/* ----------------------------------------------- SPV, program and fund raise */

step('SPV, program and fund raise pipelines');
// SPVs: co-investment vehicles for LPs into portfolio rounds, one in every stage.
const SPVS = [
  ['kestrelrobotics.com', 'Kestrel Robotics Series B SPV', 'closed', 6000000, 'Closed; 14 LPs in, carry 10% and no fee.'],
  ['corvidlabs.ai', 'Corvid Labs Series A SPV', 'funding', 4000000, 'Wires due Friday; 9 of 12 subscribers funded.'],
  ['cobaltledger.com', 'Cobalt Ledger Series B SPV', 'documents', 5000000, 'Subscription documents out for signature.'],
  ['halcyonlegal.ai', 'Halcyon AI extension SPV', 'allocation', 2500000, 'Allocation confirmed by the company; offering to LPs with co-invest rights.'],
  ['brightlinepay.com', 'Brightline Payments secondary SPV', 'sourced', 3000000, 'Early employees selling; price to agree.'],
  ['northstarledger.com', 'Northstar Ledger co-invest SPV', 'sourced', 2000000, 'Only if IC approves the Series A today.'],
];
for (const [company, name, stage, check, note] of SPVS) {
  const d = await op('deals.create', { company, pipeline: 'spv', name, stage, source: 'portfolio', point: DEMO.owner, check: String(check), currency: 'USD' }, O);
  const n = d?.deal?.number ?? d?.number;
  if (!n) continue;
  await upload('files.upload', { deal: n, folder: 'Documents' }, [[fileName(name) + '_terms.pdf', pdfOf(name + ': summary of terms', [{ title: name, lines: [`Target size ${money(check)}`, 'Carry 10%, no management fee', 'Minimum USD 100K per LP', 'Open to Fund I and Fund II LPs with co-invest rights'] }])]], O);
  await op('notes.create', { deal: n, template: 'free', title: 'Status', meeting_day: dayAdd(TODAY, -3), sections: J({ notes: note }), save: true }, O);
  await op('dd.template-apply', { deal: n, template: 'series_a' }, O);
  const dd = await op('dd.get', { deal: n }, O);
  const qs = Object.fromEntries((dd?.questions ?? []).map((q) => [q.key, q]));
  const a = [['fin_raise', String(check), 'USD'], ['legal_jurisdiction', 'Delaware series LLC'], ['team_fulltime', 'yes']].filter(([k]) => qs[k] && qs[k].answer === null).map(([k, value, unit]) => Object.assign({ question: qs[k].id, value, grade: 'founder_reported', note: 'Summary of terms' }, unit ? { unit } : {}));
  if (a.length > 0) await op('dd.answer', { answers: J(a) }, O);
  const m = await op('memos.open', { deal: n }, O);
  if (m) await op('memos.block-save', { memo: (m.memo ?? m).id, section: 'summary', text: `${name}: ${money(check)} for LPs alongside our position. ${note}` }, O);
}
// The Larkspur Fellows program: pre-seed founders applying, two in every stage.
const FELLOWS = [
  ['Cedar Robotics', 'cedarrobotics.com', 'applied', 'Robot arms for small bakeries', 'Lucy Hale'],
  ['Fernway Health', 'fernwayhealth.com', 'applied', 'Discharge planning for rural hospitals', 'Omar Siddiqui'],
  ['Gale Payments', 'galepay.com', 'screen', 'Payroll cards for gig workers', 'Tara Singh'],
  ['Hopper Grid', 'hoppergrid.com', 'screen', 'Rooftop solar for warehouses, financed', 'Jon Ellis'],
  ['Inlet Data', 'inletdata.io', 'interview', 'Data contracts for analytics teams', 'Amy Zhou'],
  ['Kettle Logistics', 'kettlelogistics.com', 'interview', 'Returns routing for apparel brands', 'Sam Rivera'],
  ['Lumen Ledger', 'lumenledger.com', 'selected', 'Audit trails for AI spend', 'Nadia Karim'],
  ['Moss Climate', 'mossclimate.com', 'selected', 'Methane leak detection with cheap sensors', 'Peter Lund'],
  ['Nimble Care', 'nimblecare.co', 'enrolled', 'Scheduling for home care agencies', 'Elena Cruz'],
  ['Oriel Security', 'orielsecurity.dev', 'enrolled', 'Secrets scanning in CI pipelines', 'Tariq Aziz'],
];
for (const [name, domain, stage, line, founder] of FELLOWS) {
  await op('companies.upsert', { name, domain, kind: 'startup', hq_country: 'US' }, T.sam);
  const email = founder.split(' ')[0].toLowerCase() + '@' + domain;
  const d = await op('deals.create', { company: domain, pipeline: 'program', name, stage, source: 'inbound', point: T.sam, round_type: 'pre_seed', people: J([{ person: { name: founder, email }, role: 'founder' }]) }, T.sam);
  const n = d?.deal?.number ?? d?.number;
  if (!n) continue;
  await upload('files.upload', { deal: n, folder: 'Application' }, [[fileName(name) + '_application.pdf', pdfOf(name + ': Larkspur Fellows application', [{ title: name, lines: [line, `Founder: ${founder}`, 'Stage: pre-seed, building the first version', 'Why now: buyers are asking for it'] }])]], T.sam);
  await op('notes.create', { deal: n, template: 'first_call', title: 'Program call with ' + founder, meeting_day: dayAdd(TODAY, -4), consent: 'informed', sections: J({ team: founder + ', solo founder for now, hiring a CTO.', product: line + '.', market: 'Early; buyers use spreadsheets today.', traction: 'Five design partners.', round: 'Program cheque USD 150K on a SAFE.', next_steps: stage === 'enrolled' ? 'Week one of the program.' : 'Interview with two partners.' }), save: true }, T.sam);
  await op('dd.template-apply', { deal: n, template: 'seed' }, T.sam);
  const dd = await op('dd.get', { deal: n }, T.sam);
  const qs = Object.fromEntries((dd?.questions ?? []).map((q) => [q.key, q]));
  const a = [['team_fulltime', 'yes'], ['team_size', '2'], ['product_stage', 'First version with design partners'], ['fin_raise', '150000', 'USD']].filter(([k]) => qs[k] && qs[k].answer === null).map(([k, value, unit]) => Object.assign({ question: qs[k].id, value, grade: 'founder_reported', note: 'Application' }, unit ? { unit } : {}));
  if (a.length > 0) await op('dd.answer', { answers: J(a) }, T.sam);
  const m = await op('memos.open', { deal: n }, T.sam);
  if (m) await op('memos.block-save', { memo: (m.memo ?? m).id, section: 'summary', text: `${name}: ${line.toLowerCase()}. Program cheque USD 150K.` }, T.sam);
}
// The fund raise: Fund I's closed raise, and Fund II raising from its USD 120M first close to a USD 150M final close.
await op('entities.save', { entity: FUND2, target: '150000000' }, O);
// Every LP that signed sits in Closed with its subscription documents (Fund I's raise is finished: those are
// marked invested, so each LP keeps one open prospect, its Fund II one).
const subDoc = (lp, fund, amount) => pdfOf(`${lp}: subscription agreement`, [{ title: 'Subscription agreement', lines: [`Investor: ${lp}`, `Fund: ${fund.replace('Larkspur', 'Larkspur Ventures')}, L.P.`, `Commitment: ${money(amount)}`, 'Accepted by the General Partner at the first close'] }]);
for (const [fund, idx, close] of [[FUND1, 5, fund1FirstClose], [FUND2, 6, fund2FirstClose]])
  for (const l of LPS) {
    const d = await op('raise.add', { fund, company: l[0], target: String(l[idx]), stage: 'closed' }, T.priya);
    const n = d?.deal?.number;
    if (!n) continue;
    await upload('files.upload', { deal: n, folder: 'Subscription' }, [[fileName(l[0]) + '_subscription.pdf', subDoc(l[0], fund, l[idx])]], O);
    await op('notes.create', { deal: n, template: 'free', title: 'Signed', meeting_day: close, sections: J({ notes: `${l[3]} signed for ${money(l[idx])} at the ${fund === FUND1 ? 'Fund I' : 'Fund II'} first close. ${l[7] ? 'Fee paying.' : 'GP commitment, no fee.'}` }), save: true }, O);
    if (fund === FUND1) await op('deals.status', { deal: n, status: 'invested', reason: 'Signed at the first close' }, O);
  }
const PROSPECTS = [
  ['Pacific Crest Foundation', 'target', 10000000, 'foundation', 'Laura Chen'],
  ['Ashford University Endowment', 'target', 15000000, 'endowment', 'Mark Ashby'],
  ['Granite Peak Insurance', 'contacted', 8000000, 'insurer', 'Diane Ruiz'],
  ['Yuki Capital', 'contacted', 5000000, 'family_office', 'Haruto Yuki'],
  ['Harbor State Retirement System', 'meeting', 12000000, 'pension', 'Robert Hale'],
  ['Tremont Fund of Funds', 'diligence', 10000000, 'fund_of_funds', 'Alice Tremont'],
  ['Lindqvist Family Office', 'diligence', 4000000, 'family_office', 'Erik Lindqvist'],
  ['Calloway Family Office', 'soft_circle', 5000000, 'family_office', 'James Calloway'],
  ['Meadowbrook Health Foundation', 'soft_circle', 3000000, 'foundation', 'Sara Brook'],
  ['Ridgeline Pension Trust', 'committed', 7000000, 'pension', 'Paul Ridge'],
];
for (const [name, stage, target, kind, contact] of PROSPECTS) {
  const d = await op('raise.add', { fund: FUND2, company: name, target: String(target), stage }, T.priya);
  const n = d?.deal?.number;
  if (!n) continue;
  if (stage === 'soft_circle' || stage === 'committed') await op('raise.soft', { deal: n, amount: String(stage === 'committed' ? target : Math.round(target * 0.8)), kind }, T.priya);
  await op('notes.create', { deal: n, template: 'free', title: 'Call with ' + contact, meeting_day: dayAdd(TODAY, -(PROSPECTS.findIndex((p) => p[0] === name) + 2)), sections: J({ notes: `${contact} (${kind.replace(/_/g, ' ')}): target ${money(target)} for Fund II. ${stage === 'diligence' ? 'Their team is reading the DDQ and track record.' : stage === 'committed' ? 'Committee approved; subscription documents with counsel.' : stage === 'soft_circle' ? 'Soft circle given; waiting for their committee.' : 'Interested in the climate and industrial theses.'}` }), save: true }, O);
  if (['target', 'contacted'].includes(stage)) await upload('files.upload', { deal: n, folder: 'Fund II' }, [['larkspur_fund_ii_overview.pdf', pdfOf('Larkspur Ventures Fund II: overview', [{ title: 'Fund II', lines: ['Seed and Series A in B2B software, robotics and climate', 'Target USD 150M; first close USD 120M', 'Final close planned next quarter'] }])]], O);
  if (['meeting', 'diligence', 'soft_circle', 'committed'].includes(stage)) await upload('files.upload', { deal: n, folder: 'Fund II' }, [['larkspur_fund_ii_ddq.pdf', pdfOf('Larkspur Ventures Fund II: due diligence questionnaire', [{ title: 'Fund II', lines: ['Target USD 150M; first close USD 120M', 'Fund I: net TVPI 1.6x, DPI 0.2x', 'Team: two GPs, a principal, an analyst, a CFO, a head of platform'] }])]], O);
}

/* -------------------------------------------------- LPs, intros and grids */

step('LP relationships, intros, grids');
// LP contacts as people, with the meetings and calls the team had with them.
for (const l of LPS) if (l[4] !== DEMO.owner) await op('people.upsert', { email: l[4], name: l[3], title: 'Investor relations', company: l[4].split('@')[1] }, O);
const LP_TOUCHES = [
  [DEMO.owner, 'meeting', 'rkim@northgate-endowment.example', 18, 'Northgate annual meeting'],
  [T.priya, 'call', 'h.morales@cascadepension.example', 9, 'Fund II capital call pacing'],
  [T.priya, 'email', 'oliver@meridianfof.example', 4, 'Q3 statements', 'out'],
  [DEMO.owner, 'meeting', 'ingrid@halvorsen.example', 32, 'Oslo visit'],
  [T.daniel, 'call', 'cdiaz@asterinsurance.example', 14, 'Co-invest in the Kestrel SPV'],
  [T.priya, 'email', 'niamh@kinsalecp.example', 2, 'Overdue capital call', 'out'],
  [DEMO.owner, 'call', 'k.sato@soraholdings.example', 25, 'Fund II re-up'],
  [T.mei, 'meeting', 'james@whitcombe.example', 40, 'Climate thesis review'],
];
for (const [who, kind, email, ago, subject, direction] of LP_TOUCHES) await op('interactions.log', Object.assign({ kind, people: J([email]), member: who, at: dayAdd(TODAY, -ago), subject }, direction ? { direction } : {}), O);
// More touches with founders across the pipeline, so warm paths exist beyond the partners' own deals.
for (const [domain, info] of Object.entries(dealInfo)) {
  const f = FOUNDERS[domain];
  const r = TERMS[domain];
  if (!f || !r || info.status !== 'open') continue;
  await op('interactions.log', { kind: LATE.includes(info.stage) ? 'meeting' : 'call', people: J([f[1]]), member: POINT[r.point], at: dayAdd(TODAY, -daysBackFor(info.stage)), subject: nameOf(domain) + (LATE.includes(info.stage) ? ': partner meeting' : ': first call') }, O);
}
await op('network.recompute', {}, O);
// Intros: one made (Kestrel's ask), one sent and waiting, one drafted for the owner to approve.
const INTROS = [
  ['lucia@keystonegrid.com', 'Kestrel asked for heads of grid operations', 'made'],
  ['erik@bluefinlogistics.com', 'Rowan Robotics wants a cold chain design partner', 'sent'],
  ['grace@summitfreight.com', 'Pinecrest Logistics asked for an intro to Summit Freight', 'drafted'],
];
for (const [target, note, end] of INTROS) {
  const np = await op('network.paths', { person: target }, O);
  const path = (np?.paths ?? [])[0];
  if (!path) continue;
  const ir = await op('intros.request', { target, via: path.member, connector: path.connector?.id ?? '', note }, O);
  const intro = ir ? (ir.intro ?? ir) : null;
  if (!intro?.id) continue;
  {
    await op('intros.draft', { intro: intro.id, subject: 'Intro: ' + (intro.target?.name ?? 'a founder we know'), body: `Hi,\n\n${note}. Would you be open to a short call?\n\nBlurb to forward: Larkspur Ventures backs B2B software and robotics companies; the founders are great to work with.\n\nThanks,\nOlivia` }, A);
  }
  if (end === 'drafted') continue;
  const g = await op('intros.get', { intro: intro.id }, O);
  const ob = g?.intro?.outbound?.id ?? g?.intro?.draft?.id ?? g?.intro?.outbound;
  if (typeof ob === 'string' && ob !== '') await op('outbound.approve', { outbound: ob }, O);
  if (end === 'made') await op('intros.outcome', { intro: intro.id, outcome: 'made' }, O);
}
// A comparison grid per thesis, from the pipeline deals on its map (cells are their confirmed answers).
for (const [thesis, , tiles] of MAPS) {
  const deals = tiles.map((t) => dealInfo[t[0]]).filter((d) => d && d.status === 'open').map((d) => d.number).slice(0, 6);
  if (deals.length < 2 || !MAPID[thesis]) continue;
  await op('compare.save', { name: thesis + ': pipeline', deals: J(deals), columns: J(['traction_arr', 'traction_customers', 'traction_growth', 'fin_raise', 'fin_burn', 'team_size', 'market_competitors']), origin: 'markets', market_ref: MAPID[thesis], fill: false }, T.mei);
}

/* ------------------------------------------------- the firm's daily work */

step("tasks, comments, proposals, mail, your AI agent's queue");
const TASKS = [
  [DEMO.owner, 'Call Hana about the Lumora bridge', 1, 'deals'],
  [DEMO.owner, 'Review the Q3 LP letter draft', 2],
  [DEMO.owner, 'Sign the Pylon Health subscription documents', 0],
  [T.daniel, 'Send Orchard AI the term sheet draft', 3],
  [T.mei, 'Basalt Energy site visit follow-ups', 4],
  [T.sam, 'Book reference calls for Wren Insurance', 2],
  [T.lena, 'Refresh the industrial automation map', 6],
  [T.priya, 'Chase Kinsale and Elm Street on the late call', 1],
  [T.ava, 'Shortlist VP Sales candidates for Kestrel', 5],
];
for (const [assignee, title, due] of TASKS) await op('tasks.save', { title, assignee, due_day: dayAdd(TODAY, due) }, O);
for (const [assignee, title, ago] of [[DEMO.owner, 'Approve the Q2 marks', 40], [DEMO.owner, 'Welcome call with Halcyon AI\'s new GC candidate', 12], [T.priya, 'File the Fund I K-1s', 60]]) {
  const t = await op('tasks.save', { title, assignee, due_day: dayAdd(TODAY, -ago) }, O);
  const id = t ? (t.task ?? t).id : null;
  if (id) await op('tasks.complete', { task: id }, assignee === DEMO.owner ? O : assignee);
}
// Comments with mentions (the owner's notifications).
const COMMENTS = [
  ['northstarledger.com', T.daniel, '@Olivia retention cohort looks even better in the data room: 131% for the 2024 cohort.'],
  ['basaltenergy.com', T.mei, '@Olivia the utility pilot data is in the Files tab; worth a look before your vote.'],
  ['keystonegrid.com', T.sam, '@Olivia Lucia can do Thursday for the partner follow-up.'],
  ['bluefinlogistics.com', DEMO.owner, 'Strong diligence so far. @Daniel can you take the reference with their largest exporter?'],
];
for (const [domain, who, body] of COMMENTS) {
  const d = dealInfo[domain];
  if (!d) continue;
  const mentions = body.includes('@Olivia') ? [DEMO.owner] : [T.daniel];
  await op('comments.add', { ref_collection: 'deals', ref_id: d.id, body, mentions: J(mentions) }, who === DEMO.owner ? O : who);
}
// Proposals from your AI agent: company and person fields from what it read.
await op('proposals.create', { title: 'Corvid Labs: sector and headcount', why: 'Their October update describes them as AI infrastructure and lists 24 people.', evidence: 'We are now 24 people building the forecasting platform.', confidence: 0.82, items: J([{ op: 'companies.update', params: { company: 'corvidlabs.ai', sector: 'ai infrastructure' } }]) }, A);
await op('proposals.create', { title: 'Grace Liu: new title', why: 'Summit Freight announced Grace Liu as CEO and cofounder.', evidence: J({ quote: 'Grace Liu, CEO and cofounder', url: 'https://summitfreight.com/about' }), confidence: 0.9, items: J([{ op: 'people.update', params: { person: 'grace@summitfreight.com', title: 'CEO and cofounder' } }]) }, A);
await op('proposals.create', { title: 'Add Gridline Analytics to Grid software', why: 'Gridline Analytics raised a seed round for grid planning software.', evidence: J({ quote: 'Gridline Analytics raises a seed round to build grid planning software', url: 'https://gridline-analytics.com/news' }), confidence: 0.75, items: J([{ op: 'maps.propose', params: { map: MAPID['Climate software'], company: 'Gridline Analytics', name: 'Gridline Analytics', website: 'https://gridline-analytics.com', segment: 'Grid software', role: 'tracked', source_url: 'https://gridline-analytics.com/news', why: 'Raised a seed round for grid planning software' } }]) }, A);
// Mail: reminders to the late LPs (sent), an LP's question answered by your AI agent (draft) and one waiting.
for (const lineId of late) await op('payments.remind', { line: lineId }, T.priya);
const lq = await op('lpq.log', { lp: 'Cascade Teachers Pension Plan', question: 'What is the expected pace of Fund II calls next year?', fund: FUND2 }, T.priya);
await op('lpq.log', { lp: 'Meridian Fund of Funds', question: 'Can you share the Fund I net IRR by vintage quarter?', fund: FUND1 }, T.priya);
if (lq?.question?.id) await op('outbound.draft', { kind: 'reply', module: 'funds', to: J(['h.morales@cascadepension.example']), subject: 'Fund II call pacing', body: 'Hi Helena,\n\nWe expect four Fund II calls next year of about 6% of commitments each, quarterly, mostly for follow-ons in Halcyon AI and Cobalt Ledger and two to three new investments. Fees are called with each.\n\nBest,\nPriya', ref_collection: 'lp_questions', ref_id: lq.question.id }, A);
// Your AI agent's review of every saved note (a person asked for each): its summary headline.
for (const d of (await op('deals.list', { limit: 300 }, O))?.deals ?? []) {
  for (const n of (await op('notes.list', { deal: d.number ?? d.id, status: 'saved', limit: 50 }, O))?.notes ?? []) {
    if (n.review?.state !== 'saved') continue;
    const g = await op('notes.get', { note: n.id }, A);
    const body = g?.note?.body ?? {};
    const first = Object.values(body).find((v) => typeof v === 'string' && v !== '') ?? '';
    if (first !== '') await op('notes.summary-save', { note: n.id, headline: String(first).split('. ')[0].slice(0, 140) }, A);
  }
}
// The rounds of every portfolio company (the Stage column and the Holdings tab), Kestrel's Series B and Halcyon's extension.
const RT = { kestrel: ['seed', 'series_a'], tidewater: ['seed', 'bridge'], brightline: ['seed', 'series_a'], fernhill: ['seed', 'seed_extension'], lumora: ['seed', 'bridge'], halcyon: ['series_a'], cobalt: ['series_a'] };
const RL = { seed: 'Seed', series_a: 'Series A', series_b: 'Series B', bridge: 'Bridge', seed_extension: 'Seed extension' };
for (const c of PORT_COS)
  for (const [i, [k, amount, , val]] of c[8].entries()) {
    const type = (RT[c[0]] ?? ['seed', 'series_a'])[i] ?? 'other';
    await op('rounds.save', { company: c[2], day: dayAdd(callDay(c[7], k), 14), type, label: RL[type], post_money: String(val), raise: String(Math.round((amount * 4) / 250000) * 250000), currency: 'USD', convert: false, note: 'Imported with the holdings' }, O);
  }
await op('rounds.save', { company: 'kestrelrobotics.com', day: MONTHS[11], type: 'series_b', label: 'Series B', post_money: '160000000', raise: '25000000', currency: 'USD', convert: false, note: 'Led by Harbor Growth Partners; Fund I sold 8% of its shares in the secondary' }, O);
await op('rounds.save', { company: 'halcyonlegal.ai', day: dayAdd(TODAY, -10), type: 'series_a', label: 'Series A extension', post_money: '36000000', raise: '6000000', currency: 'USD', convert: false, note: 'Fund II took its full pro rata (IC-001)' }, O);
// Everyone the firm has on file has been in touch at least once: an email in from those nobody met yet.
const FELLOW_DOMAINS = FELLOWS.map((f) => f[1]);
const quiet = (await op('network.people', { band: 'none', limit: 500 }, O))?.people ?? [];
for (const [i, p] of quiet.entries()) {
  const dom = (p.email ?? '').split('@')[1] ?? '';
  const pc = PORT_COS.find((c) => c[2] === dom);
  const who = FELLOW_DOMAINS.includes(dom) ? T.sam : pc ? (pc[7] === 1 ? T.daniel : T.mei) : LPS.some((l) => l[4] === p.email) ? T.priya : DEMO.owner;
  if (!p.email) continue;
  await op('interactions.log', { kind: pc ? 'meeting' : 'email', people: J([p.email]), member: who, at: dayAdd(TODAY, -(4 + ((i * 7) % 45))), subject: pc ? 'Board prep' : 'Intro email', ...(pc ? {} : { direction: 'in' }) }, O);
}
await op('network.recompute', {}, O);
// Questions the owner asked your AI agent today, answered (the agent panel's Answers).
const CHAT = [
  ['Which portfolio companies are short of runway?', 'Lumora Energy is the only one under six months, at its October burn; its board meets tomorrow on the bridge. Pinecrest Logistics and Tidewater Health are under a year. Sources: their October updates, verified.'],
  ['What is left before we can wire Pylon Health?', 'The documents are signed and the IC condition (three customer calls) is met. The wire goes out with the next Fund II call; the subscription documents need your signature (a task due today).'],
  ['Summarise the Fund II raise.', 'USD 120M signed at the first close against a USD 150M target; Calloway Family Office and Meadowbrook Health Foundation have soft-circled USD 6.4M and Ridgeline Pension Trust committed USD 7M, waiting for documents.'],
];
for (const [q, answer] of CHAT) {
  const a = await op('chat.ask', { text: q }, O);
  if (a?.ask?.id) await op('chat.answer', { ask: a.ask.id, answer }, A);
}

/* ------------------------------------------------------------------ news */

step('news about the portfolio, the late-stage pipeline and the thesis sectors');
// A demo firm's companies are fictional, so the app never searches their names (only the thesis sectors): their
// news is written here, by fictional trade publications on .example hosts, over the last 14 days.
// [about kind, company domain or sector key, days back, publication, headline, your AI agent's one sentence or '']
const NEWS = [
  ['company', 'kestrelrobotics.com', 1, 'Robotics Business Report', 'Kestrel Robotics opens a second assembly line in Ohio to meet warehouse demand', 'Kestrel is adding capacity after its Series B, which supports the order growth in its October update.'],
  ['company', 'kestrelrobotics.com', 9, 'Midwest Manufacturing Journal', 'Kestrel Robotics named to a regional list of manufacturing innovators', ''],
  ['company', 'tidewaterhealth.com', 6, 'Health IT Weekly', 'Tidewater Health adds two rural hospital systems to its care platform', 'Two new hospital customers after the write-down; worth checking against the next update.'],
  ['company', 'brightlinepay.com', 2, 'Payments Brief', 'Brightline Payments launches same-day settlement for independent pharmacies', 'A new product for its largest customer segment; settlement volume should show in the next KPIs.'],
  ['company', 'fernhillbio.com', 11, 'BioProcess Notes', 'Fernhill Bio presents enzyme stability data at an industry conference', ''],
  ['company', 'quarrydata.io', 4, 'Data Engineering Digest', 'Quarry Data releases an open-source connector for warehouse metadata', ''],
  ['company', 'lumoraenergy.com', 3, 'Grid Edge Report', 'Lumora Energy signs a pilot with a Texas municipal utility', 'A new utility pilot while Lumora is short of runway; relevant to the bridge discussion at its board meeting.'],
  ['company', 'pinecrestlogistics.com', 8, 'Freight Ledger', 'Pinecrest Logistics expands its carrier network to the Pacific Northwest', ''],
  ['company', 'arclightsec.com', 5, 'Security Systems Review', 'Arclight Security reaches FedRAMP Ready status', 'Opens the US federal market to Arclight; a step toward the public sector pipeline it described.'],
  ['company', 'northbeam.dev', 12, 'UK Tech Journal', 'Northbeam Analytics opens a Manchester office and plans 20 hires', ''],
  ['company', 'corvidlabs.ai', 2, 'AI Builders Weekly', 'Corvid Labs releases an evaluation toolkit for enterprise AI agents', 'A free toolkit that feeds its paid product; relevant to the VP Engineering search in its asks.'],
  ['company', 'saltmarshfoods.com', 10, 'Food Business Wire', 'Saltmarsh Foods brings its seafood marketplace to 40 restaurant groups in Boston', ''],
  ['company', 'halcyonlegal.ai', 7, 'Legal Tech Report', 'Halcyon AI adds contract review in German and French', 'Halcyon enters European languages ahead of its Series A extension now in our pipeline.'],
  ['company', 'gridwell.energy', 4, 'Energy Transition Daily', 'Gridwell joins a German grid operator flexibility program', ''],
  ['company', 'junipercare.com', 13, 'Health IT Weekly', 'Juniper Care publishes an outcomes study from 12 home care agencies', ''],
  ['company', 'cobaltledger.com', 1, 'Fintech Wire', 'Cobalt Ledger integrates with three mid-market ERP platforms', 'Three ERP integrations widen Cobalt\'s channel to mid-market finance teams.'],
  ['company', 'bluefinlogistics.com', 6, 'Freight Ledger', 'Bluefin Logistics tracks its first transpacific cold chain shipments end to end', 'In diligence with us: the shipments confirm the export customers named in its deck.'],
  ['company', 'heliotropebio.com', 9, 'Food Business Wire', 'Heliotrope Bio receives a food safety approval for its blue pigment', ''],
  ['company', 'cirrusdata.dev', 3, 'Data Engineering Digest', 'Cirrus Data launches a usage-based pricing calculator', ''],
  ['company', 'marlowpay.com', 5, 'Payments Brief', 'Marlow Payments partners with a veterinary practice software vendor', 'In diligence with us: a new distribution partner for its embedded payments.'],
  ['company', 'tandemhealth.io', 11, 'Health IT Weekly', 'Tandem Health expands to home health agencies in Florida', ''],
  ['company', 'orchard-ai.com', 2, 'Retail Tech Notes', 'Orchard AI pilots demand forecasting with a regional grocery chain', 'At partner meeting with us: a third grocery pilot, matching the pipeline in its deck.'],
  ['company', 'wildflowercommerce.com', 8, 'Commerce Weekly', 'Wildflower Commerce reports 300 independent brands on its wholesale platform', ''],
  ['company', 'keystonegrid.com', 4, 'Grid Edge Report', 'Keystone Grid shortens interconnection studies in a utility pilot', ''],
  ['company', 'rowanrobotics.com', 3, 'Robotics Business Report', 'Rowan Robotics deploys depalletizing cells at two food distributors', 'At IC with us: two live deployments support the revenue plan in its memo.'],
  ['company', 'emberanalytics.io', 7, 'Data Engineering Digest', 'Ember Analytics adds warehouse-native product analytics', ''],
  ['sector', 'robotics', 5, 'Robotics Business Report', 'Warehouse robot orders rise for a third straight quarter, trade group says', ''],
  ['sector', 'logistics', 10, 'Freight Ledger', 'Mid-size shippers adopt freight audit software as rates settle', ''],
  ['sector', 'fintech', 6, 'Fintech Wire', 'Seed and Series A funding for embedded payments holds steady this quarter', ''],
  ['sector', 'payments', 12, 'Payments Brief', 'Instant payment adoption grows among US community banks', ''],
  ['sector', 'climate', 2, 'Grid Edge Report', 'Utilities open more interconnection queues to software-led studies', ''],
  ['sector', 'energy', 9, 'Energy Transition Daily', 'US battery storage installations reach a quarterly record', ''],
  ['sector', 'industrial', 13, 'Midwest Manufacturing Journal', 'Manufacturers plan larger automation budgets for next year, survey finds', ''],
];
const slugOf = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const NEWS_IDS = [];
for (const [kind, about, back, source, title, summary] of NEWS) {
  const day = dayAdd(TODAY, -back);
  const url = `https://${slugOf(source).replace(/-/g, '')}.example/${day.slice(0, 7).replace('-', '/')}/${slugOf(title).slice(0, 80)}`;
  const at = new Date(nyAt(day, `${pad(7 + (back % 9))}:${pad((back * 13) % 60)}`)).toISOString();
  const r = await op('news.add', { title, url, source, published_at: at, about_kind: kind, about }, O);
  if (r?.item && summary !== '') NEWS_IDS.push({ id: r.item.id, summary });
}
// Your AI agent's daily digest: the items that matter, one sentence each.
if (NEWS_IDS.length > 0) await op('news.summarize', { items: J(NEWS_IDS) }, A);

/* ------------------------------ fix 4 (markets): news dashboard, your AI agent's take, market briefs */

step("news dashboard: funding rounds, market and sector news, your AI agent's take, market briefs");
// Fictional rounds in fictional companies, and clearly generic market, policy and sector headlines, from fictional
// trade publications on .example hosts: a demo firm never searches its fictional names, and the app's own pulls
// add the real macro, funding and sector news with pictures. Rounds go back 6 months (the funding charts); sector
// news over 8 weeks (the sparklines). Then your AI agent's take (two news_insights jobs) and two market briefs.
const F4 = {};
const f4Slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const f4At = (back, i) => new Date(nyAt(dayAdd(TODAY, -back), `${pad(6 + ((back + i) % 11))}:${pad((back * 17 + i * 7) % 60)}`)).toISOString();
async function f4Add(key, back, source, title, fields) {
  const day = dayAdd(TODAY, -back);
  const url = `https://${f4Slug(source).replace(/-/g, '')}.example/${day.slice(0, 7).replace('-', '/')}/${f4Slug(title).slice(0, 80)}`;
  const r = await op('news.add', Object.assign({ title, url, source, published_at: f4At(back, title.length) }, fields), O);
  if (r?.item) F4[key] = r.item.id;
  return r;
}
const USD = (n) => (n >= 1e6 ? `USD ${Number.isInteger(n / 1e6) ? n / 1e6 : (n / 1e6).toFixed(1)}M` : `USD ${Math.round(n / 1e3)}K`);
// sector, publication, the last word of its fictional company names, what each builds
const F4_ROUNDS = [
  ['robotics', 'Robotics Business Report', ['Robotics', 'Automation', 'Arms'], ['autonomous forklifts for cold storage', 'picking arms for apparel warehouses', 'robot fleet software', 'palletizing cells for food plants', 'mobile robots for hospital supply rooms']],
  ['logistics', 'Freight Ledger', ['Freight', 'Logistics', 'Haul'], ['freight audit software for mid-size shippers', 'yard management for distribution centers', 'carrier onboarding', 'cross-border freight paperwork']],
  ['industrial', 'Midwest Manufacturing Journal', ['Industrial', 'Works', 'Analytics'], ['predictive maintenance for CNC fleets', 'quality inspection with cameras', 'scheduling for job shops', 'energy monitoring for factories']],
  ['fintech', 'Fintech Wire', ['Ledger', 'Finance', 'Credit'], ['reconciliation APIs for marketplaces', 'embedded lending for vertical software', 'spend management for clinics', 'revenue-based financing for agencies']],
  ['payments', 'Payments Brief', ['Pay', 'Payments', 'Rails'], ['instant payouts for vertical SaaS', 'payment acceptance for independent pharmacies', 'B2B card issuing', 'real-time payment routing for credit unions']],
  ['climate', 'Grid Edge Report', ['Grid', 'Climate', 'Dispatch'], ['virtual power plant software', 'interconnection studies for solar developers', 'demand response for campuses', 'carbon accounting for utilities']],
  ['energy', 'Energy Transition Daily', ['Storage', 'Power', 'Energy'], ['battery dispatch for community grids', 'second-life battery packs', 'storage asset monitoring', 'long-duration storage controls']],
];
const F4_FIRST = ['Brightarm', 'Pickwell', 'Tessel', 'Gearline', 'Motive', 'Hollis', 'Strata', 'Quayside', 'Linden', 'Orrin', 'Bramwell', 'Copperleaf', 'Larchmont', 'Wexford', 'Tamsin', 'Ivel', 'Calder', 'Penrose', 'Fenwick', 'Ashby'];
const F4_STAGES = [['Seed', 4500000], ['Series A', 14000000], ['Seed', 6000000], ['Pre-seed', 2000000], ['Series A', 18000000], ['Seed', 3500000], ['Seed', 7500000], ['Series A', 11000000], ['Pre-seed', 1500000], ['Seed', 5000000]];
// Rounds per week over the last 8 weeks (oldest first), rising lately, and older rounds (days back), per sector:
// the 8-week sparklines and the 6-month chart show shape.
const F4_WEEKS = [[1, 0, 1, 1, 2, 1, 2, 3], [0, 1, 1, 0, 1, 1, 2, 2], [1, 0, 1, 0, 1, 1, 1, 2], [0, 1, 1, 1, 1, 2, 2, 3], [0, 1, 0, 1, 1, 1, 2, 2], [1, 1, 1, 2, 1, 2, 3, 3], [0, 1, 0, 1, 1, 1, 1, 2]];
const F4_OLDER = [[61, 88, 117, 140, 166], [75, 98, 130, 158], [69, 93, 121, 150], [64, 85, 112, 137, 171], [58, 80, 109, 146], [72, 101, 126, 160], [66, 90, 119, 155]];
for (let s = 0; s < F4_ROUNDS.length; s++) {
  const [sector, pub, last, whats] = F4_ROUNDS[s];
  const backs = [...F4_WEEKS[s].flatMap((n, w) => Array.from({ length: n }, (_, j) => 7 * (7 - w) + 1 + j * 2)).reverse(), ...F4_OLDER[s]];
  for (let i = 0; i < backs.length; i++) {
    const name = `${F4_FIRST[(i * 7 + s * 3) % F4_FIRST.length]} ${last[i % last.length]}`;
    const [stage, base] = F4_STAGES[(i + s) % F4_STAGES.length];
    const amount = base + ((s * 7 + i * 3) % 5) * 500000;
    const what = whats[(i + s) % whats.length];
    const title = `${name} raises ${USD(amount)} ${stage.toLowerCase()} round for ${what}`;
    await f4Add(`round_${sector}_${i}`, backs[i], pub, title, { about_kind: 'sector', about: sector, category: 'funding', topic: `${sector.charAt(0).toUpperCase() + sector.slice(1)} funding`, round_company: name, round_amount_usd: amount, round_stage: stage });
  }
}
// sector, publication, [days back, headline] (technology and industry trends, no company named)
const F4_SECTOR = [
  ['robotics', 'Robotics Business Report', [[3, 'Warehouse operators shift from pilots to fleet rollouts of mobile robots'], [10, 'Robot-as-a-service contracts lengthen as buyers seek predictable costs'], [17, 'Vision-guided picking reaches new accuracy marks in independent tests'], [31, 'Labor shortages keep warehouse automation budgets growing, survey finds'], [45, 'Safety standards for collaborative robots get a long-awaited update']]],
  ['logistics', 'Freight Ledger', [[4, 'Freight rates stabilize as shippers renegotiate annual contracts'], [15, 'Mid-size shippers adopt freight audit software as invoices grow more complex'], [29, 'Cross-border trucking volumes rise for a third month']]],
  ['industrial', 'Midwest Manufacturing Journal', [[6, 'Job shops add scheduling software to manage longer order backlogs'], [20, 'Factory energy costs push interest in monitoring software'], [37, 'Contract manufacturers expand camera-based quality inspection']]],
  ['fintech', 'Fintech Wire', [[2, 'Vertical software platforms add lending as a second revenue line'], [9, 'Banks tighten oversight of fintech partnerships after regulator reviews'], [16, 'Embedded finance revenue grows faster at smaller software platforms'], [34, 'Reconciliation tools gain ground as marketplaces scale payouts']]],
  ['payments', 'Payments Brief', [[5, 'Instant payout adoption climbs among vertical software platforms'], [13, 'Card acceptance costs remain the top complaint of small merchants'], [27, 'Real-time payment networks add more credit unions']]],
  ['climate', 'Grid Edge Report', [[1, 'Utilities expand demand response programs ahead of winter peaks'], [8, 'Virtual power plants enroll more home batteries this quarter'], [18, 'Interconnection backlogs push developers toward software-led studies'], [36, 'Corporate buyers sign more clean power contracts with storage attached']]],
  ['energy', 'Energy Transition Daily', [[3, 'Battery pack prices fall again, lifting storage project returns'], [12, 'Community storage projects gain support in state energy plans'], [24, 'Second-life battery packs find buyers in commercial storage'], [48, 'Long-duration storage pilots move to commercial contracts']]],
];
for (const [sector, pub, rows] of F4_SECTOR) for (const [back, title] of rows) await f4Add(`sector_${sector}_${back}`, back, pub, title, { about_kind: 'sector', about: sector });
// Policy and regulation in each thesis sector (generic, no agency or company named)
const F4_POLICY = [
  ['robotics', 3, 'Workplace Safety Digest', 'Draft safety guidance for mobile robots in warehouses opens for comment'],
  ['logistics', 11, 'Freight Ledger', 'Regulators propose electronic freight documents for interstate shipments'],
  ['industrial', 19, 'Midwest Manufacturing Journal', 'New state incentives for factory automation take effect next year'],
  ['fintech', 4, 'Fintech Wire', 'Bank regulators propose rules for third-party payment partnerships'],
  ['payments', 14, 'Payments Brief', 'Proposed open banking data rules set new deadlines for providers'],
  ['climate', 2, 'Grid Edge Report', 'Grid operators adopt faster interconnection rules for storage projects'],
  ['energy', 9, 'Energy Transition Daily', 'Updated tax credit guidance clarifies rules for standalone storage'],
];
for (const [sector, back, pub, title] of F4_POLICY) await f4Add(`policy_${sector}`, back, pub, title, { about_kind: 'sector', about: sector, category: 'policy', topic: `${sector.charAt(0).toUpperCase() + sector.slice(1)} policy` });
// The market: VC funding, the IPO window, rates, valuations, public tech stocks; exits; new funds and LP moves
const F4_MARKET = [
  ['vc_1', 2, 'macro', 'VC funding', 'Venture Pulse', 'Seed-stage deal counts rise for a second quarter while late-stage rounds stay scarce'],
  ['vc_2', 12, 'macro', 'VC funding', 'Venture Pulse', 'Venture funding to US startups dips this month as large rounds slow'],
  ['ipo_1', 4, 'macro', 'IPO market', 'Capital Markets Daily', 'Tech IPO window shows signs of reopening as two listings price above range'],
  ['ipo_2', 20, 'macro', 'IPO market', 'Capital Markets Daily', 'Several growth-stage companies push IPO plans to next year'],
  ['rates_1', 5, 'macro', 'Interest rates', 'Rates and Markets Weekly', 'Central bank holds rates steady and signals patience on cuts'],
  ['rates_2', 16, 'macro', 'Interest rates', 'Rates and Markets Weekly', 'Bond yields ease after a softer inflation reading'],
  ['val_1', 7, 'macro', 'Startup valuations', 'Venture Pulse', 'Median Series A valuations hold steady as investors stay selective'],
  ['val_2', 25, 'macro', 'Startup valuations', 'Venture Pulse', 'Down rounds fall to a two-year low among Series B companies'],
  ['pub_1', 3, 'macro', 'Public tech stocks', 'Capital Markets Daily', 'Software stocks rebound as quarterly earnings beat expectations'],
  ['pub_2', 14, 'macro', 'Public tech stocks', 'Capital Markets Daily', 'Public SaaS multiples recover toward their five-year average'],
  ['exit_ipo', 6, 'exits', 'Venture-backed IPOs', 'Capital Markets Daily', 'A logistics software company files confidentially for a US listing'],
  ['exit_ma_1', 9, 'exits', 'Startup acquisitions', 'Deal Flow Weekly', 'Industrial software consolidation continues with three acquisitions this month'],
  ['exit_ma_2', 18, 'exits', 'Startup acquisitions', 'Deal Flow Weekly', 'Large payment processors look to buy payments infrastructure startups'],
  ['exit_sec', 11, 'exits', 'Secondaries', 'Deal Flow Weekly', 'Secondary sales of startup shares reach a record share of venture liquidity'],
  ['fund_1', 8, 'funding', 'New venture funds', 'Venture Pulse', 'Two emerging managers close debut seed funds focused on industrial software'],
  ['fund_2', 23, 'funding', 'New venture funds', 'Venture Pulse', 'A new climate infrastructure fund reaches its first close'],
  ['lp_1', 13, 'funding', 'LP moves', 'Institutional Investor Notes', 'Pension funds plan steady venture allocations for next year, survey finds'],
  ['lp_2', 30, 'funding', 'LP moves', 'Institutional Investor Notes', 'Endowments slow new commitments to venture funds as distributions lag'],
];
for (const [key, back, category, topic, pub, title] of F4_MARKET) await f4Add(key, back, pub, title, { about_kind: 'market', about: topic, category, topic });
// Competitors of the portfolio (the competitor tiles on the market maps; fictional companies)
const F4_COMP = [
  ['comp_ironhand', 'ironhandrobotics.com', 4, 'Robotics Business Report', 'Ironhand Robotics cuts the price of its picking arm by 15% for mid-size warehouses'],
  ['comp_cargoline', 'cargolinesystems.com', 15, 'Freight Ledger', 'Cargoline Systems opens a freight hub in Canada'],
  ['comp_paywell', 'paywellrails.com', 6, 'Payments Brief', 'Paywell Rails launches instant payouts for vertical software platforms'],
  ['comp_closebook', 'closebook.io', 10, 'Fintech Wire', 'Closebook adds automated month-end close for marketplaces'],
  ['comp_treasurly', 'treasurly.com', 12, 'Fintech Wire', 'Treasurly adds multi-currency accounts for online marketplaces'],
  ['comp_voltline', 'voltlinesystems.com', 3, 'Grid Edge Report', 'Voltline Systems wins a statewide utility contract for grid analytics'],
  ['comp_cellstack', 'cellstack.energy', 8, 'Energy Transition Daily', 'Cellstack Energy recalls a battery module after a field fault'],
];
for (const [key, domain, back, pub, title] of F4_COMP) await f4Add(key, back, pub, title, { about_kind: 'company', about: domain });
// Earlier items the take cites (the news section above)
const f4First = async (domain) => (await op('news.list', { scope: 'company', ref: domain, limit: 1 }, O))?.items?.[0]?.id;
for (const d of ['kestrelrobotics.com', 'brightlinepay.com', 'lumoraenergy.com', 'keystonegrid.com', 'cobaltledger.com', 'marlowpay.com']) F4['co_' + d] = await f4First(d);
// Your AI agent's take: two news_insights jobs (6 and 4 insights), each citing the items it rests on
const F4_TAKE = [
  [
    ['A price cut at Ironhand puts pressure on Kestrel in mid-size warehouses', "Ironhand Robotics cut the price of its picking arm by 15% for mid-size warehouses, the segment where Kestrel Robotics wins most deals. Kestrel's second assembly line shows demand is strong, but a cheaper rival can slow deals and squeeze margins after its Series B.", 'negative', [['company', 'kestrelrobotics.com'], ['thesis', 'Industrial automation'], ['sector', 'robotics']], ['comp_ironhand', 'co_kestrelrobotics.com'], "Ask Kestrel's CEO how the price cut shows in its pipeline before its next round."],
    ['Seed rounds in warehouse robotics keep a steady pace', 'Eleven robotics companies raised rounds from pre-seed to Series A in the last eight weeks, five of them in the last two weeks, most for picking arms and robot fleet software. Buyers moving from pilots to fleet rollouts support the demand side of the Industrial automation thesis.', 'positive', [['sector', 'robotics'], ['thesis', 'Industrial automation']], ['round_robotics_0', 'round_robotics_1', 'round_robotics_2', 'sector_robotics_3'], 'Review the new robotics candidates on the Industrial automation map this week.'],
    ['The IPO window is opening again for software companies', 'Two tech listings priced above range and software stocks rebounded on earnings, while a logistics software company filed confidentially for a listing. A reopening window improves exit timing for the later-stage holdings of Fund I.', 'positive', [['fund', 'Larkspur Fund I']], ['ipo_1', 'pub_1', 'exit_ipo'], "Update the exit timing assumptions in Fund I's reserve plan."],
    ['Endowments are slowing new venture commitments while Fund II raises', 'Endowments are slowing new commitments as distributions lag, while pension funds plan steady allocations. Fund II is still raising toward its final close, so the LP mix it targets matters.', 'negative', [['fund', 'Larkspur Fund II']], ['lp_2', 'lp_1'], 'Put pension LPs first in the Fund II close pipeline this month.'],
    ['Instant payouts are becoming table stakes in vertical software payments', 'Paywell Rails launched instant payouts for vertical software platforms, and adoption is climbing across the segment. Brightline Payments and Marlow Payments, in diligence with us, both sell into vertical software, so the feature is likely to come up with their buyers.', 'watch', [['company', 'brightlinepay.com'], ['company', 'marlowpay.com'], ['thesis', 'Fintech infrastructure']], ['comp_paywell', 'sector_payments_5', 'co_brightlinepay.com'], 'Ask Marlow in diligence how it competes with instant payouts.'],
    ['Faster interconnection rules help grid software companies', 'Grid operators adopted faster interconnection rules for storage projects as backlogs push developers toward software-led studies. Lumora Energy and Keystone Grid both sell into this process, which may shorten their sales cycles.', 'positive', [['company', 'lumoraenergy.com'], ['sector', 'climate'], ['thesis', 'Climate software']], ['policy_climate', 'sector_climate_18', 'co_lumoraenergy.com'], "Share the rule change with Lumora's CEO before its board meeting."],
  ],
  [
    ['Proposed partnership rules may slow bank-backed fintech launches', 'Bank regulators proposed rules for third-party payment partnerships, and banks are already tightening oversight. Cobalt Ledger and Brightline Payments both rely on bank partners, so launches that need a new bank could take longer.', 'watch', [['company', 'cobaltledger.com'], ['company', 'brightlinepay.com'], ['sector', 'fintech']], ['policy_fintech', 'sector_fintech_9'], 'Ask Cobalt Ledger and Brightline how the proposed rules affect their bank partners.'],
    ['A battery recall at Cellstack puts module suppliers in focus', 'Cellstack Energy, a competitor on the Climate software map, recalled a battery module after a field fault while pack prices keep falling. Storage buyers are likely to ask harder questions about suppliers and warranties.', 'watch', [['sector', 'energy'], ['thesis', 'Climate software']], ['comp_cellstack', 'sector_energy_3'], 'Ask the storage companies in the pipeline which module suppliers they use.'],
    ['Secondary sales are now a real source of venture liquidity', 'Secondary sales reached a record share of venture liquidity while down rounds fell among Series B companies. With distributions lagging across the market, a partial secondary is a realistic way to return cash to Fund I LPs.', 'watch', [['fund', 'Larkspur Fund I']], ['exit_sec', 'val_2', 'lp_2'], "Ask the partners whether a partial secondary fits Fund I's distribution plan."],
    ['Rates on hold keep valuations steady for now', 'The central bank held rates and signalled patience on cuts, and median Series A valuations held steady. Pricing for the Fund II pipeline is unlikely to move much this quarter.', 'watch', [['fund', 'Larkspur Fund II'], ['thesis', 'Fintech infrastructure']], ['rates_1', 'val_1', 'vc_1'], 'Keep the current valuation ranges in the next term sheets.'],
  ],
];
// Your AI agent's take on the news (in a real firm a person asks, or the daily switch does).
for (const batch of F4_TAKE) {
  for (const [title, analysis, impact, affects, cites, next_step] of batch) {
    const ids = cites.map((k) => F4[k]).filter((x) => x);
    if (ids.length === 0) continue;
    await op('news.insight-save', { title, analysis, impact, affects: J(affects.map(([kind, ref]) => ({ kind, ref }))), news_ids: J(ids), next_step }, A);
  }
}
// Two market briefs: a partner asks, your AI agent writes them with numbered sources
const F4_BRIEFS = [
  [T.mei, 'Embedded payments for vertical software', 'fintech', 'Embedded payments are becoming the main revenue line of vertical software, and the winners pair payouts, lending and reconciliation behind one integration.', [
    ['overview', 'Vertical software platforms (for clinics, pharmacies, trades and marketplaces) increasingly earn more from payments than from subscriptions [1]. Buyers want payouts, lending and reconciliation in the product they already use [2].'],
    ['size', '- A trade group estimates embedded payment volume through US vertical software at about USD 180 billion this year, growing about 20% a year [3].\n- Revenue from embedded finance grows fastest at smaller platforms [2].'],
    ['trends', '- Instant payouts are becoming expected by merchants [4].\n- Lending is the second revenue line most platforms add [1].\n- Banks are tightening oversight of fintech partnerships [5].'],
    ['players', '- Infrastructure APIs that platforms build on (Cobalt Ledger in our portfolio, Paywell Rails and Closebook as competitors) [4].\n- Card issuing and routing specialists [6].'],
    ['funding', 'Nineteen fintech and payments rounds in the last eight weeks, from pre-seed to Series A, for reconciliation, embedded lending and payouts [6].'],
    ['risks', '- Proposed partnership rules could slow launches that need a new bank [5].\n- Card acceptance costs keep pressure on margins [7].'],
    ['implications', 'Fintech infrastructure: favour companies that own reconciliation and payouts together. Ask Brightline Payments and Cobalt Ledger about bank partner exposure; in diligence, ask Marlow Payments how it answers instant payouts [4][5].'],
  ], [
    ['Vertical software platforms add lending as a second revenue line', 'fintechwire', 'Fintech Wire'],
    ['Embedded finance revenue grows faster at smaller software platforms', 'fintechwire', 'Fintech Wire'],
    ['Embedded payments market outlook', 'paymentsresearch', 'Payments Research Group'],
    ['Instant payout adoption climbs among vertical software platforms', 'paymentsbrief', 'Payments Brief'],
    ['Banks tighten oversight of fintech partnerships after regulator reviews', 'fintechwire', 'Fintech Wire'],
    ['Seed rounds in payments infrastructure', 'paymentsbrief', 'Payments Brief'],
    ['Card acceptance costs remain the top complaint of small merchants', 'paymentsbrief', 'Payments Brief'],
  ]],
  [O, 'Warehouse robotics for mid-size operators', 'robotics', 'Mid-size warehouses are moving from robot pilots to fleets, financed as a service; price competition is rising as more arms reach the market.', [
    ['overview', 'Mid-size warehouses (10,000 to 100,000 square meters) are moving from pilots to fleet rollouts of mobile robots and picking arms [1], driven by labor shortages [2].'],
    ['size', '- An industry association estimates mid-size warehouse automation spending at about USD 9 billion a year in North America, growing about 15% a year [3].\n- Robot-as-a-service is a growing share of new contracts [4].'],
    ['trends', '- Fleet rollouts replace pilots [1].\n- Robot-as-a-service contracts lengthen [4].\n- Vision-guided picking accuracy keeps improving [5].'],
    ['players', '- Picking arms: Kestrel Robotics (our portfolio) and Ironhand Robotics (competitor) [6].\n- Fleet software and palletizing specialists [7].'],
    ['funding', 'Eleven robotics rounds from pre-seed to Series A in the last eight weeks, mostly for picking arms and fleet software [7].'],
    ['risks', '- Price cuts by competitors compress margins [6].\n- Updated safety standards may add certification costs [8].'],
    ['implications', 'Industrial automation: back companies with software-led fleets and service pricing. For Kestrel Robotics, track the effect of the Ironhand price cut on win rates before its next round [6].'],
  ], [
    ['Warehouse operators shift from pilots to fleet rollouts of mobile robots', 'roboticsbusinessreport', 'Robotics Business Report'],
    ['Labor shortages keep warehouse automation budgets growing, survey finds', 'roboticsbusinessreport', 'Robotics Business Report'],
    ['Warehouse automation spending outlook', 'automationassociation', 'Automation Industry Association'],
    ['Robot-as-a-service contracts lengthen as buyers seek predictable costs', 'roboticsbusinessreport', 'Robotics Business Report'],
    ['Vision-guided picking reaches new accuracy marks in independent tests', 'roboticsbusinessreport', 'Robotics Business Report'],
    ['Ironhand Robotics cuts the price of its picking arm by 15% for mid-size warehouses', 'roboticsbusinessreport', 'Robotics Business Report'],
    ['Seed rounds in warehouse robotics', 'roboticsbusinessreport', 'Robotics Business Report'],
    ['Safety standards for collaborative robots get a long-awaited update', 'roboticsbusinessreport', 'Robotics Business Report'],
  ]],
];
for (const [who, topic, sector, summary, sections, cites] of F4_BRIEFS) {
  const asked = await op('research.ask', { topic, sector }, who);
  if (!asked) continue;
  const citations = cites.map(([title, host, source], i) => ({ n: i + 1, title, url: `https://${host}.example/${f4Slug(title).slice(0, 80)}`, source }));
  await op('research.save', { report: asked.report.id, summary, sections: J(sections.map(([key, body]) => ({ key, body }))), citations: J(citations) }, A);
}

/* --------------------------------------------------------------- the end */

// Let the app's sender record every approved message as sent (a demo firm sends nothing out; the sender
// paces at 20 a minute, so the notices and LP packs take a few minutes), at most fifteen minutes.
for (let i = 0; i < 90; i++) {
  const ob = await api.call('outbound.list', { status: 'approved', limit: 200 }, { as: O });
  const left = ob.body?.total ?? (ob.body?.messages ?? []).length;
  if (left === 0) break;
  if (i % 6 === 0) console.log(`- waiting for the sender: ${left} approved messages to record as sent (${Math.round((Date.now() - T0) / 1000)} s)`);
  await new Promise((r) => setTimeout(r, 10000));
}
// The demo firm ends with every switch off and no pending agent work: the mock bridge saw no fire.
const sEnd = await op('settings.get', {}, O);
const switchesOn = Object.entries(sEnd?.agent_policy ?? {}).filter(([, v]) => v === true).map(([k]) => k);
if (switchesOn.length > 0) {
  fails++;
  console.log('  FAILED: switches left on: ' + switchesOn.join(', '));
}
const firesLeft = (await bridgeFires()).length - firesAtStart;
if (firesLeft !== 0) {
  fails++;
  console.log('  FAILED: the demo firm fired ' + firesLeft + ' trigger(s)');
}
void SWITCHES;
const sum = await op('home.summary', {}, O);
const nc = await op('next.count', {}, O);
console.log(`\nLarkspur Ventures seeded in ${Math.round((Date.now() - t0) / 1000)} s: ${calls} operations, ${fails} failed.`);
if (sum) console.log(`Home: Next ${sum.next.total}, inbound ${sum.inbound?.total ?? 0} in 12 weeks, fund ${sum.fund?.label ?? '-'} TVPI ${sum.fund?.tvpi_e8 ? (sum.fund.tvpi_e8 / 1e8).toFixed(2) + 'x' : '-'}, runways ${sum.runways?.rows.map((r) => r.company.name + ' ' + r.months).join(', ') ?? '-'}; home.summary ${sum.ms} ms`);
if (nc) console.log('Next by kind: ' + JSON.stringify(nc.by_kind));
console.log(`Your AI agent: ${firesLeft} trigger${firesLeft === 1 ? '' : 's'} fired, no pending agent work; every switch off.`);
const cov = await op('network.coverage', { scope: 'pipeline' }, O);
const maps = await op('maps.list', {}, O);
if (cov) console.log(`Network: pipeline coverage ${JSON.stringify(cov.bands)}`);
if (maps) console.log(`Markets: ${(maps.maps ?? []).map((m) => `${m.name} ${JSON.stringify(m.counts ?? m.relations ?? {})}`).join('; ')}`);
console.log(`Sign in at http://127.0.0.1:${PORT}/ as ${DEMO.owner} / ${DEMO.password} (PIN ${DEMO.pin}).`);
process.exit(fails > 0 ? 1 : 0);
