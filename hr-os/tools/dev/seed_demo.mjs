/**
 * Demo company "Northwind Global", built only through operations, on an
 * EMPTY scratch database (refuses otherwise):
 *
 *   node tools/dev/seed_demo.mjs --port 3181 [--app <scratch app dir>]
 *
 * Four entities (Northwind Pte Ltd SG, Northwind Inc US-CA, Northwind KK
 * JP-Tokyo, Northwind India Pvt Ltd IN-MH), departments, locations, job
 * titles, 24 people with job, pay and tax records and managers, and the
 * members below. Every password is demo-pass-1 and every PIN 123456.
 *
 *   owner@northwind.test     Owner (Alex Tan)
 *   hr@northwind.test        HR administrator (Priya Raman)
 *   payroll@northwind.test   Payroll administrator (Daniel Koh)
 *   eng.lead@northwind.test  Manager (Mei Lin Chua, Engineering)
 *   sales.lead@northwind.test Manager (Jordan Reyes, Sales US)
 *   sam@northwind.test       Employee (Sam Wong, SG)
 *   haruto@northwind.test    Employee (Haruto Sato, JP)
 *   ananya@northwind.test    Employee (Ananya Iyer, IN)
 *
 * Tax profile fields come from the default values of the packs each entity
 * enables (pb/pb_hooks/packs/*.js profile_fields), so the demo matches the
 * packs that are installed.
 *
 * Payroll is ready to demo: everyone has an approved bank account in the
 * country's format (sealed; approved with the PIN by the payroll administrator,
 * or the owner for his own), Japan's prefecture and standard monthly
 * remuneration are set, tax packs are limited to the active ones, the packs'
 * employer fields hold their defaults (and demo values where a pack has none),
 * and every entity has a locked October 2026 run (history and variance; the
 * demo company starts HR OS in October and confirms nobody was paid earlier
 * this tax year, so the first run needs no opening balances). The
 * current run of every entity calculates with zero blockers. Sam has a new
 * account waiting for approval in the Inbox.
 */
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { client, DEMO } from './api.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const app = arg('app', join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const api = client({ port: Number(arg('port', process.env.HR_PORT ?? 3181)), app });
const require = createRequire(import.meta.url);
const OWNER = { as: 'owner' };
const PIN = { as: 'owner', pin: true };

const st = await api.op('setup.status');
if (!st.needs_setup) {
  console.error('This database is already set up; seed_demo runs on an empty scratch database only (tools/dev/reset.sh first).');
  process.exit(1);
}

/** Default profile fields of the packs a list of pack codes names. */
const packsDir = join(app, 'pb', 'pb_hooks', 'packs');
const packDefaults = (codes) => {
  const out = {};
  if (!existsSync(packsDir)) return out;
  for (const f of readdirSync(packsDir).filter((n) => n.endsWith('.js'))) {
    let pack;
    try {
      pack = require(join(packsDir, f));
    } catch {
      continue;
    }
    if (!pack || !codes.includes(pack.code)) continue;
    for (const fld of pack.profile_fields ?? []) {
      if (fld.scope === 'entity') continue;
      if (fld.default !== undefined && out[fld.key] === undefined) out[fld.key] = fld.default;
    }
  }
  return out;
};

const t0 = Date.now();
await api.op('setup.complete', {
  company_name: 'Northwind Global',
  entity_name: 'Northwind Pte Ltd',
  legal_name: 'Northwind Pte. Ltd.',
  country: 'SG',
  reporting_currency: 'USD',
  owner_name: 'Alex Tan',
  email: DEMO.owner,
  password: DEMO.password,
  pin: DEMO.pin,
});
const sg = (await api.op('entities.list', {}, OWNER)).entities[0];
await api.op('entities.update', { entity: sg.id, code: 'SG01', tax_ids: { UEN: '201912345K' }, address: { line1: '1 Raffles Place', city: 'Singapore', postcode: '048616', country: 'SG' } }, OWNER);
const us = (await api.op('entities.add', { name: 'Northwind Inc', code: 'US01', legal_name: 'Northwind, Inc.', country: 'US', region: 'CA', timezone: 'America/Los_Angeles', tax_ids: { EIN: '12-3456789' }, address: { line1: '500 Market St', city: 'San Francisco', region: 'CA', postcode: '94105', country: 'US' } }, OWNER)).entity;
const jp = (await api.op('entities.add', { name: 'Northwind KK', code: 'JP01', legal_name: 'Northwind Kabushiki Kaisha', country: 'JP', region: '13', address: { line1: '1-1 Marunouchi', city: 'Chiyoda-ku, Tokyo', postcode: '100-0005', country: 'JP' } }, OWNER)).entity;
const ind = (await api.op('entities.add', { name: 'Northwind India Pvt Ltd', code: 'IN01', legal_name: 'Northwind India Private Limited', country: 'IN', region: 'MH', tax_ids: { TAN: 'MUMN12345A' }, address: { line1: 'Bandra Kurla Complex', city: 'Mumbai', region: 'MH', postcode: '400051', country: 'IN' } }, OWNER)).entity;
const ents = { SG: sg, US: us, JP: jp, IN: ind };

const loc = {};
loc.SG = (await api.op('locations.add', { entity: sg.id, name: 'Singapore HQ', lat: 1.2840, lng: 103.8510, radius_m: 150 }, OWNER)).location;
loc.US = (await api.op('locations.add', { entity: us.id, name: 'San Francisco', lat: 37.7897, lng: -122.3972, radius_m: 150 }, OWNER)).location;
loc.JP = (await api.op('locations.add', { entity: jp.id, name: 'Tokyo Office', lat: 35.6812, lng: 139.7671, radius_m: 150 }, OWNER)).location;
loc.IN = (await api.op('locations.add', { entity: ind.id, name: 'Mumbai', lat: 19.0660, lng: 72.8650, radius_m: 200 }, OWNER)).location;

const dept = {};
for (const [k, name, code] of [['lead', 'Leadership', 'LEAD'], ['eng', 'Engineering', 'ENG'], ['sales', 'Sales', 'SALES'], ['ops', 'Operations', 'OPS'], ['people', 'People and Finance', 'PF']]) dept[k] = (await api.op('departments.add', { name, code }, OWNER)).department;

const titles = ['Chief Executive Officer', 'Engineering Manager', 'Software Engineer', 'Senior Software Engineer', 'Sales Manager', 'Account Executive', 'Operations Lead', 'Operations Associate', 'HR Manager', 'Payroll Specialist', 'Customer Success Manager', 'Country Manager'];
for (const t of titles) await api.op('titles.add', { name: t, family: t.includes('Engineer') ? 'Engineering' : t.includes('Sales') || t.includes('Account') ? 'Sales' : 'Business' }, OWNER);

// 24 people: [key, country, legal name, family, given, name order, preferred, title, dept, manager key, pay amount, pay per, start, birth, gender, work email]
const P = [
  ['ceo', 'SG', 'Alex Tan Wei Ming', 'Tan', 'Wei Ming Alex', 'family_first', 'Alex Tan', 'Chief Executive Officer', 'lead', '', '28000.00', 'month', '2021-03-01', '1979-06-12', 'male', 'owner@northwind.test'],
  ['hr', 'SG', 'Priya Raman', 'Raman', 'Priya', 'given_first', '', 'HR Manager', 'people', 'ceo', '9800.00', 'month', '2022-01-10', '1987-02-03', 'female', 'hr@northwind.test'],
  ['payroll', 'SG', 'Daniel Koh Jun Jie', 'Koh', 'Jun Jie Daniel', 'family_first', 'Daniel Koh', 'Payroll Specialist', 'people', 'hr', '7200.00', 'month', '2022-05-16', '1990-11-21', 'male', 'payroll@northwind.test'],
  ['eng', 'SG', 'Chua Mei Lin', 'Chua', 'Mei Lin', 'family_first', 'Mei Lin Chua', 'Engineering Manager', 'eng', 'ceo', '15500.00', 'month', '2021-06-01', '1985-08-30', 'female', 'eng.lead@northwind.test'],
  ['sam', 'SG', 'Sam Wong Kai Xiang', 'Wong', 'Kai Xiang Sam', 'family_first', 'Sam Wong', 'Software Engineer', 'eng', 'eng', '7800.00', 'month', '2023-02-01', '1996-04-14', 'male', 'sam@northwind.test'],
  ['sg6', 'SG', 'Nurul Huda binte Ahmad', 'Ahmad', 'Nurul Huda', 'given_first', 'Nurul Huda', 'Senior Software Engineer', 'eng', 'eng', '10200.00', 'month', '2022-09-05', '1991-12-01', 'female', 'nurul@northwind.test'],
  ['sg7', 'SG', 'Rajesh Kumar s/o Muthu', 'Muthu', 'Rajesh Kumar', 'given_first', 'Rajesh Kumar', 'Operations Lead', 'ops', 'ceo', '8600.00', 'month', '2021-11-15', '1983-03-19', 'male', 'rajesh@northwind.test'],
  ['sg8', 'SG', 'Lim Hui Min', 'Lim', 'Hui Min', 'family_first', 'Hui Min Lim', 'Operations Associate', 'ops', 'sg7', '4300.00', 'month', '2024-07-01', '1999-09-09', 'female', 'huimin@northwind.test'],
  ['sales', 'US', 'Jordan Reyes', 'Reyes', 'Jordan', 'given_first', '', 'Sales Manager', 'sales', 'ceo', '165000.00', 'year', '2022-03-14', '1986-01-25', 'nonbinary', 'sales.lead@northwind.test'],
  ['us2', 'US', 'Emily Carter', 'Carter', 'Emily', 'given_first', '', 'Account Executive', 'sales', 'sales', '98000.00', 'year', '2023-04-03', '1994-05-17', 'female', 'emily@northwind.test'],
  ['us3', 'US', 'Marcus Johnson', 'Johnson', 'Marcus', 'given_first', '', 'Account Executive', 'sales', 'sales', '95000.00', 'year', '2024-01-08', '1992-10-02', 'male', 'marcus@northwind.test'],
  ['us4', 'US', 'Sofia Martinez', 'Martinez', 'Sofia', 'given_first', '', 'Customer Success Manager', 'sales', 'sales', '88000.00', 'year', '2023-08-21', '1990-07-28', 'female', 'sofia@northwind.test'],
  ['us5', 'US', 'Ethan Brooks', 'Brooks', 'Ethan', 'given_first', '', 'Senior Software Engineer', 'eng', 'eng', '182000.00', 'year', '2022-10-17', '1988-02-11', 'male', 'ethan@northwind.test'],
  ['us6', 'US', 'Grace Kim', 'Kim', 'Grace', 'given_first', '', 'Operations Associate', 'ops', 'sg7', '32.50', 'hour', '2025-02-03', '2000-12-05', 'female', 'grace@northwind.test'],
  ['jpm', 'JP', 'Takahashi Kenji', 'Takahashi', 'Kenji', 'family_first', 'Kenji Takahashi', 'Country Manager', 'lead', 'ceo', '1150000', 'month', '2022-04-01', '1978-04-08', 'male', 'kenji@northwind.test'],
  ['haruto', 'JP', 'Sato Haruto', 'Sato', 'Haruto', 'family_first', 'Haruto Sato', 'Software Engineer', 'eng', 'eng', '520000', 'month', '2024-04-01', '1997-06-30', 'male', 'haruto@northwind.test'],
  ['jp3', 'JP', 'Suzuki Yui', 'Suzuki', 'Yui', 'family_first', 'Yui Suzuki', 'Account Executive', 'sales', 'jpm', '430000', 'month', '2023-04-01', '1995-03-03', 'female', 'yui@northwind.test'],
  ['jp4', 'JP', 'Watanabe Ren', 'Watanabe', 'Ren', 'family_first', 'Ren Watanabe', 'Operations Associate', 'ops', 'jpm', '350000', 'month', '2025-04-01', '2001-01-15', 'male', 'ren@northwind.test'],
  ['jp5', 'JP', 'Ito Aoi', 'Ito', 'Aoi', 'family_first', 'Aoi Ito', 'Customer Success Manager', 'sales', 'jpm', '480000', 'month', '2022-10-01', '1989-11-11', 'female', 'aoi@northwind.test'],
  ['inm', 'IN', 'Vikram Mehta', 'Mehta', 'Vikram', 'given_first', '', 'Engineering Manager', 'eng', 'eng', '450000.00', 'month', '2022-07-01', '1984-09-14', 'male', 'vikram@northwind.test'],
  ['ananya', 'IN', 'Ananya Iyer', 'Iyer', 'Ananya', 'given_first', '', 'Software Engineer', 'eng', 'inm', '140000.00', 'month', '2024-06-03', '1998-08-08', 'female', 'ananya@northwind.test'],
  ['in3', 'IN', 'Rohan Desai', 'Desai', 'Rohan', 'given_first', '', 'Senior Software Engineer', 'eng', 'inm', '230000.00', 'month', '2023-01-16', '1993-05-22', 'male', 'rohan@northwind.test'],
  ['in4', 'IN', 'Kavya Nair', 'Nair', 'Kavya', 'given_first', '', 'Payroll Specialist', 'people', 'payroll', '95000.00', 'month', '2023-09-11', '1996-02-27', 'female', 'kavya@northwind.test'],
  ['in5', 'IN', 'Arjun Singh', 'Singh', 'Arjun', 'given_first', '', 'Operations Associate', 'ops', 'sg7', '62000.00', 'month', '2026-12-01', '2002-07-04', 'male', 'arjun@northwind.test'],
];
const NAT = { SG: 'SG', US: 'US', JP: 'JP', IN: 'IN' };
const emp = {};
const KANA = {"jpm": ["タカハシ", "ケンジ"], "haruto": ["サトウ", "ハルト"], "jp3": ["スズキ", "ユイ"], "jp4": ["ワタナベ", "レン"], "jp5": ["イトウ", "アオイ"]};
for (const [key, cc, legal, family, given, order, pref, title, dk, mgr, amount, per, start, birth, gender, email] of P) {
  const ent = ents[cc];
  const out = await api.op(
    'people.hire',
    {
      entity: ent.id,
      legal_name: legal,
      preferred_name: pref,
      family_name: family,
      given_name: given,
      name_order: order,
      kana: KANA[key] ? { family: KANA[key][0], given: KANA[key][1] } : undefined,
      birth_date: birth,
      gender,
      nationality: NAT[cc],
      work_email: email,
      phone: cc === 'SG' ? '+65 9000 00' + String(Object.keys(emp).length).padStart(2, '0') : cc === 'US' ? '+1 415 555 01' + String(Object.keys(emp).length).padStart(2, '0') : cc === 'JP' ? '+81 90 0000 00' + String(Object.keys(emp).length).padStart(2, '0') : '+91 98200 000' + String(Object.keys(emp).length).padStart(2, '0'),
      start_day: start,
      title,
      job_title: title,
      department: dept[dk].id,
      location: loc[cc].id,
      manager: mgr === '' ? '' : emp[mgr].employee.id,
      pay_basis: per === 'hour' ? 'hourly' : 'salary',
      pay_amount: amount,
      pay_per: per,
      tax_fields: packDefaults(ent.packs),
      probation_end: start >= '2026-06-01' ? start.slice(0, 5) + String(Math.min(12, Number(start.slice(5, 7)) + 3)).padStart(2, '0') + '-01' : '',
    },
    OWNER,
  );
  emp[key] = out;
}
// Department heads and approvers.
await api.op('departments.update', { department: dept.eng.id, head: emp.eng.employee.id, approver: emp.eng.employee.id }, OWNER);
await api.op('departments.update', { department: dept.sales.id, head: emp.sales.employee.id, approver: emp.sales.employee.id }, OWNER);
await api.op('departments.update', { department: dept.people.id, head: emp.hr.employee.id, approver: emp.hr.employee.id }, OWNER);
await api.op('departments.update', { department: dept.lead.id, head: emp.ceo.employee.id }, OWNER);
await api.op('departments.update', { department: dept.ops.id, head: emp.sg7.employee.id, approver: emp.sg7.employee.id }, OWNER);
// The owner is the CEO.
const ownerMember = (await api.op('auth.me', {}, OWNER)).member;
await api.op('members.update', { member: ownerMember.id, employee: emp.ceo.employee.id }, PIN);
// A raise scheduled for next year and a promotion in the past (history to look at).
await api.op('pay.update', { employment: emp.sam.employment.id, effective_from: '2027-01-01', reason: 'raise', amount: '8400.00' }, OWNER);
await api.op('job.update', { employment: emp.sg6.employment.id, effective_from: '2024-09-01', reason: 'promotion', title: 'Senior Software Engineer' }, OWNER);

// Members: invite, accept, set the PIN.
const members = [
  ['hr@northwind.test', 'Priya Raman', 'hr_admin', 'hr'],
  ['payroll@northwind.test', 'Daniel Koh', 'payroll_admin', 'payroll'],
  ['eng.lead@northwind.test', 'Mei Lin Chua', 'manager', 'eng'],
  ['sales.lead@northwind.test', 'Jordan Reyes', 'manager', 'sales'],
  ['sam@northwind.test', 'Sam Wong', 'employee', 'sam'],
  ['haruto@northwind.test', 'Haruto Sato', 'employee', 'haruto'],
  ['ananya@northwind.test', 'Ananya Iyer', 'employee', 'ananya'],
];
for (const [email, name, role, key] of members) {
  const inv = await api.op('members.invite', { email, name, role, employee: emp[key].employee.id }, PIN);
  const joined = await api.op('auth.accept-invite', { email, code: inv.code, password: DEMO.password });
  api.setToken(email, joined.token);
  await api.op('pin.set', { password: DEMO.password, new_pin: DEMO.pin }, { as: email });
}
/* ------------------------------------------------ payroll-ready demo */
// Every pay run of the demo calculates without blockers: approved bank accounts in each
// country's format, complete tax profiles (Japan's prefecture and standard monthly
// remuneration; tax packs limited to the active ones), the packs' employer fields, and a
// locked October run per entity (variance and history), run as the payroll administrator.
const PAYA = { as: 'payroll@northwind.test' };
const PAYP = { as: 'payroll@northwind.test', pin: true };
const hasPayroll = (await api.call('payruns.next', {}, PAYA)).status === 200;

// Bank accounts (demo numbers): people with an account add their own, HR adds the rest.
const BANK = {
  SG: { bank_name: 'DBS Bank', bank_code: '7171', branch_code: '001', account_type: 'savings', digits: 10 },
  US: { bank_name: 'JPMorgan Chase Bank', bank_code: '021000021', account_type: 'checking', digits: 12, swift: 'CHASUS33' },
  JP: { bank_name: 'MUFG Bank', bank_code: '0005', branch_code: '001', account_type: 'futsu', digits: 7 },
  IN: { bank_name: 'HDFC Bank', bank_code: 'HDFC0000123', account_type: 'savings', digits: 14 },
};
const selfAdds = { payroll: 'payroll@northwind.test', hr: 'hr@northwind.test' };
let n = 0;
for (const [key, cc, legal] of P) {
  n++;
  const b = BANK[cc];
  const number = String(7000000000000000 + n * 104729).slice(-b.digits);
  const holder = cc === 'JP' && KANA[key] ? KANA[key][0] + ' ' + KANA[key][1] : legal;
  await api.op('bank.add', { employee: emp[key].employee.id, number, bank_name: b.bank_name, bank_code: b.bank_code, branch_code: b.branch_code || '', account_type: b.account_type, holder, swift: b.swift || '' }, { as: selfAdds[key] || 'hr@northwind.test' });
}
// Approve them as the approvers would (with the PIN): the payroll administrator, or the owner
// for the payroll administrator's own; every step of a flow until it is decided.
async function approveAll(id, note) {
  for (let step = 0; step < 6; step++) {
    const a = (await api.op('approvals.get', { approval: id }, OWNER)).approval;
    if (!a || a.status !== 'pending') return;
    let done = false;
    for (const who of [PAYP, PIN, { as: 'hr@northwind.test', pin: true }]) {
      const r = await api.call('approvals.decide', { approval: id, decision: 'approved', note }, who);
      if (r.status < 400) {
        done = true;
        break;
      }
    }
    if (!done) throw new Error('Nobody could approve ' + id);
  }
}
for (const a of (await api.op('approvals.list', { view: 'all', status: 'pending', kind: 'bank_account', limit: 100 }, OWNER)).approvals) await approveAll(a.id, 'Checked against the bank letter (demo)');

if (hasPayroll) {
  // Tax profiles: only active packs (India's Maharashtra professional tax pack ships as a draft);
  // Japan needs the prefecture and the standard monthly remuneration (標準報酬月額) grade of the pay.
  const active = new Set((await api.op('packs.list', {}, PAYA)).packs.filter((p) => p.status === 'active').map((p) => p.code));
  const SMR = { 1150000: 1150000, 520000: 530000, 430000: 440000, 350000: 360000, 480000: 470000 };
  for (const row of P) {
    const [key, cc] = row;
    const amount = row[10];
    const m = emp[key].employment.id;
    const ent = ents[cc];
    const packs = ent.packs.filter((c) => active.has(c));
    const fields = cc === 'JP' ? { jp_prefecture: '13', jp_smr: SMR[Number(amount)] || 530000 } : cc === 'IN' ? { in_regime: 'new' } : {};
    if (packs.length !== ent.packs.length || Object.keys(fields).length > 0) await api.op('taxprofile.submit', { employment: m, effective_from: row[12], packs: packs, fields: fields, note: packs.length !== ent.packs.length ? 'Demo: draft packs left out until a person activates them' : 'Demo profile' }, PAYA);
  }
  // Employer fields with no pack default (demo values): India's EPF administrative charges at 0.5 percent of PF wages.
  const DEMO_ENTITY_FIELDS = { in_pf_admin_rate: 0.005 };
  // Employer fields of the packs (US state unemployment rate and wage base and the like): the packs' defaults, marked as demo values.
  for (const ent of Object.values(ents)) {
    const ef = (await api.op('payroll.fields', { entity: ent.id, scope: 'entity' }, PAYA)).fields || [];
    const values = {};
    for (const f of ef) if (f.default !== undefined && f.default !== null) values[f.key] = f.default;
    for (const f of ef) if (values[f.key] === undefined && DEMO_ENTITY_FIELDS[f.key] !== undefined) values[f.key] = DEMO_ENTITY_FIELDS[f.key];
    if (Object.keys(values).length > 0) await api.op('payroll.settings-save', { entity: ent.id, entity_fields: values, note: "Demo values: the packs' defaults (new-employer rates and wage bases). Replace them with the rates on your own notices." }, { as: 'payroll@northwind.test' });
  }
  // October 2026 for every entity: calculate, acknowledge warnings, submit, approve, lock with the PIN.
  const runCalc = async (id) => {
    let c = await api.op('payruns.calculate', { payrun: id }, PAYA);
    for (let i = 0; i < 60 && !c.done; i++) c = await api.op('payruns.calculate', { payrun: id, continue: true }, PAYA);
  };
  // HR OS starts in October: the demo has no earlier payroll to bring in (a person confirms it, never your AI agent).
  for (const ent of Object.values(ents)) await api.op('ytd.no-earlier-pay', { entity: ent.id, on: true }, PAYA);
  for (const s of (await api.op('payruns.next', {}, PAYA)).next) {
    const oct = (await api.op('payruns.create', { kind: 'regular', schedule: s.schedule, period_start: '2026-10-01', note: 'Demo history' }, PAYA)).payrun;
    await runCalc(oct.id);
    const blockers = ((await api.op('payruns.issues', { payrun: oct.id, severity: 'blocker' }, PAYA)).issues || []).length;
    if (blockers > 0) throw new Error(s.entity_name + ' October run has ' + blockers + ' blockers');
    await api.call('payruns.acknowledge', { payrun: oct.id, reason: 'reviewed_ok', note: 'Demo history: warnings reviewed' }, PAYA);
    const sub = await api.op('payruns.submit', { payrun: oct.id }, PAYA);
    const ap = sub.approval || (sub.payrun && sub.payrun.approval) || null;
    const apId = typeof ap === 'string' ? ap : ap && ap.id;
    if (apId) await approveAll(apId, 'Demo history');
    await api.op('payruns.lock', { payrun: oct.id }, PAYP);
  }
}

// Sam moves his salary to a new account himself: it waits in the Inbox for a payroll
// administrator's approval (his approved account keeps being paid until then).
await api.op('bank.add', { employee: emp.sam.employee.id, number: '1234567890', label: 'New salary account', bank_name: 'DBS Bank', bank_code: '7171', branch_code: '001', account_type: 'savings', holder: 'Sam Wong Kai Xiang' }, { as: 'sam@northwind.test' });

const status = await api.op('app.status', {}, OWNER);
let runs = '';
if (hasPayroll) {
  const all = (await api.op('payruns.list', { limit: 50 }, PAYA)).payruns || [];
  runs = all.map((r) => '\n  ' + r.entity_name + ' ' + r.number + ' ' + r.period_start + ' ' + r.status).join('');
}
console.log(`Seeded Northwind Global in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${status.counts.entities} entities, ${status.counts.employees} people, ${status.counts.members} members, ${status.counts.approvals_pending} approvals waiting. Sign in as ${DEMO.owner} / ${DEMO.password} (PIN ${DEMO.pin}).${runs}`);
