/* SCRATCH ONLY (payroll-core tests): stands in for payroll-out's payout.confirm-upload. Never shipped. */
module.exports = [
  { name: 'testpay.mark-paid', method: 'POST', fn: 'lib_zz_scratch.markPaid', perm: 'payroll:full', agent: 'deny', effect: 'write', desc: 'Scratch only: mark a locked run paid.', params: { payrun: { type: 'string', required: true, desc: 'Run' }, paid_at: { type: 'string', desc: 'Day' } } },
  { name: 'testpay.payout', method: 'GET', fn: 'lib_zz_scratch.payout', perm: 'payroll:view', effect: 'read', desc: 'Scratch only: payout items of a run.', params: { payrun: { type: 'string', required: true, desc: 'Run' } } },
  { name: 'testpay.timing', method: 'GET', fn: 'lib_zz_scratch.timing', perm: 'payroll:view', effect: 'read', desc: 'Scratch only: time the contract calls.', params: { payrun: { type: 'string', required: true, desc: 'Run' } } },
];
