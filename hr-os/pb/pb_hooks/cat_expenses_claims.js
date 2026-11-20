/**
 * Catalog: expense claims and their lines (receipts, readings by your AI
 * agent, flags, approval and payment).
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const CLAIM = S('Claim number (EXP-0001) or id', { required: true, example: 'EXP-0001' });
const LINE = S('Expense line id (claims.get lists them)', { required: true });
const PAGE = { limit: N('Rows (default 50)'), offset: N('Rows to skip') };
const AGENT_FLAGS = ['possible_duplicate', 'suspected_generated', 'not_a_receipt', 'unclear', 'restricted_item', 'amount_mismatch'];

const FILTERS = {
  view: S('mine | team | all (default: all for HR and finance, team for managers, mine for others)', { enum: ['mine', 'team', 'all'] }),
  status: S('active (default: not draft or cancelled) | open (draft and submitted) | draft | submitted | approved | rejected | paid | cancelled | any', { enum: ['active', 'open', 'draft', 'submitted', 'approved', 'rejected', 'paid', 'cancelled', 'any'] }),
  entity: S('Entity'),
  employee: S('Employee number, id or work email'),
  department: S('Department (name or id), by the job in effect today'),
  travel: S('Trip number (TRV-0001) or id'),
  flagged: B('Only claims with flagged expenses'),
  pay_via: S('payroll | bank', { enum: ['payroll', 'bank'] }),
  from: S('Submitted (or started) on or after this day'),
  to: S('Submitted (or started) on or before this day'),
  q: S('Number, title, employee name or number contains'),
  sort: S('recent (default) | oldest | amount', { enum: ['recent', 'oldest', 'amount'] }),
};

const LINE_FIELDS = {
  day: S('Day of the spending, YYYY-MM-DD (default today)'),
  category: S('Category code or name, e.g. meals (expense-categories.list)'),
  amount: S('Amount paid, major units in --currency, e.g. 42.50'),
  currency: S('Currency of the receipt, e.g. JPY (default the claim currency)'),
  tax: S('Tax included in the amount, major units'),
  fx_rate: N('Claim currency per one unit of --currency, when you know the rate used (default: the rate of the day)'),
  merchant: S('Where it was spent'),
  description: S('What it was for'),
  attendees: S('Who attended (client entertainment, team meals)'),
  distance: N('Mileage: distance driven, in the category unit (km or mile)'),
  reason: S('Why a flagged expense is fine (shown to the approver)'),
};

module.exports = [
  { name: 'claims.list', method: 'GET', fn: 'lib_expenses_claims.claimsList', perm: 'signed', effect: 'read', desc: 'Expense claims the caller may see, newest first, with totals per currency (total, awaiting reimbursement). HR and finance see their entities, managers their team, everyone their own.', params: Object.assign({}, FILTERS, PAGE) },
  { name: 'claims.get', method: 'GET', fn: 'lib_expenses_claims.claimsGet', perm: 'signed', effect: 'read', desc: 'One claim: its lines with receipts, flags and your AI agent\'s readings, approval rounds and history, advance settlements, the trip, and what the caller can do (can).', params: { claim: CLAIM } },
  { name: 'claims.create', method: 'POST', fn: 'lib_expenses_claims.claimsCreate', perm: 'self', effect: 'write', desc: 'Start a draft claim for yourself, or (HR, your AI agent) for --employment. Lines can also be added straight away with claim-lines.add, which starts a draft when there is none.', params: { employment: S('Employment or employee number (default: your own)'), title: S('A short title, e.g. Tokyo client visit'), travel: S('Trip it belongs to (TRV-0001)'), advance: S('Advance it settles (ADV-0001)'), pay_via: S('payroll | bank (HR only; default the entity policy)', { enum: ['payroll', 'bank'] }), note: S('Note for the approver') } },
  { name: 'claims.update', method: 'POST', fn: 'lib_expenses_claims.claimsUpdate', perm: 'self', effect: 'write', desc: 'Change a draft claim: title, note, trip, advance, and (HR) how it is paid.', params: { claim: CLAIM, title: S('Title'), note: S('Note'), travel: S('Trip (empty to unlink)'), advance: S('Advance (empty to unlink)'), pay_via: S('payroll | bank (HR only)', { enum: ['payroll', 'bank'] }) } },
  { name: 'claims.submit', method: 'POST', fn: 'lib_expenses_claims.claimsSubmit', perm: 'self', agent: 'deny', effect: 'write', desc: 'Submit a draft claim for approval (manager; finance too from the entity amount). Refused while a line lacks amount, category or rate; flags never block.', params: { claim: CLAIM } },
  { name: 'claims.withdraw', method: 'POST', fn: 'lib_expenses_claims.claimsWithdraw', perm: 'self', agent: 'deny', effect: 'write', desc: 'Take back a submitted claim before it is decided; it returns to draft.', params: { claim: CLAIM, note: S('Why') } },
  { name: 'claims.reopen', method: 'POST', fn: 'lib_expenses_claims.claimsReopen', perm: 'self', effect: 'write', desc: 'Reopen a rejected claim as a draft to fix it and submit again (the rejected lines come back with their reasons).', params: { claim: CLAIM } },
  { name: 'claims.cancel', method: 'POST', fn: 'lib_expenses_claims.claimsCancel', perm: 'self', agent: 'deny', effect: 'write', desc: 'Cancel a draft or rejected claim (it stays in the history).', params: { claim: CLAIM } },
  { name: 'claims.delete', method: 'POST', fn: 'lib_expenses_claims.claimsDelete', perm: 'self', effect: 'write', destructive: true, desc: 'Delete a draft claim and its lines.', params: { claim: CLAIM } },
  { name: 'claims.reject-lines', method: 'POST', fn: 'lib_expenses_claims.claimsRejectLines', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Approvers: leave out some expenses of a waiting claim with a reason (or put them back with --undo true), then approve the rest in the Inbox.', params: { claim: CLAIM, lines: S('JSON list of line ids', { required: true }), reason: S('Why they are left out (required unless undo)'), undo: B('Put the lines back') } },
  { name: 'claims.mark-paid', method: 'POST', fn: 'lib_expenses_claims.claimsMarkPaid', perm: 'expenses:full', agent: 'deny', effect: 'write', desc: 'Finance: mark approved claims paid by bank transfer, with the payment reference. Claims paid with a pay run are marked by payroll at lock.', params: { claim: S('One claim'), claims: S('JSON list of claim numbers or ids'), reference: S('Payment reference (transfer or batch id)', { required: true }), day: S('Day paid (default today)') } },
  { name: 'claims.set-payment', method: 'POST', fn: 'lib_expenses_claims.claimsSetPayment', perm: 'expenses:full', agent: 'deny', effect: 'write', desc: 'Finance: pay a claim with the next pay run (payroll) or by a separate reimbursement transfer (bank).', params: { claim: CLAIM, pay_via: S('payroll | bank', { required: true, enum: ['payroll', 'bank'] }) } },
  { name: 'claims.export', method: 'GET', fn: 'lib_expenses_claims.claimsExport', perm: 'expenses:view', agent: 'deny', effect: 'read', desc: 'A CSV of claims (one row per claim) or of their lines (with category, GL account, currency, rate and tax) for accounting, with the claims.list filters.', params: Object.assign({ level: S('claims (default) | lines', { enum: ['claims', 'lines'] }) }, FILTERS) },

  { name: 'claim-lines.add', method: 'POST', fn: 'lib_expenses_claims.linesAdd', perm: 'self', effect: 'write', files: ['receipt'], desc: 'Add an expense: amount, category and day, or just a receipt photo (your AI agent reads it). Goes on --claim or your open draft. Mileage: --distance. HR and your AI agent add for --employment.', params: Object.assign({ claim: S('Claim (default: the open draft)'), employment: S('Employment or employee number (default: your own)'), path: S('Your AI agent: a receipt file on this machine'), read: B('Ask your AI agent to read the receipt (default: when no amount is given)') }, LINE_FIELDS) },
  { name: 'claim-lines.update', method: 'POST', fn: 'lib_expenses_claims.linesUpdate', perm: 'self', effect: 'write', files: ['receipt'], desc: 'Change an expense on a draft claim: any field, a new receipt (upload, or --path for your AI agent) or --clear_receipt true.', params: Object.assign({ line: LINE, path: S('Your AI agent: a receipt file on this machine'), clear_receipt: B('Remove the receipt'), read: B('Ask your AI agent to read the new receipt') }, LINE_FIELDS) },
  { name: 'claim-lines.delete', method: 'POST', fn: 'lib_expenses_claims.linesDelete', perm: 'self', effect: 'write', destructive: true, desc: 'Remove an expense from a draft claim.', params: { line: LINE } },
  { name: 'claim-lines.receipt', method: 'GET', fn: 'lib_expenses_claims.linesReceipt', perm: 'signed', effect: 'read', desc: "Open an expense's receipt. Your AI agent gets the file's path on this machine (read it from disk), the line, the claim currency and the entity's categories.", params: { line: LINE, download: B('Download instead of view') } },
  { name: 'claim-lines.read-again', method: 'POST', fn: 'lib_expenses_claims.linesReadAgain', perm: 'self', agent: 'deny', effect: 'write', desc: 'Ask your AI agent to read the receipt of an expense (again).', params: { line: LINE } },
  {
    name: 'claim-lines.read-result',
    method: 'POST',
    fn: 'lib_expenses_claims.linesReadResult',
    perm: 'signed',
    effect: 'write',
    desc: 'Your AI agent: what you read on a receipt. It becomes a suggestion the person checks (filled in when expenses are set to automatic, never over typed values). The last receipt of the claim read closes its receipt_review ask.',
    params: {
      line: LINE,
      amount: S('The TOTAL paid, after tax, tip and discounts, major units, e.g. 1234.50'),
      currency: S('Currency printed on the receipt, e.g. JPY'),
      day: S('Day of the purchase, YYYY-MM-DD'),
      merchant: S('Merchant, short, e.g. Ichiran Shibuya'),
      tax: S('Tax included in the total, major units'),
      category: S('Best fitting category code of the entity (leave empty when none fits)'),
      description: S('What was bought, a few words'),
      confidence: S('high | medium | low', { enum: ['high', 'medium', 'low'] }),
      flags: S('JSON list of flags: ' + AGENT_FLAGS.join(', ')),
      note: S('One line for the person, e.g. why a flag'),
    },
  },
  { name: 'claim-lines.read-failed', method: 'POST', fn: 'lib_expenses_claims.linesReadFailed', perm: 'signed', effect: 'write', desc: 'Your AI agent: the receipt could not be read with confidence; say why so the person types it in. The last receipt of the claim read closes its receipt_review ask.', params: { line: LINE, code: S('not_a_receipt | unreadable | no_total | other', { enum: ['not_a_receipt', 'unreadable', 'no_total', 'other'] }), reason: S('A short reason the person can act on', { required: true }) } },
  { name: 'claim-lines.accept-reading', method: 'POST', fn: 'lib_expenses_claims.linesAcceptReading', perm: 'self', agent: 'deny', effect: 'write', desc: "Use your AI agent's reading of the receipt on the expense (all fields, or --fields).", params: { line: LINE, fields: S('JSON list of fields to use: merchant, day, amount, currency, tax, category, description') } },
  { name: 'claim-lines.dismiss-reading', method: 'POST', fn: 'lib_expenses_claims.linesDismissReading', perm: 'self', agent: 'deny', effect: 'write', desc: "Dismiss your AI agent's suggestion for an expense (its flags stay for the approver).", params: { line: LINE } },
  { name: 'claim-lines.flag', method: 'POST', fn: 'lib_expenses_claims.linesFlag', perm: 'signed', effect: 'write', desc: 'Flag an expense for the approver with --code (your AI agent or HR). Flags are shown, never blocking; they change no amount.', params: { line: LINE, code: S('The flag', { required: true, enum: AGENT_FLAGS }), note: S('Why, in a line (for a duplicate: which expense)') } },
  { name: 'claim-lines.clear-flag', method: 'POST', fn: 'lib_expenses_claims.linesClearFlag', perm: 'signed', agent: 'deny', effect: 'write', desc: 'An approver or HR clears a flag of your AI agent that does not hold (it stays in the history).', params: { line: LINE, code: S('The flag', { required: true, enum: AGENT_FLAGS }), note: S('Why it does not hold') } },
  { name: 'claim-lines.waiting', method: 'GET', fn: 'lib_expenses_claims.linesWaiting', perm: 'signed', effect: 'read', desc: 'Receipts waiting for your AI agent to read (draft claims), oldest first; --claim for one claim (the claim_id of receipt_review).', params: { claim: S('Claim (id or EXP-0001)'), limit: N('Rows (default 50)') } },
];
