"""Background removal on this computer (onnxruntime on the CPU).

Two pinned models from the rembg project (MIT code, Apache-2.0 weights),
each named explicitly so nothing else is ever fetched:

    fast      u2netp             4.6 MB, about 1.5 s for 12 MP
    detailed  isnet-general-use  179 MB, about 4 s for 12 MP

The models see a 320 or 1024 px square; the mask they return is scaled
back to the image and kept as a file, so re-rendering never runs a model.
Pre- and post-processing follow rembg's sessions.
"""

import os

import numpy as np
from PIL import Image

from .errors import ImgError

MODELS = {
    "fast": {"file": "u2netp.onnx", "size": 320, "mean": (0.485, 0.456, 0.406), "std": (0.229, 0.224, 0.225)},
    "detailed": {"file": "isnet-general-use.onnx", "size": 1024, "mean": (0.5, 0.5, 0.5), "std": (1.0, 1.0, 1.0)},
}

_sessions = {}


def session(models_dir, model):
    spec = MODELS.get(model)
    if spec is None:
        raise ImgError("param_invalid", "model must be fast or detailed")
    path = os.path.join(models_dir, spec["file"])
    if not os.path.exists(path):
        raise ImgError("model_missing", "The " + model + " background model is not installed. Install it in Settings (Background removal).")
    if path not in _sessions:
        try:
            import onnxruntime as ort
        except ImportError:
            raise ImgError("model_missing", "Background removal is not installed. Install it in Settings (Background removal).")
        opts = ort.SessionOptions()
        opts.log_severity_level = 3
        _sessions[path] = ort.InferenceSession(path, sess_options=opts, providers=["CPUExecutionProvider"])
    return _sessions[path], spec


def mask(im, models_dir, model="fast"):
    """A grey mask (255 = keep) the size of im."""
    sess, spec = session(models_dir, model)
    side = spec["size"]
    rgb = im.convert("RGB").resize((side, side), Image.Resampling.LANCZOS)
    a = np.asarray(rgb, dtype=np.float32)
    a = a / max(float(a.max()), 1e-6)
    mean = np.array(spec["mean"], dtype=np.float32)
    std = np.array(spec["std"], dtype=np.float32)
    a = (a - mean) / std
    x = a.transpose(2, 0, 1)[None, ...].astype(np.float32)
    name = sess.get_inputs()[0].name
    out = sess.run(None, {name: x})[0]
    pred = out[:, 0, :, :] if out.ndim == 4 else out
    lo, hi = float(pred.min()), float(pred.max())
    pred = (pred - lo) / max(hi - lo, 1e-6)
    m = Image.fromarray((np.squeeze(pred) * 255.0).clip(0, 255).astype(np.uint8), "L")
    return m.resize(im.size, Image.Resampling.LANCZOS)


def mask_stats(m):
    a = np.asarray(m, dtype=np.uint8)
    kept = float((a >= 128).mean())
    soft = float(((a > 16) & (a < 240)).mean())
    return {"kept_pct": round(kept * 100, 1), "soft_edge_pct": round(soft * 100, 1)}
