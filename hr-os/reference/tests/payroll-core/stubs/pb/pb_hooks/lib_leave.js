/* SCRATCH ONLY stub of the leave module's contract (SPEC 3.5); never shipped. */
function S() {
  return require(`${__hooks}/_stub_common.js`);
}
function payInputs(app, employmentId, from, to) {
  const d = (S().data().leave || {})[employmentId] || {};
  const done = {};
  for (const c of S().calls()) if (c.fn === 'lib_leave.markEncashPaid') for (const id of c.args[0]) done[id] = true;
  return { unpaid_days: d.unpaid_days || 0, unpaid_hours: d.unpaid_hours || 0, paid_days: d.paid_days || {}, encash: (d.encash || []).filter((x) => !done[x.request]), issues: d.issues || [] };
}
function balance(app, employmentId, typeCode, day) {
  return { type: typeCode, unit: 'day', balance: 0, taken: 0, pending: 0, granted: 0, expiring: [] };
}
function markEncashPaid(app, requestIds, payrunId) {
  S().record('lib_leave.markEncashPaid', [requestIds, payrunId]);
}
module.exports = { payInputs: payInputs, balance: balance, markEncashPaid: markEncashPaid };
