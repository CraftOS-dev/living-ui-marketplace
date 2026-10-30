/// <reference path="../pb_data/types.d.ts" />
/**
 * Presets: export settings (one or more outputs), output sizes (a social
 * size the resize covers) and edit recipes (a list of edits). Built-in ones
 * come with the app and cannot be changed; yours can.
 */

function U() {
  return require(`${__hooks}/lib_util.js`);
}

function serialize(rec) {
  return {
    id: rec.id,
    name: rec.getString('name'),
    kind: rec.getString('kind'),
    description: rec.getString('description'),
    data: U().getJson(rec, 'data') || {},
    builtin: rec.getBool('builtin'),
    sort: rec.getInt('sort'),
  };
}

function mustPreset(app, ref) {
  const u = U();
  const v = String(ref || '').trim();
  let rec = u.byId(app, 'presets', v);
  if (rec === null) rec = u.findOne(app, 'presets', 'name = {:n}', { n: v });
  if (rec === null) throw u.fail(404, 'No preset "' + v + '"; see presets.list');
  return rec;
}

function list(app, p) {
  const u = U();
  const kind = u.oneOf(p, 'kind', ['export', 'size', 'recipe'], '');
  const rows = app.findRecordsByFilter('presets', kind ? 'kind = {:k}' : 'id != ""', '-builtin,sort,name', 0, 0, { k: kind });
  return { presets: rows.map(serialize) };
}

function save(app, e, p) {
  const u = U();
  const ref = u.str(p, 'preset', '') || u.str(p, 'id', '');
  let rec = ref ? mustPreset(app, ref) : null;
  if (rec !== null && rec.getBool('builtin')) throw u.fail(403, 'Built-in presets cannot be changed; save it under a new name instead');
  const kind = u.oneOf(p, 'kind', ['export', 'size', 'recipe'], rec ? rec.getString('kind') : u.str(p, 'from_image', '') !== '' ? 'recipe' : '');
  if (kind === '') throw u.fail(400, 'kind is required: export, size or recipe');
  const name = u.squash(u.str(p, 'name', rec ? rec.getString('name') : '')).slice(0, 120);
  if (name === '') throw u.fail(400, 'name is required');
  let data = u.obj(p, 'data', '{"outputs":[{"format":"webp","quality":"balanced"}]}');
  const skipped = [];
  if (kind === 'recipe' && u.str(p, 'from_image', '') !== '') {
    // The image's edits as a recipe: marks placed on that one image and boxed crops do not carry over.
    const img = require(`${__hooks}/lib_images.js`).mustImage(app, u.str(p, 'from_image', ''));
    const edits = [];
    for (const x of require(`${__hooks}/lib_images.js`).activeEdits(app, img.id)) {
      if (x.enabled === false) continue;
      if (x.kind === 'layer' && x.params.anchor !== 'frame') skipped.push(require(`${__hooks}/lib_kinds.js`).layerTitle(x.params).toLowerCase());
      else if (x.kind === 'crop' && x.params.rect) {
        const rest = Object.assign({}, x.params);
        delete rest.rect;
        if (Object.keys(rest).length > 0) edits.push({ kind: 'crop', params: rest });
        skipped.push('crop box');
      } else edits.push({ kind: x.kind, params: x.params });
    }
    if (edits.length === 0) throw u.fail(400, 'That image has no edits that work as a recipe (layers pinned to the photo and crop boxes belong to one image)');
    data = { edits: edits };
  }
  if (data === undefined && rec === null) throw u.fail(400, 'data is required');
  if (data !== undefined) {
    if (kind === 'export') {
      if (!Array.isArray(data.outputs) || data.outputs.length === 0) throw u.fail(400, 'An export preset needs data.outputs, e.g. {"outputs":[{"format":"webp","quality":"balanced"}]}');
      require(`${__hooks}/lib_export.js`).outputsFrom(app, data, null);
    } else if (kind === 'size') {
      if (!(data.width > 0 && data.height > 0)) throw u.fail(400, 'A size preset needs data.width and data.height, e.g. {"width":1080,"height":1350}');
    } else if (!Array.isArray(data.edits) || data.edits.length === 0) {
      throw u.fail(400, 'A recipe needs data.edits, e.g. {"edits":[{"kind":"resize","params":{"mode":"longest","longest":2048}}]}');
    } else {
      const K = require(`${__hooks}/lib_kinds.js`);
      data.edits.forEach((x, i) => {
        if (!x || !K.KINDS[x.kind]) throw u.fail(400, 'data.edits[' + i + '].kind must be one of: ' + Object.keys(K.KINDS).join(', '));
        if (x.kind === 'crop' && x.params && x.params.rect) throw u.fail(400, 'A recipe runs on images of any size, so a crop in it uses a ratio (e.g. {"ratio":"1:1","smart":true}), not a rect');
        try {
          K.params(x.kind, x.params || {}, 4000, 3000);
        } catch (err) {
          throw u.fail(400, 'data.edits[' + i + '] (' + x.kind + '): ' + err.message);
        }
      });
    }
  }
  if (rec === null) {
    rec = new Record(app.findCollectionByNameOrId('presets'));
    rec.set('builtin', false);
    rec.set('sort', 1000);
  }
  rec.set('name', name);
  rec.set('kind', kind);
  if (u.has(p, 'description')) rec.set('description', u.str(p, 'description', '').slice(0, 500));
  if (data !== undefined) rec.set('data', data);
  app.save(rec);
  return { ok: true, preset: serialize(rec), skipped: skipped };
}

function remove(app, e, p) {
  const u = U();
  const rec = mustPreset(app, u.req(p, 'preset', '<preset id>'));
  if (rec.getBool('builtin')) throw u.fail(403, 'Built-in presets cannot be deleted');
  app.delete(rec);
  return { ok: true, deleted: rec.id };
}

module.exports = { serialize: serialize, mustPreset: mustPreset, list: list, save: save, remove: remove };
