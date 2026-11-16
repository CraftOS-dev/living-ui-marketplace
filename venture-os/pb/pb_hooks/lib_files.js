/// <reference path="../pb_data/types.d.ts" />
/**
 * Files (kernel-records, SPEC 4.5): every stored file of the firm, owned by
 * a record (a deal, company, person, fund, LP or another module's record by
 * collection and id), in a folder, with versions by name within a folder,
 * its content hash, the NDA flag and its text layer.
 *
 * Rights: reading needs view rights on the owner's module (a deal's files
 * follow the deal: restricted deals only to the deal team and the owner);
 * writing needs edit. Scouts (roles with own_items) reach only the files of
 * the intake items they submitted (intake_items.submitted_by). An NDA file opens only for its deal team, and for
 * your AI agent only while a person's ask about its deal is pending
 * (lib_agent.ndaAllowed: an NDA trigger fired for it in the last 24 hours
 * and not yet answered; the read is written to the audit trail). Fund and LP files follow the fund data switch for your AI agent.
 * Files are served through operations only (the file field is protected):
 * people get the bytes, your AI agent gets the local path to read.
 *
 * The text step runs beside the request: each new file gets a file_texts
 * row (state waiting, written with SQL so an Undo of the upload never
 * meets it), kick() starts engine/textlayer.mjs (Node) for up to two files
 * at a time without waiting for it, and collect() stores the content hash
 * and the pages once the engine's answer is on disk (on the next read of
 * the file, and every minute from cron_records.js), then emits
 * file.text_ready { file, text_state, ocr_pages, owner_collection,
 * owner_id, deal } once per version, whatever the outcome. A page whose
 * text layer holds fewer than 20 characters (a scan, a picture) is marked
 * needs_ocr for your AI agent (pages.set-ocr).
 *
 * Exports for other modules (exact signatures):
 *   add(ctx, { owner_collection, owner_id, name?, origin?, nda?, folder?, deal?, source_ref?, path | upload }) -> file view   (emits file.added)
 *   fromPath(ctx, { path, owner_collection, owner_id, name?, origin?, nda?, folder?, deal?, source_ref? }) -> file view
 *   text(app, fileId) -> [{ page_no, text, chars, needs_ocr, origin, width, height }]
 *   pathOf(app, fileId) -> absolute local path of the stored file
 *   move(ctx, fileId, { owner_collection?, owner_id?, folder?, deal? }) -> file view (every version)
 *   canRead(ctx, fileRecord, { deleted? }) -> { ok, reason }
 * Kept from HR OS for the kernel: mimeOf, uploaded, localFile, fileParam, absPath, serve, csvInput.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

// Who owns a file -> the module whose rights apply.
const OWNERS = {
  deals: 'pipeline',
  companies: 'network',
  people: 'network',
  intake_items: 'intake',
  notes: 'pipeline',
  entities: 'funds',
  lps: 'lps',
  capital_events: 'funds',
  quarters: 'funds',
  reports: 'funds',
  statements: 'funds',
  holdings: 'portfolio',
  updates: 'portfolio',
  board_meetings: 'portfolio',
  memos: 'committee',
  ic_meetings: 'committee',
  theses: 'markets',
};
// Owners whose files are fund or LP data: your AI agent reads them only while settings.agent_sees_fund_data is on.
const FUND_DATA = ['lps', 'capital_events', 'quarters', 'reports', 'statements'];
const ORIGINS = ['upload', 'email', 'agent', 'import', 'link', 'generated', 'system'];
const MAX_BYTES = 209715200;
const MAX_FILES = 50;
const ENGINE_TIMEOUT_S = 600;
const MAX_RUNNING = 2;
const OCR_BELOW_CHARS = 20;

const MIME = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  heic: 'image/heic',
  heif: 'image/heif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  bmp: 'image/bmp',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  txt: 'text/plain',
  md: 'text/markdown',
  vtt: 'text/vtt',
  srt: 'text/plain',
  json: 'application/json',
  eml: 'message/rfc822',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
};
const TEXT_KIND = { pdf: 'pdf', pptx: 'office', docx: 'office', txt: 'plain', md: 'plain', csv: 'plain', tsv: 'plain', vtt: 'plain', srt: 'plain', json: 'plain', eml: 'plain', png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', heic: 'image', heif: 'image', tif: 'image', tiff: 'image', bmp: 'image' };

function nowIso() {
  return new Date().toISOString();
}

function extOf(name) {
  const m = /\.([a-z0-9]{1,10})$/i.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

function mimeOf(name) {
  return MIME[extOf(name)] || 'application/octet-stream';
}

function kindOfExt(ext) {
  return TEXT_KIND[ext] || 'none';
}

/* ------------------------------------------- HR OS helpers (kept whole) */

function uploaded(e, field) {
  try {
    const files = e.findUploadedFiles(field);
    return files.length > 0 ? files[0] : null;
  } catch {
    return null;
  }
}

function uploadedAll(e, field) {
  try {
    const files = e.findUploadedFiles(field);
    const out = [];
    for (let i = 0; i < files.length; i++) out.push(files[i]);
    return out;
  } catch {
    return [];
  }
}

function appDir() {
  return $filepath.clean($filepath.join(__hooks, '..', '..'));
}

function under(path, dir) {
  const sep = $filepath.join('a', 'b').charAt(1);
  const low = String(path).toLowerCase();
  const d = String(dir).toLowerCase();
  return low === d || low.indexOf(d + sep) === 0;
}

/** A local file your AI agent names by path (never the app's own folder, except stored uploads). */
function localFile(ctx, path, name) {
  const util = u();
  if (!ctx || ctx.isAgent !== true) throw util.fail(403, name + ' is for your AI agent; upload the file instead.', 'not_permitted', { param: name });
  const real = cleanPath(path, name);
  const uploads = $filepath.clean($filepath.join(__hooks, '..', 'pb_data', 'storage'));
  if (under(real, appDir()) && !under(real, uploads)) throw util.fail(403, "Files inside the app's own folder cannot be attached.", 'not_permitted', { param: name });
  statFile(real, name);
  return $filesystem.fileFromPath(real);
}

function cleanPath(path, name) {
  const util = u();
  const s = String(path || '').trim();
  if (s === '') throw util.fail(400, 'Give the absolute path of the file in ' + name + '.', 'missing_param', { param: name });
  try {
    return $filepath.clean($filepath.isAbs(s) ? s : $filepath.join($os.getwd(), s));
  } catch {
    throw util.fail(400, 'Give the absolute path of the file in ' + name + '.', 'invalid_param', { param: name });
  }
}

function statFile(real, name) {
  const util = u();
  let st;
  try {
    st = $os.stat(real);
  } catch {
    throw util.fail(400, 'No file at ' + name + ' "' + real + '". Give the absolute path of the file.', 'invalid_param', { param: name });
  }
  if (st.isDir()) throw util.fail(400, name + ' is a folder, not a file: ' + real, 'invalid_param', { param: name });
  return st;
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

/* --------------------------------------------------------------- rights */

/** The owner of a new file: { collection, id, module, deal } (404 when the record is not there). */
function ownerOf(app, collection, id) {
  const util = u();
  const coll = String(collection || '').trim();
  if (OWNERS[coll] === undefined) throw util.fail(400, 'owner_collection must be one of: ' + Object.keys(OWNERS).join(', ') + '.', 'invalid_param', { param: 'owner_collection', allowed: Object.keys(OWNERS) });
  let rec = null;
  if (coll === 'deals') rec = L('lib_deals').ref(app, id);
  else if (coll === 'companies' || coll === 'people') rec = L('lib_records').resolve(app, coll, id);
  else rec = util.byId(app, coll, String(id || ''));
  if (rec === null) throw util.fail(404, 'No ' + coll + ' record "' + id + '".', 'not_found', { param: 'owner_id' });
  return { collection: coll, id: rec.id, module: OWNERS[coll], deal: coll === 'deals' ? rec.id : '' };
}

function no(reason) {
  return { ok: false, reason: reason };
}

/** Owner rights (view or edit) for ctx on a file's owner and deal. */
function ownerRights(ctx, coll, ownerId, dealId, level) {
  const auth = L('lib_auth');
  const D = L('lib_deals');
  if (ctx.actor === 'system') return { ok: true };
  // Scouts: only the files of intake items they submitted (never a deal's).
  if (ctx.ownOnly === true && !ctx.isAgent) {
    if (coll !== 'intake_items' || dealId) return no('not_permitted');
    const item = u().byId(ctx.app, 'intake_items', ownerId);
    if (item === null || item.getString('submitted_by') !== ctx.memberId) return no('not_permitted');
    return auth.can(ctx, 'intake', level) ? { ok: true } : no('not_permitted');
  }
  if (dealId) {
    const d = u().byId(ctx.app, 'deals', dealId);
    if (d === null) return no('not_found');
    if (!D.visible(ctx, d)) return no(d.getBool('restricted') ? 'restricted' : 'not_permitted');
    if (level === 'edit' && !ctx.isAgent && !auth.can(ctx, 'pipeline', 'edit') && !D.isTeam(ctx.app, d.id, ctx.memberId)) return no('not_permitted');
    if (coll === 'deals') return { ok: true };
  }
  const module = OWNERS[coll];
  if (module === undefined) return no('not_permitted');
  if (!ctx.isAgent && !auth.can(ctx, module, level)) return no('not_permitted');
  if (coll === 'entities' && !auth.inScope(ctx, ownerId)) return no('not_permitted');
  if (FUND_DATA.indexOf(coll) >= 0 && ctx.isAgent && !auth.fundDataVisible(ctx)) return no('fund_data_off');
  return { ok: true };
}

/** The NDA rule: the deal team; your AI agent only while a person's NDA ask about that deal is pending (lib_agent.ndaAllowed). */
function ndaRights(ctx, nda, deal) {
  if (!nda || ctx.actor === 'system') return { ok: true };
  if (ctx.isAgent) {
    if (!L('lib_agent').ndaAllowed(ctx.app, deal)) return no('nda_not_asked');
    return { ok: true, nda: true };
  }
  return L('lib_deals').isTeam(ctx.app, deal, ctx.memberId) ? { ok: true } : no('nda');
}

/** canRead(ctx, f, { deleted }) -> { ok, reason } */
function canRead(ctx, f, opts) {
  const o = opts || {};
  if (f.getString('deleted_at') !== '' && !o.deleted) return no('deleted');
  const r = ownerRights(ctx, f.getString('owner_collection'), f.getString('owner_id'), f.getString('deal'), 'view');
  if (!r.ok) return r;
  return ndaRights(ctx, f.getBool('nda'), f.getString('deal'));
}

function canWrite(ctx, f, opts) {
  const r = ownerRights(ctx, f.getString('owner_collection'), f.getString('owner_id'), f.getString('deal'), 'edit');
  if (!r.ok) return r;
  return ndaRights(ctx, f.getBool('nda'), f.getString('deal'));
}

const REASONS = {
  deleted: [404, 'This file was deleted.'],
  not_found: [404, 'No such file.'],
  restricted: [403, 'This file belongs to a restricted deal.'],
  not_permitted: [403, 'You cannot open this file.'],
  fund_data_off: [403, 'Fund and LP data is switched off for your AI agent (Settings).'],
  nda: [403, 'This file is under NDA: only the deal team can open it.'],
  nda_not_asked: [403, 'This file is under NDA. Your AI agent reads it only while a person asked it about its deal (in the last 24 hours).'],
};

function refuse(r) {
  const x = REASONS[r.reason] || [403, 'You cannot open this file.'];
  return u().fail(x[0], x[1], r.reason);
}

/** A file record by id that ctx may read (or write: opts.write); writes your AI agent's NDA reads to the audit trail. */
function fileFor(ctx, id, opts) {
  const util = u();
  const o = opts || {};
  const f = util.byId(ctx.app, 'files', String(id || '').trim());
  if (f === null) throw util.fail(404, 'No file ' + id + '. Run files.list.', 'not_found');
  const r = o.write ? canWrite(ctx, f, o) : canRead(ctx, f, o);
  if (!r.ok) throw refuse(r);
  if (r.nda && ctx.isAgent) {
    const was = ctx.audited;
    L('lib_audit').write(ctx, { op: ctx.op || 'files', collection: 'files', record: f.id, summary: 'Your AI agent opened the NDA file ' + f.getString('name') + ' (asked about its deal)', data: { deal: f.getString('deal') } });
    ctx.audited = was;
  }
  return f;
}

/* ------------------------------------------------------------ text rows */

function sqlNow() {
  return new Date().toISOString().replace('T', ' ');
}

/**
 * The text step's row of a file (file_texts). Written with SQL by the
 * upload and the engine starter, so it never joins an op's undo unit: an
 * Undo of the upload removes the file (and this row with it) whatever the
 * text step did meanwhile.
 */
function newTextRow(app, fileId) {
  u().exec(
    app,
    "INSERT INTO file_texts (id, file, state, error, started_at, attempts, sha256, pages, pages_with_text, ocr_pages, engine, same_as, meta, created, updated) VALUES ({:id}, {:f}, 'waiting', '', '', 0, '', 0, 0, 0, '', '', '{}', {:now}, {:now})",
    { id: $security.randomStringWithAlphabet(15, 'abcdefghijklmnopqrstuvwxyz0123456789'), f: fileId, now: sqlNow() },
  );
  touchText();
}

function setText(app, fileId, fields) {
  const sets = [];
  const bind = { f: fileId, now: sqlNow() };
  for (const k of Object.keys(fields)) {
    sets.push(k + ' = {:' + k + '}');
    bind[k] = fields[k] !== null && typeof fields[k] === 'object' ? JSON.stringify(fields[k]) : fields[k];
  }
  u().exec(app, 'UPDATE file_texts SET ' + sets.join(', ') + ', updated = {:now} WHERE file = {:f}', bind);
  touchText();
}

const TEXT_ROW = { file: '', state: '', error: '', started_at: '', attempts: 0, sha256: '', pages: 0, pages_with_text: 0, ocr_pages: 0, engine: '', same_as: '' };

/** Raw SQL writes mark what changed for open screens (the file views show the text state). */
function touchText() {
  const bus = L('lib_bus');
  bus.touch('file_texts');
  bus.touch('files');
}

/** The text rows of some files: { fileId: row }. */
function textsOf(app, ids) {
  const out = {};
  if (ids.length === 0) return out;
  const bind = {};
  const list = ids.map((id, i) => ((bind['f' + i] = id), '{:f' + i + '}')).join(', ');
  for (const r of u().rows(app, 'SELECT file, state, error, started_at, attempts, sha256, pages, pages_with_text, ocr_pages, engine, same_as FROM file_texts WHERE file IN (' + list + ')', TEXT_ROW, bind)) out[r.file] = r;
  return out;
}

/* ----------------------------------------------------------------- views */

function fileOut(app, f, text) {
  const t = text || textsOf(app, [f.id])[f.id] || { state: 'waiting', error: '', sha256: '', pages: 0, pages_with_text: 0, ocr_pages: 0, engine: '', same_as: '' };
  return {
    id: f.id,
    name: f.getString('name'),
    folder: f.getString('folder'),
    owner_collection: f.getString('owner_collection'),
    owner_id: f.getString('owner_id'),
    deal: f.getString('deal'),
    bytes: f.getInt('bytes'),
    mime: f.getString('mime'),
    ext: f.getString('ext'),
    version: f.getInt('version'),
    prev: f.getString('prev'),
    current: f.getBool('current'),
    origin: f.getString('origin'),
    source_ref: f.getString('source_ref'),
    nda: f.getBool('nda'),
    text_state: t.state,
    text_error: t.error,
    sha256: t.sha256,
    pages: t.pages,
    pages_with_text: t.pages_with_text,
    ocr_pages: t.ocr_pages,
    same_as: t.same_as,
    actor: f.getString('actor'),
    member: L('lib_records').mini(app, 'members', f.getString('member')),
    deleted_at: f.getString('deleted_at'),
    created: f.getString('created'),
  };
}

/** Where a file shows in the app (its owner's page). */
function hrefOf(app, f) {
  const coll = f.getString('owner_collection');
  const id = f.getString('owner_id');
  if (f.getString('deal') !== '') {
    const d = u().byId(app, 'deals', f.getString('deal'));
    return '#/deals/' + (d !== null ? d.getString('number') : f.getString('deal')) + '?tab=files&file=' + f.id;
  }
  if (coll === 'companies') return '#/companies/' + id + '?tab=files&file=' + f.id;
  if (coll === 'people') return '#/people/' + id + '?tab=files&file=' + f.id;
  return '#/files/' + f.id;
}

/** pathOf(app, fileId) -> the stored file's absolute local path (to attach to an email). */
function pathOf(app, fileId) {
  const f = u().byId(app, 'files', String(fileId || ''));
  if (f === null) throw u().fail(404, 'No file ' + fileId + '.', 'not_found');
  return absPath(app, f, 'file');
}

/** text(app, fileId) -> the stored pages (no rights check: for the app's own work). */
function text(app, fileId) {
  return app.findRecordsByFilter('pages', 'file = {:f}', 'page_no', 0, 0, { f: fileId }).map((pg) => ({ page_no: pg.getInt('page_no'), text: pg.getString('text'), chars: pg.getInt('chars'), needs_ocr: pg.getBool('needs_ocr'), origin: pg.getString('origin'), width: pg.getFloat('width'), height: pg.getFloat('height') }));
}

/* ----------------------------------------------------------------- adding */

function cleanFolder(raw) {
  const util = u();
  const parts = String(raw || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => util.squash(s))
    .filter((s) => s !== '' && s !== '.' && s !== '..');
  for (const s of parts) if (/[\u0000-\u001f\u007f<>:"|?*]/.test(s) || s.length > 80) throw util.fail(400, 'folder: "' + s + '" is not a folder name.', 'invalid_param', { param: 'folder' });
  if (parts.length > 4) throw util.fail(400, 'folder is at most 4 levels deep.', 'invalid_param', { param: 'folder' });
  return parts.join('/');
}

function cleanName(raw) {
  const util = u();
  const s = util.squash(String(raw || '').replace(/^.*[\\/]/, '')).replace(/[\u0000-\u001f\u007f]/g, '');
  if (s === '') throw util.fail(400, 'The file needs a name.', 'invalid_param', { param: 'name' });
  return s.length > 300 ? s.slice(0, 300) : s;
}

/** The current file with this name in this folder of this owner (the one a new upload versions). */
function currentNamed(app, owner, folder, name) {
  const rows = u().rows(app, "SELECT id FROM files WHERE owner_collection = {:c} AND owner_id = {:o} AND folder = {:f} AND LOWER(name) = LOWER({:n}) AND current = TRUE AND deleted_at = '' LIMIT 1", { id: '' }, { c: owner.collection, o: owner.id, f: folder, n: name });
  return rows.length > 0 ? app.findRecordById('files', rows[0].id) : null;
}

/** Store one file with the write handle (a new version when the name is already in the folder). */
function storeIn(ctx, t, owner, item, base) {
  const util = u();
  const name = cleanName(item.name);
  const prev = item.prev !== undefined ? item.prev : currentNamed(t, owner, base.folder, name);
  const f = util.newRecord(t, 'files');
  f.set('owner_collection', owner.collection);
  f.set('owner_id', owner.id);
  f.set('deal', base.deal);
  f.set('folder', base.folder);
  f.set('name', prev !== null ? prev.getString('name') : name);
  f.set('file', item.file);
  f.set('bytes', Number(item.size || 0));
  f.set('mime', mimeOf(name));
  f.set('ext', extOf(name));
  f.set('version', prev !== null ? prev.getInt('version') + 1 : 1);
  f.set('prev', prev !== null ? prev.id : '');
  f.set('current', true);
  f.set('origin', base.origin);
  f.set('source_ref', util.clip(base.source_ref || '', 300));
  f.set('nda', base.nda || (prev !== null && prev.getBool('nda')));
  f.set('meta', prev !== null && prev.getString('name') !== name ? { uploaded_as: name } : {});
  f.set('deleted_at', '');
  f.set('run', ctx.run || '');
  L('lib_records').stampWritten(ctx, f);
  t.save(f);
  if (prev !== null) {
    const p = t.findRecordById('files', prev.id);
    p.set('current', false);
    t.save(p);
  }
  newTextRow(t, f.id);
  return f;
}

/** Normalize the owner and options shared by every file of one add. */
function baseOf(ctx, o) {
  const util = u();
  const app = ctx.app;
  const owner = ownerOf(app, o.owner_collection, o.owner_id);
  let deal = owner.deal;
  if (deal === '' && o.deal) deal = L('lib_deals').ref(app, o.deal).id;
  const origin = o.origin ? String(o.origin) : ctx.isAgent ? 'agent' : ctx.actor === 'person' ? 'upload' : 'system';
  if (ORIGINS.indexOf(origin) < 0) throw util.fail(400, 'origin must be one of: ' + ORIGINS.join(', ') + '.', 'invalid_param', { param: 'origin' });
  const nda = o.nda === true;
  if (nda && deal === '') throw util.fail(400, 'An NDA file belongs to a deal: add it to the deal, or give the deal.', 'nda_needs_deal', { param: 'nda' });
  const r = ownerRights(ctx, owner.collection, owner.id, deal, 'edit');
  if (!r.ok) throw refuse(r);
  if (nda && ctx.isAgent) {
    const n = ndaRights(ctx, true, deal);
    if (!n.ok) throw refuse(n);
  }
  return { owner: owner, deal: deal, origin: origin, nda: nda, folder: cleanFolder(o.folder), source_ref: o.source_ref || '' };
}

function checkItem(item) {
  const util = u();
  const size = Number(item.size || 0);
  if (size <= 0) throw util.fail(400, '"' + item.name + '" is empty.', 'empty_file');
  if (size > MAX_BYTES) throw util.fail(400, '"' + item.name + '" is larger than 200 MB.', 'too_large');
}

/** Add files (items: [{ file, name, size, prev? }]) with the caller's write handle; answers their views. */
function addItems(ctx, o, items) {
  const util = u();
  if (items.length === 0) throw util.fail(400, 'Upload a file, or give --paths ["<absolute path>"].', 'missing_param', { param: 'file' });
  if (items.length > MAX_FILES) throw util.fail(400, 'At most ' + MAX_FILES + ' files at once.', 'too_many');
  for (const it of items) checkItem(it);
  const base = baseOf(ctx, o);
  const ids = [];
  L('lib_records').inRun(ctx, 'files.upload', (t) => {
    for (const it of items) ids.push(storeIn(ctx, t, base.owner, it, base).id);
    return { summary: items.length === 1 ? 'Added ' + cleanName(items[0].name) : 'Added ' + items.length + ' files', type: 'files', id: ids[0] };
  });
  if (!ctx.dryRun) {
    kick(ctx.app);
    for (const id of ids) {
      const f = ctx.app.findRecordById('files', id);
      L('lib_records').emit(ctx, 'file.added', { file: id, owner_collection: f.getString('owner_collection'), owner_id: f.getString('owner_id'), deal: f.getString('deal'), version: f.getInt('version') });
    }
  }
  const texts = textsOf(ctx.app, ids);
  return ids.map((id) => fileOut(ctx.app, ctx.app.findRecordById('files', id), texts[id]));
}

/**
 * add(ctx, o) -> file view. o.upload: a file from a form (people); o.path:
 * a local file your AI agent names (never the app's own folder). Other
 * hooks that hold a trusted path (a downloaded email attachment) use fromPath.
 */
function add(ctx, o) {
  let item;
  if (o.upload) item = { file: o.upload, name: o.name || o.upload.originalName || o.upload.name, size: o.upload.size };
  else {
    const f = localFile(ctx, o.path, 'path');
    item = { file: f, name: o.name || f.originalName, size: f.size };
  }
  return addItems(ctx, o, [item])[0];
}

/**
 * fromPath(ctx, o) -> file view: load a local file the app itself holds (as
 * download_gmail_attachment leaves it) into a files record with
 * $filesystem.fileFromPath. For hooks only: the path never comes from a
 * request. The source file stays where it is (the caller removes it).
 */
function fromPath(ctx, o) {
  const util = u();
  const real = cleanPath(o.path, 'path');
  const bn = $filepath.base(real).toLowerCase();
  if (bn === '.agent-token' || bn === '.seal-key' || bn === '.superuser' || /\.db(-wal|-shm)?$/.test(bn)) throw util.fail(403, 'That file cannot be stored.', 'not_permitted', { param: 'path' });
  const st = statFile(real, 'path');
  const f = $filesystem.fileFromPath(real);
  return addItems(ctx, o, [{ file: f, name: o.name || $filepath.base(real), size: st.size() }])[0];
}

/** move(ctx, fileId, { owner_collection, owner_id, folder, deal }) -> file view (every version moves). */
function move(ctx, fileId, to) {
  const f0 = fileFor(ctx, fileId, { write: true });
  const base = baseOf(ctx, {
    owner_collection: to.owner_collection || f0.getString('owner_collection'),
    owner_id: to.owner_id || f0.getString('owner_id'),
    deal: to.deal !== undefined ? to.deal : f0.getString('deal'),
    folder: to.folder !== undefined ? to.folder : f0.getString('folder'),
    nda: f0.getBool('nda'),
    origin: f0.getString('origin'),
  });
  L('lib_records').inRun(ctx, 'files.move', (t) => {
    for (const v of chain(t, f0)) {
      v.set('owner_collection', base.owner.collection);
      v.set('owner_id', base.owner.id);
      v.set('deal', base.deal);
      v.set('folder', base.folder);
      t.save(v);
    }
    return { summary: 'Moved ' + f0.getString('name'), type: 'files', id: f0.id };
  });
  return fileOut(ctx.app, ctx.app.findRecordById('files', f0.id));
}

/**
 * Every version of the file a record belongs to (newest first). SQL with
 * bound values: a record filter bound to '' (the root folder) matches nothing.
 */
function chain(app, f) {
  const rows = u().rows(app, 'SELECT id FROM files WHERE owner_collection = {:c} AND owner_id = {:o} AND folder = {:f} AND name = {:n} ORDER BY version DESC', { id: '' }, { c: f.getString('owner_collection'), o: f.getString('owner_id'), f: f.getString('folder'), n: f.getString('name') });
  return rows.map((r) => app.findRecordById('files', r.id));
}

/* ------------------------------------------------------------ text step */

function outPathOf(app, fileId) {
  const dir = $filepath.join(app.dataDir(), 'vo_text');
  $os.mkdirAll(dir, 0o755);
  return $filepath.join(dir, fileId + '.json');
}

function engineScript() {
  return $filepath.join(__hooks, '..', '..', 'engine', 'textlayer.mjs');
}

const WANTED_KEY = 'vo_text_wanted';
/** Plain text (a transcript, a CSV) reads in milliseconds: it never waits for a slot behind decks. */
const EXTRA_PLAIN = 4;

/** Files someone is waiting to read, oldest wish first (shared by every runtime; kept until they start). */
function wanted(app) {
  const raw = app.store().get(WANTED_KEY);
  try {
    const list = typeof raw === 'string' && raw !== '' ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * Start the engine for waiting files (at most two running, plus plain text that waits for no slot),
 * without waiting for it. Files someone is reading (prefer, kept in the app store until they start)
 * go first: a reader never waits behind the backlog.
 */
function kick(app, prefer) {
  const util = u();
  let want = wanted(app);
  for (const id of prefer || []) if (typeof id === 'string' && id !== '' && want.indexOf(id) < 0) want.push(id);
  want = want.slice(-50);
  const running = util.count(app, "SELECT COUNT(*) AS n FROM file_texts WHERE state = 'extracting'");
  const slots = Math.max(0, MAX_RUNNING - running);
  const bind = {};
  const order = want.length > 0 ? 'CASE WHEN x.file IN (' + want.map((id, i) => ((bind['p' + i] = id), '{:p' + i + '}')).join(', ') + ') THEN 0 ELSE 1 END, ' : '';
  const rows = util.rows(app, "SELECT x.file AS file, x.attempts AS attempts, f.ext AS ext FROM file_texts x JOIN files f ON f.id = x.file WHERE x.state = 'waiting' AND f.deleted_at = '' ORDER BY " + order + 'x.created LIMIT ' + (slots + EXTRA_PLAIN + 20), { file: '', attempts: 0, ext: '' }, bind);
  // Plain text files anywhere in the queue (a transcript behind a deck backlog) start at once.
  const plainExts = Object.keys(TEXT_KIND).filter((e) => TEXT_KIND[e] === 'plain');
  const pb = {};
  plainExts.forEach((e, i) => (pb['e' + i] = e));
  for (const r of util.rows(app, "SELECT x.file AS file, x.attempts AS attempts, f.ext AS ext FROM file_texts x JOIN files f ON f.id = x.file WHERE x.state = 'waiting' AND f.deleted_at = '' AND f.ext IN (" + plainExts.map((e, i) => '{:e' + i + '}').join(', ') + ') ORDER BY x.created LIMIT ' + EXTRA_PLAIN, { file: '', attempts: 0, ext: '' }, pb)) if (!rows.some((x) => x.file === r.file)) rows.push(r);
  let n = 0;
  let free = slots;
  let plain = EXTRA_PLAIN;
  for (const row of rows) {
    const isPlain = kindOfExt(row.ext) === 'plain';
    if (free > 0) free--;
    else if (isPlain && plain > 0) plain--;
    else continue;
    const rec = app.findRecordById('files', row.file);
    const out = outPathOf(app, rec.id);
    try {
      $os.remove(out);
    } catch {
      /* nothing left from an earlier try */
    }
    try {
      const cmd = $os.cmd('node', engineScript(), kindOfExt(rec.getString('ext')), absPath(app, rec, 'file'), out, String(ENGINE_TIMEOUT_S));
      cmd.start();
      app.store().set('vo_text_proc_' + rec.id, cmd);
      setText(app, rec.id, { state: 'extracting', started_at: nowIso(), attempts: row.attempts + 1 });
      n++;
    } catch (err) {
      console.error('[vo] text engine did not start for ' + rec.id + ':', err);
      setText(app, rec.id, { state: 'failed', error: util.clip('The text engine did not start (is Node installed?): ' + String(err), 2000) });
    }
    want = want.filter((id) => id !== rec.id);
  }
  // Wishes for files no longer waiting go; the rest stay until a slot frees.
  const wb = {};
  want.forEach((id, i) => (wb['w' + i] = id));
  const still = want.length > 0 ? util.rows(app, "SELECT file FROM file_texts WHERE state = 'waiting' AND file IN (" + want.map((id, i) => '{:w' + i + '}').join(', ') + ')', { file: '' }, wb).map((r) => r.file) : [];
  app.store().set(WANTED_KEY, JSON.stringify(still));
  return n;
}

function reap(app, fileId) {
  const key = 'vo_text_proc_' + fileId;
  const cmd = app.store().get(key);
  if (cmd) {
    try {
      cmd.wait();
    } catch {
      /* already reaped or never ours */
    }
    app.store().remove(key);
  }
}

/** Store the engine's answer for one file when it is on disk; true when stored (then emits file.text_ready). */
function collect(app, fileId) {
  const out = outPathOf(app, fileId);
  let raw = null;
  try {
    raw = toString($os.readFile(out));
  } catch {
    return false;
  }
  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    result = { ok: false, error: 'The text engine answered something unreadable.', code: 'engine' };
  }
  reap(app, fileId);
  let stored = null;
  app.runInTransaction((tx) => {
    stored = L('lib_text').storePages(tx, fileId, result, OCR_BELOW_CHARS);
  });
  try {
    $os.remove(out);
  } catch {
    /* removed with the folder later */
  }
  if (stored === null) return false;
  L('lib_bus').touch('files');
  const fr = app.findRecordById('files', fileId);
  L('lib_events').emit(L('lib_auth').systemCtx(app), 'file.text_ready', { file: fileId, text_state: stored.state, ocr_pages: stored.ocr_pages, owner_collection: fr.getString('owner_collection'), owner_id: fr.getString('owner_id'), deal: fr.getString('deal') });
  kick(app);
  return true;
}

/**
 * Move the text step on when a read meets a file still in it: store every
 * finished answer (at most MAX_RUNNING files are being read) and start the
 * next waiting files. Read ops call this; never a write.
 */
function collectFor(app, ids) {
  const texts = textsOf(app, ids);
  if (!ids.some((id) => texts[id] && (texts[id].state === 'extracting' || texts[id].state === 'waiting'))) return 0;
  let n = 0;
  for (const r of u().rows(app, "SELECT file FROM file_texts WHERE state = 'extracting' ORDER BY started_at LIMIT 10", { file: '' })) if (collect(app, r.file)) n++;
  kick(app, ids);
  return n;
}

/**
 * The minute step (cron_records.js): store finished answers, retry once a
 * file whose engine stopped without one, and start waiting files.
 */
function textTick(app) {
  const util = u();
  let done = 0;
  for (const r of util.rows(app, "SELECT file, started_at, attempts FROM file_texts WHERE state = 'extracting' ORDER BY started_at LIMIT 50", { file: '', started_at: '', attempts: 0 })) {
    if (collect(app, r.file)) {
      done++;
      continue;
    }
    const started = Date.parse(r.started_at);
    if (!Number.isNaN(started) && Date.now() - started > (ENGINE_TIMEOUT_S + 120) * 1000) {
      const cmd = app.store().get('vo_text_proc_' + r.file);
      if (cmd) {
        try {
          cmd.process.kill();
        } catch {
          /* already gone */
        }
        reap(app, r.file);
      }
      if (r.attempts < 2) setText(app, r.file, { state: 'waiting' });
      else setText(app, r.file, { state: 'failed', error: 'The text engine stopped without an answer.' });
    }
  }
  kick(app);
  return { collected: done, waiting: util.count(app, "SELECT COUNT(*) AS n FROM file_texts WHERE state = 'waiting'") };
}

/* ------------------------------------------------------------------- ops */

/** The owner a call names: --deal, --company, --person, or --owner_collection with --owner_id. */
function ownerParams(ctx, p) {
  const util = u();
  const given = [];
  if (util.str(p, 'deal', '') !== '') given.push({ owner_collection: 'deals', owner_id: util.str(p, 'deal', '') });
  if (util.str(p, 'company', '') !== '') given.push({ owner_collection: 'companies', owner_id: util.str(p, 'company', '') });
  if (util.str(p, 'person', '') !== '') given.push({ owner_collection: 'people', owner_id: util.str(p, 'person', '') });
  if (util.str(p, 'owner_collection', '') !== '') given.push({ owner_collection: util.str(p, 'owner_collection', ''), owner_id: util.req(p, 'owner_id') });
  if (given.length !== 1) throw util.fail(400, 'Name exactly one owner: --deal, --company, --person, or --owner_collection with --owner_id.', 'missing_param');
  return given[0];
}

function itemsFrom(ctx, p) {
  const util = u();
  const items = [];
  for (const f of ctx.e ? uploadedAll(ctx.e, 'file') : []) items.push({ file: f, name: f.originalName, size: f.size });
  for (const path of util.list(p, 'paths') || []) {
    const f = localFile(ctx, String(path), 'paths');
    items.push({ file: f, name: f.originalName, size: f.size });
  }
  return items;
}

function opUpload(ctx, p) {
  const util = u();
  const owner = ownerParams(ctx, p);
  const items = itemsFrom(ctx, p);
  const name = util.str(p, 'name', '');
  if (name !== '') {
    if (items.length !== 1) throw util.fail(400, '--name renames one file; give one file with it.', 'invalid_param', { param: 'name' });
    items[0].name = name;
  }
  const files = addItems(ctx, Object.assign(owner, { folder: util.str(p, 'folder', ''), nda: util.bool(p, 'nda', false), origin: util.str(p, 'origin', ''), source_ref: util.str(p, 'source_ref', ''), deal: owner.owner_collection === 'deals' ? '' : util.str(p, 'for_deal', '') }), items);
  return { files: files };
}

function opVersion(ctx, p) {
  const util = u();
  const f0 = fileFor(ctx, util.req(p, 'file'), { write: true });
  const cur = f0.getBool('current') ? f0 : currentNamed(ctx.app, { collection: f0.getString('owner_collection'), id: f0.getString('owner_id') }, f0.getString('folder'), f0.getString('name'));
  const items = itemsFrom(ctx, p);
  if (items.length !== 1) throw util.fail(400, 'Give exactly one new version (an upload, or --paths with one path).', 'missing_param', { param: 'file' });
  items[0].prev = cur;
  const files = addItems(ctx, { owner_collection: f0.getString('owner_collection'), owner_id: f0.getString('owner_id'), deal: f0.getString('deal'), folder: f0.getString('folder'), nda: f0.getBool('nda'), origin: util.str(p, 'origin', ''), source_ref: util.str(p, 'source_ref', '') }, items);
  return { file: files[0] };
}

/** files.delete: the file and every version of it go to the trash (soft delete). */
function opDelete(ctx, p) {
  const util = u();
  const f0 = fileFor(ctx, util.req(p, 'file'), { write: true });
  let n = 0;
  L('lib_records').inRun(ctx, 'files.delete', (t) => {
    for (const v of chain(t, f0)) {
      v.set('deleted_at', nowIso());
      t.save(v);
      n++;
    }
    return { summary: 'Deleted ' + f0.getString('name'), type: 'files', id: f0.id };
  });
  return { deleted: true, file: f0.id, versions: n };
}

/** files.move: a file with every version to another folder, or to another owner (--deal, --company, --person). */
function opMove(ctx, p) {
  const util = u();
  const to = {};
  const owners = ['deal', 'company', 'person'].filter((k) => util.str(p, k, '') !== '');
  if (owners.length > 1) throw util.fail(400, 'Name at most one new owner: --deal, --company or --person.', 'invalid_param');
  if (owners.length === 1) {
    const o = ownerParams(ctx, p);
    to.owner_collection = o.owner_collection;
    to.owner_id = o.owner_id;
    to.deal = '';
  }
  if (util.has(p, 'folder')) to.folder = util.str(p, 'folder', '');
  if (Object.keys(to).length === 0) throw util.fail(400, 'Give --folder, or a new owner (--deal, --company or --person).', 'missing_param');
  const out = move(ctx, util.req(p, 'file'), to);
  return { file: out, versions: chain(ctx.app, ctx.app.findRecordById('files', out.id)).length };
}

/**
 * files.set-nda: put a file (every version) under NDA or take it out. People
 * only. Turning it on needs edit rights and a deal; turning it off, a seat
 * on the deal team (the people the NDA keeps it to).
 */
function opSetNda(ctx, p) {
  const util = u();
  const nda = util.bool(p, 'nda', null);
  if (nda === null) throw util.fail(400, 'nda is required: true or false.', 'missing_param', { param: 'nda' });
  const f0 = fileFor(ctx, util.req(p, 'file'), { write: true });
  if (f0.getBool('nda') === nda) return { file: fileOut(ctx.app, f0), changed: false };
  if (nda && f0.getString('deal') === '') throw util.fail(400, 'An NDA file belongs to a deal: move it to the deal room first (or tie it to the deal).', 'nda_needs_deal', { param: 'nda' });
  let n = 0;
  L('lib_records').inRun(ctx, 'files.set-nda', (t) => {
    for (const v of chain(t, f0)) {
      v.set('nda', nda);
      t.save(v);
      n++;
    }
    return { summary: (nda ? 'Put ' : 'Took ') + f0.getString('name') + (nda ? ' under NDA' : ' out of NDA'), type: 'files', id: f0.id };
  });
  L('lib_audit').note(ctx, { before: { nda: !nda }, after: { nda: nda } });
  return { file: fileOut(ctx.app, ctx.app.findRecordById('files', f0.id)), changed: true, versions: n };
}

function previewDelete(ctx, params) {
  const f = u().byId(ctx.app, 'files', String(params.file || ''));
  if (f === null) throw u().fail(404, 'No file ' + params.file + '.', 'not_found');
  const P = L('lib_proposals');
  const fields = [P.line('Remove', '', f.getString('name'), 'text', 'deleted'), f.getInt('version') > 1 ? P.line('Versions', '', f.getInt('version'), 'int', 'versions') : null].filter((x) => x !== null);
  return { label: f.getString('name') + ': Remove', target: 'files:' + f.id, fields: fields, notes: [], risk: 'medium' };
}

function opGet(ctx, p) {
  const util = u();
  const app = ctx.app;
  const f = fileFor(ctx, util.req(p, 'file'), { deleted: true });
  collectFor(app, [f.id]);
  const versions = chain(app, f);
  const texts = textsOf(
    app,
    versions.map((v) => v.id),
  );
  const ocr = util.rows(app, 'SELECT page_no FROM pages WHERE file = {:f} AND needs_ocr = TRUE ORDER BY page_no', { page_no: 0 }, { f: f.id }).map((r) => r.page_no);
  const meta = util.jsonOf(f, 'meta', {}) || {};
  const tmeta = util.one(app, 'SELECT meta FROM file_texts WHERE file = {:f}', { meta: '' }, { f: f.id });
  return {
    file: Object.assign(fileOut(app, f, texts[f.id]), { href: hrefOf(app, f), uploaded_as: meta.uploaded_as || '', outline: tmeta !== null && tmeta.meta !== '' ? (JSON.parse(tmeta.meta) || {}).outline || [] : [] }),
    versions: versions.map((v) => ({ id: v.id, version: v.getInt('version'), bytes: v.getInt('bytes'), sha256: texts[v.id] ? texts[v.id].sha256 : '', current: v.getBool('current'), actor: v.getString('actor'), created: v.getString('created'), uploaded_as: (util.jsonOf(v, 'meta', {}) || {}).uploaded_as || '' })),
    needs_ocr: ocr,
  };
}

/** files.download: people get the file itself; your AI agent gets its local path. */
function opDownload(ctx, p) {
  const util = u();
  const f = fileFor(ctx, util.req(p, 'file'), {});
  if (ctx.isAgent) return { file: fileOut(ctx.app, f), path: absPath(ctx.app, f, 'file') };
  return serve(ctx, f, 'file', f.getString('name'), util.bool(p, 'download', false));
}

/** files.list: one owner's files (current versions unless --all_versions), folders, and how many are hidden from the caller. */
function opList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const owner = ownerParams(ctx, p);
  const o = ownerOf(app, owner.owner_collection, owner.owner_id);
  if (o.collection === 'deals') L('lib_deals').guard(ctx, L('lib_deals').ref(app, o.id));
  // An owner the caller may not see at all is refused (not listed as empty).
  const seen = ownerRights(ctx, o.collection, o.id, o.deal, 'view');
  if (!seen.ok) throw refuse(seen);
  const where = o.collection === 'deals' ? ['(deal = {:d} OR (owner_collection = {:c} AND owner_id = {:o}))'] : ['owner_collection = {:c}', 'owner_id = {:o}'];
  const bind = { c: o.collection, o: o.id, d: o.id };
  where.push(util.bool(p, 'deleted', false) ? "deleted_at != ''" : "deleted_at = ''");
  if (!util.bool(p, 'all_versions', false)) where.push('current = TRUE');
  if (util.has(p, 'folder')) {
    where.push('folder = {:fo}');
    bind.fo = cleanFolder(util.str(p, 'folder', ''));
  }
  const q = util.str(p, 'q', '');
  if (q !== '') {
    where.push("name LIKE {:q} ESCAPE '\\'");
    bind.q = util.like(q);
  }
  const ids = util.rows(app, 'SELECT id FROM files WHERE ' + where.join(' AND ') + ' ORDER BY folder, name COLLATE NOCASE, version DESC LIMIT 2000', { id: '' }, bind).map((r) => r.id);
  collectFor(app, ids);
  const pg = util.page(p, 200, 1000);
  const shown = [];
  let hidden = 0;
  for (const id of ids) {
    const f = app.findRecordById('files', id);
    if (!canRead(ctx, f, { deleted: true }).ok) {
      hidden++;
      continue;
    }
    shown.push(f);
  }
  const folders = {};
  for (const f of shown) folders[f.getString('folder')] = (folders[f.getString('folder')] || 0) + 1;
  const page = shown.slice(pg.offset, pg.offset + pg.limit);
  const texts = textsOf(
    app,
    page.map((f) => f.id),
  );
  return {
    files: page.map((f) => fileOut(app, f, texts[f.id])),
    folders: Object.keys(folders)
      .sort()
      .map((k) => ({ folder: k, files: folders[k] })),
    total: shown.length,
    hidden: hidden,
    limit: pg.limit,
    offset: pg.offset,
  };
}

module.exports = {
  OWNERS: OWNERS,
  ORIGINS: ORIGINS,
  OCR_BELOW_CHARS: OCR_BELOW_CHARS,
  mimeOf: mimeOf,
  uploaded: uploaded,
  uploadedAll: uploadedAll,
  localFile: localFile,
  fileParam: fileParam,
  absPath: absPath,
  serve: serve,
  csvInput: csvInput,
  canRead: canRead,
  canWrite: canWrite,
  fileFor: fileFor,
  fileOut: fileOut,
  textsOf: textsOf,
  setText: setText,
  hrefOf: hrefOf,
  pathOf: pathOf,
  text: text,
  add: add,
  fromPath: fromPath,
  move: move,
  chain: chain,
  kick: kick,
  collect: collect,
  collectFor: collectFor,
  textTick: textTick,
  opUpload: opUpload,
  opVersion: opVersion,
  opDelete: opDelete,
  opSetNda: opSetNda,
  opMove: opMove,
  previewDelete: previewDelete,
  opGet: opGet,
  opDownload: opDownload,
  opList: opList,
};
