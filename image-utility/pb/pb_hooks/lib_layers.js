/// <reference path="../pb_data/types.d.ts" />
/**
 * Layers: objects over the photo (text, boxes, ellipses, arrows, lines,
 * highlights, numbered steps, drawings, redactions, logos). A layer is an
 * edit of kind "layer" (lib_kinds.js checks its params), so it shares the
 * stack's history, undo, proposals and journal; the engine draws layers
 * over the photo's own edits, bottom first (engine/img_engine/layers.py).
 *
 * A layer is pinned to the photo (its numbers are pixels of the original,
 * and it follows crops, turns and resizes) or to the frame (fractions of
 * the result; it stays put). Callers can give numbers in result pixels
 * (space=result, what images.render shows: the default for the operations)
 * or in the layer's own space (space=layer, what the workspace sends).
 */

function U() {
  return require(`${__hooks}/lib_util.js`);
}
function S() {
  return require(`${__hooks}/lib_stack.js`);
}
function I() {
  return require(`${__hooks}/lib_images.js`);
}

const POS_PAIRS = [
  ['cx', 'cy'],
  ['x1', 'y1'],
  ['x2', 'y2'],
];
const SIZES = ['w', 'h', 'size', 'width', 'radius'];

/** The image's photo-to-result map and result size (kept by each render). */
function frameOf(img) {
  const t = U().getJson(img, 'transform');
  return {
    F: Array.isArray(t) && t.length === 6 ? t.map(Number) : [1, 0, 0, 0, 1, 0],
    W: img.getInt('out_width') || img.getInt('width') || 1,
    H: img.getInt('out_height') || img.getInt('height') || 1,
  };
}

function apply(F, x, y) {
  return [F[0] * x + F[1] * y + F[2], F[3] * x + F[4] * y + F[5]];
}

function invert(F) {
  const det = F[0] * F[4] - F[1] * F[3] || 1;
  return [F[4] / det, -F[1] / det, (F[1] * F[5] - F[4] * F[2]) / det, -F[3] / det, F[0] / det, (F[3] * F[2] - F[0] * F[5]) / det];
}

function unitOf(F, frame, fr) {
  return frame ? Math.min(fr.W, fr.H) : Math.sqrt(Math.abs(F[0] * F[4] - F[1] * F[3])) || 1;
}

function round(v, frame) {
  const k = frame ? 100000 : 100;
  return Math.round(v * k) / k;
}

/** Numbers given in result pixels, into the layer's own space (only the keys present). */
function fromResult(p, fr) {
  const frame = p.anchor === 'frame';
  const Fi = invert(fr.F);
  const unit = unitOf(fr.F, frame, fr);
  const out = Object.assign({}, p);
  for (const [kx, ky] of POS_PAIRS) {
    if (typeof out[kx] === 'number' && typeof out[ky] === 'number') {
      const q = frame ? [out[kx] / fr.W, out[ky] / fr.H] : apply(Fi, out[kx], out[ky]);
      out[kx] = round(q[0], frame);
      out[ky] = round(q[1], frame);
    }
  }
  for (const k of SIZES) if (typeof out[k] === 'number') out[k] = round(out[k] / unit, frame);
  if (!frame && typeof out.rotation === 'number') out.rotation = Math.round((out.rotation - (Math.atan2(fr.F[3], fr.F[0]) * 180) / Math.PI) * 100) / 100;
  return out;
}

/** The layer's numbers in result pixels (for the agent to compare with what it sees). */
function toResult(p, fr) {
  const frame = p.anchor === 'frame';
  const unit = unitOf(fr.F, frame, fr);
  const out = {};
  for (const [kx, ky] of POS_PAIRS) {
    if (typeof p[kx] === 'number' && typeof p[ky] === 'number') {
      const q = frame ? [p[kx] * fr.W, p[ky] * fr.H] : apply(fr.F, p[kx], p[ky]);
      out[kx] = Math.round(q[0]);
      out[ky] = Math.round(q[1]);
    }
  }
  for (const k of SIZES) if (typeof p[k] === 'number') out[k] = Math.round(p[k] * unit * 10) / 10;
  if (typeof p.rotation === 'number') out.rotation = Math.round((p.rotation + (frame ? 0 : (Math.atan2(fr.F[3], fr.F[0]) * 180) / Math.PI)) * 10) / 10;
  return out;
}

function serialize(e, fr) {
  return {
    id: e.id,
    type: e.params.type,
    name: e.params.name || '',
    visible: e.enabled !== false,
    locked: e.params.locked === true,
    anchor: e.params.anchor || 'photo',
    state: e.state,
    author: e.author,
    params: e.params,
    in_result: toResult(e.params, fr),
  };
}

function mustLayer(app, id) {
  const u = U();
  const rec = u.byId(app, 'edits', id);
  if (rec === null || rec.getString('kind') !== 'layer') throw u.fail(404, 'No layer ' + id + ' (layers.list gives the ids)');
  return rec;
}

function propsOf(p) {
  const u = U();
  const v = u.obj(p, 'props', '{"cx":400,"cy":300,"text":"Look here","size":48}');
  return v === undefined ? {} : v;
}

/** layers.list: the image's layers, bottom first. */
function list(app, p) {
  const u = U();
  const img = I().mustImage(app, u.req(p, 'image', '<image id>'));
  const fr = frameOf(img);
  const layers = S()
    .load(app, img.id)
    .filter((e) => e.kind === 'layer');
  return { image: img.id, result: { width: fr.W, height: fr.H }, layers: layers.map((e) => serialize(e, fr)) };
}

/** layers.add: a new layer on top. */
function add(app, e, p) {
  const u = U();
  const img = I().mustImage(app, u.req(p, 'image', '<image id>'));
  let params = Object.assign({}, propsOf(p), { type: u.str(p, 'type', '') });
  if (u.has(p, 'anchor')) params.anchor = u.str(p, 'anchor', 'photo');
  if (u.has(p, 'name')) params.name = u.str(p, 'name', '');
  if (u.oneOf(p, 'space', ['result', 'layer'], 'result') === 'result') params = fromResult(params, frameOf(img));
  return S().add(app, e, { image: img.id, kind: 'layer', params: params, dry_run: p.dry_run, max: p.max, title: p.title, reason: p.reason, note: p.note });
}

/** layers.update: change a layer (props merge; a null removes a key), show or hide it. */
function update(app, e, p) {
  const u = U();
  const rec = mustLayer(app, u.req(p, 'layer', '<layer id>'));
  const img = I().mustImage(app, rec.getString('image'));
  const cur = u.getJson(rec, 'params') || {};
  let given = propsOf(p);
  for (const k of ['name', 'opacity']) if (u.has(p, k)) given[k] = k === 'opacity' ? u.number(p, k, 1) : u.str(p, k, '');
  if (u.has(p, 'locked')) given.locked = u.bool(p, 'locked', false) || null;
  if (u.has(p, 'anchor')) given.anchor = u.str(p, 'anchor', 'photo');
  if (u.oneOf(p, 'space', ['result', 'layer'], 'result') === 'result') given = fromResult(Object.assign({ anchor: given.anchor || cur.anchor }, given), frameOf(img));
  const merged = Object.assign({}, cur, given);
  for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
  const args = { edit: rec.id, params: merged, replace: true, dry_run: p.dry_run, max: p.max, title: p.title, reason: p.reason };
  if (u.has(p, 'visible')) args.enabled = u.bool(p, 'visible', true);
  return S().update(app, e, args);
}

/** layers.arrange: front, back, forward or backward among the image's layers. */
function arrange(app, e, p) {
  const u = U();
  const rec = mustLayer(app, u.req(p, 'layer', '<layer id>'));
  const to = u.oneOf(p, 'to', ['front', 'back', 'forward', 'backward'], '');
  if (to === '') throw u.fail(400, 'to is required: front, back, forward or backward');
  const list = S().load(app, rec.getString('image'));
  const target = list.find((x) => x.id === rec.id);
  const vis = S().visible(list, target.state === 'proposed' ? target.proposal : '');
  const i = vis.indexOf(target);
  const layerIdx = vis.map((x, k) => (x.kind === 'layer' ? k : -1)).filter((k) => k >= 0);
  const pos = layerIdx.indexOf(i);
  let dest = i;
  if (to === 'front') dest = vis.length - 1;
  else if (to === 'back') dest = layerIdx[0];
  else if (to === 'forward' && pos < layerIdx.length - 1) dest = layerIdx[pos + 1];
  else if (to === 'backward' && pos > 0) dest = layerIdx[pos - 1];
  if (dest === i) return { ok: true, unchanged: true, message: 'Already ' + (to === 'front' || to === 'forward' ? 'at the front' : 'at the back') };
  return S().move(app, e, { edit: rec.id, to: dest, dry_run: p.dry_run, title: p.title, reason: p.reason });
}

/** layers.remove: one layer or several. */
function remove(app, e, p) {
  const u = U();
  const ids = (u.list(p, 'layers') || []).map(String);
  if (u.str(p, 'layer', '') !== '') ids.push(u.str(p, 'layer', ''));
  if (ids.length === 0) throw u.fail(400, 'layer (or layers, a JSON list of ids) is required');
  for (const id of ids) mustLayer(app, id);
  return S().remove(app, e, { edits: ids, dry_run: p.dry_run, title: p.title, reason: p.reason });
}

module.exports = { frameOf: frameOf, fromResult: fromResult, toResult: toResult, list: list, add: add, update: update, arrange: arrange, remove: remove };
