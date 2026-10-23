"""Orthographic pictures of a model for the agent, and part thumbnails.

A small z-buffered rasterizer over the build's own tessellation: flat-lit
faces, visible edges only (hidden edges are depth-tested away), optional
highlighted faces and edges, a view label and a scale bar that states the
millimetres per pixel. Standard views follow the app's axes: Front looks
from -Y, Top from +Z, Iso from the front-right-top corner.
"""

import math

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from . import geom

VIEWS = {
    "front": ((0.0, 1.0, 0.0), (0.0, 0.0, 1.0)),
    "back": ((0.0, -1.0, 0.0), (0.0, 0.0, 1.0)),
    "left": ((1.0, 0.0, 0.0), (0.0, 0.0, 1.0)),
    "right": ((-1.0, 0.0, 0.0), (0.0, 0.0, 1.0)),
    "top": ((0.0, 0.0, -1.0), (0.0, 1.0, 0.0)),
    "bottom": ((0.0, 0.0, 1.0), (0.0, -1.0, 0.0)),
    "iso": ((-1.0, 1.0, -1.0), (0.0, 0.0, 1.0)),
    "iso_back": ((1.0, -1.0, -1.0), (0.0, 0.0, 1.0)),
}
VIEW_LABELS = {
    "front": "Front (from -Y)",
    "back": "Back (from +Y)",
    "left": "Left (from -X)",
    "right": "Right (from +X)",
    "top": "Top (from +Z)",
    "bottom": "Bottom (from -Z)",
    "iso": "Iso (front, right, top)",
    "iso_back": "Iso (back, left, top)",
}

BODY = np.array([171, 179, 191], dtype=np.float32)
HIGHLIGHT = np.array([255, 106, 26], dtype=np.float32)
EDGE = np.array([38, 42, 50], dtype=np.uint8)
EDGE_HL = np.array([214, 72, 0], dtype=np.uint8)


def camera(view):
    d, up = VIEWS[view]
    d = geom.unit(d)
    up = geom.unit(geom.sub(up, geom.mul(d, geom.dot(up, d))))
    right = geom.cross(d, up)
    return np.array(right), np.array(up), np.array(d)


def nice_length(target):
    if target <= 0:
        return 1.0
    p = 10 ** math.floor(math.log10(target))
    for m in (1, 2, 5, 10):
        if m * p >= target:
            return m * p
    return 10 * p


def _font():
    try:
        return ImageFont.load_default(size=13)
    except TypeError:
        return ImageFont.load_default()


def render_view(mesh, view, width, height, hl_faces=(), hl_edges=(), labels=True, transparent=False, margin=None):
    """One view as an RGBA image plus its scale (mm per pixel)."""
    right, up, d = camera(view)
    P = np.asarray(mesh.positions, dtype=np.float64).reshape(-1, 3)
    I = np.asarray(mesh.indices, dtype=np.int64).reshape(-1, 3)
    E = np.asarray(mesh.edge_points, dtype=np.float64).reshape(-1, 3)
    W, H = int(width), int(height)
    top_pad = 22 if labels else 0
    bottom_pad = 26 if labels else 0
    m = margin if margin is not None else max(8, int(min(W, H) * 0.06))
    if len(P) == 0:
        img = Image.new("RGBA", (W, H), (0, 0, 0, 0) if transparent else (255, 255, 255, 255))
        return img, None
    sx = P @ right
    sy = P @ up
    sz = P @ d
    cx = (sx.min() + sx.max()) / 2
    cy = (sy.min() + sy.max()) / 2
    span_x = max(sx.max() - sx.min(), 1e-6)
    span_y = max(sy.max() - sy.min(), 1e-6)
    avail_h = H - top_pad - bottom_pad - 2 * m
    scale = min((W - 2 * m) / span_x, avail_h / span_y)
    mid_y = top_pad + (H - top_pad - bottom_pad) / 2
    px = (sx - cx) * scale + W / 2
    py = mid_y - (sy - cy) * scale

    zbuf = np.full((H, W), np.inf, dtype=np.float64)
    cbuf = np.zeros((H, W, 3), dtype=np.float32)
    hl_tri = np.zeros(len(I), dtype=bool)
    hl_set = set(hl_faces)
    for fi, (start, count, _b) in enumerate(mesh.face_ranges):
        if fi in hl_set and count > 0:
            hl_tri[start : start + count] = True

    v0 = P[I[:, 0]]
    v1 = P[I[:, 1]]
    v2 = P[I[:, 2]]
    tn = np.cross(v1 - v0, v2 - v0)
    ln = np.linalg.norm(tn, axis=1)
    ln[ln == 0] = 1.0
    tn = tn / ln[:, None]
    facing = tn @ d < 1e-9
    # Direction toward the light: from the viewer, a little up and to the left.
    to_light = np.array(geom.unit(tuple(-d + up * 0.55 - right * 0.35)))
    shade = 0.38 + 0.62 * np.clip(tn @ to_light, 0.0, 1.0)
    colors = np.where(hl_tri[:, None], HIGHLIGHT, BODY) * shade[:, None]

    X = px[I]
    Y = py[I]
    Z = sz[I]
    for t in np.nonzero(facing)[0]:
        xs = X[t]
        ys = Y[t]
        zs = Z[t]
        x0 = max(int(math.floor(xs.min())), 0)
        x1 = min(int(math.ceil(xs.max())), W - 1)
        y0 = max(int(math.floor(ys.min())), 0)
        y1 = min(int(math.ceil(ys.max())), H - 1)
        if x0 > x1 or y0 > y1:
            continue
        area = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0])
        if abs(area) < 1e-12:
            continue
        if (x1 - x0 + 1) * (y1 - y0 + 1) <= 2:
            ix = min(max(int(xs.mean()), 0), W - 1)
            iy = min(max(int(ys.mean()), 0), H - 1)
            z = zs.mean()
            if z < zbuf[iy, ix]:
                zbuf[iy, ix] = z
                cbuf[iy, ix] = colors[t]
            continue
        gx = np.arange(x0, x1 + 1, dtype=np.float64) + 0.5
        gy = (np.arange(y0, y1 + 1, dtype=np.float64) + 0.5)[:, None]
        w0 = ((xs[1] - gx) * (ys[2] - gy) - (xs[2] - gx) * (ys[1] - gy)) / area
        w1 = ((xs[2] - gx) * (ys[0] - gy) - (xs[0] - gx) * (ys[2] - gy)) / area
        w2 = 1.0 - w0 - w1
        inside = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
        if not inside.any():
            continue
        z = w0 * zs[0] + w1 * zs[1] + w2 * zs[2]
        sub = zbuf[y0 : y1 + 1, x0 : x1 + 1]
        closer = inside & (z < sub)
        if not closer.any():
            continue
        sub[closer] = z[closer]
        cb = cbuf[y0 : y1 + 1, x0 : x1 + 1]
        cb[closer] = colors[t]

    covered = np.isfinite(zbuf)
    zr = (sz.max() - sz.min()) if len(sz) else 1.0
    bias = 0.004 * max(zr, 1e-6) + 1.6 / scale
    out = np.zeros((H, W, 4), dtype=np.uint8)
    out[..., :3] = np.clip(cbuf, 0, 255).astype(np.uint8)
    out[..., 3] = np.where(covered, 255, 0)
    if not transparent:
        bg = ~covered
        out[bg, 0:3] = 255
        out[bg, 3] = 255

    hl_e = set(hl_edges)
    if len(E):
        ex = (E @ right - cx) * scale + W / 2
        ey = mid_y - ((E @ up) - cy) * scale
        ez = E @ d
        for ei, (start, count) in enumerate(mesh.edge_ranges):
            if count < 2:
                continue
            hl = ei in hl_e
            col = EDGE_HL if hl else EDGE
            thick = 2 if hl else 1
            for k in range(start, start + count - 1):
                ax, ay, az = ex[k], ey[k], ez[k]
                bx, by, bz = ex[k + 1], ey[k + 1], ez[k + 1]
                n = max(2, int(math.hypot(bx - ax, by - ay) / 0.6) + 1)
                tt = np.linspace(0.0, 1.0, n)
                qx = ax + (bx - ax) * tt
                qy = ay + (by - ay) * tt
                qz = az + (bz - az) * tt
                ix = np.clip(qx.astype(np.int64), 0, W - 1)
                iy = np.clip(qy.astype(np.int64), 0, H - 1)
                vis = (qz <= zbuf[iy, ix] + bias) | ~covered[iy, ix]
                ix = ix[vis]
                iy = iy[vis]
                for dx in range(thick):
                    for dy in range(thick):
                        jx = np.clip(ix + dx, 0, W - 1)
                        jy = np.clip(iy + dy, 0, H - 1)
                        out[jy, jx, 0:3] = col
                        out[jy, jx, 3] = 255

    img = Image.fromarray(out, "RGBA")
    mm_per_px = 1.0 / scale
    if labels:
        draw = ImageDraw.Draw(img)
        font = _font()
        draw.text((8, 4), VIEW_LABELS.get(view, view), fill=(60, 64, 72, 255), font=font)
        bar_mm = nice_length(mm_per_px * W * 0.18)
        bar_px = bar_mm / mm_per_px
        yb = H - 12
        draw.line([(10, yb), (10 + bar_px, yb)], fill=(60, 64, 72, 255), width=2)
        draw.line([(10, yb - 4), (10, yb + 4)], fill=(60, 64, 72, 255), width=1)
        draw.line([(10 + bar_px, yb - 4), (10 + bar_px, yb + 4)], fill=(60, 64, 72, 255), width=1)
        draw.text((16 + bar_px, yb - 9), geom.fmt(bar_mm) + " mm", fill=(60, 64, 72, 255), font=font)
    return img, mm_per_px


def render(mesh, views, size, path, hl_faces=(), hl_edges=()):
    """One view, or a 2x2 sheet when several views are asked for."""
    if len(views) == 1:
        img, mmpp = render_view(mesh, views[0], size, size, hl_faces, hl_edges)
        img.convert("RGB").save(path, "PNG")
        return [{"view": views[0], "mm_per_px": geom.rnd(mmpp, 5) if mmpp else None}]
    cols = 2
    rows = int(math.ceil(len(views) / cols))
    tile = size // 2
    sheet = Image.new("RGB", (tile * cols, tile * rows), (255, 255, 255))
    out = []
    draw = ImageDraw.Draw(sheet)
    for i, v in enumerate(views):
        img, mmpp = render_view(mesh, v, tile, tile, hl_faces, hl_edges)
        x = (i % cols) * tile
        y = (i // cols) * tile
        sheet.paste(img.convert("RGB"), (x, y))
        out.append({"view": v, "mm_per_px": geom.rnd(mmpp, 5) if mmpp else None, "tile": [x, y, tile, tile]})
    for c in range(1, cols):
        draw.line([(c * tile, 0), (c * tile, tile * rows)], fill=(220, 222, 226), width=1)
    for r in range(1, rows):
        draw.line([(0, r * tile), (tile * cols, r * tile)], fill=(220, 222, 226), width=1)
    sheet.save(path, "PNG")
    return out


def thumbnail(mesh, path, width=360, height=270):
    img, _ = render_view(mesh, "iso", width, height, labels=False, transparent=True, margin=14)
    img.save(path, "PNG")
