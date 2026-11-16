/// <reference path="../pb_data/types.d.ts" />
/**
 * Logos (fix 5): a company's own logo (companies.logo) and the firm's
 * (settings.logo). One image each: png, jpg, webp or svg, 2 MB at most.
 *
 * Serving: the file fields are protected; the browser gets the bytes only
 * through an op that streams them with lib_files.serve (companies.logo,
 * settings.logo), fetched with the session like every other protected
 * file. Every company read the screens use carries `logo_url` (the op's
 * path with a version that changes with the file, '' when there is none)
 * and `logo_domain` (the domain whose public favicon is the next best
 * logo; '' in a demo firm, whose companies are fictional).
 *
 * Writing: companies.logo-set takes the upload (multipart field `file`) or,
 * for your AI agent, --paths with one absolute path; for your AI agent it is
 * a proposal. Its preview copies the agent's file into the app's staging
 * folder (pb_data/vo_staged/logos, named by a hash of path, size and time)
 * and the stored proposal names that copy, so the person who accepts it
 * sets exactly the image that was proposed, even if the original moved.
 * The staged copy is removed once it is stored. companies.logo-remove and
 * both firm ops are people only. Every change is audited with before and
 * after.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' };
const MAX_BYTES = 2097152;
const STAGED = /^[a-f0-9]{64}\.(png|jpe?g|webp|svg)$/;

/* ------------------------------------------------------------------ urls */

/** The version part of a logo url: changes whenever the stored file does. */
function versionOf(stored) {
  const v = String(stored || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(-12);
  return v || '1';
}

/** The logo_url of a company id and its stored logo file name ('' without one): for reads that select the column. */
function companyUrlOf(id, stored) {
  return !stored ? '' : '/api/ops/companies/logo?company=' + id + '&v=' + versionOf(stored);
}

/** A company's logo_url ('' without a logo). */
function companyUrl(rec) {
  return companyUrlOf(rec.id, rec.getString('logo'));
}

/** The firm's logo_url ('' without a logo). */
function firmUrl(settingsRec) {
  const f = settingsRec ? settingsRec.getString('logo') : '';
  return f === '' ? '' : '/api/ops/settings/logo?v=' + versionOf(f);
}

let _demo = { at: 0, v: false };
/** Is this a demo firm (settings.mail.demo)? Read at most every 5 seconds per runtime: list reads ask it per row. */
function demo(app) {
  const now = Date.now();
  if (now - _demo.at < 5000) return _demo.v;
  let v = false;
  try {
    v = L('lib_mail').demo(app);
  } catch {
    v = false;
  }
  _demo = { at: now, v: v };
  return v;
}

/** The domain whose public favicon stands in for a missing logo ('' in a demo firm). */
function domainOf(app, domain) {
  return demo(app) ? '' : String(domain || '');
}

/** { logo_url, logo_domain } of a company record. */
function viewOf(app, rec) {
  return { logo_url: companyUrl(rec), logo_domain: domainOf(app, rec.getString('domain')) };
}

/* -------------------------------------------------------------- staging */

function stagingDir(app) {
  return $filepath.join(app.dataDir(), 'vo_staged', 'logos');
}

function sameDir(a, b) {
  return $filepath.clean(String(a)).toLowerCase() === $filepath.clean(String(b)).toLowerCase();
}

/** Is `path` a copy this app staged for a proposal (its staging folder, its own naming)? */
function isStaged(app, path) {
  let real = '';
  try {
    real = $filepath.clean(String(path || ''));
  } catch {
    return false;
  }
  return sameDir($filepath.dir(real), stagingDir(app)) && STAGED.test($filepath.base(real));
}

function extOf(name) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

/** Refuse what is not a logo before anything is stored. */
function checkImage(name, size) {
  const util = u();
  const ext = extOf(name);
  if (TYPES[ext] === undefined) throw util.fail(400, 'A logo is a PNG, JPG, WebP or SVG image ("' + name + '" is not).', 'invalid_type', { param: 'file', allowed: Object.keys(TYPES) });
  if (!(Number(size) > 0)) throw util.fail(400, '"' + name + '" is empty.', 'empty_file', { param: 'file' });
  if (Number(size) > MAX_BYTES) throw util.fail(400, 'A logo is 2 MB at most ("' + name + '" is ' + (Math.round(Number(size) / 104857.6) / 10) + ' MB).', 'too_large', { param: 'file', max_bytes: MAX_BYTES });
}

/**
 * The image a call gives: the upload (field `file`), a staged copy (an
 * accepted proposal), or your AI agent's own path. { file, name, size, staged }.
 */
function imageOf(ctx, p) {
  const util = u();
  const F = L('lib_files');
  const up = ctx.e ? F.uploaded(ctx.e, 'file') : null;
  if (up !== null) {
    const item = { file: up, name: String(up.originalName || up.name || 'logo'), size: Number(up.size || 0), staged: '' };
    checkImage(item.name, item.size);
    return item;
  }
  const paths = util.list(p, 'paths') || [];
  if (paths.length === 0) throw util.fail(400, 'Upload the image (multipart field file), or give --paths ["<absolute path of the image>"].', 'missing_param', { param: 'file' });
  if (paths.length > 1) throw util.fail(400, 'A logo is one image: give one path in --paths.', 'invalid_param', { param: 'paths' });
  const path = String(paths[0]);
  if (isStaged(ctx.app, path)) {
    let st;
    try {
      st = $os.stat(path);
    } catch {
      throw util.fail(409, 'The proposed image is no longer stored; ask your AI agent to propose it again.', 'gone', { param: 'paths' });
    }
    const f = $filesystem.fileFromPath(path);
    const item = { file: f, name: $filepath.base(path), size: Number(st.size()), staged: path };
    checkImage(item.name, item.size);
    return item;
  }
  const f = F.localFile(ctx, path, 'paths');
  const item = { file: f, name: String(f.originalName || $filepath.base(path)), size: Number(f.size || 0), staged: '' };
  checkImage(item.name, item.size);
  return item;
}

/** Copy your AI agent's image into the staging folder; answers the staged path (the same file gives the same name). */
function stage(app, path) {
  const util = u();
  let st;
  try {
    st = $os.stat(path);
  } catch {
    throw util.fail(400, 'No file at paths "' + path + '". Give the absolute path of the image.', 'invalid_param', { param: 'paths' });
  }
  checkImage($filepath.base(path), st.size());
  let stamp = '';
  try {
    stamp = String(st.modTime().unix());
  } catch {
    stamp = '';
  }
  const name = $security.sha256($filepath.clean(path) + '|' + st.size() + '|' + stamp) + '.' + extOf(path).replace('jpeg', 'jpg');
  const dir = stagingDir(app);
  const dest = $filepath.join(dir, name);
  try {
    $os.stat(dest);
    return dest;
  } catch {
    /* not staged yet */
  }
  $os.mkdirAll(dir, 493);
  $os.writeFile(dest, $os.readFile(path), 420);
  return dest;
}

function unstage(app, path) {
  if (path === '' || !isStaged(app, path)) return;
  try {
    $os.remove(path);
  } catch {
    /* already gone */
  }
}

/* ------------------------------------------------------------- companies */

function companyOf(ctx, ref) {
  return L('lib_records').resolve(ctx.app, 'companies', ref);
}

function kb(size) {
  const n = Number(size) || 0;
  return n >= 1048576 ? Math.round(n / 104857.6) / 10 + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
}

/** companies.logo-set: set a company's logo from an upload, or your AI agent's path (a proposal for it). */
function opCompanySet(ctx, p) {
  const util = u();
  L('lib_auth').need(ctx, 'network', 'edit', 'change company logos');
  const c = companyOf(ctx, util.req(p, 'company'));
  const item = imageOf(ctx, p);
  // A proposal's check stores nothing (a file written in a rolled-back transaction would stay on disk).
  if (ctx.dryRun) return { company: { id: c.id, name: c.getString('name') }, checked: true };
  const app = ctx.app;
  const rec = app.findRecordById('companies', c.id);
  const before = rec.getString('logo');
  rec.set('logo', item.file);
  const R = L('lib_records');
  const prov = util.jsonOf(rec, 'prov', {}) || {};
  prov.logo = R.provEntry(ctx, util.str(p, 'source_ref', ''));
  rec.set('prov', prov);
  app.save(rec);
  const after = app.findRecordById('companies', c.id);
  L('lib_audit').note(ctx, { collection: 'companies', record: c.id, summary: (before === '' ? 'Added the logo of ' : 'Changed the logo of ') + c.getString('name'), before: { logo: before }, after: { logo: after.getString('logo') } });
  unstage(app, item.staged);
  return { company: Object.assign({ id: c.id, name: after.getString('name') }, viewOf(app, after)) };
}

/** companies.logo-remove (people): the company goes back to its favicon or letter. */
function opCompanyRemove(ctx, p) {
  const util = u();
  L('lib_auth').need(ctx, 'network', 'edit', 'change company logos');
  const c = companyOf(ctx, util.req(p, 'company'));
  const app = ctx.app;
  const rec = app.findRecordById('companies', c.id);
  const before = rec.getString('logo');
  if (before === '') return { company: Object.assign({ id: c.id, name: c.getString('name') }, viewOf(app, rec)), changed: false };
  rec.set('logo', '');
  const prov = util.jsonOf(rec, 'prov', {}) || {};
  prov.logo = L('lib_records').provEntry(ctx, '');
  rec.set('prov', prov);
  app.save(rec);
  L('lib_audit').note(ctx, { collection: 'companies', record: c.id, summary: 'Removed the logo of ' + c.getString('name'), before: { logo: before }, after: { logo: '' } });
  return { company: Object.assign({ id: c.id, name: c.getString('name') }, viewOf(app, app.findRecordById('companies', c.id))), changed: true };
}

/** companies.logo: the logo itself (people get the image; your AI agent its local path). */
function opCompanyGet(ctx, p) {
  const util = u();
  const rec = L('lib_records').resolve(ctx.app, 'companies', util.req(p, 'company'), { deleted: true });
  if (rec.getString('logo') === '') throw util.fail(404, rec.getString('name') + ' has no logo of its own.', 'not_found');
  return L('lib_files').serve(ctx, rec, 'logo', rec.getString('name') + ' logo', false);
}

/** The proposal people see for your AI agent's logo; stages the image it names so the accepted one is the proposed one. */
function previewCompanySet(ctx, params) {
  const util = u();
  const app = ctx.app;
  const c = companyOf(ctx, params.company);
  const paths = util.list(params, 'paths') || [];
  let name = 'an uploaded image';
  let size = 0;
  if (paths.length === 1) {
    const path = String(paths[0]);
    if (!isStaged(app, path) && ctx.isAgent) {
      const staged = stage(app, path);
      params.paths = [staged];
      name = $filepath.base(path);
    } else name = $filepath.base(path);
    try {
      size = $os.stat(String(params.paths[0])).size();
    } catch {
      size = 0;
    }
  }
  const P = L('lib_proposals');
  const before = c.getString('logo') !== '' ? 'Its own logo' : 'No logo';
  const ln = P.line('Logo', before, name + (size > 0 ? ' (' + kb(size) + ')' : ''), 'text', 'logo');
  return { label: c.getString('name') + ': Logo', target: 'companies:' + c.id, fields: ln !== null ? [ln] : [], notes: params.source_ref ? ['Source: ' + params.source_ref] : [], risk: 'low' };
}

/* ------------------------------------------------------------------ firm */

/** settings.logo-set (owner or admin): the firm's logo, shown in the sidebar in place of the app's name. */
function opFirmSet(ctx, p) {
  const app = ctx.app;
  const item = imageOf(ctx, p);
  const s = L('lib_settings').row(app);
  const rec = app.findRecordById('settings', s.id);
  const before = rec.getString('logo');
  rec.set('logo', item.file);
  app.save(rec);
  const after = app.findRecordById('settings', s.id);
  L('lib_audit').note(ctx, { collection: 'settings', record: s.id, summary: before === '' ? 'Added the firm logo' : 'Changed the firm logo', before: { logo: before }, after: { logo: after.getString('logo') } });
  return { logo_url: firmUrl(after) };
}

/** settings.logo-remove (owner or admin): the sidebar shows the app's name again. */
function opFirmRemove(ctx) {
  const app = ctx.app;
  const s = L('lib_settings').row(app);
  const rec = app.findRecordById('settings', s.id);
  const before = rec.getString('logo');
  if (before === '') return { logo_url: '', changed: false };
  rec.set('logo', '');
  app.save(rec);
  L('lib_audit').note(ctx, { collection: 'settings', record: s.id, summary: 'Removed the firm logo', before: { logo: before }, after: { logo: '' } });
  return { logo_url: '', changed: true };
}

/** settings.logo: the firm's logo itself. */
function opFirmGet(ctx) {
  const util = u();
  const s = L('lib_settings').row(ctx.app);
  if (!s || s.getString('logo') === '') throw util.fail(404, 'The firm has no logo.', 'not_found');
  return L('lib_files').serve(ctx, s, 'logo', (s.getString('firm_name') || 'Firm') + ' logo', false);
}

module.exports = {
  TYPES: TYPES,
  MAX_BYTES: MAX_BYTES,
  companyUrl: companyUrl,
  companyUrlOf: companyUrlOf,
  firmUrl: firmUrl,
  domainOf: domainOf,
  viewOf: viewOf,
  demo: demo,
  isStaged: isStaged,
  opCompanySet: opCompanySet,
  opCompanyRemove: opCompanyRemove,
  opCompanyGet: opCompanyGet,
  previewCompanySet: previewCompanySet,
  opFirmSet: opFirmSet,
  opFirmRemove: opFirmRemove,
  opFirmGet: opFirmGet,
};
