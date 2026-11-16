// payroll-core t02: full monthly runs (November 2026) for the demo seed's four
// entities, every statutory line of two employees per country checked against
// an independent hand calculation written below with its source.
//
//   node tests/t02_countries.mjs [--keep]   (--keep reuses the running scratch database)
import { newApi, fresh, preparePayable, calcRun, section, ok, eq, summary, O, byCode, cents } from './lib.mjs';

const api = newApi();
if (!process.argv.includes('--keep')) {
  fresh({ seed: true });
  await preparePayable(api);
}

/* -------------------------------------------------------------- hand calcs */

// Singapore. CPF Board, "CPF contribution and allocation rates from 1 January 2026",
// Table 1 (Singapore citizens, age 55 and below: employer 17%, employee 20%, total 37%);
// Ordinary Wage ceiling S$8,000 a month from 1 January 2026; rounding: the total
// contribution to the nearest dollar, the employee share down to the dollar, the
// employer share is the difference. SDL (SkillsFuture Singapore): 0.25% of total
// wages, at least S$2 (wages under S$800) and at most S$11.25 (wages over S$4,500).
function sgHand(ow) {
  const owC = Math.min(ow, 8000);
  const total = Math.round(0.37 * owC);
  const ee = Math.floor(0.2 * owC);
  const sdl = ow < 800 ? 2 : ow > 4500 ? 11.25 : Math.floor(ow * 0.0025 * 100) / 100;
  return { SG_CPF_EE: ee * 100, SG_CPF_ER: (total - ee) * 100, SG_SDL: Math.round(sdl * 100) };
}

// United States, federal. IRS Publication 15-T (2026), Worksheet 1A and the
// Annual Percentage Method table for a 2020 or later Form W-4, Single, standard
// withholding (Step 1(g) adjustment 8,600): over 7,500 10%; over 19,900 1,240 + 12%;
// over 57,900 5,800 + 22%; over 113,200 17,966 + 24%; over 209,275 41,024 + 32%.
// Publication 15 (2026): social security 6.2% (wage base 184,500), Medicare 1.45%,
// FUTA 0.6% on the first 7,000 of the year: the demo locked October at the same pay, so
// November pays it on what is left of 7,000 after October (none for these two).
// California. EDD DE 44 (Rev. 52, 4-26), Method B, monthly: low income exemption
// (single) 1,575; standard deduction (single) 476; Table 5 monthly single: over 924
// 10.16 + 2.2%; over 2,188 37.97 + 4.4%; over 3,454 93.67 + 6.6%; over 4,796 182.24 + 8.8%;
// over 6,060 293.47 + 10.23%; SDI 1.3% (no wage limit); UI new employer rate 3.4% and
// ETT 0.1% on the first 7,000.
function usHand(monthly, earlier) {
  const room = (base) => Math.max(0, Math.min(monthly, base - earlier));
  const annual = monthly * 12;
  const adj = Math.max(0, annual - 8600);
  const rows = [[0, 0, 0], [7500, 0.1, 0], [19900, 0.12, 1240], [57900, 0.22, 5800], [113200, 0.24, 17966], [209275, 0.32, 41024]];
  let r = rows[0];
  for (const x of rows) if (adj >= x[0]) r = x;
  const fit = (r[2] + (adj - r[0]) * r[1]) / 12;
  const caTaxable = monthly - 476;
  const ca = [[0, 0.011, 0], [924, 0.022, 10.16], [2188, 0.044, 37.97], [3454, 0.066, 93.67], [4796, 0.088, 182.24], [6060, 0.1023, 293.47], [30956, 0.1133, 2840.33]];
  let c = ca[0];
  for (const x of ca) if (caTaxable > x[0]) c = x;
  const caTax = Math.round((c[2] + (caTaxable - c[0]) * c[1]) * 100) / 100;
  return {
    US_FIT: cents(fit),
    US_SS_EE: cents(monthly * 0.062),
    US_MED_EE: cents(monthly * 0.0145),
    US_SS_ER: cents(monthly * 0.062),
    US_MED_ER: cents(monthly * 0.0145),
    US_FUTA: cents(room(7000) * 0.006),
    US_CA_SIT: monthly <= 1575 ? 0 : cents(caTax),
    US_CA_SDI: cents(monthly * 0.013),
    US_CA_UI: cents(room(7000) * 0.034),
    US_CA_ETT: cents(room(7000) * 0.001),
  };
}

// Japan. 協会けんぽ 令和8年度 (premium months from March 2026) 東京都: health 9.85%,
// nursing care 1.62% (age 40 to 64), 子ども・子育て支援金 0.23% (from April 2026
// premiums); 厚生年金 18.3% on the 標準報酬月額 capped at 650,000; employee shares are
// half, 50 sen or less dropped (協会けんぽ 保険料額表 note); employer = total minus
// employee share, yen truncated. 雇用保険 令和8年度 一般の事業: employee 5/1000,
// employer 8.5/1000 of wages. Premiums are 翌月徴収 (the November pay collects the
// October premium). 源泉所得税, NTA 令和8年分 電算機計算の特例 (月額, 甲欄):
// A = pay minus employee social insurance; 給与所得控除 (別表第一): A <= 158,333:
// 54,167; to 299,999: A x 30% + 6,667; to 549,999: A x 20% + 36,667; to 708,330:
// A x 10% + 91,667; over: 162,500 (yen rounded up); 基礎控除 (別表第三) 48,334
// (A <= 2,120,833); 扶養控除 31,667 a dependant; tax (別表第四) on B: over 162,500
// 10.21% - 8,296; over 275,000 20.42% - 36,374; over 579,166 23.483% - 54,113;
// over 750,000 33.693% - 130,688; then rounded to the nearest 10 yen.
function jpHand(pay, smr, age) {
  const halfDown = (x) => (x - Math.floor(x) > 0.5 ? Math.ceil(x) : Math.floor(x));
  const careOn = age >= 40 && age < 65;
  const hcEmp = halfDown(smr * (0.0985 / 2 + (careOn ? 0.0162 / 2 : 0)));
  const health = halfDown(smr * (0.0985 / 2));
  const care = careOn ? hcEmp - health : 0;
  const support = halfDown(smr * 0.00115);
  const pSmr = Math.min(Math.max(smr, 88000), 650000);
  const pension = halfDown(pSmr * 0.0915);
  const ei = halfDown(pay * 0.005);
  const A = pay - (health + care + support + pension + ei);
  let kyuyo;
  if (A <= 158333) kyuyo = 54167;
  else if (A <= 299999) kyuyo = Math.ceil(A * 0.3 + 6667);
  else if (A <= 549999) kyuyo = Math.ceil(A * 0.2 + 36667);
  else if (A <= 708330) kyuyo = Math.ceil(A * 0.1 + 91667);
  else kyuyo = 162500;
  const B = A - kyuyo - 48334;
  const t = [[0, 0.05105, 0], [162500, 0.1021, 8296], [275000, 0.2042, 36374], [579166, 0.23483, 54113], [750000, 0.33693, 130688]];
  let row = t[0];
  for (const x of t) if (B > x[0]) row = x;
  const wht = B <= 0 ? 0 : Math.round((B * row[1] - row[2]) / 10) * 10;
  return {
    JP_HEALTH: health,
    JP_CARE: care,
    JP_SUPPORT: support,
    JP_PENSION: pension,
    JP_EI: ei,
    JP_WHT: wht,
    JP_HEALTH_ER: Math.floor(smr * (0.0985 + (careOn ? 0.0162 : 0)) - hcEmp + 1e-6),
    JP_SUPPORT_ER: Math.floor(smr * 0.0023 - support + 1e-6),
    JP_PENSION_ER: Math.floor(pSmr * 0.183 - pension + 1e-6),
    JP_EI_ER: Math.floor(pay * 0.0085 + 1e-6),
  };
}

// India. Income-tax Act 2025 / Finance Act 2026 (rates of tax year 2026-27 unchanged
// from 2025-26), new regime (section 202): 0 to 4 lakh nil, 4 to 8 lakh 5%, 8 to 12
// lakh 10%, 12 to 16 lakh 15%, 16 to 20 lakh 20%, 20 to 24 lakh 25%, above 30%;
// standard deduction 75,000; rebate (section 156) makes income up to 12 lakh nil;
// health and education cess 4%. Salary TDS (section 392): the year's projected
// salary (the demo locked October at the same pay: October plus November x 5 months
// to March, 6 months), less TDS of October, spread over the 5 months left: the
// year's tax / 6 a month, rupees.
function inHand(monthly) {
  const income = monthly * 6 - 75000;
  const slabs = [[0, 0], [400000, 0.05], [800000, 0.1], [1200000, 0.15], [1600000, 0.2], [2000000, 0.25], [2400000, 0.3]];
  let tax = 0;
  for (let i = 0; i < slabs.length; i++) {
    const lo = slabs[i][0];
    const hi = i + 1 < slabs.length ? slabs[i + 1][0] : Infinity;
    if (income > lo) tax += (Math.min(income, hi) - lo) * slabs[i][1];
  }
  if (income <= 1200000) tax = 0;
  const annual = tax * 1.04;
  return { IN_TDS: Math.round(annual / 6) * 100 };
}

/* ------------------------------------------------------------------- runs */

const home = await api.op('payroll.home', {}, O);
const runs = {};
for (const s of home.schedules) {
  const r = (await api.op('payruns.create', { schedule: s.schedule }, O)).payrun;
  const t0 = Date.now();
  const res = await calcRun(api, r.id);
  runs[s.entity_name] = { run: r, ms: Date.now() - t0, done: res.done };
}

async function slipOf(entityName, number) {
  const got = await api.op('payruns.get', { payrun: runs[entityName].run.id }, O);
  const row = got.payslips.find((x) => x.number === number);
  return (await api.op('payslips.get', { payslip: row.id }, O)).payslip;
}

function check(country, who, slip, want) {
  const got = byCode(slip);
  for (const code of Object.keys(want)) eq(got[code] || 0, want[code], country + ' ' + who + ' ' + code);
  const statutory = slip.groups.filter((g) => g.key === 'statutory' || g.key === 'employer').flatMap((g) => g.lines.map((l) => l.code));
  const unchecked = statutory.filter((c) => want[c] === undefined);
  ok(unchecked.length === 0, country + ' ' + who + ': every statutory and employer line is hand checked', unchecked);
  return got;
}

const results = [];

section('Singapore (sg 2026.1): Sam Wong 7,800 and Priya Raman 9,800');
{
  const sam = await slipOf('Northwind Pte Ltd', 'E0005');
  check('SG', 'Sam Wong', sam, sgHand(7800));
  eq(sam.net_minor, 780000 - sgHand(7800).SG_CPF_EE, 'SG Sam net = pay - employee CPF');
  const priya = await slipOf('Northwind Pte Ltd', 'E0002');
  check('SG', 'Priya Raman', priya, sgHand(9800));
  results.push('SG: Sam CPF 1,560/1,326 SDL 11.25; Priya CPF 1,600/1,360 (OW ceiling) SDL 11.25');
}

section('United States (us-federal 2026.1, us-ca 2026.1): Jordan Reyes 165,000/yr and Emily Carter 98,000/yr');
{
  const j = await slipOf('Northwind Inc', 'E0009');
  check('US', 'Jordan Reyes', j, usHand(13750, 13750));
  const e = await slipOf('Northwind Inc', 'E0010');
  eq(byCode(e).US_SALARY, 816667, 'US Emily monthly salary 98,000 / 12 rounded half up');
  check('US', 'Emily Carter', e, usHand(8166.67, 8166.67));
  results.push('US: Jordan FIT 2,361.17 SS 852.50 Med 199.38 CA 1,031.46 SDI 178.75; Emily FIT 1,060.83 CA 460.29');
}

section('Japan (jp 2026.1): Kenji Takahashi 1,150,000 (age 48, care) and Haruto Sato 520,000');
{
  const k = await slipOf('Northwind KK', 'E0015');
  check('JP', 'Kenji Takahashi', k, jpHand(1150000, 1150000, 48));
  const h = await slipOf('Northwind KK', 'E0016');
  check('JP', 'Haruto Sato', h, jpHand(520000, 530000, 29));
  eq(h.net_minor, 520000 - 26102 - 609 - 48495 - 2600 - 19140, 'JP Haruto net');
  results.push('JP: Kenji health 56,637 care 9,315 pension 59,475 EI 5,750 tax 141,100; Haruto health 26,102 pension 48,495 tax 19,140');
}

section('India (in 2026.1, new regime): Vikram Mehta 450,000 and Ananya Iyer 140,000');
{
  const v = await slipOf('Northwind India Pvt Ltd', 'E0020');
  check('IN', 'Vikram Mehta', v, inHand(450000));
  const a = await slipOf('Northwind India Pvt Ltd', 'E0021');
  check('IN', 'Ananya Iyer', a, inHand(140000));
  results.push('IN: Vikram TDS 50,700; Ananya TDS 0 (rebate up to 12 lakh)');
}

section('Every run calculated without blockers, with the explanation of each line');
for (const name of Object.keys(runs)) {
  const got = await api.op('payruns.get', { payrun: runs[name].run.id }, O);
  ok(runs[name].done && got.payrun.status === 'calculated', name + ' calculated in ' + runs[name].ms + ' ms (' + got.payrun.employee_count + ' payslips)');
  ok(got.payrun.blockers === 0, name + ' has no blockers', got.payrun.issues_summary);
}
{
  const k = await slipOf('Northwind KK', 'E0016');
  const wht = k.groups.flatMap((g) => g.lines).find((l) => l.code === 'JP_WHT');
  const ex = await api.op('payslips.line', { line: wht.id }, O);
  ok(ex.pack && ex.pack.code === 'jp' && ex.step && ex.line.explain.reads.length > 0, 'a withholding line explains its rule, pack version and every value read', { pack: ex.pack, step: ex.step });
  const base = k.groups.flatMap((g) => g.lines).find((l) => l.code === 'JP_BASE');
  ok(base.explain.source === 'basic' && base.explain.method !== undefined, 'the base pay line explains the proration method and segments');
}

console.log('\nPer country: ' + results.join(' | '));
const s = summary('t02_countries');
process.exitCode = s.failed > 0 ? 1 : 0;
