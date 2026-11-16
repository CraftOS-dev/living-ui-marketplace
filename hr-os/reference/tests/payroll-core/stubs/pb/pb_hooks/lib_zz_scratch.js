/* SCRATCH ONLY (payroll-core tests): never shipped. */
function markPaid(ctx, p) {
  const runs = require(`${__hooks}/lib_payroll_runs.js`);
  return { payrun: runs.markPaid(ctx, runs.runRef(ctx.app, p.payrun).id, { paid_at: p.paid_at || '' }) };
}
function payout(ctx, p) {
  const runs = require(`${__hooks}/lib_payroll_runs.js`);
  return { items: runs.payoutItems(ctx.app, runs.runRef(ctx.app, p.payrun).id) };
}
function timing(ctx, p) {
  const app = ctx.app;
  const runs = require(`${__hooks}/lib_payroll_runs.js`);
  const calc = require(`${__hooks}/lib_payroll_calc.js`);
  const run = runs.runRef(app, p.payrun);
  const rc = calc.runContext(app, run);
  const ids = runs.employmentsOf(app, run).slice(0, 10);
  const t = { time: 0, leave: 0, expenses: 0, build: 0, engine: 0, n: ids.length };
  for (const id of ids) {
    let s = Date.now(); require(`${__hooks}/lib_time.js`).payInputs(app, id, run.getString('period_start'), run.getString('period_end')); t.time += Date.now() - s;
    s = Date.now(); require(`${__hooks}/lib_leave.js`).payInputs(app, id, run.getString('period_start'), run.getString('period_end')); t.leave += Date.now() - s;
    s = Date.now(); require(`${__hooks}/lib_expenses.js`).payInputs(app, id, run.getString('period_end'), rc.currency); t.expenses += Date.now() - s;
    s = Date.now(); const b = calc.buildInput(app, rc, id, 'run'); t.build += Date.now() - s;
    s = Date.now(); require(`${__hooks}/lib_engine.js`).calculate(b.input, b.packs); t.engine += Date.now() - s;
  }
  return t;
}
module.exports = { markPaid: markPaid, payout: payout, timing: timing };
