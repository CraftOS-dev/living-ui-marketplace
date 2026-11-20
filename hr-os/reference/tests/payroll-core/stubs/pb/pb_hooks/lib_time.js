/* SCRATCH ONLY stub of the time module's contract (SPEC 3.5); never shipped. */
function S() {
  return require(`${__hooks}/_stub_common.js`);
}
function payInputs(app, employmentId, from, to) {
  const d = (S().data().time || {})[employmentId] || {};
  return { worked_minutes: d.worked_minutes || 0, regular_minutes: d.regular_minutes || 0, overtime: d.overtime || [], absent_days: d.absent_days || 0, late_minutes: d.late_minutes || 0, night_minutes: d.night_minutes || 0, holiday_worked_minutes: d.holiday_worked_minutes || 0, issues: d.issues || [] };
}
function lockDays(app, employmentId, from, to, payrunId) {
  S().record('lib_time.lockDays', [employmentId, from, to, payrunId]);
  return { locked: 0 };
}
function unlockDays(app, payrunId) {
  S().record('lib_time.unlockDays', [payrunId]);
  return { unlocked: 0 };
}
module.exports = { payInputs: payInputs, lockDays: lockDays, unlockDays: unlockDays };
