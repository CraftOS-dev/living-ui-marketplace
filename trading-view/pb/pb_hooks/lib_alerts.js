/// <reference path="../pb_data/types.d.ts" />
/**
 * Alerts, evaluated by the server so they work with the window closed.
 *
 * A condition compares a left side with a right side:
 *   { left: Side, op, right: Side }
 *   Side  { type: 'price' }                      last price
 *         { type: 'change' }                     today's change, %
 *         { type: 'value', value }               a number
 *         { type: 'indicator', id, params, output }
 *         { type: 'drawing', id }                a trend or horizontal line
 *   op    crosses | crosses_up | crosses_down | above | below
 *
 * Crossings compare with the previous check (stored as last_value, the
 * left-minus-right difference), so a cross inside a bar is caught. Every
 * minute a cron checks all active alerts; while the app is open, price
 * alerts are also checked with every quote refresh (a few seconds).
 */

const OPS = ['crosses', 'crosses_up', 'crosses_down', 'above', 'below'];
const FREQUENCIES = ['once', 'once_per_bar', 'every'];
const OP_TEXT = { crosses: 'crosses', crosses_up: 'crosses above', crosses_down: 'crosses below', above: 'is above', below: 'is below' };

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** The condition params of alerts.create / alerts.update that were given. */
function readParams(u, p) {
  const out = {};
  for (const k of ['op', 'indicator', 'output', 'against', 'against_output', 'drawing', 'watch']) if (u.has(p, k)) out[k] = u.str(p, k, '');
  if (u.has(p, 'value')) out.value = u.str(p, 'value', '');
  if (u.has(p, 'params')) out.params = u.obj(p, 'params');
  if (u.has(p, 'against_params')) out.against_params = u.obj(p, 'against_params');
  return out;
}

/** Build and validate a condition from op params (see alerts.create). */
function build(app, p) {
  const ta = require(`${__hooks}/lib_ta.js`);
  const op = p.op;
  if (OPS.indexOf(op) < 0) throw fail(400, 'op must be one of: ' + OPS.join(', '));
  const side = (id, prm, output) => {
    const def = ta.find(id);
    if (!def) throw fail(400, 'Unknown indicator "' + id + '"; one of: ' + ta.CATALOGUE.map((d) => d.id).join(', '));
    const out = output || def.outputs[0].key;
    if (!def.outputs.some((x) => x.key === out)) throw fail(400, def.short + ' outputs: ' + def.outputs.map((x) => x.key).join(', '));
    return { type: 'indicator', id: id, params: ta.params(id, prm || {}), output: out };
  };
  let left = { type: 'price' };
  if (p.indicator) left = side(p.indicator, p.params, p.output);
  else if (p.watch === 'change') left = { type: 'change' };
  let right = null;
  if (p.drawing) {
    const d = require(`${__hooks}/lib_drawings.js`).mustGet(app, p.drawing);
    const tool = d.getString('tool');
    if (['trend', 'ray', 'extended', 'hline', 'hray'].indexOf(tool) < 0) throw fail(400, 'Alerts work on trend lines, rays and horizontal lines, not a ' + tool);
    if (d.getString('symbol') !== p.symbol) throw fail(400, 'That drawing is on ' + d.getString('symbol') + ', not ' + p.symbol);
    right = { type: 'drawing', id: d.id };
  } else if (p.against) right = side(p.against, p.against_params, p.against_output);
  else if (p.value !== undefined && p.value !== null && p.value !== '') {
    const v = Number(p.value);
    if (!isFinite(v)) throw fail(400, 'value must be a number');
    right = { type: 'value', value: v };
  }
  if (!right) throw fail(400, 'Give what to compare with: --value <number>, --against <indicator id, e.g. sma> or --drawing <drawing id>');
  if (left.type === 'change' && right.type !== 'value') throw fail(400, 'A change alert compares with a --value in percent');
  return { left: left, op: op, right: right };
}

function sideText(s, interval) {
  const ta = require(`${__hooks}/lib_ta.js`);
  if (s.type === 'price') return 'price';
  if (s.type === 'change') return "today's change";
  if (s.type === 'value') return String(s.value);
  if (s.type === 'drawing') return 'the drawn line';
  if (s.type === 'indicator') {
    const def = ta.find(s.id);
    const outLabel = def && def.outputs.length > 1 ? ' ' + (def.outputs.find((x) => x.key === s.output) || { label: s.output }).label : '';
    return ta.label(s.id, s.params) + outLabel + ' (' + interval + ')';
  }
  return '?';
}

/** "AAPL crosses above 190", "RSI 14 (1h) of AAPL is below 30" */
function describe(symbol, interval, c) {
  if (!c || !c.left) return symbol;
  const right = c.right.type === 'value' && c.left.type === 'change' ? c.right.value + '%' : sideText(c.right, interval);
  const left = c.left.type === 'price' ? symbol : sideText(c.left, interval) + ' of ' + symbol;
  return left + ' ' + (OP_TEXT[c.op] || c.op) + ' ' + right;
}

function serialize(rec) {
  const u = require(`${__hooks}/lib_util.js`);
  const c = u.json(rec, 'condition', null);
  return {
    id: rec.id,
    symbol: rec.getString('symbol'),
    interval: rec.getString('interval') || '1D',
    condition: c,
    text: describe(rec.getString('symbol'), rec.getString('interval') || '1D', c),
    frequency: rec.getString('frequency') || 'once',
    expires: rec.getString('expires'),
    status: rec.getString('status') || 'active',
    message: rec.getString('message'),
    notify_agent: rec.getBool('notify_agent'),
    added_by: rec.getString('added_by') || 'user',
    run: rec.getString('run'),
    last_value: rec.getFloat('last_value'),
    last_checked: rec.getString('last_checked'),
    last_fired: rec.getString('last_fired'),
    fired_count: rec.getInt('fired_count'),
    error: rec.getString('error'),
    created: rec.getString('created'),
  };
}

function serializeEvent(rec) {
  return {
    id: rec.id,
    alert: rec.getString('alert'),
    symbol: rec.getString('symbol'),
    price: rec.getFloat('price'),
    value: rec.getFloat('value'),
    detail: rec.getString('detail'),
    seen: rec.getBool('seen'),
    agent_state: rec.getString('agent_state'),
    agent_note: rec.getString('agent_note'),
    created: rec.getString('created'),
  };
}

function mustGet(app, id) {
  const u = require(`${__hooks}/lib_util.js`);
  const rec = u.byId(app, 'alerts', id);
  if (!rec) throw fail(404, 'No alert ' + id + '; see alerts.list');
  return rec;
}

/* -------------------------------------------------------------- evaluation */

/** Lookback the condition needs (bars). */
function lookback(c) {
  let n = 60;
  for (const s of [c.left, c.right]) {
    if (s.type !== 'indicator') continue;
    let m = 0;
    for (const k of Object.keys(s.params || {})) if (typeof s.params[k] === 'number') m = Math.max(m, s.params[k]);
    n = Math.max(n, m * 3 + 30);
  }
  return Math.min(1500, n);
}

/** Value of a side at bar index i (null when not available). */
function sideValue(app, s, ctx, i) {
  if (s.type === 'value') return s.value;
  if (s.type === 'price') return ctx.bars[i] ? ctx.bars[i].c : null;
  if (s.type === 'change') return i === ctx.bars.length - 1 ? ctx.change : null;
  if (s.type === 'drawing') {
    const d = ctx.drawings[s.id];
    if (!d) return null;
    const t = i === ctx.bars.length - 1 ? ctx.now : ctx.bars[i] ? ctx.bars[i].t : null;
    return t === null ? null : require(`${__hooks}/lib_drawings.js`).priceAt(d, t);
  }
  if (s.type === 'indicator') {
    const ta = require(`${__hooks}/lib_ta.js`);
    const key = s.id + JSON.stringify(s.params);
    if (!ctx.ind[key]) ctx.ind[key] = ta.compute(s.id, ctx.bars, s.params, { offset: ctx.offset }).outputs;
    const arr = ctx.ind[key][s.output] || [];
    const v = arr[i];
    return v === undefined ? null : v;
  }
  return null;
}

/**
 * Check one alert against a context { bars, change, now, drawings, ind,
 * offset }. Returns { fire, diff, left, price, reason } without saving.
 */
function check(app, rec, ctx) {
  const u = require(`${__hooks}/lib_util.js`);
  const c = u.json(rec, 'condition', null);
  if (!c || !c.left) return { fire: false, reason: 'no condition' };
  const n = ctx.bars.length;
  if (n === 0) return { fire: false, reason: 'no data' };
  if (c.right.type === 'drawing' && !ctx.drawings[c.right.id]) return { fire: false, gone: true, reason: 'The line this alert watches was deleted' };
  const L = sideValue(app, c.left, ctx, n - 1);
  const R = sideValue(app, c.right, ctx, n - 1);
  if (L === null || R === null) return { fire: false, reason: 'not enough data yet' };
  const diff = L - R;
  let prev = null;
  if (rec.getString('last_checked') !== '') prev = rec.getFloat('last_value');
  else if (n > 1) {
    const pl = sideValue(app, c.left, ctx, n - 2);
    const pr = c.right.type === 'drawing' ? sideValue(app, c.right, Object.assign({}, ctx, { now: ctx.bars[n - 2].t }), n - 1) : sideValue(app, c.right, ctx, n - 2);
    if (pl !== null && pr !== null) prev = pl - pr;
  }
  let hit = false;
  if (c.op === 'above') hit = diff > 0;
  else if (c.op === 'below') hit = diff < 0;
  else if (prev !== null) {
    const up = prev <= 0 && diff > 0;
    const down = prev >= 0 && diff < 0;
    hit = c.op === 'crosses_up' ? up : c.op === 'crosses_down' ? down : up || down;
  }
  const bar = ctx.bars[n - 1].t;
  const freq = rec.getString('frequency') || 'once';
  const level = c.op === 'above' || c.op === 'below';
  if (hit && (freq === 'once_per_bar' || (freq === 'every' && level)) && rec.getInt('last_bar') === bar && rec.getInt('fired_count') > 0) hit = false;
  return { fire: hit, diff: diff, left: L, right: R, price: ctx.bars[n - 1].c, bar: bar, condition: c };
}

/** Save a check: remember the difference; on a hit, log the event and notify. */
function settle(app, rec, r) {
  const now = new Date().toISOString();
  rec.set('last_checked', now);
  rec.set('error', '');
  if (r.diff !== undefined) rec.set('last_value', r.diff);
  let event = null;
  if (r.fire) {
    rec.set('last_fired', now);
    rec.set('last_bar', r.bar);
    rec.set('fired_count', rec.getInt('fired_count') + 1);
    if ((rec.getString('frequency') || 'once') === 'once') rec.set('status', 'triggered');
    const ev = new Record(app.findCollectionByNameOrId('alert_events'));
    const symbol = rec.getString('symbol');
    const text = describe(symbol, rec.getString('interval') || '1D', r.condition);
    const msg = rec.getString('message');
    ev.set('alert', rec.id);
    ev.set('symbol', symbol);
    ev.set('price', r.price);
    ev.set('value', r.left);
    ev.set('detail', (text + (msg ? ' - ' + msg : '')).slice(0, 1000));
    ev.set('seen', false);
    if (rec.getBool('notify_agent')) {
      ev.set('agent_state', 'waiting');
      ev.set('agent_at', now);
    }
    app.save(ev);
    event = ev;
  }
  app.save(rec);
  if (event && rec.getBool('notify_agent')) {
    const agent = require(`${__hooks}/lib_agent.js`);
    agent.markDirty(app, 'alert');
    try {
      agent.fireIfNeeded(app, 'alert');
    } catch (err) {
      console.error('[trading-view] asking the AI agent about an alert failed:', err);
    }
  }
  return event;
}

function drawingsFor(app, alerts) {
  const out = {};
  const u = require(`${__hooks}/lib_util.js`);
  const dl = require(`${__hooks}/lib_drawings.js`);
  for (const a of alerts) {
    const c = u.json(a, 'condition', null);
    if (c && c.right && c.right.type === 'drawing' && !out[c.right.id]) {
      const d = u.byId(app, 'drawings', c.right.id);
      if (d) out[c.right.id] = dl.serialize(d);
    }
  }
  return out;
}

/** Expire alerts past their date. */
function expire(app, rec) {
  const exp = rec.getString('expires');
  if (exp === '') return false;
  if (Date.parse(exp.replace(' ', 'T')) > Date.now()) return false;
  rec.set('status', 'expired');
  app.save(rec);
  return true;
}

/** Check every active alert (the minute cron). Groups by symbol and interval. */
function checkAll(app) {
  const m = require(`${__hooks}/lib_market.js`);
  const u = require(`${__hooks}/lib_util.js`);
  const active = app.findRecordsByFilter('alerts', "status = 'active'", '', 500, 0);
  if (active.length === 0) return { checked: 0, fired: 0 };
  const groups = {};
  for (const a of active) {
    if (expire(app, a)) continue;
    const k = a.getString('symbol') + '|' + (a.getString('interval') || '1D');
    (groups[k] = groups[k] || []).push(a);
  }
  let checked = 0;
  let fired = 0;
  const drawings = drawingsFor(app, active);
  for (const k of Object.keys(groups)) {
    const list = groups[k];
    const sym = list[0].getString('symbol');
    const iv = list[0].getString('interval') || '1D';
    let need = 60;
    for (const a of list) need = Math.max(need, lookback(u.json(a, 'condition', { left: { type: 'price' }, right: { type: 'value' } })));
    let ctx = null;
    try {
      const s = m.series(app, sym, iv, { count: need });
      let change = null;
      try {
        const q = m.quotes(app, [sym]).quotes[s.symbol];
        change = q ? q.change_pct : null;
      } catch {
        change = null;
      }
      ctx = { bars: s.bars, change: change, now: Math.floor(Date.now() / 1000), drawings: drawings, ind: {}, offset: s.meta.gmtoffset || 0 };
    } catch (err) {
      for (const a of list) {
        a.set('error', String((err && err.message) || err).slice(0, 500));
        a.set('last_checked', new Date().toISOString());
        app.save(a);
      }
      continue;
    }
    for (const a of list) {
      try {
        const r = check(app, a, ctx);
        checked++;
        if (r.gone) {
          a.set('status', 'paused');
          a.set('error', r.reason);
          app.save(a);
          continue;
        }
        if (settle(app, a, r)) fired++;
      } catch (err) {
        a.set('error', String((err && err.message) || err).slice(0, 500));
        app.save(a);
      }
    }
  }
  return { checked: checked, fired: fired };
}

/**
 * First check right after an alert is created or edited: records where
 * things stand, so a crossing counts only from now on. A level condition
 * (above, below) that already holds fires at once.
 */
function prime(app, rec) {
  const m = require(`${__hooks}/lib_market.js`);
  const u = require(`${__hooks}/lib_util.js`);
  const c = u.json(rec, 'condition', null);
  if (!c) return null;
  rec.set('last_checked', '');
  const s = m.series(app, rec.getString('symbol'), rec.getString('interval') || '1D', { count: lookback(c) });
  let change = null;
  if (c.left.type === 'change') {
    const q = m.quotes(app, [s.symbol]).quotes[s.symbol];
    change = q ? q.change_pct : null;
  }
  const ctx = { bars: s.bars, change: change, now: Math.floor(Date.now() / 1000), drawings: drawingsFor(app, [rec]), ind: {}, offset: s.meta.gmtoffset || 0 };
  const r = check(app, rec, ctx);
  if (r.gone) return null;
  if (c.op !== 'above' && c.op !== 'below') r.fire = false;
  return settle(app, rec, r);
}

/**
 * Fast path while the app is open: price and change alerts of quoted
 * symbols, checked against the fresh quote (at most every 3 seconds each).
 */
function checkQuotes(app, quotes) {
  const syms = Object.keys(quotes || {});
  if (syms.length === 0) return 0;
  const last = Number(app.store().get('tv_alert_fast') || 0);
  if (Date.now() - last < 3000) return 0;
  app.store().set('tv_alert_fast', Date.now());
  const u = require(`${__hooks}/lib_util.js`);
  const active = app.findRecordsByFilter('alerts', "status = 'active'", '', 500, 0).filter((a) => quotes[a.getString('symbol')]);
  if (active.length === 0) return 0;
  const drawings = drawingsFor(app, active);
  let fired = 0;
  const now = Math.floor(Date.now() / 1000);
  for (const a of active) {
    const c = u.json(a, 'condition', null);
    if (!c || c.left.type === 'indicator' || c.right.type === 'indicator') continue;
    if (a.getString('last_checked') === '') continue; // the cron sets the baseline
    if ((c.op === 'above' || c.op === 'below') && (a.getString('frequency') || 'once') !== 'once') continue; // per-bar: the cron's bars decide
    if (expire(app, a)) continue;
    const q = quotes[a.getString('symbol')];
    if (!q || q.stale || typeof q.price !== 'number') continue;
    const iv = a.getString('interval') || '1D';
    const ivSec = require(`${__hooks}/lib_market.js`).IV_SEC[iv] || 86400;
    const bar = { t: now - (now % ivSec), o: q.price, h: q.price, l: q.price, c: q.price, v: 0 };
    const ctx = { bars: [bar], change: q.change_pct, now: now, drawings: drawings, ind: {}, offset: 0 };
    try {
      const r = check(app, a, ctx);
      if (r.gone) continue;
      if (r.diff === undefined) continue;
      if (settle(app, a, r)) fired++;
    } catch (err) {
      console.warn('[trading-view] quick alert check failed:', a.id, err);
    }
  }
  return fired;
}

module.exports = {
  OPS: OPS,
  FREQUENCIES: FREQUENCIES,
  readParams: readParams,
  build: build,
  describe: describe,
  serialize: serialize,
  serializeEvent: serializeEvent,
  mustGet: mustGet,
  check: check,
  prime: prime,
  checkAll: checkAll,
  checkQuotes: checkQuotes,
};
