/// <reference path="../pb_data/types.d.ts" />
/**
 * Close matches for references (kernel-records; SPEC qa-cli RULING CLI-05).
 * Every resolver (deal, company, person, intake item, holding, fund, LP,
 * quarter, map, thesis) takes an id, a display id or an exact name, and
 * answers a miss with 404 and `data.matches` (up to 5 close names with
 * their ids), or a tie with 409 and `data.candidates`, so your AI agent
 * can pick the right one without a second search.
 *
 *   matches(app, collection, field, text, opts) -> [{ id, name, number? }]
 *       opts: { where: extra SQL (no user text), number: 'number' column, limit }
 *   notFound(what, ref, matches, listOp, extra) -> error (404, data.matches)
 *   ambiguous(what, ref, candidates, hint, extra) -> error (409, data.candidates)
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

const MAX = 5;

/** Up to 5 rows whose name contains the text, or its words, or a short edit away. */
function matches(app, collection, field, text, opts) {
  const u = L('lib_util');
  const o = opts || {};
  const t = String(text || '').trim();
  if (t === '') return [];
  const limit = Math.max(1, Math.min(MAX, o.limit || MAX));
  const where = o.where ? ' AND (' + o.where + ')' : '';
  const num = o.number ? ', [[' + o.number + ']] AS number' : ", '' AS number";
  const shape = { id: '', name: '', number: '' };
  const sel = 'SELECT id, [[' + field + ']] AS name' + num + ' FROM ' + collection + ' WHERE [[' + field + ']] != \'\'' + where;
  const seen = {};
  const out = [];
  const push = (r) => {
    if (seen[r.id] || out.length >= limit) return;
    seen[r.id] = true;
    const m = { id: r.id, name: r.name };
    if (o.number && r.number) m.number = r.number;
    out.push(m);
  };
  for (const r of u.rows(app, sel + ' AND [[' + field + "]] LIKE {:q} ESCAPE '\\' ORDER BY LENGTH([[" + field + ']]) LIMIT ' + limit, shape, { q: u.like(t) })) push(r);
  if (out.length < limit) {
    const words = t
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3);
    for (const w of words) {
      if (out.length >= limit) break;
      for (const r of u.rows(app, sel + ' AND [[' + field + "]] LIKE {:q} ESCAPE '\\' ORDER BY LENGTH([[" + field + ']]) LIMIT ' + limit, shape, { q: u.like(w) })) push(r);
    }
  }
  if (out.length === 0) {
    // A typo: names whose start, or one of whose words, is a short edit away ("Bluefn" for "Bluefin Logistics").
    const all = u.rows(app, sel + ' LIMIT 3000', shape);
    const q = t.toLowerCase();
    const qWords = q.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
    const scored = [];
    for (const r of all) {
      const n = String(r.name).toLowerCase();
      let best = distance(q, n.slice(0, q.length));
      for (const w of n.split(/[^a-z0-9]+/)) for (const qw of qWords) best = Math.min(best, distance(qw, w));
      const allowed = q.length <= 4 ? 1 : 2;
      if (best <= allowed) scored.push({ r: r, d: best });
    }
    scored.sort((a, b) => a.d - b.d || a.r.name.length - b.r.name.length);
    for (const x of scored) push(x.r);
  }
  return out;
}

/** Edit distance (insert, delete, change one character). */
function distance(a, b) {
  const row = [];
  for (let j = 0; j <= b.length; j++) row.push(j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const c = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
      prev = c;
    }
  }
  return row[b.length];
}

/** The 404 every resolver answers: what, the ref, close names and the list op to see them all. */
function notFound(what, ref, found, listOp, extra) {
  const u = L('lib_util');
  const list = found || [];
  const names = list.map((m) => '"' + m.name + '"' + (m.number ? ' (' + m.number + ')' : '') + ' ' + m.id);
  return u.fail(404, 'No ' + what + ' "' + ref + '".' + (names.length > 0 ? ' Close matches: ' + names.join(', ') + '.' : '') + (listOp ? ' ' + listOp + ' lists them.' : ''), 'not_found', Object.assign({ ref: String(ref), matches: list }, extra || {}));
}

/** The 409 for a reference that names several records. */
function ambiguous(what, ref, candidates, hint, extra) {
  const u = L('lib_util');
  const list = (candidates || []).slice(0, 10);
  return u.fail(409, 'Several ' + what + ' match "' + ref + '": ' + list.map((c) => '"' + c.name + '"' + (c.number ? ' (' + c.number + ')' : '') + ' ' + c.id).join(', ') + '. ' + (hint || 'Pass the id.'), 'ambiguous', Object.assign({ ref: String(ref), candidates: list }, extra || {}));
}

module.exports = { matches: matches, notFound: notFound, ambiguous: ambiguous };
