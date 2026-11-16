/**
 * Leave subscriptions (SPEC 3.4).
 *
 * - entity.created: the country's leave types and a default policy.
 * - employment.hired: the person follows the entity's default policy from
 *   their first day; grants due so far are written.
 * - employment.changed, employment.ended: schedules, hours and end days move
 *   grants and accruals, so the person's balances are worked out again.
 * - payrun.voided: cash-ins the void run paid go back to approved, reserved
 *   for the replacement; payrun.locked: the replacement marks them paid.
 * - separation.approved, separation.changed (lifecycle): the unused balance
 *   of types paid out on termination becomes an approved cash-in on the last
 *   day, paid with the final pay (payInputs().encash).
 * - Approval kinds: leave_request (requests and cancellations), leave_encash
 *   (cashing in leave), comp_off (compensatory leave for days worked).
 */
module.exports = {
  on: {
    'entity.created': 'lib_leave.onEntityCreated',
    'employment.hired': 'lib_leave.onHired',
    'employment.changed': 'lib_leave.onChanged',
    'employment.ended': 'lib_leave.onChanged',
    'payrun.voided': 'lib_leave.onPayrunVoided',
    'payrun.locked': 'lib_leave.onPayrunLocked',
    'separation.approved': 'lib_leave_req.onSeparation',
    'separation.changed': 'lib_leave_req.onSeparation',
  },
  approvals: {
    leave_request: 'lib_leave_req.onDecision',
    leave_encash: 'lib_leave_req.onEncashDecision',
    comp_off: 'lib_leave_req.onCompOffDecision',
  },
  profileFacts: 'lib_leave.profileFacts',
};
