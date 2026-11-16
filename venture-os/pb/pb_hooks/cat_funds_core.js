/**
 * Catalog: funds (dashboard and metrics), LPs, commitments, the firm's
 * sealed wire details, the LP fund raise and LP questions.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const FUND = S('Fund id, name or short name (default: the only fund)');
const LP_KINDS = ['individual', 'family_office', 'fund_of_funds', 'endowment', 'foundation', 'pension', 'sovereign', 'corporate', 'insurer', 'bank', 'gp', 'other'];

module.exports = [
  /* funds and metrics */
  { name: 'funds.list', method: 'GET', fn: 'lib_funds.list', perm: 'funds:view', effect: 'read', desc: 'Funds and SPVs you may see, each with TVPI, DPI, RVPI, net IRR beside gross MOIC and IRR (engine figures; null with a reason when unknown), commitment, called and unfunded.' },
  { name: 'funds.get', method: 'GET', fn: 'lib_funds.get', perm: 'funds:view', effect: 'read', desc: "One fund's dashboard: metrics (net beside gross), the J-curve by quarter (calls, distributions, NAV), commitment, called and unfunded, and the latest quarter close with its steps.", params: { fund: FUND, day: S('As of day YYYY-MM-DD (default today)') } },
  { name: 'funds.holdings', method: 'GET', fn: 'lib_funds.holdingsList', perm: 'funds:view', effect: 'read', desc: "The fund's holdings (from the portfolio) with their cost and value on the fund's books, for picking the holding of an investment call or a distribution.", params: { fund: FUND } },
  { name: 'metrics.fund', method: 'GET', fn: 'lib_funds.metricsFund', perm: 'funds:view', effect: 'read', desc: 'Fund metrics on a day from the engines: paid-in, distributed, NAV, DPI, RVPI, TVPI, net IRR, gross MOIC and IRR, each null with a reason when unknown.', params: { fund: FUND, day: S('As of day (default today)') } },
  { name: 'metrics.bridge', method: 'GET', fn: 'lib_funds.metricsBridge', perm: 'funds:view', effect: 'read', desc: "Why a fund's figures moved between two days: TVPI, DPI, NAV and paid-in on each day, the LP calls and distributions in between, and each holding's value change with its reason (new mark, new money, exit), largest first. Quote it; never compute a figure yourself.", params: { fund: FUND, from: S('From day YYYY-MM-DD or a quarter label "Q2 2026" (default: the last quarter end)'), to: S('To day or quarter label (default today)') } },
  { name: 'metrics.lp', method: 'GET', fn: 'lib_funds.metricsLp', perm: 'lps:view', effect: 'read', desc: "One LP's capital account (contributed, unfunded, distributed, recallable) and its net DPI, TVPI and IRR in a fund (NAV share is an estimate pro rata of commitments).", params: { fund: FUND, lp: S('LP id or name', { required: true }), day: S('As of day (default today)') } },
  { name: 'metrics.holding', method: 'GET', fn: 'lib_funds.metricsHolding', perm: 'funds:view', effect: 'read', desc: "One holding's cost, proceeds, value (its approved mark, or cost), gross MOIC and IRR, and its marks.", params: { fund: S('Fund (default: the fund of the holding)'), holding: S('Holding id, or its company (name or domain)', { required: true }), day: S('As of day (default today)') } },
  { name: 'metrics.sources', method: 'GET', fn: 'lib_funds.metricsSources', perm: 'funds:view', effect: 'read', desc: 'The inputs behind the fund figures: LP flows, company flows, NAV parts (each holding at its mark or cost, cash) and the rules. Cite these, never compute a figure yourself.', params: { fund: FUND, day: S('As of day (default today)') } },

  /* LPs and commitments */
  { name: 'lps.list', method: 'GET', fn: 'lib_funds_lps.list', perm: 'lps:view', effect: 'read', desc: "LPs; with --fund each LP's commitment, called, distributed, unfunded and NAV share there. LP data is visible to you only while fund data is on.", params: { fund: FUND, q: S('Name contains'), limit: N('Rows (default 100)'), offset: N('Rows to skip') } },
  { name: 'lps.get', method: 'GET', fn: 'lib_funds_lps.get', perm: 'lps:view', effect: 'read', desc: 'One LP: contacts, commitments, and per fund its capital account, NAV share, notices with paid amounts and a cumulative series by quarter.', params: { lp: S('LP id or name', { required: true }) } },
  {
    name: 'lps.upsert',
    method: 'POST',
    fn: 'lib_funds_lps.upsert',
    perm: 'lps:edit',
    agent: 'propose',
    kind: 'lp_records',
    preview: 'lib_funds_lps.previewUpsert',
    effect: 'write',
    desc: 'Add an LP (no --lp) or change one: name, kind, company or person record, contacts (who receives notices), country, notes. Tax ids are sealed and people only. Your call is a proposal.',
    params: {
      lp: S('LP id or name to change (empty to add)'),
      name: S('LP name'),
      kind: S('Kind of LP', { enum: LP_KINDS }),
      company: S('Company record (id, domain or name)'),
      person: S('Person record (id or email)'),
      contacts: S('JSON list [{"name","email","role","phone","primary":true,"notices":true}]'),
      country: S('Two-letter country code'),
      notes: S('Notes'),
      tax_id: S('Tax id (people only; sealed)', { secret: true }),
    },
  },
  { name: 'commitments.list', method: 'GET', fn: 'lib_funds_lps.commitmentsList', perm: 'lps:view', effect: 'read', desc: 'Commitments by fund and LP: amount, signed or soft, fee-paying, fee rate override, waiver, side-letter flags, closing day.', params: { fund: FUND, lp: S('LP id or name') } },
  {
    name: 'commitments.save',
    method: 'POST',
    fn: 'lib_funds_lps.commitmentsSave',
    perm: 'lps:edit',
    agent: 'deny',
    effect: 'write',
    desc: "Add or change one LP's commitment to a fund (people only).",
    params: {
      fund: S('Fund', { required: true }),
      lp: S('LP id or name', { required: true }),
      amount: S('Commitment in major units, e.g. 5000000.00'),
      status: S('signed (default) or soft', { enum: ['signed', 'soft'] }),
      fee_paying: B('Pays management fees (default true)'),
      fee_rate: S('Own fee rate in percent, e.g. 1.5 ("" uses the fund rate)'),
      waiver: S('Fee waiver in percent of the fee, e.g. 50'),
      side_letter: S('JSON list of flags: mfn, fee_discount, fee_waiver, co_invest, reporting, excuse, transfer, confidentiality, other'),
      closing_day: S('Closing day YYYY-MM-DD'),
      notes: S('Notes'),
    },
  },

  /* wire details */
  { name: 'bank.list', method: 'GET', fn: 'lib_funds_lps.bankList', perm: 'funds:view', agent: 'deny', effect: 'read', desc: "The firm's wire details per entity, masked (bank name and last four digits), active or waiting for a second approval (people only).", params: { entity: S('Entity (fund or SPV)') } },
  { name: 'bank.view', method: 'POST', fn: 'lib_funds_lps.bankView', perm: 'funds:full', agent: 'deny', effect: 'confirm', desc: 'Reveal the wire details of an entity for five minutes (PIN; audited; people only).', params: { entity: S('Entity (fund or SPV)'), block: S('Wire details id (instead of the entity)') } },
  {
    name: 'bank.change',
    method: 'POST',
    fn: 'lib_funds_lps.bankChange',
    perm: 'funds:full',
    agent: 'deny',
    effect: 'confirm',
    desc: 'New wire details for an entity (PIN; sealed); they wait until a second member approves them with their own PIN.',
    params: {
      entity: S('Entity (fund or SPV)', { required: true }),
      bank_name: S('Bank name', { required: true }),
      account_name: S('Account name'),
      account_number: S('Account number', { secret: true }),
      routing: S('Routing, ABA, sort code or BSB', { secret: true }),
      swift: S('SWIFT or BIC'),
      iban: S('IBAN', { secret: true }),
      bank_address: S('Bank address'),
      reference: S('Payment reference'),
      currency: S('Currency of the account'),
    },
  },
  { name: 'bank.approve', method: 'POST', fn: 'lib_funds_lps.bankApprove', perm: 'funds:full', agent: 'deny', effect: 'confirm', desc: 'Approve (or reject) wire details another member changed (PIN; a second member).', params: { block: S('Wire details id', { required: true }), decision: S('approve (default) or reject', { enum: ['approve', 'reject'] }) } },

  /* fund raise */
  { name: 'raise.board', method: 'GET', fn: 'lib_funds_lps.raiseBoard', perm: 'lps:view', effect: 'read', desc: "The fund raise board: LP prospects by stage with target and soft-circled amounts, and signed plus soft against the fund's target.", params: { fund: FUND } },
  { name: 'raise.add', method: 'POST', fn: 'lib_funds_lps.raiseAdd', perm: 'lps:edit', agent: 'deny', effect: 'write', desc: 'Add an LP prospect to a fund raise (the company found or added) with a target commitment (people only).', params: { fund: S('Fund', { required: true }), company: S('Prospect company: id, domain or name', { required: true }), target: S('Target commitment in major units'), stage: S('Stage key (default the first)') } },
  { name: 'raise.move', method: 'POST', fn: 'lib_funds_lps.raiseMove', perm: 'lps:edit', agent: 'deny', effect: 'write', desc: 'Move an LP prospect to another stage of the raise (people only).', params: { deal: S('Prospect deal id or number', { required: true }), stage: S('Stage key or label', { required: true }), note: S('Note') } },
  { name: 'raise.soft', method: 'POST', fn: 'lib_funds_lps.raiseSoft', perm: 'lps:edit', agent: 'deny', effect: 'write', desc: "Record a prospect's soft circle: a soft commitment (left out of calls until signed) for the LP of the prospect's company (people only).", params: { deal: S('Prospect deal id or number', { required: true }), amount: S('Soft-circled amount in major units', { required: true }), kind: S('Kind of LP when the LP is new', { enum: LP_KINDS }) } },

  /* LP questions */
  { name: 'lpq.log', method: 'POST', fn: 'lib_funds_lps.lpqLog', perm: 'lps:edit', effect: 'write', desc: "Log an LP's question; your AI agent is asked to draft an answer from the fund's documents with citations (trigger lp_answer) for a person to send.", params: { lp: S('LP id or name', { required: true }), question: S('The question', { required: true }), fund: FUND } },
  { name: 'lpq.list', method: 'GET', fn: 'lib_funds_lps.lpqList', perm: 'lps:view', effect: 'read', desc: 'LP questions with their drafted answers and your AI agent\'s ask (--lp: one LP).', params: { lp: S('LP id or name'), limit: N('Rows (default 30)') } },
];
