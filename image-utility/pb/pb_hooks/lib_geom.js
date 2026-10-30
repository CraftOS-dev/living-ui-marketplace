/// <reference path="../pb_data/types.d.ts" />
/**
 * Sizes through an edit stack, exactly as the engine computes them
 * (engine/img_engine/geom.py; the workspace has the same code in geom.ts),
 * so an edit's coordinates can be checked without asking the engine.
 *
 * Every edit's coordinates are full-resolution pixels of the image as it
 * enters that edit. Only crop, resize and canvas change the size.
 */

function rnd(x) {
  return Math.floor(x + 0.5);
}

/** '4:3' / '1.5' / 'original' / null -> width/height, or null for free. */
function ratioOf(r, w, h) {
  if (r === null || r === undefined || r === '' || r === 'free') return null;
  if (r === 'original') return h ? w / h : null;
  if (typeof r === 'number') return r > 0 ? r : null;
  const s = String(r);
  if (s.indexOf(':') >= 0) {
    const parts = s.split(':');
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    return a > 0 && b > 0 ? a / b : null;
  }
  const v = Number(s);
  return v > 0 ? v : null;
}

function straightenScale(w, h, angle) {
  const t = (Math.abs(angle) * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return Math.min(w / (w * c + h * s), h / (w * s + h * c));
}

function largestOfRatio(w, h, r) {
  if (w / h > r) return [Math.max(1, rnd(h * r)), h];
  return [w, Math.max(1, rnd(w / r))];
}

/** The size after flips, quarter turns and straightening, before the crop box. */
function cropBase(p, w, h) {
  const turns = (((p.turns | 0) % 4) + 4) % 4;
  if (turns % 2) {
    const t = w;
    w = h;
    h = t;
  }
  const angle = Number(p.angle || 0);
  if (Math.abs(angle) > 1e-9) {
    const k = straightenScale(w, h, angle);
    w = Math.max(1, Math.floor(w * k));
    h = Math.max(1, Math.floor(h * k));
  }
  return [w, h];
}

function cropDims(p, w0, h0) {
  const base = cropBase(p, w0, h0);
  const w = base[0];
  const h = base[1];
  const rect = p.rect;
  if (rect) {
    let x = rect.x | 0;
    let y = rect.y | 0;
    const rw = rect.w === undefined ? w : rect.w | 0;
    const rh = rect.h === undefined ? h : rect.h | 0;
    x = Math.min(Math.max(0, x), w - 1);
    y = Math.min(Math.max(0, y), h - 1);
    return [Math.max(1, Math.min(rw, w - x)), Math.max(1, Math.min(rh, h - y))];
  }
  const r = ratioOf(p.ratio, w, h);
  if (r) return largestOfRatio(w, h, r);
  return [w, h];
}

function resizeDims(p, w, h) {
  const mode = p.mode || 'longest';
  const enlarge = !!p.enlarge;
  if (mode === 'pixels') {
    const tw = p.width | 0;
    const th = p.height | 0;
    if (tw && th) return [Math.max(1, tw), Math.max(1, th)];
    if (tw) return [Math.max(1, tw), Math.max(1, rnd((h * tw) / w))];
    if (th) return [Math.max(1, rnd((w * th) / h)), Math.max(1, th)];
    return [w, h];
  }
  if (mode === 'percent') {
    const pc = Number(p.percent || 100);
    return [Math.max(1, rnd((w * pc) / 100)), Math.max(1, rnd((h * pc) / 100))];
  }
  if (mode === 'cover') return [Math.max(1, p.width | 0 || w), Math.max(1, p.height | 0 || h)];
  let k;
  if (mode === 'fit') {
    const bw = p.width | 0 || w;
    const bh = p.height | 0 || h;
    k = Math.min(bw / w, bh / h);
  } else {
    k = (p.longest | 0 || Math.max(w, h)) / Math.max(w, h);
  }
  if (!enlarge) k = Math.min(k, 1);
  return [Math.max(1, rnd(w * k)), Math.max(1, rnd(h * k))];
}

function padOf(p) {
  const pad = p.padding;
  if (typeof pad === 'number') {
    const v = Math.max(0, pad | 0);
    return [v, v, v, v];
  }
  const o = pad || {};
  return ['t', 'r', 'b', 'l'].map((k) => Math.max(0, o[k] | 0));
}

function canvasDims(p, w, h) {
  const r = ratioOf(p.ratio, w, h);
  if (r) {
    if (w / h < r) w = Math.max(w, rnd(h * r));
    else h = Math.max(h, rnd(w / r));
  }
  const pad = padOf(p);
  return [w + pad[3] + pad[1], h + pad[0] + pad[2]];
}

function dims(kind, params, w, h) {
  const p = params || {};
  if (kind === 'crop') return cropDims(p, w, h);
  if (kind === 'resize') return resizeDims(p, w, h);
  if (kind === 'canvas') return canvasDims(p, w, h);
  return [w, h];
}

/** [[w, h] entering edit 0, after edit 0, ...] for the enabled edits. */
function chain(stack, w, h) {
  const out = [[w, h]];
  for (const e of stack) {
    if (e.enabled !== false) {
      const d = dims(e.kind, e.params, w, h);
      w = d[0];
      h = d[1];
    }
    out.push([w, h]);
  }
  return out;
}

module.exports = { rnd: rnd, ratioOf: ratioOf, straightenScale: straightenScale, largestOfRatio: largestOfRatio, cropBase: cropBase, dims: dims, chain: chain, padOf: padOf };
