/// <reference path="../pb_data/types.d.ts" />
/**
 * Settings, the default chart of accounts and tax presets.
 *
 * The chart covers a business, a household, or both in one set of books.
 * System accounts (receivables, payables, tax control, opening balances,
 * retained earnings, uncategorized, suspense, transfers in transit, FX)
 * carry a `system` role the ledger finds them by; they can be renamed, not
 * removed. Every account has a "use this when" description, which is the
 * text the AI agent reads before it picks an account.
 */

// [code, name, type, subtype, cashflow, system, for (b=business p=personal), description]
const CHART = [
  ['1000', 'Checking account', 'asset', 'bank', 'cash', '', 'bp', 'Your main bank account: deposits, card payments and transfers clear here.'],
  ['1010', 'Savings account', 'asset', 'bank', 'cash', '', 'bp', 'Money set aside in a savings or deposit account.'],
  ['1050', 'Cash on hand', 'asset', 'cash', 'cash', '', 'bp', 'Physical cash in a wallet, till or petty-cash box.'],
  ['1100', 'Accounts receivable', 'asset', 'receivable', 'operating', 'ar', 'b', 'Money customers owe you for approved invoices. Posted by invoices and payments, never by hand.'],
  ['1200', 'Prepaid expenses', 'asset', 'current_asset', 'operating', '', 'b', 'Costs paid in advance for later periods, such as a yearly insurance premium.'],
  ['1500', 'Equipment', 'asset', 'fixed_asset', 'investing', '', 'b', 'Computers, machinery and furniture kept for more than a year.'],
  ['1510', 'Accumulated depreciation', 'asset', 'contra_asset', 'investing', '', 'b', 'The part of equipment cost already expensed as depreciation (a negative asset).'],
  ['1600', 'Investments', 'asset', 'investment', 'investing', '', 'p', 'Brokerage, retirement and other investment accounts at their value.'],
  ['1900', 'Transfers in transit', 'asset', 'clearing', 'cash', 'transfers', 'bp', 'Money moving between your own accounts that has left one and not yet arrived in the other.'],
  ['2000', 'Credit card', 'liability', 'card', 'operating', '', 'bp', 'Your credit card: purchases increase it, payments reduce it.'],
  ['2100', 'Accounts payable', 'liability', 'payable', 'operating', 'ap', 'b', 'Money you owe suppliers for approved bills. Posted by bills and payments, never by hand.'],
  ['2200', 'Tax control', 'liability', 'tax', 'operating', 'tax', 'bp', 'Sales tax, VAT or GST collected minus tax paid on purchases. Its balance is what you owe (or are owed).'],
  ['2300', 'Loans', 'liability', 'loan', 'financing', '', 'bp', 'Loans, mortgages and lines of credit: principal only (interest is an expense).'],
  ['2400', 'Accrued liabilities', 'liability', 'current_liability', 'operating', '', 'b', 'Costs incurred but not billed yet, recorded at period end.'],
  ['2900', 'Suspense', 'liability', 'clearing', 'operating', 'suspense', 'bp', 'Amounts you cannot place yet. Should be empty at every close.'],
  ['3000', "Owner's equity", 'equity', 'equity', 'financing', '', 'b', 'Money the owner put into the business.'],
  ['3100', "Owner's drawings", 'equity', 'equity', 'financing', '', 'b', 'Money the owner took out of the business for personal use.'],
  ['3200', 'Retained earnings', 'equity', 'retained', 'financing', 'retained', 'bp', 'Profits of earlier years kept in the business. Computed at year end; not posted by hand.'],
  ['3900', 'Opening balance equity', 'equity', 'opening', 'financing', 'opening', 'bp', 'The other side of opening balances when you start your books.'],
  ['4000', 'Sales', 'income', 'income', 'operating', 'sales', 'b', 'Revenue from selling goods.'],
  ['4100', 'Service revenue', 'income', 'income', 'operating', '', 'b', 'Revenue from services, consulting and fees you invoice.'],
  ['4200', 'Interest income', 'income', 'other_income', 'operating', '', 'bp', 'Interest paid to you by banks and savings accounts.'],
  ['4300', 'Salary and wages', 'income', 'income', 'operating', '', 'p', 'Pay from an employer, after or before deductions as you record it.'],
  ['4400', 'Other income', 'income', 'other_income', 'operating', '', 'bp', 'Income that fits nowhere else: refunds of personal spending, gifts received, one-off payments.'],
  ['4900', 'Uncategorized income', 'income', 'other_income', 'operating', 'uncat_income', 'bp', 'Money in that has not been categorized yet. Should be empty at every close.'],
  ['5000', 'Cost of goods sold', 'expense', 'cogs', 'operating', '', 'b', 'What the goods you sold cost you: stock, materials, shipping in.'],
  ['6000', 'Advertising and marketing', 'expense', 'expense', 'operating', '', 'b', 'Ads, promotion, sponsorships, marketing services.'],
  ['6010', 'Bank fees', 'expense', 'expense', 'operating', '', 'bp', 'Account fees, card fees, wire and foreign transaction fees charged by banks.'],
  ['6020', 'Software and subscriptions', 'expense', 'expense', 'operating', '', 'bp', 'SaaS, apps, hosting, domains and other recurring digital services.'],
  ['6030', 'Office supplies', 'expense', 'expense', 'operating', '', 'b', 'Stationery, small equipment under the capitalization threshold, printing.'],
  ['6040', 'Rent', 'expense', 'expense', 'operating', '', 'b', 'Office, studio, desk or storage rent.'],
  ['6050', 'Utilities', 'expense', 'expense', 'operating', '', 'bp', 'Electricity, water, gas, heating.'],
  ['6060', 'Travel', 'expense', 'expense', 'operating', '', 'b', 'Business flights, hotels, taxis and mileage.'],
  ['6070', 'Meals and entertainment', 'expense', 'expense', 'operating', '', 'b', 'Business meals and client entertainment.'],
  ['6080', 'Professional fees', 'expense', 'expense', 'operating', '', 'b', 'Accountants, lawyers, consultants.'],
  ['6090', 'Insurance', 'expense', 'expense', 'operating', '', 'bp', 'Business and personal insurance premiums.'],
  ['6100', 'Phone and internet', 'expense', 'expense', 'operating', '', 'bp', 'Mobile plans, broadband, phone lines.'],
  ['6110', 'Contractors', 'expense', 'expense', 'operating', '', 'b', 'Freelancers and subcontractors paid for work.'],
  ['6120', 'Interest expense', 'expense', 'other_expense', 'operating', '', 'bp', 'Interest on loans, mortgages and credit cards.'],
  ['6130', 'Depreciation', 'expense', 'expense', 'operating', '', 'b', 'The yearly share of equipment cost.'],
  ['6140', 'Bad debts', 'expense', 'expense', 'operating', 'bad_debt', 'b', 'Invoices written off because they will not be paid.'],
  ['6150', 'Repairs and maintenance', 'expense', 'expense', 'operating', '', 'bp', 'Fixing equipment, vehicles and premises.'],
  ['6160', 'Taxes and licences', 'expense', 'expense', 'operating', '', 'b', 'Business taxes and licence fees that are a cost (not sales tax or VAT).'],
  ['6900', 'Other expenses', 'expense', 'expense', 'operating', '', 'b', 'Business costs that fit nowhere else.'],
  ['6990', 'Uncategorized expense', 'expense', 'other_expense', 'operating', 'uncat_expense', 'bp', 'Money out that has not been categorized yet. Should be empty at every close.'],
  ['7000', 'Groceries', 'expense', 'expense', 'operating', '', 'p', 'Food and household supplies for home.'],
  ['7010', 'Dining out', 'expense', 'expense', 'operating', '', 'p', 'Restaurants, cafes, takeaway and delivery for yourself.'],
  ['7020', 'Housing', 'expense', 'expense', 'operating', '', 'p', 'Rent or mortgage interest, home fees and home maintenance.'],
  ['7030', 'Transport', 'expense', 'expense', 'operating', '', 'p', 'Fuel, public transport, parking, car costs, rides.'],
  ['7040', 'Health', 'expense', 'expense', 'operating', '', 'p', 'Doctors, pharmacy, gym, health insurance not counted elsewhere.'],
  ['7050', 'Entertainment', 'expense', 'expense', 'operating', '', 'p', 'Streaming, games, events, hobbies.'],
  ['7060', 'Shopping', 'expense', 'expense', 'operating', '', 'p', 'Clothing, electronics and other personal purchases.'],
  ['7070', 'Personal care', 'expense', 'expense', 'operating', '', 'p', 'Haircuts, cosmetics, wellness.'],
  ['7080', 'Gifts and donations', 'expense', 'expense', 'operating', '', 'p', 'Presents and charitable donations.'],
  ['7090', 'Education', 'expense', 'expense', 'operating', '', 'p', 'Tuition, courses, books for learning.'],
  ['7100', 'Family and childcare', 'expense', 'expense', 'operating', '', 'p', 'Childcare, school costs, support for family.'],
  ['8000', 'Exchange gains and losses', 'expense', 'other_expense', 'operating', 'fx', 'bp', 'Differences from currency rates between booking and payment, and period-end revaluation. A gain shows as a negative cost.'],
  ['8100', 'Rounding', 'expense', 'other_expense', 'operating', 'rounding', 'bp', 'Cent differences from tax and currency rounding.'],
];

/** Tax presets: [code, name, rate, scope, group, description] */
const REGIONS = {
  none: { name: 'No sales tax or VAT', codes: [] },
  uk_vat: {
    name: 'United Kingdom VAT',
    codes: [
      ['S20', 'Standard 20%', '20', 'both', 'standard', 'Most goods and services.'],
      ['R5', 'Reduced 5%', '5', 'both', 'reduced', 'Domestic energy, child car seats and other reduced-rate items.'],
      ['Z0', 'Zero rated', '0', 'both', 'zero', 'Zero-rated supplies such as most food and books (still reported).'],
      ['EX', 'Exempt', '0', 'both', 'exempt', 'Exempt supplies such as insurance and some financial services.'],
      ['RC20', 'Reverse charge 20%', '20', 'purchases', 'reverse', 'Services bought from abroad: you account for the VAT as both output and input tax.'],
      ['NV', 'Outside the scope', '0', 'both', 'outside', 'Not a supply for VAT: wages, transfers, drawings.'],
    ],
  },
  eu_vat: {
    name: 'European Union VAT (set your country rates)',
    codes: [
      ['STD', 'Standard rate', '21', 'both', 'standard', 'Your country standard rate; edit it to match.'],
      ['RED', 'Reduced rate', '9', 'both', 'reduced', 'Your country reduced rate; edit it to match.'],
      ['ZERO', 'Zero rated', '0', 'both', 'zero', 'Zero-rated supplies, including intra-EU supplies of goods to businesses.'],
      ['EX', 'Exempt', '0', 'both', 'exempt', 'Exempt supplies.'],
      ['RC', 'Reverse charge', '21', 'purchases', 'reverse', 'Services and goods bought from other EU businesses: self-account for VAT.'],
      ['OUT', 'Outside the scope', '0', 'both', 'outside', 'Not a supply for VAT.'],
    ],
  },
  au_gst: {
    name: 'Australia GST',
    codes: [
      ['GST', 'GST 10%', '10', 'both', 'standard', 'Taxable supplies and purchases with GST.'],
      ['FRE', 'GST free', '0', 'both', 'zero', 'GST-free supplies such as basic food, exports, health.'],
      ['INP', 'Input taxed', '0', 'both', 'exempt', 'Input-taxed supplies such as residential rent and financial supplies.'],
      ['N-T', 'Not reportable', '0', 'both', 'outside', 'Not a supply for GST: wages, transfers.'],
    ],
  },
  nz_gst: {
    name: 'New Zealand GST',
    codes: [
      ['GST', 'GST 15%', '15', 'both', 'standard', 'Standard-rated supplies and purchases.'],
      ['ZERO', 'Zero rated', '0', 'both', 'zero', 'Exports and other zero-rated supplies.'],
      ['EX', 'Exempt', '0', 'both', 'exempt', 'Exempt supplies such as residential rent and financial services.'],
    ],
  },
  sg_gst: {
    name: 'Singapore GST',
    codes: [
      ['SR', 'Standard rated 9%', '9', 'both', 'standard', 'Standard-rated supplies and purchases.'],
      ['ZR', 'Zero rated', '0', 'both', 'zero', 'Exports of goods and international services.'],
      ['ES', 'Exempt', '0', 'both', 'exempt', 'Exempt supplies such as financial services and residential property.'],
      ['OS', 'Out of scope', '0', 'both', 'outside', 'Not a supply for GST.'],
    ],
  },
  my_sst: {
    name: 'Malaysia SST',
    codes: [
      ['SV8', 'Service tax 8%', '8', 'both', 'standard', 'Taxable services at the standard service tax rate.'],
      ['ST10', 'Sales tax 10%', '10', 'both', 'standard', 'Taxable goods at the standard sales tax rate.'],
      ['ST5', 'Sales tax 5%', '5', 'both', 'reduced', 'Goods at the reduced sales tax rate.'],
      ['EX', 'Exempt', '0', 'both', 'exempt', 'Exempt goods and services.'],
    ],
  },
  ca_gst: {
    name: 'Canada GST/HST',
    codes: [
      ['GST', 'GST 5%', '5', 'both', 'standard', 'Provinces with GST only.'],
      ['HST13', 'HST 13%', '13', 'both', 'standard', 'Ontario HST.'],
      ['HST15', 'HST 15%', '15', 'both', 'standard', 'Atlantic provinces HST.'],
      ['ZERO', 'Zero rated', '0', 'both', 'zero', 'Basic groceries, exports and other zero-rated supplies.'],
      ['EX', 'Exempt', '0', 'both', 'exempt', 'Exempt supplies.'],
    ],
  },
  us_sales: {
    name: 'United States sales tax (single rate)',
    codes: [
      ['TAX', 'Sales tax', '8.25', 'sales', 'standard', 'Your combined state and local rate; edit it to match.'],
      ['EXEMPT', 'Exempt', '0', 'sales', 'exempt', 'Exempt sales: resale, exempt customers, non-taxable items.'],
    ],
  },
  in_gst: {
    name: 'India GST',
    codes: [
      ['GST18', 'GST 18%', '18', 'both', 'standard', 'Most services and many goods.'],
      ['GST12', 'GST 12%', '12', 'both', 'reduced', 'Goods and services in the 12% slab.'],
      ['GST5', 'GST 5%', '5', 'both', 'reduced', 'Goods and services in the 5% slab.'],
      ['GST28', 'GST 28%', '28', 'both', 'standard', 'Goods in the 28% slab.'],
      ['ZERO', 'Nil rated', '0', 'both', 'zero', 'Nil-rated and zero-rated supplies.'],
      ['EX', 'Exempt', '0', 'both', 'exempt', 'Exempt supplies.'],
    ],
  },
};

const DEFAULT_POLICY = {
  // The AI agent proposes; nothing it categorizes posts on its own unless
  // the person allows it here: high-confidence proposals up to `ceiling`
  // (a decimal in the home currency; empty = any amount).
  agent_auto_post: false,
  ceiling: '',
  // System suggestions of these methods (match, transfer, document, memory)
  // post on import when their confidence is high.
  auto_methods: [],
  // Standing instructions the AI agent follows when it categorizes.
  house_rules: '',
};

function row(app) {
  const rows = app.findRecordsByFilter('settings', 'id != ""', 'created', 1, 0);
  if (rows.length > 0) return rows[0];
  const rec = new Record(app.findCollectionByNameOrId('settings'));
  rec.set('home_currency', 'USD');
  rec.set('entity', 'both');
  rec.set('fiscal_year_start', 1);
  rec.set('region', 'none');
  rec.set('rounding', 'line');
  rec.set('invoice_prefix', 'INV-');
  rec.set('invoice_next', 1001);
  rec.set('credit_prefix', 'CN-');
  rec.set('credit_next', 1);
  rec.set('payment_terms', 14);
  rec.set('policy', DEFAULT_POLICY);
  rec.set('agent_categorize', true);
  app.save(rec);
  return rec;
}

function policy(rec) {
  const u = require(`${__hooks}/lib_util.js`);
  return Object.assign({}, DEFAULT_POLICY, u.json(rec, 'policy', {}) || {});
}

function serialize(rec) {
  const u = require(`${__hooks}/lib_util.js`);
  return {
    id: rec.id,
    business_name: rec.getString('business_name'),
    entity: rec.getString('entity') || 'both',
    home_currency: rec.getString('home_currency') || 'USD',
    fiscal_year_start: rec.getInt('fiscal_year_start') || 1,
    region: rec.getString('region') || 'none',
    region_name: (REGIONS[rec.getString('region') || 'none'] || REGIONS.none).name,
    rounding: rec.getString('rounding') || 'line',
    lock_date: rec.getString('lock_date'),
    agent_lock_date: rec.getString('agent_lock_date'),
    tax_lock_date: rec.getString('tax_lock_date'),
    invoice_prefix: rec.getString('invoice_prefix'),
    invoice_next: rec.getInt('invoice_next'),
    credit_prefix: rec.getString('credit_prefix'),
    credit_next: rec.getInt('credit_next'),
    payment_terms: rec.getInt('payment_terms'),
    business_address: rec.getString('business_address'),
    business_email: rec.getString('business_email'),
    business_tax_id: rec.getString('business_tax_id'),
    invoice_footer: rec.getString('invoice_footer'),
    policy: policy(rec),
    ui: u.json(rec, 'ui', {}) || {},
    agent_categorize: rec.getBool('agent_categorize'),
    setup_done: rec.getBool('setup_done'),
  };
}

/**
 * Create the chart of accounts and tax codes for a new set of books.
 * Accounts that already exist (by code) are left alone.
 */
function seed(app, entity, currency, region) {
  const want = entity === 'business' ? 'b' : entity === 'personal' ? 'p' : '';
  const col = app.findCollectionByNameOrId('accounts');
  const byCode = {};
  for (const a of app.findRecordsByFilter('accounts', 'id != ""', '', 0, 0)) byCode[a.getString('code')] = a;
  let sort = 0;
  for (const c of CHART) {
    sort += 10;
    if (want !== '' && c[6].indexOf(want) < 0 && c[5] === '') continue;
    if (byCode[c[0]]) continue;
    const r = new Record(col);
    r.set('code', c[0]);
    r.set('name', c[1]);
    r.set('type', c[2]);
    r.set('subtype', c[3]);
    r.set('cashflow', c[4]);
    r.set('system', c[5]);
    r.set('description', c[7]);
    r.set('currency', currency);
    r.set('sort', sort);
    app.save(r);
    byCode[c[0]] = r;
  }
  const preset = REGIONS[region] || REGIONS.none;
  const taxAcc = byCode['2200'];
  const tcol = app.findCollectionByNameOrId('tax_codes');
  const have = {};
  for (const t of app.findRecordsByFilter('tax_codes', 'id != ""', '', 0, 0)) have[t.getString('code')] = true;
  let ts = 0;
  for (const t of preset.codes) {
    ts += 10;
    if (have[t[0]]) continue;
    const r = new Record(tcol);
    r.set('code', t[0]);
    r.set('name', t[1]);
    r.set('rate', t[2]);
    r.set('scope', t[3]);
    r.set('group', t[4]);
    r.set('description', t[5]);
    if (taxAcc) r.set('account', taxAcc.id);
    r.set('sort', ts);
    app.save(r);
  }
}

module.exports = { CHART: CHART, REGIONS: REGIONS, DEFAULT_POLICY: DEFAULT_POLICY, row: row, policy: policy, serialize: serialize, seed: seed };
