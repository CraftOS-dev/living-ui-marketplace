/// <reference path="../pb_data/types.d.ts" />
/**
 * Exports: files for use outside the app. STEP (AP214, mm, bodies named,
 * re-read and checked for the same volume), STL (binary), 3MF (one object
 * per body, mm) and GLB (glTF in metres). The file is stored with the part
 * and its absolute path returned, so the AI agent can attach it, upload it
 * or hand it to a slicer with its own tools.
 */

const FORMATS = ['step', 'stl', '3mf', 'glb'];
const EXT = { step: 'step', stl: 'stl', '3mf': '3mf', glb: 'glb' };

function u() {
  return require(`${__hooks}/lib_util.js`);
}

function exportJson(app, x) {
  const util = u();
  const part = util.byId(app, 'parts', x.getString('part'));
  return {
    id: x.id,
    part: part === null ? null : { id: part.id, name: part.getString('name') },
    format: x.getString('format'),
    name: x.getString('name'),
    bytes: x.getInt('bytes'),
    triangles: x.getInt('triangles') || null,
    tolerance: x.getFloat('tolerance') || null,
    verified: x.getBool('verified'),
    requested_by: x.getString('requested_by'),
    pinned: x.getBool('pinned'),
    created: x.getString('created'),
    path: util.filePath(app, x, 'file'),
    url: util.fileUrl(x, 'file'),
    // The part has changed since this file was made.
    outdated: part !== null && x.getString('input_hash') !== part.getString('tree_hash'),
  };
}

/** A file name from the part's name: letters, digits, space, dot, dash and underscore. */
function fileBase(name) {
  let out = '';
  for (const ch of String(name)) {
    const ok = (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch === ' ' || ch === '-' || ch === '_' || ch === '.';
    out += ok ? ch : '_';
  }
  out = out.trim();
  return out === '' ? 'part' : out.slice(0, 80);
}

function create(app, e, p) {
  const util = u();
  const T = require(`${__hooks}/lib_tree.js`);
  const part = T.part(app, util.req(p, 'part', '<part id or name>'));
  const format = util.oneOf(p, 'format', FORMATS, '');
  if (format === '') throw util.fail(400, 'format is required: ' + FORMATS.join(', '));
  const tolerance = util.number(p, 'tolerance', { min: 0.001, max: 2 });
  const base = fileBase(util.str(p, 'name', '') || part.getString('name'));
  const input = T.buildInput(app, part);
  const E = require(`${__hooks}/lib_engine.js`);
  const job = {
    kind: 'export',
    tree: input.tree,
    assets: input.assets,
    options: { format: format, tolerance: tolerance, name: part.getString('name'), file: base + '.' + EXT[format] },
  };
  const res = E.call(app, job, 180000);
  if (!res.ok) throw util.fail(400, (res.error && res.error.message) || 'The export failed', res.error);
  const r = res.result;
  let rec = null;
  // The engine's file can be held for a moment by a virus scan; retry the save.
  E.patiently(() => app.runInTransaction((tx) => {
    rec = new Record(tx.findCollectionByNameOrId('exports'));
    rec.set('part', part.id);
    const cur = util.byId(tx, 'builds', part.getString('current_build'));
    if (cur !== null && cur.getString('input_hash') === input.hash) rec.set('build', cur.id);
    rec.set('format', format);
    rec.set('file', $filesystem.fileFromPath(r.path));
    rec.set('name', base + '.' + EXT[format]);
    rec.set('bytes', r.bytes);
    if (r.triangles) rec.set('triangles', r.triangles);
    rec.set('tolerance', format === 'step' ? 0 : tolerance || 0.02);
    rec.set('verified', r.verified === true);
    rec.set('input_hash', input.hash);
    rec.set('requested_by', util.actor(e));
    rec.set('pinned', false);
    tx.save(rec);
  }), 3000);
  try {
    $os.removeAll(job.out_dir);
  } catch {
    /* best effort */
  }
  const out = { export: exportJson(app, rec) };
  if (r.failed_at) out.warning = 'The tree fails at ' + r.failed_at + '; this file holds the model up to the feature before it.';
  if (format === 'step') out.check = r.verified ? 'Re-read the STEP file: same volume (' + util.fmt(r.volume_mm3) + ' mm3).' : 'The STEP file was written but re-reading it gave a different volume; check it in another CAD tool.';
  return out;
}

function list(app, p) {
  const util = u();
  const filters = [];
  const bind = {};
  if (util.str(p, 'part', '') !== '') {
    filters.push('part = {:p}');
    bind.p = require(`${__hooks}/lib_tree.js`).part(app, util.str(p, 'part')).id;
  }
  const format = util.oneOf(p, 'format', FORMATS, '');
  if (format !== '') {
    filters.push('format = {:f}');
    bind.f = format;
  }
  const limit = util.int(p, 'limit', 50, 1, 500);
  const page = util.int(p, 'page', 1, 1, 100000);
  const rows = app.findRecordsByFilter('exports', filters.join(' && '), '-pinned,-created', limit + 1, (page - 1) * limit, bind);
  return { exports: rows.slice(0, limit).map((x) => exportJson(app, x)), more: rows.length > limit };
}

module.exports = { create: create, list: list, exportJson: exportJson, FORMATS: FORMATS };
