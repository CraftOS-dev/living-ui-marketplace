"""The engine's jobs (one JSON file each; see server.py).

    ping                       versions
    probe     path             facts about an original
    render    path stack       a preview (and thumbnail, histogram) of the stack
    export    path stack outputs
                               write each output file (any format, animations kept)
    analyze   path stack what  auto adjust, trim box, smart crop box, colours, histogram
    mask      path stack model a background mask for a remove_bg edit
    filters   path stack       small previews of every filter look
    compare   path stack spec region
                               the same region before and after encoding, at 100 %
"""

import io
import os

from PIL import Image, ImageChops

from . import ENGINE_VERSION, ai, encode, geom, load, render, tone
from .errors import ImgError, invalid


def _ctx(job):
    # layers: False renders the photo's edits only (the workspace draws the layers itself).
    return {"masks": job.get("masks") or {}, "logos": job.get("logos") or {}, "layers": job.get("layers", True) is not False}


def _save_preview(im, path, fmt="webp", quality=84):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if fmt == "png":
        im.save(path, "PNG", compress_level=1)
    elif fmt == "jpeg":
        encode.flatten(im, "#ffffff").save(path, "JPEG", quality=quality)
    else:
        (im if im.mode == "RGBA" else im.convert("RGB")).save(path, "WEBP", quality=quality, method=2)
    return {"path": path, "width": im.width, "height": im.height, "bytes": os.path.getsize(path)}


def do_render(job):
    path = job["path"]
    stack = job.get("stack") or []
    max_side = int(job.get("max") if job.get("max") is not None else 1600)
    reg = job.get("region")
    if reg:
        # A part of the final image at full resolution (to look closely).
        max_side = 0
    placed = {}
    im, scale, chain = render.run(path, stack, max_side, int(job.get("frame") or 0), _ctx(job), out=placed)
    out = {"width": chain[-1][0], "height": chain[-1][1], "chain": [list(c) for c in chain], "alpha": encode.has_alpha(im), "transform": placed.get("transform")}
    if reg:
        x0 = max(0, min(im.width - 1, int(reg.get("x", 0))))
        y0 = max(0, min(im.height - 1, int(reg.get("y", 0))))
        x1 = max(x0 + 1, min(im.width, x0 + int(reg.get("w", im.width))))
        y1 = max(y0 + 1, min(im.height, y0 + int(reg.get("h", im.height))))
        im = im.crop((x0, y0, x1, y1))
        if max(im.size) > 2400:
            im.thumbnail((2400, 2400), Image.Resampling.LANCZOS)
        out["region"] = {"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0}
    if job.get("out"):
        out["preview"] = _save_preview(im, job["out"], job.get("fmt") or "webp")
    th = job.get("thumb")
    if th:
        t = im.copy()
        t.thumbnail((int(th.get("size") or 320),) * 2, Image.Resampling.LANCZOS)
        out["thumb"] = _save_preview(t, th["out"], "webp", 80)
    if job.get("histogram"):
        out["histogram"] = load.histogram(im)
    return out


def _frames_for(job):
    """Every frame run through the stack (animations), or None for a still image."""
    path = job["path"]
    info = load.open_image(path)
    n = int(getattr(info, "n_frames", 1) or 1)
    if n <= 1:
        return None
    stack = job.get("stack") or []
    if any(e.get("kind") == "remove_bg" and e.get("enabled", True) for e in stack):
        raise ImgError("not_for_animation", "Remove background works on still images; export one frame (a PNG) instead.")
    frames, durations, loop = load.load_frames(path)
    out = []
    for f in frames:
        im, _, _ = render.run(path, stack, 0, 0, _ctx(job), base=f)
        out.append(im)
    return out, durations, loop


def do_export(job):
    outputs = job.get("outputs") or []
    if not outputs:
        raise invalid("outputs: give at least one output")
    path = job["path"]
    animated = None
    if job.get("animate", True) and any(o.get("format") in encode.ANIMATED for o in outputs):
        animated = _frames_for(job)
    still = None
    results = []
    for o in outputs:
        spec = dict(o)
        target = spec.pop("out")
        os.makedirs(os.path.dirname(target), exist_ok=True)
        if animated is not None and spec.get("format") in encode.ANIMATED:
            frames, durations, loop = animated
            frames = [_scaled(f, spec) for f in frames]
            data, facts = encode.encode_animation(frames, durations, loop, spec, path)
        else:
            if still is None:
                still, _, _ = render.run(path, job.get("stack") or [], 0, 0, _ctx(job))
            im = _scaled(still, spec)
            data, facts = encode.encode(im, spec, path)
        size = encode.check(data)
        with open(target, "wb") as f:
            f.write(data)
        facts.update({"path": target, "bytes": len(data), "width": size[0], "height": size[1]})
        results.append(facts)
    return {"outputs": results}


def _scaled(im, spec):
    """An output's own size: a scale factor (1x / 2x sets), a longest edge, or a
    square icon (the image fitted inside, the rest transparent)."""
    sq = int(spec.get("square") or 0)
    if sq:
        k = sq / max(im.size)
        fit = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.Resampling.LANCZOS, reducing_gap=3.0)
        box = Image.new("RGBA", (sq, sq), (0, 0, 0, 0))
        src = fit.convert("RGBA")
        box.paste(src, ((sq - fit.width) // 2, (sq - fit.height) // 2), src)
        return box
    k = float(spec.get("scale") or 1)
    longest = int(spec.get("longest") or 0)
    if longest:
        k = min(k, longest / max(im.size)) if spec.get("scale") else longest / max(im.size)
        if not spec.get("enlarge"):
            k = min(k, 1.0)
    if abs(k - 1.0) < 1e-6:
        return im
    return im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.Resampling.LANCZOS, reducing_gap=3.0)


def trim_box(im, tolerance=12):
    """The box inside a uniform border (the corner's colour), in this image's pixels."""
    rgb = im.convert("RGBA")
    corner = rgb.getpixel((0, 0))
    bg = Image.new("RGBA", rgb.size, corner)
    diff = ImageChops.difference(rgb, bg).convert("L").point(lambda v: 255 if v > tolerance else 0)
    box = diff.getbbox()
    if box is None:
        return None
    return box


def do_analyze(job):
    path = job["path"]
    stack = job.get("stack") or []
    im, scale, chain = render.run(path, stack, 1600, 0, _ctx(job))
    fw, fh = chain[-1]
    k = fw / im.width
    what = job.get("what") or ["auto", "trim", "histogram"]
    out = {"width": fw, "height": fh}
    if "auto" in what:
        out["auto"] = tone.auto_params(im)
    if "trim" in what:
        b = trim_box(im, int(job.get("tolerance") or 12))
        if b is None:
            out["trim"] = None
        else:
            x0, y0 = int(b[0] * k), int(b[1] * k)
            x1, y1 = min(fw, int(round(b[2] * k))), min(fh, int(round(b[3] * k)))
            out["trim"] = {"x": x0, "y": y0, "w": max(1, x1 - x0), "h": max(1, y1 - y0)} if (x1 - x0, y1 - y0) != (fw, fh) else None
    if "smart" in what:
        r = geom.ratio_of(job.get("ratio") or "1:1", fw, fh)
        cw, ch = geom.largest_of_ratio(fw, fh, r)
        x, y = render.smart_origin(im, fw, fh, cw, ch, 1.0 / k)
        out["smart"] = {"x": x, "y": y, "w": cw, "h": ch}
    if "histogram" in what:
        out["histogram"] = load.histogram(im)
    if "colors" in what:
        pal = im.convert("RGB").copy()
        pal.thumbnail((200, 200))
        q = pal.quantize(6, method=Image.Quantize.MEDIANCUT)
        counts = sorted(q.getcolors() or [], reverse=True)
        p = q.getpalette() or []
        out["colors"] = ["#%02x%02x%02x" % tuple(p[i * 3 : i * 3 + 3]) for _, i in counts[:6]]
    if "alpha" in what:
        out["alpha"] = encode.has_alpha(im)
    return out


def do_mask(job):
    path = job["path"]
    im, _, chain = render.run(path, job.get("stack") or [], 1600, 0, dict(_ctx(job), layers=False))
    m = ai.mask(im, job["models_dir"], job.get("model") or "fast")
    os.makedirs(os.path.dirname(job["out"]), exist_ok=True)
    m.save(job["out"], "PNG", compress_level=3)
    return dict(ai.mask_stats(m), path=job["out"], width=m.width, height=m.height)


def do_filters(job):
    path = job["path"]
    size = int(job.get("size") or 120)
    im, _, _ = render.run(path, job.get("stack") or [], 1600, 0, _ctx(job))
    small = im.copy()
    small.thumbnail((size, size), Image.Resampling.LANCZOS)
    out_dir = job["out_dir"]
    os.makedirs(out_dir, exist_ok=True)
    res = [dict(name="original", label="Original", **_save_preview(small, os.path.join(out_dir, "original.webp"), "webp", 80))]
    for name in tone.FILTERS:
        f = tone.filter_image(small, name, 1.0)
        res.append(dict(name=name, label=tone.FILTER_LABEL[name], **_save_preview(f, os.path.join(out_dir, name + ".webp"), "webp", 80)))
    return {"filters": res}


def do_compare(job):
    """The same region of the rendered image before and after encoding, at 100 %."""
    path = job["path"]
    full, _, _ = render.run(path, job.get("stack") or [], 0, 0, _ctx(job))
    spec = dict(job.get("spec") or {})
    spec.pop("out", None)
    full = _scaled(full, spec)
    data, facts = encode.encode(full, spec, path)
    after = Image.open(io.BytesIO(data))
    after.load()
    after = after.convert("RGBA" if encode.has_alpha(full) and spec.get("format") != "jpeg" else "RGB")
    if after.size != full.size:
        full = full.resize(after.size, Image.Resampling.LANCZOS)
    reg = job.get("region") or {}
    w = min(after.width, int(reg.get("w") or 900))
    h = min(after.height, int(reg.get("h") or 600))
    cx = int(reg.get("cx") if reg.get("cx") is not None else after.width // 2)
    cy = int(reg.get("cy") if reg.get("cy") is not None else after.height // 2)
    x0 = min(max(0, cx - w // 2), after.width - w)
    y0 = min(max(0, cy - h // 2), after.height - h)
    box = (x0, y0, x0 + w, y0 + h)
    out_dir = job["out_dir"]
    before = _save_preview(full.crop(box), os.path.join(out_dir, "before.png"), "png")
    after_p = _save_preview(after.crop(box), os.path.join(out_dir, "after.png"), "png")
    return {"before": before, "after": after_p, "box": {"x": x0, "y": y0, "w": w, "h": h}, "bytes": len(data), "width": after.width, "height": after.height, "quality": facts.get("quality")}


def do_zip(job):
    """Pack files into one zip (images are stored, not recompressed)."""
    import zipfile

    out = job["out"]
    os.makedirs(os.path.dirname(out), exist_ok=True)
    tmp = out + ".part"
    with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as z:
        for f in job.get("files") or []:
            z.write(f["path"], arcname=f["name"])
    os.replace(tmp, out)
    return {"path": out, "bytes": os.path.getsize(out), "files": len(job.get("files") or [])}


def handle(job):
    kind = job.get("kind")
    if kind == "ping":
        import numpy
        import PIL

        try:
            import onnxruntime

            ort = onnxruntime.__version__
        except Exception:
            ort = None
        return {"engine": "img-engine " + ENGINE_VERSION, "pillow": PIL.__version__, "numpy": numpy.__version__, "onnxruntime": ort}
    if kind == "probe":
        return load.probe(job["path"])
    if kind == "render":
        return do_render(job)
    if kind == "export":
        return do_export(job)
    if kind == "analyze":
        return do_analyze(job)
    if kind == "mask":
        return do_mask(job)
    if kind == "filters":
        return do_filters(job)
    if kind == "compare":
        return do_compare(job)
    if kind == "zip":
        return do_zip(job)
    if kind == "clear_cache":
        render.clear_cache()
        return {"ok": True}
    raise invalid("unknown job kind " + repr(kind))
