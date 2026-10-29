"""Sizes through the edit stack. The app's hooks (lib_geom.js) and the
workspace (geom.ts) compute exactly the same numbers, so every edit's
coordinates can be checked and drawn without asking the engine.

Every edit's coordinates are full-resolution pixels of the image as it
enters that edit. Only crop, resize and canvas change the size.
"""

import math


def rnd(x):
    """Round half up (never Python's banker's rounding), like Math.floor(x + 0.5)."""
    return int(math.floor(x + 0.5))


def ratio_of(r, w, h):
    """'4:3' / '1.5' / 'original' / None -> a width/height number or None (free)."""
    if r in (None, "", "free"):
        return None
    if r == "original":
        return w / h if h else None
    if isinstance(r, (int, float)):
        return float(r) if r > 0 else None
    s = str(r)
    if ":" in s:
        a, b = s.split(":", 1)
        a, b = float(a), float(b)
        return a / b if a > 0 and b > 0 else None
    v = float(s)
    return v if v > 0 else None


def straighten_scale(w, h, angle):
    """The largest same-aspect rectangle inside a w x h image turned by angle degrees."""
    t = math.radians(abs(angle))
    c, s = math.cos(t), math.sin(t)
    return min(w / (w * c + h * s), h / (w * s + h * c))


def largest_of_ratio(w, h, r):
    if w / h > r:
        return max(1, rnd(h * r)), h
    return w, max(1, rnd(w / r))


def crop_dims(p, w, h):
    turns = int(p.get("turns") or 0) % 4
    if turns % 2:
        w, h = h, w
    angle = float(p.get("angle") or 0)
    if abs(angle) > 1e-9:
        k = straighten_scale(w, h, angle)
        w, h = max(1, int(math.floor(w * k))), max(1, int(math.floor(h * k)))
    rect = p.get("rect")
    if rect:
        x, y = int(rect.get("x", 0)), int(rect.get("y", 0))
        rw, rh = int(rect.get("w", w)), int(rect.get("h", h))
        x = min(max(0, x), w - 1)
        y = min(max(0, y), h - 1)
        return max(1, min(rw, w - x)), max(1, min(rh, h - y))
    r = ratio_of(p.get("ratio"), w, h)
    if r:
        return largest_of_ratio(w, h, r)
    return w, h


def resize_dims(p, w, h):
    mode = p.get("mode") or "longest"
    enlarge = bool(p.get("enlarge"))
    if mode == "pixels":
        tw, th = int(p.get("width") or 0), int(p.get("height") or 0)
        if tw and th:
            return max(1, tw), max(1, th)
        if tw:
            return max(1, tw), max(1, rnd(h * tw / w))
        if th:
            return max(1, rnd(w * th / h)), max(1, th)
        return w, h
    if mode == "percent":
        pc = float(p.get("percent") or 100)
        return max(1, rnd(w * pc / 100)), max(1, rnd(h * pc / 100))
    if mode == "cover":
        return max(1, int(p.get("width") or w)), max(1, int(p.get("height") or h))
    if mode == "fit":
        bw, bh = int(p.get("width") or w), int(p.get("height") or h)
        k = min(bw / w, bh / h)
    else:  # longest edge
        k = int(p.get("longest") or max(w, h)) / max(w, h)
    if not enlarge:
        k = min(k, 1.0)
    return max(1, rnd(w * k)), max(1, rnd(h * k))


def pad_of(p):
    pad = p.get("padding")
    if isinstance(pad, (int, float)):
        v = max(0, int(pad))
        return v, v, v, v
    pad = pad or {}
    return tuple(max(0, int(pad.get(k) or 0)) for k in ("t", "r", "b", "l"))


def canvas_dims(p, w, h):
    r = ratio_of(p.get("ratio"), w, h)
    if r:
        if w / h < r:
            w = max(w, rnd(h * r))
        else:
            h = max(h, rnd(w / r))
    t, rr, b, l = pad_of(p)
    return w + l + rr, h + t + b


def dims(kind, params, w, h):
    p = params or {}
    if kind == "crop":
        return crop_dims(p, w, h)
    if kind == "resize":
        return resize_dims(p, w, h)
    if kind == "canvas":
        return canvas_dims(p, w, h)
    return w, h


def chain(stack, w, h):
    """[(w, h) entering edit 0, after edit 0, ...] for the enabled edits."""
    out = [(w, h)]
    for e in stack:
        if e.get("enabled", True):
            w, h = dims(e.get("kind"), e.get("params"), w, h)
        out.append((w, h))
    return out
