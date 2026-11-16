/// <reference path="../pb_data/types.d.ts" />
/**
 * SCRATCH ONLY (e01_trigger_economy.mjs copies it into a scratch copy's
 * pb_hooks and removes it after; never shipped). Drives time for the
 * trigger economy test. Every call needs the header x-sim-token with the
 * scratch copy's .agent-token.
 *
 *   POST /__sim/day        { start, minutes, skip }  each simulated minute: Date.now reads that minute, the
 *                                                    kernel minute work (lib_agent.sendDeferred) and every
 *                                                    module cron job whose schedule matches run
 *   POST /__sim/age        { collection, id, trigger, hours }  the ask was made that many hours ago
 *   POST /__sim/cooldowns  { triggers }              forget the platform cooldowns (the simulated time passed)
 *   POST /__sim/missed     { entity, day }           one attendance day of the entity gets a missed punch flag
 */
routerAdd('POST', '/__sim/{action}', (e) => {
  let want = '';
  try {
    want = toString($os.readFile($filepath.join(__hooks, '..', '..', '.agent-token'))).trim();
  } catch {
    want = '';
  }
  if (want === '' || String(e.request.header.get('x-sim-token') || '') !== want) return e.json(403, { error: 'scratch simulation only' });
  const action = e.request.pathValue('action');
  const body = e.requestInfo().body || {};
  const app = e.app;
  if (action === 'day') {
    const E = require(`${__hooks}/lib_events.js`);
    const u = require(`${__hooks}/lib_util.js`);
    const agent = require(`${__hooks}/lib_agent.js`);
    const start = Number(body.start || Date.now());
    const minutes = Number(body.minutes || 60);
    const skip = Array.isArray(body.skip) ? body.skip.map(String) : [];
    const jobs = E.cronJobs();
    const realNow = Date.now;
    let ran = 0;
    const failed = [];
    try {
      for (let m = 0; m < minutes; m++) {
        const ms = start + m * 60000;
        Date.now = () => ms;
        try {
          agent.sendDeferred(app);
        } catch (err) {
          failed.push('sendDeferred: ' + String((err && err.message) || err).slice(0, 160));
        }
        for (const j of jobs) {
          if (skip.indexOf(j.name) >= 0 || !u.cronMatch(j.schedule, ms)) continue;
          try {
            const k = j.fn.lastIndexOf('.');
            require(`${__hooks}/${j.fn.slice(0, k)}.js`)[j.fn.slice(k + 1)](app);
            ran++;
          } catch (err) {
            failed.push(j.name + ': ' + String((err && err.message) || err).slice(0, 160));
          }
        }
      }
    } finally {
      Date.now = realNow;
    }
    return e.json(200, { ran: ran, failed: failed.slice(0, 20) });
  }
  if (action === 'age') {
    const rec = app.findRecordById(String(body.collection), String(body.id));
    const asks = require(`${__hooks}/lib_util.js`).jsonOf(rec, 'agent_asks', {}) || {};
    const a = asks[String(body.trigger)];
    if (!a) return e.json(404, { error: 'no ask' });
    a.asked_at = new Date(Date.now() - Number(body.hours || 0) * 3600000).toISOString();
    rec.set('agent_asks', asks);
    app.save(rec);
    return e.json(200, { ok: true, asked_at: a.asked_at });
  }
  if (action === 'cooldowns') {
    for (const t of body.triggers || []) app.store().remove('trig_rate:' + String(t));
    return e.json(200, { ok: true });
  }
  if (action === 'missed') {
    const m = app.findRecordsByFilter('employments', 'entity = {:e}', 'created', 1, 0, { e: String(body.entity) });
    if (m.length === 0) return e.json(404, { error: 'no employment' });
    const rows = app.findRecordsByFilter('attendance', 'employment = {:m} && day = {:d}', '', 1, 0, { m: m[0].id, d: String(body.day) });
    let r = rows.length > 0 ? rows[0] : null;
    if (r === null) {
      r = new Record(app.findCollectionByNameOrId('attendance'));
      r.set('employment', m[0].id);
      r.set('day', String(body.day));
      r.set('status', 'present');
      r.set('source', 'manual');
    }
    r.set('flags', ['missed_out']);
    try {
      app.save(r);
    } catch (err) {
      return e.json(400, { error: String(err) });
    }
    return e.json(200, { ok: true, id: r.id });
  }
  return e.json(404, { error: 'unknown action' });
});
