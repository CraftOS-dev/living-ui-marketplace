"""Writing files: every format, the three compression modes and metadata.

An output spec:
    format      jpeg | png | webp | avif | gif | ico | tiff
    mode        quality (a 1..100 number) | size (a target in KB) | lossless
    quality     the number for quality mode
    target_kb   the target for size mode (a binary search on quality, at
                most 7 encodes; shrinks the image when allowed and needed)
    metadata    keep (everything but GPS when strip_gps) | basic (author,
                copyright, date and description) | none (nothing at all)
    strip_gps   remove the location (default on)
    matte       the colour under transparency for JPEG and GIF
    progressive, subsampling (auto | 420 | 444), palette (auto | on | off),
    effort (fast | normal | max), ico_sizes, description (alt text)

Quality numbers do not mean the same thing across codecs, so the app's
named levels map to a number per codec (LEVELS).
"""

import io

from PIL import Image, ImageCms, PngImagePlugin

from . import load
from .errors import ImgError, invalid

FORMATS = ["jpeg", "png", "webp", "avif", "gif", "ico", "tiff"]
EXT = {"jpeg": "jpg", "png": "png", "webp": "webp", "avif": "avif", "gif": "gif", "ico": "ico", "tiff": "tif"}
ANIMATED = {"gif", "webp", "avif", "png"}

# Best detail / Balanced / Smallest per codec (equal-looking, not equal numbers).
LEVELS = {
    "jpeg": {"best": 90, "balanced": 80, "small": 66},
    "webp": {"best": 88, "balanced": 78, "small": 62},
    "avif": {"best": 72, "balanced": 58, "small": 44},
}


def quality_for(fmt, spec):
    q = spec.get("quality")
    if isinstance(q, str):
        return LEVELS.get(fmt, LEVELS["jpeg"]).get(q, 80)
    if q is None:
        return LEVELS.get(fmt, LEVELS["jpeg"])["balanced"]
    return max(1, min(100, int(q)))


def flatten(im, matte):
    if im.mode != "RGBA":
        return im.convert("RGB")
    from .draw import rgba

    bg = Image.new("RGBA", im.size, rgba(matte, "#ffffff"))
    bg.alpha_composite(im)
    return bg.convert("RGB")


def has_alpha(im):
    if im.mode != "RGBA":
        return False
    lo, _ = im.getchannel("A").getextrema()
    return lo < 255


def is_graphic(im):
    """Screenshots, logos and drawings: few distinct colours. They keep full colour resolution."""
    small = im.convert("RGB")
    if max(small.size) > 400:
        small = small.copy()
        small.thumbnail((400, 400), Image.Resampling.NEAREST)
    return small.getcolors(4096) is not None


# ----------------------------------------------------------------- metadata

TAG_DESC, TAG_ARTIST, TAG_COPYRIGHT, TAG_DATETIME = 0x010E, 0x013B, 0x8298, 0x0132
EXIF_IFD, GPS_IFD, TAG_DATE_ORIG = 0x8769, 0x8825, 0x9003


def build_exif(source_path, spec):
    """EXIF bytes for the output under the metadata policy (orientation always upright)."""
    policy = spec.get("metadata") or "basic"
    if policy == "none":
        return b""
    try:
        src = Image.open(source_path).getexif()
    except Exception:
        src = Image.Exif()
    out = Image.Exif()
    if policy == "keep":
        for k, v in src.items():
            if k in (0x0112, GPS_IFD, EXIF_IFD, 0x0201, 0x0202):
                continue
            out[k] = v
        try:
            ifd = src.get_ifd(EXIF_IFD)
            if ifd:
                out.get_ifd(EXIF_IFD).update({k: v for k, v in ifd.items() if k not in (0x927C,)})  # drop MakerNote
        except Exception:
            pass
        if not spec.get("strip_gps", True):
            try:
                gps = src.get_ifd(GPS_IFD)
                if gps:
                    out.get_ifd(GPS_IFD).update(gps)
            except Exception:
                pass
    else:  # basic
        for k in (TAG_ARTIST, TAG_COPYRIGHT, TAG_DATETIME, TAG_DESC):
            if src.get(k):
                out[k] = src.get(k)
        try:
            d = src.get_ifd(EXIF_IFD).get(TAG_DATE_ORIG)
            if d:
                out.get_ifd(EXIF_IFD)[TAG_DATE_ORIG] = d
        except Exception:
            pass
    if spec.get("description"):
        out[TAG_DESC] = str(spec["description"])[:2000]
    if spec.get("artist"):
        out[TAG_ARTIST] = str(spec["artist"])[:200]
    if spec.get("copyright"):
        out[TAG_COPYRIGHT] = str(spec["copyright"])[:200]
    out[0x0112] = 1
    if len(out) == 1 and not out.get_ifd(EXIF_IFD) and not out.get_ifd(GPS_IFD):
        return b""
    return out.tobytes()


def icc_bytes(spec):
    if (spec.get("metadata") or "basic") == "none":
        return None
    return load.srgb_profile().tobytes()


# ------------------------------------------------------------------ encoders


def _jpeg(im, spec, q, exif, icc):
    rgb = flatten(im, spec.get("matte"))
    sub = spec.get("subsampling") or "auto"
    sub_val = 0 if sub == "444" or (sub == "auto" and is_graphic(rgb)) else 2
    buf = io.BytesIO()
    kw = {"quality": min(95, q), "optimize": True, "progressive": spec.get("progressive", True), "subsampling": sub_val}
    if exif:
        kw["exif"] = exif
    if icc:
        kw["icc_profile"] = icc
    rgb.save(buf, "JPEG", **kw)
    data = buf.getvalue()
    try:
        import mozjpeg_lossless_optimization as mz

        better = mz.optimize(data, copy=mz.COPY_MARKERS.ALL)
        if len(better) < len(data):
            data = better
    except Exception:
        pass
    return data


def _png_palette(im, spec):
    want = spec.get("palette") or "auto"
    if want == "off":
        return None
    if want == "auto":
        colors = im.getcolors(256)
        if colors is None:
            return None
    if im.mode == "RGBA":
        return im.quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE if want == "auto" else Image.Dither.FLOYDSTEINBERG)
    return im.quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE if want == "auto" else Image.Dither.FLOYDSTEINBERG)


def _png(im, spec, exif, icc):
    src = im if has_alpha(im) else im.convert("RGB")
    pal = _png_palette(src, spec)
    img = pal if pal is not None else src
    info = PngImagePlugin.PngInfo()
    if spec.get("description"):
        info.add_itxt("Description", str(spec["description"])[:2000])
    buf = io.BytesIO()
    kw = {"pnginfo": info, "compress_level": 6}
    if exif:
        kw["exif"] = exif
    if icc:
        kw["icc_profile"] = icc
    img.save(buf, "PNG", **kw)
    data = buf.getvalue()
    effort = spec.get("effort") or "normal"
    try:
        import oxipng

        level = {"fast": 1, "normal": 2, "max": 4}.get(effort, 2)
        kw2 = {"level": level, "strip": oxipng.StripChunks.none()}
        if effort == "max":
            kw2["deflate"] = oxipng.Deflaters.zopfli(15)
        data = oxipng.optimize_from_memory(data, **kw2)
    except Exception:
        pass
    return data


def _webp(im, spec, q, exif, icc, lossless):
    img = im if has_alpha(im) else im.convert("RGB")
    method = {"fast": 2, "normal": 4, "max": 6}.get(spec.get("effort") or "normal", 4)
    buf = io.BytesIO()
    kw = {"quality": 100 if lossless else q, "lossless": bool(lossless), "method": method}
    if exif:
        kw["exif"] = exif
    if icc:
        kw["icc_profile"] = icc
    img.save(buf, "WEBP", **kw)
    return buf.getvalue()


def _avif(im, spec, q, exif, icc, lossless):
    img = im if has_alpha(im) else im.convert("RGB")
    speed = {"fast": 8, "normal": 6, "max": 4}.get(spec.get("effort") or "normal", 6)
    buf = io.BytesIO()
    kw = {"quality": 100 if lossless else q, "speed": speed, "subsampling": "4:4:4" if lossless or is_graphic(img) else "4:2:0"}
    if exif:
        kw["exif"] = exif
    if icc:
        kw["icc_profile"] = icc
    img.save(buf, "AVIF", **kw)
    return buf.getvalue()


def _gif_frame(im, spec):
    if has_alpha(im):
        rgba = im.convert("RGBA")
        p = rgba.quantize(255, method=Image.Quantize.FASTOCTREE)
        # Pixels below half opacity become the transparent index.
        alpha = rgba.getchannel("A").point(lambda v: 255 if v < 128 else 0)
        p.paste(255, mask=alpha)
        p.info["transparency"] = 255
        return p
    return im.convert("RGB").quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG)


def _gif(im, spec):
    buf = io.BytesIO()
    f = _gif_frame(im, spec)
    kw = {"optimize": True}
    if "transparency" in f.info:
        kw["transparency"] = f.info["transparency"]
    f.save(buf, "GIF", **kw)
    return buf.getvalue()


def _ico(im, spec):
    sizes = [int(s) for s in (spec.get("ico_sizes") or [16, 32, 48, 64, 128, 256]) if 8 <= int(s) <= 256]
    side = max(im.size)
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    src = im.convert("RGBA")
    sq.paste(src, ((side - im.width) // 2, (side - im.height) // 2), src)
    buf = io.BytesIO()
    sq.save(buf, "ICO", sizes=[(s, s) for s in sorted(set(sizes))])
    return buf.getvalue()


def _tiff(im, spec, exif, icc):
    img = im if has_alpha(im) else im.convert("RGB")
    buf = io.BytesIO()
    kw = {"compression": "tiff_adobe_deflate"}
    if exif:
        kw["exif"] = exif
    if icc:
        kw["icc_profile"] = icc
    img.save(buf, "TIFF", **kw)
    return buf.getvalue()


def encode_once(im, spec, q, exif, icc):
    fmt = spec["format"]
    lossless = spec.get("mode") == "lossless"
    if fmt == "jpeg":
        return _jpeg(im, spec, q, exif, icc)
    if fmt == "png":
        return _png(im, spec, exif, icc)
    if fmt == "webp":
        return _webp(im, spec, q, exif, icc, lossless)
    if fmt == "avif":
        return _avif(im, spec, q, exif, icc, lossless)
    if fmt == "gif":
        return _gif(im, spec)
    if fmt == "ico":
        return _ico(im, spec)
    if fmt == "tiff":
        return _tiff(im, spec, exif, icc)
    raise invalid("format must be one of " + ", ".join(FORMATS))


def encode(im, spec, source_path):
    """(bytes, facts) for one still image."""
    fmt = spec.get("format")
    if fmt not in FORMATS:
        raise invalid("format must be one of " + ", ".join(FORMATS))
    exif = build_exif(source_path, spec) if fmt in ("jpeg", "png", "webp", "avif", "tiff") else b""
    icc = icc_bytes(spec) if fmt in ("jpeg", "png", "webp", "avif", "tiff") else None
    facts = {"format": fmt, "width": im.width, "height": im.height, "alpha": has_alpha(im) and fmt not in ("jpeg",)}
    mode = spec.get("mode") or "quality"
    if mode == "size" and fmt in ("jpeg", "webp", "avif"):
        target = max(1, int(float(spec.get("target_kb") or 200) * 1024))
        data, q, img, shrunk = _to_size(im, spec, target, exif, icc)
        facts.update({"quality": q, "target_bytes": target, "met_target": len(data) <= target, "width": img.width, "height": img.height, "shrunk": shrunk})
        return data, facts
    q = quality_for(fmt, spec)
    data = encode_once(im, spec, q, exif, icc)
    if fmt in ("jpeg", "webp", "avif") and mode != "lossless":
        facts["quality"] = q
    return data, facts


# Below these, artefacts show more than a smaller image would: a size target
# shrinks the image rather than go lower (unless resizing is not allowed).
SIZE_FLOOR = {"jpeg": 40, "webp": 40, "avif": 30}


def _to_size(im, spec, target, exif, icc):
    """The highest quality whose file fits. The floor quality is tried first:
    when even it does not fit, the image shrinks at once (when allowed)."""
    fmt = spec["format"]
    resize = spec.get("allow_resize", True)
    floor = SIZE_FLOOR.get(fmt, 30) if resize else 5
    img, shrunk = im, False
    for _ in range(5):
        data = encode_once(img, spec, floor, exif, icc)
        if len(data) <= target:
            best = (data, floor)
            lo, hi = floor + 1, 95
            while lo <= hi:
                q = (lo + hi) // 2
                data = encode_once(img, spec, q, exif, icc)
                if len(data) <= target:
                    best = (data, q)
                    lo = q + 1
                else:
                    hi = q - 1
            return best[0], best[1], img, shrunk
        if not resize:
            return data, floor, img, shrunk
        k = max(0.3, min(0.92, (target / max(1, len(data))) ** 0.5 * 0.95))
        img = img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.Resampling.LANCZOS)
        shrunk = True
    return encode_once(img, spec, floor, exif, icc), floor, img, shrunk


def encode_animation(frames, durations, loop, spec, source_path):
    fmt = spec["format"]
    if fmt not in ANIMATED:
        raise invalid(fmt.upper() + " cannot hold an animation; use GIF, WebP, AVIF or PNG (APNG), or export one frame.")
    q = quality_for(fmt, spec)
    buf = io.BytesIO()
    if fmt == "gif":
        fs = [_gif_frame(f, spec) for f in frames]
        kw = {"save_all": True, "append_images": fs[1:], "duration": durations, "loop": loop, "optimize": True, "disposal": 2}
        if "transparency" in fs[0].info:
            kw["transparency"] = fs[0].info["transparency"]
        fs[0].save(buf, "GIF", **kw)
    elif fmt == "png":
        fs = [f if has_alpha(f) else f.convert("RGB") for f in frames]
        fs[0].save(buf, "PNG", save_all=True, append_images=fs[1:], duration=durations, loop=loop)
    elif fmt == "webp":
        fs = [f if has_alpha(f) else f.convert("RGB") for f in frames]
        fs[0].save(buf, "WEBP", save_all=True, append_images=fs[1:], duration=durations, loop=loop, quality=q, lossless=spec.get("mode") == "lossless", method=4)
    else:
        fs = [f if has_alpha(f) else f.convert("RGB") for f in frames]
        fs[0].save(buf, "AVIF", save_all=True, append_images=fs[1:], duration=durations, quality=q, speed=8)
    return buf.getvalue(), {"format": fmt, "width": frames[0].width, "height": frames[0].height, "frames": len(frames), "quality": q if fmt in ("webp", "avif") else None}


def check(data):
    """Read back what was written (a corrupt file never leaves the engine)."""
    try:
        with Image.open(io.BytesIO(data)) as im:
            im.load()
            return im.size
    except Exception as e:
        raise ImgError("encode_failed", "The written file could not be read back (" + str(e) + ").")
