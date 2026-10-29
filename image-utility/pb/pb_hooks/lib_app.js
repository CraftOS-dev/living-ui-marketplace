/// <reference path="../pb_data/types.d.ts" />
/**
 * The library and app-level operations: images (list, get, import, update,
 * duplicate, delete, look, info, analyze, filter previews), settings and
 * the AI agent's policy, what is on screen, requests to the AI agent and
 * logo assets.
 */

function U() {
  return require(`${__hooks}/lib_util.js`);
}
function I() {
  return require(`${__hooks}/lib_images.js`);
}
function S() {
  return require(`${__hooks}/lib_stack.js`);
}
function R() {
  return require(`${__hooks}/lib_render.js`);
}
function E() {
  return require(`${__hooks}/lib_engine.js`);
}
function K() {
  return require(`${__hooks}/lib_kinds.js`);
}

/* ---------------------------------------------------------------- images */

function imagesList(app, p) {
  const u = U();
  const where = [];
  const bind = {};
  const q = u.squash(u.str(p, 'q', ''));
  if (q !== '') {
    where.push('(name ~ {:q} || title ~ {:q} || alt_text ~ {:q} || keywords ~ {:q})');
    bind.q = q;
  }
  const show = u.oneOf(p, 'show', ['all', 'edited', 'original', 'exported', 'pinned', 'agent', 'proposals'], 'all');
  if (show === 'edited') where.push('edits_count > 0');
  if (show === 'original') where.push('edits_count = 0');
  if (show === 'exported') where.push('exports_count > 0');
  if (show === 'pinned') where.push('pinned = true');
  if (show === 'agent') where.push("origin = 'agent'");
  const fmt = u.str(p, 'format', '').toUpperCase();
  if (fmt !== '') {
    where.push('format = {:f}');
    bind.f = fmt === 'JPG' ? 'JPEG' : fmt;
  }
  const sorts = { recent: '-created', name: 'name', size: '-bytes', pixels: '-width', edited: '-updated' };
  const sort = sorts[u.oneOf(p, 'sort', Object.keys(sorts), 'recent')];
  const limit = u.int(p, 'limit', 200, 1, 2000);
  let rows = app.findRecordsByFilter('images', where.length ? where.join(' && ') : 'id != ""', '-pinned,' + sort, limit, 0, bind);
  if (show === 'proposals') {
    const pend = {};
    for (const pr of app.findRecordsByFilter('proposals', "status = 'pending' && kind = 'edits'", '', 0, 0)) pend[pr.getString('image')] = true;
    rows = rows.filter((r) => pend[r.id]);
  }
  const counts = u.rows(app, 'SELECT COUNT(*) AS n, COALESCE(SUM([[bytes]]), 0) AS b, COALESCE(SUM(CASE WHEN [[edits_count]] > 0 THEN 1 ELSE 0 END), 0) AS edited FROM {{images}}', { n: 0, b: 0, edited: 0 })[0];
  return { images: rows.map((r) => I().serialize(app, r)), total: counts.n, total_bytes: counts.b, edited: counts.edited };
}

function imagesGet(app, p) {
  const u = U();
  const img = I().mustImage(app, u.req(p, 'image', '<image id>'));
  const list = S().load(app, img.id);
  const out = I().serialize(app, img, { full: true });
  out.stack = S().describe(app, img, list);
  out.proposals = app.findRecordsByFilter('proposals', "image = {:i} && status = 'pending'", '-created', 0, 0, { i: img.id }).map((x) => S().serializeProposal(app, x));
  out.exports = app.findRecordsByFilter('exports', 'image = {:i}', '-created', 20, 0, { i: img.id }).map((x) => require(`${__hooks}/lib_export.js`).serialize(app, x));
  out.requests = app.findRecordsByFilter('requests', 'image = {:i}', '-created', 20, 0, { i: img.id }).map((x) => requestJson(app, x));
  out.undo = S().undoState(app, img.id);
  return out;
}

/** images.import: uploads (multipart "files") or files on this computer (paths). */
function imagesImport(app, e, p) {
  const u = U();
  const who = u.actor(e);
  const added = [];
  const failed = [];
  let files = [];
  try {
    files = e.findUploadedFiles('files') || [];
  } catch {
    files = [];
  }
  for (const f of files) {
    try {
      added.push(I().importOne(app, who, f, f.originalName || f.name, ''));
    } catch (err) {
      failed.push({ name: f.originalName || f.name, error: String((err && err.message) || err) });
    }
  }
  const paths = (u.list(p, 'paths', '["C:\\\\Users\\\\me\\\\Pictures\\\\photo.jpg"]') || []).map(String);
  if (u.str(p, 'path', '') !== '') paths.push(u.str(p, 'path', ''));
  const folder = u.str(p, 'folder', '');
  if (folder !== '') {
    let entries = [];
    try {
      entries = $os.readDir(folder);
    } catch {
      throw u.fail(400, 'No folder at "' + folder + '". Give the absolute path of a folder.');
    }
    for (const d of entries) if (!d.isDir() && I().extOk(d.name())) paths.push($filepath.join(folder, d.name()));
  }
  if (paths.length > 500) throw u.fail(400, 'At most 500 files at once');
  for (const path of paths) {
    try {
      if (!$filepath.isAbs(path)) throw u.fail(400, 'Give the absolute path (got "' + path + '")');
      const f = u.localFile(path, 'path');
      added.push(I().importOne(app, who, f, $filepath.base(path), path));
    } catch (err) {
      failed.push({ path: path, error: String((err && err.message) || err) });
    }
  }
  if (added.length === 0 && failed.length === 0) throw u.fail(400, 'Give files (an upload), path, paths (a JSON list of absolute paths) or folder');
  if (added.length === 0) throw u.fail(422, failed.map((x) => (x.name || x.path) + ': ' + x.error).join('; '), { failed: failed });
  return { ok: true, images: added.map((r) => I().serialize(app, r)), failed: failed };
}

function imagesUpdate(app, e, p) {
  const u = U();
  const img = I().mustImage(app, u.req(p, 'image', '<image id>'));
  if (u.has(p, 'name')) {
    const n = u.squash(u.str(p, 'name', '')).slice(0, 300);
    if (n === '') throw u.fail(400, 'name cannot be empty');
    img.set('name', n);
  }
  for (const k of ['title', 'alt_text', 'caption', 'notes']) if (u.has(p, k)) img.set(k, u.str(p, k, '').slice(0, k === 'title' ? 300 : 4000));
  if (u.has(p, 'keywords')) {
    const kw = u.list(p, 'keywords', '["beach","sunset"]') || [];
    img.set('keywords', kw.map((x) => u.squash(String(x)).slice(0, 60)).filter((x) => x !== '').slice(0, 50));
  }
  if (u.has(p, 'pinned')) img.set('pinned', u.bool(p, 'pinned', false));
  app.save(img);
  return { ok: true, image: I().serialize(app, img) };
}

function imagesDuplicate(app, e, p) {
  const u = U();
  const src = I().mustImage(app, u.req(p, 'image', '<image id>'));
  const f = $filesystem.fileFromPath(u.filePath(app, src, 'original'));
  const rec = new Record(app.findCollectionByNameOrId('images'));
  for (const k of ['format', 'width', 'height', 'bytes', 'frames', 'duration_ms', 'alpha', 'mode', 'icc', 'wide_gamut', 'exif', 'gps', 'dpi', 'hash', 'title', 'alt_text', 'caption', 'keywords', 'notes', 'source_path']) rec.set(k, src.get(k));
  rec.set('name', (u.str(p, 'name', '') || src.getString('name') + ' copy').slice(0, 300));
  rec.set('original', f);
  rec.set('origin', u.actor(e));
  rec.set('status', 'pending');
  app.save(rec);
  if (u.bool(p, 'with_edits', true)) {
    const edits = S().load(app, src.id).filter((x) => x.state === 'active');
    const plain = edits.map((x) => ({ id: u.newId(), kind: x.kind, params: x.params, enabled: x.enabled, author: x.author, state: 'active', proposal: '', note: x.note }));
    S().persist(app, u.actor(e), rec, [], plain, { noJournal: true });
  }
  return { ok: true, image: I().serialize(app, I().refresh(app, rec)) };
}

function imagesDelete(app, e, p) {
  const u = U();
  const ids = (u.list(p, 'images') || []).map(String);
  if (u.str(p, 'image', '') !== '') ids.push(u.str(p, 'image', ''));
  if (ids.length === 0) throw u.fail(400, 'image (or images, a JSON list of ids) is required');
  const names = [];
  for (const id of ids) {
    const r = u.byId(app, 'images', id);
    if (r === null) continue;
    names.push(r.getString('name'));
    app.delete(r);
  }
  return { ok: true, deleted: names.length, names: names, note: 'Exports made from these images are kept (see exports.list).' };
}

/** images.render: look at an image (or a part of it, or one point of its stack). */
function imagesRender(app, e, p) {
  const u = U();
  const img = I().mustImage(app, u.req(p, 'image', '<image id>'));
  const list = S().load(app, img.id);
  const propId = u.str(p, 'proposal', '');
  let vis = S().visible(list, propId);
  const upto = u.str(p, 'upto', '');
  if (upto !== '') {
    const i = vis.findIndex((x) => x.id === upto);
    if (i < 0) throw u.fail(400, 'upto must be an edit id of this image (the render stops before it)');
    vis = vis.slice(0, i);
  }
  if (u.bool(p, 'original', false)) vis = [];
  // A draft edit on top (a tool's view while it is open: the crop's rotated
  // frame before its box, say), checked like a saved one; never kept.
  const draft = u.obj(p, 'draft', '{"kind":"crop","params":{"turns":1}}');
  if (draft !== undefined) {
    const kind = String(draft.kind || '');
    if (!K().KINDS[kind]) throw u.fail(400, 'draft.kind must be one of: ' + Object.keys(K().KINDS).join(', '));
    const d = require(`${__hooks}/lib_geom.js`).chain(vis, img.getInt('width'), img.getInt('height'));
    const at = d[d.length - 1];
    vis = vis.concat([{ id: 'draft', kind: kind, params: K().params(kind, draft.params || {}, at[0], at[1]), enabled: true }]);
  }
  const region = u.obj(p, 'region', '{"x":0,"y":0,"w":800,"h":600}');
  const r = R().render(app, img, vis, { max: u.int(p, 'max', 1600, 128, 4000), region: region || undefined, histogram: u.bool(p, 'histogram', false), layers: u.bool(p, 'layers', true) });
  return { image: img.id, url: r.url, path: r.path, width: r.width, height: r.height, preview_width: r.preview_width, preview_height: r.preview_height, region: r.region, chain: r.chain, transform: r.transform || null, alpha: r.alpha, histogram: r.histogram || null, ms: r.ms, cached: r.cached };
}

/** images.info: everything known about the original, and the histogram now. */
function imagesInfo(app, e, p) {
  const u = U();
  const img = I().mustImage(app, u.req(p, 'image', '<image id>'));
  const out = I().serialize(app, img, { full: true });
  try {
    const r = R().render(app, img, I().activeEdits(app, img.id), { max: 1600, histogram: true });
    out.histogram = r.histogram || null;
  } catch (err) {
    out.histogram = null;
    out.histogram_error = String((err && err.message) || err);
  }
  return out;
}

/** analyze.image: auto adjust sliders, a trim box, a smart crop box, colours. */
function analyze(app, e, p) {
  const u = U();
  const img = I().mustImage(app, u.req(p, 'image', '<image id>'));
  let vis = I().activeEdits(app, img.id);
  const upto = u.str(p, 'upto', '');
  if (upto !== '') {
    const i = vis.findIndex((x) => x.id === upto);
    if (i >= 0) vis = vis.slice(0, i);
  }
  const what = u.list(p, 'what', '["auto","trim","smart","colors"]') || ['auto', 'trim', 'smart', 'colors'];
  const mk = R().ensureMasks(app, img, vis);
  return E().call(app, { kind: 'analyze', path: R().originalPath(app, img), stack: vis.map(R().entry), masks: mk.masks, logos: R().logosFor(app, vis), what: what, ratio: u.str(p, 'ratio', '1:1') || '1:1', tolerance: u.int(p, 'tolerance', 12, 0, 120) }, 120000);
}

/** filters.previews: every look on a small copy (the Filter tool's grid). */
function filterPreviews(app, e, p) {
  const u = U();
  const img = I().mustImage(app, u.req(p, 'image', '<image id>'));
  let vis = I().activeEdits(app, img.id);
  const upto = u.str(p, 'upto', '');
  if (upto !== '') {
    const i = vis.findIndex((x) => x.id === upto);
    if (i >= 0) vis = vis.slice(0, i);
  }
  const mk = R().ensureMasks(app, img, vis);
  const key = R().hash([img.getString('hash'), vis.map((x) => [x.kind, x.params, x.enabled !== false]), 'filters']);
  const dir = $filepath.join(R().cacheDir(app), 'f-' + key);
  if (!u.exists($filepath.join(dir, 'soft.webp'))) {
    E().call(app, { kind: 'filters', path: R().originalPath(app, img), stack: vis.map(R().entry), masks: mk.masks, logos: R().logosFor(app, vis), size: 160, out_dir: dir }, 120000);
  }
  const K = require(`${__hooks}/lib_kinds.js`);
  return { filters: [{ name: 'original', label: 'Original' }].concat(K.FILTERS.map((f) => ({ name: f, label: K.schema().filters.find((x) => x.name === f).label }))).map((f) => Object.assign(f, { url: '/api/img/cache/f-' + key + '/' + f.name + '.webp' })) };
}

/* -------------------------------------------------------------- settings */

function settingsRow(app) {
  return app.findRecordsByFilter('settings', 'id != ""', '', 1, 0)[0];
}

function settingsJson(app) {
  const u = U();
  const s = settingsRow(app);
  return { defaults: require(`${__hooks}/lib_export.js`).defaults(app), policy: S().policy(app), export_folder: s ? s.getString('export_folder') : '' };
}

function settingsUpdate(app, e, p) {
  const u = U();
  const s = settingsRow(app);
  const who = u.actor(e);
  if (u.has(p, 'policy') || u.has(p, 'export_folder')) {
    if (who === 'agent') throw u.fail(403, 'Your policy and the export folder are the person\'s to change.', { code: 'person_only' });
  }
  if (u.has(p, 'defaults')) {
    const d = u.obj(p, 'defaults', '{"format":"webp","quality":"balanced","metadata":"basic","strip_gps":true}');
    const cur = require(`${__hooks}/lib_export.js`).defaults(app);
    const next = Object.assign({}, cur, d);
    require(`${__hooks}/lib_export.js`).outputsFrom(app, { format: next.format, quality: next.quality, metadata: next.metadata, strip_gps: next.strip_gps, matte: next.matte }, null);
    if (['fast', 'normal', 'max'].indexOf(next.effort) < 0) next.effort = 'normal';
    s.set('defaults', next);
  }
  if (u.has(p, 'policy')) {
    const pol = u.obj(p, 'policy', '{"agent_edits":"propose","agent_batches":"propose"}');
    const cur = S().policy(app);
    const next = {
      agent_edits: pol.agent_edits === undefined ? cur.agent_edits : pol.agent_edits === 'apply' ? 'apply' : 'propose',
      agent_batches: pol.agent_batches === undefined ? cur.agent_batches : pol.agent_batches === 'run' ? 'run' : 'propose',
      house_rules: pol.house_rules === undefined ? cur.house_rules : String(pol.house_rules).slice(0, 4000),
    };
    s.set('policy', next);
  }
  if (u.has(p, 'export_folder')) {
    const f = u.str(p, 'export_folder', '');
    if (f !== '' && !$filepath.isAbs(f)) throw u.fail(400, 'export_folder must be an absolute folder path');
    s.set('export_folder', f);
  }
  app.save(s);
  return Object.assign({ ok: true }, settingsJson(app));
}

/* ------------------------------------------------------- status and screen */

function status(app) {
  const u = U();
  const one = (sql) => u.rows(app, sql, { n: 0 })[0].n;
  return {
    engine: E().status(app),
    setup: require(`${__hooks}/lib_setup.js`).status(app),
    images: one('SELECT COUNT(*) AS n FROM {{images}}'),
    pending_images: one("SELECT COUNT(*) AS n FROM {{images}} WHERE [[status]] = 'pending'"),
    proposals: one("SELECT COUNT(*) AS n FROM {{proposals}} WHERE [[status]] = 'pending'"),
    open_requests: one("SELECT COUNT(*) AS n FROM {{requests}} WHERE [[status]] = 'sent' OR [[status]] = 'working'"),
    batches_running: one("SELECT COUNT(*) AS n FROM {{batches}} WHERE [[status]] = 'running' OR [[status]] = 'queued'"),
    exports: one('SELECT COUNT(*) AS n FROM {{exports}}'),
    now: u.now(),
  };
}

const UI_KEY = 'img.ui';

/** app.ui: the workspace reports what is on screen (kept in memory). */
function ui(app, e, p) {
  const u = U();
  const state = {
    view: u.str(p, 'view', ''),
    image: u.str(p, 'image', ''),
    tool: u.str(p, 'tool', ''),
    edit: u.str(p, 'edit', ''),
    selection: u.json(p, 'selection') || null,
    images: (u.list(p, 'images') || []).slice(0, 500),
    at: u.now(),
  };
  app.store().set(UI_KEY, state);
  return { ok: true };
}

/** app.context: what the person is looking at, with the image's details. */
function context(app) {
  const st = app.store().get(UI_KEY) || null;
  const out = { screen: st };
  if (st && st.image) {
    try {
      out.image = imagesGet(app, { image: st.image });
    } catch {
      out.image = null;
    }
  }
  return out;
}

/* -------------------------------------------------------------- requests */

const TRIGGER = { edit: 'edit_requested', describe: 'describe_requested' };

function requestJson(app, r) {
  const u = U();
  const img = u.byId(app, 'images', r.getString('image'));
  return {
    id: r.id,
    kind: r.getString('kind'),
    image: img === null ? null : { id: img.id, name: img.getString('name') },
    images: u.getJson(r, 'images') || [],
    title: r.getString('title'),
    body: r.getString('body'),
    region: u.getJson(r, 'region'),
    status: r.getString('status'),
    result: r.getString('result'),
    request_id: r.getString('request_id'),
    created: r.getString('created'),
    updated: r.getString('updated'),
  };
}

function requestsCreate(app, e, p) {
  const u = U();
  if (u.actor(e) === 'agent') throw u.fail(403, 'Requests are how the person asks you; answer them with requests.update.', { code: 'person_only' });
  const kind = u.oneOf(p, 'kind', ['edit', 'describe'], 'edit');
  const imageRef = u.str(p, 'image', '');
  const img = imageRef ? I().mustImage(app, imageRef) : null;
  const images = (u.list(p, 'images') || []).map(String).slice(0, 500);
  for (const id of images) I().mustImage(app, id);
  const body = u.str(p, 'body', '').slice(0, 8000);
  if (kind === 'edit' && body === '') throw u.fail(400, 'Say what to do (body)');
  if (kind === 'describe' && img === null && images.length === 0) throw u.fail(400, 'image or images is required for a describe request');
  const region = u.obj(p, 'region', '{"x":0,"y":0,"w":400,"h":300}') || null;
  const rec = new Record(app.findCollectionByNameOrId('requests'));
  if (img !== null) rec.set('image', img.id);
  rec.set('images', images);
  rec.set('kind', kind);
  rec.set('title', (u.str(p, 'title', '') || (kind === 'describe' ? 'Describe ' + (img ? img.getString('name') : images.length + ' images') : body.slice(0, 80))).slice(0, 300));
  rec.set('body', body);
  rec.set('region', region);
  rec.set('status', 'sent');
  app.save(rec);
  const fired = require(`${__hooks}/_triggers_lib.js`).fire(app, TRIGGER[kind], { request: rec.id }, 'hook');
  if (fired.ok) {
    rec.set('request_id', fired.id);
    app.save(rec);
  }
  return { ok: true, request: requestJson(app, rec), asked: fired.ok, message: fired.ok ? 'Sent to your AI agent.' : 'Saved, but your AI agent was not asked: ' + fired.message };
}

function requestsList(app, p) {
  const u = U();
  const where = [];
  const bind = {};
  if (u.str(p, 'image', '') !== '') {
    where.push('image = {:i}');
    bind.i = u.str(p, 'image', '');
  }
  const st = u.oneOf(p, 'status', ['sent', 'working', 'done', 'failed'], '');
  if (st !== '') {
    where.push('status = {:s}');
    bind.s = st;
  }
  const rows = app.findRecordsByFilter('requests', where.length ? where.join(' && ') : 'id != ""', '-created', u.int(p, 'limit', 50, 1, 500), 0, bind);
  return { requests: rows.map((r) => requestJson(app, r)) };
}

function requestsGet(app, p) {
  const u = U();
  const r = u.byId(app, 'requests', u.req(p, 'request', '<request id>'));
  if (r === null) throw u.fail(404, 'No request with that id; see requests.list');
  const out = requestJson(app, r);
  if (r.getString('image') !== '') out.image_detail = imagesGet(app, { image: r.getString('image') });
  out.images_detail = (u.getJson(r, 'images') || []).slice(0, 100).map((id) => {
    const im = u.byId(app, 'images', id);
    return im === null ? { id: id, missing: true } : I().serialize(app, im);
  });
  return out;
}

function requestsUpdate(app, e, p) {
  const u = U();
  const r = u.byId(app, 'requests', u.req(p, 'request', '<request id>'));
  if (r === null) throw u.fail(404, 'No request with that id; see requests.list');
  const status = u.oneOf(p, 'status', ['working', 'done', 'failed'], '');
  const order = { sent: 0, working: 1, done: 2, failed: 2 };
  if (status !== '') {
    if (order[status] < order[r.getString('status')]) throw u.fail(400, 'A request moves forward only (sent, working, then done or failed)');
    r.set('status', status);
  }
  if (u.has(p, 'result')) r.set('result', u.str(p, 'result', '').slice(0, 8000));
  app.save(r);
  return { ok: true, request: requestJson(app, r) };
}

/* ---------------------------------------------------------------- assets */

function assetJson(app, a) {
  const u = U();
  return { id: a.id, name: a.getString('name'), url: u.fileUrl(a, 'file'), path: u.filePath(app, a, 'file'), width: a.getInt('width'), height: a.getInt('height'), bytes: a.getInt('bytes'), created: a.getString('created') };
}

function assetsList(app) {
  return { assets: app.findRecordsByFilter('assets', 'id != ""', '-created', 0, 0).map((a) => assetJson(app, a)) };
}

function assetsAdd(app, e, p) {
  const u = U();
  let f = u.uploaded(e, 'file');
  let name = f ? f.originalName || f.name : '';
  if (f === null) {
    const path = u.req(p, 'path', 'C:\\Users\\me\\logo.png');
    f = u.localFile(path, 'path');
    name = $filepath.base(path);
  }
  if (!/\.(png|webp|jpe?g|gif|avif)$/i.test(name)) throw u.fail(415, 'A logo must be PNG, WebP, JPEG, GIF or AVIF (PNG with transparency works best)');
  const a = new Record(app.findCollectionByNameOrId('assets'));
  a.set('name', (u.str(p, 'name', '') || name.replace(/\.[a-z0-9]+$/i, '')).slice(0, 200));
  a.set('file', f);
  a.set('kind', 'logo');
  app.save(a);
  try {
    const pr = E().call(app, { kind: 'probe', path: u.filePath(app, a, 'file') }, 30000);
    a.set('width', pr.width);
    a.set('height', pr.height);
    a.set('bytes', pr.bytes);
    app.save(a);
  } catch (err) {
    const code = err && err.extra ? err.extra.code : '';
    if (code !== 'engine_unavailable') {
      app.delete(a);
      throw err;
    }
  }
  return { ok: true, asset: assetJson(app, a) };
}

function assetsDelete(app, e, p) {
  const u = U();
  const a = u.byId(app, 'assets', u.req(p, 'asset', '<asset id>'));
  if (a === null) throw u.fail(404, 'No asset with that id');
  const used = app.findRecordsByFilter('edits', "kind = 'layer' && params ~ {:a}", '', 0, 0, { a: a.id });
  if (used.length > 0) throw u.fail(409, 'This logo is used by ' + used.length + ' logo layer' + (used.length === 1 ? '' : 's') + '; remove those first');
  app.delete(a);
  return { ok: true, deleted: a.id };
}

module.exports = {
  imagesList: imagesList,
  imagesGet: imagesGet,
  imagesImport: imagesImport,
  imagesUpdate: imagesUpdate,
  imagesDuplicate: imagesDuplicate,
  imagesDelete: imagesDelete,
  imagesRender: imagesRender,
  imagesInfo: imagesInfo,
  analyze: analyze,
  filterPreviews: filterPreviews,
  settingsJson: settingsJson,
  settingsUpdate: settingsUpdate,
  status: status,
  ui: ui,
  context: context,
  requestsCreate: requestsCreate,
  requestsList: requestsList,
  requestsGet: requestsGet,
  requestsUpdate: requestsUpdate,
  assetsList: assetsList,
  assetsAdd: assetsAdd,
  assetsDelete: assetsDelete,
};
