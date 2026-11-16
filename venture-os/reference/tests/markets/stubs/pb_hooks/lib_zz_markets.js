/// <reference path="../pb_data/types.d.ts" />
/** SCRATCH STUB (markets builder only, never shipped): the markets contract and cron entry points as ops for the tests. */
function candidates(ctx, p) {
  return { signals: require(`${__hooks}/lib_markets.js`).candidatesFor(ctx, p.thesis) };
}
function cronRadars(ctx) {
  require(`${__hooks}/lib_markets.js`).cronRadars(ctx.app);
  return { ok: true };
}
function cronMaps(ctx) {
  require(`${__hooks}/lib_markets_maps.js`).cronMaps(ctx.app);
  return { ok: true };
}
function setDue(ctx, p) {
  const r = ctx.app.findRecordById('radars', p.radar);
  r.set('next_run_at', new Date(Date.now() - 60000).toISOString());
  ctx.app.save(r);
  return { ok: true };
}
function prefetch(ctx) {
  require(`${__hooks}/lib_markets.js`).cronPrefetch(ctx.app);
  const u = require(`${__hooks}/lib_util.js`);
  return { pending: u.count(ctx.app, 'SELECT COUNT(*) AS n FROM signals WHERE run = 0', {}) };
}
module.exports = { prefetch: prefetch, candidates: candidates, cronRadars: cronRadars, cronMaps: cronMaps, setDue: setDue };
