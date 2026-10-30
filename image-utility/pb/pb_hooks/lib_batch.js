/// <reference path="../pb_data/types.d.ts" />
/**
 * Batches: the same recipe and outputs run over many images.
 *
 *   recipe    use_edits (each image's own edits first, default yes) plus
 *             edits (or a recipe preset) that work on any size (no crop box,
 *             no layers pinned to one photo: those belong to it)
 *   outputs   as export.create (formats, quality or target size, sizes,
 *             metadata), or an export preset
 *   rename    tokens: {name} {n} {n:3} {date} {taken} {width} {height}
 *             {format} {batch}
 *   folder    also copy the files there (collision: rename, skip or
 *             overwrite); files are always kept in the app and zipped
 *
 * batches.preview shows every new name and encodes a few samples first.
 * A batch runs in the background (one image at a time; progress per image,
 * cancel, retry the failed ones). The AI agent's batches wait for the
 * person to run them unless the policy lets it run them.
 */

const TOKENS = ['{name}', '{n}', '{n:3}', '{date}', '{taken}', '{width}', '{height}', '{format}', '{batch}'];
const WAKE = 'img.wake';
const LOCK = 'img.worker';

function U() {
  return require(`${__hooks}/lib_util.js`);
}
function X() {
  return require(`${__hooks}/lib_export.js`);
}
function I() {
  return require(`${__hooks}/lib_images.js`);
}
function K() {
  return require(`${__hooks}/lib_kinds.js`);
}
function G() {
  return require(`${__hooks}/lib_geom.js`);
}

function serialize(app, rec, full) {
  const u = U();
  const out = {
    id: rec.id,
    name: rec.getString('name'),
    images: u.getJson(rec, 'images') || [],
    recipe: u.getJson(rec, 'recipe') || {},
    outputs: u.getJson(rec, 'outputs') || {},
    rename: rec.getString('rename') || '{name}',
    collision: rec.getString('collision') || 'rename',
    folder: rec.getString('folder'),
    status: rec.getString('status'),
    total: rec.getInt('total'),
    done_count: rec.getInt('done_count'),
    failed_count: rec.getInt('failed_count'),
    bytes_in: rec.getInt('bytes_in'),
    bytes_out: rec.getInt('bytes_out'),
    zip_url: u.fileUrl(rec, 'zip'),
    zip_path: u.filePath(app, rec, 'zip'),
    started: rec.getString('started'),
    finished: rec.getString('finished'),
    requested_by: rec.getString('requested_by') || 'you',
    error: rec.getString('error'),
    created: rec.getString('created'),
    updated: rec.getString('updated'),
  };
  if (full) out.results = u.getJson(rec, 'results') || {};
  return out;
}

function mustBatch(app, ref) {
  const u = U();
  const rec = u.byId(app, 'batches', String(ref || ''));
  if (rec === null) throw u.fail(404, 'No batch ' + ref + '; see batches.list');
  return rec;
}

/** Recipe edits checked for any image size. */
function recipeEdits(app, p) {
  const u = U();
  let edits = [];
  const presetRef = u.str(p, 'recipe_preset', '');
  if (presetRef !== '') {
    const pr = require(`${__hooks}/lib_presets.js`).mustPreset(app, presetRef);
    if (pr.getString('kind') === 'size') {
      const d = u.getJson(pr, 'data') || {};
      edits = [{ kind: 'resize', params: { mode: 'cover', width: d.width, height: d.height, smart: true } }];
    } else if (pr.getString('kind') === 'recipe') edits = (u.getJson(pr, 'data') || {}).edits || [];
    else throw u.fail(400, 'recipe_preset must be a recipe or size preset (export presets go in preset)');
  }
  edits = edits.concat(u.list(p, 'edits', '[{"kind":"resize","params":{"mode":"longest","longest":2048}}]') || []);
  return edits.map((x, i) => {
    if (!x || !K().KINDS[x.kind]) throw u.fail(400, 'edits[' + i + '].kind must be one of: ' + Object.keys(K().KINDS).join(', '));
    if (x.kind === 'layer' && (!x.params || x.params.anchor !== 'frame')) throw u.fail(400, 'edits[' + i + ']: a layer in a batch is pinned to the frame (anchor frame, positions as fractions), so it lands in the same place on every image');
    if (x.kind === 'crop' && x.params && x.params.rect) throw u.fail(400, 'edits[' + i + ']: a crop in a batch uses a ratio (e.g. {"ratio":"1:1","smart":true}), not a box');
    let params;
    try {
      params = K().params(x.kind, x.params || {}, 4000, 3000);
    } catch (err) {
      throw u.fail(400, 'edits[' + i + '] (' + x.kind + '): ' + err.message);
    }
    return { id: 'r' + i, kind: x.kind, params: params, enabled: true };
  });
}

function create(app, e, p) {
  const u = U();
  const who = u.actor(e);
  let ids = u.list(p, 'images', '["<image id>","<image id>"]') || [];
  if (ids.length === 0) throw u.fail(400, 'images is required: a JSON list of image ids');
  if (ids.length > 2000) throw u.fail(400, 'At most 2000 images in one batch');
  ids = ids.map((id) => I().mustImage(app, String(id)).id);
  const edits = recipeEdits(app, p);
  const spec = X().outputsFrom(app, p, null);
  const rename = u.str(p, 'rename', '{name}') || '{name}';
  if (rename.indexOf('{name}') < 0 && rename.indexOf('{n') < 0) throw u.fail(400, 'rename needs {name} or a counter {n} / {n:3} so the files get different names');
  const folder = X().checkFolder(app, e, u.str(p, 'folder', ''));
  const collision = u.oneOf(p, 'collision', ['rename', 'skip', 'overwrite'], 'rename');
  const agentWaits = who === 'agent' && require(`${__hooks}/lib_stack.js`).policy(app).agent_batches !== 'run';
  const rec = new Record(app.findCollectionByNameOrId('batches'));
  rec.set('name', u.squash(u.str(p, 'name', '')).slice(0, 200) || 'Batch of ' + ids.length + ' image' + (ids.length === 1 ? '' : 's'));
  rec.set('images', ids);
  rec.set('recipe', { use_edits: u.bool(p, 'use_edits', true), edits: edits.map((x) => ({ kind: x.kind, params: x.params })) });
  rec.set('outputs', { outputs: spec.outputs, common: spec.common, preset: spec.preset });
  rec.set('rename', rename.slice(0, 300));
  rec.set('collision', collision);
  rec.set('folder', folder);
  rec.set('status', agentWaits ? 'proposed' : 'draft');
  rec.set('total', ids.length);
  rec.set('results', {});
  rec.set('requested_by', who);
  app.save(rec);
  let proposal = null;
  if (agentWaits) {
    const pr = new Record(app.findCollectionByNameOrId('proposals'));
    pr.set('kind', 'batch');
    pr.set('batch', rec.id);
    pr.set('status', 'pending');
    pr.set('author', 'agent');
    pr.set('title', u.str(p, 'title', '') || rec.getString('name'));
    pr.set('reason', u.str(p, 'reason', '').slice(0, 4000));
    pr.set('summary', { images: ids.length, outputs: spec.outputs.map((o) => o.format + (o.suffix ? ' ' + o.suffix : '')), edits: edits.map((x) => K().summary(x.kind, x.params, null)), folder: folder });
    app.save(pr);
    proposal = require(`${__hooks}/lib_stack.js`).serializeProposal(app, pr);
  }
  return { ok: true, batch: serialize(app, rec), proposal: proposal, message: agentWaits ? 'Waiting for the person to run it (your policy keeps the AI agent\'s batches as proposals). Check batches.preview first.' : 'Ready. Check batches.preview, then batches.run.' };
}

function pad(n, w) {
  let s = String(n);
  while (s.length < w) s = '0' + s;
  return s;
}

function taken(img) {
  const ex = U().getJson(img, 'exif') || {};
  const t = String(ex.Taken || '');
  const m = /^(\d{4}):(\d{2}):(\d{2})/.exec(t);
  return m ? m[1] + '-' + m[2] + '-' + m[3] : String(img.getString('created')).slice(0, 10);
}

/** The sizes an image's outputs will have, from its stack and the recipe. */
function plannedDims(img, stackEdits, o) {
  const ch = G().chain(stackEdits, img.getInt('width'), img.getInt('height'));
  let w = ch[ch.length - 1][0];
  let h = ch[ch.length - 1][1];
  if (o.square) return [o.square, o.square];
  let k = o.scale || 1;
  if (o.longest) {
    k = o.scale ? Math.min(k, o.longest / Math.max(w, h)) : o.longest / Math.max(w, h);
    if (!o.enlarge) k = Math.min(k, 1);
  }
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

/** File names for one image of a batch (index i from 0). */
function namesOf(img, i, outs, pattern, batchName, stackEdits) {
  const today = U().now().slice(0, 10);
  const base = X().slug(img.getString('name'));
  return outs.map((o) => {
    const d = plannedDims(img, stackEdits, o);
    let stem = pattern
      .split('{name}')
      .join(base)
      .split('{n:3}')
      .join(pad(i + 1, 3))
      .split('{n}')
      .join(String(i + 1))
      .split('{date}')
      .join(today)
      .split('{taken}')
      .join(taken(img))
      .split('{width}')
      .join(String(d[0]))
      .split('{height}')
      .join(String(d[1]))
      .split('{format}')
      .join(o.format)
      .split('{batch}')
      .join(X().slug(batchName));
    stem = stem.replace(/[\\/:*?"<>|]/g, '').trim() || base;
    return (o.name ? o.name : stem + (o.suffix || '')) + '.' + X().EXT[o.format];
  });
}

function stackFor(app, img, recipe) {
  const own = recipe.use_edits === false ? [] : I().activeEdits(app, img.id);
  return own.concat((recipe.edits || []).map((x, i) => ({ id: 'r' + i, kind: x.kind, params: x.params, enabled: true })));
}

/** Every new name, collisions, and real sizes for a few samples. */
function preview(app, e, p) {
  const u = U();
  const rec = mustBatch(app, u.req(p, 'batch', '<batch id>'));
  const ids = u.getJson(rec, 'images') || [];
  const recipe = u.getJson(rec, 'recipe') || {};
  const outs = (u.getJson(rec, 'outputs') || {}).outputs || [];
  const folder = rec.getString('folder');
  const rows = [];
  const seen = {};
  let dupes = 0;
  let exist = 0;
  ids.forEach((id, i) => {
    const img = u.byId(app, 'images', id);
    if (img === null) {
      rows.push({ image: { id: id, name: '(deleted)' }, outputs: [], missing: true });
      return;
    }
    const st = stackFor(app, img, recipe);
    const names = namesOf(img, i, outs, rec.getString('rename') || '{name}', rec.getString('name'), st);
    const o = names.map((n, j) => {
      const d = plannedDims(img, st, outs[j]);
      const key = n.toLowerCase();
      const dup = !!seen[key];
      if (dup) dupes++;
      seen[key] = true;
      const there = folder !== '' && u.exists($filepath.join(folder, n));
      if (there) exist++;
      return { name: n, format: outs[j].format, width: d[0], height: d[1], duplicate: dup, exists: there };
    });
    rows.push({ image: { id: img.id, name: img.getString('name'), bytes: img.getInt('bytes') }, outputs: o });
  });
  const samples = [];
  const n = u.int(p, 'samples', 3, 0, 5);
  let sampleIn = 0;
  let sampleOut = 0;
  for (let i = 0; i < ids.length && samples.length < n; i++) {
    const img = u.byId(app, 'images', ids[i]);
    if (img === null) continue;
    const st = stackFor(app, img, recipe);
    const extra = st.slice(recipe.use_edits === false ? 0 : I().activeEdits(app, img.id).length);
    const names = namesOf(img, i, outs, rec.getString('rename') || '{name}', rec.getString('name'), st);
    try {
      const res = X().encode(app, img, outs, names, extra, recipe.use_edits !== false);
      samples.push({ image: { id: img.id, name: img.getString('name'), bytes: img.getInt('bytes') }, outputs: res.outputs.map((r, j) => X().facts(outs[j], r, names[j], img.getInt('bytes'))).map((f) => Object.assign(f, { path: undefined })), ms: res.ms });
      sampleIn += img.getInt('bytes');
      sampleOut += res.outputs.reduce((t, r) => t + r.bytes, 0);
      try {
        $os.removeAll(res.dir);
      } catch {
        /* pruned later */
      }
    } catch (err) {
      samples.push({ image: { id: img.id, name: img.getString('name') }, error: String((err && err.message) || err) });
    }
  }
  const totalIn = ids.reduce((t, id) => {
    const im = u.byId(app, 'images', id);
    return t + (im ? im.getInt('bytes') : 0);
  }, 0);
  return {
    batch: serialize(app, rec),
    rows: rows,
    duplicates: dupes,
    existing: exist,
    samples: samples,
    estimate: sampleIn > 0 ? { bytes_in: totalIn, bytes_out: Math.round((totalIn * sampleOut) / sampleIn), from_samples: samples.length } : null,
    tokens: TOKENS,
  };
}

function run(app, e, p) {
  const u = U();
  const rec = mustBatch(app, u.req(p, 'batch', '<batch id>'));
  const who = u.actor(e);
  const st = rec.getString('status');
  if (who === 'agent' && require(`${__hooks}/lib_stack.js`).policy(app).agent_batches !== 'run') throw u.fail(403, 'Your policy keeps the AI agent\'s batches for the person to run; they run it from Batches (or accept your proposal).', { code: 'person_only' });
  if (st === 'running' || st === 'queued') return { ok: true, batch: serialize(app, rec), message: 'Already ' + st };
  if (st === 'done' && rec.getInt('failed_count') === 0) throw u.fail(409, 'This batch is done; duplicate it with batches.create to run it again');
  queue(app, rec);
  if (st === 'proposed') settleProposal(app, rec, true);
  return { ok: true, batch: serialize(app, rec) };
}

/** The AI agent's pending proposal of a batch, decided by running or cancelling the batch itself. */
function settleProposal(app, rec, accepted) {
  const u = U();
  for (const pr of app.findRecordsByFilter('proposals', "kind = 'batch' && batch = {:b} && status = 'pending'", '', 0, 0, { b: rec.id })) {
    pr.set('status', accepted ? 'accepted' : 'rejected');
    pr.set('decided_at', u.now());
    app.save(pr);
  }
}

function queue(app, rec) {
  rec.set('status', 'queued');
  rec.set('cancel', false);
  rec.set('error', '');
  app.save(rec);
  app.store().set(WAKE, true);
}

function cancel(app, e, p) {
  const u = U();
  const rec = mustBatch(app, u.req(p, 'batch', '<batch id>'));
  const st = rec.getString('status');
  if (st === 'queued' || st === 'draft' || st === 'proposed') {
    rec.set('status', 'cancelled');
    rec.set('finished', u.now());
    if (st === 'proposed') settleProposal(app, rec, false);
  } else if (st === 'running') {
    rec.set('cancel', true);
  } else {
    throw u.fail(409, 'This batch is ' + st + '; nothing to cancel');
  }
  app.save(rec);
  return { ok: true, batch: serialize(app, rec) };
}

/** Run the images that failed again. */
function retry(app, e, p) {
  const u = U();
  const rec = mustBatch(app, u.req(p, 'batch', '<batch id>'));
  if (rec.getInt('failed_count') === 0 && rec.getString('status') !== 'cancelled') throw u.fail(409, 'Nothing failed in this batch');
  const results = u.getJson(rec, 'results') || {};
  for (const k of Object.keys(results)) if (results[k].status === 'failed') delete results[k];
  rec.set('results', results);
  rec.set('failed_count', 0);
  queue(app, rec);
  return { ok: true, batch: serialize(app, rec) };
}

function remove(app, e, p) {
  const u = U();
  const rec = mustBatch(app, u.req(p, 'batch', '<batch id>'));
  if (rec.getString('status') === 'running') throw u.fail(409, 'Cancel the batch first');
  app.delete(rec);
  return { ok: true, deleted: rec.id };
}

function list(app, p) {
  const u = U();
  const st = u.oneOf(p, 'status', ['draft', 'proposed', 'queued', 'running', 'done', 'failed', 'cancelled'], '');
  const rows = app.findRecordsByFilter('batches', st ? 'status = {:s}' : 'id != ""', '-created', u.int(p, 'limit', 50, 1, 500), 0, { s: st });
  return { batches: rows.map((r) => serialize(app, r)) };
}

function get(app, p) {
  const u = U();
  const rec = mustBatch(app, u.req(p, 'batch', '<batch id>'));
  const out = serialize(app, rec, true);
  out.exports = app.findRecordsByFilter('exports', 'batch = {:b}', 'created', 0, 0, { b: rec.id }).map((x) => X().serialize(app, x));
  return out;
}

/** A proposed batch: accept runs it, reject cancels it. */
function decide(app, e, prop, accept) {
  const u = U();
  const rec = mustBatch(app, prop.getString('batch'));
  if (accept) queue(app, rec);
  else {
    rec.set('status', 'cancelled');
    rec.set('finished', u.now());
    app.save(rec);
  }
  prop.set('status', accept ? 'accepted' : 'rejected');
  prop.set('decided_at', u.now());
  app.save(prop);
  return { ok: true, proposal: require(`${__hooks}/lib_stack.js`).serializeProposal(app, prop), batch: serialize(app, rec) };
}

/* ------------------------------------------------------------- the worker */

/** Process one image of a batch. */
function step(app, rec, index, id) {
  const u = U();
  const results = u.getJson(rec, 'results') || {};
  const recipe = u.getJson(rec, 'recipe') || {};
  const outs = (u.getJson(rec, 'outputs') || {}).outputs || [];
  const img = u.byId(app, 'images', id);
  if (img === null) {
    results[id] = { status: 'failed', error: 'The image was deleted' };
  } else {
    try {
      const st = stackFor(app, img, recipe);
      const own = recipe.use_edits === false ? 0 : I().activeEdits(app, img.id).length;
      const extra = st.slice(own);
      const names = namesOf(img, index, outs, rec.getString('rename') || '{name}', rec.getString('name'), st);
      const res = X().encode(app, img, outs, names, extra, recipe.use_edits !== false);
      const kept = [];
      let skipped = 0;
      for (let j = 0; j < res.outputs.length; j++) {
        const k = X().keep(app, rec.getString('requested_by') || 'you', img, rec.id, outs[j], res.outputs[j], names[j], rec.getString('folder'), rec.getString('collision') || 'rename');
        if (k.copied && k.copied.skipped) skipped++;
        kept.push({ export: k.rec.id, name: names[j], bytes: res.outputs[j].bytes, width: res.outputs[j].width, height: res.outputs[j].height });
      }
      try {
        $os.removeAll(res.dir);
      } catch {
        /* pruned later */
      }
      results[id] = { status: 'done', outputs: kept, bytes_in: img.getInt('bytes'), skipped_in_folder: skipped };
      img.set('last_exported', u.now());
      img.set('exports_count', img.getInt('exports_count') + kept.length);
      app.save(img);
    } catch (err) {
      results[id] = { status: 'failed', error: String((err && err.message) || err).slice(0, 500) };
    }
  }
  let done = 0;
  let failed = 0;
  let bin = 0;
  let bout = 0;
  for (const k of Object.keys(results)) {
    const r = results[k];
    if (r.status === 'done') {
      done++;
      bin += r.bytes_in || 0;
      for (const o of r.outputs || []) bout += o.bytes || 0;
    } else if (r.status === 'failed') failed++;
  }
  const fresh = u.byId(app, 'batches', rec.id);
  fresh.set('results', results);
  fresh.set('done_count', done);
  fresh.set('failed_count', failed);
  fresh.set('bytes_in', bin);
  fresh.set('bytes_out', bout);
  app.save(fresh);
  return fresh;
}

/** Zip every file of a finished batch. */
function zip(app, rec) {
  const u = U();
  const files = [];
  const seen = {};
  for (const x of app.findRecordsByFilter('exports', 'batch = {:b}', 'created', 0, 0, { b: rec.id })) {
    let name = x.getString('name');
    let k = 2;
    const dot = name.lastIndexOf('.');
    while (seen[name.toLowerCase()]) name = name.slice(0, dot) + ' (' + k++ + ')' + name.slice(dot);
    seen[name.toLowerCase()] = true;
    files.push({ path: u.filePath(app, x, 'file'), name: name });
  }
  if (files.length === 0) return;
  const out = $filepath.join(require(`${__hooks}/lib_render.js`).workDir(app), 'batch-' + rec.id + '.zip');
  require(`${__hooks}/lib_engine.js`).call(app, { kind: 'zip', files: files, out: out }, 600000);
  const f = $filesystem.fileFromPath(out);
  f.name = X().slug(rec.getString('name')) + '.zip';
  rec.set('zip', f);
  app.save(rec);
  try {
    $os.remove(out);
  } catch {
    /* pruned later */
  }
}

/** Work through queued batches until the minute's end (returns when idle). */
function work(app) {
  const u = U();
  const E = require(`${__hooks}/lib_engine.js`);
  for (;;) {
    if (new Date().getSeconds() >= 55) return;
    if (E.missing(app).length > 0) return;
    let rec = u.findOne(app, 'batches', "status = 'running'", {}) || u.findOne(app, 'batches', "status = 'queued'", {});
    if (rec === null) return;
    if (rec.getString('status') === 'queued') {
      rec.set('status', 'running');
      if (rec.getString('started') === '') rec.set('started', u.now());
      app.save(rec);
    }
    const ids = u.getJson(rec, 'images') || [];
    const results = u.getJson(rec, 'results') || {};
    let next = -1;
    for (let i = 0; i < ids.length; i++) {
      if (!results[ids[i]]) {
        next = i;
        break;
      }
    }
    if (rec.getBool('cancel')) {
      rec.set('status', 'cancelled');
      rec.set('finished', u.now());
      app.save(rec);
      continue;
    }
    if (next < 0) {
      try {
        zip(app, rec);
      } catch (err) {
        rec.set('error', 'The zip could not be made: ' + String((err && err.message) || err).slice(0, 300));
      }
      const fresh = u.byId(app, 'batches', rec.id);
      fresh.set('status', fresh.getInt('done_count') === 0 && fresh.getInt('failed_count') > 0 ? 'failed' : 'done');
      fresh.set('finished', u.now());
      if (rec.getString('error') !== '') fresh.set('error', rec.getString('error'));
      app.save(fresh);
      continue;
    }
    step(app, rec, next, ids[next]);
  }
}

/** The cron lane: pending images first (after the engine is set up), then batches; then wait for a wake until the minute's end. */
function lane(app) {
  const store = app.store();
  const me = $security.randomString(12);
  if (store.getOrSet(LOCK, () => me) !== me) return;
  try {
    for (;;) {
      store.remove(WAKE);
      if (require(`${__hooks}/lib_engine.js`).missing(app).length === 0) {
        try {
          I().refreshPending(app, 10);
        } catch (err) {
          console.error('[image-utility] refreshing pending images failed:', err);
        }
        try {
          work(app);
        } catch (err) {
          console.error('[image-utility] batch worker failed:', err);
        }
      }
      while (new Date().getSeconds() < 56 && !store.has(WAKE)) sleep(400);
      if (!store.has(WAKE)) break;
    }
  } finally {
    store.remove(LOCK);
  }
}

/** On start: a batch that was running when the app stopped continues. */
function requeueInterrupted(app) {
  // On a brand-new database this runs before the app's migrations have made the collections.
  try {
    app.findCollectionByNameOrId('batches');
  } catch {
    return;
  }
  for (const r of app.findRecordsByFilter('batches', "status = 'running'", '', 0, 0)) {
    r.set('status', 'queued');
    app.save(r);
  }
}

module.exports = { TOKENS: TOKENS, serialize: serialize, create: create, preview: preview, run: run, cancel: cancel, retry: retry, remove: remove, list: list, get: get, decide: decide, lane: lane, requeueInterrupted: requeueInterrupted };
