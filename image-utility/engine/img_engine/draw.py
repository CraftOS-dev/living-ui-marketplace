"""Drawing on the image: annotations, redaction, watermarks and the canvas.

Coordinates and sizes come in full-resolution pixels of the image entering
the edit; `scale` maps them onto the pixels at hand (a preview is smaller).
Shapes are drawn 4x larger on a small layer around each item and reduced,
so edges are smooth; redaction always replaces the pixels underneath.
"""

import math
import os
import random

from PIL import Image, ImageChops, ImageColor, ImageDraw, ImageFilter, ImageFont

SS = 4  # supersampling for shapes

FONT_FILES = {
    "sans": ["segoeui.ttf", "arial.ttf"],
    "sans-bold": ["seguisb.ttf", "segoeuib.ttf", "arialbd.ttf"],
    "serif": ["georgia.ttf", "times.ttf"],
    "serif-bold": ["georgiab.ttf", "timesbd.ttf"],
    "mono": ["consola.ttf", "cour.ttf"],
    "hand": ["segoepr.ttf", "comic.ttf"],
    "impact": ["impact.ttf", "arialbd.ttf"],
}

_fonts = {}


def font(name, size):
    size = max(4, int(round(size)))
    key = (name, size)
    if key in _fonts:
        return _fonts[key]
    root = os.path.join(os.environ.get("WINDIR", "C:\\Windows"), "Fonts")
    f = None
    for fn in FONT_FILES.get(name, FONT_FILES["sans"]):
        p = os.path.join(root, fn)
        if os.path.exists(p):
            try:
                f = ImageFont.truetype(p, size)
                break
            except OSError:
                continue
    if f is None:
        f = ImageFont.load_default(size)
    _fonts[key] = f
    return f


def rgba(c, default="#ff4f18", opacity=1.0):
    try:
        v = ImageColor.getcolor(str(c or default), "RGBA")
    except ValueError:
        v = ImageColor.getcolor(default, "RGBA")
    return (v[0], v[1], v[2], int(round(v[3] * max(0.0, min(1.0, opacity)))))


def _paste(base, layer, x0, y0):
    """Composite an RGBA layer at (x0, y0), keeping base's mode."""
    out = base if base.mode == "RGBA" else base.convert("RGBA")
    if x0 >= 0 and y0 >= 0:
        out.alpha_composite(layer, (x0, y0))
    else:
        # alpha_composite refuses negative offsets; paste clips them.
        out.paste(layer, (x0, y0), layer)
    return out if base.mode == "RGBA" else out.convert(base.mode)


class Layer:
    """A supersampled transparent layer covering one item's bounding box."""

    def __init__(self, x0, y0, x1, y1, pad):
        self.x0 = int(math.floor(x0 - pad))
        self.y0 = int(math.floor(y0 - pad))
        self.w = max(1, int(math.ceil(x1 + pad)) - self.x0)
        self.h = max(1, int(math.ceil(y1 + pad)) - self.y0)
        self.k = SS if self.w * self.h * SS * SS < 40_000_000 else 1
        self.im = Image.new("RGBA", (self.w * self.k, self.h * self.k), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.im)

    def p(self, x, y):
        return ((x - self.x0) * self.k, (y - self.y0) * self.k)

    def done(self, base):
        im = self.im.resize((self.w, self.h), Image.Resampling.LANCZOS) if self.k > 1 else self.im
        return _paste(base, im, self.x0, self.y0)


def _arrow_head(L, x1, y1, x2, y2, width, color):
    ang = math.atan2(y2 - y1, x2 - x1)
    size = max(10.0, width * 3.6)
    spread = math.radians(26)
    pts = [L.p(x2, y2)]
    for s in (-spread, spread):
        pts.append(L.p(x2 - size * math.cos(ang + s), y2 - size * math.sin(ang + s)))
    L.d.polygon(pts, fill=color)
    return size


def annotate(base, items, scale):
    for it in items or []:
        t = it.get("type")
        color = rgba(it.get("color"), "#ff4f18", float(it.get("opacity", 1.0)))
        width = max(1.0, float(it.get("width", 6)) * scale)
        if t in ("arrow", "line"):
            x1, y1, x2, y2 = (float(it.get(k, 0)) * scale for k in ("x1", "y1", "x2", "y2"))
            L = Layer(min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2), width * 4 + 4)
            if t == "arrow":
                length = math.hypot(x2 - x1, y2 - y1) or 1.0
                head = max(10.0, width * 3.6)
                # Stop the shaft inside the head so the tip stays sharp.
                k = max(0.0, (length - head * 0.6) / length)
                L.d.line([L.p(x1, y1), L.p(x1 + (x2 - x1) * k, y1 + (y2 - y1) * k)], fill=color, width=max(1, int(round(width * L.k))))
                _arrow_head(L, x1, y1, x2, y2, width, color)
                if it.get("both"):
                    _arrow_head(L, x2, y2, x1, y1, width, color)
            else:
                L.d.line([L.p(x1, y1), L.p(x2, y2)], fill=color, width=max(1, int(round(width * L.k))))
            r = width * L.k / 2
            for (px, py) in ((x1, y1),) if t == "arrow" else ((x1, y1), (x2, y2)):
                cx, cy = L.p(px, py)
                L.d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)
            base = L.done(base)
        elif t in ("rect", "ellipse", "highlight"):
            x, y, w, h = (float(it.get(k, 0)) * scale for k in ("x", "y", "w", "h"))
            if w < 0:
                x, w = x + w, -w
            if h < 0:
                y, h = y + h, -h
            L = Layer(x, y, x + w, y + h, width + 2)
            box = [L.p(x, y), L.p(x + w, y + h)]
            if t == "highlight":
                hl = rgba(it.get("color"), "#ffd60a", float(it.get("opacity", 0.4)))
                L.d.rectangle(box, fill=hl)
            else:
                fill = rgba(it.get("fill"), "#000000", float(it.get("fill_opacity", 1.0))) if it.get("fill") else None
                draw = L.d.rectangle if t == "rect" else L.d.ellipse
                radius = float(it.get("radius", 0)) * scale * L.k
                if t == "rect" and radius > 0:
                    L.d.rounded_rectangle(box, radius=radius, fill=fill, outline=color if width > 0 else None, width=max(1, int(round(width * L.k))))
                else:
                    draw(box, fill=fill, outline=color, width=max(1, int(round(width * L.k))))
            base = L.done(base)
        elif t == "pen":
            pts = [(float(a) * scale, float(b) * scale) for a, b in (it.get("points") or [])]
            if len(pts) < 2:
                continue
            xs, ys = [p[0] for p in pts], [p[1] for p in pts]
            L = Layer(min(xs), min(ys), max(xs), max(ys), width + 2)
            lw = max(1, int(round(width * L.k)))
            L.d.line([L.p(*p) for p in pts], fill=color, width=lw, joint="curve")
            r = lw / 2
            for p in (pts[0], pts[-1]):
                cx, cy = L.p(*p)
                L.d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)
            base = L.done(base)
        elif t == "step":
            cx, cy = float(it.get("x", 0)) * scale, float(it.get("y", 0)) * scale
            r = max(6.0, float(it.get("size", 36)) * scale / 2)
            L = Layer(cx - r, cy - r, cx + r, cy + r, 2)
            a, b = L.p(cx - r, cy - r), L.p(cx + r, cy + r)
            L.d.ellipse([a, b], fill=color)
            label = str(it.get("n", 1))
            f = font("sans-bold", r * 1.15 * L.k)
            tc = rgba(it.get("text_color"), "#ffffff")
            L.d.text(L.p(cx, cy), label, fill=tc, font=f, anchor="mm")
            base = L.done(base)
        elif t == "text":
            base = text(base, it, scale)
    return base


def text(base, it, scale):
    s = str(it.get("text", "")).strip("\n")
    if not s:
        return base
    size = max(4.0, float(it.get("size", 48)) * scale)
    f = font(it.get("font") or "sans-bold", size)
    color = rgba(it.get("color"), "#ff4f18", float(it.get("opacity", 1.0)))
    x, y = float(it.get("x", 0)) * scale, float(it.get("y", 0)) * scale
    probe = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    spacing = size * 0.18
    bb = probe.multiline_textbbox((0, 0), s, font=f, spacing=spacing)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    pad = size * 0.28 if it.get("bg") else 0
    layer = Image.new("RGBA", (int(math.ceil(tw + pad * 2)) + 4, int(math.ceil(th + pad * 2)) + 4), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    if it.get("bg"):
        d.rounded_rectangle([0, 0, layer.width - 1, layer.height - 1], radius=size * 0.2, fill=rgba(it.get("bg"), "#000000", float(it.get("bg_opacity", 0.75))))
    stroke = it.get("outline")
    d.multiline_text((pad - bb[0] + 2, pad - bb[1] + 2), s, font=f, fill=color, spacing=spacing, align=it.get("align") or "left", stroke_width=int(round(size * 0.06)) if stroke else 0, stroke_fill=rgba(stroke, "#000000") if stroke else None)
    return _paste(base, layer, int(round(x)), int(round(y)))


def redact(base, items, scale):
    """Replace the pixels under each box: solid colour, randomized pixels or a heavy blur."""
    out = base
    for it in items or []:
        x, y, w, h = (float(it.get(k, 0)) * scale for k in ("x", "y", "w", "h"))
        if w < 0:
            x, w = x + w, -w
        if h < 0:
            y, h = y + h, -h
        x0, y0 = max(0, int(math.floor(x))), max(0, int(math.floor(y)))
        x1, y1 = min(out.width, int(math.ceil(x + w))), min(out.height, int(math.ceil(y + h)))
        if x1 <= x0 or y1 <= y0:
            continue
        mode = it.get("mode") or "solid"
        region = out.crop((x0, y0, x1, y1))
        if mode == "pixelate":
            block = max(4, int(round(max(x1 - x0, y1 - y0) / max(4.0, float(it.get("blocks", 10))))))
            small = region.resize((max(1, (x1 - x0) // block), max(1, (y1 - y0) // block)), Image.Resampling.BOX)
            # Randomize the blocks so the text cannot be recovered by un-pixelating.
            rnd = random.Random(int(x0 * 7919 + y0 * 104729 + w + h))
            px = small.load()
            for yy in range(small.height):
                for xx in range(small.width):
                    v = px[xx, yy]
                    j = rnd.randint(-28, 28)
                    px[xx, yy] = tuple(max(0, min(255, c + j)) for c in v[:3]) + tuple(v[3:])
            region = small.resize(region.size, Image.Resampling.NEAREST)
        elif mode == "blur":
            r = max(8.0, min(x1 - x0, y1 - y0) / 3.0)
            region = region.filter(ImageFilter.GaussianBlur(r)).filter(ImageFilter.GaussianBlur(r))
        else:
            c = rgba(it.get("color"), "#000000")
            region = Image.new(out.mode, region.size, c if out.mode == "RGBA" else c[:3])
        out.paste(region, (x0, y0))
    return out


POS = {
    "tl": (0, 0), "tc": (0.5, 0), "tr": (1, 0),
    "ml": (0, 0.5), "mc": (0.5, 0.5), "mr": (1, 0.5),
    "bl": (0, 1), "bc": (0.5, 1), "br": (1, 1),
}


def _mark_layer(p, base_short, logo):
    """The watermark itself (text or logo) as an RGBA image, unrotated."""
    opacity = max(0.0, min(1.0, float(p.get("opacity", 0.6))))
    if logo is not None:
        target = max(8, int(round(base_short * float(p.get("size", 18)) / 100.0)))
        lg = logo.convert("RGBA")
        k = target / max(lg.size)
        lg = lg.resize((max(1, round(lg.width * k)), max(1, round(lg.height * k))), Image.Resampling.LANCZOS)
        if opacity < 1:
            a = lg.getchannel("A").point(lambda v: int(v * opacity))
            lg.putalpha(a)
        return lg
    s = str(p.get("text") or "")
    size = max(6.0, base_short * float(p.get("size", 5)) / 100.0)
    f = font(p.get("font") or "sans-bold", size)
    probe = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    bb = probe.multiline_textbbox((0, 0), s, font=f, spacing=size * 0.15)
    pad = int(size * 0.3)
    layer = Image.new("RGBA", (bb[2] - bb[0] + pad * 2, bb[3] - bb[1] + pad * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    color = rgba(p.get("color"), "#ffffff", opacity)
    if p.get("shadow", True):
        sh = Image.new("RGBA", layer.size, (0, 0, 0, 0))
        ImageDraw.Draw(sh).multiline_text((pad - bb[0] + 1, pad - bb[1] + max(1, size * 0.04)), s, font=f, fill=(0, 0, 0, int(110 * opacity)), spacing=size * 0.15)
        sh = sh.filter(ImageFilter.GaussianBlur(max(1.0, size * 0.06)))
        layer.alpha_composite(sh)
    d.multiline_text((pad - bb[0], pad - bb[1]), s, font=f, fill=color, spacing=size * 0.15, align="center")
    return layer


def watermark(base, p, scale, logo=None):
    if not p.get("text") and logo is None:
        return base
    short = min(base.size)
    mark = _mark_layer(p, short, logo)
    angle = float(p.get("angle", 0))
    if angle:
        mark = mark.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)
    out = base.convert("RGBA")
    if p.get("tile"):
        gap = max(mark.width, mark.height) * (1.0 + float(p.get("gap", 60)) / 100.0)
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
        out.alpha_composite(layer)
    else:
        fx, fy = POS.get(p.get("position") or "br", (1, 1))
        margin = short * float(p.get("margin", 3)) / 100.0
        x = margin + (out.width - mark.width - 2 * margin) * fx
        y = margin + (out.height - mark.height - 2 * margin) * fy
        out = _paste(out, mark, int(round(x)), int(round(y)))
    return out if base.mode == "RGBA" else out.convert(base.mode)


def _rounded_mask(size, radius):
    w, h = size
    m = Image.new("L", (w * 2, h * 2), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, w * 2 - 1, h * 2 - 1], radius=radius * 2, fill=255)
    return m.resize((w, h), Image.Resampling.LANCZOS)


def canvas(base, p, scale, out_size, inner_xy):
    """Place the image on a larger canvas: padding, a target ratio, a fill,
    rounded corners and a soft shadow (the screenshot 'beautify' look)."""
    W, H = out_size
    fill = p.get("fill") or "#ffffff"
    img = base.convert("RGBA")
    radius = float(p.get("radius", 0)) * scale
    if radius > 0:
        m = _rounded_mask(img.size, min(radius, min(img.size) / 2))
        img.putalpha(ImageChops.multiply(img.getchannel("A"), m))
    if fill == "transparent":
        bg = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    elif fill == "blur":
        k = max(W / img.width, H / img.height)
        bg = base.convert("RGBA").resize((max(1, math.ceil(img.width * k)), max(1, math.ceil(img.height * k))), Image.Resampling.BILINEAR)
        bg = bg.crop(((bg.width - W) // 2, (bg.height - H) // 2, (bg.width - W) // 2 + W, (bg.height - H) // 2 + H))
        bg = bg.filter(ImageFilter.GaussianBlur(max(6.0, min(W, H) / 22.0)))
        dark = Image.new("RGBA", bg.size, (0, 0, 0, 40))
        bg.alpha_composite(dark)
        bg.putalpha(255)
    elif isinstance(fill, dict) and fill.get("from"):
        bg = _gradient((W, H), rgba(fill.get("from"), "#ff4f18"), rgba(fill.get("to"), "#7b2ff7"), float(fill.get("angle", 135)))
    else:
        bg = Image.new("RGBA", (W, H), rgba(fill, "#ffffff"))
    x, y = inner_xy
    if p.get("shadow"):
        blur = max(4.0, min(img.size) * 0.035)
        sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        silhouette = Image.new("RGBA", img.size, (0, 0, 0, int(255 * float(p.get("shadow_opacity", 0.35)))))
        silhouette.putalpha(ImageChops.multiply(img.getchannel("A"), silhouette.getchannel("A")))
        sh.paste(silhouette, (x, y + int(round(blur * 0.5))), silhouette)
        sh = sh.filter(ImageFilter.GaussianBlur(blur))
        bg.alpha_composite(sh)
    bg.alpha_composite(img, (x, y))
    return bg if base.mode == "RGBA" or fill == "transparent" else bg.convert("RGB")


def _gradient(size, c1, c2, angle):
    import numpy as np

    W, H = size
    t = math.radians(angle)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    d = (xx / max(1, W - 1) - 0.5) * math.cos(t) + (yy / max(1, H - 1) - 0.5) * math.sin(t)
    d = (d - d.min()) / max(1e-6, float(d.max() - d.min()))
    c1a, c2a = np.array(c1, dtype=np.float32), np.array(c2, dtype=np.float32)
    arr = c1a + (c2a - c1a) * d[..., None]
    return Image.fromarray(arr.astype(np.uint8), "RGBA")
