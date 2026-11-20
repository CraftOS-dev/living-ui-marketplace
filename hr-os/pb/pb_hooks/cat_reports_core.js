/**
 * Catalog: cross-module people analytics (home-reports module). Every report
 * is a read with the same filters; reports.export gives any of them as CSV.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const DAY = (desc) => S(desc + ' (YYYY-MM-DD)');

const FILTERS = {
  entity: S('Entity id or name (default: every entity you may see)'),
  department: S('Department id or name (its sub-departments count too)'),
  location: S('Location id or name'),
  from: DAY('First day of the period'),
  to: DAY('Last day of the period, default today'),
};
const MONEY = { currency: S('Reporting currency, e.g. USD (default: the company reporting currency)') };
const GROUP = { group_by: S('entity | department | location', { enum: ['entity', 'department', 'location'] }) };
const AS_OF = { entity: FILTERS.entity, department: FILTERS.department, location: FILTERS.location, to: DAY('The day to look at, default today') };

module.exports = [
  { name: 'reports.list', method: 'GET', fn: 'lib_reports.list', perm: 'reports:view|payroll:view', effect: 'read', desc: 'Every people analytics report with its operation and whether the caller may see it (pay reports need Payroll view).' },
  {
    name: 'reports.headcount',
    method: 'GET',
    fn: 'lib_reports.headcount',
    perm: 'reports:view',
    effect: 'read',
    desc: 'Headcount at each month end (default the last 12 months, at most 36) by entity, department or location, with joiners and leavers per month.',
    params: Object.assign({}, FILTERS, GROUP),
  },
  {
    name: 'reports.movement',
    method: 'GET',
    fn: 'lib_reports.movement',
    perm: 'reports:view',
    effect: 'read',
    desc: 'Joiners and leavers by month, turnover against average headcount (period and yearly), voluntary or involuntary from the separation kind (not_recorded without one), reasons, tenure at leaving.',
    params: Object.assign({}, FILTERS),
  },
  { name: 'reports.tenure', method: 'GET', fn: 'lib_reports.tenure', perm: 'reports:view', effect: 'read', desc: 'Tenure of the people in work on a day: bands, average and median, by entity, department or location, and one row per person.', params: Object.assign({}, AS_OF, GROUP) },
  { name: 'reports.span', method: 'GET', fn: 'lib_reports.span', perm: 'reports:view', effect: 'read', desc: 'Span of control on a day: each manager with direct and all reports, the distribution, the average, people without a manager.', params: Object.assign({}, AS_OF) },
  {
    name: 'reports.diversity',
    method: 'GET',
    fn: 'lib_reports.diversity',
    perm: 'reports:view',
    effect: 'read',
    desc: 'Aggregate counts of the people in work on a day by gender, age band or nationality. Groups of fewer than 5 are hidden (count null), and a second group when only one would be. Never per person.',
    params: Object.assign({ dimension: S('gender | age | nationality', { enum: ['gender', 'age', 'nationality'] }) }, AS_OF),
  },
  {
    name: 'reports.comp-bands',
    method: 'GET',
    fn: 'lib_reports_pay.compBands',
    perm: 'payroll:view',
    effect: 'read',
    desc: 'Each graded person\'s yearly full-time pay against the grade range (grade currency): below, inside or above, compa-ratio, place in range. Payroll view; your AI agent only when the company allows.',
    params: Object.assign({}, AS_OF),
  },
  {
    name: 'reports.cost',
    method: 'GET',
    fn: 'lib_reports_pay.cost',
    perm: 'payroll:view',
    effect: 'read',
    desc: 'Payroll cost of locked and paid runs by pay month (gross, employer costs, net) in the reporting currency at month-end rates, with headcount. Groups without a rate are listed in missing_fx.',
    params: Object.assign({}, FILTERS, MONEY),
  },
  {
    name: 'reports.leave-liability',
    method: 'GET',
    fn: 'lib_reports_pay.leaveLiability',
    perm: 'reports:view|leave:view',
    effect: 'read',
    desc: 'Leave owed on a day: each person\'s balance per paid leave type (types paid out on leaving by default, or all paid), in days or hours; with pay access its value at the daily or hourly rate.',
    params: Object.assign({ basis: S('payout (default: types paid out when someone leaves) | paid (every paid type)', { enum: ['payout', 'paid'] }), fresh: { type: 'boolean', desc: 'Count the balances again now instead of using the ones kept (slower)' } }, AS_OF, MONEY),
  },
  {
    name: 'reports.absence',
    method: 'GET',
    fn: 'lib_reports_ops.absence',
    perm: 'reports:view',
    effect: 'read',
    desc: 'Absence and overtime by whole month (default the last 3, at most 12), by department and person: working days, days absent, leave by type, rates, overtime hours, late minutes.',
    params: Object.assign({ fresh: { type: 'boolean', desc: 'Count the months again now instead of using the figures kept (slower)' } }, FILTERS),
  },
  {
    name: 'reports.hiring',
    method: 'GET',
    fn: 'lib_reports_ops.hiring',
    perm: 'reports:view|hiring:view',
    effect: 'read',
    desc: 'Applications in the period through applied, screen, interview, offer and hired (a later stage counts the earlier ones), conversion per step, sources, days from application to hire per opening.',
    params: Object.assign({}, FILTERS),
  },
  {
    name: 'reports.training',
    method: 'GET',
    fn: 'lib_reports_ops.training',
    perm: 'reports:view|performance:view',
    effect: 'read',
    desc: 'Training completion of sessions that ended in the period (and courses recorded as completed): places, completed, no shows, hours trained, by program and by department.',
    params: Object.assign({}, FILTERS),
  },
  {
    name: 'reports.export',
    method: 'GET',
    fn: 'lib_reports.exportCsv',
    perm: 'reports:view|payroll:view',
    agent: 'deny',
    effect: 'read',
    desc: 'A report as CSV, with the same filters as the report (people only; your AI agent reads the reports themselves).',
    params: Object.assign(
      { report: S('headcount | movement | tenure | span | diversity | comp-bands | cost | leave-liability | absence | hiring | training', { required: true, enum: ['headcount', 'movement', 'tenure', 'span', 'diversity', 'comp-bands', 'cost', 'leave-liability', 'absence', 'hiring', 'training'] }) },
      FILTERS,
      MONEY,
      GROUP,
      { dimension: S('For diversity: gender | age | nationality', { enum: ['gender', 'age', 'nationality'] }), basis: S('For leave liability: payout | paid', { enum: ['payout', 'paid'] }), fresh: { type: 'boolean', desc: 'For absence and leave liability: count again now' } },
    ),
  },
];
