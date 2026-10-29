"""Rendering an edit stack.

An image's original is never changed: what you see is the original run
through its edits, in order. A preview runs the same edits on a smaller
decode (scale < 1); an export runs them at full resolution (scale 1). The
full-resolution size after each edit comes from geom.chain, so a preview's
geometry lands exactly where the export's will.

Prefixes of a stack are cached in memory: while a tool's sliders move, only
the edit being changed runs again.

Layers (edits of kind "layer") are not pixel steps: the photo's edits run
first, in order, and the layers are drawn over the result last, in their
order (layers.py). Along the way run() keeps F, the affine map from the
original photo's pixels to the result's (full resolution), which places
layers pinned to the photo; renders report it so the workspace can too.
"""

import hashlib
import json
import math
import os
from collections import OrderedDict

import numpy as np
from PIL import Image, ImageFilter

from . import draw, geom, layers, load, tone
from .errors import ImgError, invalid

KINDS = ["crop", "resize", "canvas", "adjust", "filter", "remove_bg", "layer"]

IDENTITY = (1.0, 0.0, 0.0, 0.0, 1.0, 0.0)

RESAMPLE = {
    "lanczos": Image.Resampling.LANCZOS,
    "sharp": Image.Resampling.MKS2021,
    "bicubic": Image.Resampling.BICUBIC,
    "bilinear": Image.Resampling.BILINEAR,
    "nearest": Image.Resampling.NEAREST,
}

_cache = OrderedDict()
CACHE_MAX = 10
CACHE_BIG = 2  # full-resolution entries are big; keep only a couple
_big = OrderedDict()


def _key(*parts):
    return hashlib.sha1(json.dumps(parts, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()


def _get(key):
    for store in (_cache, _big):
        if key in store:
            store.move_to_end(key)
            im, scale, F = store[key]
            return im.copy(), scale, F
    return None


def _put(key, im, scale, F, big):
    store, cap = (_big, CACHE_BIG) if big else (_cache, CACHE_MAX)
    store[key] = (im.copy(), scale, F)
    store.move_to_end(key)
    while len(store) > cap:
        store.popitem(last=False)


def clear_cache():
    _cache.clear()
    _big.clear()


# ------------------------------------------------------------- transforms
#
# Affine maps (a, b, c, d, e, f): x' = a x + b y + c, y' = d x + e y + f, in
# full-resolution pixels. Each geometric edit maps its input to its output;
# the stack's F is their composition.


def mul(A, B):
    """A after B."""
    a, b, c, d, e, f = A
    g, h, i, j, k, l = B
    return (a * g + b * j, a * h + b * k, a * i + b * l + c, d * g + e * j, d * h + e * k, d * i + e * l + f)


def _shift(tx, ty):
    return (1.0, 0.0, float(tx), 0.0, 1.0, float(ty))


def crop_map(p, full_in, offset):
    w, h = full_in
    M = IDENTITY
    if p.get("flip_h"):
        M = mul((-1.0, 0.0, float(w), 0.0, 1.0, 0.0), M)
    if p.get("flip_v"):
        M = mul((1.0, 0.0, 0.0, 0.0, -1.0, float(h)), M)
    turns = int(p.get("turns") or 0) % 4
    if turns == 1:
        M = mul((0.0, -1.0, float(h), 1.0, 0.0, 0.0), M)
        w, h = h, w
    elif turns == 2:
        M = mul((-1.0, 0.0, float(w), 0.0, -1.0, float(h)), M)
    elif turns == 3:
        M = mul((0.0, 1.0, 0.0, -1.0, 0.0, float(w)), M)
        w, h = h, w
    angle = float(p.get("angle") or 0)
    if abs(angle) > 1e-9:
        k = geom.straighten_scale(w, h, angle)
        iw, ih = max(1, int(math.floor(w * k))), max(1, int(math.floor(h * k)))
        t = math.radians(angle)
        c, s = math.cos(t), math.sin(t)
        # Clockwise about the centre (y points down), then the centred crop.
        M = mul(mul(_shift(iw / 2.0, ih / 2.0), (c, -s, 0.0, s, c, 0.0)), mul(_shift(-w / 2.0, -h / 2.0), M))
    if offset is not None:
        M = mul(_shift(-offset[0], -offset[1]), M)
    return M


def edit_map(e, full_in, full_out, offset):
    """The map of one edit (identity for edits that keep geometry)."""
    kind = e.get("kind")
    p = e.get("params") or {}
    if kind == "crop":
        return crop_map(p, full_in, offset)
    if kind == "resize":
        if (p.get("mode") or "longest") == "cover":
            k = max(full_out[0] / full_in[0], full_out[1] / full_in[1])
            ox, oy = offset if offset is not None else (0.0, 0.0)
            return (k, 0.0, -ox, 0.0, k, -oy)
        return (full_out[0] / full_in[0], 0.0, 0.0, 0.0, full_out[1] / full_in[1], 0.0)
    if kind == "canvas":
        w, h = full_in
        r = geom.ratio_of(p.get("ratio"), w, h)
        ew, eh = w, h
        if r:
            if w / h < r:
                ew = max(w, geom.rnd(h * r))
            else:
                eh = max(h, geom.rnd(w / r))
        t, _rr, _b, l = geom.pad_of(p)
        return _shift(l + (ew - w) // 2, t + (eh - h) // 2)
    return IDENTITY


# -------------------------------------------------------------------- edits


def _resize_to(im, size, method):
    if im.size == size:
        return im
    return im.resize(size, RESAMPLE.get(method or "lanczos", Image.Resampling.LANCZOS), reducing_gap=3.0 if size[0] < im.width else None)


def crop(im, p, scale, full_in, full_out, ctx):
    if p.get("flip_h"):
        im = im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    if p.get("flip_v"):
        im = im.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    turns = int(p.get("turns") or 0) % 4
    w, h = full_in
    if turns:
        im = im.transpose({1: Image.Transpose.ROTATE_270, 2: Image.Transpose.ROTATE_180, 3: Image.Transpose.ROTATE_90}[turns])
        if turns % 2:
            w, h = h, w
    angle = float(p.get("angle") or 0)
    if abs(angle) > 1e-9:
        k = geom.straighten_scale(w, h, angle)
        iw, ih = max(1, int(math.floor(w * k))), max(1, int(math.floor(h * k)))
        fill = (0, 0, 0, 0) if im.mode == "RGBA" else (0, 0, 0)
        rot = im.rotate(-angle, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=fill)
        pw, ph = max(1, round(iw * scale)), max(1, round(ih * scale))
        x0 = (rot.width - pw) // 2
        y0 = (rot.height - ph) // 2
        im = rot.crop((x0, y0, x0 + pw, y0 + ph))
        w, h = iw, ih
    rect = p.get("rect")
    if rect:
        x = min(max(0, int(rect.get("x", 0))), w - 1)
        y = min(max(0, int(rect.get("y", 0))), h - 1)
        rw, rh = full_out
    else:
        r = geom.ratio_of(p.get("ratio"), w, h)
        if not r:
            return im
        rw, rh = full_out
        x, y = (w - rw) // 2, (h - rh) // 2
        if p.get("smart"):
            x, y = smart_origin(im, w, h, rw, rh, scale)
    ctx["offset"] = (float(x), float(y))
    box = (round(x * scale), round(y * scale), round(x * scale) + max(1, round(rw * scale)), round(y * scale) + max(1, round(rh * scale)))
    box = (box[0], box[1], min(im.width, box[2]), min(im.height, box[3]))
    return im.crop(box)


def smart_origin(im, w, h, cw, ch, scale):
    """Where a cw x ch window over a w x h image holds the most detail and colour (full-resolution pixels)."""
    small = im.convert("RGB").copy()
    small.thumbnail((256, 256))
    a = np.asarray(small, dtype=np.float32) / 255.0
    g = tone.luma(a)
    gy, gx = np.gradient(g)
    energy = np.hypot(gx, gy) + 0.35 * (a.max(axis=-1) - a.min(axis=-1))
    # Favour the centre a little, as photographers frame.
    hh, ww = energy.shape
    yy, xx = np.mgrid[0:hh, 0:ww]
    energy *= 1.0 - 0.35 * (((xx - ww / 2) / ww) ** 2 + ((yy - hh / 2) / hh) ** 2)
    k = ww / w
    cw_s, ch_s = max(1, int(round(cw * k))), max(1, int(round(ch * k)))
    ii = np.pad(energy.cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    best, bx, by = -1.0, 0, 0
    for y0 in range(0, max(1, hh - ch_s + 1), 2):
        for x0 in range(0, max(1, ww - cw_s + 1), 2):
            s = ii[y0 + ch_s, x0 + cw_s] - ii[y0, x0 + cw_s] - ii[y0 + ch_s, x0] + ii[y0, x0]
            if s > best:
                best, bx, by = s, x0, y0
    return min(max(0, int(round(bx / k))), w - cw), min(max(0, int(round(by / k))), h - ch)


def resize(im, p, scale, full_in, full_out, ctx):
    mode = p.get("mode") or "longest"
    tw, th = max(1, round(full_out[0] * scale)), max(1, round(full_out[1] * scale))
    method = p.get("resample") or "lanczos"
    if mode == "cover":
        W, H = im.size
        k = max(tw / W, th / H)
        mid = _resize_to(im, (max(tw, math.ceil(W * k)), max(th, math.ceil(H * k))), method)
        if p.get("smart"):
            fx, fy = smart_origin(mid, mid.width, mid.height, tw, th, 1.0)
        else:
            fx, fy = (mid.width - tw) // 2, (mid.height - th) // 2
        out = mid.crop((fx, fy, fx + tw, fy + th))
        ctx["offset"] = (fx * full_out[0] / tw, fy * full_out[1] / th)
    else:
        out = _resize_to(im, (tw, th), method)
    # A mild unsharp mask restores the crispness a big reduction or an
    # enlargement takes away (off with sharpen: false).
    shrink = full_in[0] / max(1, full_out[0])
    if p.get("sharpen", True) and method != "nearest":
        if shrink >= 1.8:
            out = _sharpen(out)
        elif shrink < 0.99:
            out = _sharpen(out, 0.8 * scale + 0.3, 70)
    return out


def _sharpen(im, radius=0.6, percent=45):
    alpha = im.getchannel("A") if im.mode == "RGBA" else None
    out = im.convert("RGB").filter(ImageFilter.UnsharpMask(radius=radius, percent=percent, threshold=1))
    if alpha is not None:
        out.putalpha(alpha)
    return out


def canvas(im, p, scale, full_in, full_out, ctx):
    w, h = full_in
    r = geom.ratio_of(p.get("ratio"), w, h)
    ew, eh = w, h
    if r:
        if w / h < r:
            ew = max(w, geom.rnd(h * r))
        else:
            eh = max(h, geom.rnd(w / r))
    t, rr, b, l = geom.pad_of(p)
    x = l + (ew - w) // 2
    y = t + (eh - h) // 2
    size = (max(1, round(full_out[0] * scale)), max(1, round(full_out[1] * scale)))
    return draw.canvas(im, p, scale, size, (round(x * scale), round(y * scale)))


def remove_bg(im, p, scale, full_in, full_out, ctx):
    mask_path = (ctx.get("masks") or {}).get(ctx.get("edit_id") or "")
    if not mask_path or not os.path.exists(mask_path):
        raise ImgError("mask_missing", "The background mask for this edit is not made yet; edit it again to make it.")
    m = Image.open(mask_path).convert("L").resize(im.size, Image.Resampling.BILINEAR)
    if p.get("edge") == "hard":
        m = m.point(lambda v: 255 if v >= 128 else 0).filter(ImageFilter.GaussianBlur(0.7))
    grow = int(round(float(p.get("refine") or 0) * scale))
    if grow:
        size = min(31, abs(grow) * 2 + 1)
        m = m.filter(ImageFilter.MaxFilter(size) if grow > 0 else ImageFilter.MinFilter(size))
    rgba = im.convert("RGBA")
    if im.mode == "RGBA":
        from PIL import ImageChops

        m = ImageChops.multiply(m, im.getchannel("A"))
    rgba.putalpha(m)
    bg = p.get("background") or "transparent"
    if bg == "transparent":
        return rgba
    base = Image.new("RGBA", rgba.size, draw.rgba(bg, "#ffffff"))
    base.alpha_composite(rgba)
    return base.convert("RGB")


def apply(im, e, scale, full_in, full_out, ctx):
    kind = e.get("kind")
    p = e.get("params") or {}
    if kind == "crop":
        return crop(im, p, scale, full_in, full_out, ctx)
    if kind == "resize":
        return resize(im, p, scale, full_in, full_out, ctx)
    if kind == "canvas":
        return canvas(im, p, scale, full_in, full_out, ctx)
    if kind == "adjust":
        if p.get("auto"):
            p = dict(tone.auto_params(im), **{k: v for k, v in p.items() if k not in ("auto", "levels")})
        return tone.adjust(im, p, scale)
    if kind == "filter":
        return tone.filter_image(im, p.get("name") or "vivid", float(p.get("strength", 100)) / 100.0)
    if kind == "remove_bg":
        return remove_bg(im, p, scale, full_in, full_out, ctx)
    raise invalid("unknown edit kind " + repr(kind) + ". Kinds: " + ", ".join(KINDS))


def run(path, stack, max_side=0, frame=0, ctx=None, base=None, out=None):
    """Render a stack. Returns (image, scale, chain). max_side 0 = full resolution.

    base: an already loaded frame (animations) instead of reading the file.
    ctx["layers"] = False leaves the layers out (the workspace draws them).
    out: a dict that receives "transform" (F) and "frame" (the result's full size)."""
    ctx = dict(ctx or {})
    stack = [e for e in (stack or [])]
    pixel = [e for e in stack if e.get("kind") != "layer"]
    marks = [e for e in stack if e.get("kind") == "layer" and e.get("enabled", True)]
    full0 = (base.width, base.height) if base is not None else load.full_size(path)
    chain = geom.chain(pixel, *full0)
    mtime = os.path.getmtime(path) if base is None and os.path.exists(path) else 0
    root = [path, mtime, max_side, frame, ctx.get("masks")]
    keys = []
    acc = []
    for e in pixel:
        acc.append([e.get("id"), e.get("kind"), e.get("params"), e.get("enabled", True)])
        keys.append(_key(root, acc))
    im, scale, start, F = None, 1.0, 0, IDENTITY
    if base is None:
        for i in range(len(pixel) - 1, -1, -1):
            hit = _get(keys[i])
            if hit is not None:
                im, scale, F = hit
                start = i + 1
                break
    if im is None:
        im = base.copy() if base is not None else load.load(path, max_side, frame)
        if base is not None and max_side and max(im.size) > max_side:
            im.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
        scale = im.width / full0[0]
    for i in range(start, len(pixel)):
        e = pixel[i]
        if e.get("enabled", True):
            ctx["edit_id"] = e.get("id")
            ctx["offset"] = None
            im = apply(im, e, scale, chain[i], chain[i + 1], ctx)
            F = mul(edit_map(e, chain[i], chain[i + 1], ctx.get("offset")), F)
            fw = chain[i + 1][0]
            if max_side and max(im.size) > max_side * 1.15:
                im.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
            scale = im.width / fw
        if base is None:
            _put(keys[i], im, scale, F, big=max_side == 0)
    if marks and ctx.get("layers", True) is not False:
        im = layers.composite(im, marks, F, scale, chain[-1], ctx.get("logos"))
    if out is not None:
        out["transform"] = [round(v, 6) for v in F]
        out["frame"] = list(chain[-1])
    return im, scale, chain
