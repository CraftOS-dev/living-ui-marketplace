/// <reference path="../pb_data/types.d.ts" />
/**
 * Files: protected file fields are served only through operations that
 * check the caller's rights first (ERP pattern), never by PocketBase file
 * URLs. People upload in multipart forms; your AI agent names a local file
 * by path (it attaches files from its own workspace). Inside the app's own
 * folder only uploaded files (pb_data/storage) can be named: the rest holds
 * the database, the agent token and the seal key.
 *
 *   fileParam(ctx, p, field, pathParam) -> a file to set on a record, or null
 *   serve(ctx, rec, field, name, download) -> streams the file to a person;
 *       your AI agent gets { path, name, mime, size } to read it from disk
 *   csvInput(ctx, p, fileField, textParam) -> CSV text from an upload, a path or a param
 *   recordImport(ctx, kind, status, report, rows) -> imports row id
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}

const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif', csv: 'text/csv', txt: 'text/plain', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

function mimeOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
  return m ? MIME[m[1].toLowerCase()] || 'application/octet-stream' : 'application/octet-stream';
}

function uploaded(e, field) {
  try {
    const files = e.findUploadedFiles(field);
    return files.length > 0 ? files[0] : null;
  } catch {
    return null;
  }
}

function localFile(ctx, path, name) {
  const util = u();
  if (!ctx || ctx.isAgent !== true) throw util.fail(403, name + ' is for your AI agent; upload the file instead.', 'not_permitted', { param: name });
  let real = '';
  try {
    real = $filepath.clean($filepath.isAbs(path) ? path : $filepath.join($os.getwd(), path));
  } catch {
    throw util.fail(400, 'Give the absolute path of the file in ' + name + '.', 'invalid_param', { param: name });
  }
  const appDir = $filepath.clean($filepath.join(__hooks, '..', '..'));
  const uploads = $filepath.clean($filepath.join(__hooks, '..', 'pb_data', 'storage'));
  const sep = $filepath.join('a', 'b').charAt(1);
  const low = String(real).toLowerCase();
  const under = (dir) => low.indexOf(String(dir).toLowerCase() + sep) === 0;
  if ((under(appDir) || low === String(appDir).toLowerCase()) && !under(uploads)) throw util.fail(403, "Files inside the app's own folder cannot be attached.", 'not_permitted', { param: name });
  try {
    if ($os.stat(real).isDir()) throw util.fail(400, name + ' is a folder, not a file: ' + path, 'invalid_param', { param: name });
  } catch (err) {
    if (err && err.status) throw err;
    throw util.fail(400, 'No file at ' + name + ' "' + path + '". Give the absolute path of the file.', 'invalid_param', { param: name });
  }
  return $filesystem.fileFromPath(real);
}

function fileParam(ctx, p, field, pathParam) {
  const f = ctx.e ? uploaded(ctx.e, field) : null;
  if (f !== null) return f;
  const path = u().str(p, pathParam || 'path', '');
  if (path !== '') return localFile(ctx, path, pathParam || 'path');
  return null;
}

function absPath(app, rec, field) {
  const p = $filepath.join(app.dataDir(), 'storage', rec.baseFilesPath(), rec.getString(field));
  return $filepath.isAbs(p) ? p : $filepath.join($os.getwd(), p);
}

function serve(ctx, rec, field, name, download) {
  const util = u();
  const stored = rec.getString(field);
  if (stored === '') throw util.fail(404, 'No file.', 'not_found');
  const ext = /\.[a-z0-9]+$/i.exec(stored);
  const nice = String(name || stored).replace(/["\\\r\n/]/g, '_') + (ext && String(name || '').toLowerCase().slice(-ext[0].length) !== ext[0].toLowerCase() ? ext[0] : '');
  if (ctx.isAgent || ctx.e === null) {
    let size = 0;
    try {
      size = $os.stat(absPath(ctx.app, rec, field)).size();
    } catch {
      size = 0;
    }
    return { path: absPath(ctx.app, rec, field), name: nice, mime: mimeOf(stored), size: size };
  }
  const fsys = ctx.app.newFilesystem();
  try {
    const reader = fsys.getReader(rec.baseFilesPath() + '/' + stored);
    try {
      ctx.e.response.header().set('Content-Disposition', (download ? 'attachment' : 'inline') + '; filename="' + nice + '"');
      ctx.e.response.header().set('Cache-Control', 'private, max-age=300');
      ctx.e.response.header().set('X-Content-Type-Options', 'nosniff');
      // An SVG never runs anything, even opened on its own: no scripts, no outside loads.
      if (mimeOf(stored) === 'image/svg+xml') ctx.e.response.header().set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox");
      ctx.e.stream(200, mimeOf(stored), reader);
    } finally {
      reader.close();
    }
  } finally {
    fsys.close();
  }
  return { __streamed: true };
}

/** CSV text from an uploaded file field, a path your AI agent gives, or a text param. */
function csvInput(ctx, p, fileField, textParam) {
  const util = u();
  const f = ctx.e ? uploaded(ctx.e, fileField) : null;
  if (f !== null) {
    const reader = f.reader.open();
    try {
      return toString(reader);
    } finally {
      reader.close();
    }
  }
  const path = util.str(p, 'path', '');
  if (path !== '') {
    localFile(ctx, path, 'path');
    return toString($os.readFile(path));
  }
  const t = util.str(p, textParam || 'csv', '');
  if (t === '') throw util.fail(400, 'Give the CSV as a file, a --path or --' + (textParam || 'csv') + ' text.', 'missing_param', { param: textParam || 'csv' });
  if (t.length > 5000000) throw util.fail(400, 'The CSV is too large (5 MB at most).', 'invalid_param');
  return t;
}

function recordImport(ctx, kind, status, report, rows) {
  const util = u();
  const r = util.newRecord(ctx.app, 'imports');
  r.set('kind', kind);
  r.set('status', status);
  r.set('report', report);
  r.set('rows', rows || 0);
  r.set('member', ctx.memberId || '');
  r.set('actor', ctx.isAgent ? 'agent' : ctx.actor === 'person' ? 'person' : 'system');
  ctx.app.save(r);
  return r.id;
}

function importsList(ctx, p) {
  const util = u();
  const kind = util.str(p, 'kind', '');
  const rows = util.findMany(ctx.app, 'imports', kind !== '' ? 'kind = {:k}' : '1=1', '-created', util.int(p, 'limit', 30, 1, 200), { k: kind });
  return { imports: rows.map((r) => ({ id: r.id, kind: r.getString('kind'), status: r.getString('status'), rows: r.getInt('rows'), report: util.jsonOf(r, 'report', {}) || {}, actor: r.getString('actor'), member: r.getString('member'), created: r.getString('created') })) };
}

module.exports = { mimeOf: mimeOf, uploaded: uploaded, localFile: localFile, fileParam: fileParam, absPath: absPath, serve: serve, csvInput: csvInput, recordImport: recordImport, importsList: importsList };
