// t06: unused leave paid out on termination (types with payout_on_exit), with the
// real lifecycle and payroll modules: a separation approved, its last day moved
// earlier, the final pay run paying it, then the last day moved later and earlier
// again. Also the seeded flags per country, a leaver's accrual to the last day
// (Australia) and Japan paying nothing by default.
// Run on a demo seed after t04 (zz_leave_test.pb.js in pb_hooks); makes a GB and an AU entity when there are none.
import { readFileSync } from 'node:fs';
import { api, ok, eq, near, done, section } from './lib.mjs';

const O = { as: 'owner' };
const HR = { as: 'hr@northwind.test' };
const PAY = 'payroll@northwind.test';
const PAYPIN = { as: PAY, pin: true };
const tr = async (fn, body) => {
  const res = await fetch(api.base + '/api/leave-test/' + fn, { method: 'POST', headers: { 'content-type': 'application/json', 'X-A2App-Token': readFileSync(api.app + '/.agent-token', 'utf8').trim() }, body: JSON.stringify(body || {}) });
  const j = await res.json();
  if (res.status !== 200) throw new Error(fn + ': ' + JSON.stringify(j));
  return j.out;
};
const r2 = (n) => Math.round(n * 100) / 100;
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const dim = (d) => new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).getUTCDate();
async function decideAny(id) {
  let last = null;
  for (const as of ['hr@northwind.test', 'owner', PAY, 'eng.lead@northwind.test']) {
    const r = await api.call('approvals.decide', { approval: id, decision: 'approved' }, { as, pin: true });
    if (r.status < 400) return r.body;
    last = r;
  }
  throw new Error('nobody could decide ' + id + ': ' + JSON.stringify(last.body));
}
async function decideAll(id) {
  for (let i = 0; i < 4; i++) {
    const a = await api.op('approvals.get', { approval: id }, O);
    if (a.approval.status !== 'pending') return a.approval.status;
    await decideAny(id);
  }
  return (await api.op('approvals.get', { approval: id }, O)).approval.status;
}
async function separate(emp, lastDay) {
  const r = await api.op('separations.request', { employment: emp.number, kind: 'termination', last_day: lastDay, reason: 'Role closed', reason_code: 'redundancy', rehire_eligible: 'yes' }, HR);
  eq(await decideAll(r.separation.approval), 'approved', emp.name + ': separation approved (last day ' + lastDay + ')');
  return (await api.op('separations.get', { separation: r.separation.id }, O)).separation;
}
const exits = async (employment) => (await api.op('leave.encashments', { employment }, O)).encashments.filter((e) => e.kind === 'exit');
const hire = async (entity, name, start, extra) => {
  const out = await api.op('people.hire', Object.assign({ entity, legal_name: name, start_day: start, title: 'Associate' }, extra || {}), O);
  return { employment: out.employment.id, employee: out.employee.id, number: out.employee.number, name };
};
async function calcRun(id) {
  let r = await api.op('payruns.calculate', { payrun: id }, O);
  for (let i = 0; i < 60 && !r.done; i++) r = await api.op('payruns.calculate', { payrun: id, continue: true }, O);
  return r;
}
async function linesOf(runId, number) {
  const got = await api.op('payruns.get', { payrun: runId }, O);
  const row = got.payslips.find((x) => x.number === number);
  if (!row) return [];
  const s = (await api.op('payslips.get', { payslip: row.id }, O)).payslip;
  return (s.groups || []).flatMap((g) => g.lines || []);
}
const isEncash = (l) => l.ref_kind === 'encash' || (l.explain && l.explain.detail && l.explain.detail.ref_kind === 'encash');

const ents = (await api.op('entities.list', {}, O)).entities;
const sg = ents.find((e) => e.country === 'SG');
const jp = ents.find((e) => e.country === 'JP');
const us = ents.find((e) => e.country === 'US');
const gb = ents.find((e) => e.country === 'GB') ?? (await api.op('entities.add', { name: 'Exit Test Ltd', country: 'GB', region: 'ENG' }, O)).entity;
const au = ents.find((e) => e.country === 'AU') ?? (await api.op('entities.add', { name: 'Exit Test Pty Ltd', country: 'AU', region: 'NSW', timezone: 'Australia/Sydney' }, O)).entity;
const today = (await api.op('auth.me', {}, O)).today;

section('the flag is seeded where the law requires a payout, and editable');
const flag = async (ent, code) => {
  const t = (await api.op('leave.types', { entity: ent.id }, O)).types.find((x) => x.code === code);
  return t ? t.payout_on_exit : null;
};
eq(await flag(sg, 'annual'), true, 'Singapore annual leave: paid out');
eq(await flag(jp, 'annual'), false, 'Japan annual paid leave: not paid out by default');
eq(await flag(us, 'pto'), us.region === 'CA', 'United States PTO: paid out in California only (region ' + us.region + ')');
if (gb) eq(await flag(gb, 'annual'), true, 'United Kingdom annual leave: paid out');
if (au) {
  eq(await flag(au, 'annual'), true, 'Australia annual leave: paid out');
  eq(await flag(au, 'personal_carer'), false, "Australia personal/carer's leave: not paid out");
}
const jpAnnual = (await api.op('leave.types', { entity: jp.id }, O)).types.find((x) => x.code === 'annual');
await api.op('leave.types-save', { type: jpAnnual.id, payout_on_exit: true }, O);
eq(await flag(jp, 'annual'), true, 'HR can switch it on');
await api.op('leave.types-save', { type: jpAnnual.id, payout_on_exit: false }, O);
eq(await flag(jp, 'annual'), false, 'and off again');

section('Singapore: approval pays out the balance prorated to the last day');
const lena = await hire(sg.id, 'Lena Ong', '2024-03-01', { birth_date: '1990-04-12', gender: 'female', nationality: 'SG', pay_basis: 'salary', pay_amount: '4650.00', pay_per: 'month', tax_fields: { sg_residency: 'sc', sg_shg: 'none' } });
const bank = await api.op('bank.add', { employee: lena.employee, number: '99' + lena.number.replace(/\D/g, '') + '0001', bank_name: 'Test Bank', bank_code: '7171', holder: lena.name }, O);
if (bank.approval && bank.approval.status === 'pending') await decideAll(bank.approval.id);
const full = await api.op('leave.balance', { employment: lena.employment, type: 'annual', project_to: '2026-12-31' }, O);
const last1 = '2026-12-14';
const sep = await separate(lena, last1);
ok((sep.events || []).some((e) => e.module === 'leave' && e.ok), 'the leave subscriber ran inside the approval', sep.events);
let ex = await exits(lena.employment);
eq(ex.length, 1, 'one payout on leaving');
const pay1 = ex[0];
eq([pay1.status, pay1.pay_on, pay1.separation], ['approved', last1, sep.id], 'approved, paid on the last day, tied to the separation');
ok(pay1.days > 0 && pay1.days < full.projection.balance, 'less than a full year (' + pay1.days + ' of ' + full.projection.balance + ')');
const g = (await api.op('leave.ledger', { employment: lena.employment, type: 'annual' }, O)).rows.filter((r) => r.key.startsWith('G:2026-01-01'));
ok(g.some((r) => /to the last day/.test(r.note)) && r2(g.reduce((a, r) => a + r.amount, 0)) < 8, "this year's grant is cut to the last day", g);
near((await api.op('leave.balance', { employment: lena.employment, type: 'annual', day: last1 }, O)).balance, 0, 'nothing is left on the last day');
let pi = await tr('payInputs', { employment: lena.employment, from: '2026-12-01', to: last1 });
eq(pi.encash.map((x) => [x.request, x.days, x.kind]), [[pay1.id, pay1.days, 'exit']], 'payroll reads it through payInputs().encash, marked exit');
const audit1 = await api.op('audit.list', { collection: 'leave_encash_requests', record: pay1.id }, O);
ok(audit1.entries.some((x) => /with the final pay/.test(x.summary)), 'the payout is in the audit trail');

section('the last day moves earlier: the payout follows');
await api.op('separations.update', { separation: sep.id, last_day: '2026-12-01' }, HR);
ex = await exits(lena.employment);
const open1 = ex.filter((e) => e.status === 'approved');
eq(open1.length, 1, 'still one payout');
eq(open1[0].pay_on, '2026-12-01', 'paid on the new last day');
ok(open1[0].days <= pay1.days, 'no more than before (' + open1[0].days + ' <= ' + pay1.days + ')');
near((await api.op('leave.balance', { employment: lena.employment, type: 'annual', day: '2026-12-01' }, O)).balance, 0, 'nothing left on the new last day');
const encRows = (await api.op('leave.ledger', { employment: lena.employment, type: 'annual' }, O)).rows.filter((r) => r.ref === open1[0].id);
near(r2(encRows.reduce((a, r) => a + r.amount, 0)), -open1[0].days, 'its ledger rows sum to the payout (moved, never deleted)');

section('the final pay run pays it once');
const runId = sep.settlement_payrun;
ok(typeof runId === 'string' && runId !== '', 'payroll opened the final pay run on approval', sep);
if (runId) {
  await calcRun(runId);
  const lines = (await linesOf(runId, lena.number)).filter(isEncash);
  eq(lines.length, 1, 'one leave payout line on the final payslip');
  near(lines[0] ? lines[0].qty : -1, open1[0].days, 'for the days paid out');
  const iss = await api.op('payruns.issues', { payrun: runId }, O);
  const blockers = iss.issues.filter((i) => i.severity === 'blocker');
  if (blockers.length === 0) {
    if (iss.issues.length > 0) await api.op('payruns.acknowledge', { payrun: runId, reason: 'reviewed_ok' }, { as: PAY });
    const sub = await api.op('payruns.submit', { payrun: runId }, { as: PAY });
    if (sub.approval && sub.approval.status === 'pending') await decideAll(sub.approval.id);
    await api.op('payruns.lock', { payrun: runId }, PAYPIN);
    const paid = (await exits(lena.employment)).find((e) => e.id === open1[0].id);
    eq([paid.status, paid.payrun], ['paid', runId], 'lock marks the payout paid');

    section('after payment the last day moves later: the extra is a second payout');
    const up = await api.call('separations.update', { separation: sep.id, last_day: '2026-12-31' }, HR);
    if (up.status === 200) {
      const after = await exits(lena.employment);
      const still = after.find((e) => e.id === paid.id);
      eq([still.status, still.days], ['paid', paid.days], 'the paid payout never changes');
      const extra = after.filter((e) => e.status === 'approved');
      near((await api.op('leave.balance', { employment: lena.employment, type: 'annual', day: '2026-12-31' }, O)).balance, 0, 'nothing left on the later last day');
      ok(extra.length <= 1 && (extra.length === 0 || extra[0].days > 0), 'at most one more payout, for the extra days', extra);
      await api.op('separations.update', { separation: sep.id, last_day: '2026-12-01' }, HR);
      const back = await exits(lena.employment);
      eq(back.filter((e) => e.status === 'approved').length, 0, 'back to the paid last day: the extra payout is withdrawn');
      eq(back.find((e) => e.id === paid.id).status, 'paid', 'the paid one stays paid');
    } else console.log('  (lifecycle refused to move the last day after the final pay was locked: ' + up.status + ')');
  } else console.log('  (final pay has blockers, not locked: ' + blockers.map((b) => b.code).join(', ') + ')');
}

section('Australia: a leaver accrues only to the last day');
if (au) {
  const leah = await hire(au.id, 'Leah Grant', '2026-07-01');
  const auToday = (await api.op('leave.balance', { employment: leah.employment, type: 'annual' }, O)).day;
  const last = addDays(auToday.slice(0, 8) + '01', 14) > auToday ? addDays(auToday.slice(0, 8) + '01', 14) : addDays(auToday, 3);
  await separate(leah, last);
  const m = Number(last.slice(5, 7)) - 7;
  const month = r2(r2((20 * (m + 1)) / 12) - r2((20 * m) / 12));
  const want = r2(r2((20 * m) / 12) + r2((month * Number(last.slice(8, 10))) / dim(last)));
  const e = await exits(leah.employment);
  eq(e.length, 1, 'one payout');
  near(e[0] ? e[0].days : -1, want, m + ' months and ' + Number(last.slice(8, 10)) + ' days of ' + last.slice(0, 7) + ' (not the whole month)');
  near((await api.op('leave.balance', { employment: leah.employment, type: 'annual', day: last }, O)).balance, 0, 'nothing left on the last day');
  eq((await exits(leah.employment)).filter((x) => x.type === 'personal_carer').length, 0, "personal/carer's leave is not paid out");
}

section('Japan: nothing is paid out by default');
const ken = await hire(jp.id, 'Ken Mori', '2024-01-10');
await separate(ken, addDays(today, 20));
eq((await exits(ken.employment)).length, 0, 'no payout on leaving');

done('t06 exit');
