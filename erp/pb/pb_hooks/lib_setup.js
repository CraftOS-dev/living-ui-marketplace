/// <reference path="../pb_data/types.d.ts" />
/**
 * First-run setup: the company, a country preset (currency, fiscal year,
 * starting taxes), the business type (which modules are on), the chart of
 * accounts, the first bank and cash accounts, the main warehouse, leave
 * types and the owner's account. Runs once, while the app has no members.
 *
 * Tax presets are starting points to check with an accountant; they are
 * plain records that can be changed or archived in Settings.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}

/* [code, name, rate %, scope, recoverable] */
const COUNTRIES = {
  MY: { name: 'Malaysia', currency: 'MYR', fy: 1, leave: 14, taxes: [['SV8', 'Service tax 8%', '8', 'sales', false], ['SV6', 'Service tax 6%', '6', 'sales', false], ['ST10', 'Sales tax 10%', '10', 'sales', false], ['ST5', 'Sales tax 5%', '5', 'sales', false], ['PT', 'Purchase SST (not claimable)', '0', 'purchase', false]] },
  SG: { name: 'Singapore', currency: 'SGD', fy: 1, leave: 14, taxes: [['SR9', 'GST 9%', '9', 'both', true], ['ZR', 'GST zero-rated', '0', 'both', true], ['ES', 'GST exempt', '0', 'both', true]] },
  GB: { name: 'United Kingdom', currency: 'GBP', fy: 4, leave: 28, taxes: [['VAT20', 'VAT 20%', '20', 'both', true], ['VAT5', 'VAT 5%', '5', 'both', true], ['VAT0', 'VAT zero-rated', '0', 'both', true], ['EX', 'VAT exempt', '0', 'both', true]] },
  US: { name: 'United States', currency: 'USD', fy: 1, leave: 10, taxes: [['ST', 'Sales tax', '0', 'sales', false]] },
  CA: { name: 'Canada', currency: 'CAD', fy: 1, leave: 10, taxes: [['GST5', 'GST 5%', '5', 'both', true], ['HST13', 'HST 13%', '13', 'both', true], ['HST15', 'HST 15%', '15', 'both', true]] },
  AU: { name: 'Australia', currency: 'AUD', fy: 7, leave: 20, taxes: [['GST', 'GST 10%', '10', 'both', true], ['FRE', 'GST free', '0', 'both', true]] },
  NZ: { name: 'New Zealand', currency: 'NZD', fy: 4, leave: 20, taxes: [['GST15', 'GST 15%', '15', 'both', true], ['ZERO', 'Zero-rated', '0', 'both', true]] },
  JP: { name: 'Japan', currency: 'JPY', fy: 4, leave: 10, taxes: [['CT10', 'Consumption tax 10%', '10', 'both', true], ['CT8', 'Consumption tax 8% (reduced)', '8', 'both', true]] },
  IN: { name: 'India', currency: 'INR', fy: 4, leave: 18, taxes: [['GST18', 'GST 18%', '18', 'both', true], ['GST12', 'GST 12%', '12', 'both', true], ['GST5', 'GST 5%', '5', 'both', true], ['GST28', 'GST 28%', '28', 'both', true], ['GST0', 'GST 0%', '0', 'both', true]] },
  ID: { name: 'Indonesia', currency: 'IDR', fy: 1, leave: 12, taxes: [['PPN11', 'PPN 11%', '11', 'both', true], ['PPN0', 'PPN 0%', '0', 'both', true]] },
  TH: { name: 'Thailand', currency: 'THB', fy: 1, leave: 6, taxes: [['VAT7', 'VAT 7%', '7', 'both', true], ['VAT0', 'VAT 0%', '0', 'both', true]] },
  PH: { name: 'Philippines', currency: 'PHP', fy: 1, leave: 5, taxes: [['VAT12', 'VAT 12%', '12', 'both', true], ['VAT0', 'VAT zero-rated', '0', 'both', true]] },
  VN: { name: 'Vietnam', currency: 'VND', fy: 1, leave: 12, taxes: [['VAT10', 'VAT 10%', '10', 'both', true], ['VAT8', 'VAT 8%', '8', 'both', true], ['VAT5', 'VAT 5%', '5', 'both', true], ['VAT0', 'VAT 0%', '0', 'both', true]] },
  CN: { name: 'China', currency: 'CNY', fy: 1, leave: 5, taxes: [['VAT13', 'VAT 13%', '13', 'both', true], ['VAT9', 'VAT 9%', '9', 'both', true], ['VAT6', 'VAT 6%', '6', 'both', true]] },
  HK: { name: 'Hong Kong', currency: 'HKD', fy: 4, leave: 7, taxes: [['NT', 'No tax', '0', 'both', true]] },
  AE: { name: 'United Arab Emirates', currency: 'AED', fy: 1, leave: 30, taxes: [['VAT5', 'VAT 5%', '5', 'both', true], ['ZR', 'VAT zero-rated', '0', 'both', true]] },
  SA: { name: 'Saudi Arabia', currency: 'SAR', fy: 1, leave: 21, taxes: [['VAT15', 'VAT 15%', '15', 'both', true], ['ZR', 'VAT zero-rated', '0', 'both', true]] },
  DE: { name: 'Germany', currency: 'EUR', fy: 1, leave: 20, taxes: [['UST19', 'USt 19%', '19', 'both', true], ['UST7', 'USt 7%', '7', 'both', true]] },
  FR: { name: 'France', currency: 'EUR', fy: 1, leave: 25, taxes: [['TVA20', 'TVA 20%', '20', 'both', true], ['TVA10', 'TVA 10%', '10', 'both', true], ['TVA55', 'TVA 5.5%', '5.5', 'both', true]] },
  NL: { name: 'Netherlands', currency: 'EUR', fy: 1, leave: 20, taxes: [['BTW21', 'BTW 21%', '21', 'both', true], ['BTW9', 'BTW 9%', '9', 'both', true]] },
  IE: { name: 'Ireland', currency: 'EUR', fy: 1, leave: 20, taxes: [['VAT23', 'VAT 23%', '23', 'both', true], ['VAT135', 'VAT 13.5%', '13.5', 'both', true]] },
  XX: { name: 'Another country', currency: '', fy: 1, leave: 14, taxes: [] },
};

const BUSINESS_MODULES = {
  services: { sales: true, purchasing: true, inventory: false, manufacturing: false, accounting: true, banking: true, people: true, payroll: false, projects: true },
  trading: { sales: true, purchasing: true, inventory: true, manufacturing: false, accounting: true, banking: true, people: true, payroll: false, projects: false },
  manufacturing: { sales: true, purchasing: true, inventory: true, manufacturing: true, accounting: true, banking: true, people: true, payroll: false, projects: false },
  other: { sales: true, purchasing: true, inventory: true, manufacturing: false, accounting: true, banking: true, people: true, payroll: false, projects: true },
};

/* [code, name, type, subtype, system_key, control] */
const CHART = [
  ['1000', 'Cash on hand', 'asset', 'cash', 'cash', false],
  ['1010', 'Bank', 'asset', 'bank', 'bank', false],
  ['1100', 'Accounts receivable', 'asset', 'receivable', 'ar', true],
  ['1200', 'Inventory', 'asset', 'inventory', 'inventory', true],
  ['1300', 'Prepaid expenses', 'asset', 'current_asset', '', false],
  ['1400', 'Tax receivable', 'asset', 'tax_receivable', 'tax_receivable', false],
  ['1500', 'Equipment', 'asset', 'fixed_asset', 'fixed_assets', false],
  ['1510', 'Accumulated depreciation', 'asset', 'accumulated_depreciation', 'accumulated_depreciation', false],
  ['2000', 'Accounts payable', 'liability', 'payable', 'ap', true],
  ['2050', 'Goods received not invoiced', 'liability', 'current_liability', 'grni', true],
  ['2100', 'Tax payable', 'liability', 'tax_payable', 'tax_payable', false],
  ['2200', 'Salaries payable', 'liability', 'payroll_liability', 'salaries_payable', false],
  ['2210', 'Payroll deductions payable', 'liability', 'payroll_liability', 'payroll_liabilities', false],
  ['2250', 'Employee reimbursements payable', 'liability', 'current_liability', 'reimbursements', false],
  ['2400', 'Loans', 'liability', 'long_term_liability', '', false],
  ['3000', 'Owner equity', 'equity', 'equity', 'equity', false],
  ['3100', 'Retained earnings', 'equity', 'retained_earnings', 'retained_earnings', false],
  ['3900', 'Opening balance equity', 'equity', 'opening_balance', 'opening_balance', false],
  ['4000', 'Sales', 'income', 'revenue', 'sales', false],
  ['4100', 'Service revenue', 'income', 'revenue', 'service_revenue', false],
  ['4900', 'Other income', 'income', 'other_income', 'other_income', false],
  ['4950', 'Exchange gains and losses', 'income', 'other_income', 'fx', false],
  ['5000', 'Cost of goods sold', 'expense', 'cogs', 'cogs', false],
  ['5050', 'Purchase price variance', 'expense', 'cogs', 'ppv', false],
  ['5100', 'Stock adjustments', 'expense', 'cogs', 'stock_adjustment', false],
  ['5200', 'Applied labor and overhead', 'expense', 'cogs', 'applied_overhead', false],
  ['6000', 'Salaries and wages', 'expense', 'payroll_expense', 'salaries', false],
  ['6010', 'Employer contributions', 'expense', 'payroll_expense', 'employer_contributions', false],
  ['6100', 'Rent', 'expense', 'expense', '', false],
  ['6200', 'Utilities', 'expense', 'expense', '', false],
  ['6300', 'Office supplies', 'expense', 'expense', '', false],
  ['6400', 'Travel', 'expense', 'expense', 'travel', false],
  ['6410', 'Meals and entertainment', 'expense', 'expense', '', false],
  ['6500', 'Marketing and advertising', 'expense', 'expense', '', false],
  ['6600', 'Professional fees', 'expense', 'expense', '', false],
  ['6700', 'Software and subscriptions', 'expense', 'expense', '', false],
  ['6800', 'Bank fees', 'expense', 'expense', 'bank_fees', false],
  ['6900', 'Depreciation', 'expense', 'depreciation', 'depreciation', false],
  ['6950', 'Insurance', 'expense', 'expense', '', false],
  ['6990', 'General expenses', 'expense', 'expense', 'general_expense', false],
  ['7000', 'Interest expense', 'expense', 'other_expense', '', false],
  ['7100', 'Income tax expense', 'expense', 'other_expense', '', false],
];

function status(ctx) {
  const util = u();
  const app = ctx.app;
  const s = require(`${__hooks}/lib_core.js`).settings(app);
  const members = util.one(app, 'SELECT COUNT(id) AS n FROM members', { n: 0 }).n;
  return { setup_done: s.getBool('setup_done') && members > 0, has_members: members > 0, company_name: s.getString('company_name') };
}

function presets() {
  const out = [];
  for (const code of Object.keys(COUNTRIES)) {
    const c = COUNTRIES[code];
    out.push({ code: code, name: c.name, currency: c.currency, fiscal_start_month: c.fy, leave_days: c.leave, taxes: c.taxes.map((t) => ({ code: t[0], name: t[1], rate: t[2], scope: t[3] })) });
  }
  return { countries: out, business_types: Object.keys(BUSINESS_MODULES).map((k) => ({ key: k, modules: BUSINESS_MODULES[k] })) };
}

function complete(ctx, p) {
  const util = u();
  const app = ctx.app;
  const auth = require(`${__hooks}/lib_auth.js`);
  const money = require(`${__hooks}/lib_money.js`);
  if (ctx.isAgent) throw util.fail(403, 'Setup creates the owner\'s account, so a person does it in the app.', 'agent_not_permitted');
  const company = util.squash(util.text(p, 'company_name', 120, ''));
  if (company === '') throw util.fail(400, 'company_name is required', 'missing_param');
  const country = util.str(p, 'country', 'XX').toUpperCase();
  const preset = COUNTRIES[country];
  if (preset === undefined) throw util.fail(400, 'country must be one of: ' + Object.keys(COUNTRIES).join(', '), 'invalid_param');
  let cur = util.str(p, 'currency', preset.currency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) throw util.fail(400, 'currency must be a 3-letter ISO code, e.g. USD', 'invalid_param');
  const fy = util.int(p, 'fiscal_start_month', preset.fy, 1, 12);
  const type = util.oneOf(p, 'business_type', Object.keys(BUSINESS_MODULES), 'services');
  const ownerName = util.squash(util.text(p, 'owner_name', 120, ''));
  if (ownerName === '') throw util.fail(400, 'owner_name is required', 'missing_param');
  const email = auth.normEmail(util.req(p, 'owner_email'));
  auth.checkEmail(email);
  const password = util.str(p, 'password', '');
  auth.checkPassword(password);
  const asEmployee = util.bool(p, 'owner_is_employee', true);
  const today = util.today();

  let owner = null;
  app.runInTransaction((tx) => {
    const n = util.one(tx, 'SELECT COUNT(id) AS n FROM members', { n: 0 }).n;
    if (n > 0) throw util.fail(409, 'This company is already set up. Sign in instead.', 'already_set_up');

    // Chart of accounts.
    const accounts = {};
    const accCol = tx.findCollectionByNameOrId('accounts');
    for (const a of CHART) {
      if (util.findOne(tx, 'accounts', 'code = {:c}', { c: a[0] }) !== null) continue;
      const rec = new Record(accCol);
      rec.set('code', a[0]);
      rec.set('name', a[1]);
      rec.set('type', a[2]);
      rec.set('subtype', a[3]);
      rec.set('system_key', a[4]);
      rec.set('control', a[5]);
      rec.set('archived', false);
      tx.save(rec);
      if (a[4] !== '') accounts[a[4]] = rec.id;
    }

    // Base currency.
    const c = util.newRecord(tx, 'currencies');
    c.set('code', cur);
    c.set('name', cur);
    c.set('rate_e8', money.E8);
    c.set('rate_date', today);
    c.set('archived', false);
    tx.save(c);

    // Bank and cash.
    const bankCol = tx.findCollectionByNameOrId('banks');
    [
      ['Bank account', accounts.bank, 'bank', 0],
      ['Cash on hand', accounts.cash, 'cash', 1],
    ].forEach((b, i) => {
      const rec = new Record(bankCol);
      rec.set('name', b[0]);
      rec.set('account', b[1]);
      rec.set('kind', b[2]);
      rec.set('currency', cur);
      rec.set('color', b[3]);
      rec.set('archived', false);
      rec.set('sort', i + 1);
      tx.save(rec);
    });

    // Taxes.
    let saleTax = '';
    let purchaseTax = '';
    preset.taxes.forEach((t, i) => {
      const rec = util.newRecord(tx, 'taxes');
      rec.set('code', t[0]);
      rec.set('name', t[1]);
      rec.set('rate_bp', money.percentToBp(t[2]));
      rec.set('scope', t[3]);
      rec.set('recoverable', t[4]);
      rec.set('sales_account', t[3] === 'purchase' ? '' : accounts.tax_payable);
      rec.set('purchase_account', t[3] === 'sales' ? '' : accounts.tax_receivable);
      rec.set('archived', false);
      rec.set('sort', i + 1);
      tx.save(rec);
      if (saleTax === '' && t[3] !== 'purchase') saleTax = rec.id;
      if (purchaseTax === '' && t[3] !== 'sales') purchaseTax = rec.id;
    });

    // Main warehouse and item categories.
    const wh = util.newRecord(tx, 'warehouses');
    wh.set('code', 'WH1');
    wh.set('name', 'Main warehouse');
    wh.set('archived', false);
    wh.set('sort', 1);
    tx.save(wh);
    [
      ['General', 'package', accounts.sales, accounts.cogs],
      ['Services', 'briefcase', accounts.service_revenue, accounts.general_expense],
    ].forEach((g, i) => {
      const rec = util.newRecord(tx, 'item_categories');
      rec.set('name', g[0]);
      rec.set('icon', g[1]);
      rec.set('income_account', g[2]);
      rec.set('expense_account', g[3]);
      rec.set('sort', i + 1);
      tx.save(rec);
    });

    // Leave types.
    [
      ['Annual leave', preset.leave, true, true, 5, 'sun'],
      ['Sick leave', 14, true, true, 0, 'thermometer'],
      ['Unpaid leave', 0, false, true, 0, 'calendar-off'],
    ].forEach((l, i) => {
      const rec = util.newRecord(tx, 'leave_types');
      rec.set('name', l[0]);
      rec.set('days_per_year', l[1]);
      rec.set('paid', l[2]);
      rec.set('needs_approval', l[3]);
      rec.set('carry_over_max', l[4]);
      rec.set('icon', l[5]);
      rec.set('archived', false);
      rec.set('sort', i + 1);
      tx.save(rec);
    });

    // Settings.
    const s = require(`${__hooks}/lib_core.js`).settings(tx);
    s.set('company_name', company);
    s.set('legal_name', util.text(p, 'legal_name', 160, company));
    s.set('country', country === 'XX' ? '' : country);
    s.set('base_currency', cur);
    s.set('fiscal_start_month', fy);
    s.set('business_type', type);
    s.set('modules', BUSINESS_MODULES[type]);
    s.set('email', util.text(p, 'company_email', 160, ''));
    s.set('phone', util.text(p, 'company_phone', 40, ''));
    s.set('address', util.text(p, 'company_address', 600, ''));
    s.set('tax_id', util.text(p, 'tax_id', 60, ''));
    s.set('prices_include_tax', util.bool(p, 'prices_include_tax', false));
    s.set('defaults', {
      warehouse: wh.id,
      sale_tax: saleTax,
      purchase_tax: purchaseTax,
      terms: (util.findOne(tx, 'payment_terms', 'name = {:n}', { n: 'Net 30' }) || { id: '' }).id,
    });
    s.set('setup_done', true);
    tx.save(s);

    // The owner.
    const ownerRole = require(`${__hooks}/lib_core.js`).roleByKey(tx, 'owner');
    owner = util.newRecord(tx, 'members');
    owner.set('email', email);
    owner.set('name', ownerName);
    owner.set('title', util.text(p, 'owner_title', 120, ''));
    owner.set('role', ownerRole.id);
    owner.set('status', 'active');
    owner.setPassword(password);
    owner.set('last_seen', util.nowIso());
    tx.save(owner);
    if (asEmployee) {
      const emp = util.newRecord(tx, 'employees');
      emp.set('number', require(`${__hooks}/lib_core.js`).nextNumber(tx, 'employee'));
      emp.set('name', ownerName);
      emp.set('email', email);
      emp.set('job_title', util.text(p, 'owner_title', 120, ''));
      emp.set('status', 'active');
      emp.set('employment', 'full_time');
      emp.set('start_date', today);
      emp.set('pay_frequency', 'monthly');
      emp.set('member', owner.id);
      tx.save(emp);
      owner.set('employee', emp.id);
      tx.save(owner);
    }
    require(`${__hooks}/lib_audit.js`).write(tx, { actor: 'person', member: owner.id }, {
      kind: 'setup',
      entity: 'settings',
      ref: s.id,
      label: company,
      summary: 'Set up ' + company + ' (' + preset.name + ', ' + cur + ', ' + type + ')',
    });
  });
  const fresh = app.findRecordById('members', owner.id);
  return { token: fresh.newAuthToken(), me: auth.me(auth.contextFor(app, fresh)) };
}

module.exports = { COUNTRIES: COUNTRIES, BUSINESS_MODULES: BUSINESS_MODULES, CHART: CHART, status: status, presets: presets, complete: complete };
