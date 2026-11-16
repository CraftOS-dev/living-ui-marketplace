/** SCRATCH ONLY (expenses tests): ops that call the expenses contract functions. Never copied to APP. */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
module.exports = [
  { name: 'testexp.pay-inputs', method: 'GET', fn: 'lib_testexp.payInputs', perm: 'admin', effect: 'read', desc: 'test: lib_expenses.payInputs', params: { employment: S('e', { required: true }), up_to: S('d', { required: true }), currency: S('c'), via: S('v') } },
  { name: 'testexp.mark-paid', method: 'POST', fn: 'lib_testexp.markPaid', perm: 'admin', effect: 'write', desc: 'test: lib_expenses.markPaid', params: { ids: S('json', { required: true }), payrun: S('p', { required: true }) } },
  { name: 'testexp.unmark-paid', method: 'POST', fn: 'lib_testexp.unmarkPaid', perm: 'admin', effect: 'write', desc: 'test: lib_expenses.unmarkPaid', params: { payrun: S('p', { required: true }) } },
  { name: 'testexp.recovery', method: 'GET', fn: 'lib_testexp.recovery', perm: 'admin', effect: 'read', desc: 'test: lib_expenses.advanceRecovery', params: { employment: S('e', { required: true }), up_to: S('d', { required: true }) } },
  { name: 'testexp.outstanding', method: 'GET', fn: 'lib_testexp.outstanding', perm: 'admin', effect: 'read', desc: 'test: lib_expenses.outstanding', params: { employment: S('e', { required: true }) } },
  { name: 'testexp.cron', method: 'POST', fn: 'lib_testexp.cron', perm: 'admin', effect: 'write', desc: 'test: run the expenses cron functions', params: { which: S('reminders', { required: true }) } },
  { name: 'testexp.facts', method: 'GET', fn: 'lib_testexp.facts', perm: 'signed', effect: 'read', desc: 'test: lib_events.profileFacts', params: { employment: S('e', { required: true }) } },
  { name: 'testexp.payrun', method: 'POST', fn: 'lib_testexp.payrun', perm: 'admin', effect: 'write', desc: 'test: a minimal locked pay run (number, pay day) to mark claims paid by', params: { entity: S('e', { required: true }), pay_date: S('d', { required: true }), number: S('n', { required: true }) } },
];
