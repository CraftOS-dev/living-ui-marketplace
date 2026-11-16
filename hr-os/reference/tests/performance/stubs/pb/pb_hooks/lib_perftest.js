/// <reference path="../pb_data/types.d.ts" />
// SCRATCH ONLY (performance tests). Never shipped.
function cron(ctx) {
  return { sent: require(`${__hooks}/lib_performance.js`).cronReminders(ctx.app), ran: require(`${__hooks}/lib_events.js`).runDue(ctx.app, Date.UTC(2026, 10, 4, 1, 5)) };
}
function remind(ctx, p) {
  const sys = require(`${__hooks}/lib_auth.js`).systemCtx(ctx.app);
  const reviews = require(`${__hooks}/lib_performance_reviews.js`).remindDue(sys, true);
  const training = p.training ? require(`${__hooks}/lib_performance_training.js`).remindDue(sys, true) : 0;
  return { reviews: reviews, training: training };
}
module.exports = { cron: cron, remind: remind };
