/// <reference path="../pb_data/types.d.ts" />
/**
 * Parts: the documents. A part holds its parameters and feature tree; its
 * geometry is its current build.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function tree() {
  return require(`${__hooks}/lib_tree.js`);
}

const COLORS = ['neutral', 'accent', 'blue', 'green', 'amber', 'red', 'violet', 'graphite'];

function partJson(app, p, counts) {
  const util = u();
  const b = util.byId(app, 'builds', p.getString('current_build'));
  const s = b === null ? null : util.getJson(b, 'summary');
  return {
    id: p.id,
    name: p.getString('name'),
    description: p.getString('description'),
    material: p.getString('material'),
    density: p.getFloat('density') > 0 ? p.getFloat('density') : null,
    density_used: tree().density(app, p),
    color: p.getString('color') || 'neutral',
    status: p.getString('status') || 'empty',
    tree_hash: p.getString('tree_hash'),
    pinned: p.getBool('pinned'),
    archived: p.getBool('archived'),
    origin: p.getString('origin'),
    notes: p.getString('notes'),
    thumbnail: util.fileUrl(p, 'thumbnail'),
    current_build: p.getString('current_build'),
    volume_mm3: s ? s.volume_mm3 : null,
    mass_g: s && s.mass_g !== undefined ? s.mass_g : null,
    size_mm: s && s.bbox ? s.bbox.size : null,
    bodies: s && s.bodies ? s.bodies.length : 0,
    features: counts ? counts.features : undefined,
    created: p.getString('created'),
    updated: p.getString('updated'),
  };
}

function countFeatures(app, ids) {
  const out = {};
  if (ids.length === 0) return out;
  const util = u();
  const rows = util.rows(app, 'SELECT [[part]] AS part, COUNT(*) AS n FROM {{features}} GROUP BY [[part]]', { part: '', n: 0 });
  for (const r of rows) out[r.part] = r.n;
  return out;
}

function list(app, p) {
  const util = u();
  const filters = [];
  const bind = {};
  const q = util.str(p, 'q', '');
  if (q !== '') {
    filters.push('(name ~ {:q} || description ~ {:q})');
    bind.q = q;
  }
  const status = util.oneOf(p, 'status', ['empty', 'queued', 'building', 'ok', 'warning', 'failed'], '');
  if (status !== '') {
    filters.push('status = {:s}');
    bind.s = status;
  }
  if (util.bool(p, 'pinned', false)) filters.push('pinned = true');
  const archived = util.bool(p, 'archived', false);
  filters.push(archived ? 'archived = true' : 'archived = false');
  const sort = util.oneOf(p, 'sort', ['updated', 'name', 'created'], 'updated');
  const order = sort === 'name' ? 'name' : '-' + sort;
  const limit = util.int(p, 'limit', 60, 1, 500);
  const page = util.int(p, 'page', 1, 1, 100000);
  const rows = app.findRecordsByFilter('parts', filters.join(' && '), '-pinned,' + order, limit + 1, (page - 1) * limit, bind);
  const counts = countFeatures(app, rows.map((r) => r.id));
  return {
    parts: rows.slice(0, limit).map((r) => partJson(app, r, { features: counts[r.id] || 0 })),
    more: rows.length > limit,
    total: util.rows(app, 'SELECT COUNT(*) AS n FROM {{parts}} WHERE [[archived]] = ' + (archived ? 'TRUE' : 'FALSE'), { n: 0 })[0].n,
  };
}

/** Everything the workspace needs about one part. */
function get(app, p) {
  const util = u();
  const T = tree();
  const kinds = require(`${__hooks}/lib_kinds.js`);
  const part = T.part(app, util.req(p, 'part', '<part id or name>'));
  const feats = T.featureRecs(app, part.id);
  const rb = T.rollbackIndex(part, feats);
  const params = T.paramRecs(app, part.id).map((r) => ({
    id: r.id,
    name: r.getString('name'),
    kind: r.getString('kind'),
    expr: r.getString('expr'),
    value: r.getFloat('value'),
    bounds: util.getJson(r, 'bounds'),
    comment: r.getString('comment'),
    author: r.getString('author'),
    error: r.getString('error'),
  }));
  const features = feats.map((f, i) => ({
    id: f.id,
    name: f.getString('name'),
    kind: f.getString('kind'),
    label: kinds.KINDS[f.getString('kind')].label,
    icon: kinds.KINDS[f.getString('kind')].icon,
    params: util.getJson(f, 'params') || {},
    suppressed: f.getBool('suppressed'),
    author: f.getString('author'),
    status: rb !== null && i >= rb ? 'rolled_back' : f.getString('status'),
    error: util.getJson(f, 'error'),
    warnings: util.getJson(f, 'warnings'),
    ms: f.getFloat('ms'),
    faces: f.getInt('faces'),
    note: f.getString('note'),
    position: i + 1,
    used_by: feats.filter((o) => o.id !== f.id && T.usesFeature(util.getJson(o, 'params') || {}, f.getString('name'))).map((o) => o.getString('name')),
  }));
  const B = require(`${__hooks}/lib_builds.js`);
  const cur = util.byId(app, 'builds', part.getString('current_build'));
  const pending = app.findRecordsByFilter('builds', "part = {:p} && preview = false && (status = 'queued' || status = 'running')", '-created', 1, 0, { p: part.id });
  const sel = util.findOne(app, 'selections', 'part = {:p}', { p: part.id });
  const checks = app.findRecordsByFilter('checks', 'part = {:p}', 'sort,created', 0, 0, { p: part.id }).map((c) => require(`${__hooks}/lib_misc.js`).checkJson(c));
  const exportsList = app.findRecordsByFilter('exports', 'part = {:p}', '-created', 6, 0, { p: part.id }).map((x) => require(`${__hooks}/lib_exports.js`).exportJson(app, x));
  const assets = app.findRecordsByFilter('assets', 'part = {:p}', '-created', 0, 0, { p: part.id }).map((a) => ({ id: a.id, name: a.getString('name'), kind: a.getString('kind'), bytes: a.getInt('bytes'), path: util.filePath(app, a, 'file') }));
  let rollback = '';
  if (part.getString('rollback_after') === 'start') rollback = 'start';
  else if (rb !== null && rb > 0) rollback = feats[rb - 1].getString('name');
  return {
    part: partJson(app, part, { features: feats.length }),
    parameters: params,
    features: features,
    rollback_after: rollback,
    build: B.describe(app, cur),
    build_is_current: cur !== null && cur.getString('input_hash') === part.getString('tree_hash'),
    pending_build: pending.length ? { id: pending[0].id, status: pending[0].getString('status') } : null,
    selection: sel === null ? [] : util.getJson(sel, 'keys') || [],
    checks: checks,
    exports: exportsList,
    assets: assets,
  };
}

function uniqueName(app, name, exceptId) {
  const util = u();
  const hit = util.rows(app, 'SELECT id FROM {{parts}} WHERE LOWER([[name]]) = LOWER({:n}) LIMIT 2', { id: '' }, { n: name });
  return hit.filter((h) => h.id !== exceptId).length === 0;
}

function create(app, e, p) {
  const util = u();
  const name = util.squash(util.req(p, 'name', '"Wall bracket"'));
  if (name.length > 80) throw util.fail(400, 'name must be at most 80 characters');
  if (!uniqueName(app, name, '')) throw util.fail(400, 'A part named "' + name + '" already exists');
  const s = tree().settings(app);
  let rec = null;
  app.runInTransaction((tx) => {
    rec = new Record(tx.findCollectionByNameOrId('parts'));
    rec.set('name', name);
    rec.set('description', util.str(p, 'description', ''));
    rec.set('material', util.str(p, 'material', '') || s.getString('default_material'));
    const d = util.number(p, 'density', { min: 0, max: 30 });
    if (d !== null) rec.set('density', d);
    rec.set('color', util.oneOf(p, 'color', COLORS, 'neutral'));
    rec.set('status', 'empty');
    rec.set('origin', util.actor(e) === 'agent' ? 'agent' : 'you');
    rec.set('notes', util.str(p, 'notes', ''));
    rec.set('pinned', false);
    rec.set('archived', false);
    tx.save(rec);
  });
  require(`${__hooks}/lib_misc.js`).refreshHash(app, rec.id);
  return { part: partJson(app, app.findRecordById('parts', rec.id), { features: 0 }) };
}

function update(app, e, p) {
  const util = u();
  const part = tree().part(app, util.req(p, 'part', '<part id or name>'));
  let geometry = false;
  app.runInTransaction((tx) => {
    const r = tx.findRecordById('parts', part.id);
    if (util.has(p, 'name')) {
      const name = util.squash(util.str(p, 'name'));
      if (name === '') throw util.fail(400, 'name cannot be empty');
      if (name.length > 80) throw util.fail(400, 'name must be at most 80 characters');
      if (!uniqueName(tx, name, r.id)) throw util.fail(400, 'A part named "' + name + '" already exists');
      r.set('name', name);
    }
    if (util.has(p, 'description')) r.set('description', util.str(p, 'description'));
    if (util.has(p, 'notes')) r.set('notes', util.str(p, 'notes'));
    if (util.has(p, 'material')) {
      r.set('material', util.str(p, 'material'));
      geometry = true;
    }
    if (util.has(p, 'density')) {
      const d = util.number(p, 'density', { min: 0, max: 30 });
      r.set('density', d === null ? 0 : d);
      geometry = true;
    }
    if (util.has(p, 'color')) r.set('color', util.oneOf(p, 'color', COLORS, 'neutral'));
    if (util.has(p, 'pinned')) r.set('pinned', util.bool(p, 'pinned', false));
    if (util.has(p, 'archived')) r.set('archived', util.bool(p, 'archived', false));
    tx.save(r);
  });
  if (geometry) {
    require(`${__hooks}/lib_misc.js`).refreshHash(app, part.id);
    const B = require(`${__hooks}/lib_builds.js`);
    B.kick(app, B.enqueue(app, part.id, util.actor(e)), 0);
  }
  return { part: partJson(app, app.findRecordById('parts', part.id), null) };
}

/** A copy of a part's parameters and features under a new name. */
function duplicate(app, e, p) {
  const util = u();
  const T = tree();
  const src = T.part(app, util.req(p, 'part', '<part id or name>'));
  let name = util.squash(util.str(p, 'name', ''));
  if (name === '') {
    const base = src.getString('name') + ' copy';
    name = base;
    for (let n = 2; !uniqueName(app, name, ''); n++) name = base + ' ' + n;
  } else if (!uniqueName(app, name, '')) throw util.fail(400, 'A part named "' + name + '" already exists');
  let rec = null;
  app.runInTransaction((tx) => {
    rec = new Record(tx.findCollectionByNameOrId('parts'));
    for (const f of ['description', 'material', 'density', 'color', 'notes']) rec.set(f, src.get(f));
    rec.set('name', name);
    rec.set('status', 'empty');
    rec.set('origin', util.actor(e) === 'agent' ? 'agent' : 'you');
    rec.set('pinned', false);
    rec.set('archived', false);
    tx.save(rec);
    const pc = tx.findCollectionByNameOrId('parameters');
    for (const r of T.paramRecs(tx, src.id)) {
      const c = new Record(pc);
      for (const f of ['name', 'kind', 'expr', 'value', 'bounds', 'comment', 'author', 'sort', 'error']) c.set(f, r.get(f));
      c.set('part', rec.id);
      tx.save(c);
    }
    const fc = tx.findCollectionByNameOrId('features');
    const assetMap = {};
    const ac = tx.findCollectionByNameOrId('assets');
    for (const a of tx.findRecordsByFilter('assets', 'part = {:p}', '', 0, 0, { p: src.id })) {
      const c = new Record(ac);
      c.set('part', rec.id);
      c.set('name', a.getString('name'));
      c.set('kind', a.getString('kind'));
      c.set('bytes', a.getInt('bytes'));
      c.set('hash', a.getString('hash'));
      c.set('file', $filesystem.fileFromPath(util.filePath(tx, a, 'file')));
      tx.save(c);
      assetMap[a.id] = c.id;
    }
    for (const r of T.featureRecs(tx, src.id)) {
      const c = new Record(fc);
      for (const f of ['seq', 'name', 'kind', 'suppressed', 'author', 'note']) c.set(f, r.get(f));
      const params = util.getJson(r, 'params') || {};
      if (r.getString('kind') === 'import_step' && assetMap[params.asset]) params.asset = assetMap[params.asset];
      c.set('params', params);
      c.set('status', 'pending');
      c.set('part', rec.id);
      tx.save(c);
    }
  });
  require(`${__hooks}/lib_misc.js`).refreshHash(app, rec.id);
  const B = require(`${__hooks}/lib_builds.js`);
  B.kick(app, B.enqueue(app, rec.id, util.actor(e)), 0);
  return { part: partJson(app, app.findRecordById('parts', rec.id), null) };
}

module.exports = { list: list, get: get, create: create, update: update, duplicate: duplicate, partJson: partJson, COLORS: COLORS };
