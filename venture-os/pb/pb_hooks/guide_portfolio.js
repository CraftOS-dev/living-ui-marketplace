/**
 * app.guide section and recipes: the portfolio (positions, founder updates
 * to verified KPIs, alerts, asks, board briefs) and the full recipes of its
 * triggers. Plain data; the kernel appends the closing data rule to every
 * recipe.
 */
module.exports = {
  title: 'Portfolio',
  section: [
    'One company at a glance: portfolio.company --company (company, founders, latest deck and update, fund position, open asks, next board meeting, files). Positions: holdings.list (the portfolio with figures), holdings.company --company (every holding, security, round and cap table of a company), holdings.get, ownership.get, prorata.preview, safe.preview. Numbers come from the app\'s engines; never compute ownership, conversion, MOIC or runway yourself.',
    'Marking a deal invested (holdings.create-from-deal) is people only. Round and security details you read in closing documents are proposals: rounds.save and securities.save with --anchors citing the pages.',
    'KPIs: kpis.list --company shows series (verified solid, staged dashed) and runway. You stage values with kpis.stage, each with its source (quote or anchor); a person verifies them. You never verify, reject or enter a value as verified.',
    'Values: money in major units of its currency, percents as 72.5, counts as whole numbers. period_end is the last day of the month the value covers; months is 1, 3 or 12. Keep forecasts apart (forecast true). Flag definitional problems with flag codes (kpi-defs.list lists them): contracted ARR reported as ARR is contracted_not_live, gross burn reported as net burn is gross_not_net.',
    'Updates: updates.list, updates.get. A founder file you hold can be added with updates.add --company --paths. An update without a company becomes a proposal with updates.assign.',
    'Asks: what founders ask for (intros, hires, customers, fundraising, advice) is tracked work. Propose each ask with asks.save (company, kind, title, the update and the founder\'s words in quote). Closing an ask and its place on the asks board (asks.reorder) are a person\'s.',
    'Alerts fire by rule (runway, cash, burn, missed update); alerts.list shows them; acknowledging and changing the rules are people only.',
    'Board meetings: board.list; board.save is a proposal; board.brief-save writes the brief.',
  ],
  events: ['holding.created { holding, company, fund, deal }', 'kpi.verified { company, period_end }', 'alert.fired { alert, company, rule }'],
  update_extract: [
    'Read a founder update and stage its KPI values for a person to verify (trigger update_extract { update_id }).',
    '1) updates.get --update <update_id> for the text, the files, the metrics the firm asked for and the period it asked about; holdings.company --company <its company> for the report currency and the fiscal year end; files.text --file <id> for each file (pages and lines). A file whose text_state is needs_ocr: read the page images with your vision tools.',
    '2) For every actual figure the founder reports (revenue, ARR, MRR, gross margin, net burn, cash, headcount, customers, NRR, and any other metric in kpi-defs.list), note the period it covers: period_end is the last day of that month (a quarter ends on its last month, months 3), the currency as written, and the exact words.',
    '3) kpis.stage --update <update_id> --values \'[...]\' with every value at once: quote the exact words of the email text (the app anchors them), or for a file create anchors.create --file --page --quote first and pass anchor. Forecasts, plans and budgets go in with forecast true, never as actuals. Flag what looks defined differently: contracted_not_live for contracted or signed ARR reported as ARR, gross_not_net, bookings_not_revenue, run_rate for annualized monthly figures, period_unclear, currency_unclear.',
    '4) Never stage a number you did not read. If the period or currency is unclear, stage it with the flag; never guess. Runway is computed by the app: stage cash and net burn instead.',
    '5) For each ask the founder makes (an intro, a hire, customers, fundraising help, advice), asks.save --company --update <update_id> --kind --title "<a few words>" --quote "<their words>" (it becomes a proposal).',
    '6) Your staging (or an ask) marks the request done. Mail from a portfolio company that holds no figures and no asks (scheduling, thanks): agent.cannot --trigger update_extract --record <update_id> --reason "No figures or asks: <what it is>"; a person dismisses it. Never verify, never reply to the founder.',
  ],
  closing_extract: [
    'Read the closing documents of a new investment and propose its terms (trigger closing_extract { holding_id }).',
    '1) holdings.get --holding <holding_id> for what was recorded (its security and round); files.list --owner_collection holdings --owner_id <holding_id> and files.text --file <id> for each closing document (term sheet, SAFE, stock purchase agreement, cap table).',
    '2) For every term that differs from what was recorded or is missing, anchor it (anchors.create --file --page --quote "<exact words>").',
    '3) Propose the round with rounds.save --round <its round when it has one> (or --company) with day, type, pre_money, post_money, raise, price, pre_shares, post_shares and --cap_table \'[{"holder","class","shares"}]\' from the summary cap table, --anchors \'[...]\'. Money in major units.',
    '4) Propose the security with securities.save --security <its security> with kind, class, shares, cost, cap, discount, rate, liq_pref, participating, --anchors. Both are proposals a person accepts.',
    '5) Your first proposal marks the request done. Never invent a term; leave what the documents do not state.',
  ],
  board_brief: [
    'Write the brief for a portfolio board meeting (trigger board_brief { meeting_id }).',
    '1) board.list --company <its company> (the meeting, its day and the last board note), kpis.list --company <its company> (verified values only count as facts; say when a period is staged), updates.list --company and updates.get for the latest update or deck, asks.list --company (open asks), board.list --company (the last board note).',
    '2) board.brief-save --meeting <meeting_id> --brief \'{"sections":[{"title":"KPIs","points":[...]},{"title":"Since last board","points":[...]},{"title":"Open asks","points":[...]},{"title":"Questions","points":[...]}]}\' with short points, each with its source ({"kpi":"<value id>"}, {"anchor":"<id>"}, {"ask":"<id>"}, {"file":"<id>"}).',
    '3) Two quarters of verified figures at most; no forecasts as facts; no recommendation. The save marks the request done.',
  ],
};
