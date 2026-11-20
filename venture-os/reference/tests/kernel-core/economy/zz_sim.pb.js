/// <reference path="../pb_data/types.d.ts" />
/**
 * SCRATCH ONLY (e01_trigger_economy.mjs copies it into a scratch copy's
 * pb_hooks and removes it after): drives time for the trigger economy
 * test. Never shipped. Every call needs the header x-sim-token with the
 * scratch copy's .agent-token.
 *
 *   POST /__sim/day        { start, minutes, skip }        every cron entry for each minute, as if the clock read it
 *   POST /__sim/run        { fns }                         these cron functions once (a weekly or yearly schedule)
 *   POST /__sim/age        { collection, id, trigger, hours }  the record's ask of that trigger was made that many hours ago
 *   POST /__sim/cooldowns  {}                              forget the platform cooldowns of every trigger (the simulated hours passed)
 *   POST /__sim/radars_due {}                              every active radar is due now
 *   POST /__sim/scan       { file }                        the file's pages need OCR (a scanned file)
 *   POST /__sim/requests   { since }                       the platform's request rows since a time (trigger, params, status)
 *   POST /__sim/finish     { request, status, result }     the platform's row moves as your AI agent would (claimed, done or rejected)
 *   POST /__sim/ids        { collection, filter, sort, limit, field }  record ids (or one field's values) to try
 *   POST /__sim/set        { collection, id, fields }      a state the seed does not leave (a frozen quarter, a previewed notice)
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
  const E = require(`${__hooks}/lib_events.js`);
  if (action === 'day') {
    const start = Number(body.start || Date.now());
    const minutes = Number(body.minutes || 60);
    const skip = Array.isArray(body.skip) ? body.skip.map(String) : [];
    const u = require(`${__hooks}/lib_util.js`);
    const jobs = E.cronJobs ? E.cronJobs() : [];
    let ran = 0;
    const failed = [];
    for (let m = 0; m < minutes; m++) {
      const ms = start + m * 60000;
      const local = new Date(ms + u.tzOffset(u.zoneOf(app), ms) * 60000);
      for (const j of jobs) {
        if (skip.indexOf(j.name) >= 0 || !u.cronHit(u.cronParse(j.schedule), local)) continue;
        try {
          E.resolve(j.fn)(app);
          ran++;
        } catch (err) {
          failed.push(j.name + ': ' + String((err && err.message) || err).slice(0, 160));
        }
      }
    }
    return e.json(200, { ran: ran, failed: failed.slice(0, 20) });
  }
  if (action === 'run') {
    const out = [];
    for (const fn of body.fns || []) {
      try {
        E.resolve(String(fn))(app);
        out.push({ fn: fn, ok: true });
      } catch (err) {
        out.push({ fn: fn, ok: false, error: String((err && err.message) || err) });
      }
    }
    return e.json(200, { out: out });
  }
  if (action === 'age') {
    const coll = String(body.collection || 'settings');
    const rec = coll === 'settings' ? app.findRecordsByFilter('settings', '1=1', 'created', 1, 0)[0] : app.findRecordById(coll, String(body.id || ''));
    const m = require(`${__hooks}/lib_util.js`).jsonOf(rec, 'agent', {}) || {};
    const t = String(body.trigger || '');
    if (!m[t]) return e.json(404, { error: 'no ask of ' + t + ' on that record' });
    m[t].at = new Date(Date.now() - Number(body.hours || 0) * 3600000).toISOString();
    app.db().newQuery('UPDATE ' + coll + ' SET agent = {:a} WHERE id = {:id}').bind({ a: JSON.stringify(m), id: rec.id }).execute();
    return e.json(200, { ok: true, at: m[t].at });
  }
  if (action === 'cooldowns') {
    for (const t of Object.keys(require(`${__hooks}/lib_events.js`).triggers())) app.store().remove('trig_rate:' + t);
    return e.json(200, { ok: true });
  }
  if (action === 'radars_due') {
    app.db().newQuery("UPDATE radars SET next_run_at = '2000-01-01T00:00:00.000Z', last_run_at = '' WHERE status = 'active'").execute();
    return e.json(200, { ok: true });
  }
  if (action === 'scan') {
    const f = String(body.file || '');
    app.db().newQuery('UPDATE pages SET needs_ocr = TRUE WHERE file = {:f}').bind({ f: f }).execute();
    app.db().newQuery("UPDATE file_texts SET state = 'needs_ocr' WHERE file = {:f}").bind({ f: f }).execute();
    return e.json(200, { ok: true });
  }
  if (action === 'requests') {
    const since = String(body.since || '2000-01-01 00:00:00');
    const rows = app.findRecordsByFilter('agent_requests', 'created >= {:s}', 'created', 500, 0, { s: since });
    return e.json(200, { requests: rows.map((r) => ({ id: r.id, trigger: r.getString('trigger'), params: r.get('params'), status: r.getString('status'), created: r.getString('created') })) });
  }
  if (action === 'ids') {
    const rows = app.findRecordsByFilter(String(body.collection || ''), String(body.filter || '1=1'), String(body.sort || '-created'), Number(body.limit || 10), 0);
    const field = String(body.field || '');
    const out = rows.map((r) => (field ? r.getString(field) : r.id)).filter((x, i, a) => x !== '' && a.indexOf(x) === i);
    return e.json(200, { ids: out });
  }
  if (action === 'set') {
    const r = app.findRecordById(String(body.collection || ''), String(body.id || ''));
    for (const k of Object.keys(body.fields || {})) r.set(k, body.fields[k]);
    app.saveNoValidate(r);
    return e.json(200, { ok: true });
  }
  if (action === 'finish') {
    const r = app.findRecordById('agent_requests', String(body.request || ''));
    const to = String(body.status || 'done');
    if (to !== 'claimed' && r.getString('status') === 'pending') r.set('status', 'claimed');
    app.saveNoValidate(r);
    r.set('status', to);
    if (to === 'done') r.set('result', String(body.result || 'Done'));
    if (to === 'rejected') r.set('error', String(body.result || 'Could not'));
    app.saveNoValidate(r);
    return e.json(200, { ok: true, status: r.getString('status') });
  }
  return e.json(404, { error: 'unknown action' });
});
