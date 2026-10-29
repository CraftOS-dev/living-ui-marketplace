/// <reference path="../pb_data/types.d.ts" />
/**
 * Lists, saved views, custom fields, duplicate review and the trash.
 *
 * Duplicates (deterministic, never merged by themselves): people sharing an
 * email, or the same name at the same company or email domain; companies
 * sharing a domain or the same name without legal suffixes. A pair the
 * person dismissed is not shown again.
 */

function U() {
  return require(`${__hooks}/lib_util.js`);
}

function serializeList(app, rec) {
  const f = rec.getString('object') === 'companies' ? 'company' : 'person';
  return {
    id: rec.id,
    name: rec.getString('name'),
    object: rec.getString('object'),
    color: rec.getString('color'),
    position: rec.getInt('position'),
    description: rec.getString('description'),
    count: app.countRecords('list_entries', $dbx.exp('list = {:l} AND ' + f + " != ''", { l: rec.id })),
  };
}

function serializeView(rec) {
  const u = U();
  return {
    id: rec.id,
    object: rec.getString('object'),
    name: rec.getString('name'),
    filters: u.json(rec, 'filters', []) || [],
    match: rec.getString('match') || 'all',
    sort: rec.getString('sort'),
    dir: rec.getString('dir') || 'asc',
    columns: u.json(rec, 'columns', []) || [],
    mode: rec.getString('mode') || 'table',
    pipeline: rec.getString('pipeline'),
    position: rec.getInt('position'),
  };
}

function serializeField(rec) {
  const u = U();
  return {
    id: rec.id,
    object: rec.getString('object'),
    key: rec.getString('key'),
    label: rec.getString('label'),
    type: rec.getString('type'),
    options: u.json(rec, 'options', []) || [],
    ai_prompt: rec.getString('ai_prompt'),
    position: rec.getInt('position'),
  };
}

/* ------------------------------------------------------------- duplicates */

function pairKey(a, b) {
  return a < b ? a + ':' + b : b + ':' + a;
}

function ignored(app, object) {
  const out = {};
  for (const r of app.findRecordsByFilter('dupe_ignores', 'object = {:o}', '', 0, 0, { o: object })) out[pairKey(r.getString('a'), r.getString('b'))] = true;
  return out;
}

function dupes(app, object, limit) {
  const u = U();
  const norm = require(`${__hooks}/lib_norm.js`);
  const q = require(`${__hooks}/lib_query.js`);
  const ign = ignored(app, object);
  const pairs = [];
  const seen = {};
  const add = (a, b, reason) => {
    const k = pairKey(a.id, b.id);
    if (a.id === b.id || seen[k] || ign[k]) return;
    seen[k] = true;
    pairs.push({ a: a, b: b, reason: reason });
  };
  if (object === 'people') {
    const ctx = q.ctxPeople(app);
    const rows = app.findRecordsByFilter('people', "deleted = ''", 'created', 0, 0).map((r) => q.person(r, ctx));
    const byEmail = {};
    const byName = {};
    for (const r of rows) {
      for (const e of r.emails) (byEmail[e] = byEmail[e] || []).push(r);
      const k = norm.nameKey(r.first_name, r.last_name);
      if (k.indexOf(' ') > 0) (byName[k] = byName[k] || []).push(r);
    }
    for (const e of Object.keys(byEmail)) for (let i = 1; i < byEmail[e].length; i++) add(byEmail[e][0], byEmail[e][i], 'Same email ' + e);
    for (const k of Object.keys(byName)) {
      const g = byName[k];
      for (let i = 0; i < g.length; i++)
        for (let j = i + 1; j < g.length; j++) {
          const a = g[i];
          const b = g[j];
          const da = a.emails.map((e) => norm.workDomain(e)).filter((x) => x !== '');
          const db = b.emails.map((e) => norm.workDomain(e)).filter((x) => x !== '');
          if (a.company !== '' && a.company === b.company) add(a, b, 'Same name at ' + a.company_name);
          else if (da.some((d) => db.indexOf(d) >= 0)) add(a, b, 'Same name, same email domain');
          else if (a.company === '' || b.company === '') add(a, b, 'Same name');
        }
    }
  } else if (object === 'companies') {
    const ctx = q.ctxCompanies(app);
    const rows = app.findRecordsByFilter('companies', "deleted = ''", 'created', 0, 0).map((r) => q.company(r, ctx));
    const byDomain = {};
    const byName = {};
    for (const r of rows) {
      for (const d of r.domains) (byDomain[d] = byDomain[d] || []).push(r);
      const k = norm.companyKey(r.name);
      if (k !== '') (byName[k] = byName[k] || []).push(r);
    }
    for (const d of Object.keys(byDomain)) for (let i = 1; i < byDomain[d].length; i++) add(byDomain[d][0], byDomain[d][i], 'Same domain ' + d);
    for (const k of Object.keys(byName)) for (let i = 1; i < byName[k].length; i++) add(byName[k][0], byName[k][i], 'Same name');
  } else throw u.fail(400, 'Duplicates are checked for people and companies');
  return pairs.slice(0, limit || 100);
}

function dismiss(app, object, a, b) {
  const r = new Record(app.findCollectionByNameOrId('dupe_ignores'));
  r.set('object', object);
  r.set('a', a < b ? a : b);
  r.set('b', a < b ? b : a);
  app.save(r);
}

/* ------------------------------------------------------------------ trash */

/** Nightly: what has been in the trash for more than 90 days goes for good. */
function purge(app) {
  const cut = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  let n = 0;
  for (const c of ['deals', 'people', 'companies']) {
    for (const r of app.findRecordsByFilter(c, "deleted != '' && deleted < {:c}", '', 500, 0, { c: cut })) {
      try {
        app.delete(r);
        n++;
      } catch (err) {
        console.error('[crm] purging', c, r.id, 'failed:', err);
      }
    }
  }
  return n;
}

module.exports = { serializeList: serializeList, serializeView: serializeView, serializeField: serializeField, dupes: dupes, dismiss: dismiss, purge: purge, pairKey: pairKey };
