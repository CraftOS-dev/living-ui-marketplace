// Japan pack generator: jp (2026.1) and jp-2027 (2027.1).
import { writeModule, readJson, RETRIEVED } from './emit.mjs';

const D = readJson('jp_data.json');
const KK = readJson('../src/kk_r08_rates.json'); // [name, r07, arrow, r08] in JIS order

const PREFS = [
  ['01', 'Hokkaido', '北海道'], ['02', 'Aomori', '青森'], ['03', 'Iwate', '岩手'], ['04', 'Miyagi', '宮城'], ['05', 'Akita', '秋田'],
  ['06', 'Yamagata', '山形'], ['07', 'Fukushima', '福島'], ['08', 'Ibaraki', '茨城'], ['09', 'Tochigi', '栃木'], ['10', 'Gunma', '群馬'],
  ['11', 'Saitama', '埼玉'], ['12', 'Chiba', '千葉'], ['13', 'Tokyo', '東京'], ['14', 'Kanagawa', '神奈川'], ['15', 'Niigata', '新潟'],
  ['16', 'Toyama', '富山'], ['17', 'Ishikawa', '石川'], ['18', 'Fukui', '福井'], ['19', 'Yamanashi', '山梨'], ['20', 'Nagano', '長野'],
  ['21', 'Gifu', '岐阜'], ['22', 'Shizuoka', '静岡'], ['23', 'Aichi', '愛知'], ['24', 'Mie', '三重'], ['25', 'Shiga', '滋賀'],
  ['26', 'Kyoto', '京都'], ['27', 'Osaka', '大阪'], ['28', 'Hyogo', '兵庫'], ['29', 'Nara', '奈良'], ['30', 'Wakayama', '和歌山'],
  ['31', 'Tottori', '鳥取'], ['32', 'Shimane', '島根'], ['33', 'Okayama', '岡山'], ['34', 'Hiroshima', '広島'], ['35', 'Yamaguchi', '山口'],
  ['36', 'Tokushima', '徳島'], ['37', 'Kagawa', '香川'], ['38', 'Ehime', '愛媛'], ['39', 'Kochi', '高知'], ['40', 'Fukuoka', '福岡'],
  ['41', 'Saga', '佐賀'], ['42', 'Nagasaki', '長崎'], ['43', 'Kumamoto', '熊本'], ['44', 'Oita', '大分'], ['45', 'Miyazaki', '宮崎'],
  ['46', 'Kagoshima', '鹿児島'], ['47', 'Okinawa', '沖縄']
];

function pct(s) {
  // '9.85' -> 0.0985 without float noise
  return Number((Number(s) / 100).toFixed(6));
}

function healthMaps() {
  if (KK.length !== 47) throw new Error('need 47 prefectures');
  const r07 = {}, r08 = {};
  KK.forEach((row, i) => {
    const [code, , ja] = PREFS[i];
    if (!row[0].startsWith(ja)) throw new Error('prefecture order mismatch ' + row[0] + ' ' + ja);
    r07[code] = pct(row[1]);
    r08[code] = pct(row[3]);
  });
  return { r07, r08 };
}

function monthlyTables(m) {
  const body = m.body.map((r) => {
    const values = { otsu: r.otsu };
    r.k.forEach((v, i) => { values['k' + i] = v; });
    return { from: r.from, under: r.under, values };
  });
  const koTop = m.ko_top.map((r) => {
    const values = { at: r.from, rate: Number((r.rate_pct / 100).toFixed(6)) };
    r.k.forEach((v, i) => { values['k' + i] = v; });
    const row = { from: r.from, values };
    if (r.under) row.under = r.under;
    return row;
  });
  const otsuTop = m.otsu_top.map((r) => {
    const row = { from: r.from, values: { at: r.from, base: r.base, rate: Number((r.rate_pct / 100).toFixed(6)) } };
    if (r.under) row.under = r.under;
    return row;
  });
  return { body, koTop, otsuTop };
}

function bonusTables(b) {
  const out = {};
  for (const col of Object.keys(b)) {
    out['jp_bonus_' + col] = {
      type: 'bands',
      rows: b[col].map((r) => {
        const row = {};
        if (r.from !== undefined) row.from = r.from;
        if (r.under !== undefined) row.under = r.under;
        row.value = Number((r.pct / 100).toFixed(6));
        return row;
      })
    };
  }
  return out;
}

function gradeMap() {
  const rows = {};
  for (const g of D.grades) rows[String(g.smr)] = g.grade;
  return { type: 'map', rows, default: 0 };
}

function gradeBands() {
  return {
    type: 'bands',
    rows: D.grades.map((g) => {
      const row = {};
      if (g.from !== null) row.from = g.from;
      if (g.under !== null) row.under = g.under;
      row.values = { grade: g.grade, smr: g.smr };
      return row;
    })
  };
}

const E1 = {
  2026: [{ to: 158333, values: { rate: 0, add: 54167 } }, { over: 158333, to: 299999, values: { rate: 0.3, add: 6667 } }, { over: 299999, to: 549999, values: { rate: 0.2, add: 36667 } }, { over: 549999, to: 708330, values: { rate: 0.1, add: 91667 } }, { over: 708330, values: { rate: 0, add: 162500 } }],
  2027: [{ to: 169444, values: { rate: 0, add: 57500 } }, { over: 169444, to: 299999, values: { rate: 0.3, add: 6667 } }, { over: 299999, to: 549999, values: { rate: 0.2, add: 36667 } }, { over: 549999, to: 708330, values: { rate: 0.1, add: 91667 } }, { over: 708330, values: { rate: 0, add: 162500 } }]
};
const E3 = {
  2026: [{ to: 2120833, value: 48334 }, { over: 2120833, to: 2162499, value: 40000 }, { over: 2162499, to: 2204166, value: 26667 }, { over: 2204166, to: 2245833, value: 13334 }, { over: 2245833, value: 0 }],
  2027: [{ to: 2120833, value: 51667 }, { over: 2120833, to: 2162499, value: 40000 }, { over: 2162499, to: 2204166, value: 26667 }, { over: 2204166, to: 2245833, value: 13334 }, { over: 2245833, value: 0 }]
};
const E4 = [{ over: 0, rate: 0.05105, less: 0 }, { over: 162500, rate: 0.1021, less: 8296 }, { over: 275000, rate: 0.2042, less: 36374 }, { over: 579166, rate: 0.23483, less: 54113 }, { over: 750000, rate: 0.33693, less: 130688 }, { over: 1500000, rate: 0.4084, less: 237893 }, { over: 3333333, rate: 0.45945, less: 408061 }];

// Monthly table tax T(x) for the column, as one expression (x is a var name).
function tableTax(x, col) {
  if (col === 'otsu') {
    return `(${x} <= 0 ? 0 : (${x} < otsu_from ? round_down(${x} * 0.03063, 1) : (${x} < 740000 ? band("jp_monthly", ${x}, "otsu") : round_down(band("jp_otsu_top", ${x}, "base") + (${x} - band("jp_otsu_top", ${x}, "at")) * band("jp_otsu_top", ${x}, "rate"), 1))))`;
  }
  return `max(0, (${x} < otsu_from ? 0 : (${x} < 740000 ? band("jp_monthly", ${x}, kcol) : round_down(band("jp_ko_top", ${x}, kcol) + (${x} - band("jp_ko_top", ${x}, "at")) * band("jp_ko_top", ${x}, "rate"), 1))) - 1610 * max(0, deps - 7))`;
}

function profileFields() {
  return [
    { key: 'jp_column', label: 'Withholding column', type: 'enum', default: 'ko', required: true, form: '給与所得者の扶養控除等申告書', options: [{ value: 'ko', label: '甲 (filed the dependants declaration with this employer)' }, { value: 'otsu', label: '乙 (no declaration here, for example a second job)' }], help: '甲 when the employee gave this employer the 扶養控除等申告書 for the year; otherwise 乙.' },
    { key: 'jp_spouse', label: 'Spouse counted for withholding (源泉控除対象配偶者)', type: 'boolean', default: false, form: '扶養控除等申告書', help: 'Counts as one in 扶養親族等の数.' },
    { key: 'jp_dependants', label: 'Dependants counted for withholding (源泉控除対象親族)', type: 'number', default: 0, min: 0, form: '扶養控除等申告書', help: 'Number of 源泉控除対象親族 on the declaration (control dependants, including 特定親族 counted in withholding). Do not count the spouse here.' },
    { key: 'jp_self_disabled', label: 'Employee is disabled (障害者 or 特別障害者)', type: 'boolean', default: false, form: '扶養控除等申告書', help: 'Adds one to 扶養親族等の数.' },
    { key: 'jp_widow_single_parent', label: 'Employee is a widow or single parent (寡婦 or ひとり親)', type: 'boolean', default: false, form: '扶養控除等申告書', help: 'Adds one to 扶養親族等の数.' },
    { key: 'jp_working_student', label: 'Employee is a working student (勤労学生)', type: 'boolean', default: false, form: '扶養控除等申告書', help: 'Adds one to 扶養親族等の数.' },
    { key: 'jp_dependants_disabled', label: 'Disability additions for the spouse and dependants', type: 'number', default: 0, min: 0, form: '扶養控除等申告書', help: 'One for each 同一生計配偶者 or 扶養親族 who is 障害者 (特別障害者 included), and one more for each who is 同居特別障害者 (NTA table notes).' },
    { key: 'jp_otsu_secondary_dependants', label: 'Dependants on the secondary-pay declaration (乙 only)', type: 'number', default: 0, min: 0, form: '従たる給与についての扶養控除等申告書', help: 'Each one lowers 乙 monthly tax by 1,610 yen.' },
    { key: 'jp_smr', label: 'Standard monthly remuneration (標準報酬月額)', type: 'money', required: true, form: '資格取得届 / 算定基礎届 / 月額変更届', help: 'The health insurance grade amount from the latest 定時決定, 随時改定 or 資格取得時決定, for example 300,000. Pension uses the same amount limited to 88,000 to 650,000.' },
    { key: 'jp_health_insured', label: 'Health insurance insured', type: 'boolean', default: true, help: 'Turn off for people outside 健康保険 (for example aged 75 or over).' },
    { key: 'jp_pension_insured', label: 'Employees pension insured (厚生年金)', type: 'boolean', default: true, help: 'Turn off when the employee is not insured (for example aged 70 or over).' },
    { key: 'jp_care_exempt', label: 'Exempt from nursing care premiums (介護保険適用除外)', type: 'boolean', default: false, help: 'For people aged 40 to 64 who are exempt, for example residents abroad.' },
    { key: 'jp_prefecture', label: '協会けんぽ branch prefecture', type: 'enum', options: PREFS.map(([code, en, ja]) => ({ value: code, label: ja + ' (' + en + ')' })), help: 'The prefecture of the 協会けんぽ branch that covers the employee\'s workplace. Needed when the insurer is 協会けんぽ.' },
    { key: 'jp_ei_insured', label: 'Employment insurance insured (雇用保険)', type: 'boolean', default: true, help: 'Turn off for people outside 雇用保険 (for example directors or students who are not insured).' },
    { key: 'jp_resident_tax_june', label: 'Resident tax, June amount (住民税 6月分)', type: 'money', default: 0, min: 0, form: '特別徴収税額決定通知書', help: 'The first instalment from the municipality notice; it often differs from the other months.' },
    { key: 'jp_resident_tax_monthly', label: 'Resident tax, July to May amount (住民税 7月分以降)', type: 'money', default: 0, min: 0, form: '特別徴収税額決定通知書', help: 'Deducted in each regular run except June. Update the profile each June with the new notice.' },
    { key: 'jp_resident_tax_lump', label: 'Resident tax: collect the rest in one sum on leaving (一括徴収)', type: 'boolean', default: false, help: 'For leavers from June to December who ask for it; January to April leavers always pay the rest up to May from the final pay.' },
    { key: 'jp_insurer', scope: 'entity', label: 'Health insurer', type: 'enum', default: 'kyokai', options: [{ value: 'kyokai', label: '協会けんぽ' }, { value: 'kumiai', label: '健康保険組合 (own rates)' }], help: '協会けんぽ uses the prefecture rate table in this pack; a 健康保険組合 enters its own rates below.' },
    { key: 'jp_kumiai_health_rate', scope: 'entity', label: '健康保険組合: health rate, total', type: 'number', min: 0, max: 0.2, help: 'For example 0.095 for 9.5 percent. Employer plus employee.' },
    { key: 'jp_kumiai_health_employee_rate', scope: 'entity', label: '健康保険組合: health rate, employee share', type: 'number', min: 0, max: 0.2, help: 'For example 0.0425 when the employer pays more than half.' },
    { key: 'jp_kumiai_care_rate', scope: 'entity', label: '健康保険組合: nursing care rate, total', type: 'number', min: 0, max: 0.1 },
    { key: 'jp_kumiai_care_employee_rate', scope: 'entity', label: '健康保険組合: nursing care rate, employee share', type: 'number', min: 0, max: 0.1 },
    { key: 'jp_kumiai_support_rate', scope: 'entity', label: '健康保険組合: 子ども・子育て支援金 rate, total', type: 'number', default: 0.0023, min: 0, max: 0.05, help: 'Set by your insurer; 協会けんぽ uses 0.23 percent from April 2026 premiums.' },
    { key: 'jp_kumiai_support_employee_rate', scope: 'entity', label: '健康保険組合: 子ども・子育て支援金 rate, employee share', type: 'number', default: 0.00115, min: 0, max: 0.05 },
    { key: 'jp_collection', scope: 'entity', label: 'Premium collection month', type: 'enum', default: 'next_month', options: [{ value: 'next_month', label: '翌月徴収 (this month\'s pay carries last month\'s premium)' }, { value: 'same_month', label: '当月徴収 (this month\'s pay carries this month\'s premium)' }] },
    { key: 'jp_ei_business', scope: 'entity', label: 'Employment insurance business type', type: 'enum', default: 'general', options: [{ value: 'general', label: '一般の事業' }, { value: 'agri', label: '農林水産・清酒製造の事業' }, { value: 'construction', label: '建設の事業' }] }
  ];
}

function seedComponents() {
  return [
    { code: 'JP_BASE', name: '基本給 (base pay)', kind: 'earning', stage: '', calc: 'fixed', tags: ['jp_taxable', 'jp_ei_wages'], taxable: true, sort: 10 },
    { code: 'JP_OVERTIME', name: '時間外手当 (overtime)', kind: 'earning', stage: '', calc: 'input', tags: ['jp_taxable', 'jp_ei_wages'], taxable: true, sort: 20 },
    { code: 'JP_ALLOWANCE', name: '諸手当 (taxable allowances)', kind: 'earning', stage: '', calc: 'fixed', tags: ['jp_taxable', 'jp_ei_wages'], taxable: true, sort: 30 },
    { code: 'JP_COMMUTE', name: '通勤手当 (commuting, non-taxable within limits)', kind: 'earning', stage: '', calc: 'fixed', tags: ['jp_ei_wages'], taxable: false, sort: 40 },
    { code: 'JP_BONUS', name: '賞与 (bonus)', kind: 'earning', stage: '', calc: 'input', tags: ['jp_taxable', 'jp_ei_wages', 'jp_si_bonus'], taxable: true, sort: 50 },
    { code: 'LEAVE_EXIT', name: '退職時の未消化有給休暇の精算 (unused leave on leaving)', kind: 'earning', stage: '', calc: 'days', tags: [], taxable: false, sort: 60 }
  ];
}

function steps(year) {
  const s = [];
  const add = (o) => s.push(o);
  // run kinds: salary payments (regular, final pay, extra pay in the month) and bonuses
  add({ var: 'is_regular', expr: 'run.kind == "regular"' });
  add({ var: 'is_bonus', expr: 'run.kind == "bonus"' });
  add({ var: 'is_term', expr: 'run.kind == "termination"' });
  add({ var: 'pays_salary', expr: 'is_regular || is_term || run.kind == "off_cycle" || run.kind == "correction"', explain: 'Salary payments: regular pay, final pay, and extra pay in the month (off-cycle or a correction recomputed by payroll).' });
  add({ check: 'sum("exit_leave_payout") <= 0', issue: 'jp_exit_leave_classify', severity: 'warning', message: 'Unused paid leave settled on leaving (LEAVE_EXIT) is not taxed or charged by this pack. When it is paid because of retirement it is usually 退職所得 (separate withholding with the 退職所得の受給に関する申告書), not 給与; HR must classify it. If it is ordinary pay, add it to 給与 as a taxable component instead.' });
  add({ check: '!pays_salary || run.frequency == "monthly"', issue: 'jp_monthly_only', severity: 'blocker', message: 'The jp pack covers monthly pay (月額表). Semi-monthly, weekly and daily pay (日額表) are not covered.' });
  add({ check: 'coalesce(employee.birth_date, "") != ""', issue: 'jp_birth_date_missing', severity: 'blocker', message: 'Birth date is needed for nursing care premiums (介護保険, ages 40 to 64).' });
  // coverage months: premiums are due for the month of 資格取得 up to the month before 資格喪失 (the day after the last day)
  add({ var: 'coll_next', expr: 'entity.jp_collection != "same_month"' });
  add({ var: 'pay_m', expr: 'month_start(run.pay_date)' });
  add({ var: 'pay_next', expr: 'add_months(pay_m, 1)' });
  add({ var: 'hire_m', expr: 'month_start(coalesce(employee.hire_day, "1900-01-01"))', explain: 'Month of 資格取得 (the employment start).' });
  add({ var: 'leaves', expr: 'coalesce(employee.end_day, "") != ""' });
  add({ var: 'loss_m', expr: 'leaves ? month_start(add_days(employee.end_day, 1)) : "9999-12-01"', explain: 'Month of 資格喪失 (the day after the last day of employment); premiums stop the month before it.' });
  add({ var: 'same_month_join_leave', expr: 'leaves && hire_m == loss_m', explain: '同月得喪: coverage that starts and ends in one month still owes that month.' });
  add({ var: 'done_a', expr: 'ytd_since("jp_prem_month", pay_m) - ytd_since("jp_prem_month", pay_next) > 0 || regular_in_month_code("JP_HEALTH", pay_m) + regular_in_month_code("JP_PENSION", pay_m) > 0', explain: 'An earlier payslip paid in this month already carried the month\'s premium.' });
  add({ var: 'done_b', expr: 'ytd_since("jp_prem_final", pay_m) - ytd_since("jp_prem_final", pay_next) > 0' });
  add({ var: 'pA', expr: 'coll_next ? add_months(pay_m, -1) : pay_m', explain: 'Premium month this pay carries: the previous month under 翌月徴収, this month under 当月徴収.' });
  add({ var: 'onA', expr: 'pays_salary && !done_a && pA >= hire_m && (pA < loss_m || (same_month_join_leave && pA == hire_m))', explain: 'The employee was insured in that month, so its premium is deducted (健康保険法 167条).' });
  add({ var: 'pB', expr: 'pay_m' });
  add({ var: 'onB', expr: 'coll_next && pays_salary && !done_b && leaves && month_start(employee.end_day) <= pay_m && pB >= hire_m && pB < loss_m', explain: 'Leaving at the end of this month under 翌月徴収: no later pay exists, so this month\'s premium is deducted too (前月及びその月).' });
  add({ var: 'bonus_on', expr: 'is_bonus && pB >= hire_m && (pB < loss_m || (same_month_join_leave && pB == hire_m))', explain: 'A bonus owes premiums when the employee is insured in the bonus month.' });
  if (year === 2026) {
    add({ var: 'fyA', expr: 'pA >= "2026-03-01" ? "r08" : "r07"', explain: '協会けんぽ FY2026 (令和8年度) rates apply from March 2026 premiums; earlier months use FY2025.' });
    add({ var: 'fyB', expr: 'pB >= "2026-03-01" ? "r08" : "r07"' });
  } else {
    add({ check: '!(onA && pA >= "2027-03-01") && !((onB || bonus_on) && pB >= "2027-03-01")', issue: 'jp_rates_unpublished', severity: 'blocker', message: 'Health, nursing care and support levy rates for premiums from March 2027 (令和9年度) are not in this pack yet. Update the jp pack before running this payroll.' });
    add({ var: 'fyA', expr: '"r08"', explain: '令和8年度 rates apply to premium months March 2026 to February 2027.' });
    add({ var: 'fyB', expr: '"r08"' });
  }
  add({ var: 'kyokai', expr: 'entity.jp_insurer == "kyokai"' });
  add({ check: '!kyokai || coalesce(profile.jp_prefecture, "") != ""', issue: 'jp_prefecture_missing', severity: 'blocker', message: 'Choose the 協会けんぽ branch prefecture on the employee tax profile.' });
  add({ check: 'kyokai || (coalesce(entity.jp_kumiai_health_rate, -1) >= 0 && coalesce(entity.jp_kumiai_health_employee_rate, -1) >= 0 && coalesce(entity.jp_kumiai_care_rate, -1) >= 0 && coalesce(entity.jp_kumiai_care_employee_rate, -1) >= 0)', issue: 'jp_kumiai_rates_missing', severity: 'blocker', message: 'Enter the 健康保険組合 health and nursing care rates (total and employee share) on the entity.' });
  add({ var: 'pref', expr: 'coalesce(profile.jp_prefecture, "13")' });
  add({ var: 'birth', expr: 'coalesce(employee.birth_date, "1900-01-01")' });
  add({ var: 'm40', expr: 'month_start(add_days(add_months(birth, 480), -1))', explain: 'Month that holds the day before the 40th birthday (40歳に達した日).' });
  add({ var: 'm65', expr: 'month_start(add_days(add_months(birth, 780), -1))', explain: 'Month that holds the day before the 65th birthday (65歳に達した日).' });
  for (const X of ['A', 'B']) {
    add({ var: 'h' + X + '_tot', expr: 'kyokai ? map("jp_health_" + fy' + X + ', pref) : coalesce(entity.jp_kumiai_health_rate, 0)' });
    add({ var: 'h' + X + '_emp', expr: 'kyokai ? h' + X + '_tot / 2 : coalesce(entity.jp_kumiai_health_employee_rate, 0)' });
    add({ var: 'c' + X + '_tot', expr: 'kyokai ? (fy' + X + ' == "r08" ? 0.0162 : 0.0159) : coalesce(entity.jp_kumiai_care_rate, 0)' });
    add({ var: 'c' + X + '_emp', expr: 'kyokai ? c' + X + '_tot / 2 : coalesce(entity.jp_kumiai_care_employee_rate, 0)' });
    add({ var: 's' + X + '_tot', expr: 'p' + X + ' >= "2026-04-01" ? (kyokai ? 0.0023 : entity.jp_kumiai_support_rate) : 0', explain: '子ども・子育て支援金 from April 2026 premiums.' });
    add({ var: 's' + X + '_emp', expr: 'kyokai ? s' + X + '_tot / 2 : (p' + X + ' >= "2026-04-01" ? entity.jp_kumiai_support_employee_rate : 0)' });
    add({ var: 'care' + X, expr: '!profile.jp_care_exempt && p' + X + ' >= m40 && p' + X + ' < m65', explain: '介護保険第2号被保険者 premiums from the month of 40歳到達 to the month before 65歳到達.' });
  }
  add({ check: '!profile.jp_pension_insured || pA < month_start(add_days(add_months(birth, 840), -1))', issue: 'jp_pension_age_70', severity: 'warning', message: 'The employee reached 70 (70歳到達) in or before this premium month. 厚生年金 coverage ends at 70: turn off "Employees pension insured" when it has ended.' });
  add({ check: '!profile.jp_health_insured || pA < month_start(add_months(birth, 900))', issue: 'jp_health_age_75', severity: 'warning', message: 'The employee turned 75 in or before this premium month. 健康保険 ends at 75 (後期高齢者医療): turn off "Health insurance insured" when it has ended.' });
  add({ check: '!(onA || onB) || !profile.jp_health_insured || map("jp_smr_grade", profile.jp_smr) > 0', issue: 'jp_smr_not_a_grade', severity: 'blocker', message: 'Standard monthly remuneration (標準報酬月額) must be one of the 50 health insurance grade amounts (58,000 to 1,390,000).' });
  add({ var: 'smr_h', expr: 'profile.jp_health_insured && (onA || onB) ? profile.jp_smr : 0' });
  add({ var: 'smr_p', expr: 'profile.jp_pension_insured && (onA || onB) ? clamp(profile.jp_smr, 88000, 650000) : 0', explain: 'Pension grades run from 88,000 (grade 1) to 650,000 (grade 32).' });
  // bonus standard amounts
  add({ var: 'std_bonus', expr: 'bonus_on ? round_down(sum("jp_si_bonus"), 1000) : 0', explain: '標準賞与額: the bonus with amounts under 1,000 yen dropped.' });
  add({ var: 'fy_start', expr: 'text(year(run.pay_date) - (month(run.pay_date) < 4 ? 1 : 0)) + "-04-01"' });
  add({ var: 'std_h', expr: 'bonus_on && profile.jp_health_insured ? min(std_bonus, max(0, 5730000 - ytd_since("jp_std_bonus_health", fy_start))) : 0', explain: 'Health insurance standard bonus, capped at 5,730,000 yen a fiscal year (April to March).' });
  add({ var: 'std_p', expr: 'bonus_on && profile.jp_pension_insured ? min(std_bonus, max(0, 1500000 - (ytd_since("jp_std_bonus_pension", pay_m) - ytd_since("jp_std_bonus_pension", pay_next)))) : 0', explain: 'Pension standard bonus, capped at 1,500,000 yen a payment month.' });
  add({ code: 'JP_STD_BONUS_HEALTH', name: '標準賞与額 (健康保険)', kind: 'info', amount: 'std_h', round: { mode: 'down', step: 1 }, tags: ['jp_std_bonus_health'] });
  add({ code: 'JP_STD_BONUS_PENSION', name: '標準賞与額 (厚生年金)', kind: 'info', amount: 'std_p', round: { mode: 'down', step: 1 }, tags: ['jp_std_bonus_pension'] });
  // each premium month (A, B) and the bonus (O, at month B rates): employee shares drop 50 sen or less, health and care rounded together
  const part = (P, on, X, bh, bp) => {
    add({ var: P + '_hc', expr: on + ' ? round_half_down(' + bh + ' * (h' + X + '_emp + (care' + X + ' ? c' + X + '_emp : 0)), 1) : 0' });
    add({ var: P + '_h', expr: on + ' ? round_half_down(' + bh + ' * h' + X + '_emp, 1) : 0' });
    add({ var: P + '_s', expr: on + ' ? round_half_down(' + bh + ' * s' + X + '_emp, 1) : 0' });
    add({ var: P + '_p', expr: on + ' ? round_half_down(' + bp + ' * 0.0915, 1) : 0' });
    add({ var: P + '_hc_tot', expr: on + ' ? ' + bh + ' * (h' + X + '_tot + (care' + X + ' ? c' + X + '_tot : 0)) : 0' });
    add({ var: P + '_s_tot', expr: on + ' ? ' + bh + ' * s' + X + '_tot : 0' });
    add({ var: P + '_p_tot', expr: on + ' ? ' + bp + ' * 0.183 : 0' });
  };
  part('a', 'onA', 'A', 'smr_h', 'smr_p');
  part('b', 'onB', 'B', 'smr_h', 'smr_p');
  part('o', 'bonus_on', 'B', 'std_h', 'std_p');
  add({ code: 'JP_HEALTH', name: '健康保険料', kind: 'deduction', stage: 'statutory', amount: 'a_h + b_h + o_h', round: { mode: 'half_down', step: 1 }, tags: ['jp_si_employee'], payee: '協会けんぽ / 健康保険組合', filing: 'jp_shakai_hoken', explain: 'Standard monthly remuneration (or standard bonus) times the employee health rate for each premium month this pay carries; 50 sen or less dropped.' });
  add({ code: 'JP_CARE', name: '介護保険料', kind: 'deduction', stage: 'statutory', amount: '(a_hc - a_h) + (b_hc - b_h) + (o_hc - o_h)', round: { mode: 'half_down', step: 1 }, tags: ['jp_si_employee'], payee: '協会けんぽ / 健康保険組合', filing: 'jp_shakai_hoken', explain: 'Combined health and nursing care employee share less the health share.' });
  add({ code: 'JP_SUPPORT', name: '子ども・子育て支援金', kind: 'deduction', stage: 'statutory', amount: 'a_s + b_s + o_s', round: { mode: 'half_down', step: 1 }, tags: ['jp_si_employee'], payee: '協会けんぽ / 健康保険組合', filing: 'jp_shakai_hoken', explain: 'Shown on its own line as the government asks.' });
  add({ code: 'JP_PENSION', name: '厚生年金保険料', kind: 'deduction', stage: 'statutory', amount: 'a_p + b_p + o_p', round: { mode: 'half_down', step: 1 }, tags: ['jp_si_employee'], payee: '日本年金機構', filing: 'jp_shakai_hoken', explain: '18.3 percent split in half (9.15 percent each).' });
  add({ code: 'JP_HEALTH_ER', name: '健康保険料 (事業主)', kind: 'employer', amount: '(a_hc_tot - a_hc) + (b_hc_tot - b_hc) + (o_hc_tot - o_hc)', round: { mode: 'down', step: 1 }, payee: '協会けんぽ / 健康保険組合', filing: 'jp_shakai_hoken', explain: 'Total premium less the employee share (care included when it applies).' });
  add({ code: 'JP_SUPPORT_ER', name: '子ども・子育て支援金 (事業主)', kind: 'employer', amount: '(a_s_tot - a_s) + (b_s_tot - b_s) + (o_s_tot - o_s)', round: { mode: 'down', step: 1 }, payee: '協会けんぽ / 健康保険組合', filing: 'jp_shakai_hoken' });
  add({ code: 'JP_PENSION_ER', name: '厚生年金保険料 (事業主)', kind: 'employer', amount: '(a_p_tot - a_p) + (b_p_tot - b_p) + (o_p_tot - o_p)', round: { mode: 'down', step: 1 }, payee: '日本年金機構', filing: 'jp_shakai_hoken' });
  add({ code: 'JP_PREM_MONTH', name: '社会保険料の対象月 (標準報酬月額)', kind: 'info', when: 'onA', amount: 'max(smr_h, smr_p, 1)', round: { mode: 'down', step: 1 }, tags: ['jp_prem_month'], explain: 'Marks that this pay carried a month\'s premium, so a second pay in the month does not charge it again.' });
  add({ code: 'JP_PREM_FINAL', name: '社会保険料 退職月分 (標準報酬月額)', kind: 'info', when: 'onB', amount: 'max(smr_h, smr_p, 1)', round: { mode: 'down', step: 1 }, tags: ['jp_prem_final'] });
  // employment insurance by wage closing date
  if (year === 2026) {
    add({ var: 'ei_fy', expr: 'run.period_end >= "2026-04-01" ? "r08" : "r07"', explain: 'Employment insurance rates change on 1 April by wage closing date (賃金締切日).' });
  } else {
    add({ check: 'run.period_end < "2027-04-01"', issue: 'jp_ei_rates_unpublished', severity: 'blocker', message: 'Employment insurance rates for wage closing dates from 1 April 2027 (令和9年度) are not in this pack yet. Update the jp pack first.' });
    add({ var: 'ei_fy', expr: '"r08"' });
  }
  add({ var: 'ei_key', expr: 'coalesce(entity.jp_ei_business, "general") + ":" + ei_fy' });
  add({ var: 'ei_wages', expr: 'profile.jp_ei_insured && (pays_salary || is_bonus) ? sum("jp_ei_wages") : 0' });
  add({ code: 'JP_EI', name: '雇用保険料', kind: 'deduction', stage: 'statutory', amount: 'ei_wages * map("jp_ei_rates", ei_key, "employee")', round: { mode: 'half_down', step: 1 }, tags: ['jp_si_employee'], payee: '労働保険', filing: 'jp_rodo_hoken', explain: 'Wages actually paid this run times the employee rate; 50 sen or less dropped.' });
  add({ code: 'JP_EI_ER', name: '雇用保険料 (事業主)', kind: 'employer', amount: 'ei_wages * map("jp_ei_rates", ei_key, "employer")', round: { mode: 'down', step: 1 }, payee: '労働保険', filing: 'jp_rodo_hoken' });
  // withholding: salary paid in the month is taxed together (月額表), less tax already withheld this month
  add({ var: 'A', expr: 'sum("jp_taxable") - sum("jp_si_employee") - sum("jp_si_other")', explain: '社会保険料等控除後の給与等の金額 of this payslip.' });
  add({ var: 'A_before', expr: 'pays_salary ? regular_in_month("jp_taxable", run.pay_date) - regular_in_month("jp_si_employee", run.pay_date) - regular_in_month("jp_si_other", run.pay_date) : 0', explain: 'Regular pay already paid this month, after insurance.' });
  add({ var: 'wht_before', expr: 'pays_salary ? regular_in_month_code("JP_WHT", run.pay_date) : 0' });
  add({ var: 'AM', expr: 'A + A_before', explain: 'The month\'s salary after insurance.' });
  add({ var: 'deps', expr: '(profile.jp_spouse ? 1 : 0) + profile.jp_dependants + (profile.jp_self_disabled ? 1 : 0) + (profile.jp_widow_single_parent ? 1 : 0) + (profile.jp_working_student ? 1 : 0) + profile.jp_dependants_disabled', explain: '扶養親族等の数 as the NTA table notes count it.' });
  add({ var: 'kcol', expr: '"k" + text(min(deps, 7))' });
  add({ var: 'otsu_from', expr: String(D[String(year)].monthly.first_from), explain: 'The first row of the 月額表 (below it, 甲 is 0 and 乙 is 3.063 percent).' });
  add({ var: 'ko', expr: 'profile.jp_column == "ko"' });
  // monthly 甲: electronic computation rule
  add({ var: 'e_kyuyo', when: 'pays_salary && ko', expr: 'AM <= 0 ? 0 : round_up(AM * band("jp_e1", AM, "rate") + band("jp_e1", AM, "add"), 1)', explain: '別表第一 給与所得控除の額, fractions of a yen rounded up.' });
  add({ var: 'e_kiso', when: 'pays_salary && ko', expr: 'band("jp_e3", AM)', explain: '別表第三 基礎控除の額.' });
  add({ var: 'e_B', when: 'pays_salary && ko', expr: 'AM - e_kyuyo - e_kiso - 31667 * deps', explain: '課税給与所得金額 B: 別表第二 deducts 31,667 yen for each person in 扶養親族等の数.' });
  add({ var: 'tax_ko_month', when: 'pays_salary && ko', expr: 'e_B <= 0 ? 0 : round_to(table("jp_e4", e_B), 10)', explain: '別表第四, rounded to the nearest 10 yen.' });
  add({ var: 'tax_otsu_month', when: 'pays_salary && !ko', expr: 'max(0, ' + tableTax('AM', 'otsu') + ' - 1610 * profile.jp_otsu_secondary_dependants)', explain: '月額表 乙欄, less 1,610 yen per dependant on a secondary-pay declaration.' });
  // bonus withholding (NTA Tax Answer 2523): previous calendar month's ordinary pay
  add({ var: 'prev_day', expr: 'add_months(pay_m, -1)' });
  add({ var: 'prev_net', expr: 'regular_count_in_month(prev_day) > 0 ? regular_in_month("jp_taxable", prev_day) - regular_in_month("jp_si_employee", prev_day) - regular_in_month("jp_si_other", prev_day) : 0', explain: '前月中の社会保険料等控除後の給与等の金額.' });
  add({ var: 'bk', expr: 'coalesce(context.jp_bonus_over_6_months, false) ? 12 : 6', explain: 'Divide by 12 when the bonus covers more than six months.' });
  add({ var: 'b_exception', expr: 'prev_net <= 0 || A > 10 * prev_net', explain: 'No previous-month pay, or a bonus over 10 times it: the 月額表 method.' });
  add({ var: 'b_rate', when: 'is_bonus', expr: 'b_exception ? 0 : (ko ? band("jp_bonus_" + kcol, prev_net) : band("jp_bonus_otsu", prev_net))', explain: '賞与に対する源泉徴収税額の算出率の表.' });
  add({ var: 'bx1', when: 'is_bonus', expr: 'prev_net + A / bk' });
  add({ var: 'bx0', when: 'is_bonus', expr: 'prev_net' });
  add({ var: 'b_t1', when: 'is_bonus', expr: 'ko ? ' + tableTax('bx1', 'ko') + ' : ' + tableTax('bx1', 'otsu') });
  add({ var: 'b_t0', when: 'is_bonus', expr: 'bx0 <= 0 ? 0 : (ko ? ' + tableTax('bx0', 'ko') + ' : ' + tableTax('bx0', 'otsu') + ')' });
  add({ var: 'tax_bonus', when: 'is_bonus', expr: 'A <= 0 ? 0 : (b_exception ? max(0, (b_t1 - b_t0) * bk) : round_down(A * b_rate, 1))' });
  add({ code: 'JP_WHT', name: '源泉所得税', kind: 'deduction', stage: 'statutory', when: 'pays_salary || is_bonus', amount: 'is_bonus ? tax_bonus : max(0, (ko ? tax_ko_month : tax_otsu_month) - wht_before)', round: { mode: 'down', step: 1 }, tags: ['jp_wht'], payee: '税務署', filing: 'jp_gensen', explain: 'Income tax and the 2.1 percent surtax together (the tables already hold 102.1 percent); a second salary payment in the month pays the tax on the month\'s total less tax already withheld.' });
  // resident tax: one instalment a month; on leaving, the rest up to May in one sum (January to April leavers always)
  add({ var: 'rt_month', expr: 'month(run.pay_date) == 6 ? profile.jp_resident_tax_june : profile.jp_resident_tax_monthly' });
  add({ var: 'rt_inst', expr: '(is_regular || is_term) && regular_in_month_code("JP_RESIDENT_TAX", run.pay_date) == 0 ? rt_month : 0', explain: 'One instalment a month: none when a regular pay this month already took it.' });
  add({ var: 'rt_left', expr: 'month(run.pay_date) <= 5 ? 5 - month(run.pay_date) : 17 - month(run.pay_date)', explain: 'Instalments after this month up to May.' });
  add({ var: 'rt_lump', expr: 'is_term && (month(run.pay_date) <= 4 || profile.jp_resident_tax_lump) ? profile.jp_resident_tax_monthly * rt_left : 0', explain: '一括徴収: required for leavers from January to April, on request otherwise.' });
  add({ code: 'JP_RESIDENT_TAX', name: '住民税', kind: 'deduction', stage: 'post', when: 'is_regular || is_term', amount: 'rt_inst + rt_lump', round: { mode: 'down', step: 1 }, tags: ['jp_resident_tax'], payee: '市区町村', filing: 'jp_juminzei', explain: '特別徴収: June uses the June amount, other months the monthly amount; final pay adds the lump sum when it applies.' });
  return s;
}

function tables(year) {
  const m = monthlyTables(D[String(year)].monthly);
  const hm = healthMaps();
  const t = {
    jp_e1: { type: 'bands', rows: E1[year] },
    jp_e3: { type: 'bands', rows: E3[year] },
    jp_e4: { type: 'brackets', rows: E4 },
    jp_monthly: { type: 'bands', rows: m.body },
    jp_ko_top: { type: 'bands', rows: m.koTop },
    jp_otsu_top: { type: 'bands', rows: m.otsuTop },
    jp_health_r08: { type: 'map', rows: hm.r08 },
    jp_ei_rates: { type: 'map', rows: year === 2026 ? {
      'general:r07': { employee: 0.0055, employer: 0.009 }, 'agri:r07': { employee: 0.0065, employer: 0.01 }, 'construction:r07': { employee: 0.0065, employer: 0.011 },
      'general:r08': { employee: 0.005, employer: 0.0085 }, 'agri:r08': { employee: 0.006, employer: 0.0095 }, 'construction:r08': { employee: 0.006, employer: 0.0105 }
    } : {
      'general:r08': { employee: 0.005, employer: 0.0085 }, 'agri:r08': { employee: 0.006, employer: 0.0095 }, 'construction:r08': { employee: 0.006, employer: 0.0105 }
    } },
    jp_smr_grade: gradeMap(),
    jp_smr_bands: gradeBands()
  };
  if (year === 2026) t.jp_health_r07 = { type: 'map', rows: hm.r07 };
  Object.assign(t, bonusTables(D[String(year)].bonus));
  return t;
}

function sources(year) {
  const y = year === 2026 ? '2026' : '2027';
  const reiwa = year === 2026 ? '令和8年分' : '令和9年分';
  return [
    { title: 'NTA ' + reiwa + ' 源泉徴収税額表: 月額表の甲欄を適用する給与等に対する源泉徴収税額の電算機計算の特例 (p.18)', url: 'https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo' + y + '/data/18.pdf', retrieved: RETRIEVED, note: '別表第一 to 別表第四; 給与所得控除 rounded up; tax rounded to the nearest 10 yen.' },
    { title: 'NTA ' + reiwa + ' 給与所得の源泉徴収税額表 月額表 (Excel)', url: 'https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo' + y + '/data/01-07.' + (year === 2026 ? 'xls' : 'xlsx'), retrieved: RETRIEVED, note: '甲 and 乙 columns transcribed by program from the official file; rules for more than 7 dependants and disability additions from its notes.' },
    { title: 'NTA ' + reiwa + ' 賞与に対する源泉徴収税額の算出率の表 (Excel)', url: 'https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo' + y + '/data/15-16.xls', retrieved: RETRIEVED, note: 'Rates by previous-month pay; note 4 sends large bonuses and no previous pay to the 月額表.' },
    { title: 'NTA Tax Answer No.2523 賞与に対する源泉徴収', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2523.htm', retrieved: '2026-11-04', note: 'Divide by 6 (12 when the period exceeds six months) and multiply back. Cited from the research notes.' },
    { title: '協会けんぽ 令和8年度 都道府県単位保険料率 (and 令和7年度 column)', url: 'https://www.kyoukaikenpo.or.jp/about/business/insurance_rate/rate_prefectures/r08/', retrieved: RETRIEVED, note: 'From March 2026 premiums; 介護 1.62 percent; 子ども・子育て支援金 0.23 percent from April 2026 premiums.' },
    { title: '協会けんぽ 令和7年度 保険料率', url: 'https://www.kyoukaikenpo.or.jp/about/business/insurance_rate/rate_prefectures/r07/', retrieved: RETRIEVED, note: '介護 1.59 percent for March 2025 to February 2026 premiums.' },
    { title: '協会けんぽ 令和8年3月分からの保険料額表 (r8ippan3.xlsx)', url: 'https://www.kyoukaikenpo.or.jp/assets/r8ippan3.xlsx', retrieved: RETRIEVED, note: '50 health grades, 32 pension grades, 18.3 percent pension, and the rule: employee share deducted from pay drops 50 sen or less and raises over 50 sen.' },
    { title: '厚生労働省 令和8年度 雇用保険料率のご案内', url: 'https://www.mhlw.go.jp/content/001692566.pdf', retrieved: RETRIEVED, note: 'FY2026 and FY2025 rates for general, agriculture and sake, and construction.' },
    { title: '日本年金機構 賞与を支給したとき', url: 'https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/20141203.html', retrieved: '2026-11-04', note: '標準賞与額 drops amounts under 1,000 yen; caps 5,730,000 yen a fiscal year (health) and 1,500,000 yen a month (pension). Cited from the research notes.' },
    { title: '文京区 特別徴収義務者の方へ', url: 'https://www.city.bunkyo.lg.jp/b008/p000351/index.html', retrieved: '2026-11-04', note: 'Resident tax in 12 instalments June to May, paid by the 10th of the next month. Cited from the research notes.' }
  ];
}

function notes(year) {
  const common = 'Covers: monthly 甲 withholding by the electronic computation rule (電算機計算の特例), monthly 乙 by the official 月額表, bonus withholding by the official rate table with the 月額表 exceptions (NTA 2523, previous calendar month\'s pay read with regular_in_month), health insurance (協会けんぽ by prefecture, or a 健康保険組合 with entity rates), nursing care for ages 40 to 64 from the birth date, 子ども・子育て支援金 on its own line, employees pension 18.3 percent with the standard monthly remuneration (profile) and standard bonus caps, employment insurance by business type and wage closing date, and resident tax as two profile amounts. Run kinds: regular pay, final pay (termination) and extra pay in the month (off-cycle; payroll recomputes corrections with the original kind) all get employment insurance on their wages and 源泉 on the month\'s salary less tax already withheld this month; bonuses get bonus premiums and bonus tax; reimbursement runs get nothing. Coverage months: a premium is deducted only for a month the employee was insured (資格取得 month up to the month before 資格喪失, the day after the last day; 同月得喪 owes the month), so a new hire\'s first pay under 翌月徴収 carries none, and a premium month is deducted once per pay month (info line JP_PREM_MONTH); leaving at a month end under 翌月徴収, the final pay also carries that month (前月及びその月, 健康保険法 167条, info line JP_PREM_FINAL). Final pay adds the resident tax lump sum up to May for January to April leavers (and on request otherwise). Unused leave settled on leaving (LEAVE_EXIT) is left out of 給与, insurance and employment insurance with a warning (jp_exit_leave_classify): no official source on its classification was read this session; it is usually 退職所得 when paid because of retirement, which this pack does not compute. Rounding of employee shares: 50 sen or less dropped, over 50 sen raised (協会けんぽ table note); the same rule is applied to employment insurance. Not covered: year-end adjustment (pack jp-yea), 日額表 pay (weekly, daily, semi-monthly), retirement income (退職所得: do not tag severance jp_taxable), 子ども・子育て拠出金 (employer only, not on payslips), workers accident insurance (employer only), 定額減税 style credits, part-time coverage tests, the pension refund rule for 同月得喪. The age checks at 70 and 75 are warnings: turn the insured flags off when coverage ends.';
  if (year === 2026) return common + ' Premium months before March 2026 use the 令和7年度 rates; wage closing dates before 1 April 2026 use the FY2025 employment insurance rates.';
  return common + ' 令和9年分 withholding tables (pay from 1 January 2027, including the 1 percent defence surtax inside the unchanged 102.1 percent). Social insurance uses 令和8年度 rates, which run to February 2027 premiums: premiums from March 2027 and employment insurance from 1 April 2027 raise a blocker until a new version adds the FY2027 rates. The pension grade 33 (680,000 yen) from September 2027 is not included.';
}

function filings() {
  return [
    { code: 'jp_gensen', name: '源泉所得税の納付 (所得税徴収高計算書)', frequency: 'monthly', due_rule: '10th of the month after payment (納期の特例: 10 July and 20 January for small employers)', form: '給与所得・退職所得等の所得税徴収高計算書' },
    { code: 'jp_shakai_hoken', name: '健康保険・厚生年金保険料の納付', frequency: 'monthly', due_rule: 'end of the following month (納入告知書)', form: '納入告知書' },
    { code: 'jp_juminzei', name: '住民税 特別徴収 納入', frequency: 'monthly', due_rule: '10th of the following month, per municipality', form: '納入書 / eLTAX' },
    { code: 'jp_santei', name: '算定基礎届', frequency: 'yearly', due_rule: '1 to 10 July', form: '被保険者報酬月額算定基礎届' },
    { code: 'jp_shoyo_todoke', name: '賞与支払届', frequency: 'per_bonus', due_rule: 'within 5 days of the bonus payment', form: '被保険者賞与支払届' },
    { code: 'jp_rodo_hoken', name: '労働保険 年度更新', frequency: 'yearly', due_rule: '1 June to 10 July', form: '労働保険概算・確定保険料申告書' },
    { code: 'jp_hotei_chosho', name: '源泉徴収票 and 給与支払報告書', frequency: 'yearly', due_rule: '31 January', form: '源泉徴収票 / 給与支払報告書 (eLTAX)' }
  ];
}

function vectorsFor(year) {
  const V = [];
  const T = (n) => D[String(year)].monthly.body.find((r) => r.from <= n && n < r.under);
  const noSI = { jp_health_insured: false, jp_pension_insured: false, jp_ei_insured: false, jp_prefecture: '13', jp_smr: 300000 };
  const ent = { jp_insurer: 'kyokai', jp_collection: 'next_month', jp_ei_business: 'general' };
  const pay = year === 2026 ? '2026-06' : '2027-01';
  const run = { period_start: pay + '-01', period_end: pay + (year === 2026 ? '-30' : '-31'), pay_date: pay + '-25' };
  const base = (amt) => [{ code: 'JP_BASE', name: '基本給', kind: 'earning', amount: amt, tags: ['jp_taxable', 'jp_ei_wages'] }];
  // 乙 table rows (official table values)
  for (const a of [200000, 300000, 450000]) {
    const r = T(a);
    V.push({ name: '乙 monthly, ' + a + ' yen after social insurance', source: 'official', reference: 'NTA ' + year + ' 月額表 乙欄, row ' + r.from + ' to under ' + r.under + ' prints ' + r.otsu + ' yen', input: { run, employee: { birth_date: '1990-04-15' }, profile: Object.assign({ jp_column: 'otsu' }, noSI), entity: ent, lines: base(a) }, expect: { JP_WHT: r.otsu } });
  }
  // 乙 above 740,000: formula
  const ot = D[String(year)].monthly.otsu_top[0];
  const a1 = 800000;
  const v1 = Math.floor(ot.base + (a1 - ot.from) * ot.rate_pct / 100);
  V.push({ name: '乙 monthly, 800,000 yen (formula region)', source: 'official', reference: 'NTA ' + year + ' 月額表 乙欄: ' + ot.base + ' yen plus ' + ot.rate_pct + ' percent of the amount over ' + ot.from + ' = ' + ot.base + ' + 60,000 x ' + ot.rate_pct + '% = ' + v1 + ' (yen fractions dropped)', input: { run, employee: { birth_date: '1990-04-15' }, profile: Object.assign({ jp_column: 'otsu' }, noSI), entity: ent, lines: base(a1) }, expect: { JP_WHT: v1 } });
  // 甲 electronic, with social insurance, Tokyo, spouse + 1 dependant
  const h = 14775, sup = year === 2026 ? 345 : 345, pen = 27450, ei = 1500;
  const A = 300000 - h - sup - pen - ei;
  const kyuyo = Math.ceil(A * 0.3 + 6667);
  const kiso = year === 2026 ? 48334 : 51667;
  const B = A - kyuyo - kiso - 31667 * 2;
  const tax = Math.round(B * 0.05105 / 10) * 10;
  V.push({ name: '甲 monthly, Tokyo, 300,000 yen, spouse and one dependant', source: 'derived', reference: 'SMR 300,000: health 9.85%/2 = 14,775; support 0.23%/2 = 345; pension 9.15% = 27,450; EI 0.5% = 1,500 (協会けんぽ 保険料額表 東京 grade 22 prints 14,775, 345 and 27,450). A = ' + A + '. 別表第一 ' + A + ' x 30% + 6,667 = ' + kyuyo + '; 別表第三 ' + kiso + '; 別表第二 31,667 x 2; B = ' + B + '; 別表第四 B x 5.105% = ' + (B * 0.05105).toFixed(3) + ', nearest 10 yen = ' + tax + '. Resident tax (' + (year === 2026 ? 'June' : 'January') + ') from the profile.', input: { run, employee: { birth_date: '1990-04-15' }, profile: { jp_column: 'ko', jp_spouse: true, jp_dependants: 1, jp_prefecture: '13', jp_smr: 300000, jp_resident_tax_june: 12000, jp_resident_tax_monthly: 11500 }, entity: ent, lines: base(300000) }, expect: { JP_HEALTH: h, JP_SUPPORT: sup, JP_PENSION: pen, JP_EI: ei, JP_WHT: tax, JP_RESIDENT_TAX: year === 2026 ? 12000 : 11500, JP_HEALTH_ER: 14775, JP_PENSION_ER: 27450, JP_EI_ER: 2550 } });
  // grade 1 rounding: 58,000 x 9.85% / 2 = 2,856.5 -> 2,856 (50 sen or less dropped)
  V.push({ name: 'Grade 1 health share rounds 2,856.5 down', source: 'official', reference: '協会けんぽ 東京 grade 1 (58,000): 折半額 2,856.5; deducted from pay, 50 sen or less is dropped = 2,856. Pension uses grade 1 of pension (88,000) = 8,052.', input: { run, employee: { birth_date: '1990-04-15' }, profile: { jp_column: 'ko', jp_prefecture: '13', jp_smr: 58000, jp_ei_insured: false }, entity: ent, lines: base(60000) }, expect: { JP_HEALTH: 2856, JP_PENSION: 8052, JP_WHT: 0 } });
  // QA fix round 1: coverage months, final pay, extra pay in the month (both years)
  const y = String(year);
  const tok = { jp_column: 'ko', jp_prefecture: '13' };
  const m1 = year === 2026 ? '11' : '01';
  const m2 = year === 2026 ? '12' : '02';
  const end1 = year === 2026 ? '30' : '31';
  const end2 = year === 2026 ? '31' : '28';
  const prevName = year === 2026 ? 'October' : 'December 2026';
  V.push({ name: 'QA B-1: new hire on the 1st, first pay under 翌月徴収 carries no premium', source: 'derived', reference: 'Hired ' + y + '-' + m1 + '-01, pay ' + y + '-' + m1 + '-25, 400,000, SMR 410,000, Tokyo, 翌月徴収: this pay carries the ' + prevName + ' premium, and the employee was not insured then (健康保険法 167条: the premium deducted is the previous month\'s), so no health, support or pension. EI 400,000 x 5/1000 = 2,000. A = 398,000; 別表第一 398,000 x 20% + 36,667 = 116,267; 基礎控除 ' + (year === 2026 ? '48,334' : '51,667') + '; B = ' + (year === 2026 ? '233,399; x 10.21% - 8,296 = 15,534.04, nearest 10 = 15,530' : '230,066; x 10.21% - 8,296 = 15,193.74, nearest 10 = 15,190') + '.', input: { run: { period_start: y + '-' + m1 + '-01', period_end: y + '-' + m1 + '-' + end1, pay_date: y + '-' + m1 + '-25' }, employee: { birth_date: '1990-04-15', hire_day: y + '-' + m1 + '-01' }, profile: Object.assign({ jp_smr: 410000 }, tok), entity: ent, lines: base(400000) }, expect: { JP_HEALTH: 0, JP_SUPPORT: 0, JP_PENSION: 0, JP_EI: 2000, JP_WHT: year === 2026 ? 15530 : 15190 } });
  V.push({ name: 'New hire under 当月徴収: the first pay carries its own month', source: 'derived', reference: 'Same hire under 当月徴収: the first pay carries its own month (insured from the 1st): health 410,000 x 9.85% / 2 = 20,192.5, 50 sen or less dropped 20,192; support 471.5 = 471; pension 37,515.', input: { run: { period_start: y + '-' + m1 + '-01', period_end: y + '-' + m1 + '-' + end1, pay_date: y + '-' + m1 + '-25' }, employee: { birth_date: '1990-04-15', hire_day: y + '-' + m1 + '-01' }, profile: Object.assign({ jp_smr: 410000 }, tok), entity: Object.assign({}, ent, { jp_collection: 'same_month' }), lines: base(400000) }, expect: { JP_HEALTH: 20192, JP_SUPPORT: 471, JP_PENSION: 37515, JP_EI: 2000 } });
  V.push({ name: 'New hire, second pay under 翌月徴収 carries the hire month', source: 'derived', reference: 'Hired ' + y + '-' + m1 + '-01: the next pay carries the hire month\'s premium: health 20,192, support 471, pension 37,515.', input: { run: { period_start: y + '-' + m2 + '-01', period_end: y + '-' + m2 + '-' + end2, pay_date: y + '-' + m2 + '-25' }, employee: { birth_date: '1990-04-15', hire_day: y + '-' + m1 + '-01' }, profile: Object.assign({ jp_smr: 410000 }, tok), entity: ent, lines: base(400000) }, expect: { JP_HEALTH: 20192, JP_SUPPORT: 471, JP_PENSION: 37515 } });
  if (year === 2026) {
    V.push({ name: 'QA B-2: final pay, last day 15 December', source: 'derived', reference: 'Final pay run (termination), last day 2026-12-15, so 資格喪失 is 2026-12-16 and December owes no premium; under 翌月徴収 the final pay carries November: SMR 440,000 Tokyo: health 440,000 x 4.925% = 21,670; support 440,000 x 0.115% = 506; pension 440,000 x 9.15% = 40,260. EI 205,652 x 5/1000 = 1,028.26, 50 sen or less dropped 1,028. A = 205,652 - 63,464 = 142,188; 別表第一 54,167; 基礎控除 48,334; B = 39,687; x 5.105% = 2,026.02, nearest 10 = 2,030.', input: { run: { kind: 'termination', period_start: '2026-12-01', period_end: '2026-12-15', pay_date: '2026-12-25' }, employee: { birth_date: '1990-06-20', hire_day: '2019-04-01', end_day: '2026-12-15' }, profile: Object.assign({ jp_smr: 440000 }, tok), entity: ent, lines: base(205652) }, expect: { JP_HEALTH: 21670, JP_SUPPORT: 506, JP_PENSION: 40260, JP_EI: 1028, JP_WHT: 2030, JP_PREM_FINAL: 0 } });
    V.push({ name: 'Final pay with unused leave settled (LEAVE_EXIT): left out, with a warning', source: 'derived', reference: 'The QA B-2 final pay plus LEAVE_EXIT 100,000: premiums, EI 1,028 and 源泉 2,030 are as without it; the payslip warns that HR must classify the leave settlement (usually 退職所得).', input: { run: { kind: 'termination', period_start: '2026-12-01', period_end: '2026-12-15', pay_date: '2026-12-25' }, employee: { birth_date: '1990-06-20', hire_day: '2019-04-01', end_day: '2026-12-15' }, profile: Object.assign({ jp_smr: 440000 }, tok), entity: ent, lines: base(205652).concat([{ code: 'LEAVE_EXIT', kind: 'earning', amount: 100000, tags: ['exit_leave_payout', 'termination'] }]) }, expect: { JP_EI: 1028, JP_WHT: 2030, JP_HEALTH: 21670 }, expect_issues: ['jp_exit_leave_classify'] });
    V.push({ name: 'Final pay, leaving at month end under 翌月徴収: two months\' premiums', source: 'derived', reference: 'Last day 2026-11-30, so 資格喪失 is 2026-12-01 and November owes a premium; no later pay exists, so the final November pay carries October and November (健康保険法 167条: 前月及びその月): SMR 300,000 Tokyo: health 14,775 x 2 = 29,550; support 345 x 2 = 690; pension 27,450 x 2 = 54,900. EI 1,500. A = 300,000 - 86,640 = 213,360; 別表第一 213,360 x 30% + 6,667 = 70,675; B = 213,360 - 70,675 - 48,334 = 94,351; x 5.105% = 4,816.62, nearest 10 = 4,820.', input: { run: { kind: 'termination', period_start: '2026-11-01', period_end: '2026-11-30', pay_date: '2026-11-30' }, employee: { birth_date: '1990-04-15', hire_day: '2020-01-01', end_day: '2026-11-30' }, profile: Object.assign({ jp_smr: 300000 }, tok), entity: ent, lines: base(300000) }, expect: { JP_HEALTH: 29550, JP_SUPPORT: 690, JP_PENSION: 54900, JP_EI: 1500, JP_WHT: 4820, JP_PREM_MONTH: 300000, JP_PREM_FINAL: 300000 } });
    V.push({ name: 'Extra pay in the month after the regular pay (off-cycle)', source: 'derived', reference: 'Regular pay 2026-11-25 (300,000, insurance 44,070, tax 3,100, November premium month marked). Off-cycle 50,000 on 2026-11-30: no premium again; EI 250. The month\'s salary after insurance 255,930 + 49,750 = 305,680; 別表第一 305,680 x 20% + 36,667 = 97,803; B = 305,680 - 97,803 - 48,334 - 63,334 = 96,209; x 5.105% = 4,911.47, nearest 10 = 4,910; less 3,100 withheld = 1,810.', input: { run: { kind: 'off_cycle', period_start: '2026-11-01', period_end: '2026-11-30', pay_date: '2026-11-30' }, employee: { birth_date: '1990-04-15' }, profile: Object.assign({ jp_smr: 300000, jp_spouse: true, jp_dependants: 1 }, tok), entity: ent, lines: base(50000), history: [{ pay_date: '2026-11-25', period_end: '2026-11-30', kind: 'regular', by_tag: { jp_taxable: 300000, jp_ei_wages: 300000, jp_si_employee: 44070, jp_prem_month: 300000 }, by_code: { JP_WHT: 3100, JP_HEALTH: 14775, JP_PENSION: 27450 } }] }, expect: { JP_HEALTH: 0, JP_PENSION: 0, JP_EI: 250, JP_WHT: 1810 } });
    V.push({ name: 'Final pay in February: resident tax for the rest of the year in one sum', source: 'derived', reference: 'Leaving in February (January to April leavers pay the rest up to May from the final pay, 一括徴収): February instalment 10,000 plus March to May 3 x 10,000 = 40,000.', input: { run: { kind: 'termination', period_start: '2026-02-01', period_end: '2026-02-15', pay_date: '2026-02-25' }, employee: { birth_date: '1990-04-15', end_day: '2026-02-15' }, profile: Object.assign({ jp_smr: 300000, jp_health_insured: false, jp_pension_insured: false, jp_ei_insured: false, jp_resident_tax_monthly: 10000 }, tok), entity: ent, lines: base(150000) }, expect: { JP_RESIDENT_TAX: 40000 } });
  }
  if (year === 2027) {
    V.push({ name: 'April 2027 pay (March 2027 premium) stops until FY2027 rates are added', source: 'derived', reference: '令和9年度 協会けんぽ rates apply from March 2027 premiums and are not in this version, so the payslip gets a blocker instead of a guessed rate.', input: { run: { period_start: '2027-04-01', period_end: '2027-04-30', pay_date: '2027-04-24' }, employee: { birth_date: '1990-04-15' }, profile: { jp_column: 'ko', jp_prefecture: '13', jp_smr: 300000 }, entity: ent, lines: base(300000) }, expect: {}, expect_issues: ['jp_rates_unpublished', 'jp_ei_rates_unpublished'] });
  }
  if (year === 2026) {
    // nursing care with Osaka, 410,000: combined 11.75% / 2
    V.push({ name: 'Nursing care, Osaka, SMR 410,000, age 46', source: 'official', reference: '協会けんぽ 大阪 令和8年度 10.13%; care 1.62%. Combined employee share 410,000 x 11.75% / 2 = 24,087.5, 50 sen or less dropped = 24,087; health alone 410,000 x 10.13% / 2 = 20,766.5 = 20,766; care = 24,087 - 20,766 = 3,321. Support 410,000 x 0.115% = 471.5 = 471. Pension 410,000 x 9.15% = 37,515.', input: { run: { period_start: '2026-07-01', period_end: '2026-07-31', pay_date: '2026-07-24' }, employee: { birth_date: '1980-05-10' }, profile: { jp_column: 'ko', jp_prefecture: '27', jp_smr: 410000, jp_ei_insured: false }, entity: ent, lines: base(400000) }, expect: { JP_HEALTH: 20766, JP_CARE: 3321, JP_SUPPORT: 471, JP_PENSION: 37515 } });
    // care starts in the month holding the day before the 40th birthday (born on the 1st)
    V.push({ name: 'Nursing care starts: born 1986-08-01, July 2026 premium', source: 'derived', reference: 'Day before the 40th birthday is 2026-07-31, so July 2026 is the first premium month; under 翌月徴収 the August 2026 pay carries it. Tokyo SMR 300,000: (9.85% + 1.62%) / 2 = 17,205 combined; health 14,775; care 2,430.', input: { run: { period_start: '2026-08-01', period_end: '2026-08-31', pay_date: '2026-08-25' }, employee: { birth_date: '1986-08-01' }, profile: { jp_column: 'ko', jp_prefecture: '13', jp_smr: 300000, jp_ei_insured: false }, entity: ent, lines: base(300000) }, expect: { JP_HEALTH: 14775, JP_CARE: 2430 } });
    V.push({ name: 'Nursing care not yet: born 1986-08-01, June 2026 premium', source: 'derived', reference: 'The July 2026 pay carries the June premium, before the first care month (July 2026).', input: { run: { period_start: '2026-07-01', period_end: '2026-07-31', pay_date: '2026-07-24' }, employee: { birth_date: '1986-08-01' }, profile: { jp_column: 'ko', jp_prefecture: '13', jp_smr: 300000, jp_ei_insured: false }, entity: ent, lines: base(300000) }, expect: { JP_HEALTH: 14775, JP_CARE: 0 } });
    // February 2026 premium (paid March) uses 令和7年度 Tokyo 9.91% and no support levy
    V.push({ name: 'Premium month February 2026 uses 令和7年度 rates', source: 'official', reference: '協会けんぽ 令和7年度 東京 9.91%: 300,000 x 9.91% / 2 = 14,865; no 子ども・子育て支援金 before April 2026 premiums. EI wage closing date 2026-03-31 uses FY2025 general 5.5/1000 = 1,650.', input: { run: { period_start: '2026-03-01', period_end: '2026-03-31', pay_date: '2026-03-25' }, employee: { birth_date: '1990-04-15' }, profile: { jp_column: 'ko', jp_prefecture: '13', jp_smr: 300000 }, entity: ent, lines: base(300000) }, expect: { JP_HEALTH: 14865, JP_SUPPORT: 0, JP_EI: 1650, JP_PENSION: 27450 } });
    // bonus with previous month pay
    const bh = 29550, bs = 690, bp = 54900, be = 3000;
    const bnet = 600000 - bh - bs - bp - be;
    const prevNet = 300000 - (h + sup + pen + ei);
    const brate = D['2026'].bonus.k2.find((r) => (r.from === undefined || r.from <= prevNet) && (r.under === undefined || prevNet < r.under)).pct;
    const btax = Math.floor(bnet * brate / 100);
    V.push({ name: 'Bonus, 甲, previous month pay 300,000, spouse and one dependant', source: 'official', reference: 'Bonus 600,000: health 29,550, support 690, pension 54,900, EI 3,000; after insurance ' + bnet + '. Previous month after insurance ' + prevNet + ' falls in the 2 dependants column row of ' + brate + '% (NTA 算出率の表). Tax = ' + bnet + ' x ' + brate + '% = ' + btax + ' (yen fractions dropped).', input: { run: { kind: 'bonus', period_start: '2026-12-01', period_end: '2026-12-31', pay_date: '2026-12-10' }, employee: { birth_date: '1990-04-15' }, profile: { jp_column: 'ko', jp_spouse: true, jp_dependants: 1, jp_prefecture: '13', jp_smr: 300000 }, entity: ent, lines: [{ code: 'JP_BONUS', name: '賞与', kind: 'earning', amount: 600000, tags: ['jp_taxable', 'jp_ei_wages', 'jp_si_bonus'] }], history: [{ pay_date: '2026-11-25', period_end: '2026-11-30', kind: 'regular', by_tag: { jp_taxable: 300000, jp_si_employee: h + sup + pen + ei }, by_code: {} }] }, expect: { JP_HEALTH: bh, JP_SUPPORT: bs, JP_PENSION: bp, JP_EI: be, JP_WHT: btax, JP_STD_BONUS_HEALTH: 600000, JP_STD_BONUS_PENSION: 600000 } });
    // bonus, 乙, no previous month pay: 月額表 method
    const x = bnet / 6;
    const t1 = Math.floor(x * 0.03063);
    V.push({ name: 'Bonus, 乙, no previous month pay', source: 'official', reference: 'NTA 2523: no ordinary pay last month, so (bonus after insurance ' + bnet + ') / 6 = ' + x.toFixed(2) + ' is below the first 月額表 row (105,000): 乙 is 3.063% = ' + t1 + ' yen; times 6 = ' + (t1 * 6) + '.', input: { run: { kind: 'bonus', period_start: '2026-12-01', period_end: '2026-12-31', pay_date: '2026-12-10' }, employee: { birth_date: '1990-04-15' }, profile: { jp_column: 'otsu', jp_prefecture: '13', jp_smr: 300000 }, entity: ent, lines: [{ code: 'JP_BONUS', name: '賞与', kind: 'earning', amount: 600000, tags: ['jp_taxable', 'jp_ei_wages', 'jp_si_bonus'] }] }, expect: { JP_WHT: t1 * 6 } });
    // bonus, 甲, no previous month pay: 月額表 甲欄 lookup times 6
    {
      const bonus = 1200000;
      const parts = { h: 59100, s: 1380, p: 109800, e: 6000 };
      const an = bonus - parts.h - parts.s - parts.p - parts.e;
      const xk = an / 6;
      const row = T(Math.floor(xk));
      V.push({ name: 'Bonus, 甲, no previous month pay (月額表 method)', source: 'official', reference: 'Bonus 1,200,000: health 59,100, support 1,380, pension 109,800, EI 6,000; after insurance ' + an + '. NTA 2523 with no ordinary pay last month: ' + an + ' / 6 = ' + xk + ' falls in the 月額表 row ' + row.from + ' to under ' + row.under + ', 甲 0 dependants ' + row.k[0] + ' yen; times 6 = ' + (row.k[0] * 6) + '.', input: { run: { kind: 'bonus', period_start: '2026-12-01', period_end: '2026-12-31', pay_date: '2026-12-10' }, employee: { birth_date: '1990-04-15' }, profile: { jp_column: 'ko', jp_prefecture: '13', jp_smr: 300000 }, entity: ent, lines: [{ code: 'JP_BONUS', name: '賞与', kind: 'earning', amount: bonus, tags: ['jp_taxable', 'jp_ei_wages', 'jp_si_bonus'] }] }, expect: { JP_HEALTH: parts.h, JP_SUPPORT: parts.s, JP_PENSION: parts.p, JP_EI: parts.e, JP_WHT: row.k[0] * 6 } });
    }
    // pension bonus cap and health fiscal-year cap
    V.push({ name: 'Bonus caps: pension 1,500,000 a month, health 5,730,000 a fiscal year', source: 'official', reference: 'Bonus 2,000,500: 標準賞与額 2,000,000. Pension capped at 1,500,000 x 9.15% = 137,250. Health: 5,000,000 already this fiscal year (from 2026-04-01), so 730,000 x 9.85% / 2 = 35,952.5, 50 sen or less dropped = 35,952.', input: { run: { kind: 'bonus', period_start: '2026-12-01', period_end: '2026-12-31', pay_date: '2026-12-10' }, employee: { birth_date: '1990-04-15' }, profile: { jp_column: 'ko', jp_prefecture: '13', jp_smr: 650000, jp_ei_insured: false }, entity: ent, lines: [{ code: 'JP_BONUS', name: '賞与', kind: 'earning', amount: 2000500, tags: ['jp_taxable', 'jp_si_bonus'] }], history: [{ pay_date: '2026-07-10', period_end: '2026-07-31', kind: 'bonus', by_tag: { jp_std_bonus_health: 5000000, jp_std_bonus_pension: 1500000 }, by_code: {} }] }, expect: { JP_PENSION: 137250, JP_HEALTH: 35952, JP_STD_BONUS_HEALTH: 730000 } });
    // 健康保険組合 with its own split
    V.push({ name: '健康保険組合 rates from the entity', source: 'derived', reference: 'Entity rates: health 9.0% total, 4.2% employee; care 1.8% total, 0.9% employee; support 0.23% / 0.115%. SMR 500,000, age 45, premium month May 2026: health 500,000 x 4.2% = 21,000; combined 500,000 x 5.1% = 25,500, care 4,500; support 575; employer health and care 500,000 x 10.8% - 25,500 = 28,500.', input: { run, employee: { birth_date: '1981-03-03' }, profile: { jp_column: 'ko', jp_smr: 500000, jp_ei_insured: false }, entity: { jp_insurer: 'kumiai', jp_collection: 'next_month', jp_ei_business: 'general', jp_kumiai_health_rate: 0.09, jp_kumiai_health_employee_rate: 0.042, jp_kumiai_care_rate: 0.018, jp_kumiai_care_employee_rate: 0.009 }, lines: base(500000) }, expect: { JP_HEALTH: 21000, JP_CARE: 4500, JP_SUPPORT: 575, JP_HEALTH_ER: 28500 } });
    // construction business EI
    V.push({ name: 'Employment insurance, construction, FY2026', source: 'official', reference: 'MHLW 令和8年度: construction employee 6/1000, employer 10.5/1000. Wages 350,000 (base 330,000 plus non-taxable commuting 20,000): employee 2,100, employer 3,675.', input: { run, employee: { birth_date: '1990-04-15' }, profile: Object.assign({ jp_column: 'ko' }, noSI, { jp_ei_insured: true }), entity: { jp_insurer: 'kyokai', jp_collection: 'next_month', jp_ei_business: 'construction' }, lines: base(330000).concat([{ code: 'JP_COMMUTE', name: '通勤手当', kind: 'earning', amount: 20000, tags: ['jp_ei_wages'] }]) }, expect: { JP_EI: 2100, JP_EI_ER: 3675 } });
  }
  return V;
}

function pack(year) {
  const y2026 = year === 2026;
  return {
    code: 'jp',
    country: 'JP',
    region: '',
    name: y2026 ? 'Japan 2026 (令和8年分 withholding, social insurance, employment insurance, resident tax)' : 'Japan 2027 (令和9年分 withholding; social insurance to February 2027 premiums)',
    version: y2026 ? '2026.3' : '2027.3',
    effective_from: y2026 ? '2026-01-01' : '2027-01-01',
    effective_to: y2026 ? '2026-12-31' : '2027-12-31',
    currency: 'JPY',
    tax_year: { start: '01-01' },
    date_basis: 'pay_date',
    requires: [],
    order: 10,
    ship: 'active',
    sources: sources(year),
    notes: notes(year),
    profile_fields: profileFields(),
    tags: [
      { tag: 'jp_taxable', label: '課税支給額 (taxable pay)', help: 'Pay that is taxed for 源泉徴収 (exclude non-taxable commuting allowance within the limits).' },
      { tag: 'jp_ei_wages', label: '雇用保険の賃金', help: 'All wages for employment insurance, commuting allowance and bonuses included.' },
      { tag: 'jp_si_bonus', label: '賞与 for social insurance', help: 'Bonus amounts paid three times a year or fewer; the base of 標準賞与額.' },
      { tag: 'jp_si_other', label: 'Other deductible premiums', help: 'Deductions from pay that count as 社会保険料等 for withholding, for example 小規模企業共済等掛金.' },
      { tag: 'exit_leave_payout', label: 'Unused leave settled on leaving (LEAVE_EXIT)', help: 'Set by payroll; this pack leaves it out of 給与, insurance and employment insurance and warns so HR classifies it (usually 退職所得).' }
    ],
    seed_components: seedComponents(),
    tables: tables(year),
    steps: steps(year),
    vectors: vectorsFor(year),
    min_wage: { note: 'Japan sets minimum wages by prefecture (FY2026 national weighted average 1,177 yen an hour, effective October to December 2026 by prefecture). The pack carries no single hourly figure; check the prefecture rate.' },
    filings: filings(),
    documents: [
      { code: 'jp_gensen_choshu_hyo', name: '給与所得の源泉徴収票 data', year_end: true },
      { code: 'jp_kyuyo_shiharai_hokokusho', name: '給与支払報告書 data', year_end: true }
    ]
  };
}

export function build() {
  const f1 = writeModule('packs/jp.js', 'Japan rule pack, tax year 2026 (令和8年分), version 2026.3.', pack(2026));
  const f2 = writeModule('packs/jp-2027.js', 'Japan rule pack, tax year 2027 (令和9年分), version 2027.3.', pack(2027));
  return [f1, f2];
}
