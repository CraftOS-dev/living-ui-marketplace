/// <reference path="../pb_data/types.d.ts" />
/**
 * Settings, the viewer selection, checks, files for import, requests to the
 * AI agent, app status and maintenance jobs.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function tree() {
  return require(`${__hooks}/lib_tree.js`);
}
function builds() {
  return require(`${__hooks}/lib_builds.js`);
}

/** Recompute a part's tree hash after a change outside the tree (material, checks, files). */
function refreshHash(app, partId) {
  const T = tree();
  app.runInTransaction((tx) => {
    const p = tx.findRecordById('parts', partId);
    const h = T.buildInput(tx, p).hash;
    if (p.getString('tree_hash') !== h) {
      p.set('tree_hash', h);
      tx.save(p);
    }
  });
}

/* --------------------------------------------------------------- settings */

function settingsJson(s) {
  const util = u();
  return {
    display_unit: s.getString('display_unit'),
    navigation: s.getString('navigation'),
    projection: s.getString('projection'),
    show_grid: s.getBool('show_grid'),
    default_material: s.getString('default_material'),
    materials: util.getJson(s, 'materials') || [],
    agent_wait_s: s.getFloat('agent_wait_s'),
    last_prune_at: s.getString('last_prune_at'),
  };
}

function settingsGet(app) {
  return settingsJson(tree().settings(app));
}

function settingsUpdate(app, p) {
  const util = u();
  let materialsChanged = false;
  app.runInTransaction((tx) => {
    const s = tree().settings(tx);
    if (util.has(p, 'display_unit')) s.set('display_unit', util.oneOf(p, 'display_unit', ['mm', 'in'], 'mm'));
    if (util.has(p, 'navigation')) s.set('navigation', util.oneOf(p, 'navigation', ['left_rotates', 'right_rotates', 'middle_rotates'], 'left_rotates'));
    if (util.has(p, 'projection')) s.set('projection', util.oneOf(p, 'projection', ['perspective', 'orthographic'], 'perspective'));
    if (util.has(p, 'show_grid')) s.set('show_grid', util.bool(p, 'show_grid', true));
    if (util.has(p, 'agent_wait_s')) s.set('agent_wait_s', util.number(p, 'agent_wait_s', { min: 0, max: 25 }));
    if (util.has(p, 'materials')) {
      const list = util.list(p, 'materials', '[{"name": "PLA", "density": 1.24}]');
      const seen = {};
      const clean = list.map((m, i) => {
        if (m === null || typeof m !== 'object') throw util.fail(400, 'materials[' + i + '] must be {"name": ..., "density": ...}');
        const name = util.squash(m.name);
        if (name === '' || name.length > 60) throw util.fail(400, 'materials[' + i + '].name must be 1 to 60 characters');
        if (seen[name.toLowerCase()]) throw util.fail(400, 'Two materials are named ' + name);
        seen[name.toLowerCase()] = true;
        const d = Number(m.density);
        if (!isFinite(d) || d <= 0 || d > 30) throw util.fail(400, 'materials[' + i + '].density must be a density in g/cm3 between 0 and 30');
        return { name: name, density: d };
      });
      s.set('materials', clean);
      materialsChanged = true;
    }
    if (util.has(p, 'default_material')) {
      const name = util.str(p, 'default_material', '');
      const list = util.getJson(s, 'materials') || [];
      if (name !== '' && !list.some((m) => m.name === name)) throw util.fail(400, 'default_material must be one of the materials: ' + list.map((m) => m.name).join(', '));
      s.set('default_material', name);
    }
    tx.save(s);
  });
  if (materialsChanged) {
    // Densities feed every part's mass: rebuild the parts that use a material.
    for (const part of app.findRecordsByFilter('parts', "material != '' && density = 0", '', 0, 0)) {
      refreshHash(app, part.id);
      builds().enqueue(app, part.id, 'system');
    }
  }
  return settingsGet(app);
}

/* --------------------------------------------------------------- selection */

/** Keys must name faces, edges or bodies of the part's current build. */
function validKeys(app, partRec, keys) {
  const util = u();
  const b = util.byId(app, 'builds', partRec.getString('current_build'));
  if (b === null || b.getString('topology') === '') return { ok: keys, unknown: [] };
  let topo;
  try {
    topo = JSON.parse(util.readText(util.filePath(app, b, 'topology')));
  } catch {
    return { ok: keys, unknown: [] };
  }
  const known = {};
  for (const f of topo.faces) known[f.key] = 'face';
  for (const e of topo.edges) known[e.key] = 'edge';
  for (const n of topo.bodies) known[n] = 'body';
  return { ok: keys.filter((k) => known[k] !== undefined), unknown: keys.filter((k) => known[k] === undefined), kinds: known };
}

function selectionGet(app, p) {
  const util = u();
  const part = tree().part(app, util.req(p, 'part', '<part id or name>'));
  const sel = util.findOne(app, 'selections', 'part = {:p}', { p: part.id });
  const keys = sel === null ? [] : util.getJson(sel, 'keys') || [];
  const v = validKeys(app, part, keys);
  const kinds = v.kinds || {};
  const faces = keys.filter((k) => kinds[k] === 'face');
  const edges = keys.filter((k) => kinds[k] === 'edge');
  const bodies = keys.filter((k) => kinds[k] === 'body');
  const out = {
    part: part.getString('name'),
    keys: keys,
    faces: faces,
    edges: edges,
    bodies: bodies,
    set_by: sel === null ? null : sel.getString('set_by'),
    stale: v.unknown,
  };
  // Ready-made references for features.add (fillet edges, hole face, ...).
  if (faces.length) out.faces_ref = { faces: { keys: faces }, expect: faces.length };
  if (edges.length) out.edges_ref = { edges: { keys: edges }, expect: edges.length };
  return out;
}

function selectionSet(app, e, p) {
  const util = u();
  const part = tree().part(app, util.req(p, 'part', '<part id or name>'));
  const clear = util.bool(p, 'clear', false);
  const keys = clear ? [] : util.list(p, 'keys', '["ext1.cap_end"]') || [];
  if (!keys.every((k) => typeof k === 'string' && k !== '')) throw util.fail(400, 'keys must be a list of face, edge or body keys');
  if (keys.length > 500) throw util.fail(400, 'at most 500 keys');
  const v = validKeys(app, part, keys);
  if (v.unknown.length) throw util.fail(400, 'Not in the current model: ' + v.unknown.slice(0, 10).join(', ') + '. List keys with model.describe.');
  app.runInTransaction((tx) => {
    let sel = util.findOne(tx, 'selections', 'part = {:p}', { p: part.id });
    if (sel === null) {
      sel = new Record(tx.findCollectionByNameOrId('selections'));
      sel.set('part', part.id);
    }
    sel.set('keys', keys);
    sel.set('set_by', util.actor(e));
    tx.save(sel);
  });
  return selectionGet(app, { part: part.id });
}

/* ------------------------------------------------------------------ checks */

const CHECK_KINDS = ['bbox_x', 'bbox_y', 'bbox_z', 'volume', 'area', 'mass', 'solid_count', 'valid', 'distance', 'center_distance', 'radius', 'face_count', 'fits_within'];

function checkJson(c) {
  const util = u();
  return {
    id: c.id,
    name: c.getString('name'),
    kind: c.getString('kind'),
    refs: util.getJson(c, 'refs'),
    op: c.getString('op') || 'eq',
    target: c.getFloat('target'),
    target_max: c.getFloat('target_max'),
    tolerance: c.getFloat('tolerance'),
    box: util.getJson(c, 'box'),
    author: c.getString('author'),
    result: c.getString('result') || 'pending',
    value: util.getJson(c, 'value'),
    detail: c.getString('detail'),
    build: c.getString('build'),
  };
}

function checksList(app, p) {
  const util = u();
  const part = tree().part(app, util.req(p, 'part', '<part id or name>'));
  const list = app.findRecordsByFilter('checks', 'part = {:p}', 'sort,created', 0, 0, { p: part.id }).map(checkJson);
  return {
    part: part.getString('name'),
    checks: list,
    passing: list.filter((c) => c.result === 'pass').length,
    failing: list.filter((c) => c.result === 'fail' || c.result === 'cannot_run').length,
  };
}

/** Create or update a check; the part rebuilds (from cache) to run it. */
function checksSave(app, e, p) {
  const util = u();
  const part = tree().part(app, util.req(p, 'part', '<part id or name>'));
  const actor = util.actor(e);
  const id = util.str(p, 'check', '');
  let rec = null;
  app.runInTransaction((tx) => {
    if (id !== '') {
      rec = util.findOne(tx, 'checks', 'part = {:p} && (id = {:c} || name = {:c})', { p: part.id, c: id });
      if (rec === null) throw util.fail(404, 'No check "' + id + '" on this part');
      if (actor === 'agent' && rec.getString('author') === 'you') throw util.fail(403, 'This check was written by the person; the AI agent may not change it (add its own check instead).');
    } else {
      rec = new Record(tx.findCollectionByNameOrId('checks'));
      rec.set('part', part.id);
      rec.set('author', actor === 'agent' ? 'agent' : 'you');
      rec.set('result', 'pending');
      rec.set('sort', tx.findRecordsByFilter('checks', 'part = {:p}', '', 0, 0, { p: part.id }).length + 1);
    }
    const kind = util.oneOf(p, 'kind', CHECK_KINDS, rec.getString('kind') || '');
    if (kind === '') throw util.fail(400, 'kind is required: ' + CHECK_KINDS.join(', '));
    rec.set('kind', kind);
    const name = util.squash(util.str(p, 'name', rec.getString('name') || ''));
    if (name === '') throw util.fail(400, 'name is required, e.g. "Fits the 80 mm enclosure"');
    rec.set('name', name);
    if (kind === 'fits_within') {
      const box = util.list(p, 'box', '[80, 60, 40]');
      if (box !== undefined) {
        if (box.length !== 3 || !box.every((x) => typeof x === 'number' && x > 0)) throw util.fail(400, 'box must be three positive numbers [x, y, z] in mm');
        rec.set('box', box);
      } else if (util.getJson(rec, 'box') === null) throw util.fail(400, 'box is required for fits_within, e.g. box=[80, 60, 40]');
    } else {
      const op = util.oneOf(p, 'op', ['eq', 'le', 'ge', 'between'], rec.getString('op') || '');
      if (op === '' && kind !== 'valid') throw util.fail(400, 'op is required: eq, le, ge or between');
      rec.set('op', kind === 'valid' ? 'eq' : op);
      if (kind === 'valid') rec.set('target', 1);
      const target = util.number(p, 'target');
      if (target !== null) rec.set('target', target);
      else if (kind !== 'valid' && id === '') throw util.fail(400, 'target is required, e.g. target=40');
      const tmax = util.number(p, 'target_max');
      if (tmax !== null) rec.set('target_max', tmax);
      if (rec.getString('op') === 'between' && rec.getFloat('target_max') < rec.getFloat('target')) throw util.fail(400, 'target_max must be at least target for between');
      const tol = util.number(p, 'tolerance', { min: 0 });
      if (tol !== null) rec.set('tolerance', tol);
    }
    if (kind === 'distance' || kind === 'center_distance' || kind === 'radius') {
      const refs = util.obj(p, 'refs', '{"a": "ext1.cap_start", "b": "ext1.cap_end"}');
      if (refs !== undefined) rec.set('refs', refs);
      const r = refs !== undefined ? refs : util.getJson(rec, 'refs');
      if (r === null || r.a === undefined || (kind !== 'radius' && r.b === undefined)) throw util.fail(400, kind !== 'radius' ? 'refs must be {"a": <key or reference>, "b": <key or reference>}' : 'refs must be {"a": <key or reference>}');
    }
    rec.set('result', 'pending');
    tx.save(rec);
  });
  refreshHash(app, part.id);
  const B = builds();
  B.kick(app, B.enqueue(app, part.id, actor), actor === 'agent' ? 20000 : 0);
  return { check: checkJson(app.findRecordById('checks', rec.id)) };
}

/** Re-run the checks now (they also run on every build). */
function checksRun(app, e, p) {
  const util = u();
  const part = tree().part(app, util.req(p, 'part', '<part id or name>'));
  refreshHash(app, part.id);
  const B = builds();
  const b = B.enqueue(app, part.id, util.actor(e));
  B.kick(app, b, util.actor(e) === 'agent' ? 20000 : 0);
  return checksList(app, { part: part.id });
}

/* ------------------------------------------------------------------ assets */

function assetsAdd(app, e, p) {
  const util = u();
  const part = tree().part(app, util.req(p, 'part', '<part id or name>'));
  let file = util.uploaded(e, 'file');
  let name = util.str(p, 'name', '');
  let size = 0;
  if (file === null) {
    const path = util.req(p, 'path', '"C:\\\\parts\\\\motor.step"');
    file = util.localFile(path, 'path');
    if (name === '') name = $filepath.base(path);
    size = $os.stat(path).size();
  } else {
    if (name === '') name = file.originalName;
    size = file.size;
  }
  const lower = name.toLowerCase();
  if (!(lower.length > 4 && (lower.slice(-5) === '.step' || lower.slice(-4) === '.stp'))) throw util.fail(400, 'Only STEP files (.step or .stp) can be added');
  let rec = null;
  app.runInTransaction((tx) => {
    rec = new Record(tx.findCollectionByNameOrId('assets'));
    rec.set('part', part.id);
    rec.set('name', name);
    rec.set('kind', 'step');
    rec.set('file', file);
    rec.set('bytes', size);
    tx.save(rec);
  });
  // A fingerprint of the stored file (its name, size and time) makes an
  // import rebuild when the file is replaced.
  const stored = util.filePath(app, rec, 'file');
  const st = $os.stat(stored);
  rec.set('hash', $security.sha256(rec.getString('file') + '|' + st.size() + '|' + String(st.modTime())));
  app.save(rec);
  return { asset: { id: rec.id, name: name, bytes: size, path: stored }, use: 'features.add --part "' + part.getString('name') + '" --kind import_step --params \'{"asset": "' + rec.id + '"}\'' };
}

function assetsList(app, p) {
  const util = u();
  const part = tree().part(app, util.req(p, 'part', '<part id or name>'));
  return {
    assets: app.findRecordsByFilter('assets', 'part = {:p}', '-created', 0, 0, { p: part.id }).map((a) => ({ id: a.id, name: a.getString('name'), kind: a.getString('kind'), bytes: a.getInt('bytes'), path: util.filePath(app, a, 'file'), created: a.getString('created') })),
  };
}

/* ------------------------------------------------------------------ briefs */

const BRIEF_TRIGGER = { design: 'design_requested', repair: 'repair_requested', review: 'review_requested' };

function briefJson(app, b) {
  const util = u();
  const part = util.byId(app, 'parts', b.getString('part'));
  return {
    id: b.id,
    kind: b.getString('kind'),
    part: part === null ? null : { id: part.id, name: part.getString('name') },
    title: b.getString('title'),
    body: b.getString('body'),
    selection: util.getJson(b, 'selection') || [],
    status: b.getString('status'),
    result: b.getString('result'),
    request_id: b.getString('request_id'),
    created: b.getString('created'),
    updated: b.getString('updated'),
  };
}

/** A request for the AI agent: stored, then the matching trigger asks the agent. */
function briefsCreate(app, e, p) {
  const util = u();
  const kind = util.oneOf(p, 'kind', ['design', 'repair', 'review'], 'design');
  const partRef = util.str(p, 'part', '');
  const part = partRef === '' ? null : tree().part(app, partRef);
  if ((kind === 'repair' || kind === 'review') && part === null) throw util.fail(400, 'part is required for a ' + kind + ' request');
  const title = util.squash(util.str(p, 'title', ''));
  const body = util.str(p, 'body', '');
  if (kind === 'design' && body === '' && title === '') throw util.fail(400, 'Describe what to design (title or body)');
  let sel = [];
  if (part !== null) {
    const row = util.findOne(app, 'selections', 'part = {:p}', { p: part.id });
    if (row !== null) sel = util.getJson(row, 'keys') || [];
  }
  let rec = null;
  app.runInTransaction((tx) => {
    rec = new Record(tx.findCollectionByNameOrId('briefs'));
    if (part !== null) rec.set('part', part.id);
    rec.set('kind', kind);
    rec.set('title', title !== '' ? title.slice(0, 160) : kind === 'repair' ? 'Fix ' + part.getString('name') : kind === 'review' ? 'Review ' + part.getString('name') : body.slice(0, 80));
    rec.set('body', body);
    rec.set('selection', sel);
    rec.set('status', 'sent');
    tx.save(rec);
  });
  const params = { brief: rec.id };
  if (kind === 'review') params.process = util.oneOf(p, 'process', ['fdm_print', 'resin_print', 'cnc_3axis', 'general'], 'general');
  const fired = require(`${__hooks}/_triggers_lib.js`).fire(app, BRIEF_TRIGGER[kind], params, 'hook');
  if (fired.ok) {
    rec.set('request_id', fired.id);
    app.save(rec);
  }
  return {
    brief: briefJson(app, rec),
    trigger: BRIEF_TRIGGER[kind],
    asked: fired.ok,
    message: fired.ok ? 'Sent to your AI agent.' : 'Saved, but your AI agent was not asked: ' + fired.message,
  };
}

function briefsList(app, p) {
  const util = u();
  const filters = [];
  const bind = {};
  if (util.str(p, 'part', '') !== '') {
    filters.push('part = {:p}');
    bind.p = tree().part(app, util.str(p, 'part')).id;
  }
  const status = util.oneOf(p, 'status', ['sent', 'working', 'done', 'failed'], '');
  if (status !== '') {
    filters.push('status = {:s}');
    bind.s = status;
  }
  const rows = app.findRecordsByFilter('briefs', filters.join(' && '), '-created', util.int(p, 'limit', 50, 1, 200), 0, bind);
  return { briefs: rows.map((b) => briefJson(app, b)) };
}

function briefsGet(app, p) {
  const util = u();
  const b = util.byId(app, 'briefs', util.req(p, 'brief', '<brief id>'));
  if (b === null) throw util.fail(404, 'No request with that id');
  const out = briefJson(app, b);
  if (b.getString('part') !== '') out.part_detail = require(`${__hooks}/lib_parts.js`).get(app, { part: b.getString('part') });
  return out;
}

/** The AI agent reports progress or the outcome of a request. */
function briefsUpdate(app, e, p) {
  const util = u();
  const b = util.byId(app, 'briefs', util.req(p, 'brief', '<brief id>'));
  if (b === null) throw util.fail(404, 'No request with that id');
  const status = util.oneOf(p, 'status', ['working', 'done', 'failed'], '');
  const order = { sent: 0, working: 1, done: 2, failed: 2 };
  if (status !== '') {
    if (order[status] < order[b.getString('status')]) throw util.fail(400, 'A request moves forward only (sent, working, then done or failed)');
    b.set('status', status);
  }
  if (util.has(p, 'result')) b.set('result', util.str(p, 'result').slice(0, 8000));
  if (util.has(p, 'part') && util.str(p, 'part', '') !== '' && b.getString('part') === '') b.set('part', tree().part(app, util.str(p, 'part')).id);
  app.save(b);
  return { brief: briefJson(app, b) };
}

/* ------------------------------------------------------------ app status */

function status(app) {
  const util = u();
  const E = require(`${__hooks}/lib_engine.js`);
  const counts = {};
  for (const r of util.rows(app, 'SELECT [[status]] AS status, COUNT(*) AS n FROM {{parts}} WHERE [[archived]] = FALSE GROUP BY [[status]]', { status: '', n: 0 })) counts[r.status || 'empty'] = r.n;
  const queued = util.rows(app, "SELECT COUNT(*) AS n FROM {{builds}} WHERE [[status]] = 'queued'", { n: 0 })[0].n;
  const open = util.rows(app, "SELECT COUNT(*) AS n FROM {{briefs}} WHERE [[status]] = 'sent' OR [[status]] = 'working'", { n: 0 })[0].n;
  return {
    engine: E.status(app),
    running: builds().running(app),
    queued_builds: queued,
    parts_by_status: counts,
    open_requests: open,
    now: util.now(),
  };
}

function jobsRun(app, p) {
  const util = u();
  const job = util.oneOf(p, 'job', ['prune', 'requeue', 'engine_start', 'engine_test', 'engine_install'], '');
  if (job === 'prune') return { job: job, result: builds().prune(app) };
  if (job === 'engine_install') {
    // Starts (or retries) the one-off engine download; it runs in the background.
    return { job: job, setup: require(`${__hooks}/lib_setup.js`).request(app) };
  }
  if (job === 'engine_start') {
    // Load the kernel ahead of the first edit (a cold start takes seconds).
    const E = require(`${__hooks}/lib_engine.js`);
    const before = E.status(app);
    if (!before.installed || before.running || before.busy) return { job: job, started: false, engine: before };
    E.call(app, { kind: 'ping' }, 90000);
    return { job: job, started: true, engine: E.status(app) };
  }
  if (job === 'requeue') {
    builds().requeueInterrupted(app);
    return { job: job, result: { requeued: true } };
  }
  if (job === 'engine_test') {
    const E = require(`${__hooks}/lib_engine.js`);
    const t0 = Date.now();
    const ping = E.call(app, { kind: 'ping' }, 90000);
    const t1 = Date.now();
    const sample = {
      features: [
        { name: 's1', kind: 'sketch', params: { plane: 'XY', items: [{ type: 'rectangle', id: 'r1', width: 60, height: 40, corner_radius: 4 }] }, suppressed: false },
        { name: 'ext1', kind: 'extrude', params: { sketch: 's1', extent: { type: 'distance', distance: 20 } }, suppressed: false },
        { name: 'shell1', kind: 'shell', params: { remove: { faces: { keys: ['ext1.cap_end'] }, expect: 1 }, thickness: 2 }, suppressed: false },
        { name: 'hole1', kind: 'hole', params: { face: { faces: { keys: ['ext1.cap_start'] }, expect: 1 }, positions: [[20, 12], [-20, 12], [20, -12], [-20, -12]], size: 'M3', fit: 'clearance', head: 'countersink', through: true }, suppressed: false },
      ],
      rollback: null,
    };
    const res = E.call(app, { kind: 'build', tree: sample, options: {} }, 120000);
    const t2 = Date.now();
    try {
      $os.removeAll($filepath.join(E.paths(app).out));
      $os.mkdirAll(E.paths(app).out, 0o755);
    } catch {
      /* best effort */
    }
    if (!res.ok) return { job: job, ok: false, error: res.error };
    return {
      job: job,
      ok: res.result.status === 'ok',
      engine: ping.result,
      start_and_ping_ms: t1 - t0,
      sample_build_ms: t2 - t1,
      engine_build_ms: res.result.build_ms,
      volume_mm3: res.result.summary.volume_mm3,
    };
  }
  throw util.fail(400, 'job must be prune, requeue, engine_start, engine_test or engine_install');
}

module.exports = {
  refreshHash: refreshHash,
  settingsGet: settingsGet,
  settingsUpdate: settingsUpdate,
  selectionGet: selectionGet,
  selectionSet: selectionSet,
  checkJson: checkJson,
  checksList: checksList,
  checksSave: checksSave,
  checksRun: checksRun,
  assetsAdd: assetsAdd,
  assetsList: assetsList,
  briefJson: briefJson,
  briefsCreate: briefsCreate,
  briefsList: briefsList,
  briefsGet: briefsGet,
  briefsUpdate: briefsUpdate,
  status: status,
  jobsRun: jobsRun,
  CHECK_KINDS: CHECK_KINDS,
};
