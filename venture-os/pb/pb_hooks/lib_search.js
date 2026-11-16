/// <reference path="../pb_data/types.d.ts" />
/**
 * Ctrl-K search across the app, within what the caller may see. The kernel
 * searches funds and entities; each module adds its records through
 * `search: 'lib_x.fn'` in its events_*.js: fn(ctx, q, limit) ->
 * [{ kind, id, title, href, icon, subtitle }] (people, companies, deals,
 * LPs, files...). A module that throws is reported in `errors`.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

function query(ctx, p) {
  const u = L('lib_util');
  const q = u.squash(u.str(p, 'q', ''));
  if (q.length < 2) return { q: q, results: [], groups: {}, errors: [] };
  const per = u.int(p, 'limit', 6, 1, 20);
  const results = [];
  const errors = [];
  const add = (module, x) => {
    if (!x || typeof x.title !== 'string' || typeof x.kind !== 'string') return;
    results.push({ module: module, kind: x.kind, id: String(x.id || ''), title: u.clip(x.title, 200), subtitle: u.clip(String(x.subtitle || ''), 200), href: String(x.href || ''), icon: String(x.icon || '') });
  };
  const like = u.like(q);
  const ents = L('lib_entities');
  for (const r of u.rows(ctx.app, "SELECT id FROM entities WHERE archived = FALSE AND (name LIKE {:q} ESCAPE '\\' OR short_name LIKE {:q} ESCAPE '\\' OR legal_name LIKE {:q} ESCAPE '\\') ORDER BY name LIMIT " + per, { id: '' }, { q: like })) {
    const rec = ctx.app.findRecordById('entities', r.id);
    if (!ents.canSee(ctx, rec)) continue;
    const kind = rec.getString('kind');
    add('kernel', { kind: kind === 'management' ? 'entity' : kind, id: rec.id, title: rec.getString('name'), subtitle: [kind === 'fund' ? 'Fund' : kind === 'spv' ? 'SPV' : 'Management company', rec.getInt('vintage') || '', rec.getString('currency')].filter((x) => x !== '').join(' '), href: kind === 'management' ? '#/settings/firm' : '#/funds/' + rec.id, icon: kind === 'spv' ? 'Briefcase' : 'Landmark' });
  }
  const ev = L('lib_events');
  for (const s of ev.searchFns()) {
    try {
      const got = ev.resolve(s.fn)(ctx, q, per) || [];
      for (const x of (Array.isArray(got) ? got : []).slice(0, per)) add(s.module, x);
    } catch (err) {
      console.error('[vo] search ' + s.fn + ' failed:', err);
      errors.push({ module: s.module, error: String((err && err.message) || err) });
    }
  }
  const groups = {};
  for (const r of results) groups[r.kind] = (groups[r.kind] || 0) + 1;
  return { q: q, results: results, groups: groups, errors: errors };
}

module.exports = { query: query };
