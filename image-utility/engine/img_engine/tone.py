"""Light and colour: the Adjust edit, the filter looks and Auto.

Speed matters (a slider redraws the preview), so the tonal work (levels,
white balance, exposure in linear light, shadows, highlights, blacks,
whites, contrast) is folded into one lookup table per channel and applied
by Pillow in C; saturation uses Pillow's colour enhancer; only vibrance and
the vignette touch the pixels with NumPy. Sliders run -100..100 (exposure
in EV, -3..3), 0 = no change.
"""

import numpy as np
from PIL import Image, ImageChops, ImageEnhance, ImageFilter

LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)

ADJUST_KEYS = ["exposure", "contrast", "highlights", "shadows", "whites", "blacks", "saturation", "vibrance", "temperature", "tint", "clarity", "sharpen", "vignette"]

FILTERS = ["vivid", "warm", "cool", "mono", "noir", "sepia", "fade", "vintage", "chrome", "matte", "dramatic", "soft"]

FILTER_LABEL = {
    "vivid": "Vivid",
    "warm": "Warm",
    "cool": "Cool",
    "mono": "Mono",
    "noir": "Noir",
    "sepia": "Sepia",
    "fade": "Fade",
    "vintage": "Vintage",
    "chrome": "Chrome",
    "matte": "Matte",
    "dramatic": "Dramatic",
    "soft": "Soft",
}

X = np.linspace(0.0, 1.0, 256, dtype=np.float64)


def luma(a):
    return a @ LUMA


def _smooth(x):
    return x * x * (3.0 - 2.0 * x)


# ------------------------------------------------------------ tone curves


def levels_curve(x, lv):
    if not lv:
        return x
    b = float(lv.get("black", 0)) / 255.0
    w = float(lv.get("white", 255)) / 255.0
    g = float(lv.get("gamma", 1.0) or 1.0)
    if w - b < 1e-3:
        return x
    x = np.clip((x - b) / (w - b), 0.0, 1.0)
    return np.power(x, 1.0 / g) if abs(g - 1.0) > 1e-3 else x


def exposure_curve(x, ev):
    if not ev:
        return x
    return np.power(np.clip(np.power(np.clip(x, 0, None), 2.2) * 2.0**ev, 0, None), 1.0 / 2.2)


def tone_curve(x, highlights, shadows, whites, blacks):
    if shadows:
        m = (1.0 - np.clip(x, 0, 1)) ** 2
        x = x + shadows * 0.45 * m * (1.0 - x) if shadows > 0 else x * (1.0 + shadows * 0.6 * m)
    if highlights:
        m = np.clip(x, 0, 1) ** 2
        x = x + highlights * 0.45 * m * x if highlights < 0 else x + highlights * 0.35 * m * (1.0 - x)
    if blacks:
        x = x + blacks * 0.18 * (1.0 - np.clip(x, 0, 1)) ** 4
    if whites:
        x = x + whites * 0.18 * np.clip(x, 0, 1) ** 4
    return x


def contrast_curve(x, c):
    """c in -1..1: an S-curve around mid grey (or its flattening)."""
    if not c:
        return x
    x = np.clip(x, 0.0, 1.0)
    if c > 0:
        return x + (_smooth(x) - x) * min(1.0, c * 1.6)
    return 0.5 + (x - 0.5) * (1.0 + c * 0.6)


def _lut(curves):
    """Three channel curves (arrays over X) -> a Pillow point() table."""
    out = []
    for c in curves:
        out.extend(np.clip(np.round(c * 255.0), 0, 255).astype(np.int64).tolist())
    return out


def point_rgb(im, curves):
    alpha = im.getchannel("A") if im.mode == "RGBA" else None
    out = im.convert("RGB").point(_lut(curves))
    if alpha is not None:
        out.putalpha(alpha)
    return out


def _keep_alpha(rgb, alpha):
    if alpha is not None:
        rgb = rgb.convert("RGBA")
        rgb.putalpha(alpha)
    return rgb


def saturate(im, factor):
    if abs(factor - 1.0) < 1e-3:
        return im
    alpha = im.getchannel("A") if im.mode == "RGBA" else None
    return _keep_alpha(ImageEnhance.Color(im.convert("RGB")).enhance(max(0.0, factor)), alpha)


def vibrance(im, v):
    """Saturation that spares what is already saturated: rgb + (rgb - grey) * 1.2v * (1 - sat),
    done as a blend of a boosted copy through a mask of how unsaturated each pixel is."""
    if not v:
        return im
    alpha = im.getchannel("A") if im.mode == "RGBA" else None
    rgb = im.convert("RGB")
    r, g, b = rgb.split()
    sat = ImageChops.subtract(ImageChops.lighter(ImageChops.lighter(r, g), b), ImageChops.darker(ImageChops.darker(r, g), b))
    mask = ImageChops.invert(sat)
    boosted = ImageEnhance.Color(rgb).enhance(max(0.0, 1.0 + 1.2 * v))
    return _keep_alpha(Image.composite(boosted, rgb, mask), alpha)


def vignette(im, v):
    """v > 0 darkens the corners, v < 0 lightens them."""
    if not v:
        return im
    alpha = im.getchannel("A") if im.mode == "RGBA" else None
    rgb = im.convert("RGB")
    g = Image.radial_gradient("L").resize(rgb.size, Image.Resampling.BILINEAR)
    lut = (_smooth(np.clip((X * 1.41 - 0.45) / 0.75, 0.0, 1.0)) * 255.0 * min(1.0, abs(v) * 0.75)).round().astype(np.int64).tolist()
    m = g.point(lut)
    other = Image.new("RGB", rgb.size, (0, 0, 0) if v > 0 else (255, 255, 255))
    return _keep_alpha(Image.composite(other, rgb, m), alpha)


def adjust(im, p, scale=1.0):
    """The Adjust edit. p: the sliders (see ADJUST_KEYS) and optional levels."""
    f = lambda k: float(p.get(k) or 0) / 100.0  # noqa: E731
    temp, tint = f("temperature"), f("tint")
    gains = (1.0 + 0.22 * temp, 1.0 - 0.16 * tint, 1.0 - 0.22 * temp)
    curves = []
    for g in gains:
        x = levels_curve(X, p.get("levels")) * g
        x = exposure_curve(x, float(p.get("exposure") or 0))
        x = tone_curve(x, f("highlights"), f("shadows"), f("whites"), f("blacks"))
        x = contrast_curve(x, f("contrast"))
        curves.append(x)
    out = point_rgb(im, curves)
    out = saturate(out, 1.0 + f("saturation"))
    out = vibrance(out, f("vibrance"))
    out = vignette(out, f("vignette"))
    alpha = out.getchannel("A") if out.mode == "RGBA" else None
    clarity = f("clarity")
    if clarity:
        r = max(2.0, max(out.size) / 60.0)
        rgb = out.convert("RGB")
        if clarity > 0:
            rgb = rgb.filter(ImageFilter.UnsharpMask(radius=r, percent=int(60 * clarity), threshold=2))
        else:
            rgb = Image.blend(rgb, rgb.filter(ImageFilter.GaussianBlur(r * 0.5)), min(1.0, -clarity * 0.6))
        out = _keep_alpha(rgb, alpha)
    sharpen = f("sharpen")
    if sharpen > 0:
        rgb = out.convert("RGB").filter(ImageFilter.UnsharpMask(radius=max(0.4, 1.1 * max(scale, 0.35)), percent=int(160 * sharpen), threshold=2))
        out = _keep_alpha(rgb, alpha)
    return out


# ---------------------------------------------------------------- filters


def _split(shadow_rgb, highlight_rgb, amount):
    """Per-channel curves that tint shadows and highlights (a split tone)."""
    sh = np.array(shadow_rgb, dtype=np.float64)
    hi = np.array(highlight_rgb, dtype=np.float64)
    return [X + ((sh[i] * (1.0 - X) + hi[i] * X) - 0.5) * amount for i in range(3)]


LOOKS = {
    # grey: drop the colour first; sat: saturation factor; curve(x, channel); vignette
    "vivid": {"sat": 1.32, "curve": lambda x, i: contrast_curve(x, 0.18)},
    "warm": {"sat": 1.06, "curve": lambda x, i: x * (1.088, 0.987, 0.912)[i]},
    "cool": {"curve": lambda x, i: x * (0.912, 1.006, 1.088)[i]},
    "mono": {"grey": True},
    "noir": {"grey": True, "curve": lambda x, i: contrast_curve(tone_curve(x, -0.3, -0.2, 0.2, -0.5), 0.55)},
    "sepia": {"grey": True, "curve": lambda x, i: (x * 1.07 + 0.08, x * 0.93 + 0.04, x * 0.72)[i]},
    "fade": {"sat": 0.75, "curve": lambda x, i: 0.08 + x * 0.86},
    "vintage": {"sat": 0.7, "curve": lambda x, i: _split((0.42, 0.45, 0.62), (0.66, 0.58, 0.42), 0.35)[i][np.clip((0.06 + x * 0.88) * 255, 0, 255).astype(int)], "vignette": 0.35},
    "chrome": {"sat": 1.15, "curve": lambda x, i: _split((0.4, 0.47, 0.55), (0.6, 0.55, 0.45), 0.18)[i][np.clip(contrast_curve(x, 0.2) * 255, 0, 255).astype(int)]},
    "matte": {"curve": lambda x, i: _split((0.45, 0.52, 0.48), (0.55, 0.5, 0.48), 0.12)[i][np.clip(contrast_curve(0.07 + x * 0.88, -0.1) * 255, 0, 255).astype(int)]},
    "dramatic": {"sat": 0.75, "curve": lambda x, i: contrast_curve(tone_curve(x, -0.4, 0.35, 0.0, -0.25), 0.45)},
    "soft": {"curve": lambda x, i: contrast_curve(tone_curve(x, -0.2, 0.25, 0.0, 0.1), -0.25)},
}


def filter_image(im, name, strength):
    spec = LOOKS.get(name)
    if spec is None:
        raise ValueError("unknown filter " + repr(name) + ". Filters: " + ", ".join(FILTERS))
    s = max(0.0, min(1.0, float(strength)))
    if s <= 0:
        return im
    alpha = im.getchannel("A") if im.mode == "RGBA" else None
    rgb = im.convert("RGB")
    out = rgb.convert("L").convert("RGB") if spec.get("grey") else rgb
    out = saturate(out, spec.get("sat", 1.0))
    if spec.get("curve"):
        out = out.point(_lut([spec["curve"](X, i) for i in range(3)]))
    if spec.get("vignette"):
        out = vignette(out, spec["vignette"])
    out = Image.blend(rgb, out, s) if s < 1 else out
    return _keep_alpha(out, alpha)


def auto_params(im):
    """Auto: levels from the 0.4 / 99.6 % luma points, a gentle midtone
    gamma and a grey-world white balance, as Adjust sliders."""
    small = im.convert("RGB").copy()
    small.thumbnail((640, 640))
    a = np.asarray(small, dtype=np.float32) / 255.0
    g = luma(a).ravel()
    lo, hi = np.percentile(g, 0.4), np.percentile(g, 99.6)
    black = int(max(0, min(60, round(lo * 255 * 0.9))))
    white = int(max(190, min(255, round(hi * 255 + (255 - hi * 255) * 0.15))))
    stretched = np.clip((g - black / 255.0) / max(1e-3, (white - black) / 255.0), 0, 1)
    mean = float(np.median(stretched))
    gamma = 1.0
    if 0.05 < mean < 0.95:
        # levels apply a ** (1 / gamma); this gamma takes the median to 0.46.
        gamma = float(np.clip(np.log(mean) / np.log(0.46), 0.7, 1.5))
    avg = a.reshape(-1, 3).mean(axis=0)
    temp = float(np.clip((avg[2] - avg[0]) / max(1e-3, avg.mean()) * 1.6, -0.5, 0.5))
    tint = float(np.clip((avg[1] - (avg[0] + avg[2]) / 2) / max(1e-3, avg.mean()) * 2.0, -0.4, 0.4))
    out = {"levels": {"black": black, "white": white, "gamma": round(gamma, 2)}}
    if abs(temp) > 0.03:
        out["temperature"] = int(round(temp * 100))
    if abs(tint) > 0.03:
        out["tint"] = int(round(tint * 100))
    sat = float((a.max(axis=-1) - a.min(axis=-1)).mean())
    if sat < 0.18:
        out["vibrance"] = 15
    return out

