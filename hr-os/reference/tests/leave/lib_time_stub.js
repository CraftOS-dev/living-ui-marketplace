/// <reference path="../pb_data/types.d.ts" />
/**
 * SCRATCH STUB (leave builder's copy only, never shipped): the time module's
 * contract lib_time.payInputs, so per-hours-worked accrual can be tested
 * before the time module lands. Worked minutes = the scheduled minutes of
 * each working day (lib_calendar.expectedMinutes).
 */
function payInputs(app, employmentId, from, to) {
  const u = require(`${__hooks}/lib_util.js`);
  const cal = require(`${__hooks}/lib_calendar.js`);
  let worked = 0;
  for (let d = from; d <= to; d = u.dayAdd(d, 1)) worked += cal.expectedMinutes(app, employmentId, d);
  return { worked_minutes: worked, regular_minutes: worked, overtime: [], absent_days: 0, late_minutes: 0, night_minutes: 0, holiday_worked_minutes: 0, issues: [] };
}

module.exports = { payInputs: payInputs };
