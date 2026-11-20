// SCRATCH ONLY (hiring tests). Never copied into APP.
function cron(ctx, p) {
  const h = require(`${__hooks}/lib_hiring.js`);
  if (p.which === 'retention') return h.cronRetention(ctx.app);
  return h.cronMessages(ctx.app);
}
function backdate(ctx, p) {
  const c = ctx.app.findRecordById('candidates', p.candidate);
  c.set('retain_until', p.retain_until);
  c.set('retention_flagged', '');
  ctx.app.save(c);
  return { ok: true };
}
function facts(ctx, p) {
  const m = require(`${__hooks}/lib_people.js`).employmentRef(ctx.app, p.employment);
  return { facts: require(`${__hooks}/lib_hiring.js`).profileFacts(ctx, m.id), all: require(`${__hooks}/lib_events.js`).profileFacts(ctx, m.id) };
}
module.exports = { cron: cron, backdate: backdate, facts: facts };
