/**
 * Payroll subscriptions (SPEC 3.4), payroll-core.
 *
 * Events payroll emits: payrun.locked { payrun }, payrun.voided { payrun,
 * replaced_by }, payrun.paid { payrun, paid_at }; and employment.changed
 * { employment, kind: 'pay' | 'tax', record, effective_from } when an
 * approved pay change or tax declaration writes a record.
 */
module.exports = {
  on: {
    'entity.created': 'lib_payroll.onEntityCreated',
    'separation.approved': 'lib_payroll.onSeparation',
    'separation.changed': 'lib_payroll.onSeparationChanged',
    'employment.changed': 'lib_payroll.onEmploymentChanged',
    'record.editing': 'lib_payroll.onRecordEditing',
  },
  approvals: {
    payrun: 'lib_payroll_runs.onPayrunDecision',
    pay_change: 'lib_payroll_items.onPayChange',
    loan: 'lib_payroll_items.onLoanDecision',
    tax_declaration: 'lib_payroll_tax.onDeclarationDecision',
  },
  profileFacts: 'lib_payroll.profileFacts',
};
