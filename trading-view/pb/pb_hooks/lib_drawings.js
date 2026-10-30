/// <reference path="../pb_data/types.d.ts" />
/**
 * Chart drawings, stored per symbol in time/price coordinates so they show
 * on every chart of the symbol at any interval.
 *
 * Points are [{t, p}] (t unix seconds, p price):
 *   trend, ray, extended, rect, fib, measure   two points
 *   channel                                    three (a line and the width)
 *   hline, hray, text, arrow_up, arrow_down    one point (hline uses only p)
 *   vline                                      one point (uses only t)
 *   long, short                                entry {t,p}, target {t: end, p}, stop {p}
 */

const TOOLS = ['trend', 'ray', 'extended', 'hline', 'hray', 'vline', 'rect', 'channel', 'fib', 'long', 'short', 'measure', 'text', 'arrow_up', 'arrow_down'];
const POINTS = { trend: 2, ray: 2, extended: 2, rect: 2, fib: 2, measure: 2, channel: 3, hline: 1, hray: 1, text: 1, arrow_up: 1, arrow_down: 1, vline: 1, long: 3, short: 3 };
const COLORS = ['ink', 'accent', 'up', 'down', 'amber', 'violet', 'teal', 'muted'];

function serialize(rec) {
  const u = require(`${__hooks}/lib_util.js`);
  return {
    id: rec.id,
    symbol: rec.getString('symbol'),
    tool: rec.getString('tool'),
    points: u.json(rec, 'points', []) || [],
    style: u.json(rec, 'style', {}) || {},
    text: rec.getString('text'),
    locked: rec.getBool('locked'),
    hidden: rec.getBool('hidden'),
    added_by: rec.getString('added_by') || 'user',
    run: rec.getString('run'),
    note: rec.getString('note'),
    created: rec.getString('created'),
  };
}

/** Validate points for a tool; returns clean [{t, p}]. */
function cleanPoints(tool, raw) {
  const u = require(`${__hooks}/lib_util.js`);
  if (!Array.isArray(raw)) throw u.fail(400, 'points must be a list like [{"t":1767225600,"p":182.5},{"t":1769904000,"p":195}] (t unix seconds, p price)');
  const need = POINTS[tool];
  if (raw.length < need) throw u.fail(400, tool + ' needs ' + need + ' point' + (need > 1 ? 's' : '') + ' [{t, p}]; got ' + raw.length);
  const out = [];
  for (let i = 0; i < need; i++) {
    const q = raw[i] || {};
    let t = q.t === undefined || q.t === null || q.t === '' ? null : Number(q.t);
    const p = q.p === undefined || q.p === null || q.p === '' ? null : Number(q.p);
    if (t !== null && t > 1e11) t = Math.floor(t / 1000); // milliseconds given
    const needT = !(tool === 'hline' || ((tool === 'long' || tool === 'short') && i === 2));
    const needP = tool !== 'vline';
    if (needT && (t === null || !isFinite(t))) throw u.fail(400, 'point ' + (i + 1) + ' of ' + tool + ' needs a time t (unix seconds)');
    if (needP && (p === null || !isFinite(p))) throw u.fail(400, 'point ' + (i + 1) + ' of ' + tool + ' needs a price p');
    out.push({ t: t === null ? null : Math.floor(t), p: p });
  }
  return out;
}

function cleanStyle(raw) {
  const s = raw || {};
  const out = {};
  if (s.color !== undefined) out.color = COLORS.indexOf(s.color) >= 0 || /^#[0-9a-fA-F]{6}$/.test(String(s.color)) ? s.color : 'ink';
  if (s.width !== undefined) out.width = Math.max(1, Math.min(4, Math.round(Number(s.width) || 1)));
  if (s.dash !== undefined) out.dash = s.dash === true || s.dash === 'true';
  if (s.extend_left !== undefined) out.extend_left = !!s.extend_left;
  if (s.extend_right !== undefined) out.extend_right = !!s.extend_right;
  if (s.fill !== undefined) out.fill = !!s.fill;
  if (s.size !== undefined) out.size = Math.max(10, Math.min(28, Math.round(Number(s.size) || 12)));
  if (Array.isArray(s.levels)) out.levels = s.levels.filter((x) => typeof x === 'number' && isFinite(x)).slice(0, 14);
  return out;
}

/** Price of a line drawing at time t (for alerts on trend lines), or null. */
function priceAt(d, t) {
  const pts = d.points || [];
  if (d.tool === 'hline' || d.tool === 'hray') return pts[0] ? pts[0].p : null;
  if (['trend', 'ray', 'extended'].indexOf(d.tool) < 0 || pts.length < 2) return null;
  const a = pts[0];
  const b = pts[1];
  if (b.t === a.t) return null;
  if (d.tool === 'trend' && (t < Math.min(a.t, b.t) || t > Math.max(a.t, b.t))) {
    // A segment: beyond its ends it is extended only when styled so.
    const st = d.style || {};
    if (!(st.extend_right && t > Math.max(a.t, b.t)) && !(st.extend_left && t < Math.min(a.t, b.t))) return null;
  }
  if (d.tool === 'ray' && (b.t > a.t ? t < a.t : t > a.t)) return null;
  return a.p + ((b.p - a.p) * (t - a.t)) / (b.t - a.t);
}

function mustGet(app, id) {
  const u = require(`${__hooks}/lib_util.js`);
  const rec = u.byId(app, 'drawings', id);
  if (!rec) throw u.fail(404, 'No drawing ' + id + '; see drawings.list --symbol <symbol>');
  return rec;
}

module.exports = { TOOLS: TOOLS, POINTS: POINTS, COLORS: COLORS, serialize: serialize, cleanPoints: cleanPoints, cleanStyle: cleanStyle, priceAt: priceAt, mustGet: mustGet };
