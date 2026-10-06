/**
 * INFRA — thin record helpers over the PocketBase app (or a transaction app).
 * Services use these instead of repeating PocketBase API details.
 */

const BACKSLASH = String.fromCharCode(92);

function find(app, collection, filter, params, sort, limit) {
  const p = params || {};
  const f = filter || 'id != ""';
  const awkward = Object.keys(p).filter((k) => typeof p[k] === 'string' && p[k].indexOf(BACKSLASH) >= 0);
  if (!awkward.length) return app.findRecordsByFilter(collection, f, sort || '', limit || 0, 0, p);
  return findWithBackslash(app, collection, f, p, awkward, sort, limit);
}

/**
 * PocketBase 0.39.7 mishandles a backslash in a filter parameter (probed on a real PocketBase,
 * 2026-10-01): at the end ("C:\") the filter can't be parsed — a Windows drive in a fingerprint broke
 * every check on Windows machines — and in the middle ("C:\Users") it silently matches nothing. No
 * escaping helps. For `field = {:p}` (AND-only filters) ask for "contains" its longest piece without a
 * backslash and keep only exact matches. Anything else is refused loudly, never answered wrong.
 */
function findWithBackslash(app, collection, filter, params, awkward, sort, limit) {
  if (filter.indexOf('||') >= 0) throw new Error('a filter value with a backslash is only supported in AND-only filters');
  const safe = Object.assign({}, params);
  const exact = [];
  let rewritten = filter;
  for (const k of awkward) {
    let matched = false;
    rewritten = rewritten.replace(new RegExp('([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*\\{:' + k + '\\}', 'g'), (_, field) => {
      matched = true;
      exact.push([field, params[k]]);
      return field + ' ~ {:' + k + '}';
    });
    if (!matched) throw new Error(`a filter value with a backslash is only supported as "field = {:${k}}"`);
    safe[k] = params[k].split(BACKSLASH).reduce((a, b) => (b.length > a.length ? b : a), '');
  }
  const rows = app.findRecordsByFilter(collection, rewritten, sort || '', 0, 0, safe);
  const out = rows.filter((r) => exact.every(([field, v]) => r.getString(field) === v));
  return limit ? out.slice(0, limit) : out;
}

function first(app, collection, filter, params, sort) {
  const rows = find(app, collection, filter, params, sort, 1);
  return rows.length ? rows[0] : null;
}

function byId(app, collection, id) {
  if (!id) return null;
  try {
    return app.findRecordById(collection, String(id));
  } catch (_) {
    return null; // PocketBase find helpers throw on no match
  }
}

function create(app, collection, fields) {
  const rec = new Record(app.findCollectionByNameOrId(collection));
  for (const k of Object.keys(fields)) rec.set(k, fields[k]);
  app.save(rec);
  return rec;
}

function update(app, rec, fields) {
  for (const k of Object.keys(fields)) rec.set(k, fields[k]);
  app.save(rec);
  return rec;
}

function jsonOf(rec, field) {
  const s = rec.getString(field);
  if (!s || s === 'null') return null;
  try {
    return JSON.parse(s);
  } catch (_) {
    return null;
  }
}

/** PocketBase stores "2026-09-30 10:00:00.000Z"; JS wants the ISO "T" form. */
function isoOf(rec, field) {
  const s = rec.getString(field);
  return s ? s.replace(' ', 'T') : '';
}

/** ISO → PocketBase's stored form, for filter comparisons against date fields. */
function pbDate(iso) {
  return String(iso).replace('T', ' ');
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = { find, first, byId, create, update, jsonOf, isoOf, pbDate, nowIso };
