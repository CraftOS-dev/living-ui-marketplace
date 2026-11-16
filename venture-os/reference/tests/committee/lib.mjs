// Shared harness for the Venture OS committee tests.
// Env: VO_APP (scratch app dir, default ../app), VO_PORT (default 3188), VO_BRIDGE (mock bridge, default 3288).
// The scratch app carries scratch-only stand-ins for other modules' contracts (never shipped):
// lib_portfolio.holdingsOf, lib_intake.verdictOf, lib_diligence.answersFor, lib_deals_notes.forDeal (tests/stubs/).
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const APP = process.env.VO_APP ?? join(HERE, '..', 'app');
export const PORT = Number(process.env.VO_PORT ?? 3188);
export const BRIDGE = Number(process.env.VO_BRIDGE ?? PORT + 100);
const { client, DEMO } = await import('file:///' + join(APP, 'tools', 'dev', 'api.mjs').replace(/\\/g, '/'));
export { DEMO };

export function newApi() {
  return client({ port: PORT, app: APP });
}

/** Stop the scratch server, wipe its database, start it again with the mock bridge. */
export function fresh() {
  execFileSync('bash', [join(APP, 'tools', 'dev', 'stop.sh'), String(PORT)], { stdio: 'pipe' });
  execFileSync('bash', [join(APP, 'tools', 'dev', 'reset.sh'), APP], { stdio: 'pipe' });
  execFileSync('bash', [join(APP, 'tools', 'dev', 'serve.sh'), APP, String(PORT), String(BRIDGE)], { stdio: 'pipe' });
}

export const O = { as: 'owner' };
export const A = { as: 'agent' };
export const PEOPLE = {
  p1: 'paula@venture.test',
  p2: 'peter@venture.test',
  vp: 'vera@venture.test',
  pr: 'priya@venture.test',
  an: 'andy@venture.test',
};
export const as = (k) => ({ as: PEOPLE[k] });

/** First-run setup as the demo owner (USD, New York, Fund I of USD 50M). */
export async function setupFirm(api) {
  return api.op('setup.complete', { firm_name: 'Northwind Ventures', base_currency: 'USD', zone: 'America/New_York', fund_name: 'Fund I', fund_size: '50000000', fund_vintage: 2025, owner_name: 'Olivia Owner', email: DEMO.owner, password: DEMO.password, pin: DEMO.pin });
}

/** Invite a member with a role, sign them in and set their PIN. */
export async function member(api, email, role, name) {
  const inv = await api.op('members.invite', { email, name, role }, { as: 'owner', pin: true });
  const joined = await api.op('auth.accept-invite', { email, code: inv.code, password: DEMO.password });
  api.setToken(email, joined.token);
  const st = await api.call('pin.set', { password: DEMO.password, new_pin: DEMO.pin }, { as: email });
  if (st.status !== 200) throw new Error('pin.set ' + JSON.stringify(st.body));
  return email;
}

/** The firm with the team: two partners, a venture partner, a principal and an analyst. */
export async function team(api) {
  await setupFirm(api);
  await member(api, PEOPLE.p1, 'partner', 'Paula Partner');
  await member(api, PEOPLE.p2, 'partner', 'Peter Partner');
  await member(api, PEOPLE.vp, 'venture_partner', 'Vera Venture');
  await member(api, PEOPLE.pr, 'principal', 'Priya Principal');
  await member(api, PEOPLE.an, 'analyst', 'Andy Analyst');
}

/** A deal (seed USD 3M at USD 15M post, check USD 1M, point Paula) moved to a stage. */
export async function deal(api, company, stage, extra = {}) {
  const d = await api.op('deals.create', Object.assign({ company, round_type: 'seed', raise: '3000000', post_money: '15000000', check: '1000000', currency: 'USD', instrument: 'safe_cap', point: PEOPLE.p1 }, extra), { as: 'owner' });
  const deal0 = d.deal || d;
  if (stage) await api.op('deals.move', { deal: deal0.number, stage }, { as: 'owner' });
  return (await api.op('deals.get', { deal: deal0.number }, { as: 'owner' })).deal || deal0;
}

export async function upload(api, fields, files, as0) {
  await api.op('auth.me', {}, { as: as0 });
  const email = as0 === 'owner' ? DEMO.owner : as0;
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, typeof v === 'string' ? v : JSON.stringify(v));
  for (const f of files) form.append('file', new Blob([f.bytes]), f.name);
  const res = await fetch(api.base + '/api/ops/files/upload', { method: 'POST', headers: { authorization: api.tokens.get(email), accept: 'application/json' }, body: form });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

export async function waitText(api, file, o, ms = 120000) {
  const until = Date.now() + ms;
  let last = null;
  while (Date.now() < until) {
    last = await api.call('files.get', { file }, o);
    const st = last.body && last.body.file ? last.body.file.text_state : '';
    if (st !== 'waiting' && st !== 'extracting' && st !== '') return last.body;
    await new Promise((r) => setTimeout(r, 300));
  }
  return last ? last.body : null;
}

/** A tiny one-page PDF with a real text layer. */
export function pdf(lines) {
  let text = '';
  lines.forEach((l, i) => {
    text += 'BT /F1 12 Tf 72 ' + (720 - i * 24) + ' Td (' + l.replace(/[()\\]/g, (c) => '\\' + c) + ') Tj ET\n';
  });
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    '<< /Length ' + text.length + ' >>\nstream\n' + text + 'endstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let out = '%PDF-1.4\n';
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
    console.log('  FAIL ' + msg + (extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 600) : ''));
  }
}

export function eq(a, b, msg) {
  ok(JSON.stringify(a) === JSON.stringify(b), msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');
}

export async function refuses(api, name, params, o, status, code, msg) {
  const r = await api.call(name, params, o);
  ok(r.status === status && (code === undefined || (r.body && r.body.code === code)), msg + ' -> ' + status + (code ? ' ' + code : ''), { status: r.status, body: r.body });
  return r;
}

/** Does any value in a JSON answer carry a vote choice (a non-empty "choice", "rationale" or a true "veto")? */
export function leaksChoice(body) {
  let found = null;
  const walk = (v, path) => {
    if (found) return;
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, path + '[' + i + ']'));
    else if (v !== null && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if ((k === 'choice' || k === 'champion_choice') && x !== null && x !== '' && x !== undefined) found = path + '.' + k + '=' + JSON.stringify(x);
        else if (k === 'rationale' && typeof x === 'string' && x !== '') found = path + '.' + k;
        else if (k === 'veto' && x === true) found = path + '.veto';
        else if (k === 'ballot_sealed') found = path + '.ballot_sealed';
        else walk(x, path + '.' + k);
      }
    }
  };
  walk(body, '');
  return found;
}

export function summary(name) {
  console.log(`\n${name}: ${passed} passed, ${failed} failed`);
  if (failed > 0) for (const f of failures) console.log('  - ' + f);
  return { passed, failed, failures };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
