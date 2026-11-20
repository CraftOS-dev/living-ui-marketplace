/**
 * Catalog: portfolio KPIs and alerts. Agent rules (REPORT Tables 34 and
 * 37): reading and staging values, and checking the alert rules, allow;
 * verifying, rejecting, entering values, definitions, acknowledgments and
 * rules are people only. Your AI agent never verifies a KPI.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});

const COMPANY = S('Company id, domain or name', { required: true, example: 'acme.com' });
const PICK = { update: S('Update id: every staged value of it'), ids: S('JSON list of value ids'), id: S('One value id') };

module.exports = [
  {
    name: 'kpis.fund',
    method: 'GET',
    fn: 'lib_portfolio_kpi.opFund',
    perm: 'portfolio:view',
    effect: 'read',
    desc: "Every company a fund holds with its verified figures for one quarter (latest per metric, forecasts left out) and how many values still wait to be verified: an LP letter's portfolio highlights in one read.",
    params: { fund: S('Fund id or name (default: the only fund)'), quarter: S('A quarter label such as "Q3 2026" (or a quarter id)'), period_end: S('Or the quarter end day YYYY-MM-DD') },
  },
  {
    name: 'kpis.list',
    method: 'GET',
    fn: 'lib_portfolio_kpi.opList',
    perm: 'portfolio:view',
    effect: 'read',
    desc: 'A portfolio company\'s metrics as series (staged and verified points; verified wins a period; forecasts apart), the latest verified figure of each, and runway (verified cash and burn only). --currency USD converts money (flows at the period average rate, balances at period end); native keeps each value\'s own.',
    params: { company: COMPANY, currency: S('native (default) or a currency code'), keys: S('JSON list of metric keys (default: all)'), from_day: S('From period end YYYY-MM-DD'), to_day: S('To period end YYYY-MM-DD') },
  },
  {
    name: 'kpis.stage',
    method: 'POST',
    fn: 'lib_portfolio_kpi.opStage',
    perm: 'portfolio:edit',
    agent: 'allow',
    effect: 'write',
    desc: 'Stage KPI values for a person to verify. --values \'[{"key":"revenue","period_end":"2026-10-31","months":1,"value":"410000","currency":"USD","quote":"exact words","forecast":false,"flags":["contracted_not_live"],"note":"why the flag"}]\'. Money in major units, percents as 72.5. Every value of yours needs quote (from the update text) or anchor (anchors.create on a file page).',
    params: { update: S('The update the values come from (its company is used)'), company: S('Company (when there is no update)'), values: S('JSON list of values (see desc)', { required: true }), period_end: S('Default period_end for the items'), currency: S('Default currency for the items') },
  },
  {
    name: 'kpis.verify',
    method: 'POST',
    fn: 'lib_portfolio_kpi.opVerify',
    perm: 'portfolio:edit',
    agent: 'deny',
    effect: 'write',
    desc: 'Verify staged values (people only): a whole update, a list, or one value; --value with --id corrects it as it is verified. Charts then draw them solid; runway and alerts use verified values only.',
    params: Object.assign({}, PICK, { value: S('Corrected value (with --id), major units or percent') }),
  },
  {
    name: 'kpis.reject',
    method: 'POST',
    fn: 'lib_portfolio_kpi.opReject',
    perm: 'portfolio:edit',
    agent: 'deny',
    effect: 'write',
    desc: 'Reject staged values with a note (people only).',
    params: Object.assign({}, PICK, { note: S('Why') }),
  },
  {
    name: 'kpis.save',
    method: 'POST',
    fn: 'lib_portfolio_kpi.opSave',
    perm: 'portfolio:edit',
    agent: 'deny',
    effect: 'write',
    desc: 'Enter a value by hand (people only): it is verified at once and replaces the period\'s staged or verified value.',
    params: { company: COMPANY, key: S('Metric key', { required: true, example: 'cash' }), period_end: S('Last day of the period, YYYY-MM-DD', { required: true, example: '2026-10-31' }), months: N('1 (month, default), 3 (quarter) or 12 (year)'), value: S('Value: major units, percent, or a count', { required: true }), currency: S('Currency (money metrics; default the company\'s reporting currency)'), forecast: B('A forecast, not an actual') },
  },
  {
    name: 'kpi-defs.list',
    method: 'GET',
    fn: 'lib_portfolio_kpi.opDefsList',
    perm: 'portfolio:view',
    effect: 'read',
    desc: 'The KPI definitions (key, label, kind flow, stock, ratio or computed, unit money, count, percent or months, on or off) and the flag codes for definitional problems.',
    params: {},
  },
  {
    name: 'kpi-defs.save',
    method: 'POST',
    fn: 'lib_portfolio_kpi.opDefSave',
    perm: 'portfolio:edit',
    agent: 'deny',
    effect: 'write',
    desc: 'Add a metric or change one\'s label, order or on/off (people only). Standard metrics keep their kind and unit.',
    params: { key: S('Metric key, lower case', { required: true, example: 'pipeline_value' }), label: S('Label'), kind: S('flow, stock or ratio', { enum: ['flow', 'stock', 'ratio'] }), unit: S('money, count or percent', { enum: ['money', 'count', 'percent'] }), active: B('Shown and asked for'), sort: N('Order') },
  },
  {
    name: 'alerts.list',
    method: 'GET',
    fn: 'lib_portfolio_kpi.opAlertsList',
    perm: 'portfolio:view',
    effect: 'read',
    desc: 'Alerts (live: open and acknowledged, the default): runway under the threshold, cash under months of burn, burn up quarter on quarter, missed update; each with its figure, threshold and a small series. Also the current thresholds.',
    params: { status: S('live (default), open, acked, resolved or all', { enum: ['live', 'open', 'acked', 'resolved', 'all'] }), company: S('Company id, domain or name') },
  },
  {
    name: 'alerts.ack',
    method: 'POST',
    fn: 'lib_portfolio_kpi.opAck',
    perm: 'portfolio:edit',
    agent: 'deny',
    effect: 'write',
    desc: 'Acknowledge an alert (people only). It does not fire again for the same breach and resolves itself when the condition ends.',
    params: { alert: S('Alert id', { required: true }), note: S('Note') },
  },
  {
    name: 'alerts.rules-save',
    method: 'POST',
    fn: 'lib_portfolio_kpi.opRulesSave',
    perm: 'portfolio:edit',
    agent: 'deny',
    effect: 'write',
    desc: 'Alert thresholds (people only): runway_months (6), cash_months (3), burn_up_pct (30), missed_update_days (45).',
    params: { runway_months: N('Runway under this many months'), cash_months: N('Cash under this many months of burn'), burn_up_pct: N('Burn up by this percent quarter on quarter'), missed_update_days: N('No update this many days after the period asked for') },
  },
  {
    name: 'alerts.run',
    method: 'POST',
    fn: 'lib_portfolio_kpi.opAlertsRun',
    perm: 'portfolio:edit',
    agent: 'allow',
    effect: 'write',
    desc: 'Check the alert rules now for one company or every active one (the app also checks daily and when values are verified). Answers the alerts fired.',
    params: { company: S('Company id, domain or name') },
  },
];
