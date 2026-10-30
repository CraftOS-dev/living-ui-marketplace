/// <reference path="../pb_data/types.d.ts" />
/**
 * Turning stacks into pictures: the engine job inputs, the preview cache and
 * the background masks.
 *
 * A preview is the image's original run through a stack at a size (1600 px
 * on the long side for the workspace, 320 for thumbnails). Its file name is
 * a hash of what went into it, so the same stack is never rendered twice;
 * files live in <data>/img-engine/cache and are served at
 * /api/img/cache/<key>.<ext>. A remove_bg edit's mask is made once (a model
 * run) and kept on the edit, keyed by everything above it in the stack.
 */

function U() {
  return require(`${__hooks}/lib_util.js`);
}

function E() {
  return require(`${__hooks}/lib_engine.js`);
}

function cacheDir(app) {
  const p = E().paths(app).cache;
  $os.mkdirAll(p, 0o755);
  return p;
}

function workDir(app) {
  const p = E().paths(app).work;
  $os.mkdirAll(p, 0o755);
  return p;
}

function originalPath(app, img) {
  return U().filePath(app, img, 'original');
}

/** An edit as the engine takes it. */
function entry(e) {
  return { id: e.id, kind: e.kind, params: e.params, enabled: e.enabled !== false };
}

/** The part of an edit that changes pixels (for cache keys). */
function sig(e, maskKeys) {
  return [e.kind, e.params, e.enabled !== false, e.kind === 'remove_bg' ? maskKeys[e.id] || '' : ''];
}

function hash(v) {
  return $security.sha256(U().canonical(v)).slice(0, 40);
}

/** Logo files for logo layers (edit id -> path). */
function logosFor(app, stack) {
  const out = {};
  for (const e of stack) {
    if (e.kind === 'layer' && e.params && e.params.type === 'logo' && e.params.asset) {
      const a = U().byId(app, 'assets', e.params.asset);
      if (a !== null) out[e.id] = U().filePath(app, a, 'file');
    }
  }
  return out;
}

/**
 * Make sure every remove_bg edit in the stack has its mask. stack: plain
 * edits ({id, kind, params, enabled, rec?}); records are updated with their
 * mask; drafts get a mask file in the cache. Returns { masks, keys }.
 */
function ensureMasks(app, img, stack) {
  const masks = {};
  const keys = {};
  const above = [];
  for (const e of stack) {
    if (e.kind === 'remove_bg' && e.enabled !== false) {
      const key = hash([img.getString('hash'), above.map((x) => sig(x, keys)), e.params.model || 'fast']);
      keys[e.id] = key;
      const rec = e.rec || U().byId(app, 'edits', e.id);
      if (rec !== null && rec.getString('mask_key') === key && rec.getString('mask') !== '') {
        masks[e.id] = U().filePath(app, rec, 'mask');
      } else {
        const cached = $filepath.join(cacheDir(app), 'mask-' + key.slice(0, 20) + '.png');
        if (!U().exists(cached)) {
          const res = E().call(
            app,
            {
              kind: 'mask',
              path: originalPath(app, img),
              stack: above.map(entry),
              masks: Object.assign({}, masks),
              logos: logosFor(app, above),
              model: e.params.model || 'fast',
              models_dir: E().paths(app).models,
              out: cached,
            },
            180000,
          );
          if (rec !== null) rec.set('mask_info', { kept_pct: res.kept_pct, soft_edge_pct: res.soft_edge_pct, ms: res.ms });
        }
        if (rec !== null) {
          rec.set('mask', $filesystem.fileFromPath(cached));
          rec.set('mask_key', key);
          app.save(rec);
          masks[e.id] = U().filePath(app, rec, 'mask');
        } else {
          masks[e.id] = cached;
        }
      }
    }
    if (e.kind !== 'layer') above.push(e);
  }
  return { masks: masks, keys: keys };
}

/**
 * Render a stack. opts: max (long side, 0 = full size), thumb (size),
 * region ({x,y,w,h} of the final image at full size), histogram, fmt.
 * Returns { key, url, path, width, height (full size), chain, alpha, ms, cached }.
 */
function render(app, img, stack, opts) {
  const o = opts || {};
  const max = o.max === undefined ? 1600 : o.max;
  const mk = ensureMasks(app, img, stack);
  const fmt = o.fmt || 'webp';
  const withLayers = o.layers !== false;
  const key = hash([img.getString('hash'), stack.map((e) => sig(e, mk.keys)), max, o.region || null, fmt, logosFor(app, stack), withLayers]);
  const dir = cacheDir(app);
  const file = $filepath.join(dir, key + '.' + fmt);
  const meta = $filepath.join(dir, key + '.json');
  const thumbFile = o.thumb ? $filepath.join(dir, key + '-t' + o.thumb + '.webp') : '';
  if (U().exists(file) && U().exists(meta) && (!thumbFile || U().exists(thumbFile)) && !o.histogram) {
    try {
      const m = JSON.parse(U().readText(meta));
      m.cached = true;
      // The meta is shared by calls with and without a thumbnail: this call's thumbnail (it exists).
      m.thumb_path = thumbFile;
      return m;
    } catch {
      /* render again */
    }
  }
  const job = {
    kind: 'render',
    path: originalPath(app, img),
    stack: stack.map(entry),
    masks: mk.masks,
    logos: logosFor(app, stack),
    max: max,
    out: file,
    fmt: fmt,
  };
  if (o.region) job.region = o.region;
  if (!withLayers) job.layers = false;
  if (thumbFile) job.thumb = { out: thumbFile, size: o.thumb };
  if (o.histogram) job.histogram = true;
  const res = E().call(app, job, o.region || max === 0 ? 240000 : 120000);
  const out = {
    key: key,
    url: '/api/img/cache/' + key + '.' + fmt,
    path: file,
    thumb_path: thumbFile,
    width: res.width,
    height: res.height,
    preview_width: res.preview ? res.preview.width : 0,
    preview_height: res.preview ? res.preview.height : 0,
    chain: res.chain,
    alpha: res.alpha,
    region: res.region || null,
    transform: res.transform || null,
    ms: res.ms,
    cached: false,
  };
  $os.writeFile(meta, JSON.stringify(out), 0o644);
  if (res.histogram) out.histogram = res.histogram;
  return out;
}

/** Remove cache files older than days (they are re-made on demand). */
function prune(app, days) {
  const dir = cacheDir(app);
  const cut = Date.now() - days * 86400000;
  let n = 0;
  let entries = [];
  try {
    entries = $os.readDir(dir);
  } catch {
    return 0;
  }
  for (const d of entries) {
    try {
      const info = d.info();
      if (info.modTime().unixMilli() < cut) {
        $os.remove($filepath.join(dir, d.name()));
        n++;
      }
    } catch {
      /* in use */
    }
  }
  return n;
}

module.exports = { cacheDir: cacheDir, workDir: workDir, originalPath: originalPath, entry: entry, ensureMasks: ensureMasks, render: render, logosFor: logosFor, hash: hash, prune: prune };
