/**
 * Relationship strength (REPORT Table 33, ported from the CRM's
 * lib_interactions.js).
 *
 * Each touch in the last 365 days adds its weight, halved every 60 days:
 *   meeting 3, call 2, email received 1.5, email sent 1, message 1.
 * The sum s shows as round(100 x (1 - e^(-s/3))), 0 to 100.
 * Bands: strong 60+, good 30 to 59, weak 1 to 29, none 0.
 * A touch after `now` does not count yet. A person's or a company's strength
 * is its strongest member-to-person edge.
 *
 * Pure: no PocketBase globals. `now` is always passed in.
 */

let _c = null;
function C() {
  if (_c === null) _c = require((typeof __hooks === 'string' ? __hooks : __dirname) + '/lib_eng_core.js');
  return _c;
}

const WEIGHT = { meeting: 3, call: 2, email_in: 1.5, email_out: 1, message: 1 };
const HALF_LIFE_DAYS = 60;
const WINDOW_DAYS = 365;
const KINDS = ['meeting', 'call', 'email', 'message'];

/** The weight of one touch; an email needs its direction. */
function weightOf(kind, direction) {
  if (kind === 'email') {
    if (direction === 'in') return WEIGHT.email_in;
    if (direction === 'out') return WEIGHT.email_out;
    throw C().fail(400, 'An email touch needs direction in or out', 'invalid_touch', { kind: kind, direction: C().isNil(direction) ? null : direction });
  }
  if (kind === 'meeting' || kind === 'call' || kind === 'message') return WEIGHT[kind];
  throw C().fail(400, 'kind must be one of ' + KINDS.join(', '), 'invalid_touch', { kind: C().isNil(kind) ? null : kind });
}

/** Weight left after `ageDays`: w x 0.5^(age / 60). */
function decayed(weight, ageDays) {
  return weight * Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

/** The shown score of a raw sum s: round(100 x (1 - e^(-s/3))). */
function display(s) {
  if (!(s > 0)) return 0;
  return Math.round(100 * (1 - Math.exp(-s / 3)));
}

function band(score) {
  return score >= 60 ? 'strong' : score >= 30 ? 'good' : score > 0 ? 'weak' : 'none';
}

/**
 * Strength of one set of touches (one member and one person, or any group).
 * touches: [{ kind: meeting|call|email|message, direction: in|out (email), at: ISO text or ms }]
 * now: ISO text or ms.
 * -> { score, band, s, counted, last_at }   (last_at: latest touch up to now, ISO, or null)
 */
function score(touches, now) {
  const c = C();
  const t = c.instant(now, 'now');
  if (!Array.isArray(touches)) throw c.fail(400, 'touches must be a list', 'invalid_touch', {});
  let s = 0;
  let counted = 0;
  let last = null;
  for (let i = 0; i < touches.length; i++) {
    const r = touches[i];
    const w = weightOf(r.kind, r.direction);
    const at = c.instant(r.at, 'touches[' + i + '].at');
    if (at > t) continue;
    if (last === null || at > last) last = at;
    const age = (t - at) / c.DAY_MS;
    if (age > WINDOW_DAYS) continue;
    s += decayed(w, age);
    counted++;
  }
  const sc = display(s);
  return { score: sc, band: band(sc), s: s, counted: counted, last_at: last === null ? null : new Date(last).toISOString() };
}

/**
 * Member-to-person edges from interactions.
 * interactions: [{ member, people: [personId], kind, direction, at }]
 * -> [{ member, person, score, band, s, counted, last_at }] sorted by score, then recency.
 */
function edges(interactions, now) {
  const c = C();
  if (!Array.isArray(interactions)) throw c.fail(400, 'interactions must be a list', 'invalid_touch', {});
  const groups = {};
  const order = [];
  for (let i = 0; i < interactions.length; i++) {
    const r = interactions[i];
    const m = String(c.isNil(r.member) ? '' : r.member);
    if (m === '') throw c.fail(400, 'interactions[' + i + '].member is required', 'invalid_touch', { index: i });
    const people = Array.isArray(r.people) ? r.people : [];
    for (let k = 0; k < people.length; k++) {
      const p = String(people[k]);
      if (p === '') continue;
      const key = m + '\u0000' + p;
      if (groups[key] === undefined) {
        groups[key] = { member: m, person: p, touches: [] };
        order.push(key);
      }
      groups[key].touches.push({ kind: r.kind, direction: r.direction, at: r.at });
    }
  }
  const out = order.map((key) => {
    const g = groups[key];
    const r = score(g.touches, now);
    return { member: g.member, person: g.person, score: r.score, band: r.band, s: r.s, counted: r.counted, last_at: r.last_at };
  });
  out.sort(compareEdges);
  return out;
}

function atMs(x) {
  return C().isNil(x) ? -Infinity : C().instant(x, 'last_at');
}

/** Strongest first; ties: most recent contact, then member id, then person id. */
function compareEdges(a, b) {
  if (a.score !== b.score) return b.score - a.score;
  const ta = atMs(a.last_at);
  const tb = atMs(b.last_at);
  if (ta !== tb) return tb > ta ? 1 : -1;
  if (a.member !== b.member) return a.member < b.member ? -1 : 1;
  if (a.person !== b.person) return a.person < b.person ? -1 : 1;
  return 0;
}

/**
 * The strongest edge (a person's strength over its edges; a company's over
 * the edges to its people). edges: [{ member, person, score, last_at }]
 * -> { score, band, member, person, last_at }; no edges -> score 0, band none.
 */
function best(edgeList) {
  if (!Array.isArray(edgeList)) throw C().fail(400, 'edges must be a list', 'invalid_touch', {});
  if (edgeList.length === 0) return { score: 0, band: 'none', member: null, person: null, last_at: null };
  const sorted = edgeList.slice().sort(compareEdges);
  const e = sorted[0];
  return { score: e.score, band: band(e.score), member: e.member, person: e.person, last_at: C().isNil(e.last_at) ? null : e.last_at };
}

module.exports = {
  WEIGHT: WEIGHT,
  HALF_LIFE_DAYS: HALF_LIFE_DAYS,
  WINDOW_DAYS: WINDOW_DAYS,
  weightOf: weightOf,
  decayed: decayed,
  display: display,
  band: band,
  score: score,
  edges: edges,
  best: best,
  compareEdges: compareEdges,
};
