/**
 * Lifecycle subscriptions (SPEC 3.4).
 *
 *   entity.created      the country's checklist templates, letter templates, exit form, grievance types
 *   employment.hired    onboarding starts from the entity's default template (first day at most 30 days ago)
 *   employment.ended    offboarding starts when no separation started it
 *   employment.changed  open manager tasks follow a new manager
 *
 * Approval kind `separation` (flow seeded in 1730006000_lifecycle.js: the manager, then HR).
 * Emitted: separation.approved, separation.changed, checklist.completed (see guide_lifecycle.js).
 */
module.exports = {
  on: {
    'entity.created': 'lib_lifecycle.onEntityCreated',
    'employment.hired': 'lib_lifecycle.onHire',
    'employment.ended': 'lib_lifecycle.onEnded',
    'employment.changed': 'lib_lifecycle.onChanged',
  },
  approvals: { separation: 'lib_lifecycle_separations.onDecision' },
  profileFacts: 'lib_lifecycle.profileFacts',
};
