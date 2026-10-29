/// <reference path="../pb_data/types.d.ts" />
/**
 * Exports: one image (its current edits) written as one or more files.
 *
 * An estimate really encodes every output (sizes are never guessed); the
 * files land in the app's work folder until an export keeps them. Exports
 * are stored in the app (download them from Exports) and, when a folder is
 * given, copied there too; a name that exists gets " (2)" and so on, so
 * nothing is ever overwritten. Originals are never touched.
 */

const FORMATS = ['jpeg', 'png', 'webp', 'avif', 'gif', 'ico', 'tiff'];
const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp', avif: 'avif', gif: 'gif', ico: 'ico', tiff: 'tif' };
const LEVELS = ['best', 'balanced', 'small'];

function U() {
  return require(`${__hooks}/lib_util.js`);
}
function E() {
  return require(`${__hooks}/lib_engine.js`);
}
function I() {
  return require(`${__hooks}/lib_images.js`);
}
function R() {
  return require(`${__hooks}/lib_render.js`);
}

function settings(app) {
  return app.findRecordsByFilter('settings', 'id != ""', '', 1, 0)[0];
}

function defaults(app) {
  const s = settings(app);
  return Object.assign({ format: 'webp', quality: 'balanced', metadata: 'basic', strip_gps: true, matte: '#ffffff', effort: 'normal' }, (s && U().getJson(s, 'defaults')) || {});
}

function bad(msg) {
  return U().fail(400, msg);
}

/** One output, checked. */
function output(o, i) {
  const at = 'outputs[' + i + ']';
  if (!o || typeof o !== 'object') throw bad(at + ' must be an object like {"format":"webp","quality":"balanced"}');
  const raw = String(o.format || '').toLowerCase();
  const fmt = { jpg: 'jpeg', tif: 'tiff' }[raw] || raw;
  if (FORMATS.indexOf(fmt) < 0) throw bad(at + '.format must be one of: ' + FORMATS.join(', '));
  const out = { format: fmt };
  const mode = String(o.mode || 'quality');
  if (['quality', 'size', 'lossless'].indexOf(mode) < 0) throw bad(at + '.mode must be quality, size or lossless');
  if (mode === 'size' && ['jpeg', 'webp', 'avif'].indexOf(fmt) < 0) throw bad(at + ': a target size works for jpeg, webp and avif');
  if (mode === 'lossless' && ['webp', 'avif'].indexOf(fmt) < 0 && fmt !== 'png' && fmt !== 'tiff') throw bad(at + ': lossless works for webp, avif, png and tiff');
  out.mode = mode;
  if (mode === 'size') {
    const kb = Number(o.target_kb);
    if (!(kb >= 1 && kb <= 200000)) throw bad(at + '.target_kb must be a size in KB from 1 to 200000');
    out.target_kb = kb;
    if (o.allow_resize === false || o.allow_resize === 'false') out.allow_resize = false;
  } else if (o.quality !== undefined && o.quality !== null && o.quality !== '') {
    if (LEVELS.indexOf(String(o.quality)) >= 0) out.quality = String(o.quality);
    else {
      const q = Number(o.quality);
      if (!(q >= 1 && q <= 100)) throw bad(at + '.quality must be best, balanced, small or a number 1..100');
      out.quality = Math.round(q);
    }
  }
  if (o.longest !== undefined && o.longest !== null && o.longest !== '') {
    const l = Number(o.longest);
    if (!(l >= 1 && l <= 30000)) throw bad(at + '.longest must be pixels from 1 to 30000');
    out.longest = Math.round(l);
  }
  if (o.scale !== undefined && o.scale !== null && o.scale !== '') {
    const s = Number(o.scale);
    if (!(s > 0 && s <= 8)) throw bad(at + '.scale must be above 0 and at most 8 (0.5 = half size)');
    out.scale = s;
  }
  if (o.square !== undefined && o.square !== null && o.square !== '') {
    const q = Number(o.square);
    if (!(q >= 8 && q <= 4096)) throw bad(at + '.square must be pixels from 8 to 4096');
    out.square = Math.round(q);
  }
  if (o.enlarge === true || o.enlarge === 'true') out.enlarge = true;
  for (const k of ['suffix', 'name']) if (o[k]) out[k] = String(o[k]).replace(/[\\/:*?"<>|]/g, '').slice(0, 80);
  if (Array.isArray(o.ico_sizes)) out.ico_sizes = o.ico_sizes.map((x) => Math.round(Number(x))).filter((x) => x >= 8 && x <= 256);
  if (o.palette) out.palette = ['auto', 'on', 'off'].indexOf(String(o.palette)) >= 0 ? String(o.palette) : 'auto';
  if (o.progressive === false || o.progressive === 'false') out.progressive = false;
  if (o.subsampling) out.subsampling = ['auto', '420', '444'].indexOf(String(o.subsampling)) >= 0 ? String(o.subsampling) : 'auto';
  if (o.effort) out.effort = ['fast', 'normal', 'max'].indexOf(String(o.effort)) >= 0 ? String(o.effort) : 'normal';
  return out;
}

/**
 * The outputs and shared options of a call or preset: outputs (a list),
 * or format/quality/mode/target_kb/longest for one output; metadata,
 * strip_gps, matte.
 */
function outputsFrom(app, p, img) {
  const u = U();
  const d = defaults(app);
  let raw = p.outputs;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      throw bad('outputs must be a JSON list, e.g. \'[{"format":"webp","quality":"balanced"},{"format":"jpeg","quality":80}]\'');
    }
  }
  let base = {};
  const presetRef = p.preset !== undefined && p.preset !== '' ? String(p.preset) : '';
  if (presetRef !== '') {
    const pr = require(`${__hooks}/lib_presets.js`).mustPreset(app, presetRef);
    if (pr.getString('kind') !== 'export') throw bad('Preset "' + pr.getString('name') + '" is not an export preset (see presets.list --kind export)');
    base = u.getJson(pr, 'data') || {};
    raw = base.outputs;
  }
  if (!raw) {
    raw = [{ format: p.format || d.format, quality: p.quality !== undefined ? p.quality : d.quality, mode: p.mode, target_kb: p.target_kb, longest: p.longest, scale: p.scale, effort: p.effort || d.effort }];
  }
  if (!Array.isArray(raw) || raw.length === 0) throw bad('outputs must be a non-empty list');
  if (raw.length > 12) throw bad('At most 12 outputs per export');
  const outs = raw.map(output);
  const pick = (k, dflt) => (p[k] !== undefined && p[k] !== '' && p[k] !== null ? p[k] : base[k] !== undefined ? base[k] : dflt);
  const metadata = String(pick('metadata', d.metadata));
  if (['keep', 'basic', 'none'].indexOf(metadata) < 0) throw bad('metadata must be keep, basic or none');
  const stripGps = pick('strip_gps', d.strip_gps);
  const matte = String(pick('matte', d.matte));
  if (!/^#[0-9a-fA-F]{6}$/.test(matte)) throw bad('matte must be a colour like #ffffff');
  const common = { metadata: metadata, strip_gps: !(stripGps === false || stripGps === 'false'), matte: matte };
  if (img !== null && metadata !== 'none' && img.getString('alt_text') !== '') common.description = img.getString('alt_text');
  for (const o of outs) {
    for (const k of Object.keys(common)) if (o[k] === undefined) o[k] = common[k];
    if (!o.effort) o.effort = d.effort;
  }
  return { outputs: outs, common: common, preset: presetRef };
}

function slug(name) {
  return (
    String(name || 'image')
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'image'
  );
}

/** File names for the outputs of one image (unique within the set). */
function namesFor(base, outs) {
  const seen = {};
  return outs.map((o) => {
    let stem = o.name ? o.name : base + (o.suffix || '');
    let n = stem + '.' + EXT[o.format];
    let k = 2;
    while (seen[n.toLowerCase()]) {
      n = stem + ' (' + k++ + ').' + EXT[o.format];
    }
    seen[n.toLowerCase()] = true;
    return n;
  });
}

/** Encode every output of an image into a fresh work folder (its own edits, then extraStack; useOwn false leaves its own edits out). */
function encode(app, img, outs, names, extraStack, useOwn) {
  const u = U();
  const stack = (useOwn === false ? [] : I().activeEdits(app, img.id)).concat(extraStack || []);
  const mk = R().ensureMasks(app, img, stack);
  const dir = $filepath.join(R().workDir(app), u.newId());
  $os.mkdirAll(dir, 0o755);
  const job = {
    kind: 'export',
    path: R().originalPath(app, img),
    stack: stack.map(R().entry),
    masks: mk.masks,
    logos: R().logosFor(app, stack),
    outputs: outs.map((o, i) => Object.assign({}, o, { out: $filepath.join(dir, names[i]) })),
  };
  const res = E().call(app, job, 600000);
  return { dir: dir, outputs: res.outputs, ms: res.ms };
}

function facts(o, r, name, sourceBytes) {
  return {
    name: name,
    format: o.format,
    width: r.width,
    height: r.height,
    bytes: r.bytes,
    quality: r.quality === undefined ? null : r.quality,
    frames: r.frames || 1,
    saved_pct: sourceBytes > 0 ? Math.round((1 - r.bytes / sourceBytes) * 1000) / 10 : null,
    met_target: r.met_target === undefined ? null : r.met_target,
    shrunk: !!r.shrunk,
    path: r.path,
  };
}

/** export.estimate: real encodes, nothing kept. */
function estimate(app, e, p) {
  const u = U();
  const img = I().mustImage(app, u.req(p, 'image', '<image id>'));
  const spec = outputsFrom(app, p, img);
  const names = namesFor(slug(img.getString('name')), spec.outputs);
  const res = encode(app, img, spec.outputs, names);
  const src = img.getInt('bytes');
  const out = { image: img.id, source: { bytes: src, format: img.getString('format'), width: img.getInt('out_width') || img.getInt('width'), height: img.getInt('out_height') || img.getInt('height') }, outputs: res.outputs.map((r, i) => facts(spec.outputs[i], r, names[i], src)), ms: res.ms, settings: spec.common };
  for (const o of out.outputs) delete o.path;
  try {
    $os.removeAll(res.dir);
  } catch {
    /* cleared by the nightly prune */
  }
  return out;
}

/** A free name in a folder: "name.ext", then "name (2).ext", ... */
function freeName(folder, name) {
  const u = U();
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let cand = name;
  let k = 2;
  while (u.exists($filepath.join(folder, cand))) cand = stem + ' (' + k++ + ')' + ext;
  return cand;
}

/** Copy a file into a folder; collision: rename (default), skip or overwrite. */
function copyTo(folder, path, name, collision) {
  const u = U();
  $os.mkdirAll(folder, 0o755);
  let target = $filepath.join(folder, name);
  if (u.exists(target)) {
    if (collision === 'skip') return { path: target, skipped: true };
    if (collision !== 'overwrite') target = $filepath.join(folder, freeName(folder, name));
  }
  // Bytes as they are (never through a string, which would corrupt them).
  $os.writeFile(target, $os.readFile(path), 0o644);
  return { path: target, skipped: false };
}

function checkFolder(app, e, folder) {
  const u = U();
  if (folder === '') return '';
  if (!$filepath.isAbs(folder)) throw u.fail(400, 'folder must be an absolute path, e.g. C:\\Users\\me\\Pictures\\Exports');
  if (u.actor(e) === 'agent') {
    const allowed = (settings(app) && settings(app).getString('export_folder')) || '';
    const inside = allowed !== '' && (folder.toLowerCase() + '\\').indexOf(allowed.toLowerCase().replace(/[\\/]+$/, '') + '\\') === 0;
    if (!inside) throw u.fail(403, 'You can write files only into the export folder the person set in Settings' + (allowed ? ' (' + allowed + ')' : ' (none is set)') + '. Exports are always kept in the app; leave folder out.', { code: 'folder_not_allowed' });
  }
  return folder;
}

function serialize(app, rec) {
  const u = U();
  return {
    id: rec.id,
    image: rec.getString('image'),
    batch: rec.getString('batch'),
    name: rec.getString('name'),
    format: rec.getString('format'),
    width: rec.getInt('width'),
    height: rec.getInt('height'),
    bytes: rec.getInt('bytes'),
    source_bytes: rec.getInt('source_bytes'),
    settings: u.getJson(rec, 'settings') || {},
    folder_path: rec.getString('folder_path'),
    url: u.fileUrl(rec, 'file'),
    path: u.filePath(app, rec, 'file'),
    requested_by: rec.getString('requested_by') || 'you',
    created: rec.getString('created'),
  };
}

/** Keep one encoded file as an export record (and copy it to a folder). */
function keep(app, who, img, batchId, o, r, name, folder, collision) {
  const rec = new Record(app.findCollectionByNameOrId('exports'));
  if (img !== null) rec.set('image', img.id);
  if (batchId) rec.set('batch', batchId);
  const f = $filesystem.fileFromPath(r.path);
  f.name = name;
  rec.set('file', f);
  rec.set('name', name);
  rec.set('format', o.format);
  rec.set('width', r.width);
  rec.set('height', r.height);
  rec.set('bytes', r.bytes);
  rec.set('source_bytes', img !== null ? img.getInt('bytes') : 0);
  rec.set('settings', Object.assign({}, o, { quality_used: r.quality === undefined ? null : r.quality }));
  rec.set('requested_by', who);
  let copied = null;
  if (folder) {
    copied = copyTo(folder, r.path, name, collision);
    rec.set('folder_path', copied.skipped ? '' : copied.path);
  }
  app.save(rec);
  return { rec: rec, copied: copied };
}

/** export.create: encode and keep. */
function create(app, e, p) {
  const u = U();
  const who = u.actor(e);
  const img = I().mustImage(app, u.req(p, 'image', '<image id>'));
  const spec = outputsFrom(app, p, img);
  const folder = checkFolder(app, e, u.str(p, 'folder', ''));
  const base = u.str(p, 'name', '') !== '' ? slug(u.str(p, 'name', '')) : slug(img.getString('name'));
  const names = namesFor(base, spec.outputs);
  const res = encode(app, img, spec.outputs, names);
  const kept = [];
  for (let i = 0; i < res.outputs.length; i++) {
    const k = keep(app, who, img, '', spec.outputs[i], res.outputs[i], names[i], folder, 'rename');
    kept.push(Object.assign(serialize(app, k.rec), { saved_pct: facts(spec.outputs[i], res.outputs[i], names[i], img.getInt('bytes')).saved_pct, quality: res.outputs[i].quality === undefined ? null : res.outputs[i].quality, met_target: res.outputs[i].met_target === undefined ? null : res.outputs[i].met_target }));
  }
  try {
    $os.removeAll(res.dir);
  } catch {
    /* cleared by the nightly prune */
  }
  const fresh = u.byId(app, 'images', img.id);
  fresh.set('last_exported', u.now());
  fresh.set('exports_count', fresh.getInt('exports_count') + kept.length);
  app.save(fresh);
  return { ok: true, exports: kept, ms: res.ms };
}

/** The same region before and after encoding with one output's settings, at 100 %. */
function compare(app, e, p) {
  const u = U();
  const img = I().mustImage(app, u.req(p, 'image', '<image id>'));
  const spec = outputsFrom(app, p, img);
  const o = spec.outputs[0];
  const stack = I().activeEdits(app, img.id);
  const mk = R().ensureMasks(app, img, stack);
  const key = R().hash([img.getString('hash'), stack.map((x) => [x.kind, x.params, x.enabled !== false]), o, u.int(p, 'cx', -1, -1, 100000), u.int(p, 'cy', -1, -1, 100000), u.int(p, 'w', 900, 64, 4000), u.int(p, 'h', 600, 64, 4000)]);
  const dir = $filepath.join(R().cacheDir(app), 'cmp-' + key);
  const res = E().call(app, {
    kind: 'compare',
    path: R().originalPath(app, img),
    stack: stack.map(R().entry),
    masks: mk.masks,
    logos: R().logosFor(app, stack),
    spec: o,
    region: { cx: u.has(p, 'cx') ? u.int(p, 'cx', 0, 0, 100000) : null, cy: u.has(p, 'cy') ? u.int(p, 'cy', 0, 0, 100000) : null, w: u.int(p, 'w', 900, 64, 4000), h: u.int(p, 'h', 600, 64, 4000) },
    out_dir: dir,
  }, 300000);
  return {
    before: '/api/img/cache/cmp-' + key + '/before.png',
    after: '/api/img/cache/cmp-' + key + '/after.png',
    box: res.box,
    bytes: res.bytes,
    width: res.width,
    height: res.height,
    quality: res.quality,
    ms: res.ms,
  };
}

function list(app, p) {
  const u = U();
  const filter = [];
  const sql = [];
  const bind = {};
  const by = (field, key, value) => {
    filter.push(field + ' = {:' + key + '}');
    sql.push('[[' + field + ']] = {:' + key + '}');
    bind[key] = value;
  };
  if (u.str(p, 'image', '') !== '') by('image', 'i', u.str(p, 'image', ''));
  if (u.str(p, 'batch', '') !== '') by('batch', 'b', u.str(p, 'batch', ''));
  const fmt = u.oneOf(p, 'format', FORMATS, '');
  if (fmt !== '') by('format', 'f', fmt);
  const limit = u.int(p, 'limit', 100, 1, 1000);
  const rows = app.findRecordsByFilter('exports', filter.length ? filter.join(' && ') : 'id != ""', '-created', limit, 0, bind);
  const total = u.rows(app, 'SELECT COUNT(*) AS n, COALESCE(SUM([[bytes]]), 0) AS b FROM {{exports}}' + (sql.length ? ' WHERE ' + sql.join(' AND ') : ''), { n: 0, b: 0 }, bind)[0];
  return { exports: rows.map((r) => serialize(app, r)), total: total.n, total_bytes: total.b };
}

function remove(app, e, p) {
  const u = U();
  const ids = (u.list(p, 'exports') || []).map(String);
  if (u.str(p, 'export', '') !== '') ids.push(u.str(p, 'export', ''));
  if (ids.length === 0) throw u.fail(400, 'export (or exports, a list of ids) is required');
  let n = 0;
  for (const id of ids) {
    const r = u.byId(app, 'exports', id);
    if (r === null) continue;
    app.delete(r);
    n++;
  }
  return { ok: true, deleted: n };
}

module.exports = { FORMATS: FORMATS, EXT: EXT, defaults: defaults, outputsFrom: outputsFrom, namesFor: namesFor, slug: slug, encode: encode, keep: keep, copyTo: copyTo, checkFolder: checkFolder, serialize: serialize, estimate: estimate, create: create, compare: compare, list: list, remove: remove, facts: facts };
