/**
 * The "set by you" template pack: a flat income tax rate and flat employee
 * and employer social contributions with optional ceilings, for a country
 * without a built-in pack. It holds no statutory rates of its own: the
 * company enters every rate, so its formulas are exact for whatever is
 * entered and it ships active.
 */
module.exports = {
  code: 'generic',
  country: '',
  region: '',
  name: 'Set by you: flat income tax and social contributions',
  version: '1.0',
  effective_from: '2000-01-01',
  effective_to: '',
  currency: '',
  tax_year: { start: '01-01' },
  requires: [],
  order: 50,
  ship: 'active',
  sources: [
    {
      title: 'Rates set by your company',
      url: '',
      retrieved: '',
      note: 'This template carries no statutory rates. Enter the income tax rate, the contribution rates and the ceilings that apply to you, and check them with your tax adviser or the local authority.'
    }
  ],
  notes:
    'Covers: one flat income tax rate per person on taxable pay (pay tagged tax_wages, less pre-tax deductions tagged tax_relief, less an optional tax-free amount per pay period, and optionally less the employee contribution); ' +
    'flat employee and employer social contributions on pay tagged social_wages, with an optional ceiling per pay period and per tax year (the yearly ceiling counts wages already used this year from earlier payslips). ' +
    'Does not cover: progressive tax bands, tax credits, allowances by family situation, different rates by age or residency, multiple social funds, or year-end filings. ' +
    'The tax year runs from 1 January. Lines round to the currency minor unit, halves away from zero. Use a country pack where one exists.',
  profile_fields: [
    { key: 'income_tax_percent', label: 'Income tax rate (%)', type: 'number', default: 0, min: 0, max: 100, help: 'The flat rate withheld from this person\'s taxable pay, such as 10 for 10%.' },
    { key: 'income_tax_exempt', label: 'No income tax for this person', type: 'boolean', default: false },
    { key: 'social_exempt', label: 'No social contributions for this person', type: 'boolean', default: false, help: 'For people the local scheme does not cover.' },
    { key: 'tax_free_per_period', label: 'Tax-free amount each pay period', type: 'money', default: 0, min: 0, scope: 'entity', help: 'Taken off taxable pay before the rate applies. 0 means none.' },
    { key: 'social_employee_percent', label: 'Employee contribution rate (%)', type: 'number', default: 0, min: 0, max: 100, scope: 'entity' },
    { key: 'social_employer_percent', label: 'Employer contribution rate (%)', type: 'number', default: 0, min: 0, max: 100, scope: 'entity' },
    { key: 'social_ceiling_per_period', label: 'Contribution ceiling each pay period', type: 'money', default: 0, min: 0, scope: 'entity', help: 'Wages above this amount in one pay period pay no contributions. 0 means no ceiling.' },
    { key: 'social_ceiling_per_year', label: 'Contribution ceiling each tax year', type: 'money', default: 0, min: 0, scope: 'entity', help: 'Wages above this amount in one tax year pay no contributions. 0 means no ceiling.' },
    { key: 'social_reduces_tax', label: 'Employee contributions lower taxable pay', type: 'boolean', default: false, scope: 'entity' }
  ],
  tags: [
    { tag: 'tax_wages', label: 'Pay subject to income tax', help: 'Put it on every earning that is taxed.' },
    { tag: 'social_wages', label: 'Pay subject to social contributions' },
    { tag: 'tax_relief', label: 'Deduction that lowers taxable pay', help: 'For pre-tax deductions such as a pension the law lets you take before tax.' },
    { tag: 'generic_social_base', label: 'Wages counted for contributions (kept for the yearly ceiling)' }
  ],
  seed_components: [
    { code: 'BASIC', name: 'Basic pay', kind: 'earning', stage: '', calc: 'fixed', tags: ['tax_wages', 'social_wages'], taxable: true, sort: 10 },
    { code: 'OVERTIME', name: 'Overtime', kind: 'earning', stage: '', calc: 'hours', tags: ['tax_wages', 'social_wages'], taxable: true, sort: 20 },
    { code: 'ALLOWANCE', name: 'Allowance', kind: 'earning', stage: '', calc: 'fixed', tags: ['tax_wages', 'social_wages'], taxable: true, sort: 30 },
    { code: 'BONUS', name: 'Bonus', kind: 'earning', stage: '', calc: 'input', tags: ['tax_wages', 'social_wages'], taxable: true, sort: 40 },
    { code: 'PENSION_EE', name: 'Pension before tax', kind: 'deduction', stage: 'pre', calc: 'percent', tags: ['tax_relief'], taxable: false, sort: 50 },
    { code: 'REIMB', name: 'Expense reimbursement', kind: 'reimbursement', stage: '', calc: 'input', tags: [], taxable: false, sort: 90 }
  ],
  tables: {},
  steps: [
    { var: 'social_wages', expr: 'max(0, sum("social_wages"))' },
    { var: 'period_capped', expr: 'entity.social_ceiling_per_period > 0 ? min(social_wages, entity.social_ceiling_per_period) : social_wages' },
    { var: 'year_room', expr: 'entity.social_ceiling_per_year > 0 ? max(0, entity.social_ceiling_per_year - ytd("generic_social_base")) : period_capped' },
    { var: 'social_base', expr: 'profile.social_exempt ? 0 : min(period_capped, year_room)', explain: 'Wages subject to contributions, after the period and yearly ceilings' },
    {
      code: 'GEN_SOCIAL_BASE', name: 'Wages counted for contributions', kind: 'info', amount: 'social_base', tags: ['generic_social_base'],
      explain: 'Kept on the payslip so later payslips know how much of the yearly ceiling is used'
    },
    {
      code: 'GEN_SOCIAL_EE', name: 'Social contribution', kind: 'deduction', stage: 'statutory',
      amount: 'social_base * entity.social_employee_percent / 100', base: 'social_base', rate: 'entity.social_employee_percent / 100',
      tags: ['generic_social_employee'], explain: 'Employee rate set by your company times the counted wages'
    },
    {
      code: 'GEN_SOCIAL_ER', name: 'Social contribution (employer)', kind: 'employer',
      amount: 'social_base * entity.social_employer_percent / 100', base: 'social_base', rate: 'entity.social_employer_percent / 100',
      tags: ['generic_social_employer'], explain: 'Employer rate set by your company times the counted wages'
    },
    {
      var: 'taxable',
      expr: 'max(0, sum("tax_wages") - sum("tax_relief") - (entity.social_reduces_tax ? line("GEN_SOCIAL_EE") : 0) - entity.tax_free_per_period)',
      explain: 'Taxed pay less pre-tax deductions, the tax-free amount and, when set, the employee contribution'
    },
    {
      code: 'GEN_INCOME_TAX', name: 'Income tax', kind: 'deduction', stage: 'statutory', when: '!profile.income_tax_exempt',
      amount: 'taxable * profile.income_tax_percent / 100', base: 'taxable', rate: 'profile.income_tax_percent / 100',
      tags: ['generic_income_tax'], explain: 'Flat rate set for this person times taxable pay'
    },
    {
      check: 'profile.income_tax_percent > 0 || entity.social_employee_percent > 0 || entity.social_employer_percent > 0 || profile.income_tax_exempt',
      severity: 'warning', issue: 'generic_rates_not_set',
      message: 'No income tax or contribution rate is set for this person, so nothing is withheld. Set the rates on the "Set by you" pack.'
    }
  ],
  vectors: [
    {
      name: 'monthly pay with tax and contributions', source: 'derived', reference: '5,000 x 5% = 250; x 8% = 400; 5,000 x 10% = 500',
      input: { currency: { code: 'USD', exponent: 2 }, lines: [{ code: 'BASIC', kind: 'earning', amount: 5000, tags: ['tax_wages', 'social_wages'] }], profile: { income_tax_percent: 10 }, entity: { social_employee_percent: 5, social_employer_percent: 8 } },
      expect: { GEN_SOCIAL_EE: 250, GEN_SOCIAL_ER: 400, GEN_INCOME_TAX: 500, GEN_SOCIAL_BASE: 5000 },
      expect_totals: { gross: 5000, statutory: 750, employer: 400, net: 4250 }
    },
    {
      name: 'ceiling each pay period', source: 'derived', reference: 'counted wages 6,000 of 9,000; 6,000 x 5% = 300; x 8% = 480',
      input: { currency: { code: 'EUR', exponent: 2 }, lines: [{ code: 'BASIC', kind: 'earning', amount: 9000, tags: ['tax_wages', 'social_wages'] }], entity: { social_employee_percent: 5, social_employer_percent: 8, social_ceiling_per_period: 6000 } },
      expect: { GEN_SOCIAL_BASE: 6000, GEN_SOCIAL_EE: 300, GEN_SOCIAL_ER: 480, GEN_INCOME_TAX: 0 }
    },
    {
      name: 'yearly ceiling uses earlier payslips', source: 'derived', reference: '60,000 ceiling less 57,000 counted Jan to May leaves 3,000; 3,000 x 5% = 150',
      input: {
        currency: { code: 'EUR', exponent: 2 },
        run: { period_start: '2026-06-01', period_end: '2026-06-30', pay_date: '2026-06-30' },
        lines: [{ code: 'BASIC', kind: 'earning', amount: 12000, tags: ['tax_wages', 'social_wages'] }],
        history: [
          { id: 'p1', kind: 'regular', pay_date: '2026-03-31', by_tag: { generic_social_base: 36000 } },
          { id: 'p2', kind: 'regular', pay_date: '2026-04-30', by_tag: { generic_social_base: 12000 } },
          { id: 'p3', kind: 'bonus', pay_date: '2026-05-15', by_tag: { generic_social_base: 9000 } },
          { id: 'p0', kind: 'regular', pay_date: '2025-12-31', by_tag: { generic_social_base: 99999 } }
        ],
        entity: { social_employee_percent: 5, social_ceiling_per_year: 60000 }
      },
      expect: { GEN_SOCIAL_BASE: 3000, GEN_SOCIAL_EE: 150 }
    },
    {
      name: 'person exempt from tax and contributions', source: 'derived', reference: 'both switches on: no lines, net equals gross',
      input: { currency: { code: 'USD', exponent: 2 }, lines: [{ code: 'BASIC', kind: 'earning', amount: 3000, tags: ['tax_wages', 'social_wages'] }], profile: { income_tax_percent: 20, income_tax_exempt: true, social_exempt: true }, entity: { social_employee_percent: 10 } },
      expect: { GEN_INCOME_TAX: 0, GEN_SOCIAL_EE: 0 },
      expect_totals: { net: 3000 }
    },
    {
      name: 'pre-tax pension, tax-free amount and contributions lowering tax', source: 'derived', reference: 'taxable 4,000 - 200 - 400 - 500 = 2,900; x 20% = 580',
      input: {
        currency: { code: 'GBP', exponent: 2 },
        lines: [
          { code: 'BASIC', kind: 'earning', amount: 4000, tags: ['tax_wages', 'social_wages'] },
          { code: 'PENSION_EE', kind: 'deduction', stage: 'pre', amount: 200, tags: ['tax_relief'] }
        ],
        profile: { income_tax_percent: 20 },
        entity: { social_employee_percent: 10, social_reduces_tax: true, tax_free_per_period: 500 }
      },
      expect: { GEN_SOCIAL_EE: 400, GEN_INCOME_TAX: 580 },
      expect_vars: { taxable: 2900 },
      expect_totals: { pre: 200, statutory: 980, net: 2820 }
    },
    {
      name: 'yen rounds to whole yen', source: 'derived', reference: '333,333 x 9.15% = 30,499.97 rounds to 30,500; 333,333 x 5.105% = 17,016.65 rounds to 17,017',
      input: { currency: { code: 'JPY', exponent: 0 }, lines: [{ code: 'BASIC', kind: 'earning', amount: 333333, tags: ['tax_wages', 'social_wages'] }], profile: { income_tax_percent: 5.105 }, entity: { social_employee_percent: 9.15 } },
      expect: { GEN_SOCIAL_EE: 30500, GEN_INCOME_TAX: 17017 },
      expect_totals: { net: 285816 }
    },
    {
      name: 'weekly pay rounds half away from zero', source: 'derived', reference: '1,234.50 x 1% = 12.345 rounds to 12.35',
      input: { currency: { code: 'AUD', exponent: 2 }, run: { frequency: 'weekly', periods_per_year: 52, period_start: '2026-03-02', period_end: '2026-03-08', pay_date: '2026-03-09' }, lines: [{ code: 'BASIC', kind: 'earning', amount: 1234.5, tags: ['tax_wages', 'social_wages'] }], profile: { income_tax_percent: 1 } },
      expect: { GEN_INCOME_TAX: 12.35 }
    },
    {
      name: 'no rates set gives a warning', source: 'derived', reference: 'all rates 0',
      input: { currency: { code: 'USD', exponent: 2 }, lines: [{ code: 'BASIC', kind: 'earning', amount: 1000, tags: ['tax_wages', 'social_wages'] }] },
      expect: { GEN_INCOME_TAX: 0 },
      expect_issues: ['generic_rates_not_set']
    },
    {
      name: 'deductions above pay block the payslip', source: 'derived', reference: '1,000 pay, 100% tax and 10% contribution: net -100',
      input: { currency: { code: 'USD', exponent: 2 }, lines: [{ code: 'BASIC', kind: 'earning', amount: 1000, tags: ['tax_wages', 'social_wages'] }], profile: { income_tax_percent: 100 }, entity: { social_employee_percent: 10 } },
      expect: { GEN_INCOME_TAX: 1000, GEN_SOCIAL_EE: 100 },
      expect_totals: { net: -100 },
      expect_issues: ['negative_net']
    },
    {
      name: 'a rate above 100 is refused', source: 'derived', reference: 'income_tax_percent max is 100',
      input: { currency: { code: 'USD', exponent: 2 }, lines: [{ code: 'BASIC', kind: 'earning', amount: 1000, tags: ['tax_wages'] }], profile: { income_tax_percent: 150 } },
      expect_issues: ['profile_invalid']
    }
  ],
  min_wage: { hourly: null, monthly: null, note: 'Set by you: enter the local minimum wage in the country data or the pay run context.' },
  filings: [],
  documents: []
};
