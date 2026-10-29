"""Layers: objects over the photo, composited after the photo's own edits.

A layer is an edit of kind "layer" whose params say what it is (type) and
where. Each layer is pinned to one of two spaces:

  photo  coordinates are pixels of the original photo (as loaded, upright);
         the layer follows the photo through crops, turns, straightening,
         resizing and padding (an arrow keeps pointing at its subject, a
         redaction keeps covering its secret)
  frame  positions are fractions of the result's width and height, sizes
         fractions of its shorter side; the layer stays put in the frame
         whatever the photo edits do (a watermark in a corner, a recipe)

Geometry by type (all numbers in the layer's space):

  rect, ellipse, highlight, redact, logo, pen   cx, cy, w, h, rotation
  text                                          cx, cy, size, rotation (box from the text)
  step                                          cx, cy, size
  arrow, line                                   x1, y1, x2, y2

Rotation is in degrees, clockwise, about the layer's centre. Pen points are
[u, v] in -0.5..0.5 of the layer's box. F, the photo-to-result transform,
comes from render.run (an affine map in full-resolution pixels).
"""

import math

from PIL import Image, ImageDraw

from . import draw

TYPES = ("text", "rect", "ellipse", "arrow", "line", "highlight", "step", "pen", "redact", "logo")
SS = 3


def _num(p, k, d=0.0):
    try:
        return float(p.get(k, d))
    except (TypeError, ValueError):
        return d


class Space:
    """Maps a layer's own coordinates to full-resolution result pixels."""

    def __init__(self, p, F, frame):
        self.frame = p.get("anchor") == "frame"
        W, H = frame
        self.F = F
        self.W, self.H = W, H
        self.S = float(min(W, H))
        if self.frame:
            self.unit = self.S
        else:
            a, b, _, d, e, _ = F
            self.unit = math.sqrt(abs(a * e - b * d)) or 1.0

    def pos(self, x, y):
        if self.frame:
            return x * self.W, y * self.H
        a, b, c, d, e, f = self.F
        return a * x + b * y + c, d * x + e * y + f

    def vec(self, vx, vy):
        if self.frame:
            return vx * self.S, vy * self.S
        a, b, _, d, e, _ = self.F
        return a * vx + b * vy, d * vx + e * vy


def box_of(p, sp):
    """Centre, width, height and angle (degrees) of a box layer in result pixels."""
    r = math.radians(_num(p, "rotation"))
    cx, cy = sp.pos(_num(p, "cx"), _num(p, "cy"))
    ax = sp.vec(math.cos(r) * _num(p, "w", 1), math.sin(r) * _num(p, "w", 1))
    ay = sp.vec(-math.sin(r) * _num(p, "h", 1), math.cos(r) * _num(p, "h", 1))
    return cx, cy, math.hypot(*ax), math.hypot(*ay), math.degrees(math.atan2(ax[1], ax[0]))


def angle_of(p, sp):
    r = math.radians(_num(p, "rotation"))
    v = sp.vec(math.cos(r), math.sin(r))
    return math.degrees(math.atan2(v[1], v[0]))


def corners(p, sp):
    """The four corners of a box layer in result pixels (exact, also under uneven scaling)."""
    r = math.radians(_num(p, "rotation"))
    cx, cy, w, h = _num(p, "cx"), _num(p, "cy"), _num(p, "w", 1), _num(p, "h", 1)
    c, s = math.cos(r), math.sin(r)
    out = []
    for u, v in ((-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)):
        lx, ly = u * w, v * h
        out.append(sp.pos(cx + lx * c - ly * s, cy + lx * s + ly * c))
    return out


def _opacity(im, op):
    if op >= 0.999:
        return im
    a = im.getchannel("A").point(lambda v: int(v * op))
    im.putalpha(a)
    return im


def _paste_centred(out, tile, cx, cy):
    return draw._paste(out, tile, int(round(cx - tile.width / 2)), int(round(cy - tile.height / 2)))


def _rotated(tile, angle):
    if abs(angle) < 0.01:
        return tile
    # PIL turns counter-clockwise; layer angles are clockwise (y points down).
    return tile.rotate(-angle, resample=Image.Resampling.BICUBIC, expand=True)


def _supersampled(w, h, pad, paint):
    """paint(d, k, w, h, pad) on a k-times canvas of (w + 2 pad) x (h + 2 pad), returned at 1x."""
    k = SS if (w + 2 * pad) * (h + 2 * pad) * SS * SS < 40_000_000 else 1
    W, H = max(1, int(math.ceil((w + 2 * pad) * k))), max(1, int(math.ceil((h + 2 * pad) * k)))
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    paint(ImageDraw.Draw(im), k, w, h, pad)
    if k > 1:
        im = im.resize((max(1, int(math.ceil(w + 2 * pad))), max(1, int(math.ceil(h + 2 * pad)))), Image.Resampling.LANCZOS)
    return im


# --------------------------------------------------------------- the pieces


def _shape_tile(p, kind, w, h, unit):
    sw = max(0.0, _num(p, "width", 6) * unit)
    color = draw.rgba(p.get("color"), "#ffd60a" if kind == "highlight" else "#ff4f18")
    pad = sw / 2 + 2

    def paint(d, k, ww, hh, pd):
        box = [pd * k, pd * k, (pd + ww) * k, (pd + hh) * k]
        if kind == "highlight":
            d.rectangle(box, fill=draw.rgba(p.get("color"), "#ffd60a", 0.4))
            return
        fill = draw.rgba(p.get("fill"), "#000000", _num(p, "fill_opacity", 0.25)) if p.get("fill") else None
        lw = max(1, int(round(sw * k))) if sw > 0 else 0
        outline = color if sw > 0 else None
        if kind == "rect":
            rad = _num(p, "radius") * unit * k
            if rad > 0:
                d.rounded_rectangle(box, radius=rad, fill=fill, outline=outline, width=lw)
            else:
                d.rectangle(box, fill=fill, outline=outline, width=lw)
        else:
            d.ellipse(box, fill=fill, outline=outline, width=lw)

    return _supersampled(w, h, pad, paint)


def _text_tile(p, size):
    s = str(p.get("text") or "").strip("\n")
    if not s:
        return None
    f = draw.font(p.get("font") or "sans-bold", size)
    spacing = size * 0.18
    probe = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    bb = probe.multiline_textbbox((0, 0), s, font=f, spacing=spacing, align=p.get("align") or "left")
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    pad = size * 0.28 if p.get("bg") else size * 0.06
    tile = Image.new("RGBA", (int(math.ceil(tw + pad * 2)) + 2, int(math.ceil(th + pad * 2)) + 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(tile)
    if p.get("bg"):
        d.rounded_rectangle([0, 0, tile.width - 1, tile.height - 1], radius=size * 0.2, fill=draw.rgba(p.get("bg"), "#000000", _num(p, "bg_opacity", 0.75)))
    stroke = p.get("outline")
    d.multiline_text(
        (pad - bb[0] + 1, pad - bb[1] + 1),
        s,
        font=f,
        fill=draw.rgba(p.get("color"), "#ff4f18"),
        spacing=spacing,
        align=p.get("align") or "left",
        stroke_width=int(round(size * 0.06)) if stroke else 0,
        stroke_fill=draw.rgba(stroke, "#000000") if stroke else None,
    )
    return tile


def _step_tile(p, size):
    r = max(6.0, size / 2)
    color = draw.rgba(p.get("color"), "#ff4f18")

    def paint(d, k, ww, hh, pd):
        d.ellipse([pd * k, pd * k, (pd + ww) * k, (pd + hh) * k], fill=color)
        f = draw.font("sans-bold", r * 1.15 * k)
        d.text(((pd + ww / 2) * k, (pd + hh / 2) * k), str(p.get("n", 1)), fill=draw.rgba(p.get("text_color"), "#ffffff"), font=f, anchor="mm")

    return _supersampled(2 * r, 2 * r, 1, paint)


def _logo_tile(logo, w, h):
    lg = logo.convert("RGBA")
    k = min(w / max(1, lg.width), h / max(1, lg.height))
    return lg.resize((max(1, round(lg.width * k)), max(1, round(lg.height * k))), Image.Resampling.LANCZOS)


def _tiled(out, mark, angle, gap_pct):
    """A mark repeated across the whole frame, rows offset (a tiled watermark)."""
    mark = _rotated(mark, angle)
    gap = max(mark.width, mark.height) * (1.0 + gap_pct / 100.0)
    layer = Image.new("RGBA", out.size, (0, 0, 0, 0))
    row = 0
    y = -mark.height
    while y < out.height + mark.height:
        x = -mark.width + (gap / 2 if row % 2 else 0)
        while x < out.width + mark.width:
            layer.paste(mark, (int(x), int(y)), mark)
            x += gap
        y += gap * 0.6
        row += 1
    return layer


def _strokes(out, p, kind, pts, width, opacity):
    """Arrows, lines and pen strokes drawn with draw.annotate on a patch around them."""
    xs, ys = [q[0] for q in pts], [q[1] for q in pts]
    pad = width * 4 + 6
    x0, y0 = int(math.floor(min(xs) - pad)), int(math.floor(min(ys) - pad))
    x1, y1 = int(math.ceil(max(xs) + pad)), int(math.ceil(max(ys) + pad))
    if x1 - x0 < 1 or y1 - y0 < 1:
        return out
    patch = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
    item = {"type": kind, "color": p.get("color") or "#ff4f18", "width": width}
    if kind == "pen":
        item["points"] = [[q[0] - x0, q[1] - y0] for q in pts]
    else:
        item.update({"x1": pts[0][0] - x0, "y1": pts[0][1] - y0, "x2": pts[1][0] - x0, "y2": pts[1][1] - y0})
        if p.get("both"):
            item["both"] = True
    patch = draw.annotate(patch, [item], 1.0)
    return draw._paste(out, _opacity(patch, opacity), x0, y0)


def _redaction(out, p, poly):
    xs, ys = [q[0] for q in poly], [q[1] for q in poly]
    x0, y0 = max(0, int(math.floor(min(xs)))), max(0, int(math.floor(min(ys))))
    x1, y1 = min(out.width, int(math.ceil(max(xs)))), min(out.height, int(math.ceil(max(ys))))
    if x1 - x0 < 1 or y1 - y0 < 1:
        return out
    region = out.crop((x0, y0, x1, y1))
    item = {"x": 0, "y": 0, "w": x1 - x0, "h": y1 - y0, "mode": p.get("mode") or "solid", "color": p.get("color") or "#000000"}
    done = draw.redact(region.copy(), [item], 1.0)
    mask = Image.new("L", region.size, 0)
    ImageDraw.Draw(mask).polygon([(q[0] - x0, q[1] - y0) for q in poly], fill=255)
    out.paste(done, (x0, y0), mask)
    return out


# ---------------------------------------------------------------- composite


def composite(im, layers, F, scale, frame, logos):
    """Draw the layers (bottom first) over im, a render at `scale` of a frame of full size `frame`."""
    if not layers:
        return im
    mode = im.mode
    out = im.convert("RGBA")
    for e in layers:
        p = e.get("params") or {}
        kind = p.get("type")
        if kind not in TYPES:
            continue
        sp = Space(p, F, frame)
        u = sp.unit * scale
        op = max(0.0, min(1.0, _num(p, "opacity", 1.0)))
        if kind in ("arrow", "line"):
            a = sp.pos(_num(p, "x1"), _num(p, "y1"))
            b = sp.pos(_num(p, "x2"), _num(p, "y2"))
            out = _strokes(out, p, kind, [(a[0] * scale, a[1] * scale), (b[0] * scale, b[1] * scale)], max(1.0, _num(p, "width", 6) * u), op)
            continue
        if kind == "pen":
            r = math.radians(_num(p, "rotation"))
            c, s = math.cos(r), math.sin(r)
            cx, cy, w, h = _num(p, "cx"), _num(p, "cy"), _num(p, "w", 1), _num(p, "h", 1)
            pts = []
            for q in p.get("points") or []:
                lx, ly = float(q[0]) * w, float(q[1]) * h
                x, y = sp.pos(cx + lx * c - ly * s, cy + lx * s + ly * c)
                pts.append((x * scale, y * scale))
            if len(pts) >= 2:
                out = _strokes(out, p, "pen", pts, max(1.0, _num(p, "width", 6) * u), op)
            continue
        if kind == "redact":
            out = _redaction(out, p, [(x * scale, y * scale) for x, y in corners(p, sp)])
            continue
        if kind in ("text", "step"):
            cx, cy = sp.pos(_num(p, "cx"), _num(p, "cy"))
            size = max(4.0, _num(p, "size", 48) * u)
            tile = _text_tile(p, size) if kind == "text" else _step_tile(p, size)
            if tile is None:
                continue
            tile = _opacity(tile, op)
            if kind == "text" and p.get("tile"):
                out.alpha_composite(_tiled(out, tile, angle_of(p, sp), _num(p, "gap", 60)))
                continue
            out = _paste_centred(out, _rotated(tile, angle_of(p, sp) if kind == "text" else 0), cx * scale, cy * scale)
            continue
        cx, cy, w, h, ang = box_of(p, sp)
        w, h = max(1.0, w * scale), max(1.0, h * scale)
        if kind == "logo":
            path = (logos or {}).get(e.get("id") or "")
            if not path:
                continue
            with Image.open(path) as src:
                tile = _opacity(_logo_tile(src, w, h), op)
            if p.get("tile"):
                out.alpha_composite(_tiled(out, tile, ang, _num(p, "gap", 60)))
                continue
            out = _paste_centred(out, _rotated(tile, ang), cx * scale, cy * scale)
            continue
        tile = _opacity(_shape_tile(p, kind, w, h, u), op)
        out = _paste_centred(out, _rotated(tile, ang), cx * scale, cy * scale)
    if mode == "RGBA":
        return out
    return out.convert(mode) if mode in ("RGB", "L") else out
