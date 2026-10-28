/// <reference path="../pb_data/types.d.ts" />
/**
 * Operations: alerts (server-evaluated) and the AI agent's analyses.
 */

/* ------------------------------------------------------------------ alerts */

routerAdd('GET', '/api/ops/alerts/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const a = require(`${__hooks}/lib_alerts.js`);
    const parts = [];
    const prm = {};
    const status = u.oneOf(p, 'status', ['active', 'paused', 'triggered', 'expired', 'any'], 'any');
    if (status !== 'any') {
      parts.push('status = {:st}');
      prm.st = status;
    }
    if (u.has(p, 'symbol')) {
      parts.push('symbol = {:s}');
      prm.s = require(`${__hooks}/lib_market.js`).normalize(u.str(p, 'symbol', ''));
    }
    const rows = app.findRecordsByFilter('alerts', parts.join(' && ') || 'id != ""', '-created', u.int(p, 'limit', 200, 1, 500), 0, prm);
    const unseen = app.findRecordsByFilter('alert_events', 'seen = false', '', 0, 0).length;
    return { alerts: rows.map(a.serialize), unseen_events: unseen };
  }),
);

routerAdd('POST', '/api/ops/alerts/create', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const a = require(`${__hooks}/lib_alerts.js`);
    const m = require(`${__hooks}/lib_market.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const who = u.actor(e);
    const sym = m.meta(app, u.req(p, 'symbol')).symbol;
    const iv = m.interval(u.str(p, 'interval', ''), '1D');
    const q = a.readParams(u, p);
    q.symbol = sym;
    if (!q.op) q.op = 'crosses';
    const cond = a.build(app, q);
    const rec = new Record(app.findCollectionByNameOrId('alerts'));
    rec.set('symbol', sym);
    rec.set('interval', iv);
    rec.set('condition', cond);
    rec.set('frequency', u.oneOf(p, 'frequency', a.FREQUENCIES, 'once'));
    const exp = u.str(p, 'expires', '');
    if (exp !== '') {
      const t = Date.parse(exp);
      if (!isFinite(t)) throw u.fail(400, 'expires must be a date like 2026-12-31 or 2026-12-31T16:00:00Z');
      rec.set('expires', new Date(t).toISOString());
    }
    rec.set('status', 'active');
    rec.set('message', u.text(p, 'message', '').slice(0, 500));
    rec.set('notify_agent', u.bool(p, 'notify_agent', false));
    rec.set('added_by', who.actor);
    rec.set('run', who.run);
    rec.set('fired_count', 0);
    app.save(rec);
    let fired = null;
    try {
      fired = a.prime(app, rec);
    } catch (err) {
      rec.set('error', String((err && err.message) || err).slice(0, 500));
      app.save(rec);
    }
    const out = a.serialize(rec);
    act.record(app, { who: who, op: 'alerts.create', summary: 'Alert: ' + out.text, type: 'alert', id: rec.id, symbol: sym, undo: [{ do: 'delete', c: 'alerts', id: rec.id }] });
    return { alert: out, fired_now: !!fired };
  }),
);

routerAdd('POST', '/api/ops/alerts/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const a = require(`${__hooks}/lib_alerts.js`);
    const m = require(`${__hooks}/lib_market.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const rec = a.mustGet(app, u.req(p, 'alert'));
    const before = act.pick(rec, ['interval', 'condition', 'frequency', 'expires', 'status', 'message', 'notify_agent', 'last_value', 'last_checked', 'error']);
    const q = a.readParams(u, p);
    let primeAgain = false;
    if (Object.keys(q).length > 0) {
      const old = u.json(rec, 'condition', {}) || {};
      // Fill what was not given from the current condition.
      if (!q.op) q.op = old.op;
      const L = old.left || { type: 'price' };
      const R = old.right || {};
      if (!q.indicator && !q.watch && L.type === 'indicator') {
        q.indicator = L.id;
        if (!q.params) q.params = L.params;
        if (!q.output) q.output = L.output;
      }
      if (!q.watch && L.type === 'change' && !q.indicator) q.watch = 'change';
      if (q.value === undefined && !q.against && !q.drawing) {
        if (R.type === 'value') q.value = R.value;
        if (R.type === 'indicator') {
          q.against = R.id;
          q.against_params = R.params;
          q.against_output = R.output;
        }
        if (R.type === 'drawing') q.drawing = R.id;
      }
      q.symbol = rec.getString('symbol');
      rec.set('condition', a.build(app, q));
      primeAgain = true;
    }
    if (u.has(p, 'interval')) {
      rec.set('interval', m.interval(u.str(p, 'interval', '')));
      primeAgain = true;
    }
    if (u.has(p, 'frequency')) rec.set('frequency', u.oneOf(p, 'frequency', a.FREQUENCIES, 'once'));
    if (u.has(p, 'expires')) {
      const exp = u.str(p, 'expires', '');
      if (exp === '') rec.set('expires', '');
      else {
        const t = Date.parse(exp);
        if (!isFinite(t)) throw u.fail(400, 'expires must be a date like 2026-12-31');
        rec.set('expires', new Date(t).toISOString());
      }
    }
    if (u.has(p, 'message')) rec.set('message', u.text(p, 'message', '').slice(0, 500));
    if (u.has(p, 'notify_agent')) rec.set('notify_agent', u.bool(p, 'notify_agent', false));
    if (u.has(p, 'status')) {
      const st = u.oneOf(p, 'status', ['active', 'paused'], 'active');
      if (st === 'active' && rec.getString('status') !== 'active') primeAgain = true;
      rec.set('status', st);
    }
    app.save(rec);
    if (primeAgain && rec.getString('status') === 'active') {
      try {
        a.prime(app, rec);
      } catch (err) {
        rec.set('error', String((err && err.message) || err).slice(0, 500));
        app.save(rec);
      }
    }
    const out = a.serialize(rec);
    act.record(app, { who: u.actor(e), op: 'alerts.update', summary: 'Edited the alert: ' + out.text + ' (' + out.status + ')', type: 'alert', id: rec.id, symbol: out.symbol, undo: [{ do: 'restore', c: 'alerts', id: rec.id, fields: before }], merge: true });
    return { alert: out };
  }),
);

routerAdd('POST', '/api/ops/alerts/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const a = require(`${__hooks}/lib_alerts.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const rec = a.mustGet(app, u.req(p, 'alert'));
    const text = a.serialize(rec).text;
    const undo = [{ do: 'recreate', c: 'alerts', data: act.snapshot(rec) }];
    for (const ev of app.findRecordsByFilter('alert_events', 'alert = {:a}', 'created', 200, 0, { a: rec.id })) undo.push({ do: 'recreate', c: 'alert_events', data: act.snapshot(ev) });
    app.delete(rec);
    act.record(app, { who: u.actor(e), op: 'alerts.delete', summary: 'Deleted the alert: ' + text, type: 'alert', id: rec.id, symbol: rec.getString('symbol'), undo: undo });
    return { deleted: true };
  }),
);

routerAdd('GET', '/api/ops/alerts/events', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const a = require(`${__hooks}/lib_alerts.js`);
    const parts = [];
    const prm = {};
    if (u.has(p, 'alert')) {
      parts.push('alert = {:a}');
      prm.a = u.str(p, 'alert', '');
    }
    if (u.has(p, 'symbol')) {
      parts.push('symbol = {:s}');
      prm.s = require(`${__hooks}/lib_market.js`).normalize(u.str(p, 'symbol', ''));
    }
    if (u.bool(p, 'unseen', false)) parts.push('seen = false');
    const agent = u.oneOf(p, 'agent', ['waiting', 'working', 'done', 'failed'], '');
    if (agent !== '') {
      parts.push('agent_state = {:ag}');
      prm.ag = agent;
    }
    const rows = app.findRecordsByFilter('alert_events', parts.join(' && ') || 'id != ""', '-created', u.int(p, 'limit', 100, 1, 500), 0, prm);
    return { events: rows.map(a.serializeEvent) };
  }),
);

routerAdd('POST', '/api/ops/alerts/seen', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ids = u.list(p, 'events', true) || [];
    const rows = ids.length > 0 ? ids.map((id) => u.byId(app, 'alert_events', String(id))).filter((r) => r) : app.findRecordsByFilter('alert_events', 'seen = false', '', 0, 0);
    for (const r of rows) {
      if (r.getBool('seen')) continue;
      r.set('seen', true);
      app.save(r);
    }
    return { seen: rows.length };
  }),
);

routerAdd('POST', '/api/ops/alerts/check', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_alerts.js`).checkAll(app)));

/** The AI agent's note on a fired alert (trigger alert_fired). */
routerAdd('POST', '/api/ops/alerts/respond', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const a = require(`${__hooks}/lib_alerts.js`);
    const ev = u.byId(app, 'alert_events', u.req(p, 'event'));
    if (!ev) throw u.fail(404, 'No alert event ' + u.str(p, 'event', '') + '; see alerts.events --agent waiting');
    const failed = u.has(p, 'reason');
    const note = failed ? u.text(p, 'reason', '') : u.text(p, 'note', '');
    if (note === '') throw u.fail(400, 'note is required: what happened, the context and what to watch (2 to 5 sentences); or give reason when you could not look into it');
    ev.set('agent_state', failed ? 'failed' : 'done');
    ev.set('agent_note', note.slice(0, 4000));
    ev.set('agent_at', new Date().toISOString());
    app.save(ev);
    return { event: a.serializeEvent(ev) };
  }),
);

/* ---------------------------------------------------------------- analyses */

routerAdd('POST', '/api/ops/analyses/request', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const m = require(`${__hooks}/lib_market.js`);
    const ag = require(`${__hooks}/lib_agent.js`);
    const who = u.actor(e);
    const focus = u.text(p, 'focus', '').slice(0, 1000);
    if (u.has(p, 'watchlist')) {
      const list = require(`${__hooks}/lib_watch.js`).mustList(app, u.str(p, 'watchlist', ''));
      return ag.requestAnalysis(app, { watchlist: list.id, focus: focus, actor: who.actor });
    }
    const sym = m.meta(app, u.req(p, 'symbol')).symbol;
    return ag.requestAnalysis(app, { symbol: sym, interval: m.interval(u.str(p, 'interval', ''), '1D'), focus: focus, actor: who.actor });
  }),
);

routerAdd('GET', '/api/ops/analyses/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ag = require(`${__hooks}/lib_agent.js`);
    const parts = [];
    const prm = {};
    const state = u.oneOf(p, 'state', ['waiting', 'working', 'done', 'failed', 'any'], 'any');
    if (state !== 'any') {
      parts.push('state = {:st}');
      prm.st = state;
    }
    if (u.has(p, 'symbol')) {
      parts.push('symbol = {:s}');
      prm.s = require(`${__hooks}/lib_market.js`).normalize(u.str(p, 'symbol', ''));
    }
    if (u.has(p, 'watchlist')) {
      parts.push('watchlist = {:w}');
      prm.w = u.str(p, 'watchlist', '');
    }
    const rows = app.findRecordsByFilter('analyses', parts.join(' && ') || 'id != ""', state === 'waiting' ? 'requested_at' : '-requested_at', u.int(p, 'limit', 50, 1, 200), 0, prm);
    return { analyses: rows.map(ag.serializeAnalysis) };
  }),
);

routerAdd('GET', '/api/ops/analyses/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ag = require(`${__hooks}/lib_agent.js`);
    return { analysis: ag.serializeAnalysis(ag.mustAnalysis(app, u.req(p, 'analysis'))) };
  }),
);

routerAdd('POST', '/api/ops/analyses/start', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ag = require(`${__hooks}/lib_agent.js`);
    const rec = ag.mustAnalysis(app, u.req(p, 'analysis'));
    ag.start(app, 'analysis', rec);
    rec.set('run', u.actor(e).run);
    app.save(rec);
    const out = { analysis: ag.serializeAnalysis(rec) };
    if (rec.getString('kind') === 'watchlist') out.watchlist = require(`${__hooks}/lib_watch.js`).full(app, require(`${__hooks}/lib_watch.js`).mustList(app, rec.getString('watchlist')), true);
    return out;
  }),
);

routerAdd('POST', '/api/ops/analyses/complete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ag = require(`${__hooks}/lib_agent.js`);
    const rec = ag.mustAnalysis(app, u.req(p, 'analysis'));
    const st = rec.getString('state');
    if (st === 'done' && !u.bool(p, 'replace', false)) throw u.fail(409, 'This analysis is already done; pass replace=true to rewrite it');
    const summary = u.text(p, 'summary', '');
    if (summary === '') throw u.fail(400, 'summary is required');
    rec.set('summary', summary.slice(0, 20000));
    rec.set('bias', u.oneOf(p, 'bias', ['bullish', 'bearish', 'neutral', 'mixed'], 'neutral'));
    const levels = u.list(p, 'levels', false) || [];
    const clean = [];
    for (const l of levels.slice(0, 20)) {
      const price = Number(l && l.price);
      if (!isFinite(price)) throw u.fail(400, 'levels must be like [{"price":182.5,"kind":"support","label":"50-day average"}]');
      const kind = ['support', 'resistance', 'target', 'stop', 'entry', 'pivot'].indexOf(l.kind) >= 0 ? l.kind : 'pivot';
      clean.push({ price: price, kind: kind, label: String(l.label || '').slice(0, 80) });
    }
    rec.set('levels', clean);
    if (rec.getString('kind') !== 'watchlist' && rec.getString('symbol') !== '') {
      try {
        const ch = require(`${__hooks}/lib_chart.js`);
        rec.set('facts', ch.snapshot(ch.explain(app, rec.getString('symbol'), rec.getString('interval') || '1D', { news: false })));
      } catch (err) {
        console.warn('[trading-view] analysis facts failed:', err);
      }
    }
    rec.set('state', 'done');
    rec.set('error', '');
    if (rec.getString('run') === '') rec.set('run', u.actor(e).run);
    app.save(rec);
    const act = require(`${__hooks}/lib_activity.js`);
    act.record(app, { who: u.actor(e), op: 'analyses.complete', summary: 'Wrote an analysis of ' + (rec.getString('symbol') || 'a watchlist') + ' (' + rec.getString('bias') + ')', type: 'analysis', id: rec.id, symbol: rec.getString('symbol') });
    return { analysis: ag.serializeAnalysis(rec) };
  }),
);

routerAdd('POST', '/api/ops/analyses/fail', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ag = require(`${__hooks}/lib_agent.js`);
    const rec = ag.mustAnalysis(app, u.req(p, 'analysis'));
    const reason = u.text(p, 'reason', '');
    if (reason === '') throw u.fail(400, 'reason is required: what went wrong and what the person can do');
    if (rec.getString('state') === 'done') throw u.fail(409, 'This analysis is already done');
    rec.set('state', 'failed');
    rec.set('error', reason.slice(0, 1000));
    app.save(rec);
    return { analysis: ag.serializeAnalysis(rec) };
  }),
);

routerAdd('POST', '/api/ops/analyses/cancel', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ag = require(`${__hooks}/lib_agent.js`);
    const rec = ag.mustAnalysis(app, u.req(p, 'analysis'));
    if (rec.getString('state') !== 'waiting') throw u.fail(409, 'Only a waiting request can be cancelled');
    app.delete(rec);
    return { cancelled: true };
  }),
);

routerAdd('POST', '/api/ops/analyses/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ag = require(`${__hooks}/lib_agent.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const rec = ag.mustAnalysis(app, u.req(p, 'analysis'));
    if (rec.getString('state') === 'working') throw u.fail(409, 'Your AI agent is working on this analysis');
    const snap = act.snapshot(rec);
    app.delete(rec);
    act.record(app, { who: u.actor(e), op: 'analyses.delete', summary: 'Deleted an analysis of ' + (snap.symbol || 'a watchlist'), type: 'analysis', id: rec.id, symbol: snap.symbol, undo: [{ do: 'recreate', c: 'analyses', data: snap }] });
    return { deleted: true };
  }),
);
