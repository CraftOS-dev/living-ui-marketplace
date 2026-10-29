/// <reference path="../pb_data/types.d.ts" />
/**
 * The library: importing originals (uploads or files on this computer),
 * what the engine reads from them, the current preview and thumbnail, and
 * how an image reads in the operations' answers.
 */

const ACCEPT = ['png', 'jpg', 'jpeg', 'jfif', 'webp', 'avif', 'gif', 'bmp', 'tif', 'tiff', 'ico', 'apng', 'jp2', 'tga', 'ppm', 'pgm', 'pbm', 'pcx', 'psd', 'dds', 'icns', 'qoi'];

function U() {
  return require(`${__hooks}/lib_util.js`);
}

function R() {
  return require(`${__hooks}/lib_render.js`);
}

function mustImage(app, ref) {
  const u = U();
  const id = String(ref || '').trim();
  if (id === '') throw u.fail(400, 'image is required (an id from images.list)');
  const rec = u.byId(app, 'images', id);
  if (rec === null) throw u.fail(404, 'No image ' + id + '; see images.list');
  return rec;
}

function extOk(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
  return m !== null && ACCEPT.indexOf(m[1].toLowerCase()) >= 0;
}

/** The active edits of an image, in order, as plain objects. */
function activeEdits(app, imageId) {
  return require(`${__hooks}/lib_stack.js`).load(app, imageId).filter((e) => e.state === 'active');
}

function serialize(app, rec, opts) {
  const u = U();
  const o = opts || {};
  const key = rec.getString('preview');
  const out = {
    id: rec.id,
    name: rec.getString('name'),
    format: rec.getString('format'),
    width: rec.getInt('width'),
    height: rec.getInt('height'),
    bytes: rec.getInt('bytes'),
    frames: rec.getInt('frames') || 1,
    duration_ms: rec.getInt('duration_ms'),
    alpha: rec.getBool('alpha'),
    mode: rec.getString('mode'),
    icc: rec.getString('icc'),
    wide_gamut: rec.getBool('wide_gamut'),
    gps: u.getJson(rec, 'gps'),
    out_width: rec.getInt('out_width') || rec.getInt('width'),
    out_height: rec.getInt('out_height') || rec.getInt('height'),
    edits_count: rec.getInt('edits_count'),
    status: rec.getString('status') || 'pending',
    error: rec.getString('error'),
    origin: rec.getString('origin') || 'you',
    pinned: rec.getBool('pinned'),
    title: rec.getString('title'),
    alt_text: rec.getString('alt_text'),
    caption: rec.getString('caption'),
    keywords: u.getJson(rec, 'keywords') || [],
    notes: rec.getString('notes'),
    last_exported: rec.getString('last_exported'),
    exports_count: rec.getInt('exports_count'),
    original_url: u.fileUrl(rec, 'original'),
    original_path: u.filePath(app, rec, 'original'),
    source_path: rec.getString('source_path'),
    thumb_url: u.fileUrl(rec, 'thumb'),
    preview_url: key !== '' ? '/api/img/cache/' + key + '.webp' : '',
    preview_path: key !== '' ? $filepath.join(R().cacheDir(app), key + '.webp') : '',
    transform: u.getJson(rec, 'transform'),
    created: rec.getString('created'),
    updated: rec.getString('updated'),
  };
  if (o.full) {
    out.exif = u.getJson(rec, 'exif') || {};
    out.dpi = u.getJson(rec, 'dpi');
    out.hash = rec.getString('hash');
  }
  return out;
}

/**
 * Render the current (active) stack: the workspace preview and the
 * thumbnail. Never throws: an engine that is not ready yet leaves the image
 * pending (it shows the original) and it is refreshed once the engine is in.
 */
function refresh(app, rec) {
  const u = U();
  const stack = activeEdits(app, rec.id);
  try {
    const r = R().render(app, rec, stack, { max: 1600, thumb: 320 });
    rec.set('preview', r.key);
    rec.set('out_width', r.width);
    rec.set('out_height', r.height);
    rec.set('transform', r.transform || null);
    if (r.thumb_path && u.exists(r.thumb_path)) rec.set('thumb', $filesystem.fileFromPath(r.thumb_path));
    rec.set('status', 'ready');
    rec.set('error', '');
  } catch (err) {
    const code = err && err.extra ? err.extra.code : '';
    rec.set('status', code === 'engine_unavailable' ? 'pending' : 'failed');
    rec.set('error', String((err && err.message) || err).slice(0, 2000));
    const d = require(`${__hooks}/lib_geom.js`).chain(stack, rec.getInt('width'), rec.getInt('height'));
    rec.set('out_width', d[d.length - 1][0]);
    rec.set('out_height', d[d.length - 1][1]);
  }
  rec.set('edits_count', stack.filter((e) => e.enabled !== false).length);
  rec.set('stack_hash', R().hash(stack.map((e) => [e.kind, e.params, e.enabled !== false])));
  app.save(rec);
  return rec;
}

/** Re-render images left pending while the engine was being set up. */
function refreshPending(app, limit) {
  const rows = app.findRecordsByFilter('images', "status = 'pending' || status = ''", 'created', limit || 20, 0);
  let n = 0;
  for (const r of rows) {
    try {
      probeLater(app, r);
    } catch (err) {
      const code = err && err.extra ? err.extra.code : '';
      if (code === 'engine_unavailable') break;
      r.set('status', 'failed');
      r.set('error', String((err && err.message) || err).slice(0, 2000));
      app.save(r);
      continue;
    }
    refresh(app, r);
    if (r.getString('status') === 'ready') n++;
    else break;
  }
  return n;
}

function applyProbe(rec, p) {
  rec.set('format', p.format);
  rec.set('width', p.width);
  rec.set('height', p.height);
  rec.set('bytes', p.bytes);
  rec.set('frames', p.frames);
  rec.set('duration_ms', p.duration_ms);
  rec.set('alpha', !!p.alpha);
  rec.set('mode', p.mode);
  rec.set('icc', p.icc || '');
  rec.set('wide_gamut', !!p.wide_gamut);
  rec.set('exif', p.exif || {});
  rec.set('gps', p.gps || null);
  rec.set('dpi', p.dpi || null);
  rec.set('hash', p.hash);
}

/**
 * Store one original and read it. file: a PocketBase file (upload or local
 * path). Without the engine, the image waits (pending) and is read later.
 */
function importOne(app, who, file, name, sourcePath) {
  const u = U();
  if (!extOk(name)) throw u.fail(415, '"' + name + '" is not an image file this app reads (' + ACCEPT.slice(0, 9).join(', ') + ' and more; HEIC and camera RAW are not supported).');
  const rec = new Record(app.findCollectionByNameOrId('images'));
  rec.set('name', name.replace(/\.[a-z0-9]+$/i, '').slice(0, 300) || 'Image');
  rec.set('original', file);
  rec.set('origin', who);
  rec.set('status', 'pending');
  rec.set('source_path', sourcePath || '');
  rec.set('format', (/\.([a-z0-9]+)$/i.exec(name) || ['', ''])[1].toUpperCase());
  app.save(rec);
  let probe = null;
  try {
    probe = require(`${__hooks}/lib_engine.js`).call(app, { kind: 'probe', path: u.filePath(app, rec, 'original') }, 60000);
  } catch (err) {
    const code = err && err.extra ? err.extra.code : '';
    if (code === 'engine_unavailable') {
      rec.set('error', String(err.message));
      app.save(rec);
      return rec;
    }
    app.delete(rec);
    throw err;
  }
  applyProbe(rec, probe);
  app.save(rec);
  return refresh(app, rec);
}

/** Read an image imported before the engine was ready. */
function probeLater(app, rec) {
  const u = U();
  if (rec.getString('hash') !== '') return rec;
  const p = require(`${__hooks}/lib_engine.js`).call(app, { kind: 'probe', path: u.filePath(app, rec, 'original') }, 60000);
  applyProbe(rec, p);
  app.save(rec);
  return rec;
}

module.exports = { ACCEPT: ACCEPT, mustImage: mustImage, serialize: serialize, refresh: refresh, refreshPending: refreshPending, importOne: importOne, probeLater: probeLater, activeEdits: activeEdits, extOk: extOk };
