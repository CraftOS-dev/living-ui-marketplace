/**
 * Expenses subscriptions (SPEC 3.4): the standard categories and policy of a
 * new entity, the approval kinds claim, advance and travel, and the facts
 * the profile and Home show (open claims, awaiting reimbursement, advance
 * balance).
 */
module.exports = {
  on: { 'entity.created': 'lib_expenses.onEntityCreated' },
  approvals: { claim: 'lib_expenses.onDecision', advance: 'lib_expenses.onDecision', travel: 'lib_expenses.onDecision' },
  profileFacts: 'lib_expenses.profileFacts',
};
