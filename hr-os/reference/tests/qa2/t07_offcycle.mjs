// QA2 t07: an off-cycle run per country on the t02 state (November regular run
// and the 30 Nov bonus locked): a 200 allowance (JPY 20,000) for the new hire A
// paid 30 Nov. Capped bases must not be charged again and month-aggregated
// contributions must add only the difference. Hand values where the rule is a
// plain month aggregation; the other lines are recorded.
//   QA_APP=<qa2/app2> QA_PORT=3192 node t07_offcycle.mjs
import { newApi, section, ok, eq, summary, writeResult, O } from './lib.mjs';

const api = newApi();
const PAY = { as: 'payroll@northwind.test' };
const PAYPIN = { as: 'payroll@northwind.test', pin: true };
const cents = (x) => Math.round(x * 100);
const HAND = {
  // SG: month total wages 6,500 OW + 1,000 AW + 200 OW = 7,700: CPF total 37% x 7,700 = 2,849, employee 1,540;
  // already 2,405 + 370 and 1,300 + 200: this run 74 total, 40 employee, 34 employer. SDL at its 11.25 maximum: 0.
  // CDAC: 7,700 is above 7,500: 3.00 against 2.00 already: 1.00.
  SG: { SG_CPF_EE: 4000, SG_CPF_ER: 3400, SG_SDL: 0, SG_SHG: 100 },
  // US: FUTA, CA UI and ETT bases used in November; SS 6.2%, Medicare 1.45%, CA SDI 1.3% of 200.
  US: { US_SS_EE: 1240, US_MED_EE: 290, US_SS_ER: 1240, US_MED_ER: 290, US_CA_SDI: 260, US_FUTA: 0, US_CA_UI: 0, US_CA_ETT: 0 },
  // GB: one earnings period (pay 3,000 + 1,000 + 200 = 4,200): NI employee 251.50 less 236.16 = 15.34, employer
  // 15% of 200 = 30.00; pension on qualifying earnings capped at 4,189: 183.45 less 174.00 = 9.45, employer 5.67.
  GB: { GB_NI_EE: 1534, GB_NI_ER: 3000, GB_PENSION_EE: 945, GB_PENSION_ER: 567 },
  // IN: the EPF wage ceiling was reached by the regular run.
  IN: { IN_PF_EE: 0, IN_EPS_ER: 0, IN_EPF_ER: 0, IN_EDLI_ER: 0 },
};
const PEOPLE = { SG: 'E0025', US: 'E0026', JP: 'E0027', IN: 'E0028', MY: 'E0029', GB: 'E0031', AU: 'E0033' };
const dir = (await api.op('people.directory', { status: 'all', limit: 500 }, O)).people;
const out = {};
async function approveAll(id) {
  for (let i = 0; i < 6; i++) {
    const a = (await api.op('approvals.get', { approval: id }, O)).approval;
    if (a.status !== 'pending') return a.status;
    for (const as of ['owner', 'hr@northwind.test']) if ((await api.call('approvals.decide', { approval: id, decision: 'approved', note: 'QA2' }, { as, pin: true })).status < 400) break;
  }
  return 'pending';
}
for (const [cc, num] of Object.entries(PEOPLE)) {
  section(cc + ' off-cycle allowance for ' + num);
  try {
    const p = dir.find((x) => x.number === num);
    const comps = (await api.op('components.list', { entity: p.entity }, PAY)).components;
    const c = comps.find((x) => x.role === 'allowance') || comps.find((x) => x.role === 'commission');
    const run = (await api.op('payruns.create', { kind: 'off_cycle', entity: p.entity, employments: [p.employment], pay_date: '2026-11-30', label: 'QA2 off-cycle allowance' }, PAY)).payrun;
    await api.op('pay-inputs.add', { employment: p.employment, component: c.code, amount: cc === 'JP' ? '20000' : '200.00', payrun: run.id }, PAY);
    let r = await api.op('payruns.calculate', { payrun: run.id }, PAY);
    for (let i = 0; i < 20 && !r.done; i++) r = await api.op('payruns.calculate', { payrun: run.id, continue: true }, PAY);
    const iss = (await api.op('payruns.issues', { payrun: run.id }, PAY)).issues;
    const g = await api.op('payruns.get', { payrun: run.id }, PAY);
    const slip = (await api.op('payslips.get', { payslip: g.payslips[0].id }, PAY)).payslip;
    const lines = {};
    for (const gr of slip.groups) for (const l of gr.lines) lines[l.code] = (lines[l.code] || 0) + l.amount_minor;
    out[cc] = { run: run.number, component: c.code, lines, net: slip.net_minor, issues: iss.map((i) => i.severity + ':' + i.code + ': ' + String(i.message || '').slice(0, 140)) };
    console.log('  ' + run.number + ' ' + JSON.stringify(lines) + ' ' + JSON.stringify(out[cc].issues.map((x) => x.split(':').slice(0, 2).join(':'))));
    const blockers = iss.filter((i) => i.severity === 'blocker');
    ok(blockers.length === 0, cc + ': off-cycle calculates with no blocker', blockers.map((b) => b.code + ': ' + b.message));
    for (const [code, want] of Object.entries(HAND[cc] || {})) eq(lines[code] || 0, want, cc + ' off-cycle ' + code);
    if (blockers.length === 0) {
      if (iss.length) await api.op('payruns.acknowledge', { payrun: run.id, reason: 'reviewed_ok', note: 'QA2' }, PAY);
      const sub = await api.op('payruns.submit', { payrun: run.id }, PAY);
      if (sub.approval) await approveAll(sub.approval.id);
      const lk = await api.call('payruns.lock', { payrun: run.id }, PAYPIN);
      ok(lk.status === 200, cc + ': off-cycle locks (' + lk.status + ')');
      const po = await api.op('payout.run', { payrun: run.id }, PAY);
      ok(po.totals.balanced === true, cc + ': off-cycle payout balanced');
    }
  } catch (err) {
    ok(false, cc + ' threw: ' + (err.status || '') + ' ' + (err.code || '') + ' ' + String(err.message).slice(0, 300));
  }
}
writeResult('t07_offcycle.json', out);
const s = summary('t07_offcycle');
process.exitCode = s.failed > 0 ? 1 : 0;
