// Independent hand calculations for the QA payslip checks, written from the
// official rules (sources in each comment). Amounts are minor units of the
// pay currency. These do NOT call the engine or read the packs, except where
// a comment says the figure is the pack's own official vector (AU).

export const cents = (x) => Math.sign(x) * Math.round(Math.abs(x) * 100 + 1e-7);

/* Singapore. CPF Board "CPF contribution and allocation rates from 1 January
 * 2026", Table 1 (Singapore citizens and 3rd year SPR, age 55 and below):
 * employer 17%, employee 20%; Ordinary Wage ceiling S$8,000 a month from
 * 1 January 2026; CPF rounding: total to the nearest dollar (cents of 50 up),
 * employee share down to the dollar, employer = total - employee.
 * SDL: SkillsFuture Singapore, 0.25% of total wages, minimum S$2 (wages up to
 * S$800), maximum S$11.25 (wages from S$4,500).
 * CDAC: Chinese Development Assistance Council monthly contribution by total
 * wages: up to 2,000: 0.50; to 3,500: 1.00; to 5,000: 1.50; to 7,500: 2.00;
 * above 7,500: 3.00. */
export function sg(ow, shg) {
  const owC = Math.min(ow, 8000);
  const total = Math.round(0.37 * owC);
  const ee = Math.floor(0.2 * owC);
  const sdl = ow <= 800 ? 2 : ow >= 4500 ? 11.25 : Math.round(ow * 0.0025 * 100) / 100;
  const out = { SG_CPF_EE: ee * 100, SG_CPF_ER: (total - ee) * 100, SG_SDL: Math.round(sdl * 100) };
  if (shg === 'cdac') out.SG_SHG = Math.round((ow <= 2000 ? 0.5 : ow <= 3500 ? 1 : ow <= 5000 ? 1.5 : ow <= 7500 ? 2 : 3) * 100);
  return out;
}

/* United States, federal. Rev. Proc. 2025-32 (2026 brackets, single: 10% to
 * 12,400; 12% to 50,400; 22% to 105,700; 24% to 201,775; 32% to 256,225; 35%
 * to 640,600; 37% above) and Publication 15-T (2026) Worksheet 1A with a 2020
 * or later W-4, Single, Step 2 unchecked: line 1g subtracts 8,600, and the
 * annual table starts at 7,500 (16,100 standard deduction less 8,600), so the
 * bracket edges are 7,500 + the Rev. Proc. edges. Publication 15 (2026):
 * social security 6.2% employee and employer (wage base 184,500), Medicare
 * 1.45% each, FUTA 0.6% on the first 7,000 of the year (no earlier wages in
 * HR OS this year).
 * California: EDD DE 44 (Rev. 52, 4-26) Method B monthly single, zero
 * allowances: low income exemption 1,575; standard deduction 476; Table 5
 * single monthly brackets (as printed in DE 44; not refetched by QA: no web
 * access): over 0 1.1%; 924: 10.16 + 2.2%; 2,188: 37.97 + 4.4%; 3,454: 93.67 +
 * 6.6%; 4,796: 182.24 + 8.8%; 6,060: 293.47 + 10.23%; 30,956: 2,840.33 +
 * 11.33%. SDI 1.3% (no wage limit in 2026); UI new employer 3.4% and ETT 0.1%
 * on the first 7,000. */
export function us(monthly, opts = {}) {
  const annual = monthly * 12;
  const adj = Math.max(0, annual - 8600);
  const rows = [[0, 0, 0], [7500, 0.1, 0], [19900, 0.12, 1240], [57900, 0.22, 5800], [113200, 0.24, 17966], [209275, 0.32, 41024], [263725, 0.35, 58448]];
  let r = rows[0];
  for (const x of rows) if (adj >= x[0]) r = x;
  const fit = (r[2] + (adj - r[0]) * r[1]) / 12;
  const caTaxable = monthly - 476;
  const ca = [[0, 0.011, 0], [924, 0.022, 10.16], [2188, 0.044, 37.97], [3454, 0.066, 93.67], [4796, 0.088, 182.24], [6060, 0.1023, 293.47], [30956, 0.1133, 2840.33]];
  let c = ca[0];
  for (const x of ca) if (caTaxable > x[0]) c = x;
  const caTax = Math.round((c[2] + (caTaxable - c[0]) * c[1]) * 100) / 100;
  const futaBase = Math.min(7000, monthly + (opts.ytd || 0)) - Math.min(7000, opts.ytd || 0);
  return {
    US_FIT: cents(fit),
    US_SS_EE: cents(monthly * 0.062),
    US_MED_EE: cents(monthly * 0.0145),
    US_SS_ER: cents(monthly * 0.062),
    US_MED_ER: cents(monthly * 0.0145),
    US_FUTA: cents(futaBase * 0.006),
    US_CA_SIT: monthly <= 1575 ? 0 : cents(caTax),
    US_CA_SDI: cents(monthly * 0.013),
    US_CA_UI: cents(futaBase * 0.034),
    US_CA_ETT: cents(futaBase * 0.001),
  };
}
/* US supplemental (bonus run): Pub 15 section 7, optional flat rate 22% under
 * 1,000,000; social security, Medicare as above; CA DE 44: bonuses 10.23%. */
export function usBonus(bonus) {
  return { US_FIT_SUPP: cents(bonus * 0.22), US_SS_EE: cents(bonus * 0.062), US_MED_EE: cents(bonus * 0.0145), US_CA_SIT: cents(bonus * 0.1023), US_CA_SDI: cents(bonus * 0.013) };
}

/* Japan. 協会けんぽ 令和8年度 東京都 health 9.85% (premium months from March
 * 2026), nursing care 1.62% (ages 40 to 64), 子ども・子育て支援金 0.23% (from
 * April 2026 premiums); 厚生年金 18.3% on the 標準報酬月額 within 88,000 to
 * 650,000; employee half, 50 sen or less dropped, over 50 sen raised (保険料額表
 * note). 雇用保険 令和8年度 一般の事業: employee 5/1000 (same rounding).
 * 翌月徴収: the pay of month M carries the premium of month M-1 (健康保険法
 * 167条: a premium is deducted from the pay of the following month), and an
 * employee whose coverage started in month M owes no premium for month M-1,
 * so a new hire's first monthly pay under 翌月徴収 carries no 健康保険, 介護,
 * 支援金 or 厚生年金 premium (only 雇用保険 on the pay itself).
 * 源泉所得税: NTA 令和8年分 電算機計算の特例 (月額, 甲欄): A = pay minus
 * employee social insurance; 給与所得控除 別表第一: A <= 158,333: 54,167; to
 * 299,999: A x 30% + 6,667; to 549,999: A x 20% + 36,667; to 708,330: A x 10% +
 * 91,667; over: 162,500 (yen up); 基礎控除 別表第三 48,334; 扶養 31,667 each;
 * 別表第四 on B: to 162,500 5.105%; over 162,500 10.21% - 8,296; over 275,000
 * 20.42% - 36,374; over 579,166 23.483% - 54,113; over 750,000 33.693% -
 * 130,688; the tax rounded to the nearest 10 yen. */
export function jp(pay, smr, age, opts = {}) {
  const halfDown = (x) => (x - Math.floor(x) > 0.5 + 1e-9 ? Math.ceil(x) : Math.floor(x));
  const si = opts.noPremium !== true;
  const careOn = age >= 40 && age < 65;
  const hcEmp = si ? halfDown(smr * (0.0985 / 2 + (careOn ? 0.0162 / 2 : 0))) : 0;
  const health = si ? halfDown(smr * (0.0985 / 2)) : 0;
  const care = si && careOn ? hcEmp - health : 0;
  const support = si ? halfDown(smr * 0.00115) : 0;
  const pSmr = Math.min(Math.max(smr, 88000), 650000);
  const pension = si ? halfDown(pSmr * 0.0915) : 0;
  const ei = halfDown(pay * 0.005);
  const A = pay - (health + care + support + pension + ei);
  let kyuyo;
  if (A <= 158333) kyuyo = 54167;
  else if (A <= 299999) kyuyo = Math.ceil(A * 0.3 + 6667);
  else if (A <= 549999) kyuyo = Math.ceil(A * 0.2 + 36667);
  else if (A <= 708330) kyuyo = Math.ceil(A * 0.1 + 91667);
  else kyuyo = 162500;
  const B = A - kyuyo - 48334 - 31667 * (opts.dependants || 0);
  const t = [[0, 0.05105, 0], [162500, 0.1021, 8296], [275000, 0.2042, 36374], [579166, 0.23483, 54113], [750000, 0.33693, 130688]];
  let row = t[0];
  for (const x of t) if (B > x[0]) row = x;
  const wht = B <= 0 ? 0 : Math.round((B * row[1] - row[2]) / 10) * 10;
  const er = si ? { JP_HEALTH_ER: Math.floor(smr * (0.0985 + (careOn ? 0.0162 : 0)) - hcEmp + 1e-6), JP_SUPPORT_ER: Math.floor(smr * 0.0023 - support + 1e-6), JP_PENSION_ER: Math.floor(pSmr * 0.183 - pension + 1e-6) } : { JP_HEALTH_ER: 0, JP_SUPPORT_ER: 0, JP_PENSION_ER: 0 };
  // 雇用保険 employer share, MHLW 令和8年度 一般の事業: 8.5/1000 (yen truncated).
  return Object.assign({ JP_HEALTH: health, JP_CARE: care, JP_SUPPORT: support, JP_PENSION: pension, JP_EI: ei, JP_WHT: wht, JP_EI_ER: Math.floor(pay * 0.0085 + 1e-6) }, er);
}

/* India. Income-tax Act 2025 with the Finance Act 2026 rates (tax year
 * 2026-27, unchanged from 2025-26), new regime: 0 to 4 lakh nil, 4 to 8 lakh
 * 5%, 8 to 12 lakh 10%, 12 to 16 lakh 15%, 16 to 20 lakh 20%, 20 to 24 lakh
 * 25%, above 30%; standard deduction 75,000; rebate up to income 12 lakh (with
 * marginal relief: tax at most the income above 12 lakh); cess 4%. Salary
 * TDS: projected year salary (this month's pay times the months left in the
 * tax year including this one, nothing paid earlier in HR OS), tax spread
 * evenly over those months, whole rupees. */
export function ind(monthly, monthsLeft) {
  const income = monthly * monthsLeft - 75000;
  const slabs = [[0, 0], [400000, 0.05], [800000, 0.1], [1200000, 0.15], [1600000, 0.2], [2000000, 0.25], [2400000, 0.3]];
  let tax = 0;
  for (let i = 0; i < slabs.length; i++) {
    const lo = slabs[i][0];
    const hi = i + 1 < slabs.length ? slabs[i + 1][0] : Infinity;
    if (income > lo) tax += (Math.min(income, hi) - lo) * slabs[i][1];
  }
  if (income <= 1200000) tax = 0;
  else tax = Math.min(tax, income - 1200000);
  return { IN_TDS: Math.round((tax * 1.04) / monthsLeft) * 100 };
}

/* Malaysia. LHDN Specification for Monthly Tax Deduction (MTD) computerised
 * calculation (2026, category 1, resident, no EPF because my-epf ships as a
 * draft and is left out of the profile): P = sum(Y - K) of earlier months +
 * (Y1 - K1) + (Y2 - K2) x n - (D + S + Q x C), D = 9,000 individual relief,
 * n = months left after this one; MTD = [(P - M) x R + B - (Z + X)] / (n + 1).
 * Schedule (category 1 and 3, B includes the 400 rebate up to 35,000):
 * 5,001 to 20,000: M 5,000 R 1% B -400; 20,001 to 35,000: M 20,000 R 3% B -250;
 * 35,001 to 50,000: M 35,000 R 6% B 600; 50,001 to 70,000: M 50,000 R 11% B
 * 1,500; 70,001 to 100,000: M 70,000 R 19% B 3,700. Truncated to 2 decimals,
 * rounded up to the next 5 sen; under RM10 nothing is deducted.
 * HRDF (PSMB Act 2001): employer levy 1% of monthly wages of Malaysian
 * employees when the entity is registered at 1%. */
export function my(y, monthIndex, opts = {}) {
  const n = 12 - monthIndex;
  const P = y + y * n - 9000;
  const rows = [[5000, 0, 0], [5000, 0.01, -400], [20000, 0.03, -250], [35000, 0.06, 600], [50000, 0.11, 1500], [70000, 0.19, 3700], [100000, 0.25, 9400]];
  const edges = [0, 5000, 20000, 35000, 50000, 70000, 100000];
  let k = 0;
  for (let i = 0; i < edges.length; i++) if (P > edges[i]) k = i;
  const [M, R, B] = rows[k];
  let mtd = P <= 5000 ? 0 : ((P - M) * R + B) / (n + 1);
  mtd = Math.floor(mtd * 100 + 1e-7) / 100;
  mtd = Math.ceil(mtd * 20 - 1e-7) / 20;
  if (mtd < 10) mtd = 0;
  const out = { MY_PCB: Math.round(mtd * 100) };
  if (opts.hrdf) out.MY_HRDF_ER = cents(y * 0.01);
  return out;
}

/* United Kingdom 2026-27. HMRC: personal allowance 12,570 (code 1257L: free
 * pay a month = (1257 x 10 + 9) / 12 = 1,048.25, cumulative = that x tax
 * month); basic rate 20% on the first 37,700 a year (3,141.67 a month,
 * cumulative by month); taxable pay rounded down to the pound. Class 1 NI
 * (thresholds frozen for 2026-27): primary threshold 1,048 a month, upper
 * earnings limit 4,189, employee 8% between them and 2% above; secondary
 * threshold 417 a month, employer 15% above (from 6 April 2025). Auto
 * enrolment qualifying earnings 6,240 to 50,270 a year (520 to 4,189 a month
 * as the pack documents), defaults 5% employee and 3% employer; net pay
 * arrangement: the employee pension comes off pay before tax. */
export function gb(pay, opts) {
  const pensionEE = opts.pension ? cents(Math.max(0, Math.min(pay, 4189) - 520) * 0.05) / 100 : 0;
  const pensionER = opts.pension ? cents(Math.max(0, Math.min(pay, 4189) - 520) * 0.03) / 100 : 0;
  const taxablePay = pay - pensionEE;
  let tax;
  if (opts.basis === 'month1') {
    const t = Math.floor(taxablePay - 1048.25);
    tax = t <= 0 ? 0 : Math.min(t, 3142) * 0.2 + Math.max(0, t - 3142) * 0.4;
  } else {
    const month = opts.taxMonth;
    const cum = Math.floor((opts.previousTaxable || 0) + taxablePay - 1048.25 * month);
    tax = cum <= 0 ? 0 : Math.min(cum, Math.ceil(3141.6667 * month)) * 0.2 - (opts.previousTax || 0);
    tax = Math.max(0, tax);
  }
  const niEE = Math.max(0, Math.min(pay, 4189) - 1048) * 0.08 + Math.max(0, pay - 4189) * 0.02;
  const niER = Math.max(0, pay - 417) * 0.15;
  const out = { GB_PAYE: cents(tax), GB_NI_EE: Math.floor(niEE * 100 + 1e-7), GB_NI_ER: Math.floor(niER * 100 + 1e-7) };
  if (opts.pension) Object.assign(out, { GB_PENSION_EE: cents(pensionEE), GB_PENSION_ER: cents(pensionER) });
  return out;
}

/* Australia 2026-27: PAYG withholding is the pack's own OFFICIAL vector
 * (Schedule 1 sample data, Federal Register of Legislation, 1 July 2026,
 * scale 2, monthly) for the same monthly earnings; Super Guarantee 12% of
 * ordinary time earnings (SGAA 1992 s 19, 12% from 1 July 2025). */
export function au(monthly, paygw) {
  return { AU_PAYGW: paygw * 100, AU_SG: cents(monthly * 0.12) };
}

/* India EPF under the Code on Social Security 2020 and the 2026 schemes, as
 * the in-epf 2026.2 pack cites them: wage ceiling 25,000 for wage periods
 * starting on or after 17 September 2026 (Gazette S.O. 5109(E)); employee 12%
 * and employer 12% of wages up to the ceiling; EPS 8.33% of wages up to the
 * ceiling from the employer share, employer EPF the rest; EDLI 0.5% up to the
 * ceiling; each to the nearest rupee, 50 paise up. Administrative charges are
 * an entity rate with no default (no line). Wages above the ceiling. */
export function inEpf(wages) {
  const w = Math.min(wages, 25000);
  const r = (x) => Math.floor(x + 0.5);
  const ee = r(w * 0.12);
  const eps = r(w * 0.0833);
  return { IN_PF_EE: ee * 100, IN_EPS_ER: eps * 100, IN_EPF_ER: (r(w * 0.12) - eps) * 100, IN_EDLI_ER: r(w * 0.005) * 100 };
}
