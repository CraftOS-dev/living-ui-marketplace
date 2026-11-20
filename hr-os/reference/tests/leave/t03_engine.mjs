// t03: the balance engine per country rule (run after t02 on the demo data).
import { readFileSync } from 'node:fs';
import { api, ok, eq, near, done, section } from './lib.mjs';

const HR = 'hr@northwind.test';
const tr = async (fn, body) => {
  const res = await fetch(api.base + '/api/leave-test/' + fn, { method: 'POST', headers: { 'content-type': 'application/json', 'X-A2App-Token': readFileSync(api.app + '/.agent-token', 'utf8').trim() }, body: JSON.stringify(body || {}) });
  const j = await res.json();
  if (res.status !== 200) throw new Error(fn + ': ' + JSON.stringify(j));
  return j.out;
};
const today = (await api.op('auth.me', {}, { as: 'owner' })).today;
const O = { as: 'owner' };
const hire = async (entity, name, start, extra) => (await api.op('people.hire', Object.assign({ entity, legal_name: name, start_day: start, title: 'Associate' }, extra || {}), O)).employment.id;
const avail = async (emp, type, day) => (await api.op('leave.balance', { employment: emp, type, day }, O));
const ents = (await api.op('entities.list', {}, O)).entities;
const sg = ents.find((e) => e.country === 'SG');
const jp = ents.find((e) => e.country === 'JP');
const us = ents.find((e) => e.country === 'US');

section('United Kingdom: bank holidays come out of 28 days');
const gb = (await api.op('entities.add', { name: 'Northwind Ltd', country: 'GB', region: 'ENG' }, O)).entity;
const gina = await hire(gb.id, 'Gina Hart', '2026-01-05');
const cal = await api.op('calendars.get', { calendar: gb.default_calendar, year: 2026 }, O);
const wkdays = cal.holidays.filter((h) => h.day >= '2026-01-05' && h.day <= today && ['public', 'observed', 'company'].includes(h.kind) && ![0, 6].includes(new Date(h.day + 'T00:00:00Z').getUTCDay()));
const gb1 = await avail(gina, 'annual');
near(gb1.granted, 28, 'full year of 28 days (joined in the first half of January)');
near(gb1.balance, 28 - wkdays.length, 'less the bank holidays so far (' + wkdays.length + ')');
const ledger = await api.op('leave.ledger', { employment: gina, type: 'annual' }, O);
eq(ledger.rows.filter((r) => r.key.startsWith('H:')).length, wkdays.length, 'one row per bank holiday');
const pt = await api.op('schedules.add', { name: 'Three days', week: [{ dow: 1, start: '09:00', end: '17:00', break_min: 60 }, { dow: 3, start: '09:00', end: '17:00', break_min: 60 }, { dow: 5, start: '09:00', end: '17:00', break_min: 60 }] }, O);
const pat = await hire(gb.id, 'Pat Lowe', '2026-01-05', { schedule: pt.schedule.id });
near((await avail(pat, 'annual')).granted, 17, 'three days a week: 5.6 weeks is 16.8, rounded to 17');

section('Australia: progressive accrual from July (each day earns its share)');
const au = (await api.op('entities.add', { name: 'Northwind Pty Ltd', country: 'AU', region: 'NSW', timezone: 'Australia/Sydney' }, O)).entity;
const aaron = await hire(au.id, 'Aaron Lee', '2026-07-01');
const auB = await avail(aaron, 'annual');
const auToday = auB.day;
const r2 = (n) => Math.round(n * 100) / 100;
const dim = (d) => new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).getUTCDate();
// Months of the leave year (from July) finished by the Sydney day, then the days of the month in progress.
const monthsDone = Number(auToday.slice(5, 7)) - 7 + (Number(auToday.slice(8, 10)) === dim(auToday) ? 1 : 0);
const inMonth = Number(auToday.slice(8, 10)) === dim(auToday) ? 0 : Number(auToday.slice(8, 10));
const accrued = (a) => r2(r2((a * monthsDone) / 12) + r2(((r2((a * (monthsDone + 1)) / 12) - r2((a * monthsDone) / 12)) * inMonth) / dim(auToday)));
near(auB.balance, accrued(20), 'annual leave: ' + monthsDone + ' months and ' + inMonth + ' days of this month (' + auToday + ')');
const auP = await api.op('leave.balance', { employment: aaron, type: 'annual', project_to: '2027-06-30' }, O);
near(auP.projection.balance, 20, 'a full year projects to 20 days');
near((await avail(aaron, 'personal_carer')).balance, accrued(10), "personal/carer's leave accrues too");
const auLedger = (await api.op('leave.ledger', { employment: aaron, type: 'annual' }, O)).rows;
eq(auLedger.filter((r) => r.kind === 'accrual').length, monthsDone, 'the ledger has one row per finished month (the month in progress is written when it ends)');
const plusDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const newbie = await hire(au.id, 'Nina Park', plusDays(auToday, -20));
const nb = await avail(newbie, 'annual');
near(nb.balance, r2((20 * 21) / 365), 'a new hire 21 days in has accrued about 21/365 of 20 days', 0.12);
ok(nb.available >= 1, 'and can take a day of leave in the first month', nb);

section('Malaysia: tenure bands, carry-over, sick leave counts toward hospitalisation');
const myE = (await api.op('entities.add', { name: 'Northwind Sdn Bhd', country: 'MY', region: '14' }, O)).entity;
const mira = await hire(myE.id, 'Mira Hassan', '2024-03-01');
const myA = await avail(mira, 'annual');
near(myA.granted, 8, '8 days under 2 years of service');
near(myA.balance, 8, 'last year carry-over (5) expired after 6 months');
const myL = (await api.op('leave.ledger', { employment: mira, type: 'annual' }, O)).rows;
const g24 = myL.find((r) => r.key.startsWith('G:2024-01-01'));
near(g24 ? g24.amount : -1, 6.5, '2024: joined in March, 10 of 12 months of 8 days rounded to half days');
const sick = await api.op('leave.request', { employment: mira, type: 'sick', start: today, end: today, record: true, reason: 'Fever' }, { as: 'owner' });
near((await avail(mira, 'sick')).available, 14 - sick.request.days, 'sick leave used');
near((await avail(mira, 'hospitalisation')).available, 60 - sick.request.days, 'and counted toward hospitalisation leave');
await api.op('leave.cancel', { request: sick.request.id, reason: 'Wrong person' }, O);
near((await avail(mira, 'hospitalisation')).available, 60, 'cancelling gives both back');

section('Singapore: a new joiner climbs the sick leave ladder');
const siti = await hire(sg.id, 'Siti Rahman', '2026-06-01');
const sitiSick = await avail(siti, 'sick');
const ladder = [['2026-09-01', 5], ['2026-10-01', 8], ['2026-11-01', 11], ['2026-12-01', 14]].filter((x) => x[0] <= today).pop();
near(sitiSick.balance, ladder ? ladder[1] : 0, 'outpatient sick days after ' + (ladder ? ladder[0] : 'none'));
near((await avail(siti, 'annual')).balance, today >= '2026-09-01' ? 4 : 0, 'annual: 7 days prorated to 7 of 12 months, after 3 months');
const sitiProj = await api.op('leave.balance', { employment: siti, type: 'sick', project_to: '2026-12-15' }, O);
near(sitiProj.projection.balance, 14, 'projected to 14 after 6 months');

section('Japan: a part-timer gets the proportional grant');
const p3 = await api.op('schedules.add', { name: 'Part time MWF', week: [{ dow: 1, start: '09:00', end: '15:00', break_min: 0 }, { dow: 3, start: '09:00', end: '15:00', break_min: 0 }, { dow: 5, start: '09:00', end: '15:00', break_min: 0 }] }, O);
const kaito = await hire(jp.id, 'Kaito Mori', '2025-04-01', { schedule: p3.schedule.id });
const kB = await avail(kaito, 'annual');
near(kB.balance, today >= '2026-10-01' ? 11 : 5, '3 days a week: 5 days at 6 months, 6 at 18 months');
const ob = await api.op('leave.obligation', { employment: kaito }, O);
eq(ob.rows.length, 0, 'under 10 days: no five-day rule');
const kExp = await api.op('leave.balance', { employment: kaito, type: 'annual', project_to: '2027-10-02' }, O);
ok(kExp.projection.balance <= 6 + 8 + 0.01, 'the first grant expired after two years', kExp.projection);

section('United States (California): hours, and accrual per hours worked');
const carla = await hire(us.id, 'Carla Diaz', '2026-02-02');
const caS = await avail(carla, 'sick_ca');
eq(caS.unit, 'hour', 'California sick leave is in hours');
near(caS.balance, 40, '40 hours up front');
near((await avail(carla, 'pto')).granted, 14, 'PTO: 15 days, 11 of 12 months, rounded to 14');
const hcheck = await api.op('leave.check', { employment: carla, type: 'sick_ca', start: '2026-12-08', hours: 3 }, O);
near(hcheck.amount, 3, 'three hours');
const fcheck = await api.op('leave.check', { employment: carla, type: 'sick_ca', start: '2026-12-08' }, O);
near(fcheck.amount, 8, 'a full day is 8 scheduled hours');
const pol = (await api.op('leave.policies', { entity: us.id }, O)).policies.find((p) => p.is_default);
const accr = await api.op('leave.policy-save', { name: 'California accrual', entity: us.id, period_start: '01-01', rules: pol.rules.map((r) => (r.type === 'sick_ca' ? { type: 'sick_ca', method: 'per_hours_worked', per_hours: { per: 30, earn: 1 }, max_balance: 80, expiry: 'period', carryover_max: 48 } : r)) }, { as: HR });
await api.op('leave.assign', { employment: carla, policy: accr.policy.id, effective_from: '2026-02-02', note: 'Accrual instead of front-loading' }, { as: HR });
const caL = (await api.op('leave.ledger', { employment: carla, type: 'sick_ca' }, O)).rows;
const wRows = caL.filter((r) => r.key.startsWith('W:'));
const gRows = caL.filter((r) => r.key.startsWith('G:'));
ok(wRows.length >= 8 && wRows.every((r) => r.amount > 0 && r.amount < 6), 'monthly accrual rows from worked hours', wRows.map((r) => r.amount));
near(gRows.reduce((s, r) => s + r.amount, 0), 0, 'the front-loaded 40 hours were taken back by a correction');
const caB = await avail(carla, 'sick_ca');
near(caB.balance, wRows.reduce((s, r) => s + r.amount, 0), 'balance = hours accrued');

section('a policy change in the middle of the year (proration and corrections)');
const nurul = (await api.op('people.get', { employee: 'E0006' }, O)).primary_employment;
const n0 = (await avail(nurul, 'annual')).balance;
near(n0, 16, 'Nurul: 10 days (3 years), 5 carried, 1 from the company anniversary (t02)');
const sgPol = (await api.op('leave.policies', { entity: sg.id }, O)).policies.find((p) => p.is_default);
const senior = await api.op('leave.policy-save', { name: 'Singapore senior', entity: sg.id, period_start: '01-01', rules: sgPol.rules.map((r) => (r.type === 'annual' ? { type: 'annual', method: 'fixed', amount: 20, proration: 'join', rounding: 'half', expiry: 'period', carryover_max: 5, carryover_expiry_months: 12 } : r)) }, { as: HR });
await api.op('leave.assign', { employment: nurul, policy: senior.policy.id, effective_from: '2026-07-01', note: 'Promoted' }, { as: HR });
const n1 = await avail(nurul, 'annual');
near(n1.balance, n0 - 10 + 5 + 10, 'half a year of 10, half a year of 20, plus the carry-over');
const nType = n1.type_id;
const nSum = await tr('ledgerSum', { employment: nurul, type: nType, day: today });
near(nSum.n, n1.balance, 'the corrections keep the ledger equal to the balance');
const nRows = (await api.op('leave.ledger', { employment: nurul, type: 'annual' }, O)).rows;
ok(nRows.some((r) => r.key.startsWith('G:2026-01-01:') && r.amount === -5 && r.note.indexOf('correction') >= 0), 'the old grant got a correcting row', nRows.slice(0, 6));
const nExplain = await api.op('leave.balance', { employment: nurul, type: 'annual' }, O);
ok(nExplain.explain.filter((l) => l.kind === 'grant').map((l) => l.amount).sort().join(',') === '1,10,5', 'the explanation shows both half-year grants and the extra day', nExplain.explain.filter((l) => l.kind === 'grant'));

section('negative balances');
const annualSg = (await api.op('leave.types', { entity: sg.id }, O)).types.find((t) => t.code === 'annual');
await api.op('leave.types-save', { type: annualSg.id, allow_negative: true, max_negative: 3 }, { as: HR });
const sitiA = (await avail(siti, 'annual')).available;
const d1 = '2026-11-23';
let end = d1;
const addDays = (d, n) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + n)).toISOString().slice(0, 10);
let c = null;
for (let i = 0; i < 40; i++) {
  c = await api.op('leave.check', { employment: siti, type: 'annual', start: d1, end }, O);
  if (c.amount >= sitiA + 2) break;
  end = addDays(end, 1);
}
ok(c.warnings.every((w) => w.code !== 'balance'), 'two below zero is allowed (limit 3)', c.warnings);
let end2 = end;
for (let i = 0; i < 10; i++) {
  end2 = addDays(end2, 1);
  c = await api.op('leave.check', { employment: siti, type: 'annual', start: d1, end: end2 }, O);
  if (c.amount >= sitiA + 4) break;
}
ok(c.warnings.some((w) => w.code === 'balance'), 'four below zero is not', c.warnings);
await api.op('leave.types-save', { type: annualSg.id, allow_negative: false, max_negative: 0 }, { as: HR });

section('the contract and the run agree');
for (const [emp, type] of [[gina, 'annual'], [aaron, 'annual'], [mira, 'annual'], [kaito, 'annual'], [carla, 'sick_ca']]) {
  const bv = await avail(emp, type);
  const b = await tr('balance', { employment: emp, type, day: bv.day });
  const s = await tr('ledgerSum', { employment: emp, type: bv.type_id, day: bv.day });
  // Progressive accrual (Australia): the month in progress is in the balance, written to the ledger when it ends.
  const open = emp === aaron ? r2(accrued(20) - r2((20 * monthsDone) / 12)) : 0;
  near(r2(s.n + open), b.balance, 'ledger sum' + (open ? ' + this month so far' : '') + ' = balance for ' + type + ' ' + emp);
}

done('t03 engine');
