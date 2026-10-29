/// <reference path="../pb_data/types.d.ts" />
/**
 * Every operation (the UI and the AI agent's agent-app CLI call the same
 * routes; operations.json lists them). Handlers run in isolated VMs: they
 * require() what they need, nothing is shared from this file's scope.
 */

/* ------------------------------------------------------------------- app */

routerAdd('GET', '/api/ops/app/guide', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_guide.js`).guide(app)));
routerAdd('GET', '/api/ops/app/status', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).status(app)));
routerAdd('GET', '/api/ops/app/context', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).context(app)));
routerAdd('POST', '/api/ops/app/ui', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).ui(app, e, p)));
routerAdd('GET', '/api/ops/app/schema', (e) => require(`${__hooks}/lib_util.js`).handle(e, () => require(`${__hooks}/lib_kinds.js`).schema()));

routerAdd('GET', '/api/ops/settings/get', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).settingsJson(app)));
routerAdd('POST', '/api/ops/settings/update', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).settingsUpdate(app, e, p)));

routerAdd('GET', '/api/ops/engine/status', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_engine.js`).status(app)));
routerAdd('POST', '/api/ops/engine/install', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const what = u.oneOf(p, 'what', ['core', 'bg', 'bg_detailed'], 'core');
    if (what !== 'core' && u.actor(e) === 'agent') throw u.fail(403, 'Downloading a background model is the person\'s decision (Settings, Background removal); ask them.', { code: 'person_only' });
    return require(`${__hooks}/lib_setup.js`).request(app, what);
  }),
);
routerAdd('POST', '/api/ops/engine/test', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const t = Date.now();
    const r = require(`${__hooks}/lib_engine.js`).call(app, { kind: 'ping' }, 60000);
    return { ok: true, engine: r, ms: Date.now() - t };
  }),
);

/* ---------------------------------------------------------------- images */

routerAdd('GET', '/api/ops/images/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).imagesList(app, p)));
routerAdd('GET', '/api/ops/images/get', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).imagesGet(app, p)));
routerAdd('GET', '/api/ops/images/info', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).imagesInfo(app, e, p)));
routerAdd('POST', '/api/ops/images/render', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).imagesRender(app, e, p)));
// Uploads of several camera photos at once: up to 2 GB per request (PocketBase's default is 32 MB).
routerAdd('POST', '/api/ops/images/import', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).imagesImport(app, e, p)), $apis.bodyLimit(2048 * 1024 * 1024));
routerAdd('POST', '/api/ops/images/update', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).imagesUpdate(app, e, p)));
routerAdd('POST', '/api/ops/images/duplicate', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).imagesDuplicate(app, e, p)));
routerAdd('POST', '/api/ops/images/delete', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).imagesDelete(app, e, p)));
routerAdd('POST', '/api/ops/analyze/image', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).analyze(app, e, p)));
routerAdd('POST', '/api/ops/filters/previews', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).filterPreviews(app, e, p)));

/* ----------------------------------------------------------------- edits */

routerAdd('POST', '/api/ops/edits/add', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_stack.js`).add(app, e, p)));
routerAdd('POST', '/api/ops/edits/update', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_stack.js`).update(app, e, p)));
routerAdd('POST', '/api/ops/edits/move', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_stack.js`).move(app, e, p)));
routerAdd('POST', '/api/ops/edits/remove', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_stack.js`).remove(app, e, p)));
routerAdd('POST', '/api/ops/edits/apply', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_stack.js`).apply(app, e, p)));
routerAdd('POST', '/api/ops/edits/copy', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_stack.js`).copy(app, e, p)));
routerAdd('POST', '/api/ops/edits/reset', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_stack.js`).reset(app, e, p)));

/* ---------------------------------------------------------------- layers */

routerAdd('GET', '/api/ops/layers/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_layers.js`).list(app, p)));
routerAdd('POST', '/api/ops/layers/add', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_layers.js`).add(app, e, p)));
routerAdd('POST', '/api/ops/layers/update', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_layers.js`).update(app, e, p)));
routerAdd('POST', '/api/ops/layers/arrange', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_layers.js`).arrange(app, e, p)));
routerAdd('POST', '/api/ops/layers/remove', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_layers.js`).remove(app, e, p)));

/* --------------------------------------------------------------- history */

routerAdd('GET', '/api/ops/history/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_stack.js`).history(app, p)));
routerAdd('POST', '/api/ops/history/undo', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_stack.js`).undo(app, e, p)));
routerAdd('POST', '/api/ops/history/redo', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_stack.js`).redo(app, e, p)));
routerAdd('POST', '/api/ops/history/revert', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_stack.js`).revertBatch(app, e, u.req(p, 'batch', '<batch id from history.list>'), p);
  }),
);

/* ------------------------------------------------------------- proposals */

routerAdd('GET', '/api/ops/proposals/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const S = require(`${__hooks}/lib_stack.js`);
    const where = [];
    const bind = {};
    if (u.str(p, 'image', '') !== '') {
      where.push('image = {:i}');
      bind.i = u.str(p, 'image', '');
    }
    const st = u.oneOf(p, 'status', ['pending', 'accepted', 'rejected', 'superseded'], 'pending');
    where.push('status = {:s}');
    bind.s = st;
    return { proposals: app.findRecordsByFilter('proposals', where.join(' && '), '-created', u.int(p, 'limit', 50, 1, 500), 0, bind).map((r) => S.serializeProposal(app, r)) };
  }),
);
routerAdd('POST', '/api/ops/proposals/accept', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_stack.js`).decide(app, e, p, true)));
routerAdd('POST', '/api/ops/proposals/reject', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_stack.js`).decide(app, e, p, false)));

/* --------------------------------------------------------------- exports */

routerAdd('POST', '/api/ops/export/estimate', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_export.js`).estimate(app, e, p)));
routerAdd('POST', '/api/ops/export/compare', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_export.js`).compare(app, e, p)));
routerAdd('POST', '/api/ops/export/create', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_export.js`).create(app, e, p)));
routerAdd('GET', '/api/ops/exports/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_export.js`).list(app, p)));
routerAdd('POST', '/api/ops/exports/delete', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_export.js`).remove(app, e, p)));

/* --------------------------------------------------------------- presets */

routerAdd('GET', '/api/ops/presets/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_presets.js`).list(app, p)));
routerAdd('POST', '/api/ops/presets/save', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_presets.js`).save(app, e, p)));
routerAdd('POST', '/api/ops/presets/delete', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_presets.js`).remove(app, e, p)));

/* --------------------------------------------------------------- batches */

routerAdd('GET', '/api/ops/batches/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_batch.js`).list(app, p)));
routerAdd('GET', '/api/ops/batches/get', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_batch.js`).get(app, p)));
routerAdd('POST', '/api/ops/batches/create', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_batch.js`).create(app, e, p)));
routerAdd('POST', '/api/ops/batches/preview', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_batch.js`).preview(app, e, p)));
routerAdd('POST', '/api/ops/batches/run', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_batch.js`).run(app, e, p)));
routerAdd('POST', '/api/ops/batches/cancel', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_batch.js`).cancel(app, e, p)));
routerAdd('POST', '/api/ops/batches/retry', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_batch.js`).retry(app, e, p)));
routerAdd('POST', '/api/ops/batches/delete', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_batch.js`).remove(app, e, p)));

/* ------------------------------------------------------- requests, assets */

routerAdd('GET', '/api/ops/requests/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).requestsList(app, p)));
routerAdd('GET', '/api/ops/requests/get', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).requestsGet(app, p)));
routerAdd('POST', '/api/ops/requests/create', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).requestsCreate(app, e, p)));
routerAdd('POST', '/api/ops/requests/update', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).requestsUpdate(app, e, p)));

routerAdd('GET', '/api/ops/assets/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).assetsList(app)));
routerAdd('POST', '/api/ops/assets/add', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).assetsAdd(app, e, p)));
routerAdd('POST', '/api/ops/assets/delete', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_app.js`).assetsDelete(app, e, p)));

/* ------------------------------------------------------- the preview cache */

// Rendered previews, filter thumbnails and compare crops (names are content hashes).
routerAdd('GET', '/api/img/cache/{path...}', (e) => {
  const rel = String(e.request.pathValue('path') || '');
  if (rel === '' || rel.indexOf('..') >= 0 || /^[\\/]/.test(rel) || !/^[A-Za-z0-9._\-/]+$/.test(rel)) return e.json(400, { status: 400, message: 'bad path' });
  const file = $filepath.join(require(`${__hooks}/lib_render.js`).cacheDir(e.app), rel);
  let bytes;
  try {
    bytes = $os.readFile(file);
  } catch {
    return e.json(404, { status: 404, message: 'Not in the preview cache (it is made again when the image is opened)' });
  }
  const ext = (/\.([a-z]+)$/.exec(rel) || ['', ''])[1];
  const mime = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' }[ext] || 'application/octet-stream';
  e.response.header().set('Cache-Control', 'private, max-age=31536000, immutable');
  return e.blob(200, mime, bytes);
});
