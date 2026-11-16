/**
 * Funds module registrations (SPEC 4.2). Plain data.
 *
 * Events the funds module emits:
 *   call.issued     { event }      a capital call was issued (PIN)
 *   quarter.frozen  { quarter }    a quarter's numbers were frozen (PIN)
 */
module.exports = {
  on: {
    'outbound.sent': 'lib_funds.onOutbound',
    'outbound.failed': 'lib_funds.onOutbound',
    'record.merged': 'lib_funds_lps.onMerged',
  },
  needsYou: 'lib_funds.needsYou',
  triggers: {
    mark_notes: {
      record: 'quarters',
      param: 'quarter_id',
      perm: 'funds:edit',
      label: 'Draft the quarter\'s marks',
      description: 'Your AI agent drafts a calibrated mark for every holding of a quarter, each input with its source; a person approves them with the PIN',
      fires: 'Ask your AI agent for marks on an open quarter',
      cooldown: 10,
      check: 'lib_funds_close.marksCheck',
      lands: { 'marks.draft': 'quarter' },
      instruction:
        "Draft the calibrated marks of quarter quarter_id, one per live holding. 1) marks.list --quarter <quarter_id> shows each holding and which have a draft. For each without one: metrics.holding --fund <fund> --holding <holding>, and the company's verified KPIs and rounds (staged values are not facts). 2) Calibrate as IPEV 2025 asks: entry price and implied metrics, KPI movement since, later rounds, public comparables with links; pick calibrated_round, round_adjusted, multiples, write_down or write_off. 3) marks.draft --quarter <quarter_id> --holding <holding> --method --value --rationale \"...\" --inputs '[{\"label\",\"value\",\"source\"}]' (the first marks it done). Never approve a mark.",
    },
    notice_review: {
      record: 'capital_events',
      param: 'event_id',
      perm: 'funds:edit',
      label: 'Review a notice',
      description: 'Your AI agent reviews a previewed capital call or distribution against the ILPA content list and the previous notice, before a person issues it',
      fires: 'Ask your AI agent on a previewed call or distribution',
      cooldown: 10,
      check: 'lib_funds_capital.reviewCheck',
      lands: { 'calls.note': 'event' },
      instruction:
        "Review the previewed capital call or distribution event_id before a person issues it. 1) calls.get --event <event_id>: purposes, every LP's line by ILPA type, balances after it. Read the previous notice of the same kind (calls.list --fund <fund> --kind <kind> --status all, then calls.get). 2) Check against ILPA 2025 for its type (an investment call names the company, use and closing; a fee call its period, rate, basis, offsets; a distribution its source, return of capital and gain, carry estimate, recallable part), that lines sum to the total, fees only to fee-paying LPs, no LP beyond its commitment, and the notice period. 3) calls.note --event <event_id> --note \"<one line per finding, or ready>\" (marks it done). Never issue or void.",
    },
    reconcile: {
      record: 'statements',
      param: 'statement_id',
      perm: 'funds:edit',
      label: 'Reconcile a statement',
      description: 'Your AI agent matches the receipts of a bank statement to LP lines (proposals) and explains the differences of an administrator statement',
      fires: 'Ask your AI agent on a statement with open differences',
      cooldown: 10,
      check: 'lib_funds_capital.reconcileCheck',
      lands: { 'statements.explain': 'statement', 'payments.record': 'statement' },
      instruction:
        "Reconcile statement statement_id with the books. 1) statements.get --statement <statement_id>: its rows and every difference (ours, theirs, a suggested match). 2) A bank statement: for each receipt find the LP line it pays (payments.list --fund <fund> --open true) and, when one fits by amount, payer, reference and day, propose payments.record --line <line> --amount --day --reference --source reconcile --statement <statement_id> --why --evidence \"<the row>\". 3) An administrator statement, or a receipt you cannot place: statements.explain --statement <statement_id> --index <n> --explanation \"<timing, a fee true-up, a notice not yet booked, rounding>\". Your first match or explanation marks it done. Never change the ledger.",
    },
    lp_letter: {
      record: 'quarters',
      param: 'quarter_id',
      perm: 'funds:edit',
      label: 'Draft the LP letter',
      description: 'Your AI agent drafts the quarterly LP letter from the frozen numbers and verified facts, net beside gross; a person keeps or edits each paragraph',
      fires: 'Ask your AI agent for the letter of a frozen quarter',
      cooldown: 10,
      check: 'lib_funds_close.letterCheck',
      instruction:
        "Draft the LP letter of the frozen quarter quarter_id. 1) quarters.get --quarter <quarter_id> (frozen metrics, NAV, holdings, marks), metrics.sources --fund <fund> --day <period_end>, kpis.fund --fund <fund> --quarter \"<label>\" (every company's verified figures), metrics.bridge --fund <fund> --to <period_end> (what moved). 2) Write 4 to 7 short paragraphs: the quarter in brief; net figures (TVPI, DPI, net IRR) beside gross (MOIC, gross IRR) in the same sentence; calls and distributions; portfolio highlights from verified facts; marks that moved and why. No forecasts or reserves, no figure the app did not return. 3) reports.letter-draft --quarter <quarter_id> --paragraphs '[{\"text\",\"cites\"}]' (marks it done; they stay proposed).",
    },
    lp_answer: {
      record: 'lp_questions',
      param: 'question_id',
      perm: 'lps:edit',
      label: 'Answer an LP question',
      description: 'Your AI agent drafts a factual answer to a question an LP asked, from the fund\'s records, for a person to send',
      fires: 'Logging an LP\'s question, or Ask your AI agent on it',
      cooldown: 10,
      check: 'lib_funds_lps.lpqCheck',
      lands: { 'outbound.draft': 'ref_id' },
      instruction:
        "Draft an answer to the LP question question_id; never send it. 1) lpq.list --lp <its LP> finds it (the question, the LP, the fund and the recipients in to). Read what it needs: lps.get, metrics.lp --fund <fund> --lp <lp>, calls.list, the last frozen quarter (quarters.list, quarters.get) and the fund's files (files.list --owner_collection entities --owner_id <fund>). 2) A short factual answer naming where each figure comes from; never promise, forecast or share another LP's data; when it needs a partner's judgment, say so. 3) outbound.draft --kind reply --module lps --to '<to as a JSON list>' --subject \"Re: <topic>\" --body \"...\" --ref_collection lp_questions --ref_id <question_id> (marks it done; a person approves and sends it).",
    },
  },
  search: 'lib_funds.search',
  settingsKeys: { funds: { notice_business_days: 10 } },
  imports: {
    lp_commitments: {
      label: 'LPs and commitments',
      perm: 'lps:edit',
      fields: [
        { key: 'name', label: 'LP', required: true, type: 'text', synonyms: ['LP', 'Limited partner', 'Investor', 'Investor name', 'LP name', 'Name'] },
        { key: 'kind', label: 'Kind', type: 'text', synonyms: ['Type', 'Investor type', 'LP type'] },
        { key: 'contact', label: 'Contact', type: 'text', synonyms: ['Contact name', 'Primary contact'] },
        { key: 'email', label: 'Email', type: 'email', synonyms: ['Contact email', 'Notice email', 'E-mail'] },
        { key: 'country', label: 'Country', type: 'text', synonyms: ['Country code', 'Domicile'] },
        { key: 'fund', label: 'Fund', type: 'text', synonyms: ['Fund name', 'Vehicle'] },
        { key: 'amount', label: 'Commitment', type: 'money', synonyms: ['Commitment', 'Committed', 'Commitment amount', 'Capital commitment'] },
        { key: 'fee_paying', label: 'Fee-paying', type: 'bool', synonyms: ['Fee paying', 'Pays fees'] },
        { key: 'closing_day', label: 'Closing', type: 'day', synonyms: ['Closing date', 'Close date', 'Admission date'] },
      ],
      row: 'lib_funds_lps.importRow',
    },
    statement_lines: {
      label: 'Administrator statement',
      perm: 'funds:edit',
      fields: [
        { key: 'fund', label: 'Fund', required: true, type: 'text', synonyms: ['Fund name', 'Vehicle', 'Partnership'] },
        { key: 'period_end', label: 'As of', required: true, type: 'day', synonyms: ['Period end', 'Statement date', 'Date', 'As of date'] },
        { key: 'lp', label: 'LP', required: true, type: 'text', synonyms: ['Limited partner', 'Investor', 'Investor name', 'Partner', 'LP name'] },
        { key: 'contributed', label: 'Contributed', type: 'money', synonyms: ['Paid-in', 'Paid in capital', 'Contributions', 'Contributed capital', 'Called'] },
        { key: 'distributed', label: 'Distributed', type: 'money', synonyms: ['Distributions', 'Total distributions'] },
        { key: 'recallable', label: 'Recallable', type: 'money', synonyms: ['Recallable capital', 'Recallable distributions'] },
        { key: 'nav', label: 'NAV', type: 'money', synonyms: ['Ending capital', 'Capital balance', 'Ending balance', 'Closing capital', 'Net asset value'] },
      ],
      row: 'lib_funds_capital.importStatementRow',
    },
    bank_lines: {
      label: 'Bank statement',
      perm: 'funds:edit',
      fields: [
        { key: 'fund', label: 'Fund', required: true, type: 'text', synonyms: ['Fund name', 'Account', 'Vehicle'] },
        { key: 'day', label: 'Day', type: 'day', synonyms: ['Date', 'Value date', 'Booking date', 'Transaction date'] },
        { key: 'amount', label: 'Amount', required: true, type: 'money', synonyms: ['Credit', 'Received', 'Credit amount'] },
        { key: 'reference', label: 'Reference', type: 'text', synonyms: ['Ref', 'Description', 'Memo', 'Details'] },
        { key: 'payer', label: 'Payer', type: 'text', synonyms: ['From', 'Counterparty', 'Remitter', 'Ordering party'] },
      ],
      row: 'lib_funds_capital.importBankRow',
    },
    opening_balances: {
      label: 'Opening balances (LPs)',
      perm: 'funds:full',
      pin: true,
      fields: [
        { key: 'fund', label: 'Fund', required: true, type: 'text', synonyms: ['Fund name', 'Vehicle'] },
        { key: 'day', label: 'As of', required: true, type: 'day', synonyms: ['Opening day', 'Date', 'As of date'] },
        { key: 'lp', label: 'LP', required: true, type: 'text', synonyms: ['Limited partner', 'Investor', 'Investor name', 'LP name'] },
        { key: 'contributed', label: 'Contributed', type: 'money', synonyms: ['Paid-in', 'Paid in capital', 'Contributions', 'Called'] },
        { key: 'distributed', label: 'Distributed', type: 'money', synonyms: ['Distributions'] },
        { key: 'recallable', label: 'Recallable', type: 'money', synonyms: ['Recallable capital'] },
        { key: 'recalled', label: 'Recalled', type: 'money', synonyms: ['Recalled capital'] },
      ],
      row: 'lib_funds_capital.importOpeningRow',
    },
    opening_holdings: {
      label: 'Opening balances (holdings)',
      perm: 'funds:full',
      pin: true,
      fields: [
        { key: 'fund', label: 'Fund', required: true, type: 'text', synonyms: ['Fund name', 'Vehicle'] },
        { key: 'holding', label: 'Company', required: true, type: 'text', synonyms: ['Holding', 'Company name', 'Portfolio company', 'Investment'] },
        { key: 'cost', label: 'Cost', required: true, type: 'money', synonyms: ['Invested', 'Cost basis', 'Amount invested'] },
        { key: 'day', label: 'Day', required: true, type: 'day', synonyms: ['Date', 'Investment date', 'Closing date'] },
      ],
      row: 'lib_funds_capital.importOpeningHoldingRow',
    },
  },
};
