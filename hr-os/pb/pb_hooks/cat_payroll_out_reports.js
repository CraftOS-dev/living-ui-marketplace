/**
 * Catalog: payroll reports (locked and paid runs only).
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const RANGE = { from: S('First pay date (YYYY-MM-DD, default 1 January)'), to: S('Last pay date (default today)') };

module.exports = [
  { name: 'payreports.register', method: 'GET', fn: 'lib_payroll_out_reports.register', perm: 'payroll:view|reports:view', effect: 'read', desc: 'The payroll register: a row per payslip of a run, or of locked runs between two pay dates (gross, deductions by stage, employer cost, reimbursements, net, department, cost centre), with totals.', params: Object.assign({ payrun: S('Pay run id or number'), entity: S('Entity'), limit: N('Rows (default 500)'), offset: N('Rows to skip') }, RANGE) },
  { name: 'payreports.cost', method: 'GET', fn: 'lib_payroll_out_reports.cost', perm: 'payroll:view|reports:view', effect: 'read', desc: 'Employer cost (gross + employer contributions + reimbursements) by entity, department or cost centre in the reporting currency (FX at each pay date), with a month series and any missing FX rates.', params: Object.assign({ entity: S('Entity'), group: S('entity | department | cost_center', { enum: ['entity', 'department', 'cost_center'] }) }, RANGE) },
  { name: 'payreports.remittance', method: 'GET', fn: 'lib_payroll_out_reports.remittance', perm: 'payroll:view|reports:view', effect: 'read', desc: 'What is owed to each authority or fund: employee deductions and employer contributions by payee, filing and month, with the line codes.', params: Object.assign({ entity: S('Entity') }, RANGE) },
  { name: 'payreports.ytd', method: 'GET', fn: 'lib_payroll_out_reports.ytd', perm: 'payroll:view|reports:view', effect: 'read', desc: "Year to date per employee for the entity's tax year: payslips, gross, deductions by stage, employer cost, net and each statutory line.", params: { entity: S('Entity id or name', { required: true }), year: N('Tax year by its start year') } },
  { name: 'payreports.headcount', method: 'GET', fn: 'lib_payroll_out_reports.headcount', perm: 'payroll:view|reports:view', effect: 'read', desc: 'People paid in regular and leaver runs by month, with total and average gross and net pay in the reporting currency.', params: Object.assign({ entity: S('Entity') }, RANGE) },
];
