/**
 * Hiring subscriptions (SPEC 3.4).
 *
 * Approval kinds: requisition (a request for new people) and offer.
 * Kernel event employment.hired: a hire with from_application links the
 * application (hired), the accepted offer, the opening and the requisition.
 * Profile facts: interviews the person is on this week and scorecards owed.
 *
 * Emitted by hiring: offer.accepted { application, offer, candidate }.
 */
module.exports = {
  on: { 'employment.hired': 'lib_hiring_offers.onHired' },
  approvals: { requisition: 'lib_hiring_plans.onDecision', offer: 'lib_hiring_offers.onDecision' },
  profileFacts: 'lib_hiring.profileFacts',
};
