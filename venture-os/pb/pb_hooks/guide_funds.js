/**
 * app.guide section and recipes of the funds module: funds and LPs,
 * capital calls and distributions, marks, reserves and the quarter close.
 * Plain data: the full recipes of its triggers.
 */
module.exports = {
  title: 'Funds, LPs, capital and the quarter close',
  section: [
    'Funds are entities (entities.list): funds.get is a fund\'s dashboard (metrics, the J-curve, called and unfunded, the latest quarter). Every figure comes from the engines: metrics.fund, metrics.lp, metrics.holding and metrics.sources (the inputs behind each figure); metrics.bridge --fund --from "Q2 2026" --to "Q3 2026" says why they moved (the flows, and the change of each holding with its reason). Always give net (TVPI, DPI, net IRR) beside gross (MOIC, gross IRR) at equal prominence; a null figure has a reason (no_paid_in, no_nav...), never call it zero.',
    'LP data (lps.*, commitments, capital accounts, payments, the ledger) is visible to you only while the owner keeps fund data on; otherwise you get 403 fund_data_off. LP record changes (lps.upsert) are proposals; commitments, tax ids and wire details are people only, and you never see wire details.',
    'Capital call, three steps: calls.draft (a proposal for you: amount and purpose, or --fees true for management fees computed by the engine; purpose recall calls recallable distributions back, pro rata of each LP\'s recallable balance; purpose subline repays the subscription line) then calls.preview (every LP\'s line by ILPA type, summing exactly) then calls.issue with a person\'s PIN. Distributions mirror it (distributions.draft, distributions.preview with the waterfall estimate). You never issue or void a notice; a void drafts a void notice to each LP who got the notice, for a person to approve. waterfall.preview answers what a gross distribution would pay the GP and LPs.',
    'Payments: payments.list shows each LP\'s line (paid, partial, due, overdue); payments.record is a proposal for you (a receipt matched to a line). The ledger (ledger.list) is append-only; opening balances (ledger.opening) are people only.',
    'Statements: statements.import or the import targets statement_lines and bank_lines (proposals for you) list differences against the books; statements.explain writes an explanation for one difference; people resolve them.',
    'Marks: marks.list; marks.draft suggests a mark with method, value, a calibration rationale and inputs each with a source; people approve with the PIN. Reserves: reserves.get, reserves.preview; reserves.plan-save and scenarios.save are proposals and every assumption needs a source (else unsourced_assumption); scenarios.compare.',
    'Quarter close: quarters.open (people) opens it and a person asks you for the quarter\'s marks (trigger mark_notes, one for the quarter); quarters.freeze (PIN) fixes the numbers and a person asks you for the letter (trigger lp_letter: reports.letter-draft, your paragraphs stay proposed); people finalise (PIN) and send the packs. LP questions (lpq.log) ask you to draft an answer as an outbound reply a person sends (trigger lp_answer).',
  ],
  events: ['call.issued { event }', 'quarter.frozen { quarter }'],
  mark_notes: [
    'Draft the calibrated marks of a quarter, one per live holding (trigger mark_notes { quarter_id }, one ask for the whole quarter).',
    '1) marks.list --quarter <quarter_id> shows each holding, the value in force and which already have a draft. For each live holding without one: metrics.holding --fund <fund> --holding <holding> (cost, proceeds, the value in force and its marks); read the company\'s verified KPIs and rounds through the portfolio ops. Staged KPI values are not facts; use verified ones only.',
    '2) Calibrate as IPEV 2025 asks: the entry price and the metrics it implied, the movement in verified KPIs since, later rounds (price, lead, terms), and public comparables with their links. Pick the method: calibrated_round (the last round still fits), round_adjusted (the round adjusted for what moved), multiples (comparables applied to verified metrics), write_down, write_off.',
    '3) marks.draft --quarter <quarter_id> --holding <holding> --method <method> --value <major units> --rationale "<entry, KPI movement, later rounds, comparables, why this method>" --inputs \'[{"label":"...","value":"...","source":"<file, link, or whose judgment>"}]\'. Every input needs a source. The first draft marks the ask done. Never approve a mark: a person approves it with the PIN.',
    '4) Holdings you cannot mark: say which and why with agent.cannot --trigger mark_notes --record <quarter_id> --reason "..." only when you could mark none.',
  ],
  notice_review: [
    'Review a previewed capital call or distribution before a person issues it (trigger notice_review { event_id }).',
    '1) calls.get --event <event_id>: purposes, every LP\'s line by ILPA type, balances after the notice. Find the previous notice of the same kind (calls.list --fund <fund> --kind <kind> --status all) and read it with calls.get.',
    '2) Check against ILPA 2025: an investment call names the company (or why it is withheld), the use of capital, the security and the closing; a fee call states the period, rate, basis, calculation, offsets and waivers and that it is inside commitments; a distribution states its source, the return of capital and gain split, carry (an estimate until the administrator confirms), the recallable part and, for a full exit, MOIC and gross IRR. Check the lines sum to the total, fees go only to fee-paying LPs, no LP goes beyond its commitment (balances warnings), and the due day keeps the notice period.',
    '3) Say what changed from the previous notice: amounts, purposes, LPs, the fee period.',
    '4) calls.note --event <event_id> --note "<one short line per finding; what to fix before issuing, or ready>" (marks the ask done). Never issue or void a notice and never touch wire details.',
  ],
  reconcile: [
    'Reconcile an imported administrator or bank statement with the books (trigger reconcile { statement_id }).',
    '1) statements.get --statement <statement_id>: its rows and every difference (ours, theirs, the difference, a suggested match).',
    '2) Bank statement: for each receipt find the LP line it pays (payments.list --fund <fund> --open true). When one line fits by amount, payer, reference and day, propose payments.record --line <line> --amount <major units> --day <day> --reference "<bank reference>" --source reconcile --statement <statement_id> --why "<how it matches>" --evidence "<the statement row>". A receipt you cannot place: statements.explain with what is missing.',
    '3) Administrator statement: explain each difference with statements.explain --statement <statement_id> --index <n> --explanation "<timing, a fee true-up, a notice not yet booked, rounding>" using ledger.list and calls.get. Never change the ledger yourself.',
    '4) Your first match or explanation marks the ask done.',
  ],
  lp_letter: [
    'Draft the quarterly LP letter from the frozen numbers (trigger lp_letter { quarter_id }).',
    '1) quarters.get --quarter <quarter_id> (frozen metrics, NAV, holdings and marks; its fund, label and period_end) and metrics.sources --fund <fund> --day <period_end>; kpis.fund --fund <fund> --quarter "<label>" gives every company\'s verified figures of the quarter in one read; metrics.bridge --fund <fund> --to <period_end> explains what moved.',
    '2) Write 4 to 7 short paragraphs: the quarter in brief; performance with net figures (TVPI, DPI, net IRR) beside gross (MOIC, gross IRR) in the same sentence at equal prominence; calls and distributions; portfolio highlights from verified facts only; marks that moved and why. No forecasts, projections or reserves, and no figure the app did not return.',
    '3) reports.letter-draft --quarter <quarter_id> --paragraphs \'[{"text":"...","cites":["quarters.get"]}]\' (marks the ask done). Your paragraphs stay proposed until a person keeps them; never finalise or send.',
  ],
  lp_answer: [
    'Draft an answer to an LP\'s question (trigger lp_answer { question_id }).',
    '1) lpq.list finds the question (its LP, fund, question and the recipients in to). Read what it needs: lps.get --lp <lp>, metrics.lp --fund <fund> --lp <lp>, calls.list, the last frozen quarter (quarters.list, quarters.get) and the fund\'s files (files.list --owner_collection entities --owner_id <fund>).',
    '2) Draft a short, factual answer; name where each figure comes from (the notice number, the quarter statement). Never promise, forecast, or share another LP\'s data; when it needs a partner\'s judgment, say so in the draft.',
    '3) outbound.draft --kind reply --module lps --to \'<to as a JSON list>\' --subject "Re: <topic>" --body "<answer>" --ref_collection lp_questions --ref_id <question_id> (marks the ask done). Never send: a person approves it.',
  ],
};
