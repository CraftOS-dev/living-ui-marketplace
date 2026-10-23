/// <reference path="../pb_data/types.d.ts" />
/**
 * Asking about the model: topology (keys and geometry of every face and
 * edge), exact measurements, properties, validity, reference tests, pictures
 * for the agent, and a visual comparison of two states. Numbers come from
 * the kernel, never from the mesh.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function tree() {
  return require(`${__hooks}/lib_tree.js`);
}
function engine() {
  return require(`${__hooks}/lib_engine.js`);
}

/** Run a query job on the part as it is now; throws the engine's typed error. */
function query(app, partRec, kind, options, extra) {
  const util = u();
  const input = tree().buildInput(app, partRec);
  const job = Object.assign({ kind: kind, tree: input.tree, assets: input.assets, options: options || {} }, extra || {});
  const res = engine().call(app, job, 120000);
  if (!res.ok) {
    const err = res.error || {};
    throw util.fail(400, err.message || 'The engine could not answer', err);
  }
  return { result: res.result, out_dir: job.out_dir };
}

function cleanup(dir) {
  if (!dir) return;
  try {
    $os.removeAll(dir);
  } catch {
    /* best effort */
  }
}

function creators(key) {
  const head = String(key).split('~')[0];
  const out = [head.split('.')[0]];
  const at = head.split('@');
  for (let i = 1; i < at.length; i++) out.push(at[i].split('.')[0]);
  return out;
}

/** Keys and geometry from the current build's topology file. */
function describe(app, p) {
  const util = u();
  const part = tree().part(app, util.req(p, 'part', '<part id or name>'));
  const b = util.byId(app, 'builds', part.getString('current_build'));
  if (b === null || b.getString('topology') === '') {
    throw util.fail(400, 'The part has no built model yet' + (part.getString('status') === 'empty' ? ' (it has no features)' : ' (its build is ' + part.getString('status') + '; builds.get shows it)'));
  }
  const topo = JSON.parse(util.readText(util.filePath(app, b, 'topology')));
  const of = util.oneOf(p, 'of', ['faces', 'edges', 'bodies', 'all'], 'faces');
  const feature = util.str(p, 'feature', '');
  const type = util.str(p, 'type', '');
  const body = util.str(p, 'body', '');
  const limit = util.int(p, 'limit', 200, 1, 2000);
  const page = util.int(p, 'page', 1, 1, 100000);
  const keep = (x, isEdge) => {
    if (body !== '' && x.body !== body) return false;
    if (type !== '' && x.type !== type) return false;
    if (feature !== '') {
      const keys = isEdge ? x.faces : [x.key];
      if (!keys.some((k) => creators(k).indexOf(feature) >= 0)) return false;
    }
    return true;
  };
  const summary = util.getJson(b, 'summary') || {};
  const out = {
    part: part.getString('name'),
    build: b.id,
    current: b.getString('input_hash') === part.getString('tree_hash'),
    counts: { faces: topo.faces.length, edges: topo.edges.length, bodies: topo.bodies.length },
    conventions: 'mm and degrees; Z up; Front looks from -Y. Face keys: <feature>.<role>; ~n tells apart faces that share a key. Edge keys: <face key>|<face key>.',
  };
  if (of === 'faces' || of === 'all') {
    const f = topo.faces.filter((x) => keep(x, false));
    out.faces = f.slice((page - 1) * limit, page * limit);
    out.faces_total = f.length;
  }
  if (of === 'edges' || of === 'all') {
    const e = topo.edges.filter((x) => keep(x, true));
    out.edges = e.slice((page - 1) * limit, page * limit);
    out.edges_total = e.length;
  }
  if (of === 'bodies' || of === 'all') out.bodies = summary.bodies || topo.bodies.map((n) => ({ name: n }));
  if (!out.current) out.note = 'The part has changed since this build; wait for its build (builds.get) for keys of the latest tree.';
  return out;
}

/** A key, or a JSON reference given as text. */
function target(p, name) {
  const util = u();
  const raw = util.has(p, name) ? p[name] : undefined;
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw === 'object') return raw;
  const s = String(raw).trim();
  if (s.charAt(0) === '{') {
    try {
      return JSON.parse(s);
    } catch {
      throw util.fail(400, name + ' looks like JSON but is not valid JSON');
    }
  }
  return s;
}

function measure(app, p) {
  const util = u();
  const part = tree().part(app, util.req(p, 'part', '<part id or name>'));
  const a = target(p, 'a');
  if (a === undefined) throw util.fail(400, 'a is required: a face, edge or body key (e.g. ext1.cap_end) or a reference');
  const q = query(app, part, 'measure', { a: a, b: target(p, 'b') });
  cleanup(q.out_dir);
  return Object.assign({ part: part.getString('name') }, q.result);
}

function properties(app, p) {
  const util = u();
  const part = tree().part(app, util.req(p, 'part', '<part id or name>'));
  const d = util.number(p, 'density', { min: 0, max: 30 });
  const dens = d !== null ? d : tree().density(app, part);
  const q = query(app, part, 'properties', { density: dens });
  cleanup(q.out_dir);
  return Object.assign({ part: part.getString('name'), material: part.getString('material') }, q.result);
}

function check(app, p) {
  const util = u();
  const part = tree().part(app, util.req(p, 'part', '<part id or name>'));
  const q = query(app, part, 'check', {});
  cleanup(q.out_dir);
  return Object.assign({ part: part.getString('name') }, q.result);
}

function resolve(app, p) {
  const util = u();
  const part = tree().part(app, util.req(p, 'part', '<part id or name>'));
  const ref = util.obj(p, 'ref', '{"edges": {"created_by": "ext1", "parallel_to": "Z"}, "expect": 4}');
  if (ref === undefined) throw util.fail(400, 'ref is required: a reference like {"faces": {"keys": ["ext1.cap_end"]}, "expect": 1}');
  const q = query(app, part, 'resolve', { ref: ref });
  cleanup(q.out_dir);
  return Object.assign({ part: part.getString('name') }, q.result);
}

const VIEW_NAMES = ['front', 'back', 'left', 'right', 'top', 'bottom', 'iso', 'iso_back'];

/** Pictures for the agent: a 2x2 sheet (front, right, top, iso) or the views asked for, as PNG files. */
function render(app, p) {
  const util = u();
  const part = tree().part(app, util.req(p, 'part', '<part id or name>'));
  let views = util.list(p, 'views', '["iso"]');
  if (views === undefined) {
    const one = util.str(p, 'view', '');
    views = one === '' ? ['front', 'right', 'top', 'iso'] : [one];
  }
  if (views.length === 0 || views.length > 4) throw util.fail(400, 'views must list 1 to 4 of: ' + VIEW_NAMES.join(', '));
  for (const v of views) if (VIEW_NAMES.indexOf(v) < 0) throw util.fail(400, 'unknown view "' + v + '"; views: ' + VIEW_NAMES.join(', '));
  const highlight = util.list(p, 'highlight', '["fil1.blend.1"]') || [];
  const size = util.int(p, 'size', 768, 256, 1600);
  const dir = util.absPath($filepath.join(app.dataDir(), 'cad-renders', part.id));
  $os.mkdirAll(dir, 0o755);
  const file = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17) + '-' + $security.randomString(4) + '.png';
  const q = query(app, part, 'render', { views: views, size: size, highlight: highlight, file: file }, { out_dir: dir });
  const r = q.result;
  return {
    part: part.getString('name'),
    path: r.path,
    views: r.views,
    bbox: r.bbox,
    failed_at: r.failed_at,
    note: 'Orthographic views; each tile states its millimetres per pixel. Highlighted keys are orange.',
  };
}

function pruneRenders(app) {
  const root = u().absPath($filepath.join(app.dataDir(), 'cad-renders'));
  let removed = 0;
  let parts;
  try {
    parts = $os.readDir(root);
  } catch {
    return 0;
  }
  const cutoff = Date.now() - 24 * 3600 * 1000;
  for (const d of parts) {
    const dir = $filepath.join(root, d.name());
    let files;
    try {
      files = $os.readDir(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      try {
        const info = f.info();
        if (info.modTime().unixMilli() < cutoff) {
          $os.remove($filepath.join(dir, f.name()));
          removed++;
        }
      } catch {
        /* skip */
      }
    }
  }
  return removed;
}

/**
 * What a change did to the geometry: added and removed material as meshes
 * and volumes. Compare two builds (from, to), or a batch of changes.
 */
function compare(app, e, p) {
  const util = u();
  const part = tree().part(app, util.req(p, 'part', '<part id or name>'));
  let from = null;
  let to = null;
  const batch = util.str(p, 'batch', '');
  if (batch !== '') {
    const rows = app.findRecordsByFilter('changes', 'batch = {:b}', 'ord', 0, 0, { b: batch });
    if (rows.length === 0) throw util.fail(404, 'No changes in batch ' + batch);
    const hb = rows[0].getString('hash_before');
    const ha = rows[rows.length - 1].getString('hash_after');
    const pick = (h) => {
      const r = app.findRecordsByFilter('builds', "part = {:p} && input_hash = {:h} && preview = false && (status = 'ok' || status = 'warning')", '-created', 1, 0, { p: part.id, h: h });
      return r.length ? r[0] : null;
    };
    from = pick(hb);
    to = pick(ha);
    if (from === null) {
      // Before a part's first features there is nothing to build: compare against nothing.
      // Features then = features now minus what this batch and every later one added net.
      const since = app.findRecordsByFilter('changes', "part = {:p} && ord >= {:o} && (action = 'add_feature' || action = 'delete_feature')", '', 0, 0, { p: part.id, o: rows[0].getInt('ord') });
      const net = since.reduce((n, c) => n + (c.getString('action') === 'add_feature' ? 1 : -1), 0);
      if (tree().featureRecs(app, part.id).length - net !== 0) throw util.fail(400, 'The model before this batch is no longer built (old builds are pruned after a day), so it cannot be compared.');
    }
    if (to === null) throw util.fail(400, 'The model after this batch has no finished build yet; wait for its build.');
  } else {
    from = util.byId(app, 'builds', util.req(p, 'from', '<build id>'));
    if (from === null) throw util.fail(404, 'No build ' + util.str(p, 'from'));
    const toId = util.str(p, 'to', '') || part.getString('current_build');
    to = util.byId(app, 'builds', toId);
    if (to === null) throw util.fail(404, 'No build ' + toId);
  }
  const ft = from === null ? {} : util.getJson(from, 'tree') || {};
  const tt = util.getJson(to, 'tree') || {};
  const res = engine().call(app, { kind: 'compare', tree: tt.tree, tree_before: ft.tree, assets: Object.assign({}, ft.assets || {}, tt.assets || {}) }, 120000);
  if (!res.ok) throw util.fail(400, (res.error && res.error.message) || 'The comparison failed', res.error);
  const r = res.result;
  let rec = null;
  // The engine's files can be held for a moment by a virus scan; retry the save.
  engine().patiently(() => app.runInTransaction((tx) => {
    rec = new Record(tx.findCollectionByNameOrId('compares'));
    rec.set('part', part.id);
    rec.set('from_build', from === null ? '' : from.id);
    rec.set('to_build', to.id);
    rec.set('batch', batch);
    rec.set('added_mm3', r.added_mm3 || 0);
    rec.set('removed_mm3', r.removed_mm3 || 0);
    rec.set('before_mm3', r.before_mm3 || 0);
    rec.set('after_mm3', r.after_mm3 || 0);
    const files = r.files || {};
    const dir = $filepath.join(engine().paths(app).out, res.id);
    if (files.added) rec.set('added', $filesystem.fileFromPath($filepath.join(dir, files.added)));
    if (files.removed) rec.set('removed', $filesystem.fileFromPath($filepath.join(dir, files.removed)));
    tx.save(rec);
  }), 3000);
  cleanup($filepath.join(engine().paths(app).out, res.id));
  return {
    compare: rec.id,
    part: part.getString('name'),
    from_build: from === null ? '' : from.id,
    to_build: to.id,
    added_mm3: r.added_mm3 || 0,
    removed_mm3: r.removed_mm3 || 0,
    before_mm3: r.before_mm3 || 0,
    after_mm3: r.after_mm3 || 0,
    files: { added: util.fileUrl(rec, 'added'), removed: util.fileUrl(rec, 'removed'), from_view: from === null ? '' : util.fileUrl(from, 'view'), to_view: util.fileUrl(to, 'view') },
  };
}

module.exports = { describe: describe, measure: measure, properties: properties, check: check, resolve: resolve, render: render, compare: compare, pruneRenders: pruneRenders, query: query };
