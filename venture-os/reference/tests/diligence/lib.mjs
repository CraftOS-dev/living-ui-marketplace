// Shared harness for the diligence tests.
// Env: VO_APP (scratch app dir, default ../app), VO_PORT (default 3187), VO_BRIDGE (mock bridge, default port + 100).
import { execFileSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const APP = process.env.VO_APP ?? join(HERE, '..', 'app');
export const PORT = Number(process.env.VO_PORT ?? 3187);
export const BRIDGE = Number(process.env.VO_BRIDGE ?? PORT + 100);
const { client, DEMO } = await import('file:///' + join(APP, 'tools', 'dev', 'api.mjs').replace(/\\/g, '/'));
export { DEMO };

/** The mock bridge's recorded trigger fires. */
export const bridge = {
  async fires() {
    return (await fetch(`http://127.0.0.1:${BRIDGE}/__mock/fires`)).json();
  },
};

export const PARTNER = 'paula@venture.test';
export const PARTNER2 = 'piers@venture.test';
export const ANALYST = 'ana@venture.test';
export const VP = 'victor@venture.test';
export const FINANCE = 'fiona@venture.test';

export function newApi() {
  return client({ port: PORT, app: APP });
}

/** Stop the scratch server, wipe its database, start it again with the mock bridge. */
export function fresh() {
  execFileSync('bash', [join(APP, 'tools', 'dev', 'stop.sh'), String(PORT)], { stdio: 'pipe' });
  execFileSync('bash', [join(APP, 'tools', 'dev', 'reset.sh'), APP], { stdio: 'pipe' });
  execFileSync('bash', [join(APP, 'tools', 'dev', 'serve.sh'), APP, String(PORT), String(BRIDGE)], { stdio: 'pipe' });
}

/** First-run setup as the demo owner (USD, New York, Fund I of USD 50M). */
export async function setupFirm(api, extra = {}) {
  return api.op('setup.complete', Object.assign({ firm_name: 'Northwind Ventures', base_currency: 'USD', zone: 'America/New_York', fund_name: 'Fund I', fund_size: '50000000', fund_vintage: 2025, owner_name: 'Olivia Owner', email: DEMO.owner, password: DEMO.password, pin: DEMO.pin }, extra));
}

/** Invite a member with a role and sign them in. */
export async function member(api, email, role, name) {
  const inv = await api.op('members.invite', { email, name: name || email.split('@')[0], role }, { as: 'owner', pin: true });
  const joined = await api.op('auth.accept-invite', { email, code: inv.code, password: DEMO.password });
  api.setToken(email, joined.token);
  return email;
}

/** The firm with a partner, a second partner, an analyst, a venture partner and finance. */
export async function team(api) {
  await setupFirm(api);
  await member(api, PARTNER, 'partner', 'Paula Partner');
  await member(api, PARTNER2, 'partner', 'Piers Partner');
  await member(api, ANALYST, 'analyst', 'Ana Analyst');
  await member(api, VP, 'venture_partner', 'Victor Venture');
  await member(api, FINANCE, 'finance', 'Fiona Finance');
}

let passed = 0;
let failed = 0;
const failures = [];
let current = '';

export function section(name) {
  current = name;
  console.log('\n## ' + name);
}

export function ok(cond, msg, extra) {
  if (cond) {
    passed++;
    console.log('  ok   ' + msg);
  } else {
    failed++;
    failures.push(current + ': ' + msg);
    console.log('  FAIL ' + msg + (extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 700) : ''));
  }
}

function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v !== null && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}

export function eq(a, b, msg) {
  ok(canon(a) === canon(b), msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');
}

/** Expect an error answer with this status (and code). */
export async function refuses(api, name, params, o, status, code, msg) {
  const r = await api.call(name, params, o);
  ok(r.status === status && (code === undefined || (r.body && r.body.code === code)), msg + ' -> ' + status + (code ? ' ' + code : ''), { status: r.status, body: r.body });
  return r;
}

export function summary(name) {
  console.log(`\n${name}: ${passed} passed, ${failed} failed`);
  if (failed > 0) for (const f of failures) console.log('  - ' + f);
  return { passed, failed, failures };
}

/** Multipart upload as a signed-in person. */
export async function upload(api, fields, files, as) {
  await api.op('auth.me', {}, { as });
  const email = as === 'owner' ? DEMO.owner : as;
  const token = api.tokens.get(email);
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, typeof v === 'string' ? v : JSON.stringify(v));
  for (const f of files) form.append('file', new Blob([f.bytes]), f.name);
  const res = await fetch(api.base + '/api/ops/files/upload', { method: 'POST', headers: { authorization: token, accept: 'application/json' }, body: form });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

/** Poll files.get until the text step ended. */
export async function waitText(api, file, as, ms = 120000) {
  const until = Date.now() + ms;
  let last = null;
  while (Date.now() < until) {
    last = await api.call('files.get', { file }, { as });
    const st = last.body && last.body.file ? last.body.file.text_state : '';
    if (st !== 'waiting' && st !== 'extracting' && st !== '') return last.body;
    await sleep(300);
  }
  return last ? last.body : null;
}

/* ---------------------------------------------------------- PDF fixtures */

function pdfFrom(objects) {
  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += i + 1 + ' 0 obj\n' + body + '\nendobj\n';
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
  for (const o of offsets) out += String(o).padStart(10, '0') + ' 00000 n \n';
  out += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}

/** A PDF with one text page per entry of `pages` (each a list of lines); `picture` adds a last page with only an image (needs OCR). */
export function pdf(pages, picture = false) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];
  const kids = [];
  for (const lines of pages) {
    let text = '';
    lines.forEach((l, i) => {
      text += 'BT /F1 ' + (i === 0 ? 18 : 12) + ' Tf 72 ' + (720 - i * 26) + ' Td (' + l.replace(/[()\\]/g, (c) => '\\' + c) + ') Tj ET\n';
    });
    const pageNo = objs.length + 1;
    objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + (pageNo + 1) + ' 0 R >>');
    objs.push('<< /Length ' + text.length + ' >>\nstream\n' + text + 'endstream');
    kids.push(pageNo + ' 0 R');
  }
  if (picture) {
    const pic = 'q 300 0 0 200 72 400 cm /Im1 Do Q\n';
    const pixels = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]).toString('latin1');
    const pageNo = objs.length + 1;
    objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 ' + (pageNo + 2) + ' 0 R >> >> /Contents ' + (pageNo + 1) + ' 0 R >>');
    objs.push('<< /Length ' + pic.length + ' >>\nstream\n' + pic + 'endstream');
    objs.push('<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 12 >>\nstream\n' + pixels + '\nendstream');
    kids.push(pageNo + ' 0 R');
  }
  objs[1] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + kids.length + ' >>';
  return pdfFrom(objs);
}

export const DECK = [
  ['Acme Robotics', 'Warehouse robots for mid-size retailers.', 'Founded 2023 in Austin, Texas.'],
  ['Traction', 'ARR of 1,200,000 USD as of September 2026.', 'Paying customers: 42', 'Monthly growth 15 percent.'],
  ['Team', 'Full-time team of 14 people.', 'CTO Dan Chen built the robotics stack.'],
  ['The round', 'Raising 3,000,000 USD on a SAFE.', 'Monthly net burn 180,000 USD.'],
];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Seed: companies, people with employments, two deals at Diligence with founders; answers { deals, people, companies }. */
export async function seedDeals(api) {
  const O = { as: 'owner' };
  const acme = (await api.op('companies.upsert', { name: 'Acme Robotics', domain: 'acmerobotics.com' }, O)).company;
  const lumen = (await api.op('companies.upsert', { name: 'Lumen Health', domain: 'lumenhealth.io' }, O)).company;
  const stripe = (await api.op('companies.upsert', { name: 'Stripe', domain: 'stripe.com' }, O)).company;
  const kiva = (await api.op('companies.upsert', { name: 'Kiva Systems', domain: 'kivasystems.com' }, O)).company;
  const zeta = (await api.op('companies.upsert', { name: 'Zeta Freight', domain: 'zetafreight.com' }, O)).company;
  const ada = (await api.op('people.upsert', { email: 'ada@acmerobotics.com', name: 'Ada Founder', title: 'CEO' }, O)).person;
  const dan = (await api.op('people.upsert', { email: 'dan@acmerobotics.com', name: 'Dan Chen', title: 'CTO' }, O)).person;
  const bea = (await api.op('people.upsert', { email: 'bea@example.org', name: 'Bea Colleague', title: 'Engineering manager' }, O)).person;
  const cy = (await api.op('people.upsert', { email: 'cy@example.net', name: 'Cy Later', title: 'Analyst' }, O)).person;
  const dee = (await api.op('people.upsert', { email: 'dee@example.com', name: 'Dee Unknown', title: 'PM' }, O)).person;
  await api.op('people.link', { person: ada.id, company: kiva.id, title: 'Director of Ops', current: false, start_day: '2015-01-01', end_day: '2020-06-30' }, O);
  await api.op('people.link', { person: bea.id, company: kiva.id, title: 'Engineering manager', current: false, start_day: '2017-03-01', end_day: '2022-01-31' }, O);
  await api.op('people.link', { person: cy.id, company: kiva.id, title: 'Analyst', current: false, start_day: '2021-01-01', end_day: '2022-12-31' }, O);
  await api.op('people.link', { person: dan.id, company: stripe.id, title: 'Engineer', current: false }, O);
  await api.op('people.link', { person: dee.id, company: stripe.id, title: 'PM', current: false }, O);
  const d1 = await api.op('deals.create', { company: acme.id, stage: 'diligence', round_type: 'seed', raise: '3000000', currency: 'USD', point: PARTNER, people: JSON.stringify([{ person: 'ada@acmerobotics.com', role: 'founder' }, { person: 'dan@acmerobotics.com', role: 'founder' }]) }, O);
  const d2 = await api.op('deals.create', { company: lumen.id, stage: 'diligence', round_type: 'series_a', raise: '12000000', currency: 'USD', point: PARTNER2 }, O);
  return { deals: { acme: d1.deal, lumen: d2.deal }, people: { ada, dan, bea, cy, dee }, companies: { acme, lumen, stripe, kiva, zeta } };
}
