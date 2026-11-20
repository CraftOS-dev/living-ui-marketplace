// QA t02: a day in the life per country on the demo seed (tools/dev/seed_demo.mjs)
// plus three entities made here (MY, GB, AU). For each: hire through
// people.hire with the country's tax profile, clock in and out, request and
// approve leave, a claim with a receipt (read by your AI agent through the
// job queue), the regular November 2026 run (calculate, issues, approve, lock
// with the PIN), every statutory and employer line of two payslips against
// hand.mjs, publish, the country's bank file (record format checked), filings,
// one year-end document, an off-cycle bonus, void and replace, a termination
// with final pay.
//
//   QA_APP=<qa/app2> QA_PORT=3192 node t02_countries.mjs [SG US JP IN MY GB AU]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newApi, section, ok, eq, summary, writeResult, note, DEMO, O, AG, APP } from './lib.mjs';
import * as H from './hand.mjs';

const api = newApi();
const PAY = { as: 'payroll@northwind.test' };
const PAYPIN = { as: 'payroll@northwind.test', pin: true };
const HR = { as: 'hr@northwind.test' };
const MGR = 'eng.lead@northwind.test';
const only = process.argv.slice(2).filter((a) => /^[A-Z]{2}$/.test(a));
const results = {};
const RECEIPT = readFileSync(join(APP, 'reference', 'tests', 'expenses', 'fixtures', 'lunch.png'));

/* ------------------------------------------------------------- helpers */

async function upload(name, fields, files, as) {
  await api.op('auth.me', {}, { as });
  const token = api.tokens.get(as === 'owner' ? DEMO.owner : as);
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields || {})) if (v !== undefined && v !== null) fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  for (const [k, f] of Object.entries(files || {})) fd.append(k, new Blob([f.data], { type: f.type }), f.name);
  let res;
  for (let i = 0; i < 10; i++) {
    res = await fetch(api.base + '/api/ops/' + name.replace('.', '/'), { method: 'POST', headers: { authorization: token, accept: 'application/json' }, body: fd });
    if (res.status !== 429) break;
    await res.text();
    await new Promise((r) => setTimeout(r, 600));
  }
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function download(name, params, as) {
  await api.op('auth.me', {}, { as });
  const token = api.tokens.get(as === 'owner' ? DEMO.owner : as);
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(api.base + '/api/ops/' + name.replace('.', '/') + '?' + qs, { headers: { authorization: token } });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, buf, type: res.headers.get('content-type') };
}

/** Run fn as a named step: failures are recorded and the country goes on. */
async function step(cc, name, fn) {
  try {
    const v = await fn();
    return v;
  } catch (err) {
    ok(false, cc + ' ' + name + ' threw: ' + (err.status ? err.status + ' ' : '') + (err.code ? err.code + ' ' : '') + String(err.message).slice(0, 300));
    note('step_failed', { cc, step: name, status: err.status, code: err.code, message: String(err.message).slice(0, 600), data: err.body && err.body.data });
    return undefined;
  }
}

async function decideAny(id, decision, order) {
  let last = null;
  for (const as of order || [MGR, 'payroll@northwind.test', 'owner', 'hr@northwind.test']) {
    const r = await api.call('approvals.decide', { approval: id, decision, note: 'QA' }, { as, pin: true });
    if (r.status < 400) return { as, body: r.body };
    last = { as, status: r.status, body: r.body };
  }
  const e = new Error('nobody could decide ' + id + ': ' + JSON.stringify(last).slice(0, 300));
  e.body = last;
  throw e;
}

/** Decide every step of an approval until it is no longer pending. */
async function approveAll(id, order) {
  const who = [];
  for (let i = 0; i < 6; i++) {
    const a = (await api.op('approvals.get', { approval: id }, O)).approval;
    if (a.status !== 'pending') return { status: a.status, who };
    const d = await decideAny(id, 'approved', order);
    who.push(d.as);
  }
  return { status: 'pending', who };
}

async function calcRun(runId) {
  let r = await api.op('payruns.calculate', { payrun: runId }, PAY);
  for (let i = 0; i < 80 && !r.done; i++) r = await api.op('payruns.calculate', { payrun: runId, continue: true }, PAY);
  return r;
}

/** Calculate, acknowledge warnings, submit, approve (not the preparer), lock with the PIN. */
async function runToLock(cc, runId, label) {
  const t0 = Date.now();
  await calcRun(runId);
  const ms = Date.now() - t0;
  const iss = await api.op('payruns.issues', { payrun: runId }, PAY);
  const blockers = iss.issues.filter((i) => i.severity === 'blocker');
  ok(blockers.length === 0, cc + ' ' + label + ': no blockers after calculate (' + ms + ' ms)', blockers.slice(0, 5).map((b) => b.code + ' ' + (b.employee_name || b.number || '') + ': ' + b.message));
  if (blockers.length > 0) {
    note('blockers', { cc, label, run: runId, blockers: blockers.slice(0, 12) });
    return { ok: false, blockers, ms, warnings: iss.issues.filter((i) => i.severity !== 'blocker') };
  }
  const warnings = iss.issues.filter((i) => i.severity !== 'blocker');
  if (warnings.length > 0) await api.op('payruns.acknowledge', { payrun: runId, reason: 'reviewed_ok', note: 'QA checked' }, PAY);
  const sub = await api.op('payruns.submit', { payrun: runId }, PAY);
  const ap = sub.approval ? await approveAll(sub.approval.id, ['owner', 'hr@northwind.test']) : { status: 'none' };
  ok(ap.status === 'approved', cc + ' ' + label + ': approved by ' + (ap.who || []).join(', '), ap);
  const self = await api.call('approvals.decide', { approval: sub.approval && sub.approval.id, decision: 'approved' }, PAYPIN);
  void self;
  const lock = await api.op('payruns.lock', { payrun: runId }, PAYPIN);
  ok(lock.payrun && lock.payrun.status === 'locked', cc + ' ' + label + ': locked with the PIN');
  return { ok: true, ms, warnings: warnings.map((w) => w.code) };
}

function linesByCode(slip) {
  const out = {};
  for (const g of slip.groups) for (const l of g.lines) out[l.code] = (out[l.code] || 0) + l.amount_minor;
  return out;
}

async function slipOf(runId, number) {
  const got = await api.op('payruns.get', { payrun: runId, limit: 500 }, PAY);
  const row = got.payslips.find((x) => x.number === number);
  if (!row) throw new Error('no payslip for ' + number + ' in run ' + runId + ' (' + got.payslips.map((p) => p.number).join(',') + ')');
  return (await api.op('payslips.get', { payslip: row.id }, PAY)).payslip;
}

/** Compare every statutory and employer line of a payslip with the hand calculation. */
function checkSlip(cc, who, slip, want, record) {
  const got = linesByCode(slip);
  const rows = [];
  for (const code of Object.keys(want)) {
    const g = got[code] || 0;
    const good = g === want[code];
    rows.push({ code, got: g, want: want[code], good });
    ok(good, cc + ' ' + who + ' ' + code + ' (got ' + g + ', hand ' + want[code] + ')');
    if (!good) note('wrong_number', { cc, who, code, got: g, want: want[code], payslip: slip.id });
  }
  const statutory = slip.groups.filter((g) => g.key === 'statutory' || g.key === 'employer').flatMap((g) => g.lines.map((l) => l.code));
  const unchecked = statutory.filter((c) => want[c] === undefined && (got[c] || 0) !== 0);
  ok(unchecked.length === 0, cc + ' ' + who + ': every non-zero statutory and employer line is hand checked', unchecked.map((c) => c + '=' + got[c]));
  record.push({ who, gross: slip.gross_minor, net: slip.net_minor, lines: got, rows, unchecked });
  return got;
}

function routingValid(r) {
  const d = r.split('').map(Number);
  return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0;
}

/** Record-format checks of the written bank file. */
function checkBankFile(cc, format, buf, count, totalMinor) {
  const text = buf.toString('latin1');
  const res = { format, bytes: buf.length };
  if (format === 'nacha_ppd') {
    const lines = text.split(/\r?\n/).filter((l) => l !== '');
    ok(lines.every((l) => l.length === 94), cc + ' NACHA: every record is 94 characters', lines.map((l) => l.length).filter((n) => n !== 94).slice(0, 3));
    ok(lines.length % 10 === 0, cc + ' NACHA: blocked to 10 records (' + lines.length + ')');
    ok(lines[0][0] === '1' && lines[1][0] === '5', cc + ' NACHA: file header 1 then batch header 5');
    const entries = lines.filter((l) => l[0] === '6');
    eq(entries.length, count, cc + ' NACHA: one entry detail (6) per person');
    ok(entries.every((l) => l.slice(1, 3) === '22' || l.slice(1, 3) === '32'), cc + ' NACHA: credit transaction codes 22/32');
    const sum = entries.reduce((s, l) => s + Number(l.slice(29, 39)), 0);
    eq(sum, totalMinor, cc + ' NACHA: entry amounts add up to the run net');
    const bc = lines.find((l) => l[0] === '8');
    eq(Number(bc.slice(20, 32)), 0, cc + ' NACHA: batch control debit total 0 (credits only)');
    eq(Number(bc.slice(32, 44)), totalMinor, cc + ' NACHA: batch control credit total');
const fc = lines.find((l) => l[0] === '9');
    eq(Number(fc.slice(31, 43)), 0, cc + ' NACHA: file control debit total 0');
    eq(Number(fc.slice(43, 55)), totalMinor, cc + ' NACHA: file control credit total');
    const hash = entries.reduce((s, l) => s + Number(l.slice(3, 11)), 0) % 1e10;
    eq(Number(bc.slice(10, 20)), hash, cc + ' NACHA: entry hash');
    res.records = lines.length;
  } else if (format === 'aba') {
    ok(/\r\n$/.test(text), cc + ' ABA: CRLF line ends');
    const lines = text.split('\r\n').filter((l) => l !== '');
    ok(lines.every((l) => l.length === 120), cc + ' ABA: every record is 120 characters', lines.map((l) => l.length));
    ok(lines[0][0] === '0' && lines[lines.length - 1][0] === '7', cc + ' ABA: descriptive record 0 first, file total 7 last');
    const det = lines.filter((l) => l[0] === '1');
    ok(det.length >= count, cc + ' ABA: detail records (' + det.length + ') for ' + count + ' people');
    const credits = det.filter((l) => l.slice(18, 20) === '53');
    eq(credits.reduce((s, l) => s + Number(l.slice(20, 30)), 0), totalMinor, cc + ' ABA: transaction code 53 (pay) amounts add up to the run net');
    ok(det.every((l) => /^\d{3}-\d{3}$/.test(l.slice(1, 8))), cc + ' ABA: BSB written as xxx-xxx');
    res.records = lines.length;
  } else if (format === 'zengin') {
    const recs = [];
    let i = 0;
    while (i < buf.length) {
      recs.push(buf.slice(i, i + 120));
      i += 120;
      while (i < buf.length && (buf[i] === 0x0d || buf[i] === 0x0a)) i++;
      if (i < buf.length && buf[i] === 0x1a) i++;
    }
    ok(recs.every((r) => r.length === 120), cc + ' Zengin: every record is 120 bytes');
    ok(recs[0][0] === 0x31 && recs[0].slice(1, 3).toString() === '11', cc + ' Zengin: header 1, kind 11 (salary)');
    const data = recs.filter((r) => r[0] === 0x32);
    eq(data.length, count, cc + ' Zengin: one data record (2) per person');
    eq(data.reduce((s, r) => s + Number(r.slice(80, 90).toString()), 0), totalMinor, cc + ' Zengin: amounts add up to the run net');
    ok(recs.some((r) => r[0] === 0x38) && recs.some((r) => r[0] === 0x39), cc + ' Zengin: trailer 8 and end 9');
    ok(data.every((r) => [...r.slice(50, 80)].every((b) => b === 0x20 || (b >= 0x20 && b <= 0x7e) || (b >= 0xa1 && b <= 0xdf))), cc + ' Zengin: names in half-width katakana (JIS X 0201)');
    res.records = recs.length;
  } else {
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    const cells = (l) => l.split(',').map((c) => c.replace(/^"|"$/g, '').trim());
    const headed = cells(lines[0]).some((c) => /amount/i.test(c));
    const rows = headed ? lines.slice(1) : lines;
    const col = headed ? cells(lines[0]).findIndex((c) => /amount/i.test(c)) : -1;
    const amountOf = (l) => {
      const cs = cells(l);
      const v = col >= 0 ? cs[col] : cs.find((c) => /^\d+\.\d{2}$/.test(c));
      return Math.round(Number(v || 0) * 100);
    };
    const sumCol = rows.reduce((a, l) => a + amountOf(l), 0);
    eq(sumCol, totalMinor, cc + ' ' + format + ': the amount column adds up to the run net');
    ok(rows.length >= count, cc + ' ' + format + ': a row per person (' + rows.length + ' for ' + count + ')');
    res.records = lines.length;
    res.header = lines[0];
  }
  return res;
}

/* --------------------------------------------------------- the countries */

const today = '2026-11-04';
const COUNTRIES = {
  SG: {
    entityName: 'Northwind Pte Ltd',
    hires: [{ key: 'A', legal_name: 'Tan Ah Kow', family_name: 'Tan', given_name: 'Ah Kow', name_order: 'family_first', birth_date: '1996-05-05', gender: 'male', nationality: 'SG', pay_amount: '6500.00', pay_per: 'month', tax_fields: { sg_residency: 'sc', sg_shg: 'cdac' } }],
    seeded: { number: 'E0008', name: 'Lim Hui Min' },
    hand: { A: () => H.sg(6500, 'cdac'), seeded: () => H.sg(4300, 'none') },
    bonus: { amount: '1000.00', want: { SG_CPF_EE: 20000, SG_CPF_ER: 17000, SG_SDL: 0, SG_SHG: 0 } },
    final: { seeded: true, days: (b0, b1) => b1.available },
    format: 'sg_giro_csv',
    payer: {},
    bank: (i) => ({ bank_code: '7171', branch_code: '081', number: '01230' + String(1000 + i), account_type: 'savings' }),
    doc: 'sg_ir8a',
  },
  US: {
    entityName: 'Northwind Inc',
    hires: [{ key: 'A', legal_name: 'Taylor Brooks', family_name: 'Brooks', given_name: 'Taylor', name_order: 'given_first', birth_date: '1990-03-03', gender: 'female', nationality: 'US', pay_amount: '120000.00', pay_per: 'year', tax_fields: { us_filing_status: 'single', ca_filing_status: 'single' } }],
    seeded: { number: 'E0011', name: 'Marcus Johnson' },
    hand: { A: () => H.us(10000), seeded: () => H.us(7916.67) },
    bonus: { amount: '1000.00', want: Object.assign(H.usBonus(1000), { US_SS_ER: 6200, US_MED_ER: 1450, US_FUTA: 0, US_CA_UI: 0, US_CA_ETT: 0, US_FIT: 0 }) },
    final: { seeded: true, days: () => 5 + Math.round(15 * 11.5 / 12 * 2) / 2 },
    format: 'nacha_ppd',
    payer: { nacha_ppd: { destination_routing: '021000021', destination_name: 'JPMORGAN CHASE', origin: '1123456789', origin_name: 'NORTHWIND INC', company_name: 'NORTHWIND INC', company_id: '1123456789', odfi_routing: '021000021' } },
    bank: (i) => ({ bank_code: ['011000015', '021000021', '121000358', '026009593'][i % 4], number: '4400' + String(10000 + i), account_type: 'checking' }),
    doc: 'us_w2',
  },
  JP: {
    entityName: 'Northwind KK',
    hires: [{ key: 'A', legal_name: 'Kobayashi Daiki', family_name: 'Kobayashi', given_name: 'Daiki', name_order: 'family_first', kana: { family: 'コバヤシ', given: 'ダイキ' }, birth_date: '1996-07-07', gender: 'male', nationality: 'JP', pay_amount: '400000', pay_per: 'month', tax_fields: { jp_prefecture: '13', jp_smr: 410000 } }],
    seeded: { number: 'E0017', name: 'Suzuki Yui' },
    hand: { A: () => H.jp(400000, 410000, 30, { noPremium: true }), seeded: () => H.jp(430000, 440000, 31) },
    bonus: { amount: '100000', want: { JP_HEALTH: 4925, JP_SUPPORT: 115, JP_PENSION: 9150, JP_EI: 500, JP_HEALTH_ER: 4925, JP_SUPPORT_ER: 115, JP_PENSION_ER: 9150, JP_EI_ER: 850, JP_WHT: 0, JP_CARE: 0 } },
    final: { seeded: true, want: () => H.jp(205652, 440000, 31), base: { JP_BASE: 205652 } },
    format: 'zengin',
    payer: { zengin: { consignor_code: '1234567890', consignor_kana: 'ノースウインド(カ', bank_code: '0005', branch_code: '001', account_type: 'ordinary', account: '1234567' } },
    bank: (i) => ({ bank_code: '0005', branch_code: String(100 + i).padStart(3, '0'), number: String(1234500 + i), account_type: 'futsu' }),
    doc: 'jp_gensen',
    smr: { 1150000: 1150000, 520000: 530000, 430000: 440000, 350000: 360000, 480000: 470000 },
  },
  IN: {
    entityName: 'Northwind India Pvt Ltd',
    hires: [{ key: 'A', legal_name: 'Neha Kapoor', family_name: 'Kapoor', given_name: 'Neha', name_order: 'given_first', birth_date: '1994-04-04', gender: 'female', nationality: 'IN', pay_amount: '300000.00', pay_per: 'month', tax_fields: { in_regime: 'new' }, tax_packs: ['in', 'in-epf', 'in-esi'] }],
    seeded: { number: 'E0020', name: 'Vikram Mehta' },
    hand: { A: () => Object.assign(H.ind(300000, 5), H.inEpf(300000)), seeded: () => Object.assign(H.ind(450000, 5), H.inEpf(450000)) },
    bonus: { amount: '50000.00', want: { IN_PF_EE: 0, IN_EPS_ER: 0, IN_EPF_ER: 0, IN_EDLI_ER: 0 }, atLeast: { IN_TDS: 780000 } },
    final: { seeded: true, days: (b0) => Math.round((b0.available + 15 / 12 + (15 / 12) * (15 / 31)) * 100) / 100 },
    format: 'in_neft_csv',
    payer: {},
    bank: (i) => ({ bank_code: 'HDFC0001' + String(100 + i), number: '5010012345' + String(10 + i), account_type: 'savings' }),
    doc: 'in_form16',
  },
  MY: {
    create: { name: 'Northwind Sdn Bhd', code: 'MY01', legal_name: 'Northwind Sdn. Bhd.', country: 'MY', region: '14' },
    entityFields: { my_hrdf_rate: '1' },
    hires: [
      { key: 'A', legal_name: 'Aisyah binti Rahman', family_name: 'Rahman', given_name: 'Aisyah', name_order: 'given_first', birth_date: '1992-02-02', gender: 'female', nationality: 'MY', pay_amount: '25000.00', pay_per: 'month', tax_fields: { my_resident: true, my_pcb_category: '1', my_malaysian: true }, tax_packs: ['my', 'my-hrdf'] },
      { key: 'B', legal_name: 'Lee Chong Wei', family_name: 'Lee', given_name: 'Chong Wei', name_order: 'family_first', birth_date: '1988-08-08', gender: 'male', nationality: 'MY', pay_amount: '20000.00', pay_per: 'month', tax_fields: { my_resident: true, my_pcb_category: '1', my_malaysian: true }, tax_packs: ['my', 'my-hrdf'] },
    ],
    hand: { A: () => H.my(25000, 11, { hrdf: true }), B: () => H.my(20000, 11, { hrdf: true }) },
    bonus: { amount: '5000.00', want: { MY_PCB: 30000, MY_HRDF_ER: 0 } },
    final: { days: () => Math.round(8 * 1.5 / 12) },
    format: 'my_maybank_csv',
    payer: {},
    bank: (i) => ({ bank_code: 'MBBEMYKL', swift: 'MBBEMYKL', number: '5140' + String(12345670 + i), account_type: 'savings' }),
    doc: 'my_ea',
  },
  GB: {
    create: { name: 'Northwind UK Ltd', code: 'GB01', legal_name: 'Northwind UK Limited', country: 'GB', region: 'ENG' },
    entityFields: {},
    hires: [
      { key: 'A', legal_name: 'Oliver Smith', family_name: 'Smith', given_name: 'Oliver', name_order: 'given_first', birth_date: '1993-01-15', gender: 'male', nationality: 'GB', pay_amount: '3000.00', pay_per: 'month', tax_fields: { gb_tax_code: '1257L', gb_basis: 'cumulative', gb_ni_category: 'A', gb_pension_enrolled: true } },
      { key: 'B', legal_name: 'Amelia Jones', family_name: 'Jones', given_name: 'Amelia', name_order: 'given_first', birth_date: '1985-06-20', gender: 'female', nationality: 'GB', pay_amount: '4000.00', pay_per: 'month', tax_fields: { gb_tax_code: '1257L', gb_basis: 'week1_month1', gb_ni_category: 'A', gb_pension_enrolled: false } },
    ],
    hand: { A: () => H.gb(3000, { basis: 'cumulative', taxMonth: 8, pension: true }), B: () => H.gb(4000, { basis: 'month1', pension: false }) },
    bonus: { amount: '1000.00', want: { GB_PAYE: 0, GB_NI_EE: 8000, GB_NI_ER: 15000, GB_PENSION_EE: 5000, GB_PENSION_ER: 3000 } },
    final: { days: () => 28 * 1.5 / 12 },
    format: 'bacs_csv',
    payer: {},
    bank: (i) => ({ bank_code: '200000', number: String(12345670 + i), account_type: 'current' }),
    doc: 'gb_p60',
  },
  AU: {
    create: { name: 'Northwind Pty Ltd', code: 'AU01', legal_name: 'Northwind Pty Ltd', country: 'AU', region: 'NSW' },
    entityFields: { au_concessional_cap: '30000' },
    hires: [
      { key: 'A', legal_name: 'Jack Wilson', family_name: 'Wilson', given_name: 'Jack', name_order: 'given_first', birth_date: '1994-09-09', gender: 'male', nationality: 'AU', pay_amount: '4914.00', pay_per: 'month', tax_fields: { au_tfn_provided: true, au_residency: 'resident', au_tax_free_threshold: true } },
      { key: 'B', legal_name: 'Chloe Taylor', family_name: 'Taylor', given_name: 'Chloe', name_order: 'given_first', birth_date: '1989-12-12', gender: 'female', nationality: 'AU', pay_amount: '7990.67', pay_per: 'month', tax_fields: { au_tfn_provided: true, au_residency: 'resident', au_tax_free_threshold: true } },
    ],
    hand: { A: () => H.au(4914, 784), B: () => H.au(7990.67, 1772) },
    bonus: { amount: '1000.00', want: { AU_PAYGW: 31200, AU_SG: 12000 } },
    final: { base: { AU_SALARY: 418559 }, days: () => Math.round(20 * 45 / 365 * 100) / 100 },
    format: 'aba',
    payer: { aba: { fi: 'CBA', user_name: 'NORTHWIND PTY LTD', user_id: '301500', bsb: '062-000', account: '12345678', remitter: 'NORTHWIND PTY' } },
    bank: (i) => ({ bank_code: '062-0' + String(10 + i), number: String(10203040 + i), account_type: 'savings' }),
    doc: 'au_income_statement',
  },
};

/* ----------------------------------------------------------- the flow */

let deptEng = null;
async function setupCountry(cc, cfg) {
  const ents = (await api.op('entities.list', {}, O)).entities;
  let ent = ents.find((e) => e.name === (cfg.entityName || (cfg.create && cfg.create.name)));
  if (!ent && cfg.create) {
    ent = (await api.op('entities.add', cfg.create, O)).entity;
    ok(ent && ent.country === cc, cc + ': entity created (' + ent.currency + ', ' + ent.timezone + ', packs ' + JSON.stringify(ent.packs) + ')');
    await api.op('locations.add', { entity: ent.id, name: cfg.create.name + ' office' }, O);
    if (cfg.entityFields && Object.keys(cfg.entityFields).length) {
      const r = await api.call('payroll.settings-save', { entity: ent.id, entity_fields: cfg.entityFields }, O);
      ok(r.status === 200, cc + ': entity pack fields saved ' + JSON.stringify(cfg.entityFields), r.body);
    }
  }
  if (deptEng === null) deptEng = (await api.op('departments.list', {}, O)).departments.find((d) => d.code === 'ENG');
  return ent;
}

async function country(cc) {
  const cfg = COUNTRIES[cc];
  const R = { cc, slips: [], steps: {} };
  results[cc] = R;
  section(cc + ': day in the life');
  const ent = await step(cc, 'entity', () => setupCountry(cc, cfg));
  if (!ent) return;
  R.entity = { id: ent.id, name: ent.name, currency: ent.currency, packs: ent.packs };
  const loc = (await api.op('locations.list', { entity: ent.id }, O)).locations[0];
  const mgrEmp = (await api.op('people.directory', { q: 'Mei Lin', status: 'all' }, O)).people[0];

  // 1. Hire through people.hire with the country's tax profile; give each a sign-in.
  const hired = {};
  for (const h of cfg.hires) {
    const p = Object.assign({}, h, { entity: ent.id, start_day: '2026-11-01', title: 'Engineer', department: deptEng.id, location: loc && loc.id, manager: mgrEmp.employee, pay_basis: 'salary', work_email: h.legal_name.toLowerCase().replace(/[^a-z]+/g, '.') + '@' + cc.toLowerCase() + '.northwind.test' });
    delete p.key;
    const out = await step(cc, 'people.hire ' + h.key, () => api.op('people.hire', p, O));
    if (!out) continue;
    hired[h.key] = { employee: out.employee.id, employment: out.employment.id, number: out.employee.number, email: p.work_email };
    const tp = await api.op('taxprofile.get', { employment: out.employment.id }, O);
    ok(tp && JSON.stringify(tp).includes(Object.keys(h.tax_fields)[0]), cc + ' ' + h.key + ': tax profile carries the pack fields (' + out.employee.number + ')');
    await step(cc, 'member for ' + h.key, async () => {
      const inv = await api.op('members.invite', { email: p.work_email, name: h.legal_name, role: 'employee', employee: out.employee.id }, { as: 'owner', pin: true });
      const joined = await api.op('auth.accept-invite', { email: p.work_email, code: inv.code, password: DEMO.password });
      api.setToken(p.work_email, joined.token);
    });
  }
  R.hired = hired;
  const A = hired.A;
  if (!A) return;

  // Country prerequisites for the seeded people (JP grade and prefecture; India's active pack only).
  const dir = (await api.op('people.directory', { status: 'current', entity: ent.id, limit: 500 }, O)).people;
  if (cc === 'JP') for (const r of dir.filter((x) => !Object.values(hired).some((h) => h.number === x.number))) {
    const pay = await api.op('pay.history', { employment: r.employment }, O);
    const cur = pay.records.find((x) => x.state === 'current');
    await step(cc, 'jp profile ' + r.number, () => api.op('taxprofile.submit', { employment: r.employment, fields: { jp_prefecture: '13', jp_smr: cfg.smr[cur.amount_minor] || 530000 } }, O));
  }
  if (cc === 'IN') for (const r of dir.filter((x) => !Object.values(hired).some((h) => h.number === x.number))) await step(cc, 'in packs ' + r.number, () => api.op('taxprofile.submit', { employment: r.employment, packs: ['in', 'in-epf', 'in-esi'], fields: { in_regime: 'new' } }, O));

  // Bank accounts for everyone in the entity (approved by the payroll administrator with the PIN).
  await step(cc, 'bank accounts', async () => {
    let i = 0;
    for (const r of dir) {
      const b = cfg.bank(i++);
      const add = await api.op('bank.add', { employee: r.employee, number: b.number, bank_name: 'QA Bank', bank_code: b.bank_code, branch_code: b.branch_code || '', account_type: b.account_type, holder: r.name, swift: b.swift || '' }, O);
      if (add.approval && add.approval.status === 'pending') await approveAll(add.approval.id, ['payroll@northwind.test', 'hr@northwind.test']);
    }
    const pend = await api.op('approvals.list', { view: 'all', status: 'pending', kind: 'bank_account' }, O);
    for (const a of pend.approvals) await approveAll(a.id, ['payroll@northwind.test', 'hr@northwind.test']);
  });

  // 2. Clock in and out (the new hire, on the web).
  await step(cc, 'clock', async () => {
    const i = await api.op('clock.punch', { kind: 'in' }, { as: A.email });
    const o = await api.op('clock.punch', { kind: 'out' }, { as: A.email });
    const st = await api.op('clock.status', {}, { as: A.email });
    ok(i && o && st, cc + ': clocked in and out (' + JSON.stringify(st.state || st.status || '').slice(0, 60) + ')');
    R.steps.clock = 'ok';
  });

  // 3. Leave: request and approve one day.
  await step(cc, 'leave', async () => {
    const types = (await api.op('leave.types', { entity: ent.id }, O)).types.filter((t) => t.paid && !t.archived);
    const t = types.find((x) => /annual|pto|earned|holiday/.test(x.code)) || types[0];
    const req = await api.call('leave.request', { type: t.code, start: cc === 'US' ? '2026-11-24' : '2026-11-26', reason: 'QA day off' }, { as: A.email });
    let reqBody = req.body;
    if (req.status >= 400) {
      note('leave_refused', { cc, type: t.code, status: req.status, body: req.body });
      ok(req.status === 409 && req.body.code === 'balance', cc + ': leave request ' + t.code + ' refused for a new hire with no balance yet (country rule): ' + req.status + ' ' + (req.body && req.body.code) + ' ' + (req.body && req.body.message) + '; HR records it with an override');
      const r2 = await api.call('leave.request', { type: t.code, start: cc === 'US' ? '2026-11-24' : '2026-11-26', reason: 'QA day off', employment: A.employment, record: true, override: true }, HR);
      reqBody = r2.body;
      if (r2.status >= 400) throw new Error('HR could not record it either: ' + JSON.stringify(r2.body).slice(0, 200));
    }
    const lr = reqBody.request || reqBody.leave_request || reqBody;
    const apId = lr.approval || (reqBody.approval && reqBody.approval.id);
    if (apId && lr.status === 'pending') await approveAll(apId, [MGR, 'hr@northwind.test', 'owner']);
    const got = await api.op('leave.get', { request: lr.id }, O);
    ok((got.request || got).status === 'approved', cc + ': leave ' + t.code + ' approved (' + (lr.days ?? '') + ' day)', got.request || got);
    R.steps.leave = t.code;
  });

  // 4. Claim with a receipt; your AI agent is asked about the claim and reads it.
  await step(cc, 'claim', async () => {
    const cats = (await api.op('expense-categories.list', { entity: ent.id }, O)).categories;
    const meals = cats.find((c) => c.code === 'meals') || cats[0];
    const claim = (await api.op('claims.create', { title: 'QA lunch' }, { as: A.email })).claim;
    const amount = cc === 'JP' ? '2500' : '25.00';
    const add = await upload('claim-lines.add', { claim: claim.id, day: '2026-11-03', category: meals.code, amount, currency: ent.currency, merchant: 'QA Cafe', read: true }, { receipt: { data: RECEIPT, type: 'image/png', name: 'lunch.png' } }, A.email);
    ok(add.status === 200, cc + ': expense line with a receipt added', add.body);
    const line = add.body.line || (add.body.claim && add.body.claim.lines && add.body.claim.lines[0]);
    // Your AI agent: the receipt_review ask on the claim.
    const waiting = await api.op('claim-lines.waiting', { claim: claim.id }, AG);
    const job = (waiting.lines || []).find((x) => x.line === line.id);
    ok(job !== undefined && add.body.claim.agent && add.body.claim.agent.trigger === 'receipt_review', cc + ': the receipt waits for your AI agent (receipt_review on the claim)', add.body.claim && add.body.claim.agent);
    if (job) {
      const rc = await api.op('claim-lines.receipt', { line: line.id }, AG);
      ok(rc.path || (rc.file && rc.file.path), cc + ': your AI agent gets the receipt path');
      await api.op('claim-lines.read-result', { line: line.id, amount, currency: ent.currency, day: '2026-11-03', merchant: 'QA Cafe', category: meals.code, confidence: 'high' }, AG);
      await api.op('claim-lines.accept-reading', { line: line.id }, { as: A.email });
    }
    const sub = await api.op('claims.submit', { claim: claim.id }, { as: A.email });
    const apId = (sub.claim && sub.claim.approval) || (sub.approval && sub.approval.id);
    if (apId) await approveAll(apId, [MGR, 'payroll@northwind.test', 'owner']);
    const got = (await api.op('claims.get', { claim: claim.id }, O)).claim;
    ok(got.status === 'approved', cc + ': claim ' + got.number + ' approved (' + got.total_minor + ')', got.status);
    R.steps.claim = { number: got.number, total_minor: got.total_minor };
  });

  // 5. The regular run.
  const home = await api.op('payroll.home', { entity: ent.id }, PAY);
  const sch = home.schedules.find((s) => s.entity === ent.id);
  const run = await step(cc, 'payruns.create', async () => (await api.op('payruns.create', { schedule: sch.schedule }, PAY)).payrun);
  if (!run) return;
  R.run = { id: run.id, number: run.number, period: run.period_start + '..' + run.period_end, pay_date: run.pay_date };
  const lock = await step(cc, 'regular run', () => runToLock(cc, run.id, 'regular ' + run.number));
  R.calc_ms = lock && lock.ms;
  R.warnings = lock && lock.warnings;
  if (!lock || !lock.ok) {
    R.blocked = lock && lock.blockers && lock.blockers.map((b) => b.code + ': ' + b.message);
  }
  // Statutory lines on two payslips.
  await step(cc, 'payslip checks', async () => {
    for (const [key, fn] of Object.entries(cfg.hand)) {
      const number = key === 'seeded' ? cfg.seeded.number : hired[key] && hired[key].number;
      const slip = await slipOf(run.id, number);
      const got = checkSlip(cc, (key === 'seeded' ? cfg.seeded.name : key) + ' ' + number, slip, fn(), R.slips);
      if (key === 'A') {
        ok((got.REIMB || 0) > 0, cc + ': the approved claim is reimbursed on the payslip (REIMB ' + (got.REIMB || 0) + ')', Object.keys(got));
      }
    }
  });
  if (!lock || !lock.ok) return;

  // 6. Publish; the employee sees it.
  await step(cc, 'publish', async () => {
    const p = await api.op('payruns.publish', { payrun: run.id }, PAY);
    const mine = await api.op('payslips.mine', {}, { as: A.email });
    const rows = mine.payslips || mine.rows || [];
    ok(rows.some((s) => s.kind === 'regular' && s.period_start === run.period_start && s.net_minor > 0), cc + ': the new hire sees the published payslip', rows.slice(0, 2));
    R.steps.publish = p && p.payrun && p.payrun.status;
  });

  // 7. Bank file.
  await step(cc, 'bank file', async () => {
    await api.op('payout.settings-set', { entity: ent.id, bank_format: cfg.format, payer: cfg.payer }, PAY);
    const chk = await api.op('payout.run', { payrun: run.id, format: cfg.format }, PAY);
    ok(chk.check.problems.length === 0, cc + ': no bank file problems for ' + cfg.format, chk.check.problems.slice(0, 4));
    if (chk.check.problems.length > 0) {
      note('bank_problems', { cc, format: cfg.format, problems: chk.check.problems.slice(0, 8) });
      return;
    }
    const ex = await api.op('bankfiles.export', { payrun: run.id, format: cfg.format }, PAYPIN);
    const dl = await download('bankfiles.download', { bank_file: ex.bank_file.id }, 'payroll@northwind.test');
    ok(dl.status === 200, cc + ': bank file downloads (' + dl.buf.length + ' bytes)');
    const pr = (await api.op('payruns.get', { payrun: run.id }, PAY)).payrun;
    R.bank = checkBankFile(cc, cfg.format, dl.buf, ex.bank_file.count, ex.bank_file.total_minor);
    eq(ex.bank_file.total_minor, pr.net_minor, cc + ': bank file total equals the run net');
    const cu = await api.op('payout.confirm-upload', { bank_file: ex.bank_file.id, reference: 'QA-' + cc + '-0001' }, PAYPIN);
    ok(cu.run && cu.run.status === 'paid', cc + ': run paid after the confirmed upload');
  });

  // 8. Filings and one year-end document.
  await step(cc, 'filings', async () => {
    const g = await api.op('filings.generate', { entity: ent.id, year: 2026 }, PAY);
    const fl = await api.op('filings.list', { entity: ent.id, show: 'all', year: 2026, limit: 200 }, PAY);
    const month = run.pay_date.slice(0, 7);
    const these = fl.filings.filter((f) => f.period && (f.period === month || f.period.startsWith('2026-Q4') || f.period === '2026-11'));
    ok(fl.filings.length > 0, cc + ': filings ledger rows (' + fl.filings.length + ')');
    R.filings = { rows: fl.filings.length, month: these.map((f) => f.kind + ' ' + f.period + ' ' + f.amount_minor + ' due ' + f.due_day) };
    void g;
  });
  await step(cc, 'year end', async () => {
    const ov = await api.op('yearend.overview', { entity: ent.id, year: 2026 }, PAY);
    const docs = (ov.documents || ov.docs || []).map((d) => d.code || d.doc);
    const code = docs.includes(cfg.doc) ? cfg.doc : docs[0];
    ok(code !== undefined, cc + ': year-end documents offered (' + docs.join(', ') + ')');
    const doc = await api.op('yearend.document', { entity: ent.id, doc: code, year: 2026 }, PAY);
    ok(doc.rows && doc.rows.length > 0, cc + ': ' + code + ' has a row per person paid (' + (doc.rows || []).length + ')');
    R.yearend = { code, rows: (doc.rows || []).length, totals: doc.totals };
  });

  // 9. Off-cycle bonus, then void and replace it once.
  await step(cc, 'bonus', async () => {
    const b = (await api.op('payruns.create', { kind: 'bonus', entity: ent.id, employments: [A.employment], pay_date: '2026-11-30', label: 'QA bonus' }, PAY)).payrun;
    const comps = (await api.op('components.list', { entity: ent.id }, PAY)).components;
    const bonusCode = (comps.find((c) => c.role === 'bonus') || {}).code;
    ok(bonusCode !== undefined, cc + ': a bonus component exists (' + bonusCode + ')');
    await api.op('pay-inputs.add', { employment: A.employment, component: bonusCode, amount: cfg.bonus.amount, payrun: b.id }, PAY);
    const lk = await runToLock(cc, b.id, 'bonus ' + b.number);
    const slip = await slipOf(b.id, A.number);
    const got = linesByCode(slip);
    R.bonus = { run: b.number, pay_date: b.pay_date, lines: got, net: slip.net_minor, issues: (slip.issues || []).map((i) => i.severity + ':' + i.code), blocked: lk.ok ? undefined : (lk.blockers || []).map((x) => x.code + ': ' + x.message) };
    if (cfg.bonus.want) for (const [code, want] of Object.entries(cfg.bonus.want)) {
      ok((got[code] || 0) === want, cc + ' bonus ' + code + ' (got ' + (got[code] || 0) + ', hand ' + want + ')');
      if ((got[code] || 0) !== want) note('wrong_number', { cc, who: 'bonus ' + A.number, code, got: got[code] || 0, want });
    }
    for (const [code, min] of Object.entries(cfg.bonus.atLeast || {})) {
      ok((got[code] || 0) >= min, cc + ' bonus ' + code + ' at least ' + min + ' (got ' + (got[code] || 0) + ')');
    }
    const stat = slip.groups.filter((g) => g.key === 'statutory' || g.key === 'employer').flatMap((g) => g.lines.map((l) => l.code));
    const unchecked = stat.filter((c) => (cfg.bonus.want || {})[c] === undefined && (cfg.bonus.atLeast || {})[c] === undefined && (got[c] || 0) !== 0);
    ok(unchecked.length === 0, cc + ' bonus: every non-zero statutory and employer line is hand checked', unchecked.map((c) => c + '=' + got[c]));
    if (!lk.ok) return;
    const v = await api.op('payruns.void', { payrun: b.id, reason: 'QA void and replace' }, PAYPIN);
    const repl = v.replacement || v.replaced_by || (v.payrun && v.payrun.replaced_by);
    const replId = typeof repl === 'object' ? repl.id : repl;
    ok(replId, cc + ': void made a replacement draft', v);
    const orig = (await api.op('payruns.get', { payrun: b.id }, PAY)).payrun;
    eq(orig.status, 'void', cc + ': the bonus run is void');
    const lk2 = await runToLock(cc, replId, 'replacement');
    const slip2 = await slipOf(replId, A.number);
    eq(slip2.net_minor, slip.net_minor, cc + ': the replacement pays the same net');
    R.void = { replacement: replId, locked: lk2.ok };
  });

  // 10. Termination with final pay (lifecycle separation, then payroll's draft run).
  // QA2: the leave paid out on leaving (M-2), JP statutory lines (B-2), AU holidays (B-8),
  // and the settlement statement against the payslip (lifecycle minor).
  await step(cc, 'termination', async () => {
    const leaver = cfg.hires.length > 1 ? hired.B : { number: cfg.seeded.number, employment: dir.find((x) => x.number === cfg.seeded.number).employment };
    const LAST = '2026-12-15';
    const types = (await api.op('leave.types', { entity: ent.id }, O)).types;
    const exitTypes = types.filter((t) => t.payout_on_exit === true && !t.archived);
    const before = {};
    for (const t of exitTypes) {
      const r = await api.call('leave.balance', { employment: leaver.employment, type: t.code, project_to: LAST }, O);
      before[t.code] = r.status === 200 ? r.body : { status: r.status, code: r.body && r.body.code };
    }
    const payH = await api.op('pay.history', { employment: leaver.employment }, O);
    const cur = (payH.records || []).find((x) => x.state === 'current') || (payH.records || [])[0];
    const sep = await api.op('separations.request', { employment: leaver.employment, kind: 'resignation', last_day: LAST, notice_day: today, reason: 'QA leaver' }, HR);
    const s = sep.separation || sep;
    const apId = s.approval || (sep.approval && sep.approval.id);
    if (apId) await approveAll(apId, [MGR, 'hr@northwind.test', 'owner']);
    const got = (await api.op('separations.get', { separation: s.id }, HR)).separation;
    ok(got.status === 'approved' || got.status === 'completed', cc + ': separation approved', got.status);
    const after = {};
    for (const t of exitTypes) {
      const r = await api.call('leave.balance', { employment: leaver.employment, type: t.code, project_to: LAST }, O);
      after[t.code] = r.status === 200 ? r.body : { status: r.status, code: r.body && r.body.code };
    }
    let fr = got.settlement_payrun;
    if (!fr) {
      const l = await api.op('payruns.list', { entity: ent.id, kind: 'termination' }, PAY);
      fr = l.payruns && l.payruns[0] && l.payruns[0].id;
    }
    ok(fr, cc + ': a draft final pay run exists for the leaver', got.events);
    if (!fr) return;
    const frRun = (await api.op('payruns.get', { payrun: fr }, PAY)).payrun;
    const lk = await runToLock(cc, fr, 'final pay');
    const slip = await slipOf(fr, leaver.number);
    const lines = linesByCode(slip);
    const allLines = slip.groups.flatMap((g) => g.lines);
    const encash = allLines.filter((l) => l.ref_kind === 'encash' || (l.explain && (l.explain.rule || '').length > 0 && /leave/i.test(l.name || '')));
    const set = await api.op('separations.settlement', { separation: s.id }, HR);
    R.final = { run: fr, number: frRun.number, period: frRun.period_start + '..' + frRun.period_end, pay_date: frRun.pay_date, lines, gross: slip.gross_minor, net: slip.net_minor, locked: lk.ok, blockers: lk.ok ? [] : (lk.blockers || []).map((x) => x.code + ': ' + x.message), warnings: (slip.issues || []).filter((i) => i.severity !== 'blocker').map((i) => i.code + ': ' + i.message), before, after, pay: cur && { amount_minor: cur.amount_minor, per: cur.per, basis: cur.basis }, encash: encash.map((l) => ({ code: l.code, name: l.name, qty: l.qty, rate: l.rate, amount_minor: l.amount_minor, explain: l.explain })), settlement: { totals: set.totals, leave: set.leave, leave_from: set.leave_from, payrun: set.payrun } };
    ok(slip.net_minor > 0, cc + ': final pay net is positive (' + slip.net_minor + ')');
    // Statutory and base lines by hand where QA has them.
    const fw = cfg.final || {};
    if (fw.want) checkSlip(cc, 'final ' + leaver.number, slip, fw.want(), R.slips);
    for (const [code, want] of Object.entries(fw.base || {})) eq(lines[code] || 0, want, cc + ' final ' + code);
    const fw0 = cfg.final || {};
    // Leave paid out on leaving: every payout type with days left is on the payslip, at days x the leave day rate.
    const annual = cur ? (cur.per === 'year' ? cur.amount_minor : cur.per === 'month' ? cur.amount_minor * 12 : null) : null;
    const rateOf = (code) => (annual === null ? null : ['MY', 'IN'].includes(cc) ? annual / 12 / 26 : annual / 260);
    for (const t of exitTypes) {
      const b0 = before[t.code] || {};
      const b = after[t.code] || {};
      const left0 = Number(b0.projection ? b0.projection.available : b0.available) || 0;
      // The balance on the last day once the separation is approved (entitlement to the last day), plus the payout it reserved.
      const reserved = Number(b.reserved || (b.projection && b.projection.reserved) || 0);
      const leftAfter = Number(b.projection ? b.projection.available : b.available) || 0;
      // QA2 hand value of the days owed on the last day (per country rule, see cfg.final.days); else the balance after approval.
      const left = fw.days ? fw.days(b0, b) : leftAfter > 0 ? leftAfter : Math.max(leftAfter + reserved, 0) || left0;
      const line = encash.find((l) => (l.explain && l.explain.type === t.code) || (l.name || '').indexOf(t.code) >= 0 || (l.name || '').indexOf(t.name) >= 0) || (encash.length === 1 ? encash[0] : undefined);
      if (left <= 0) {
        ok(true, cc + ': no ' + t.code + ' left on the last day (' + left + '), nothing to pay out');
        continue;
      }
      ok(line !== undefined, cc + ': ' + t.code + ' paid out on final pay (' + left + ' days left on ' + LAST + '; line ' + (line ? line.qty + ' x ' + line.rate + ' = ' + line.amount_minor : 'missing') + ')', encash);
      if (line) {
        ok(Math.abs(Number(line.qty) - left) < 0.011, cc + ': payout days ' + line.qty + ' = balance on the last day ' + left);
        const r = rateOf(t.code);
        if (r !== null) ok(Math.abs(line.amount_minor - Math.round(Number(line.qty) * r)) <= 1, cc + ': payout amount ' + line.amount_minor + ' = ' + line.qty + ' x ' + (r / 100).toFixed(4) + ' (' + (['MY', 'IN'].includes(cc) ? 'month / 26' : 'year / 260') + ')');
      }
    }
    ok(!(slip.issues || []).some((i) => i.code === 'leaver_leave_unpaid'), cc + ': no leaver_leave_unpaid warning', (slip.issues || []).map((i) => i.code));
    // Settlement statement against the payslip.
    const tot = (set.totals || [])[0];
    ok(tot && tot.source === 'payrun' && tot.net_minor === slip.net_minor, cc + ': settlement totals match the payslip net (' + (tot ? tot.source + ' ' + tot.net_minor : 'none') + ' vs ' + slip.net_minor + ')', set.totals);
    const encSum = encash.reduce((a2, l) => a2 + l.amount_minor, 0);
    const setLeave = (set.leave || []).reduce((a2, l) => a2 + (Number(l.amount_minor != null ? l.amount_minor : l.amount) || 0), 0);
    ok(setLeave === encSum, cc + ': settlement leave rows (' + setLeave + ', from ' + set.leave_from + ') match the payslip payout lines (' + encSum + ')', set.leave);
  });
}

for (const cc of only.length ? only : Object.keys(COUNTRIES)) {
  await country(cc);
  writeResult('t02_results.json', results);
}
const s = summary('t02_countries');
process.exitCode = s.failed > 0 ? 1 : 0;
