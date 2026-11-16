// Fixture pay runs for the payroll-out tests, shaped like the packs' real lines
// (codes, tags, payees, filings). Inserted with the scratch-only testpout.* ops.
const r = (x) => Math.round(x);

export function usSlip(employee, monthly, opts = {}) {
  const k401 = r(monthly * 0.05);
  const fit = r((monthly - k401) * 0.12);
  const L = [
    { code: 'US_SALARY', name: 'Salary', kind: 'earning', amount_minor: monthly, tags: ['us_fit_wages', 'us_fica_wages', 'us_futa_wages'] },
    { code: 'US_401K', name: '401(k)', kind: 'deduction', stage: 'pre', amount_minor: k401, tags: ['us_pretax_401k'] },
    { code: 'US_FIT', name: 'Federal income tax', kind: 'deduction', stage: 'statutory', amount_minor: fit, tags: ['us_tax', 'us_fit_withheld'], payee: 'IRS', filing: 'us_941', pack: 'us-federal' },
    { code: 'US_SS_EE', name: 'Social security', kind: 'deduction', stage: 'statutory', amount_minor: r(monthly * 0.062), tags: ['us_tax', 'us_fica'], payee: 'IRS', filing: 'us_941', pack: 'us-federal' },
    { code: 'US_MED_EE', name: 'Medicare', kind: 'deduction', stage: 'statutory', amount_minor: r(monthly * 0.0145), tags: ['us_tax', 'us_fica'], payee: 'IRS', filing: 'us_941', pack: 'us-federal' },
    { code: 'US_CA_SIT', name: 'California income tax', kind: 'deduction', stage: 'statutory', amount_minor: r(monthly * 0.04), tags: ['us_tax', 'us_state_tax'], payee: 'EDD', filing: 'us_ca_de9', pack: 'us-ca' },
    { code: 'US_CA_SDI', name: 'California SDI', kind: 'deduction', stage: 'statutory', amount_minor: r(monthly * 0.013), tags: ['us_tax', 'us_state_tax'], payee: 'EDD', filing: 'us_ca_de9', pack: 'us-ca' },
    { code: 'US_SS_ER', name: 'Social security (employer)', kind: 'employer', amount_minor: r(monthly * 0.062), tags: ['us_employer_tax'], payee: 'IRS', filing: 'us_941', pack: 'us-federal' },
    { code: 'US_MED_ER', name: 'Medicare (employer)', kind: 'employer', amount_minor: r(monthly * 0.0145), tags: ['us_employer_tax'], payee: 'IRS', filing: 'us_941', pack: 'us-federal' },
    { code: 'US_FUTA', name: 'FUTA', kind: 'employer', amount_minor: r(Math.min(monthly, 700000) * 0.006), tags: ['us_employer_tax'], payee: 'IRS', filing: 'us_940', pack: 'us-federal' },
    { code: 'US_CA_UI', name: 'California UI', kind: 'employer', amount_minor: r(Math.min(monthly, 700000) * 0.034), tags: ['us_employer_tax'], payee: 'EDD', filing: 'us_ca_de9', pack: 'us-ca' },
  ];
  if (opts.reimb) L.push({ code: 'US_REIMB', name: 'Expenses', kind: 'reimbursement', amount_minor: opts.reimb, tags: [] });
  return { employee, pay_method: opts.method || 'bank', lines: L, held: opts.held === true };
}

export function jpSlip(employee, monthly, opts = {}) {
  const health = r(monthly * 0.0495);
  const pension = r(monthly * 0.0915);
  const ei = r(monthly * 0.0055);
  const wht = r((monthly - health - pension - ei) * 0.05);
  const L = [
    { code: 'JP_BASE', name: '基本給', kind: 'earning', amount_minor: monthly, tags: ['jp_taxable', 'jp_ei_wages'] },
    { code: 'JP_COMMUTE', name: '通勤手当', kind: 'earning', amount_minor: 15000, tags: ['jp_ei_wages'] },
    { code: 'JP_HEALTH', name: '健康保険料', kind: 'deduction', stage: 'statutory', amount_minor: health, tags: ['jp_si_employee'], payee: '協会けんぽ / 健康保険組合', filing: 'jp_shakai_hoken', pack: 'jp' },
    { code: 'JP_PENSION', name: '厚生年金保険料', kind: 'deduction', stage: 'statutory', amount_minor: pension, tags: ['jp_si_employee'], payee: '日本年金機構', filing: 'jp_shakai_hoken', pack: 'jp' },
    { code: 'JP_EI', name: '雇用保険料', kind: 'deduction', stage: 'statutory', amount_minor: ei, tags: ['jp_si_employee'], payee: '労働保険', filing: 'jp_rodo_hoken', pack: 'jp' },
    { code: 'JP_WHT', name: '源泉所得税', kind: 'deduction', stage: 'statutory', amount_minor: wht, tags: ['jp_wht'], payee: '税務署', filing: 'jp_gensen', pack: 'jp' },
    { code: 'JP_RESIDENT_TAX', name: '住民税', kind: 'deduction', stage: 'post', amount_minor: 18000, tags: ['jp_resident_tax'], payee: '市区町村', filing: 'jp_juminzei', pack: 'jp' },
    { code: 'JP_HEALTH_ER', name: '健康保険料 (会社)', kind: 'employer', amount_minor: health, tags: [], payee: '協会けんぽ / 健康保険組合', filing: 'jp_shakai_hoken', pack: 'jp' },
    { code: 'JP_PENSION_ER', name: '厚生年金保険料 (会社)', kind: 'employer', amount_minor: pension, tags: [], payee: '日本年金機構', filing: 'jp_shakai_hoken', pack: 'jp' },
  ];
  if (opts.yea) L.push({ code: 'JP_YEA_REFUND', name: '年末調整還付', kind: 'reimbursement', amount_minor: opts.yea, tags: ['jp_wht_yea'], payee: '税務署', filing: 'jp_gensen', pack: 'jp-yea' });
  return { employee, pay_method: opts.method || 'bank', lines: L };
}

export function sgSlip(employee, monthly) {
  const ow = Math.min(monthly, 800000);
  return {
    employee, pay_method: 'bank', lines: [
      { code: 'SG_BASIC', name: 'Basic salary', kind: 'earning', amount_minor: monthly, tags: ['sg_ow'] },
      { code: 'SG_CPF_EE', name: 'CPF (employee)', kind: 'deduction', stage: 'statutory', amount_minor: r(ow * 0.2), tags: ['sg_cpf_ee'], payee: 'CPF Board', filing: 'sg_cpf', pack: 'sg' },
      { code: 'SG_CPF_ER', name: 'CPF (employer)', kind: 'employer', amount_minor: r(ow * 0.17), tags: ['sg_cpf_er'], payee: 'CPF Board', filing: 'sg_cpf', pack: 'sg' },
      { code: 'SG_SDL', name: 'SDL', kind: 'employer', amount_minor: Math.min(1125, Math.max(200, r(monthly * 0.0025))), tags: [], payee: 'CPF Board (for SkillsFuture Singapore)', filing: 'sg_cpf', pack: 'sg' },
    ],
  };
}

export function inSlip(employee, monthly) {
  const hra = r(monthly * 0.4);
  return {
    employee, pay_method: 'bank', lines: [
      { code: 'IN_BASIC', name: 'Basic', kind: 'earning', amount_minor: monthly - hra, tags: ['in_salary', 'in_salary_recurring', 'in_basic_da'] },
      { code: 'IN_HRA', name: 'HRA', kind: 'earning', amount_minor: hra, tags: ['in_salary', 'in_salary_recurring', 'in_hra'] },
      { code: 'IN_TDS', name: 'Income tax (TDS)', kind: 'deduction', stage: 'statutory', amount_minor: r(monthly * 0.1), tags: ['in_tds'], payee: 'Income Tax Department', filing: 'in_24q', pack: 'in' },
    ],
  };
}

export const US_BANK = {
  E0009: [{ bank_code: '021000021', number: '123456789', account_type: 'checking', holder: 'Jordan Reyes', split: { kind: 'fixed', value: 50000 } }, { bank_code: '026009593', number: '987654321', account_type: 'savings', holder: 'Jordan Reyes', split: { kind: 'rest' } }],
  E0010: [{ bank_code: '011000015', number: '55550001', account_type: 'checking' }],
  E0011: [{ bank_code: '091000019', number: '44440002', account_type: 'checking' }],
  E0012: [{ bank_code: '121000358', number: '33330003', account_type: 'savings' }],
  E0013: [{ bank_code: '021000021', number: '22220004', account_type: 'checking' }],
};

export const JP_BANK = {
  E0015: [{ bank_code: '0005', branch_code: '001', number: '1234567', account_type: 'futsu' }],
  E0016: [{ bank_code: '0001', branch_code: '100', number: '7654321', account_type: 'futsu' }],
  E0017: [{ bank_code: '0009', branch_code: '015', number: '0012345', account_type: 'futsu' }],
  E0018: [{ bank_code: '0009', branch_code: '015', number: '7000001', account_type: 'toza' }],
  E0019: [{ bank_code: '0005', branch_code: '200', number: '3333333', account_type: 'futsu' }],
};

export const SG_BANK = Object.fromEntries(['E0001', 'E0002', 'E0003', 'E0004', 'E0005', 'E0006', 'E0007', 'E0008'].map((e, i) => [e, [{ bank_code: '7171', branch_code: '081', number: '01234567' + i, account_type: 'savings' }]]));
export const IN_BANK = Object.fromEntries(['E0020', 'E0021', 'E0022', 'E0023'].map((e, i) => [e, [{ bank_code: 'HDFC0001234', number: '5010001234567' + i, account_type: 'savings' }]]));

export const US_PAYER = { destination_routing: '121000358', destination_name: 'Bank of America', origin: '1123456789', origin_name: 'Northwind Inc', company_name: 'Northwind Inc', company_id: '1123456789', odfi_routing: '121000358', entry_description: 'PAYROLL', account: '9988776', account_type: 'checking' };
export const JP_PAYER = { consignor_code: '1234567890', consignor_kana: 'ノースウインド(カ', bank_code: '0005', bank_kana: 'ミツビシユーエフジエイ', branch_code: '001', branch_kana: 'ホンテン', account_type: 'ordinary', account: '1234567' };

export async function seedAll(api) {
  const owner = { as: 'owner' };
  // The demo locks an October run per entity; the fixture runs below are this test's pay
  // history, so the demo's runs are voided first (as payroll-core voids a run).
  const demo = await api.op('payout.overview', { status: 'all' }, owner);
  for (const r of demo.runs) await api.op('testpout.void', { payrun: r.id }, owner);
  for (const [e, a] of Object.entries(Object.assign({}, US_BANK, JP_BANK, SG_BANK, IN_BANK))) await api.op('testpout.bank', { employee: e, accounts: a }, owner);
  await api.op('payout.settings-set', { entity: 'Northwind Inc', bank_format: 'nacha_ppd', payer: { nacha_ppd: US_PAYER } }, owner);
  await api.op('payout.settings-set', { entity: 'Northwind KK', bank_format: 'zengin', payer: { zengin: JP_PAYER } }, owner);
  const runs = {};
  const usSlips = [usSlip('E0009', 1375000, { reimb: 4500 }), usSlip('E0010', 816667), usSlip('E0011', 791667), usSlip('E0012', 733333), usSlip('E0013', 1516667), usSlip('E0014', 520000, { method: 'cash' })];
  for (const [m, d] of [['10', '31'], ['11', '30']]) runs['us' + m] = await api.op('testpout.seed-run', { entity: 'Northwind Inc', period_start: '2026-' + m + '-01', period_end: '2026-' + m + '-' + d, pay_date: '2026-' + m + '-' + d, status: 'locked', slips: usSlips }, owner);
  runs.us09 = await api.op('testpout.seed-run', { entity: 'Northwind Inc', period_start: '2026-09-01', period_end: '2026-09-30', pay_date: '2026-09-30', status: 'paid', slips: usSlips }, owner);
  const jpSlips = [jpSlip('E0015', 1150000), jpSlip('E0016', 520000), jpSlip('E0017', 430000), jpSlip('E0018', 350000), jpSlip('E0019', 480000)];
  runs.jp10 = await api.op('testpout.seed-run', { entity: 'Northwind KK', period_start: '2026-10-01', period_end: '2026-10-31', pay_date: '2026-10-23', status: 'locked', slips: jpSlips }, owner);
  const sgSlips = ['E0001', 'E0002', 'E0003', 'E0004', 'E0005', 'E0006', 'E0007', 'E0008'].map((e, i) => sgSlip(e, [2800000, 980000, 720000, 1550000, 780000, 1020000, 860000, 430000][i]));
  sgSlips[7].held = true;
  runs.sg10 = await api.op('testpout.seed-run', { entity: 'Northwind Pte Ltd', period_start: '2026-10-01', period_end: '2026-10-31', pay_date: '2026-10-28', status: 'locked', slips: sgSlips }, owner);
  const inSlips = ['E0020', 'E0021', 'E0022', 'E0023'].map((e, i) => inSlip(e, [45000000, 14000000, 23000000, 9500000][i]));
  runs.in10 = await api.op('testpout.seed-run', { entity: 'Northwind India Pvt Ltd', period_start: '2026-10-01', period_end: '2026-10-31', pay_date: '2026-10-31', status: 'locked', slips: inSlips }, owner);
  return { runs, usSlips, jpSlips, sgSlips, inSlips };
}
