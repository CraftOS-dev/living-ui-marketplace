/**
 * Performance subscriptions (SPEC 3.4).
 *
 *   approvals   review_signoff: HR signs off a review the employee
 *               acknowledged, where the entity requires it (approved ->
 *               signed; rejected -> the manager review goes back to draft
 *               with the note; cancelled -> acknowledged)
 *   on          employment.ended: the person leaves open cycles; their
 *               unwritten peer and upward reviews are declined
 *   facts       goals, goals at risk, last review, trainings due, praise
 *
 * Events this module emits (see guide_performance.js): goal.checked_in,
 * review_cycle.launched, review.submitted, review.shared,
 * review.acknowledged, review.signed, training.completed.
 */
module.exports = {
  on: { 'employment.ended': 'lib_performance.onEmploymentEnded' },
  approvals: { review_signoff: 'lib_performance_reviews.onSignoff' },
  profileFacts: 'lib_performance.profileFacts',
};
