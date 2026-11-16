/**
 * Time module subscriptions (SPEC 3.4).
 *
 *   entity.created    a new entity gets its country's overtime rules and a first shift type
 *   employment.ended  shifts after the last day are taken off the schedule
 *
 * Approval kinds: attendance_request, shift_request, timesheet, overtime.
 * Profile facts: today's shift and the clock state, this month in short.
 */
module.exports = {
  on: {
    'entity.created': 'lib_time.onEntityCreated',
    'employment.ended': 'lib_time.onEmploymentEnded',
  },
  approvals: {
    attendance_request: 'lib_time_att.onDecision',
    shift_request: 'lib_time_shift.onDecision',
    timesheet: 'lib_time_sheet.onDecision',
    overtime: 'lib_time_ot.onDecision',
  },
  profileFacts: 'lib_time.profileFacts',
};
