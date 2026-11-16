/* SCRATCH ONLY stub of the expenses module's contract (as expenses shipped it); never shipped. Used only while APP has no lib_expenses.js. */
function S() {
  return require(`${__hooks}/_stub_common.js`);
}
function marked() {
  const out = {};
  for (const c of S().calls()) if (c.fn === 'lib_expenses.markPaid') for (const x of c.args[0]) out[typeof x === 'string' ? x : x.advance] = c.args[1];
  for (const c of S().calls()) if (c.fn === 'lib_expenses.unmarkPaid') for (const k of Object.keys(out)) if (out[k] === c.args[0]) delete out[k];
  return out;
}
function payInputs(app, employmentId, upToDay, currency, opts) {
  const done = marked();
  return ((S().data().expenses || {})[employmentId] || []).filter((x) => !done[x.ref]);
}
function advanceRecovery(app, employmentId, upToDay) {
  const done = marked();
  return ((S().data().advances || {})[employmentId] || []).filter((x) => !done[x.advance]);
}
function markPaid(app, refs, payrunId) {
  S().record('lib_expenses.markPaid', [refs, payrunId]);
  return { claims: 0, advances_paid: 0, recovered: 0, skipped: [] };
}
function unmarkPaid(app, payrunId) {
  S().record('lib_expenses.unmarkPaid', [payrunId]);
  return { claims: 0, advances: 0, recoveries: 0, skipped: [] };
}
function outstanding(app, employmentId) {
  return { approved_unpaid_minor: 0, open_claims: 0, advance_balance_minor: 0, advances_unpaid: 0 };
}
module.exports = { payInputs: payInputs, advanceRecovery: advanceRecovery, markPaid: markPaid, unmarkPaid: unmarkPaid, outstanding: outstanding };
