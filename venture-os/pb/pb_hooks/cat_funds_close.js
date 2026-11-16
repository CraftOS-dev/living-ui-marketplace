/**
 * Catalog: marks, reserves and scenarios, the quarter close and LP
 * reports, and the ILPA and XLSX exports.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const FUND = S('Fund id, name or short name (default: the only fund)');
const QUARTER = S('Quarter id, or its label: "Q3 2026" (one fund) or "Fund I Q3 2026"', { required: true });
const METHODS = ['calibrated_round', 'round_adjusted', 'multiples', 'write_down', 'write_off'];

module.exports = [
  /* marks */
  { name: 'marks.list', method: 'GET', fn: 'lib_funds_close.marksList', perm: 'funds:view', effect: 'read', desc: "Per holding the value in force (approved mark, or cost), its method, and the quarter's draft with its change.", params: { fund: FUND, quarter: S('Quarter id (default the open one)') } },
  {
    name: 'marks.draft',
    method: 'POST',
    fn: 'lib_funds_close.marksDraft',
    perm: 'funds:edit',
    effect: 'write',
    desc: 'Suggest a mark for a holding in the open quarter: method, value, calibration rationale and inputs each with a source. A person approves it with the PIN.',
    params: {
      holding: S('Holding id', { required: true }),
      fund: FUND,
      quarter: S('Quarter id (default the open one)'),
      method: S('Valuation method', { required: true, enum: METHODS }),
      value: S('Value in major units (write_off is 0)'),
      rationale: S('Calibration note: entry price and implied metrics, KPI movement, later rounds, comparables', { required: true }),
      inputs: S('JSON [{"label","value","source"}]: every figure behind the mark with its source'),
    },
  },
  { name: 'marks.approve', method: 'POST', fn: 'lib_funds_close.marksApprove', perm: 'funds:view', agent: 'deny', effect: 'confirm', desc: 'Approve one mark (optionally changing method, value, rationale) or every draft of a quarter (PIN; finance or a partner). Only marks of holdings you may see: the others stay drafts and are counted in hidden.', params: { mark: S('Mark id'), quarter: S('Quarter id (approve every draft)'), method: S('Method', { enum: METHODS }), value: S('Value in major units'), rationale: S('Rationale') } },

  /* reserves and scenarios */
  { name: 'reserves.get', method: 'GET', fn: 'lib_funds_close.reservesGet', perm: 'funds:view', effect: 'read', desc: 'Reserve plan of a fund: per holding needed (to hold target ownership), allocated, deployed and shortfall; fund totals against its callable capital.', params: { fund: FUND } },
  { name: 'reserves.preview', method: 'GET', fn: 'lib_funds_close.reservesPreview', perm: 'funds:view', effect: 'read', desc: 'The reserve plan with changed targets, rounds, allocations or assumptions; nothing is saved.', params: { fund: FUND, holdings: S('JSON [{"holding","target","rounds","allocated","assumptions":[{"round","raise","post_money","pool","source"}]}]') } },
  {
    name: 'reserves.plan-save',
    method: 'POST',
    fn: 'lib_funds_close.reservesPlanSave',
    perm: 'funds:edit',
    agent: 'propose',
    kind: 'reserves',
    preview: 'lib_funds_close.previewPlan',
    effect: 'write',
    desc: "One holding's reserve plan: target ownership, rounds to follow, allocation and next-round assumptions, each with a source (else unsourced_assumption). Your plan is a proposal.",
    params: { fund: FUND, holding: S('Holding id', { required: true }), target: S('Target ownership in percent, e.g. 8'), rounds: S('Rounds to follow (0 to 8)'), allocated: S('Reserve allocated, major units'), assumptions: S('JSON [{"round":1,"raise","post_money","pool","source"}]'), notes: S('Notes') },
  },
  { name: 'scenarios.save', method: 'POST', fn: 'lib_funds_close.scenariosSave', perm: 'funds:edit', agent: 'propose', kind: 'scenarios', effect: 'write', desc: 'Save a named reserve scenario (changed targets, rounds, allocations, sourced assumptions per holding) to compare. Your scenario is a proposal.', params: { fund: FUND, name: S('Scenario name', { required: true }), holdings: S('JSON [{"holding","target","rounds","allocated","assumptions"}]'), notes: S('Notes') } },
  { name: 'scenarios.compare', method: 'GET', fn: 'lib_funds_close.scenariosCompare', perm: 'funds:view', effect: 'read', desc: 'The current reserve plan beside each saved scenario: needed, allocated, available and shortfall.', params: { fund: FUND } },

  /* quarter close */
  { name: 'quarters.list', method: 'GET', fn: 'lib_funds_close.quartersList', perm: 'funds:view', effect: 'read', desc: 'Quarter closes of a fund with their steps (Open, Marks, Frozen, Letter, Sent).', params: { fund: FUND } },
  { name: 'quarters.get', method: 'GET', fn: 'lib_funds_close.quartersGet', perm: 'funds:view', effect: 'read', desc: 'One quarter: frozen metrics and NAV, holdings, marks waiting, the letter and each LP pack; LP statements with --parts lps (LP data). --parts picks what to answer.', params: { quarter: QUARTER, parts: S('Comma list of metrics, nav, holdings, marks, letter, packs, lps (default: all but lps for your AI agent)'), lp_offset: N('LP accounts to skip (--parts lps)'), lp_limit: N('LP accounts (default 20 for your AI agent)') } },
  { name: 'quarters.open', method: 'POST', fn: 'lib_funds_close.quartersOpen', perm: 'funds:edit', agent: 'deny', effect: 'write', desc: 'Open the close of a quarter (people only); Ask your AI agent then drafts the marks of the quarter (trigger mark_notes, one for the quarter).', params: { fund: FUND, period_end: S('Quarter end (default the last one)') } },
  { name: 'quarters.freeze', method: 'POST', fn: 'lib_funds_close.quartersFreeze', perm: 'funds:full', agent: 'deny', effect: 'confirm', desc: "Freeze a quarter (PIN): fund and LP figures fixed with a hash, NAV stored; Ask your AI agent then drafts the letter (trigger lp_letter).", params: { quarter: QUARTER } },
  { name: 'reports.letter-draft', method: 'POST', fn: 'lib_funds_close.letterDraft', perm: 'funds:edit', effect: 'write', desc: "Paragraphs of a frozen quarter's LP letter from the frozen numbers and verified facts, net beside gross, no forecasts or reserves (trigger lp_letter). Yours stay proposed until a person keeps them.", params: { quarter: QUARTER, paragraphs: S('JSON list of text, or [{"text","cites":["metrics.fund ..."]}]', { required: true }) } },
  { name: 'reports.letter-save', method: 'POST', fn: 'lib_funds_close.letterSave', perm: 'funds:view', agent: 'deny', effect: 'write', desc: 'Save the letter as edited (finance or a partner): the paragraphs in order.', params: { quarter: QUARTER, paragraphs: S('JSON [{"id","text"}]', { required: true }), keep_all: B('Keep every paragraph (default true)') } },
  { name: 'reports.statement-preview', method: 'GET', fn: 'lib_funds_close.statementPreview', perm: 'lps:view', effect: 'read', desc: "One LP's capital account statement of a frozen quarter, with the fund's net and gross figures.", params: { quarter: QUARTER, lp: S('LP id or name', { required: true }) } },
  { name: 'reports.pack', method: 'GET', fn: 'lib_funds_close.pack', perm: 'lps:view', agent: 'deny', effect: 'read', desc: "Open one LP's quarterly pack PDF (people only).", params: { report: S('Pack id (quarters.get)', { required: true }), download: B('As a download') } },
  { name: 'reports.finalize', method: 'POST', fn: 'lib_funds_close.finalize', perm: 'funds:view', agent: 'deny', effect: 'confirm', desc: "Finalise a frozen quarter (PIN; finance or a partner): the letter is final and each LP's pack is rendered.", params: { quarter: QUARTER } },
  { name: 'reports.send', method: 'POST', fn: 'lib_funds_close.send', perm: 'funds:edit', agent: 'deny', effect: 'write', desc: "Send each LP its pack by email: the letter, the statement and the quarter's notices (people only).", params: { quarter: QUARTER } },

  /* exports */
  { name: 'exports.ilpa', method: 'POST', fn: 'lib_funds_close.exportsIlpa', perm: 'funds:full', agent: 'deny', effect: 'confirm', track: false, desc: 'Download the ILPA Capital Call and Distribution template lines, or the Performance Template cash flows (granular), as CSV (PIN).', params: { fund: S('Fund', { required: true }), template: S('calls (default) or performance', { enum: ['calls', 'performance'] }), day: S('As of day for performance') } },
  { name: 'exports.xlsx', method: 'POST', fn: 'lib_funds_close.exportsXlsx', perm: 'funds:view', agent: 'deny', effect: 'write', track: false, desc: 'Download a fund table as Excel: lps, events, ledger or holdings (people only).', params: { fund: S('Fund', { required: true }), table: S('lps (default), events, ledger, holdings', { enum: ['lps', 'events', 'ledger', 'holdings'] }) } },
];
