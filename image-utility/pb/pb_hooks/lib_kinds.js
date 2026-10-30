/// <reference path="../pb_data/types.d.ts" />
/**
 * The edit kinds: what each one's params are, how they are checked (every
 * error names the param and a valid value) and how an edit reads in the
 * stack and the history. Coordinates are full-resolution pixels of the image
 * as it enters the edit; `w` and `h` below are that size.
 */

const FILTERS = ['vivid', 'warm', 'cool', 'mono', 'noir', 'sepia', 'fade', 'vintage', 'chrome', 'matte', 'dramatic', 'soft'];
const FILTER_LABEL = { vivid: 'Vivid', warm: 'Warm', cool: 'Cool', mono: 'Mono', noir: 'Noir', sepia: 'Sepia', fade: 'Fade', vintage: 'Vintage', chrome: 'Chrome', matte: 'Matte', dramatic: 'Dramatic', soft: 'Soft' };
const ADJUST = ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'saturation', 'vibrance', 'temperature', 'tint', 'clarity', 'sharpen', 'vignette'];
const ADJUST_LABEL = { exposure: 'Exposure', contrast: 'Contrast', highlights: 'Highlights', shadows: 'Shadows', whites: 'Whites', blacks: 'Blacks', saturation: 'Saturation', vibrance: 'Vibrance', temperature: 'Temperature', tint: 'Tint', clarity: 'Clarity', sharpen: 'Sharpen', vignette: 'Vignette' };
const RESAMPLE = ['lanczos', 'sharp', 'bicubic', 'bilinear', 'nearest'];
const FONTS = ['sans', 'sans-bold', 'serif', 'serif-bold', 'mono', 'hand', 'impact'];
const LAYER_TYPES = ['text', 'rect', 'ellipse', 'arrow', 'line', 'highlight', 'step', 'pen', 'redact', 'logo'];
const LAYER_LABEL = { text: 'Text', rect: 'Box', ellipse: 'Ellipse', arrow: 'Arrow', line: 'Line', highlight: 'Highlight', step: 'Step', pen: 'Drawing', redact: 'Redaction', logo: 'Logo' };
const MAX_SIDE = 30000;
const MAX_MP = 400;

const KINDS = {
  crop: { label: 'Crop', icon: 'Crop', summary: 'Crop, straighten, rotate by quarter turns and flip', resizes: true },
  resize: { label: 'Resize', icon: 'Scaling', summary: 'Pixels, percent, fit in a box, longest edge or cover an exact size', resizes: true },
  canvas: { label: 'Canvas', icon: 'Frame', summary: 'Padding, a target ratio, a background, rounded corners and a shadow', resizes: true },
  adjust: { label: 'Adjust', icon: 'SlidersHorizontal', summary: 'Light, colour, detail and vignette sliders, or Auto' },
  filter: { label: 'Filter', icon: 'Wand2', summary: 'A look (' + FILTERS.join(', ') + ') with a strength' },
  remove_bg: { label: 'Remove background', icon: 'Eraser', summary: 'Cut out the subject (a model on this computer) onto transparency or a colour' },
  layer: { label: 'Layer', icon: 'Layers', summary: 'An object over the photo: text, a box, an ellipse, an arrow, a line, a highlight, a numbered step, a drawing, a redaction or a logo; moved, resized, rotated, stacked, shown or hidden on its own' },
};

function U() {
  return require(`${__hooks}/lib_util.js`);
}

function bad(msg) {
  return U().fail(400, msg);
}

function num(v, name, min, max, dflt) {
  if (v === undefined || v === null || v === '') return dflt;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  if (!isFinite(n)) throw bad(name + ' must be a number from ' + min + ' to ' + max);
  if (n < min || n > max) throw bad(name + ' must be from ' + min + ' to ' + max + ' (got ' + n + ')');
  return n;
}

function int(v, name, min, max, dflt) {
  if (v === undefined || v === null || v === '') return dflt;
  return Math.round(num(v, name, min, max, dflt));
}

function bool(v, dflt) {
  if (v === undefined || v === null || v === '') return dflt;
  if (v === true || v === 'true' || v === 1 || v === '1') return true;
  if (v === false || v === 'false' || v === 0 || v === '0') return false;
  return dflt;
}

function color(v, name, dflt) {
  if (v === undefined || v === null || v === '') return dflt;
  const s = String(v).trim();
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s)) throw bad(name + ' must be a colour like #ff4f18 (got "' + s + '")');
  return s.toLowerCase();
}

function oneOf(v, name, values, dflt) {
  if (v === undefined || v === null || v === '') return dflt;
  const s = String(v);
  if (values.indexOf(s) < 0) throw bad(name + ' must be one of: ' + values.join(', '));
  return s;
}

function ratio(v, name) {
  if (v === undefined || v === null || v === '' || v === 'free') return null;
  const geom = require(`${__hooks}/lib_geom.js`);
  if (v === 'original') return 'original';
  if (geom.ratioOf(v, 1, 1) === null) throw bad(name + ' must be like 1:1, 4:3, 16:9, original or a number like 1.5 (got "' + v + '")');
  return typeof v === 'number' ? v : String(v);
}

function itemList(v, name, max) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw bad(name + ' must be a list');
  if (v.length > max) throw bad(name + ': at most ' + max + ' items');
  return v;
}

/* ------------------------------------------------------------- per kind */

function cropParams(p, w, h) {
  const geom = require(`${__hooks}/lib_geom.js`);
  const out = {};
  const turns = int(p.turns, 'turns', -3, 3, 0);
  if (turns) out.turns = ((turns % 4) + 4) % 4;
  if (bool(p.flip_h, false)) out.flip_h = true;
  if (bool(p.flip_v, false)) out.flip_v = true;
  const angle = num(p.angle, 'angle', -45, 45, 0);
  if (angle) out.angle = Math.round(angle * 100) / 100;
  const base = geom.cropBase(out, w, h);
  if (p.rect !== undefined && p.rect !== null) {
    const r = p.rect;
    if (typeof r !== 'object') throw bad('rect must be {"x":..,"y":..,"w":..,"h":..} in pixels of the image as it enters the crop');
    const x = int(r.x, 'rect.x', 0, base[0] - 1, 0);
    const y = int(r.y, 'rect.y', 0, base[1] - 1, 0);
    const rw = int(r.w, 'rect.w', 1, base[0], base[0]);
    const rh = int(r.h, 'rect.h', 1, base[1], base[1]);
    if (x + rw > base[0] || y + rh > base[1]) throw bad('rect reaches outside the image (' + base[0] + ' x ' + base[1] + ' after rotating): x + w must be at most ' + base[0] + ' and y + h at most ' + base[1]);
    if (!(x === 0 && y === 0 && rw === base[0] && rh === base[1])) out.rect = { x: x, y: y, w: rw, h: rh };
  }
  const rt = ratio(p.ratio, 'ratio');
  if (rt !== null) out.ratio = rt;
  if (!out.rect && out.ratio && bool(p.smart, false)) out.smart = true;
  if (Object.keys(out).length === 0) throw bad('A crop needs something to do: rect, ratio, angle, turns, flip_h or flip_v');
  return out;
}

function resizeParams(p, w, h) {
  const mode = oneOf(p.mode, 'mode', ['pixels', 'percent', 'fit', 'longest', 'cover'], 'longest');
  const out = { mode: mode };
  if (mode === 'pixels') {
    const tw = int(p.width, 'width', 1, MAX_SIDE, 0);
    const th = int(p.height, 'height', 1, MAX_SIDE, 0);
    if (!tw && !th) throw bad('mode pixels needs width or height (or both), e.g. width=1920');
    if (tw) out.width = tw;
    if (th) out.height = th;
  } else if (mode === 'percent') {
    out.percent = num(p.percent, 'percent', 1, 1000, null);
    if (out.percent === null) throw bad('mode percent needs percent, e.g. percent=50');
  } else if (mode === 'fit' || mode === 'cover') {
    out.width = int(p.width, 'width', 1, MAX_SIDE, 0);
    out.height = int(p.height, 'height', 1, MAX_SIDE, 0);
    if (!out.width || !out.height) throw bad('mode ' + mode + ' needs width and height, e.g. width=1200 height=630');
    if (mode === 'cover' && bool(p.smart, true)) out.smart = true;
  } else {
    out.longest = int(p.longest, 'longest', 1, MAX_SIDE, 0);
    if (!out.longest) throw bad('mode longest needs longest (the longest edge in pixels), e.g. longest=2048');
  }
  if (bool(p.enlarge, false)) out.enlarge = true;
  const rs = oneOf(p.resample, 'resample', RESAMPLE, 'lanczos');
  if (rs !== 'lanczos') out.resample = rs;
  if (bool(p.sharpen, true) === false) out.sharpen = false;
  const d = require(`${__hooks}/lib_geom.js`).dims('resize', out, w, h);
  if ((d[0] * d[1]) / 1e6 > MAX_MP) throw bad('The result would be ' + d[0] + ' x ' + d[1] + ' (' + Math.round((d[0] * d[1]) / 1e6) + ' MP); the limit is ' + MAX_MP + ' MP');
  return out;
}

function fillOf(v) {
  if (v === undefined || v === null || v === '') return '#ffffff';
  if (v === 'transparent' || v === 'blur') return v;
  if (typeof v === 'object') return { from: color(v.from, 'fill.from', '#ff4f18'), to: color(v.to, 'fill.to', '#7b2ff7'), angle: num(v.angle, 'fill.angle', 0, 360, 135) };
  if (typeof v === 'string' && v.charAt(0) === '{') {
    try {
      return fillOf(JSON.parse(v));
    } catch (err) {
      if (err && err.status) throw err;
      throw bad('fill must be transparent, blur, a colour like #ffffff or {"from":"#ff4f18","to":"#7b2ff7","angle":135}');
    }
  }
  return color(v, 'fill', '#ffffff');
}

function canvasParams(p) {
  const out = {};
  if (typeof p.padding === 'object' && p.padding !== null) {
    out.padding = {};
    for (const k of ['t', 'r', 'b', 'l']) out.padding[k] = int(p.padding[k], 'padding.' + k, 0, 5000, 0);
  } else {
    out.padding = int(p.padding, 'padding', 0, 5000, 0);
  }
  const rt = ratio(p.ratio, 'ratio');
  if (rt !== null) out.ratio = rt;
  out.fill = fillOf(p.fill);
  const radius = int(p.radius, 'radius', 0, 2000, 0);
  if (radius) out.radius = radius;
  if (bool(p.shadow, false)) {
    out.shadow = true;
    const so = num(p.shadow_opacity, 'shadow_opacity', 0, 1, 0.35);
    if (so !== 0.35) out.shadow_opacity = so;
  }
  return out;
}

function adjustParams(p) {
  const out = {};
  for (const k of ADJUST) {
    const v = k === 'exposure' ? num(p[k], k, -3, 3, 0) : k === 'sharpen' ? num(p[k], k, 0, 100, 0) : num(p[k], k, -100, 100, 0);
    if (v) out[k] = k === 'exposure' ? Math.round(v * 100) / 100 : Math.round(v);
  }
  if (p.levels) {
    const lv = typeof p.levels === 'string' ? JSON.parse(p.levels) : p.levels;
    const black = int(lv.black, 'levels.black', 0, 254, 0);
    const white = int(lv.white, 'levels.white', 1, 255, 255);
    if (white <= black) throw bad('levels.white must be above levels.black');
    out.levels = { black: black, white: white, gamma: Math.round(num(lv.gamma, 'levels.gamma', 0.1, 10, 1) * 100) / 100 };
  }
  if (bool(p.auto, false)) out.auto = true;
  if (Object.keys(out).length === 0) throw bad('An adjust needs at least one slider, e.g. exposure=0.3 or contrast=20 (sliders: ' + ADJUST.join(', ') + '; exposure is EV -3..3, the rest -100..100)');
  return out;
}

function filterParams(p) {
  const name = oneOf(p.name, 'name', FILTERS, null);
  if (name === null) throw bad('name is required: one of ' + FILTERS.join(', '));
  return { name: name, strength: int(p.strength, 'strength', 0, 100, 100) };
}

/* ------------------------------------------------------------------ layers */

/**
 * A layer's params. Pinned to the photo (anchor photo, the default): numbers
 * are pixels of the original photo. Pinned to the frame: positions are
 * fractions of the result's width and height (0..1), sizes fractions of its
 * shorter side. Box layers: cx, cy, w, h, rotation; text: cx, cy, size,
 * rotation; step: cx, cy, size; arrow and line: x1, y1, x2, y2.
 */
function layerParams(p) {
  const type = oneOf(p.type, 'type', LAYER_TYPES, null);
  if (type === null) throw bad('type is required: one of ' + LAYER_TYPES.join(', '));
  const anchor = oneOf(p.anchor, 'anchor', ['photo', 'frame'], 'photo');
  const frame = anchor === 'frame';
  const PMIN = frame ? -2 : -1e6;
  const PMAX = frame ? 3 : 1e6;
  const SMIN = frame ? 0.0005 : 0.5;
  const SMAX = frame ? 10 : 1e6;
  const r = (v) => (frame ? Math.round(v * 100000) / 100000 : Math.round(v * 100) / 100);
  const req = (k, min, max, dflt) => {
    const v = num(p[k], k, min, max, dflt);
    if (v === null || v === undefined) throw bad(k + ' is required for a ' + type + ' layer' + (frame ? ' (a fraction of the frame)' : ' (pixels of the photo)'));
    return r(v);
  };
  const out = { type: type };
  if (frame) out.anchor = 'frame';
  if (p.name !== undefined && p.name !== null && String(p.name).trim() !== '') out.name = String(p.name).slice(0, 80);
  if (bool(p.locked, false)) out.locked = true;
  const op = num(p.opacity, 'opacity', 0.05, 1, 1);
  if (op !== 1) out.opacity = Math.round(op * 100) / 100;
  const width = (dflt) => r(num(p.width, 'width', 0, frame ? 1 : 2000, frame ? dflt / 1000 : dflt));
  const rotation = () => {
    const v = num(p.rotation, 'rotation', -3600, 3600, 0);
    const n = ((((v + 180) % 360) + 360) % 360) - 180;
    return Math.round(n * 100) / 100;
  };
  if (type === 'arrow' || type === 'line') {
    for (const k of ['x1', 'y1', 'x2', 'y2']) out[k] = req(k, PMIN, PMAX, null);
    out.width = width(6);
    out.color = color(p.color, 'color', '#ff4f18');
    if (type === 'arrow' && bool(p.both, false)) out.both = true;
    return out;
  }
  out.cx = req('cx', PMIN, PMAX, null);
  out.cy = req('cy', PMIN, PMAX, null);
  if (type === 'text') {
    const text = String(p.text === undefined || p.text === null ? '' : p.text).slice(0, 2000);
    if (text.trim() === '') throw bad('text is empty: give the words to show');
    out.text = text;
    out.size = req('size', SMIN, SMAX, frame ? 0.05 : 48);
    const rot = rotation();
    if (rot) out.rotation = rot;
    out.font = oneOf(p.font, 'font', FONTS, 'sans-bold');
    out.color = color(p.color, 'color', '#ff4f18');
    if (p.bg) out.bg = color(p.bg, 'bg', null);
    if (p.outline) out.outline = color(p.outline, 'outline', null);
    const align = oneOf(p.align, 'align', ['left', 'center', 'right'], 'left');
    if (align !== 'left') out.align = align;
    if (bool(p.tile, false)) {
      out.tile = true;
      out.gap = Math.round(num(p.gap, 'gap', 0, 400, 60));
    }
    return out;
  }
  if (type === 'step') {
    out.size = req('size', SMIN, SMAX, frame ? 0.04 : 40);
    out.n = String(p.n === undefined || p.n === null ? 1 : p.n).slice(0, 3);
    out.color = color(p.color, 'color', '#ff4f18');
    return out;
  }
  out.w = req('w', SMIN, SMAX, null);
  out.h = req('h', SMIN, SMAX, null);
  const rot = rotation();
  if (rot) out.rotation = rot;
  if (type === 'rect' || type === 'ellipse') {
    out.width = width(6);
    out.color = color(p.color, 'color', '#ff4f18');
    if (p.fill) {
      out.fill = color(p.fill, 'fill', null);
      out.fill_opacity = num(p.fill_opacity, 'fill_opacity', 0, 1, 0.25);
    }
    if (type === 'rect' && p.radius) out.radius = r(num(p.radius, 'radius', 0, frame ? 2 : 1e5, 0));
  } else if (type === 'highlight') {
    out.color = color(p.color, 'color', '#ffd60a');
  } else if (type === 'redact') {
    out.mode = oneOf(p.mode, 'mode', ['solid', 'pixelate', 'blur'], 'solid');
    if (out.mode === 'solid') out.color = color(p.color, 'color', '#000000');
    if (p.label) out.label = String(p.label).slice(0, 80);
  } else if (type === 'logo') {
    if (!p.asset) throw bad('asset is required for a logo layer: a logo id from assets.list');
    out.asset = String(p.asset);
    if (bool(p.tile, false)) {
      out.tile = true;
      out.gap = Math.round(num(p.gap, 'gap', 0, 400, 60));
    }
  } else if (type === 'pen') {
    const pts = itemList(p.points, 'points', 5000);
    if (pts.length < 2) throw bad('points needs at least 2 points [[u,v],...] in -0.5..0.5 of the box');
    out.points = pts.map((q, j) => {
      if (!Array.isArray(q) || q.length < 2) throw bad('points[' + j + '] must be [u, v]');
      return [Math.round(num(q[0], 'points[' + j + '][0]', -0.6, 0.6, 0) * 10000) / 10000, Math.round(num(q[1], 'points[' + j + '][1]', -0.6, 0.6, 0) * 10000) / 10000];
    });
    out.width = width(6);
    out.color = color(p.color, 'color', '#ff4f18');
  }
  return out;
}

function removeBgParams(p) {
  const out = { model: oneOf(p.model, 'model', ['fast', 'detailed'], 'fast') };
  const bg = p.background === undefined || p.background === '' ? 'transparent' : String(p.background);
  out.background = bg === 'transparent' ? 'transparent' : color(bg, 'background', '#ffffff');
  out.edge = oneOf(p.edge, 'edge', ['soft', 'hard'], 'soft');
  const refine = int(p.refine, 'refine', -20, 20, 0);
  if (refine) out.refine = refine;
  return out;
}

/** Checked, normalized params for an edit of kind entering at w x h. */
function params(kind, raw, w, h) {
  const p = raw || {};
  if (!KINDS[kind]) throw bad('kind must be one of: ' + Object.keys(KINDS).join(', '));
  if (kind === 'crop') return cropParams(p, w, h);
  if (kind === 'resize') return resizeParams(p, w, h);
  if (kind === 'canvas') return canvasParams(p);
  if (kind === 'adjust') return adjustParams(p);
  if (kind === 'filter') return filterParams(p);
  if (kind === 'layer') return layerParams(p);
  return removeBgParams(p);
}

function signed(v, digits) {
  const s = digits ? v.toFixed(digits) : String(Math.round(v));
  return v > 0 ? '+' + s : s;
}

/** One line for the stack and the history. */
function summary(kind, p, outDims) {
  p = p || {};
  const size = outDims ? outDims[0] + ' x ' + outDims[1] : '';
  if (kind === 'crop') {
    const bits = [];
    if (p.rect) bits.push(size);
    else if (p.ratio) bits.push((p.ratio === 'original' ? 'original ratio' : String(p.ratio)) + (p.smart ? ' (smart)' : '') + ' · ' + size);
    if (p.turns) bits.push('turned ' + p.turns * 90 + '°');
    if (p.angle) bits.push('straightened ' + p.angle + '°');
    if (p.flip_h) bits.push('flipped');
    if (p.flip_v) bits.push('flipped vertically');
    return bits.join(' · ') || size;
  }
  if (kind === 'resize') {
    const m = p.mode;
    const head = m === 'pixels' ? 'To ' + size : m === 'percent' ? p.percent + '%' : m === 'fit' ? 'Fit ' + p.width + ' x ' + p.height : m === 'cover' ? 'Exactly ' + p.width + ' x ' + p.height : 'Longest edge ' + p.longest + ' px';
    return head + (m !== 'pixels' ? ' → ' + size : '') + (p.enlarge ? ' (enlarged)' : '');
  }
  if (kind === 'canvas') {
    const pad = typeof p.padding === 'number' ? p.padding + ' px' : 'custom padding';
    const fill = typeof p.fill === 'object' ? 'gradient' : p.fill;
    return [pad, p.ratio ? 'to ' + p.ratio : '', fill, p.radius ? 'radius ' + p.radius : '', p.shadow ? 'shadow' : ''].filter(Boolean).join(' · ');
  }
  if (kind === 'adjust') {
    if (p.auto) return 'Auto';
    const bits = [];
    if (p.levels) bits.push('Levels');
    for (const k of ADJUST) if (p[k]) bits.push(ADJUST_LABEL[k] + ' ' + signed(p[k], k === 'exposure' ? 2 : 0));
    return bits.slice(0, 3).join(', ') + (bits.length > 3 ? ' and ' + (bits.length - 3) + ' more' : '');
  }
  if (kind === 'filter') return (FILTER_LABEL[p.name] || p.name) + ' ' + p.strength + '%';
  if (kind === 'layer') return layerTitle(p);
  if (kind === 'remove_bg') return (p.model === 'detailed' ? 'Detailed model' : 'Fast model') + ' · ' + (p.background === 'transparent' ? 'transparent' : p.background);
  return '';
}

/** A layer's name, or what it is ("Text "Look here"", "Redaction (pixelate)", "Step 2"). */
function layerTitle(p) {
  if (p.name) return String(p.name);
  const label = LAYER_LABEL[p.type] || 'Layer';
  if (p.type === 'text') return label + ' "' + String(p.text || '').split('\n')[0].slice(0, 28) + '"' + (p.tile ? ' (tiled)' : '');
  if (p.type === 'redact') return label + ' (' + (p.mode || 'solid') + ')';
  if (p.type === 'step') return label + ' ' + (p.n || 1);
  if (p.type === 'logo' && p.tile) return label + ' (tiled)';
  return label;
}

/** Kinds whose params hold pixel coordinates (scaled when edits are copied to another image). */
function scaleParams(kind, p, kx, ky) {
  const r = JSON.parse(JSON.stringify(p || {}));
  const sx = (v) => Math.round(v * kx);
  const sy = (v) => Math.round(v * ky);
  if (kind === 'crop' && r.rect) {
    r.rect = { x: sx(r.rect.x), y: sy(r.rect.y), w: Math.max(1, sx(r.rect.w)), h: Math.max(1, sy(r.rect.h)) };
  } else if (kind === 'layer' && r.anchor !== 'frame') {
    // Pinned to the photo: kx, ky are the ratio of the two originals' sizes.
    const k = Math.sqrt(kx * ky);
    const fx = (v) => Math.round(v * kx * 100) / 100;
    const fy = (v) => Math.round(v * ky * 100) / 100;
    for (const f of ['cx', 'x1', 'x2']) if (r[f] !== undefined) r[f] = fx(r[f]);
    for (const f of ['cy', 'y1', 'y2']) if (r[f] !== undefined) r[f] = fy(r[f]);
    if (r.w !== undefined) r.w = Math.max(0.5, fx(r.w));
    if (r.h !== undefined) r.h = Math.max(0.5, fy(r.h));
    for (const f of ['size', 'width', 'radius']) if (r[f] !== undefined) r[f] = Math.round(r[f] * k * 100) / 100;
  } else if (kind === 'canvas') {
    const k = Math.sqrt(kx * ky);
    if (typeof r.padding === 'number') r.padding = Math.round(r.padding * k);
    else if (r.padding) for (const f of ['t', 'r', 'b', 'l']) r.padding[f] = Math.round((r.padding[f] || 0) * k);
    if (r.radius) r.radius = Math.round(r.radius * k);
  }
  return r;
}

function schema() {
  return {
    kinds: KINDS,
    filters: FILTERS.map((f) => ({ name: f, label: FILTER_LABEL[f] })),
    adjust: ADJUST.map((k) => ({ key: k, label: ADJUST_LABEL[k], min: k === 'exposure' ? -3 : k === 'sharpen' ? 0 : -100, max: k === 'exposure' ? 3 : 100, step: k === 'exposure' ? 0.05 : 1 })),
    resample: RESAMPLE,
    fonts: FONTS,
    layer_types: LAYER_TYPES.map((t) => ({ type: t, label: LAYER_LABEL[t] })),
  };
}

module.exports = { KINDS: KINDS, FILTERS: FILTERS, ADJUST: ADJUST, FONTS: FONTS, LAYER_TYPES: LAYER_TYPES, LAYER_LABEL: LAYER_LABEL, layerTitle: layerTitle, params: params, summary: summary, scaleParams: scaleParams, schema: schema };
