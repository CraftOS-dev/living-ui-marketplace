/** SCRATCH ONLY (payroll-out tests): fixture ops. Never copied to APP. */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
module.exports = [
  { name: 'testpout.seed-run', method: 'POST', fn: 'lib_test_pout.seedRun', perm: 'admin', agent: 'deny', effect: 'write', desc: 'Test fixture: insert a pay run with payslips and lines.', params: { entity: S('Entity', { required: true }), kind: S('Run kind'), label: S('Label'), period_start: S('Start', { required: true }), period_end: S('End', { required: true }), pay_date: S('Pay date', { required: true }), status: S('locked | paid | draft'), year_end: S('true for a year-end run'), slips: S('JSON slips', { required: true }) } },
  { name: 'testpout.bank', method: 'POST', fn: 'lib_test_pout.bank', perm: 'admin', agent: 'deny', effect: 'write', desc: 'Test fixture: replace an employee bank accounts with active ones.', params: { employee: S('Employee number', { required: true }), accounts: S('JSON accounts', { required: true }) } },
  { name: 'testpout.void', method: 'POST', fn: 'lib_test_pout.voidRun', perm: 'admin', agent: 'deny', effect: 'write', desc: 'Test fixture: void a run and emit payrun.voided.', params: { payrun: S('Pay run id or number', { required: true }) } },
  { name: 'testpout.kana', method: 'POST', fn: 'lib_test_pout.kana', perm: 'admin', agent: 'deny', effect: 'write', desc: 'Test fixture: set an employee kana.', params: { employee: S('Employee number', { required: true }), kana: S('JSON kana', { required: true }) } },
];
