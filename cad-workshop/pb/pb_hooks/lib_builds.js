/// <reference path="../pb_data/types.d.ts" />
/**
 * Builds: running a part's tree through the engine.
 *
 * Every edit queues a build of the part's new input (or reuses one: the
 * current build, a queued one, or a finished one with the same input hash,
 * which makes undo instant). Queued builds of one part coalesce: only the
 * newest runs. A build becomes the part's current build only if the part's
 * tree still has its hash when it finishes.
 *
 * Who runs builds: an op that waits for its build runs the queue itself; a
 * cron-started worker runs it in the background (it stays up until second
 * 59 of each minute, woken by a flag, so it never polls the database).
 */

const PUMP = 'cad.pump.lock';
const WORKER = 'cad.worker.lock';
const ALIVE = 'cad.worker.alive';
const WAKE = 'cad.wake';
const DONE = 'cad.done.';
const RUNNING = 'cad.running';
const PRUNED = 'cad.pruned_at';
const BUILD_TIMEOUT_MS = 180000;

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function tree() {
  return require(`${__hooks}/lib_tree.js`);
}
function engine() {
  return require(`${__hooks}/lib_engine.js`);
}

const FINAL = ['ok', 'warning', 'failed'];

function setPartStatus(app, partId, status) {
  app.runInTransaction((tx) => {
    let p;
    try {
      p = tx.findRecordById('parts', partId);
    } catch {
      return;
    }
    if (p.getString('status') !== status) {
      p.set('status', status);
      tx.save(p);
    }
  });
}

/**
 * Queue a build of the part as it is now. Returns the build record (maybe an
 * existing one), or null when the part has no features.
 */
function enqueue(app, partId, requestedBy, opts) {
  const o = opts || {};
  const util = u();
  const partRec = app.findRecordById('parts', partId);
  const feats = tree().featureRecs(app, partId);
  if (feats.length === 0) {
    app.runInTransaction((tx) => {
      const p = tx.findRecordById('parts', partId);
      p.set('status', 'empty');
      p.set('current_build', '');
      tx.save(p);
    });
    return null;
  }
  const input = tree().buildInput(app, partRec);
  if (!o.force) {
    const cur = util.byId(app, 'builds', partRec.getString('current_build'));
    if (cur !== null && cur.getString('input_hash') === input.hash && FINAL.indexOf(cur.getString('status')) >= 0) return cur;
  }
  const pending = util.findOne(app, 'builds', "part = {:p} && input_hash = {:h} && preview = false && (status = 'queued' || status = 'running')", { p: partId, h: input.hash });
  if (pending !== null) return pending;
  if (!o.force) {
    const done = app.findRecordsByFilter('builds', "part = {:p} && input_hash = {:h} && preview = false && (status = 'ok' || status = 'warning' || status = 'failed')", '-created', 1, 0, { p: partId, h: input.hash });
    if (done.length > 0 && done[0].getString('view') !== '') {
      adopt(app, done[0].id);
      return app.findRecordById('builds', done[0].id);
    }
  }
  let rec = null;
  app.runInTransaction((tx) => {
    for (const q of tx.findRecordsByFilter('builds', "part = {:p} && status = 'queued' && preview = false", '', 0, 0, { p: partId })) {
      q.set('status', 'cancelled');
      q.set('note', 'superseded by a newer edit');
      q.set('finished', util.now());
      tx.save(q);
      app.store().set(DONE + q.id, 'cancelled');
    }
    rec = new Record(tx.findCollectionByNameOrId('builds'));
    rec.set('part', partId);
    rec.set('input_hash', input.hash);
    rec.set('status', 'queued');
    rec.set('requested_by', requestedBy);
    rec.set('preview', false);
    rec.set('tree', { tree: input.tree, assets: input.assets, density: input.density, checks: input.checks });
    tx.save(rec);
    const p = tx.findRecordById('parts', partId);
    if (p.getString('status') !== 'building') {
      p.set('status', 'queued');
      tx.save(p);
    }
  });
  app.store().set(WAKE, true);
  return rec;
}

/** Make a finished build the part's current one (when the tree still matches it). */
function adopt(app, buildId) {
  app.runInTransaction((tx) => {
    const b = tx.findRecordById('builds', buildId);
    const p = tx.findRecordById('parts', b.getString('part'));
    if (b.getBool('preview') || p.getString('tree_hash') !== b.getString('input_hash')) return;
    adoptInTx(tx, p, b);
  });
}

function adoptInTx(tx, p, b) {
  const util = u();
  p.set('current_build', b.id);
  p.set('status', b.getString('status'));
  if (b.getString('thumb') !== '') {
    try {
      p.set('thumbnail', $filesystem.fileFromPath(util.filePath(tx, b, 'thumb')));
    } catch (err) {
      console.error('[cad-workshop] thumbnail copy failed:', err);
    }
  }
  tx.save(p);
  const results = {};
  for (const r of util.getJson(b, 'features') || []) results[r.name] = r;
  for (const f of tx.findRecordsByFilter('features', 'part = {:p}', '', 0, 0, { p: p.id })) {
    const r = results[f.getString('name')];
    const status = r === undefined ? 'pending' : r.status;
    const err = r && r.error ? r.error : null;
    const warn = r && r.warnings ? r.warnings : null;
    const changed =
      f.getString('status') !== status ||
      util.canonical(util.getJson(f, 'error')) !== util.canonical(err) ||
      util.canonical(util.getJson(f, 'warnings')) !== util.canonical(warn) ||
      (r && r.faces !== undefined && f.getInt('faces') !== r.faces);
    if (changed) {
      f.set('status', status);
      f.set('error', err);
      f.set('warnings', warn);
      if (r && r.ms !== undefined) f.set('ms', r.ms);
      if (r && r.faces !== undefined) f.set('faces', r.faces);
      tx.save(f);
    }
  }
  const checks = {};
  for (const c of util.getJson(b, 'checks') || []) checks[c.id] = c;
  for (const c of tx.findRecordsByFilter('checks', 'part = {:p}', '', 0, 0, { p: p.id })) {
    const r = checks[c.id];
    if (r === undefined) continue;
    c.set('result', r.result);
    c.set('value', r.value === undefined ? null : r.value);
    c.set('detail', r.detail || '');
    c.set('build', b.id);
    tx.save(c);
  }
}

function nextQueued(app) {
  const rows = app.findRecordsByFilter('builds', "status = 'queued'", 'created', 1, 0);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Run queued builds until none are left. Returns false when another caller
 * is already running them, or while the engine is still being set up
 * (lib_setup.js wakes the worker once it is in).
 */
function pump(app) {
  if (require(`${__hooks}/lib_setup.js`).waiting(app)) return false;
  const store = app.store();
  const me = $security.randomString(10);
  if (store.getOrSet(PUMP, () => me) !== me) return false;
  try {
    for (;;) {
      const next = nextQueued(app);
      if (next === null) break;
      run(app, next);
    }
  } finally {
    if (store.get(PUMP) === me) store.remove(PUMP);
  }
  // A build queued while the lock was being released is picked up here.
  if (nextQueued(app) !== null) return pump(app);
  return true;
}

function run(app, b) {
  const util = u();
  const partId = b.getString('part');
  const newer = app.findRecordsByFilter('builds', "part = {:p} && status = 'queued' && preview = false && id != {:id}", '-created', 1, 0, { p: partId, id: b.id });
  if (newer.length > 0 && newer[0].getString('created') > b.getString('created')) {
    app.runInTransaction((tx) => {
      const r = tx.findRecordById('builds', b.id);
      r.set('status', 'cancelled');
      r.set('note', 'superseded by a newer edit');
      r.set('finished', util.now());
      tx.save(r);
    });
    app.store().set(DONE + b.id, 'cancelled');
    return;
  }
  app.runInTransaction((tx) => {
    const r = tx.findRecordById('builds', b.id);
    r.set('status', 'running');
    r.set('started', util.now());
    tx.save(r);
  });
  setPartStatus(app, partId, 'building');
  const input = util.getJson(b, 'tree') || {};
  const job = {
    kind: 'build',
    tree: input.tree,
    assets: input.assets,
    options: { thumbnail: newer.length === 0, density: input.density, checks: input.checks },
  };
  app.store().set(RUNNING, JSON.stringify({ build: b.id, part: partId, started: Date.now() }));
  let res = null;
  let err = null;
  const t0 = Date.now();
  try {
    res = engine().call(app, job, BUILD_TIMEOUT_MS);
  } catch (e) {
    err = e;
  } finally {
    app.store().remove(RUNNING);
  }
  finish(app, b.id, res, err, job.out_dir, Date.now() - t0);
}

function finish(app, buildId, res, err, outDir, wallMs) {
  let status = 'failed';
  // Saving copies the engine's files; Windows can refuse a file for a moment
  // right after it was written (a virus scan), so try again before giving up,
  // and never leave the build running.
  let attempt = 0;
  for (;;) {
    try {
      status = record(app, buildId, res, err, outDir, wallMs);
      break;
    } catch (e) {
      if (++attempt < 5) {
        sleep(400);
        continue;
      }
      console.error('[cad-workshop] saving build', buildId, 'failed:', e);
      status = record(app, buildId, null, { message: 'The build finished but its result could not be saved: ' + String((e && e.message) || e), extra: { code: 'engine_unavailable' } }, '', wallMs);
      break;
    }
  }
  app.store().set(DONE + buildId, status);
  if (outDir) {
    try {
      $os.removeAll(outDir);
    } catch {
      /* best effort */
    }
  }
}

/** Write a finished build (and adopt it when the part still matches). Returns its status. */
function record(app, buildId, res, err, outDir, wallMs) {
  const util = u();
  let status = 'failed';
  app.runInTransaction((tx) => {
    let b;
    try {
      b = tx.findRecordById('builds', buildId);
    } catch {
      return;
    }
    if (b.getString('status') === 'cancelled') {
      status = 'cancelled';
      return;
    }
    if (err !== null) {
      b.set('status', 'failed');
      const code = err.extra && err.extra.code ? err.extra.code : 'engine_unavailable';
      b.set('error', { code: code, message: String(err.message || err) });
    } else if (!res.ok) {
      b.set('status', 'failed');
      b.set('error', res.error);
    } else {
      const r = res.result;
      b.set('status', r.status);
      b.set('error', r.error);
      b.set('summary', r.summary);
      b.set('features', r.features);
      b.set('checks', r.checks);
      b.set('cached', r.cached);
      b.set('triangles', r.triangles);
      const files = r.files || {};
      if (files.view) b.set('view', $filesystem.fileFromPath($filepath.join(outDir, files.view)));
      if (files.topology) b.set('topology', $filesystem.fileFromPath($filepath.join(outDir, files.topology)));
      if (files.thumb) b.set('thumb', $filesystem.fileFromPath($filepath.join(outDir, files.thumb)));
    }
    b.set('ms', wallMs);
    b.set('finished', util.now());
    tx.save(b);
    status = b.getString('status');
    const p = tx.findRecordById('parts', b.getString('part'));
    if (!b.getBool('preview') && p.getString('tree_hash') === b.getString('input_hash')) {
      adoptInTx(tx, p, b);
    } else if (p.getString('status') === 'building') {
      const other = tx.findRecordsByFilter('builds', "part = {:p} && (status = 'queued' || status = 'running') && preview = false", '', 1, 0, { p: p.id });
      if (other.length === 0) {
        const cur = util.byId(tx, 'builds', p.getString('current_build'));
        p.set('status', cur === null ? 'empty' : cur.getString('status'));
        tx.save(p);
      }
    }
  });
  return status;
}

/**
 * Build a tree that is not saved (a dry run) as a preview build: it never
 * becomes current, the app shows its mesh, and it is pruned after an hour.
 */
function preview(app, partId, input, requestedBy) {
  const util = u();
  let rec = null;
  app.runInTransaction((tx) => {
    rec = new Record(tx.findCollectionByNameOrId('builds'));
    rec.set('part', partId);
    rec.set('input_hash', input.hash);
    rec.set('status', 'running');
    rec.set('requested_by', requestedBy);
    rec.set('preview', true);
    rec.set('started', util.now());
    rec.set('tree', { tree: input.tree, assets: input.assets, density: input.density, checks: input.checks });
    tx.save(rec);
  });
  const job = { kind: 'build', tree: input.tree, assets: input.assets, options: { thumbnail: false, density: input.density, checks: input.checks } };
  let res = null;
  let err = null;
  const t0 = Date.now();
  try {
    res = engine().call(app, job, BUILD_TIMEOUT_MS);
  } catch (e) {
    err = e;
  }
  finish(app, rec.id, res, err, job.out_dir, Date.now() - t0);
  return app.findRecordById('builds', rec.id);
}

/** Wait until a build finishes (running the queue here when nobody else is). Returns its status, or null on timeout. */
function waitFor(app, buildId, ms) {
  // While the engine is being set up the build stays queued: do not hold the caller.
  if (require(`${__hooks}/lib_setup.js`).waiting(app)) return null;
  const store = app.store();
  const deadline = Date.now() + ms;
  for (;;) {
    const s = store.get(DONE + buildId);
    if (s) return s;
    const b = u().byId(app, 'builds', buildId);
    if (b === null) return 'cancelled';
    if (FINAL.indexOf(b.getString('status')) >= 0 || b.getString('status') === 'cancelled') return b.getString('status');
    if (Date.now() >= deadline) return null;
    // With the worker up, wake it and wait (the deadline holds); without
    // it, run the queue here.
    if (!store.has(PUMP)) {
      if (Date.now() - Number(store.get(ALIVE) || 0) > 1500) {
        if (pump(app)) continue;
      } else {
        store.set(WAKE, true);
      }
    }
    sleep(15);
  }
}

/** After queuing: wait for the build when asked, else make sure something runs it. */
function kick(app, build, waitMs) {
  if (build === null) return null;
  const st = build.getString('status');
  if (FINAL.indexOf(st) >= 0) return st;
  if (waitMs > 0) return waitFor(app, build.id, waitMs);
  const alive = Number(app.store().get(ALIVE) || 0);
  if (Date.now() - alive > 1500) pump(app);
  return null;
}

/** The cron worker: drains the queue, then waits on the wake flag until second 59. */
function work(app) {
  const store = app.store();
  const me = $security.randomString(10);
  if (store.getOrSet(WORKER, () => me) !== me) return;
  try {
    for (;;) {
      store.set(ALIVE, Date.now());
      pump(app);
      maybePrune(app);
      let woke = false;
      while (new Date().getSeconds() < 59) {
        store.set(ALIVE, Date.now());
        if (store.get(WAKE) === true) {
          store.set(WAKE, false);
          woke = true;
          break;
        }
        sleep(20);
      }
      if (!woke) break;
    }
  } finally {
    if (store.get(WORKER) === me) store.remove(WORKER);
  }
}

/** Cancel the part's queued builds and stop its running one. */
function cancel(app, partId) {
  const util = u();
  let cancelled = 0;
  app.runInTransaction((tx) => {
    for (const q of tx.findRecordsByFilter('builds', "part = {:p} && status = 'queued'", '', 0, 0, { p: partId })) {
      q.set('status', 'cancelled');
      q.set('note', 'cancelled');
      q.set('finished', util.now());
      tx.save(q);
      app.store().set(DONE + q.id, 'cancelled');
      cancelled++;
    }
  });
  let stopped = false;
  const raw = app.store().get(RUNNING);
  if (raw) {
    const r = JSON.parse(raw);
    if (r.part === partId) {
      app.runInTransaction((tx) => {
        const b = tx.findRecordById('builds', r.build);
        b.set('status', 'cancelled');
        b.set('note', 'cancelled while building');
        b.set('finished', util.now());
        tx.save(b);
      });
      engine().kill(app);
      stopped = true;
    }
  }
  return { cancelled: cancelled, stopped_running: stopped };
}

/** The build running now, for app.status. */
function running(app) {
  const raw = app.store().get(RUNNING);
  if (!raw) return null;
  const r = JSON.parse(raw);
  return { build: r.build, part: r.part, seconds: Math.round((Date.now() - r.started) / 100) / 10 };
}

/** Boot: builds left running by a stop go back to the queue; old engines are stopped. */
function requeueInterrupted(app) {
  try {
    app.findCollectionByNameOrId('builds');
  } catch {
    return;
  }
  engine().kill(app);
  for (const b of app.findRecordsByFilter('builds', "status = 'running'", '', 0, 0)) {
    b.set('status', 'queued');
    app.save(b);
  }
}

/**
 * Delete builds nothing needs: not current, not used by an export or a
 * check, older than a day (previews and cancelled ones after an hour).
 */
function prune(app) {
  const util = u();
  const keep = {};
  for (const p of app.findRecordsByFilter('parts', '', '', 0, 0)) if (p.getString('current_build') !== '') keep[p.getString('current_build')] = true;
  for (const x of app.findRecordsByFilter('exports', "build != ''", '', 0, 0)) keep[x.getString('build')] = true;
  for (const c of app.findRecordsByFilter('checks', "build != ''", '', 0, 0)) keep[c.getString('build')] = true;
  const day = new Date(Date.now() - 24 * 3600 * 1000).toISOString().replace('T', ' ');
  const hour = new Date(Date.now() - 3600 * 1000).toISOString().replace('T', ' ');
  let removed = 0;
  const old = app.findRecordsByFilter(
    'builds',
    "(status != 'queued' && status != 'running') && ((created < {:day}) || ((preview = true || status = 'cancelled') && created < {:hour}))",
    'created',
    500,
    0,
    { day: day, hour: hour },
  );
  for (const b of old) {
    if (keep[b.id]) continue;
    app.delete(b);
    removed++;
  }
  app.store().set(PRUNED, Date.now());
  const s = tree().settings(app);
  s.set('last_prune_at', util.now());
  app.save(s);
  return { removed: removed };
}

function maybePrune(app) {
  const last = Number(app.store().get(PRUNED) || 0);
  if (Date.now() - last < 3600 * 1000) return;
  try {
    prune(app);
  } catch (err) {
    console.error('[cad-workshop] prune failed:', err);
  }
}

/* ------------------------------------------------------------ results */

/** A build as ops return it: status, timings, summary, per-feature results, error, file paths and URLs. */
function describe(app, b) {
  const util = u();
  if (b === null) return null;
  return {
    id: b.id,
    status: b.getString('status'),
    requested_by: b.getString('requested_by'),
    preview: b.getBool('preview'),
    created: b.getString('created'),
    finished: b.getString('finished'),
    ms: b.getFloat('ms'),
    cached_features: b.getInt('cached'),
    triangles: b.getInt('triangles'),
    summary: util.getJson(b, 'summary'),
    features: util.getJson(b, 'features') || [],
    error: util.getJson(b, 'error'),
    checks: util.getJson(b, 'checks') || [],
    note: b.getString('note'),
    files: {
      view: util.fileUrl(b, 'view'),
      topology: util.fileUrl(b, 'topology'),
      thumb: util.fileUrl(b, 'thumb'),
      topology_path: util.filePath(app, b, 'topology'),
    },
  };
}

function size(s) {
  return s && s.bbox ? s.bbox.size : null;
}

/** What changed between two build summaries. */
function delta(before, after) {
  const util = u();
  const b = before || {};
  const a = after || {};
  const num = (x) => (typeof x === 'number' ? x : 0);
  const out = {
    volume_mm3: Math.round((num(a.volume_mm3) - num(b.volume_mm3)) * 1000) / 1000,
    area_mm2: Math.round((num(a.area_mm2) - num(b.area_mm2)) * 1000) / 1000,
    faces: num(a.faces) - num(b.faces),
    edges: num(a.edges) - num(b.edges),
    solids: num(a.solids) - num(b.solids),
    size_before_mm: size(b),
    size_after_mm: size(a),
  };
  out.text =
    'volume ' + (out.volume_mm3 >= 0 ? '+' : '') + util.fmt(out.volume_mm3) + ' mm3, ' + (out.faces >= 0 ? '+' : '') + out.faces + ' faces' + (out.solids !== 0 ? ', ' + (out.solids > 0 ? '+' : '') + out.solids + ' solids' : '');
  return out;
}

module.exports = {
  enqueue: enqueue,
  preview: preview,
  adopt: adopt,
  pump: pump,
  waitFor: waitFor,
  kick: kick,
  work: work,
  cancel: cancel,
  running: running,
  requeueInterrupted: requeueInterrupted,
  prune: prune,
  describe: describe,
  delta: delta,
  DONE: DONE,
};
