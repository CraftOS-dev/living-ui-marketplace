// Shared harness for the payroll-core tests. Env: HR_APP (scratch app dir), HR_PORT (default 3186).
import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const APP = process.env.HR_APP ?? join(HERE, '..', 'app');
export const PORT = Number(process.env.HR_PORT ?? 3186);
const { client, DEMO } = await import('file:///' + join(APP, 'tools', 'dev', 'api.mjs').replace(/\\/g, '/'));
export { DEMO };

export function newApi() {
  return client({ port: PORT, app: APP });
}

/** Stop, wipe, start (and seed the demo when asked). Stub data for the other modules starts empty. */
export function fresh(opts = {}) {
  execFileSync('bash', [join(APP, 'tools', 'dev', 'stop.sh'), String(PORT)], { stdio: 'pipe' });
  execFileSync('bash', [join(APP, 'tools', 'dev', 'reset.sh'), APP], { stdio: 'pipe' });
  stubData({});
  writeFileSync(join(APP, '.stub-calls.json'), '[]');
  execFileSync('bash', [join(APP, 'tools', 'dev', 'serve.sh'), APP, String(PORT)], { stdio: 'pipe' });
  if (opts.seed) execFileSync('node', [join(APP, 'tools', 'dev', 'seed_demo.mjs'), '--port', String(PORT), '--app', APP], { stdio: 'pipe' });
}

/** Scratch-only data the stubbed time, leave and expenses contracts answer with. */
export function stubData(d) {
  writeFileSync(join(APP, '.stub-data.json'), JSON.stringify(d));
}
export function stubCalls() {
  const p = join(APP, '.stub-calls.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8') || '[]') : [];
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

export function summary(name) {
  console.log(`\n${name}: ${passed} passed, ${failed} failed`);
  if (failed > 0) for (const f of failures) console.log('  - ' + f);
  return { passed, failed, failures };
}

export const O = { as: 'owner' };
export const PAY = { as: 'payroll@northwind.test' };
export const PIN = { as: 'owner', pin: true };
export const PAYPIN = { as: 'payroll@northwind.test', pin: true };

/** Directory rows by employee number (primary employments). */
export async function people(api) {
  const d = await api.op('people.directory', { status: 'all', limit: 500 }, O);
  const out = {};
  for (const r of d.people || d.rows || []) out[r.employee_number || r.number] = r;
  return out;
}

/** Minor units of a payslip's lines by code. */
export function byCode(slip) {
  const out = {};
  for (const g of slip.groups) for (const l of g.lines) out[l.code] = (out[l.code] || 0) + l.amount_minor;
  return out;
}

/** Half away from zero to 2 decimals, minor units of a 2-decimal currency. */
export function cents(x) {
  return Math.sign(x) * Math.round(Math.abs(x) * 100 + 1e-7);
}

/** Calculate a run to the end (calls again while the answer says done false). */
export async function calcRun(api, runId, o = O) {
  let r = await api.op('payruns.calculate', { payrun: runId }, o);
  for (let i = 0; i < 50 && !r.done; i++) r = await api.op('payruns.calculate', { payrun: runId, continue: true }, o);
  return r;
}

/** Decide an approval as the first of payroll, owner, HR who may. */
export async function decideAny(api, id, decision, note) {
  let last = null;
  for (const as of ['payroll@northwind.test', 'owner', 'hr@northwind.test']) {
    const r = await api.call('approvals.decide', { approval: id, decision: decision, note: note || '' }, { as: as, pin: true });
    if (r.status < 400) return { as: as, body: r.body };
    last = r;
  }
  throw new Error('nobody could decide ' + id + ': ' + JSON.stringify(last.body));
}

/**
 * Make the demo payable: an approved bank account for everyone, Japan's
 * prefecture and standard monthly remuneration, India's tax packs limited to
 * the active TDS pack (the EPF, ESI and Maharashtra PT packs ship as drafts).
 */
export async function preparePayable(api, opts = {}) {
  const ppl = await api.op('people.directory', { status: 'current', limit: 500 }, O);
  const rows = ppl.people || ppl.rows;
  const smr = { 1150000: 1150000, 520000: 530000, 430000: 440000, 350000: 360000, 480000: 470000 };
  for (const r of rows) {
    const emp = r.employee || r.employee_id;
    if (!opts.noBank) {
      const add = await api.op('bank.add', { employee: emp, number: '99' + String(r.number || r.employee_number).replace(/\D/g, '') + '0001', bank_name: 'Test Bank', bank_code: '001', holder: r.name }, O);
      const ap = add.approval;
      if (ap && ap.status === 'pending') {
        await decideAny(api, ap.id, 'approved');
      }
    }
  }
  // The pending demo account of Sam: approve it too.
  const pend = await api.op('approvals.list', { view: 'all', status: 'pending', kind: 'bank_account' }, O);
  for (const a of pend.approvals) {
    await decideAny(api, a.id, 'approved');
  }
  for (const r of rows) {
    const ent = r.entity_name || '';
    const emp = r.employment || r.employment_id || r.id;
    if (ent === 'Northwind KK') {
      const pay = await api.op('pay.history', { employment: emp }, O);
      const amt = pay.records.filter((x) => x.state === 'current')[0].amount_minor;
      await api.op('taxprofile.submit', { employment: emp, fields: { jp_prefecture: '13', jp_smr: smr[amt] || 530000 } }, O);
    }
    if (ent === 'Northwind India Pvt Ltd') await api.op('taxprofile.submit', { employment: emp, packs: ['in'], fields: { in_regime: 'new' } }, O);
  }
}
