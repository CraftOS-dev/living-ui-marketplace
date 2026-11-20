/**
 * payroll-out subscriptions (SPEC 3.4): the filings ledger is built when an
 * entity is created and refreshes the moment a pay run locks, is voided
 * (its rows become not needed or amend) or is paid (payroll-core emits these).
 */
module.exports = {
  on: {
    'entity.created': 'lib_payroll_out_filings.onEntityCreated',
    'payrun.locked': 'lib_payroll_out_filings.onRunChanged',
    'payrun.voided': 'lib_payroll_out_filings.onRunChanged',
    'payrun.paid': 'lib_payroll_out_filings.onRunChanged',
  },
  approvals: {},
};
