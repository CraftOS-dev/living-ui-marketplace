/**
 * Benchmark data shared by Node (tests/bench.mjs) and the Goja timing hook:
 * three packs (social contributions with bands and maps, income tax with
 * YTD annualisation, and the generic pack) and n different payslip inputs
 * with five earlier payslips each.
 */
function packs(generic) {
  const social = {
    code: 'zz-social', country: 'ZZ', region: '', name: 'Synthetic social', version: '1', effective_from: '2026-01-01', effective_to: '2026-12-31',
    currency: 'USD', tax_year: { start: '01-01' }, requires: [], order: 10, ship: 'draft', sources: [{ title: 'synthetic' }], notes: 'benchmark',
    profile_fields: [{ key: 'resident', label: 'Resident', type: 'boolean', default: true }, { key: 'er_rate', label: 'Employer rate', type: 'number', scope: 'entity', default: 0.17 }],
    tables: {
      ee_rate: { type: 'bands', rows: [{ under: 55, value: 0.2 }, { from: 55, under: 60, value: 0.15 }, { from: 60, under: 65, value: 0.095 }, { from: 65, value: 0.075 }] },
      ceiling: { type: 'map', rows: { monthly: 8000, weekly: 1850, biweekly: 3700, semi_monthly: 4000 } }
    },
    steps: [
      { var: 'age', expr: 'age_on(run.period_end)' },
      { var: 'ow', expr: 'min(sum("ow"), map("ceiling", run.frequency))' },
      { var: 'aw_room', expr: 'max(0, 102000 - ytd("ow_used") - ow)' },
      { code: 'ZZ_OW_USED', name: 'OW counted', kind: 'info', amount: 'ow', tags: ['ow_used'] },
      { code: 'ZZ_SOC_EE', name: 'Social (employee)', kind: 'deduction', stage: 'statutory', when: 'profile.resident', amount: 'ow * band("ee_rate", age)', round: { mode: 'down', step: 1 }, tags: ['soc_ee'] },
      { code: 'ZZ_SOC_ER', name: 'Social (employer)', kind: 'employer', amount: 'ow * entity.er_rate', round: { mode: 'half_up', step: 1 } },
      { code: 'ZZ_SDL', name: 'Levy', kind: 'employer', amount: 'clamp(sum("ow") * 0.0025, 2, 11.25)', round: { mode: 'down', step: 0.01 } },
      { check: 'age < 75', severity: 'warning', issue: 'zz_over_75', message: 'over 75' }
    ]
  };
  const tax = {
    code: 'zz-tax', country: 'ZZ', region: '', name: 'Synthetic tax', version: '1', effective_from: '2026-01-01', effective_to: '2026-12-31',
    currency: 'USD', tax_year: { start: '04-01' }, requires: ['zz-social'], order: 20, ship: 'draft', sources: [{ title: 'synthetic' }], notes: 'benchmark',
    profile_fields: [{ key: 'filing', label: 'Filing', type: 'enum', options: [{ value: 'single', label: 'S' }, { value: 'married', label: 'M' }], default: 'single' }],
    tables: {
      annual_single: { type: 'brackets', rows: [{ from: 0, rate: 0, base: 0 }, { from: 12000, rate: 0.1, base: 0 }, { from: 40000, rate: 0.2, base: 2800 }, { from: 90000, rate: 0.3, base: 12800 }] },
      annual_married: { type: 'brackets', rows: [{ over: 0, rate: 0 }, { over: 24000, rate: 0.1 }, { over: 80000, rate: 0.2 }, { over: 180000, rate: 0.3 }] }
    },
    steps: [
      { var: 'taxable_now', expr: 'max(0, sum("taxable") - line("ZZ_SOC_EE"))' },
      { var: 'annual', expr: 'ytd("tax_base") + taxable_now * (run.periods_remaining + 1)' },
      { var: 'annual_tax', expr: 'table("annual_" + profile.filing, annual)' },
      { code: 'ZZ_TAX_BASE', name: 'Taxable pay', kind: 'info', amount: 'taxable_now', tags: ['tax_base'] },
      { code: 'ZZ_TAX', name: 'Income tax', kind: 'deduction', stage: 'statutory', amount: 'max(0, (annual_tax - ytd_code("ZZ_TAX")) / (run.periods_remaining + 1))', round: { mode: 'half_up', step: 1 } }
    ]
  };
  return [social, tax, generic];
}

function inputs(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const salary = Math.round((3000 + i * 7.31) * 100) / 100;
    out.push({
      run: { kind: 'regular', period_start: '2026-06-01', period_end: '2026-06-30', pay_date: '2026-06-30', periods_per_year: 12, frequency: 'monthly', days_in_period: 30, working_days_in_period: 22, worked_days: 22 },
      employee: { id: 'e' + i, birth_date: (1960 + (i % 40)) + '-07-15', hire_day: '2015-01-01' },
      employment: { id: 'm' + i, entity_country: 'ZZ', fte: 1 },
      profile: { filing: i % 3 === 0 ? 'married' : 'single', income_tax_percent: 0, resident: i % 11 !== 0 },
      entity: { er_rate: 0.17, social_employee_percent: 1.5, social_employer_percent: 2 },
      currency: { code: 'USD', exponent: 2 },
      lines: [
        { code: 'BASIC', kind: 'earning', amount: salary, tags: ['ow', 'taxable', 'tax_wages', 'social_wages'] },
        { code: 'ALLOW', kind: 'earning', amount: 250, tags: ['ow', 'taxable', 'tax_wages', 'social_wages'] },
        { code: 'K401', kind: 'deduction', stage: 'pre', amount: Math.round(salary * 5) / 100, tags: ['tax_relief'] },
        { code: 'REIMB', kind: 'reimbursement', amount: 42.5, tags: [] }
      ],
      history: [
        { id: 'h1', kind: 'regular', pay_date: '2026-01-30', by_tag: { ow_used: salary, tax_base: salary * 0.8 }, by_code: { ZZ_TAX: 300 } },
        { id: 'h2', kind: 'regular', pay_date: '2026-02-27', by_tag: { ow_used: salary, tax_base: salary * 0.8 }, by_code: { ZZ_TAX: 300 } },
        { id: 'h3', kind: 'regular', pay_date: '2026-03-31', by_tag: { ow_used: salary, tax_base: salary * 0.8 }, by_code: { ZZ_TAX: 300 } },
        { id: 'h4', kind: 'regular', pay_date: '2026-04-30', by_tag: { ow_used: salary, tax_base: salary * 0.8 }, by_code: { ZZ_TAX: 310 } },
        { id: 'h5', kind: 'regular', pay_date: '2026-05-29', by_tag: { ow_used: salary, tax_base: salary * 0.8 }, by_code: { ZZ_TAX: 310 } }
      ],
      history_from: '2025-01-01',
      context: { hours_worked: 168, min_wage_hourly: 7.25 }
    });
  }
  return out;
}

/** Calculate n payslips; returns { ms, n, blockers, hash } where hash fingerprints every result in order. */
function run(engine, generic, n, now) {
  const P = packs(generic);
  const list = inputs(n);
  const t0 = now();
  const hashes = [];
  let blockers = 0;
  for (let i = 0; i < list.length; i++) {
    const out = engine.calculate(list[i], P);
    hashes.push(out.hash);
    for (let k = 0; k < out.issues.length; k++) if (out.issues[k].severity === 'blocker') blockers++;
  }
  const ms = now() - t0;
  return { ms: ms, n: n, blockers: blockers, hash: engine.hash(hashes.join(',')), first: hashes[0] };
}

module.exports = { packs: packs, inputs: inputs, run: run };
