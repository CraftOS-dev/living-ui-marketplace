/**
 * Catalog: capital calls and distributions (draft, preview, review note,
 * issue with the PIN, void), the waterfall estimate, payments, the ledger,
 * opening balances and statements.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const FUND = S('Fund id, name or short name (default: the only fund)');
const EVENT = S('Call or distribution id or number (CC-001, DI-001)', { required: true });

module.exports = [
  /* calls */
  { name: 'calls.list', method: 'GET', fn: 'lib_funds_capital.callsList', perm: 'funds:view', effect: 'read', desc: 'Capital calls and distributions of a fund, newest first, with status, total and the paid share.', params: { fund: FUND, kind: S('call or distribution', { enum: ['call', 'distribution'] }), status: S('draft, previewed, issued, settled, void, open or all', { enum: ['draft', 'previewed', 'issued', 'settled', 'void', 'open', 'all'] }), limit: N('Rows (default 50)'), offset: N('Rows to skip') } },
  { name: 'calls.get', method: 'GET', fn: 'lib_funds_capital.callsGet', perm: 'funds:view', effect: 'read', desc: "One call or distribution: purposes, the preview (every LP's line by ILPA type with balances after it), the review note, and once issued each LP's paid amount and delivery.", params: { event: EVENT } },
  {
    name: 'calls.draft',
    method: 'POST',
    fn: 'lib_funds_capital.callsDraft',
    perm: 'funds:edit',
    agent: 'propose',
    kind: 'capital',
    preview: 'lib_funds_capital.previewDraft',
    effect: 'write',
    desc: 'Step 1 of a capital call: an amount and its purpose (investment in a holding, expenses, other) and/or management fees (--fees true; computed by the engine for the period), notice and due days (default 10 business days). Your draft is a proposal.',
    params: {
      event: S('Draft call to change'),
      fund: FUND,
      purpose: S('investment, expenses, other, fees, recall (recallable capital) or subline (subscription facility repayment)', { enum: ['investment', 'expenses', 'other', 'fees', 'recall', 'subline'] }),
      amount: S('Amount in major units for the purpose, e.g. 1500000.00'),
      holding: S('Holding the investment or recall is for (portfolio holding id)'),
      label: S('A short description of the purpose'),
      fees: B('Add management fees for a period'),
      fee_from: S('Fee period start YYYY-MM-DD (default: after the last fee period)'),
      fee_to: S('Fee period end YYYY-MM-DD (default: that quarter end)'),
      expenses: S('Partnership expenses added to the call, major units'),
      purposes: S('JSON list instead: [{"type":"investment|fees|expenses|other|recall|subline","amount","holding","label","from_day","to_day"}]'),
      notice_day: S('Notice day (default today)'),
      due_day: S('Due day (default 10 business days after the notice)'),
      narrative: S('Text for the description letter'),
    },
  },
  { name: 'calls.preview', method: 'POST', fn: 'lib_funds_capital.callsPreview', perm: 'funds:edit', effect: 'write', desc: "Step 2: compute every LP's line by ILPA type from the engine (lines sum exactly; fees only to fee-paying LPs) and each LP's balances after the notice. A person may then ask for your review (trigger notice_review).", params: { event: EVENT } },
  { name: 'calls.note', method: 'POST', fn: 'lib_funds_capital.callsNote', perm: 'funds:edit', effect: 'write', desc: "The review note on a draft call or distribution: checks against ILPA's content list for its type and what changed from the previous notice (trigger notice_review).", params: { event: EVENT, note: S('The review note', { required: true }) } },
  { name: 'calls.issue', method: 'POST', fn: 'lib_funds_capital.callsIssue', perm: 'funds:full', agent: 'deny', effect: 'confirm', track: false, desc: 'Step 3: issue a previewed call (PIN): ledger rows, a PDF notice and ILPA CSV per LP with the wire block, each sent by email within a minute. Not undoable; void instead.', params: { event: EVENT } },
  { name: 'calls.notice', method: 'GET', fn: 'lib_funds_capital.callsNotice', perm: 'lps:view', agent: 'deny', effect: 'read', desc: "Open one LP's issued notice: the PDF with its wire block, or its ILPA CSV (people only).", params: { line: S('Line id', { required: true }), format: S('pdf (default) or csv', { enum: ['pdf', 'csv'] }), download: B('As a download') } },
  { name: 'calls.void', method: 'POST', fn: 'lib_funds_capital.callsVoid', perm: 'funds:full', agent: 'deny', effect: 'confirm', desc: 'Void a call or distribution (PIN): a draft is dropped; an issued one without payments is reversed in the ledger, unsent notices are cancelled and LPs who got one get a void notice to approve in Next.', params: { event: EVENT, reason: S('Why') } },

  /* distributions */
  {
    name: 'distributions.draft',
    method: 'POST',
    fn: 'lib_funds_capital.distributionsDraft',
    perm: 'funds:edit',
    agent: 'propose',
    kind: 'capital',
    preview: 'lib_funds_capital.previewDistDraft',
    effect: 'write',
    desc: 'Step 1 of a distribution: the gross amount, the source holding and its proceeds, the recallable part, notice and payment days. Your draft is a proposal.',
    params: {
      event: S('Draft distribution to change'),
      fund: FUND,
      amount: S('Gross amount to distribute (before carry), major units'),
      holding: S('Source holding'),
      proceeds: S("The fund's proceeds from the holding, major units (recorded on issue)"),
      recallable: S('Recallable part, major units'),
      notice_day: S('Notice day (default today)'),
      due_day: S('Payment day (default 10 business days after the notice)'),
      narrative: S('Text for the description letter'),
    },
  },
  { name: 'distributions.preview', method: 'POST', fn: 'lib_funds_capital.distributionsPreview', perm: 'funds:edit', effect: 'write', desc: "Step 2: the waterfall estimate (carry to the GP, the rest to LPs split into return of capital and gain) and every LP's line pro rata of contributed capital. A person may then ask for your review (trigger notice_review).", params: { event: EVENT } },
  { name: 'distributions.issue', method: 'POST', fn: 'lib_funds_capital.distributionsIssue', perm: 'funds:full', agent: 'deny', effect: 'confirm', track: false, desc: 'Step 3: issue a previewed distribution (PIN): ledger rows (with carry and proceeds), a PDF notice and ILPA CSV per LP, sent by email within a minute.', params: { event: EVENT } },
  { name: 'waterfall.preview', method: 'GET', fn: 'lib_funds_capital.waterfallPreview', perm: 'funds:view', effect: 'read', desc: "What a gross distribution would pay the GP and the LPs under the fund's waterfall (an estimate until the administrator confirms).", params: { fund: FUND, amount: S('Gross amount, major units', { required: true }), day: S('Day (default today)'), holding: S('Source holding (needed for an American waterfall)') } },

  /* payments */
  { name: 'payments.list', method: 'GET', fn: 'lib_funds_capital.paymentsList', perm: 'lps:view', effect: 'read', desc: "Each LP's line on issued notices: expected, paid, left and state (paid, partial, due, overdue) with the payments recorded.", params: { event: S('Call or distribution'), fund: FUND, open: B('Only lines not fully paid') } },
  {
    name: 'payments.record',
    method: 'POST',
    fn: 'lib_funds_capital.paymentsRecord',
    perm: 'funds:edit',
    agent: 'propose',
    kind: 'payments',
    preview: 'lib_funds_capital.previewPayment',
    effect: 'write',
    desc: "Record money received from an LP on a call line (or paid out on a distribution line); default the amount still due. The event settles when every line is paid. Your match is a proposal.",
    params: { line: S('Line id'), event: S('Event (with --lp, instead of --line)'), lp: S('LP (with --event)'), amount: S('Amount, major units (default what is left)'), day: S('Day received (default today)'), reference: S('Bank reference'), source: S('manual, statement or reconcile', { enum: ['manual', 'statement', 'reconcile'] }), statement: S('Statement id it came from') },
  },
  { name: 'payments.remind', method: 'POST', fn: 'lib_funds_capital.paymentsRemind', perm: 'funds:edit', agent: 'deny', effect: 'write', desc: 'Send an LP whose payment is late a reminder with the notice attached (people only; sent within a minute).', params: { line: S('Line id'), event: S('Event (with --lp)'), lp: S('LP (with --event)') } },

  /* ledger */
  { name: 'ledger.list', method: 'GET', fn: 'lib_funds_capital.ledgerList', perm: 'lps:view', effect: 'read', desc: 'The append-only ledger of a fund: LP flows by ILPA type, fund-to-company flows, carry, opening balances and voids, newest first.', params: { fund: FUND, lp: S('LP'), holding: S('Holding id'), type: S('Ledger type'), from: S('From day'), to: S('To day'), limit: N('Rows (default 100)'), offset: N('Rows to skip') } },
  { name: 'ledger.opening', method: 'POST', fn: 'lib_funds_capital.ledgerOpening', perm: 'funds:full', agent: 'deny', effect: 'confirm', desc: 'Opening balances of a fund moving in (PIN; before anything else on its ledger): LP capital accounts, holdings at cost and cash.', params: { fund: S('Fund', { required: true }), day: S('As of day', { required: true }), lps: S('JSON [{"lp","contributed","distributed","recallable","recalled"}] in major units'), holdings: S('JSON [{"holding","cost","day"}]'), cash: S('Cash, major units') } },
  { name: 'ledger.record', method: 'POST', fn: 'lib_funds_capital.ledgerRecord', perm: 'funds:full', agent: 'deny', effect: 'write', desc: 'Record a fund-to-company flow outside a call or distribution: an investment paid from cash or proceeds received (people only).', params: { fund: S('Fund', { required: true }), type: S('investment or proceeds', { required: true, enum: ['investment', 'proceeds'] }), holding: S('Holding id', { required: true }), amount: S('Amount, major units', { required: true }), day: S('Day (default today)'), note: S('Note') } },

  /* statements */
  { name: 'statements.list', method: 'GET', fn: 'lib_funds_capital.statementsList', perm: 'funds:view', effect: 'read', desc: 'Imported administrator and bank statements of a fund with their open differences.', params: { fund: FUND } },
  { name: 'statements.get', method: 'GET', fn: 'lib_funds_capital.statementsGet', perm: 'lps:view', effect: 'read', desc: 'One statement: its rows and every difference against the books (ours, theirs, the difference, a suggested payment match, explanation, state).', params: { statement: S('Statement id', { required: true }) } },
  {
    name: 'statements.import',
    method: 'POST',
    fn: 'lib_funds_capital.statementsImport',
    perm: 'funds:edit',
    agent: 'propose',
    kind: 'statements',
    preview: 'lib_funds_capital.previewImport',
    effect: 'write',
    desc: "Import an administrator's capital account statement (columns lp, contributed, distributed, recallable, nav) or a bank statement (day, amount, reference, payer); differences are listed; Ask your AI agent reconciles them (trigger reconcile). Your import is a proposal.",
    params: { fund: S('Fund', { required: true }), source: S('administrator (default) or bank', { enum: ['administrator', 'bank'] }), period_end: S('Statement as of day (administrator)'), rows: S('JSON list of row objects keyed by column name'), csv: S('CSV text instead of rows'), name: S('Name'), file: S('The statement file id, when uploaded') },
  },
  { name: 'statements.explain', method: 'POST', fn: 'lib_funds_capital.statementsExplain', perm: 'funds:edit', effect: 'write', desc: 'Explain one difference of a statement (timing, a fee true-up, a missing receipt...).', params: { statement: S('Statement id', { required: true }), index: N('Difference index', { required: true }), explanation: S('The explanation', { required: true }) } },
  { name: 'statements.resolve', method: 'POST', fn: 'lib_funds_capital.statementsResolve', perm: 'funds:edit', agent: 'deny', effect: 'write', desc: 'Accept differences of a statement as explained or fixed (people only).', params: { statement: S('Statement id', { required: true }), index: N('Difference index'), all: B('Every open difference') } },
];
