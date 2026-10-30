"""Opening originals the same way every time.

The rules (from the research behind the app): turn the image upright from
its EXIF orientation before anything else; convert any non-sRGB colour
profile (and CMYK) to sRGB so edits and exports agree with the screen; keep
alpha as alpha; bring 16-bit and palette images to 8-bit RGB(A). Originals
are only ever read.
"""

import hashlib
import io
import os

from PIL import ExifTags, Image, ImageCms, ImageOps, ImageSequence

from .errors import ImgError

# Pillow warns at 89.5 MP and refuses at twice that; the app asks first instead.
Image.MAX_IMAGE_PIXELS = None
MAX_PIXELS = 400_000_000

_SRGB = None


def srgb_profile():
    global _SRGB
    if _SRGB is None:
        _SRGB = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB"))
    return _SRGB


def profile_name(icc):
    if not icc:
        return ""
    try:
        p = ImageCms.ImageCmsProfile(io.BytesIO(icc))
        return (ImageCms.getProfileDescription(p) or "").strip()
    except Exception:
        return "unreadable profile"


def is_srgb(name):
    n = (name or "").lower()
    return n == "" or "srgb" in n or "iec61966" in n or "iec 61966" in n


def has_alpha(im):
    if im.mode in ("RGBA", "LA", "PA", "La", "RGBa"):
        return True
    return "transparency" in im.info


def _to_8bit(im):
    """16-bit grey or float images to 8-bit L, spreading the used range."""
    import numpy as np

    a = np.asarray(im, dtype=np.float64)
    hi = 65535.0 if im.mode.startswith("I;16") or (im.mode == "I" and a.max() > 255) else max(1.0, float(a.max()))
    return Image.fromarray(np.clip(a / hi * 255.0 + 0.5, 0, 255).astype("uint8"), "L")


def normalize(im, icc=None):
    """Any frame -> RGB or RGBA in sRGB."""
    name = profile_name(icc)
    if im.mode in ("I;16", "I;16B", "I;16L", "I", "F"):
        im = _to_8bit(im)
    if im.mode == "CMYK":
        if icc:
            try:
                return ImageCms.profileToProfile(im, ImageCms.ImageCmsProfile(io.BytesIO(icc)), srgb_profile(), outputMode="RGB")
            except Exception:
                pass
        return im.convert("RGB")
    alpha = has_alpha(im)
    target = "RGBA" if alpha else "RGB"
    if im.mode != target:
        if im.mode == "P" and alpha:
            im = im.convert("RGBA")
        else:
            im = im.convert(target)
    if icc and not is_srgb(name):
        try:
            im = ImageCms.profileToProfile(im, ImageCms.ImageCmsProfile(io.BytesIO(icc)), srgb_profile(), outputMode=target)
        except Exception:
            pass  # an unreadable profile: treat the pixels as sRGB
    return im


def open_image(path):
    try:
        im = Image.open(path)
    except FileNotFoundError:
        raise ImgError("not_found", "The original file is missing (" + os.path.basename(path) + ").")
    except Exception as e:
        raise ImgError("unreadable", "This file could not be read as an image (" + (str(e) or type(e).__name__) + ").")
    w, h = im.size
    if w * h > MAX_PIXELS:
        raise ImgError("too_large", "The image is %d x %d (%.0f MP); the limit is %d MP." % (w, h, w * h / 1e6, MAX_PIXELS // 1_000_000))
    return im


def load(path, max_side=0, frame=0):
    """The upright sRGB working image (one frame), optionally decoded smaller."""
    im = open_image(path)
    icc = im.info.get("icc_profile")
    if getattr(im, "n_frames", 1) > 1 and frame:
        im.seek(min(frame, im.n_frames - 1))
    if max_side and im.format == "JPEG":
        # JPEG decodes at 1/2, 1/4 or 1/8 directly: far faster and smaller.
        im.draft("RGB", (max_side, max_side))
    try:
        im = ImageOps.exif_transpose(im)
    except Exception:
        pass
    out = normalize(im, icc)
    if max_side and max(out.size) > max_side:
        k = max_side / max(out.size)
        out = out.resize((max(1, round(out.width * k)), max(1, round(out.height * k))), Image.Resampling.LANCZOS, reducing_gap=3.0)
    return out


def load_frames(path):
    """All frames of an animation, upright and normalized, with their durations."""
    im = open_image(path)
    icc = im.info.get("icc_profile")
    frames, durations = [], []
    for fr in ImageSequence.Iterator(im):
        durations.append(int(fr.info.get("duration", im.info.get("duration", 100)) or 100))
        f = fr.copy()
        try:
            f = ImageOps.exif_transpose(f)
        except Exception:
            pass
        frames.append(normalize(f, icc))
    if any(f.mode == "RGBA" for f in frames):
        frames = [f.convert("RGBA") for f in frames]
    return frames, durations, int(im.info.get("loop", 0) or 0)


def full_size(path):
    """The upright size of the original (no decode)."""
    im = open_image(path)
    w, h = im.size
    try:
        if im.getexif().get(0x0112, 1) in (5, 6, 7, 8):
            w, h = h, w
    except Exception:
        pass
    return w, h


# ----------------------------------------------------------------- metadata

EXIF_KEEP = {
    "Make": "Camera make",
    "Model": "Camera",
    "LensModel": "Lens",
    "DateTimeOriginal": "Taken",
    "DateTime": "Modified",
    "ExposureTime": "Exposure",
    "FNumber": "Aperture",
    "ISOSpeedRatings": "ISO",
    "PhotographicSensitivity": "ISO",
    "FocalLength": "Focal length",
    "Software": "Software",
    "Artist": "Artist",
    "Copyright": "Copyright",
    "ImageDescription": "Description",
}


def _num(v):
    try:
        return float(v)
    except Exception:
        try:
            return float(v[0]) / float(v[1])
        except Exception:
            return None


def _fmt(tag, v):
    if isinstance(v, bytes):
        v = v.decode("utf-8", "ignore").strip("\x00 ")
    if tag == "ExposureTime":
        n = _num(v)
        if n:
            return "1/%d s" % round(1 / n) if n < 1 else "%g s" % n
    if tag == "FNumber":
        n = _num(v)
        if n:
            return "f/%g" % round(n, 1)
    if tag == "FocalLength":
        n = _num(v)
        if n:
            return "%g mm" % round(n, 1)
    if isinstance(v, tuple):
        return ", ".join(str(x) for x in v)
    return str(v).strip()


def _gps(gps):
    def deg(vals, ref):
        try:
            d, m, s = (_num(x) for x in vals)
            out = d + m / 60 + s / 3600
            return -out if ref in ("S", "W") else out
        except Exception:
            return None

    if not gps:
        return None
    lat = deg(gps.get(2), gps.get(1))
    lon = deg(gps.get(4), gps.get(3))
    if lat is None or lon is None or (lat == 0 and lon == 0):
        return None
    return {"lat": round(lat, 6), "lon": round(lon, 6)}


def exif_summary(im):
    out = {}
    gps = None
    try:
        ex = im.getexif()
    except Exception:
        return out, None, 1
    orientation = int(ex.get(0x0112, 1) or 1)
    tags = dict(ex.items())
    try:
        tags.update(ex.get_ifd(0x8769).items())
    except Exception:
        pass
    for k, v in tags.items():
        name = ExifTags.TAGS.get(k)
        if name in EXIF_KEEP and v not in (None, b"", ""):
            label = EXIF_KEEP[name]
            if label not in out:
                text = _fmt(name, v)
                if text:
                    out[label] = text[:200]
    try:
        gps = _gps(ex.get_ifd(0x8825))
    except Exception:
        gps = None
    return out, gps, orientation


def sha1(path):
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def probe(path):
    """Facts about an original, cheap to compute (one header read, no full decode)."""
    im = open_image(path)
    fmt = im.format or os.path.splitext(path)[1].lstrip(".").upper()
    w, h = im.size
    exif, gps, orientation = exif_summary(im)
    if orientation in (5, 6, 7, 8):
        w, h = h, w
    icc = im.info.get("icc_profile")
    name = profile_name(icc)
    frames = int(getattr(im, "n_frames", 1) or 1)
    dur = 0
    if frames > 1:
        try:
            for fr in ImageSequence.Iterator(im):
                dur += int(fr.info.get("duration", 100) or 100)
        except Exception:
            dur = 0
    dpi = im.info.get("dpi")
    bits = {"1": 1, "L": 8, "P": 8, "RGB": 8, "RGBA": 8, "CMYK": 8, "I;16": 16, "I;16B": 16, "I": 32, "F": 32}.get(im.mode, 8)
    return {
        "format": fmt.upper().replace("JPEG2000", "JP2"),
        "width": w,
        "height": h,
        "mode": im.mode,
        "bits": bits,
        "alpha": has_alpha(im),
        "frames": frames,
        "duration_ms": dur,
        "icc": name,
        "wide_gamut": bool(icc) and not is_srgb(name),
        "dpi": [round(float(dpi[0])), round(float(dpi[1]))] if dpi else None,
        "exif": exif,
        "gps": gps,
        "orientation": orientation,
        "bytes": os.path.getsize(path),
        "hash": sha1(path),
        "megapixels": round(w * h / 1e6, 1),
    }


def histogram(im, bins=64):
    """Luma and R, G, B histograms (bins each, normalized to the tallest bar)."""
    import numpy as np

    small = im.convert("RGB")
    if max(small.size) > 512:
        small = small.copy()
        small.thumbnail((512, 512))
    a = np.asarray(small, dtype=np.float32)
    luma = a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722
    out = {}
    peak = 1.0
    hists = {}
    for name, ch in (("luma", luma), ("r", a[..., 0]), ("g", a[..., 1]), ("b", a[..., 2])):
        hh, _ = np.histogram(ch, bins=bins, range=(0, 256))
        hists[name] = hh
        peak = max(peak, float(hh.max()))
    for name, hh in hists.items():
        out[name] = [round(float(v) / peak, 4) for v in hh]
    clip_lo = float((luma < 2).mean())
    clip_hi = float((luma > 253).mean())
    out["clipped"] = {"shadows": round(clip_lo * 100, 2), "highlights": round(clip_hi * 100, 2)}
    return out


def mean_color(im):
    import numpy as np

    small = im.convert("RGB").copy()
    small.thumbnail((64, 64))
    a = np.asarray(small, dtype=np.float32).reshape(-1, 3).mean(axis=0)
    return "#%02x%02x%02x" % tuple(int(round(v)) for v in a)

