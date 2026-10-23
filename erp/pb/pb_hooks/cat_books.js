/**
 * Catalog: the chart of accounts, journal entries, taxes, payment terms,
 * currencies, opening balances, reports, closing the books, budgets and
 * fixed assets.
 */
const s = (desc, x) => Object.assign({ type: 'string', desc: desc }, x || {});
const r = (desc, example) => ({ type: 'string', required: true, desc: desc, example: example });
const b = (desc) => ({ type: 'boolean', desc: desc });
const n = (desc) => ({ type: 'number', desc: desc });
const e = (desc, values) => ({ type: 'string', desc: desc, enum: values });
const re = (desc, values) => ({ type: 'string', required: true, desc: desc, enum: values });
const page = { limit: n('How many to return (default 50)'), offset: n('Skip this many (paging)') };

const TYPES = ['asset', 'liability', 'equity', 'income', 'expense'];
const JLINES = 'JSON list of lines: [{"account":"6100","debit":"500.00","memo":"October rent"},{"account":"1010","credit":"500.00"}] with optional party, employee, department, project';
const period = { from: s('From YYYY-MM-DD (default: start of this month)'), to: s('To YYYY-MM-DD (default today)') };
const dims = { department: s('Only this department'), project: s('Only this project') };

module.exports = [
  /* chart of accounts */
  { name: 'accounts.list', method: 'GET', fn: 'lib_accounts.list', perm: 'self', desc: 'The chart of accounts with balances (balances need Accounting or Reports).', params: { type: e('Type', TYPES), q: s('Search code or name'), archived: b('Include archived'), balances: b('With balances (default true)'), date: s('Balances as at YYYY-MM-DD') } },
  { name: 'accounts.get', method: 'GET', fn: 'lib_accounts.get', perm: 'self', desc: 'One account: its ledger with a running balance, 12 months of movement.', params: Object.assign({ account: r('Account code, name or id', '6100') }, period, page) },
  { name: 'accounts.add', method: 'POST', fn: 'lib_accounts.add', perm: 'self', desc: 'Add an account.', params: { code: r('Code', '6150'), name: r('Name'), type: re('Type', TYPES), subtype: s('Subtype (for the reports)'), parent: s('Parent account (same type)'), description: s('Description') } },
  { name: 'accounts.update', method: 'POST', fn: 'lib_accounts.update', perm: 'self', desc: 'Change an account (archive one with a zero balance).', params: { account: r('Account'), code: s('Code'), name: s('Name'), type: e('Type (only without entries)', TYPES), subtype: s('Subtype'), parent: s('Parent'), description: s('Description'), archived: b('Archived') } },
  { name: 'accounts.delete', method: 'POST', fn: 'lib_accounts.remove', perm: 'self', destructive: true, desc: 'Delete an unused account.', params: { account: r('Account'), preview: b('Only say what would happen') } },

  /* journal entries */
  { name: 'journals.list', method: 'GET', fn: 'lib_accounts.listJournals', perm: 'self', desc: 'Journal entries (every posting of every document and the manual ones).', params: Object.assign({ kind: s('Kind (manual, invoice, bill, payment_in, ...)'), account: s('Touching this account'), q: s('Search number, memo, source'), agent: b('Only those your AI agent made'), from: s('From'), to: s('To') }, page) },
  { name: 'journals.get', method: 'GET', fn: 'lib_accounts.getJournal', perm: 'self', desc: 'One journal entry with its lines.', params: { journal: r('Journal number (JE-00012) or id') } },
  { name: 'journals.preview', method: 'POST', fn: 'lib_accounts.previewJournal', perm: 'self', desc: 'Check a manual journal entry (balance, accounts, lock dates) without posting.', params: { date: s('Date'), memo: s('Memo'), lines: r(JLINES) } },
  {
    name: 'journals.post',
    method: 'POST',
    fn: 'lib_accounts.postJournal',
    perm: 'accounting:full',
    agent: 'propose',
    preview: 'lib_accounts.previewJournal',
    desc: 'Post a manual journal entry (debits must equal credits; control accounts refused). From your AI agent this is a proposal.',
    params: { date: s('Date (default today)'), memo: s('Memo'), lines: r(JLINES) },
  },
  {
    name: 'journals.reverse',
    method: 'POST',
    fn: 'lib_accounts.reverseJournal',
    perm: 'accounting:full',
    agent: 'propose',
    preview: 'lib_accounts.previewReverse',
    desc: "Reverse a manual entry, bank entry or transfer (documents' entries are reversed by voiding the document).",
    params: { journal: r('Journal number'), date: s('Date of the reversal'), memo: s('Memo') },
  },

  { name: 'journals.preview-reverse', method: 'GET', fn: 'lib_accounts.previewReverse', perm: 'accounting:view', desc: 'What reversing a journal entry would post, without posting.', params: { journal: r('Journal number'), date: s('Date of the reversal'), memo: s('Memo') } },

  /* taxes, terms, currencies */
  { name: 'taxes.list', method: 'GET', fn: 'lib_accounts.listTaxes', perm: 'self', desc: 'Taxes with their rates and accounts.', params: { archived: b('Include archived') } },
  { name: 'taxes.add', method: 'POST', fn: 'lib_accounts.addTax', perm: 'self', agent: 'deny', desc: 'Add a tax.', params: { name: r('Name', '"VAT 20%"'), code: r('Code', 'VAT20'), rate: r('Rate in percent', '20'), scope: e('sales, purchase or both', ['sales', 'purchase', 'both']), recoverable: b('Purchase tax can be claimed back (default true)'), sales_account: s('Account for tax collected'), purchase_account: s('Account for tax paid'), description: s('Description') } },
  { name: 'taxes.update', method: 'POST', fn: 'lib_accounts.updateTax', perm: 'self', agent: 'deny', desc: 'Change a tax (the rate of a tax used on posted documents does not change: archive it and add a new one).', params: { tax: r('Tax code or name'), name: s('Name'), code: s('Code'), rate: s('Rate'), scope: e('Scope', ['sales', 'purchase', 'both']), recoverable: b('Recoverable'), sales_account: s('Sales tax account'), purchase_account: s('Purchase tax account'), description: s('Description'), archived: b('Archived') } },
  { name: 'terms.list', method: 'GET', fn: 'lib_accounts.listTerms', perm: 'self', desc: 'Payment terms.', params: {} },
  { name: 'terms.add', method: 'POST', fn: 'lib_accounts.addTerms', perm: 'self', agent: 'deny', desc: 'Add payment terms.', params: { name: r('Name', '"Net 45"'), days: n('Days until due'), end_of_month: b('Due at the end of the next month') } },
  { name: 'terms.update', method: 'POST', fn: 'lib_accounts.updateTerms', perm: 'self', agent: 'deny', desc: 'Change payment terms.', params: { terms: r('Terms name'), name: s('Name'), days: n('Days'), end_of_month: b('End of next month'), archived: b('Archived') } },
  { name: 'currencies.list', method: 'GET', fn: 'lib_accounts.listCurrencies', perm: 'self', desc: 'Currencies and their exchange rates to the base currency.', params: {} },
  { name: 'currencies.set', method: 'POST', fn: 'lib_accounts.setCurrency', perm: 'self', desc: 'Add a currency or change its rate (how many base units one unit is worth).', params: { code: r('Currency code', 'EUR'), name: s('Name'), rate: s('Rate to the base currency'), rate_date: s('Date of the rate'), archived: b('Archived') } },
  { name: 'currencies.refresh', method: 'POST', fn: 'lib_accounts.refreshRates', perm: 'self', desc: "Fetch today's rates for every currency in use (European Central Bank, else currency-api).", params: {} },

  /* opening balances */
  { name: 'opening.accounts', method: 'POST', fn: 'lib_accounts.openingAccounts', perm: 'accounting:full', agent: 'deny', desc: 'Opening balances of accounts at the cut-over date (the difference goes to opening balance equity). Not for receivables, payables or stock.', params: { date: r('Cut-over date', '2026-01-01'), lines: r(JLINES) } },
  { name: 'opening.documents', method: 'POST', fn: 'lib_accounts.openingDocuments', perm: 'accounting:full', agent: 'deny', desc: 'Open invoices or bills at the cut-over: each becomes a posted document that can be paid.', params: { type: re('invoice or bill', ['invoice', 'bill']), date: r('Cut-over date'), lines: r('JSON list [{"party":"Acme","number":"INV-0981","date":"2026-09-15","due_date":"2026-10-15","amount":"1200.00","currency":"USD","fx_rate":"1.35","reference":"..."}]') } },
  { name: 'opening.stock', method: 'POST', fn: 'lib_accounts.openingStock', perm: 'accounting:full', agent: 'deny', desc: 'Opening stock at the cut-over (against opening balance equity).', params: { date: r('Cut-over date'), warehouse: s('Warehouse'), lines: r('JSON list [{"item":"SKU-00001","qty":40,"unit_cost":"2.10"}]') } },

  /* reports */
  { name: 'reports.pnl', method: 'GET', fn: 'lib_reports.pnl', perm: 'reports:view', desc: 'Profit and loss: revenue, cost of sales, gross profit, expenses, net profit; optionally by month and compared with the previous period or last year.', params: Object.assign({ compare: e('Compare with', ['none', 'previous', 'last_year']), by: e('Columns', ['total', 'month']) }, period, dims) },
  { name: 'reports.balance-sheet', method: 'GET', fn: 'lib_reports.balanceSheet', perm: 'reports:view', desc: 'Balance sheet as at a date (current year earnings computed), optionally against a year earlier.', params: { date: s('As at (default today)'), compare: e('Compare with', ['none', 'last_year', 'last_month']) } },
  { name: 'reports.cash-flow', method: 'GET', fn: 'lib_reports.cashFlow', perm: 'reports:view', desc: 'Cash flow: operating, investing and financing, reconciled to the cash accounts.', params: period },
  { name: 'reports.trial-balance', method: 'GET', fn: 'lib_reports.trialBalance', perm: 'reports:view', desc: 'Trial balance: opening, debits, credits and closing per account; debits equal credits.', params: period },
  { name: 'reports.ledger', method: 'GET', fn: 'lib_reports.generalLedger', perm: 'reports:view', desc: 'General ledger: every line in the period, by account.', params: Object.assign({ account: s('One account (default all)') }, period, page) },
  { name: 'reports.aging', method: 'GET', fn: 'lib_reports.aging', perm: 'reports:view', desc: 'Receivables or payables aging per party: current, 1 to 30, 31 to 60, 61 to 90, over 90 days.', params: { side: re('receivable or payable', ['receivable', 'payable']), date: s('As at (default today)') } },
  { name: 'reports.sales', method: 'GET', fn: 'lib_reports.sales', perm: 'reports:view', desc: 'Sales by customer, item, category or month, with cost and margin.', params: Object.assign({ by: e('Group by', ['customer', 'item', 'category', 'month']) }, period) },
  { name: 'reports.purchases', method: 'GET', fn: 'lib_reports.purchases', perm: 'reports:view', desc: 'Purchases by supplier, item or month.', params: Object.assign({ by: e('Group by', ['supplier', 'item', 'month']) }, period) },
  { name: 'reports.stock', method: 'GET', fn: 'lib_reports.stockValuation', perm: 'reports:view', desc: 'Stock valuation per item (and warehouse), checked against the inventory account.', params: { warehouse: s('Warehouse') } },
  { name: 'reports.tax', method: 'GET', fn: 'lib_reports.tax', perm: 'reports:view', desc: 'Tax summary: tax collected on sales and paid on purchases per tax, and the net to pay.', params: period },
  { name: 'reports.budget', method: 'GET', fn: 'lib_reports.budget', perm: 'reports:view', desc: 'Budget against actual per account and month for a fiscal year.', params: { year: n('Fiscal year (the year it starts in)') } },
  { name: 'reports.export', method: 'GET', fn: 'lib_reports.exportCsv', perm: 'reports:view', desc: 'A report as CSV text.', params: Object.assign({ report: re('Which report', ['pnl', 'balance-sheet', 'trial-balance', 'ledger', 'aging', 'sales', 'purchases', 'stock', 'tax']), side: e('Aging side', ['receivable', 'payable']), by: s('Group by'), account: s('Account'), date: s('As at'), compare: s('Compare') }, period, dims) },

  /* close, budgets, assets */
  { name: 'close.status', method: 'GET', fn: 'lib_close.status', perm: 'accounting:view', desc: 'Month-end checklist for a month: drafts left, unreconciled statement lines, goods received not billed, claims not posted, the trial balance, what is closed.', params: { month: s('YYYY-MM (default last month)') } },
  { name: 'close.month', method: 'POST', fn: 'lib_close.closeMonth', perm: 'accounting:full', agent: 'deny', desc: 'Close the books through the end of a month (sets the soft lock date).', params: { month: r('YYYY-MM', '2026-09') } },
  { name: 'close.reopen', method: 'POST', fn: 'lib_close.reopen', perm: 'accounting:full', agent: 'deny', desc: 'Reopen the books back to a month (moves the soft lock date back; administrators only).', params: { month: r('YYYY-MM (reopened from this month on)') } },
  { name: 'budgets.get', method: 'GET', fn: 'lib_close.getBudget', perm: 'accounting:view', desc: 'The budget grid for a fiscal year: income and expense accounts by month.', params: { year: n('Fiscal year') } },
  { name: 'budgets.set', method: 'POST', fn: 'lib_close.setBudget', perm: 'accounting:edit', desc: 'Set budget amounts: [{"account":"6100","month":"2026-11","amount":"5000"}] or one account spread evenly over a year.', params: { lines: s('JSON list of {account, month, amount}'), account: s('One account to spread'), year: n('Fiscal year to spread over'), annual: s('Yearly amount to spread evenly') } },
  { name: 'assets.list', method: 'GET', fn: 'lib_assets.list', perm: 'accounting:view', desc: 'Fixed assets with cost, depreciation to date and book value.', params: { status: e('Status', ['active', 'disposed']) } },
  { name: 'assets.get', method: 'GET', fn: 'lib_assets.get', perm: 'accounting:view', desc: 'One fixed asset with its depreciation schedule.', params: { asset: r('Asset number or name') } },
  { name: 'assets.add', method: 'POST', fn: 'lib_assets.add', perm: 'accounting:edit', desc: 'Register a fixed asset (straight-line depreciation monthly from its start). This only records it in the register: its cost reaches the books through the bill that bought it (a line on the asset account, 1500 by default) or opening.accounts for assets owned before the books started.', params: { name: r('Name'), cost: r('Cost'), salvage: s('Value left at the end'), start: r('In service from YYYY-MM-DD'), life_months: r('Useful life in months', '36'), asset_account: s('Asset account (default Equipment)'), accumulated_account: s('Accumulated depreciation account'), expense_account: s('Depreciation expense account'), department: s('Department'), notes: s('Notes') } },
  { name: 'assets.update', method: 'POST', fn: 'lib_assets.update', perm: 'accounting:edit', desc: 'Change a fixed asset (cost and life only before depreciation has posted).', params: { asset: r('Asset'), name: s('Name'), cost: s('Cost'), salvage: s('Salvage value'), start: s('In service from'), life_months: s('Useful life in months'), department: s('Department'), notes: s('Notes') } },
  {
    name: 'assets.depreciate',
    method: 'POST',
    fn: 'lib_assets.depreciate',
    perm: 'accounting:full',
    agent: 'propose',
    preview: 'lib_assets.previewDepreciate',
    desc: 'Post depreciation for every active asset through a month (one entry per month, never twice).',
    params: { month: r('Through YYYY-MM', '2026-10') },
  },
  { name: 'assets.preview-depreciate', method: 'GET', fn: 'lib_assets.previewDepreciate', perm: 'accounting:view', desc: 'What posting depreciation through a month would post, without posting.', params: { month: r('Through YYYY-MM', '2026-10') } },
  { name: 'assets.dispose', method: 'POST', fn: 'lib_assets.dispose', perm: 'accounting:full', agent: 'deny', desc: 'Dispose of an asset: removes its cost and depreciation, the book value to a loss (or the proceeds account).', params: { asset: r('Asset'), date: r('Disposal date'), proceeds: s('Money received'), proceeds_account: s('Where the money went (a bank account code)') } },
  { name: 'assets.delete', method: 'POST', fn: 'lib_assets.remove', perm: 'accounting:edit', destructive: true, desc: 'Delete an asset with no depreciation posted.', params: { asset: r('Asset'), preview: b('Only say what would happen') } },
];
