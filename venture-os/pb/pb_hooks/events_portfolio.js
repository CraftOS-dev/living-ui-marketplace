/**
 * Portfolio registrations (SPEC 4.2). Plain data.
 *
 * Events the portfolio emits:
 *   holding.created { holding, company, fund, deal }
 *   kpi.verified    { company, period_end }
 *   alert.fired     { alert, company, rule }
 *
 * Contracts (SPEC 4.6): lib_portfolio.holdingsOf, lib_portfolio.kpiSeries,
 * lib_portfolio.runway.
 */
module.exports = {
  on: {},
  needsYou: 'lib_portfolio_updates.needsYou',
  triggers: {
    update_extract: {
      record: 'updates',
      param: 'update_id',
      perm: 'portfolio:edit',
      label: 'Read a founder update',
      description: 'Your AI agent reads a founder update and stages its KPI values with their source, and the founder\'s asks, for a person to verify',
      fires: 'Adding or filing an update, Ask your AI agent on an update, or an update that arrives by email (switch)',
      cooldown: 10,
      policy: { key: 'email_updates', label: 'Extract numbers from founder updates that arrive by email', tip: 'Each founder update that arrives by email is read and its numbers staged for you to verify.' },
      check: 'lib_portfolio_updates.extractCheck',
      lands: { 'kpis.stage': 'update', 'asks.save': 'update' },
      instruction:
        "Read founder update update_id and stage its KPI values for a person to verify. 1) updates.get --update <update_id>: text, files, the metrics asked; files.text for each file. 2) For every actual figure reported (revenue, ARR, burn, cash, headcount, customers...), note its period (period_end: the last day of that month; months 1, 3 or 12), the currency as written and the exact words. 3) kpis.stage --update <update_id> --values '[...]' with every value at once, each quoting its words; forecasts with forecast true; flag what is defined differently (contracted_not_live, gross_not_net, run_rate, period_unclear). 4) Each ask: asks.save --company --update <update_id> --kind --title --quote. Never verify or reply.",
    },
    closing_extract: {
      record: 'holdings',
      param: 'holding_id',
      perm: 'portfolio:edit',
      label: 'Read closing documents',
      description: 'Your AI agent reads the closing documents of a new investment and proposes its round and security terms, each anchored to its page',
      fires: 'Marking a deal invested with closing documents, or Ask your AI agent on a holding',
      cooldown: 10,
      deal: 'lib_portfolio.holdingDeal',
      check: 'lib_portfolio.closingCheck',
      lands: { 'rounds.save': 'round:rounds.holding', 'securities.save': 'security:securities.holding' },
      instruction:
        "Read the closing documents of holding holding_id and propose its terms. 1) holdings.get --holding <holding_id>: what was recorded, its security and round; files.list --owner_collection holdings --owner_id <holding_id> and files.text for each document. 2) Anchor every term that differs or is missing (anchors.create --file --page --quote \"<exact words>\"). 3) rounds.save --round <its round> with day, type, pre_money, post_money, raise, price, shares and --cap_table, --anchors (money in major units). 4) securities.save --security <its security> with kind, class, shares, cost, cap, discount, rate, liq_pref, participating, --anchors. Both are proposals (the first marks it done). Never invent a term.",
    },
    board_brief: {
      record: 'board_meetings',
      param: 'meeting_id',
      perm: 'portfolio:view',
      label: 'Brief a board meeting',
      description: 'Your AI agent writes the brief of a portfolio board meeting from verified figures, the latest update, open asks and the last board note',
      fires: 'Brief on a board meeting, or 48 hours before one while the switch is on',
      cooldown: 10,
      policy: { key: 'board_briefs', label: 'Board meeting briefs', tip: 'A brief for each portfolio board meeting in the next 2 days.' },
      check: 'lib_portfolio_updates.briefCheck',
      instruction:
        "Write the brief of portfolio board meeting meeting_id. 1) board.list --company <its company> (the meeting and the last board note), kpis.list --company (verified values only count as facts; say when a period is only staged), updates.list --company and updates.get for the latest update or deck, asks.list --company (open asks). 2) board.brief-save --meeting <meeting_id> --brief '{\"sections\":[{\"title\":\"KPIs\",\"points\":[...]},{\"title\":\"Since last board\",...},{\"title\":\"Open asks\",...},{\"title\":\"Questions\",...}]}' with short points, each with its source ({\"kpi\"}, {\"anchor\"}, {\"ask\"} or {\"file\"}) (marks it done). Two quarters of verified figures at most; no forecasts as facts; no recommendation.",
    },
  },
  search: 'lib_portfolio.search',
  timeline: 'lib_portfolio.timelineFor',
  settingsKeys: {
    portfolio: {
      runway_months: 6,
      cash_months: 3,
      burn_up_pct: 30,
      missed_update_days: 45,
      request_subject: '',
      request_body: '',
      request_day: 3,
      reminder_1_days: 7,
      reminder_2_days: 14,
      company_mail: true,
    },
  },
  imports: {
    holdings: {
      label: 'Holdings',
      perm: 'portfolio:edit',
      fields: [
        { key: 'company', label: 'Company', required: true, type: 'text', synonyms: ['Company name', 'Portfolio company', 'Name', 'Domain', 'Website'] },
        { key: 'fund', label: 'Fund', type: 'text', synonyms: ['Fund name', 'Vehicle', 'Entity'] },
        { key: 'instrument', label: 'Instrument', type: 'text', synonyms: ['Security', 'Security type', 'Type'] },
        { key: 'amount', label: 'Amount', required: true, type: 'money', synonyms: ['Invested', 'Investment', 'Cost', 'Check', 'Amount invested'] },
        { key: 'day', label: 'Day', type: 'day', synonyms: ['Date', 'Investment date', 'Close date', 'Closing date'] },
        { key: 'valuation', label: 'Valuation', type: 'money', synonyms: ['Post-money', 'Post money', 'Cap', 'Valuation cap', 'Post-money valuation'] },
        { key: 'currency', label: 'Currency', type: 'text', synonyms: ['CCY', 'Ccy'] },
      ],
      row: 'lib_portfolio.importHolding',
    },
    kpi_values: {
      label: 'KPI values',
      perm: 'portfolio:edit',
      fields: [
        { key: 'company', label: 'Company', required: true, type: 'text', synonyms: ['Company name', 'Portfolio company', 'Name', 'Domain'] },
        { key: 'period_end', label: 'Period end', required: true, type: 'text', synonyms: ['Period', 'Month', 'Date', 'As of', 'Period end date'] },
        { key: 'metric', label: 'Metric', required: true, type: 'text', synonyms: ['KPI', 'Key', 'Measure'] },
        { key: 'value', label: 'Value', required: true, type: 'text', synonyms: ['Amount', 'Figure', 'Actual'] },
        { key: 'currency', label: 'Currency', type: 'text', synonyms: ['CCY', 'Ccy'] },
        { key: 'months', label: 'Months', type: 'int', synonyms: ['Period months', 'Period length'] },
        { key: 'forecast', label: 'Forecast', type: 'bool', synonyms: ['Is forecast', 'Plan', 'Budget'] },
      ],
      row: 'lib_portfolio_kpi.importKpi',
    },
  },
};
