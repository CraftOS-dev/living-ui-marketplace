/**
 * Catalog: payments in and out, allocations, and banking (bank accounts,
 * statements, reconciliation).
 */
const s = (desc, x) => Object.assign({ type: 'string', desc: desc }, x || {});
const r = (desc, example) => ({ type: 'string', required: true, desc: desc, example: example });
const b = (desc) => ({ type: 'boolean', desc: desc });
const n = (desc) => ({ type: 'number', desc: desc });
const e = (desc, values) => ({ type: 'string', desc: desc, enum: values });
const re = (desc, values) => ({ type: 'string', required: true, desc: desc, enum: values });
const page = { limit: n('How many to return (default 50)'), offset: n('Skip this many (paging)') };

const PAY = 'Payment number (RCV-00003, PAY-00007) or id';
const METHODS = ['bank_transfer', 'cash', 'card', 'cheque', 'online', 'other'];
const ALLOC = 'JSON list: [{"doc":"INV-00012","amount":"150.00"}] (amount empty: all that is open)';

const payFields = {
  party: s('Customer or supplier'),
  bank: s('Bank or cash account (default: the first bank account)'),
  date: s('Date YYYY-MM-DD (default today)'),
  amount: s('Amount in the bank account currency, e.g. 1250.00'),
  fx_rate: s('Exchange rate when the bank is not in the base currency'),
  method: e('How it was paid', METHODS),
  reference: s('Reference (bank reference, cheque number)'),
  memo: s('Memo'),
  agent_note: s('Your AI agent: where this came from'),
};

module.exports = [
  { name: 'payments.list', method: 'GET', fn: 'lib_payments.list', perm: 'self', desc: 'Payments received (in) or made (out).', params: Object.assign({ direction: re('in (from customers) or out (to suppliers)', ['in', 'out']), status: e('Filter', ['draft', 'posted', 'void', 'unallocated']), party: s('Party'), bank: s('Bank account'), q: s('Search number, reference, party'), from: s('From YYYY-MM-DD'), to: s('To YYYY-MM-DD') }, page) },
  { name: 'payments.get', method: 'GET', fn: 'lib_payments.get', perm: 'self', desc: 'One payment: what it settles, what is left, open documents of the party.', params: { payment: r(PAY) } },
  { name: 'payments.create', method: 'POST', fn: 'lib_payments.create', perm: 'self', desc: 'Draft a payment (posting moves the money).', params: Object.assign({ direction: re('in or out', ['in', 'out']), allocations: s(ALLOC) }, payFields, { party: r('Customer or supplier'), amount: r('Amount', '1250.00') }) },
  { name: 'payments.update', method: 'POST', fn: 'lib_payments.update', perm: 'self', desc: 'Change a draft payment.', params: Object.assign({ payment: r(PAY) }, payFields) },
  {
    name: 'payments.post',
    method: 'POST',
    fn: 'lib_payments.post',
    perm: 'pay:full',
    agent: 'propose',
    preview: 'lib_payments.previewPost',
    desc: "Post a draft payment: the money moves and it settles the planned (or the oldest open) invoices or bills. From your AI agent this is always a proposal.",
    params: { payment: r(PAY), auto_allocate: b('Settle the oldest open documents when none were planned (default true)') },
  },
  {
    name: 'payments.record',
    method: 'POST',
    fn: 'lib_payments.record',
    perm: 'pay:full',
    agent: 'propose',
    preview: 'lib_payments.previewRecord',
    desc: 'Record and post a payment in one step (with allocations, or the oldest open documents first). From your AI agent this is always a proposal.',
    params: Object.assign({ direction: re('in or out', ['in', 'out']), allocations: s(ALLOC), auto_allocate: b('Settle the oldest open documents (default true)') }, payFields, { party: r('Customer or supplier'), amount: r('Amount', '1250.00') }),
  },
  {
    name: 'payments.void',
    method: 'POST',
    fn: 'lib_payments.voidPayment',
    perm: 'pay:full',
    agent: 'propose',
    preview: 'lib_payments.previewVoid',
    desc: 'Void a posted payment: removes what it settled and reverses its entry.',
    params: { payment: r(PAY), reason: s('Why'), date: s('Date of the reversal') },
  },
  {
    name: 'payments.preview-record',
    method: 'POST',
    fn: 'lib_payments.previewRecord',
    perm: 'self',
    desc: 'What recording a payment would post (the journal lines), without posting.',
    params: Object.assign({ direction: re('in or out', ['in', 'out']), allocations: s(ALLOC), auto_allocate: b('Settle the oldest open documents (default true)') }, payFields, { party: r('Customer or supplier'), amount: r('Amount', '1250.00') }),
  },
  { name: 'payments.preview-post', method: 'GET', fn: 'lib_payments.previewPost', perm: 'self', desc: 'What posting a draft payment would post (the journal lines), without posting.', params: { payment: r(PAY), auto_allocate: b('Settle the oldest open documents when none were planned (default true)') } },
  { name: 'payments.preview-void', method: 'GET', fn: 'lib_payments.previewVoid', perm: 'self', desc: 'What voiding a posted payment would reverse, without voiding.', params: { payment: r(PAY), reason: s('Why'), date: s('Date of the reversal') } },
  { name: 'payments.delete', method: 'POST', fn: 'lib_payments.remove', perm: 'self', destructive: true, desc: 'Delete a draft payment.', params: { payment: r(PAY), preview: b('Only say what would happen') } },
  { name: 'payments.apply', method: 'POST', fn: 'lib_payments.applyTo', perm: 'self', desc: 'Apply what is left of a posted payment, or of a credit note or supplier credit, to open invoices or bills (default: oldest first).', params: { payment: s(PAY), credit: s('Credit note or supplier credit number'), allocations: s(ALLOC) } },
  { name: 'payments.unallocate', method: 'POST', fn: 'lib_payments.unallocate', perm: 'self', desc: 'Take back one allocation (the invoice or bill is open again).', params: { allocation: r('Allocation id') } },

  /* banking */
  { name: 'banks.list', method: 'GET', fn: 'lib_banking.list', perm: 'self', desc: 'Bank, cash and card accounts with their balance in the books, the last statement balance and lines to reconcile.', params: { archived: b('Include archived') } },
  { name: 'banks.get', method: 'GET', fn: 'lib_banking.get', perm: 'self', desc: 'One bank account: balances, 90 days of balance, recent activity.', params: { bank: r('Bank account name or id') } },
  { name: 'banks.add', method: 'POST', fn: 'lib_banking.add', perm: 'banking:full', agent: 'deny', desc: 'Add a bank, cash or card account (it gets its own ledger account).', params: { name: r('Name', '"Main current account"'), kind: e('bank, cash or card', ['bank', 'cash', 'card']), currency: s('Currency (default base)'), bank_name: s('Bank'), account_number: s('Account number (last digits)'), code: s('Ledger account code (automatic when empty)') } },
  { name: 'banks.update', method: 'POST', fn: 'lib_banking.update', perm: 'banking:full', agent: 'deny', desc: 'Change a bank account.', params: { bank: r('Bank account'), name: s('Name'), bank_name: s('Bank'), account_number: s('Account number'), archived: b('Archived'), color: n('Card color 0 to 7') } },
  { name: 'bank.lines', method: 'GET', fn: 'lib_banking.lines', perm: 'self', desc: 'Statement lines of a bank account.', params: Object.assign({ bank: r('Bank account'), status: e('Filter', ['unmatched', 'matched', 'ignored']), q: s('Search description or reference'), from: s('From YYYY-MM-DD'), to: s('To YYYY-MM-DD') }, page) },
  { name: 'bank.add-line', method: 'POST', fn: 'lib_banking.addLine', perm: 'self', desc: 'Add one statement line by hand.', params: { bank: r('Bank account'), date: r('Date YYYY-MM-DD'), amount: r('Amount: money in positive, money out negative', '-45.20'), description: r('Description'), reference: s('Reference') } },
  { name: 'bank.delete-line', method: 'POST', fn: 'lib_banking.deleteLine', perm: 'self', destructive: true, desc: 'Delete an unmatched statement line.', params: { line: r('Line id'), preview: b('Only say what would happen') } },
  { name: 'bank.import-preview', method: 'POST', fn: 'lib_banking.importPreview', perm: 'self', files: ['file'], desc: 'Read a bank statement CSV: detected columns, date layout and sign, the first rows, and how many are new. Nothing is written.', params: { bank: r('Bank account'), path: s('Absolute path of the CSV (your AI agent)'), import_id: s('A previous preview to adjust'), date_col: n('Date column (0 first)'), amount_col: n('Amount column'), debit_col: n('Money-out column (when separate)'), credit_col: n('Money-in column (when separate)'), description_col: n('Description column'), reference_col: n('Reference column'), date_format: s('Date layout, e.g. DD/MM/YYYY (default detected)'), decimal: e('Decimal mark', ['.', ',']), flip: b('Money in shows as negative'), has_header: b('The first row is a header (default detected)') } },
  { name: 'bank.import-run', method: 'POST', fn: 'lib_banking.importRun', perm: 'self', desc: 'Import the previewed statement (lines already here are skipped).', params: { import_id: r('The preview id'), date_col: n('Date column'), amount_col: n('Amount column'), debit_col: n('Money-out column'), credit_col: n('Money-in column'), description_col: n('Description column'), reference_col: n('Reference column'), date_format: s('Date layout'), decimal: e('Decimal mark', ['.', ',']), flip: b('Money in shows as negative'), has_header: b('The first row is a header') } },
  { name: 'bank.import-undo', method: 'POST', fn: 'lib_banking.importUndo', perm: 'self', destructive: true, desc: 'Remove the unmatched lines a statement import added.', params: { import_id: r('Import id') } },
  { name: 'bank.imports', method: 'GET', fn: 'lib_banking.imports', perm: 'self', desc: 'Past statement imports.', params: { bank: s('Bank account') } },
  { name: 'bank.suggest', method: 'GET', fn: 'lib_banking.suggest', perm: 'self', desc: 'What a statement line could be: payments and entries of the same amount near its date, open invoices or bills of that amount, exact references.', params: { line: r('Line id') } },
  { name: 'bank.match', method: 'POST', fn: 'lib_banking.match', perm: 'self', desc: 'Match a statement line to a posted payment or journal entry.', params: { line: r('Line id'), payment: s(PAY), journal: s('Journal entry number') } },
  { name: 'bank.unmatch', method: 'POST', fn: 'lib_banking.unmatch', perm: 'self', desc: 'Undo a match (the payment or entry stays).', params: { line: r('Line id') } },
  {
    name: 'bank.create-payment',
    method: 'POST',
    fn: 'lib_banking.createPayment',
    perm: 'banking:full',
    agent: 'propose',
    preview: 'lib_banking.previewCreatePayment',
    desc: 'Turn a statement line into a posted payment from a customer or to a supplier, settling documents, and match it.',
    params: { line: r('Line id'), party: r('Customer or supplier'), allocations: s(ALLOC), memo: s('Memo') },
  },
  {
    name: 'bank.create-entry',
    method: 'POST',
    fn: 'lib_banking.createEntry',
    perm: 'banking:full',
    agent: 'propose',
    preview: 'lib_banking.previewCreateEntry',
    desc: 'Turn a statement line into a journal entry against an account (bank fees, interest, a tax payment, owner money) and match it.',
    params: { line: r('Line id'), account: r('Account code or name', '6800'), tax: s('Tax on it (recoverable taxes split out)'), memo: s('Memo'), project: s('Project'), department: s('Department') },
  },
  {
    name: 'bank.transfer',
    method: 'POST',
    fn: 'lib_banking.transfer',
    perm: 'banking:full',
    agent: 'propose',
    preview: 'lib_banking.previewTransfer',
    desc: 'Move money between two of your accounts (and match the statement line when given).',
    params: { from_bank: r('From account'), to_bank: r('To account'), amount: r('Amount in the from-account currency'), date: s('Date (default today)'), to_amount: s('Amount arriving, when the currencies differ'), line: s('Statement line to match'), memo: s('Memo') },
  },
  { name: 'bank.preview-create-payment', method: 'GET', fn: 'lib_banking.previewCreatePayment', perm: 'banking:view', desc: 'What turning a statement line into a payment would post, without posting.', params: { line: r('Line id'), party: r('Customer or supplier'), allocations: s(ALLOC), memo: s('Memo') } },
  { name: 'bank.preview-create-entry', method: 'GET', fn: 'lib_banking.previewCreateEntry', perm: 'banking:view', desc: 'What booking a statement line against an account would post, without posting.', params: { line: r('Line id'), account: r('Account code or name', '6800'), tax: s('Tax on it'), memo: s('Memo'), project: s('Project'), department: s('Department') } },
  { name: 'bank.preview-transfer', method: 'GET', fn: 'lib_banking.previewTransfer', perm: 'banking:view', desc: 'What a transfer between two of your accounts would post, without posting.', params: { from_bank: r('From account'), to_bank: r('To account'), amount: r('Amount in the from-account currency'), date: s('Date'), to_amount: s('Amount arriving, when the currencies differ'), line: s('Statement line to match'), memo: s('Memo') } },
  { name: 'bank.ignore', method: 'POST', fn: 'lib_banking.ignore', perm: 'self', desc: 'Ignore a statement line (a duplicate, or already in the books another way), or bring it back.', params: { line: r('Line id'), ignore: b('true to ignore, false to bring back') } },
  { name: 'bank.reconcile-summary', method: 'GET', fn: 'lib_banking.summary', perm: 'self', desc: 'Statement balance against the books for a bank account at a date.', params: { bank: r('Bank account'), date: s('As at YYYY-MM-DD') } },
];
