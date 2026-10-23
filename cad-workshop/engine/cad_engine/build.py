"""Running a feature tree, with a cache per feature.

The cache key of feature k is a hash of the key of feature k-1, feature k's
canonical JSON and the engine version (plus the content hash of any file it
imports), so editing feature k reuses the built states of features 1 to k-1.
A suppressed feature leaves the state as it is, so it leaves the key as it is.
"""

import hashlib
import json
import os
import time
from collections import OrderedDict

from . import ENGINE_VERSION, features, geom, measure, mesh, render
from .errors import CadError
from .state import State
from .topology import key_creators, topology

MAX_STATES = 800
_cache = OrderedDict()


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _key(prev, feature, ctx):
    h = hashlib.sha1()
    h.update(prev.encode("utf-8"))
    h.update(canonical({"name": feature.get("name"), "kind": feature.get("kind"), "params": feature.get("params") or {}}).encode("utf-8"))
    if feature.get("kind") == "import_step":
        asset = (feature.get("params") or {}).get("asset")
        h.update(str(ctx.get("asset_hashes", {}).get(asset, "")).encode("utf-8"))
    return h.hexdigest()


class Run:
    __slots__ = ("state", "results", "failed", "key", "ms", "cached")

    def __init__(self):
        self.state = State()
        self.results = []
        self.failed = None
        self.key = "cad-engine-" + ENGINE_VERSION
        self.ms = 0
        self.cached = 0


def run_tree(tree, ctx):
    """Build every active feature in order; stop at the first failure."""
    feats = tree.get("features") or []
    rollback = tree.get("rollback")
    run = Run()
    t0 = time.perf_counter()
    for i, f in enumerate(feats):
        name = f.get("name")
        if rollback is not None and i >= rollback:
            run.results.append({"name": name, "status": "rolled_back"})
            continue
        if run.failed is not None:
            run.results.append({"name": name, "status": "not_built"})
            continue
        if f.get("suppressed"):
            run.results.append({"name": name, "status": "suppressed"})
            continue
        key = _key(run.key, f, ctx)
        hit = _cache.get(key)
        if hit is not None:
            _cache.move_to_end(key)
            state, res = hit
            run.state = state
            run.key = key
            run.cached += 1
            run.results.append(dict(res, cached=True))
            continue
        t = time.perf_counter()
        try:
            state, warns = features.apply(run.state, f, ctx)
        except CadError as e:
            run.failed = e.to_dict(name)
            run.results.append({"name": name, "status": "error", "ms": _ms(t), "error": run.failed})
            continue
        except Exception as e:  # OCCT raises Standard_Failure subclasses on geometry it cannot handle
            run.failed = {"code": "kernel_failed", "feature": name, "message": "The kernel failed on this feature: " + _kernel_message(e) + ". Try different dimensions or references."}
            run.results.append({"name": name, "status": "error", "ms": _ms(t), "error": run.failed})
            continue
        res = {"name": name, "status": "warning" if warns else "ok", "ms": _ms(t)}
        if warns:
            res["warnings"] = warns
        _cache[key] = (state, res)
        if len(_cache) > MAX_STATES:
            _cache.popitem(last=False)
        run.state = state
        run.key = key
        run.results.append(res)
    run.ms = _ms(t0)
    return run


def _ms(t):
    return round((time.perf_counter() - t) * 1000.0, 1)


def _kernel_message(e):
    msg = str(e).strip()
    return msg if msg else type(e).__name__


def created_counts(state):
    """Faces in the result that each feature made (directly or as a copy)."""
    counts = {}
    for f in topology(state).faces:
        for c in set(key_creators(f.base)):
            counts[c] = counts.get(c, 0) + 1
    return counts


# ------------------------------------------------------------------ checks

CHECK_KINDS = ("bbox_x", "bbox_y", "bbox_z", "volume", "mass", "solid_count", "valid", "distance", "center_distance", "radius", "face_count", "fits_within", "area")


def run_checks(state, checks, density):
    out = []
    props = None
    for c in checks:
        cid = c.get("id")
        try:
            value = None
            kind = c.get("kind")
            if kind not in CHECK_KINDS:
                raise CadError("param_invalid", "unknown check kind " + repr(kind))
            if props is None:
                props = measure.properties(state, density)
            size = props["bbox"]["size"] if props["bbox"] else [0, 0, 0]
            if kind == "bbox_x":
                value = size[0]
            elif kind == "bbox_y":
                value = size[1]
            elif kind == "bbox_z":
                value = size[2]
            elif kind == "volume":
                value = props["volume_mm3"]
            elif kind == "area":
                value = props["area_mm2"]
            elif kind == "mass":
                if "mass_g" not in props:
                    raise CadError("param_invalid", "the part has no material density, so its mass is unknown")
                value = props["mass_g"]
            elif kind == "solid_count":
                value = props["solids"]
            elif kind == "face_count":
                value = len(topology(state).faces)
            elif kind == "valid":
                value = 1 if all(b.facts()["valid"] for b in state.bodies.values()) else 0
            elif kind == "distance":
                r = c.get("refs") or {}
                m = measure.measure(state, r.get("a"), r.get("b"))
                if "distance" not in m:
                    raise CadError("param_invalid", "no distance between these two")
                value = m["distance"]["min_mm"]
            elif kind == "center_distance":
                r = c.get("refs") or {}
                m = measure.measure(state, r.get("a"), r.get("b"))
                value = m.get("axis_distance_mm", m.get("center_distance_mm"))
                if value is None:
                    ca = m["a"].get("center")
                    cb = m["b"].get("center")
                    value = geom.norm(geom.sub(cb, ca))
            elif kind == "radius":
                r = c.get("refs") or {}
                m = measure.measure(state, r.get("a"))
                value = m["a"].get("radius")
                if value is None:
                    raise CadError("param_invalid", "the selected entity has no radius")
            elif kind == "fits_within":
                box = sorted(c.get("box") or [])
                if len(box) != 3:
                    raise CadError("param_invalid", "fits_within needs box [x, y, z]")
                dims = sorted(size)
                fits = all(dims[i] <= box[i] + 1e-6 for i in range(3))
                out.append({"id": cid, "result": "pass" if fits else "fail", "value": None, "detail": "size " + " x ".join(geom.fmt(x) for x in size) + " mm"})
                continue
            out.append({"id": cid, "result": _compare(c, value), "value": geom.rnd(value, 5)})
        except CadError as e:
            out.append({"id": cid, "result": "cannot_run", "value": None, "detail": e.message})
        except Exception as e:
            out.append({"id": cid, "result": "cannot_run", "value": None, "detail": "could not measure: " + _kernel_message(e)})
    return out


def _compare(c, value):
    op = c.get("op", "eq")
    target = c.get("target")
    tol = c.get("tolerance") or 0.0
    if op == "eq":
        return "pass" if abs(value - target) <= tol + 1e-9 else "fail"
    if op == "le":
        return "pass" if value <= target + tol + 1e-9 else "fail"
    if op == "ge":
        return "pass" if value >= target - tol - 1e-9 else "fail"
    if op == "between":
        hi = c.get("target_max")
        return "pass" if target - tol - 1e-9 <= value <= hi + tol + 1e-9 else "fail"
    return "cannot_run"


# --------------------------------------------------------------- build job


def build(job):
    """Run the tree and write the viewer mesh, topology and (optionally) a thumbnail."""
    ctx = job_ctx(job)
    run = run_tree(job.get("tree") or {}, ctx)
    out_dir = job["out_dir"]
    os.makedirs(out_dir, exist_ok=True)
    state = run.state
    topo = topology(state)
    m = mesh.tessellate(state, topo)
    bbox = geom.bbox_dict(geom.bbox_union([b.facts()["bbox"] for b in state.bodies.values()]))
    mesh.write_view(m, os.path.join(out_dir, "view.bin"), bbox)
    with open(os.path.join(out_dir, "topology.json"), "w", encoding="utf-8") as fh:
        json.dump(topo.to_json(), fh, separators=(",", ":"))
    files = {"view": "view.bin", "topology": "topology.json"}
    opts = job.get("options") or {}
    if opts.get("thumbnail") and state.bodies:
        render.thumbnail(m, os.path.join(out_dir, "thumb.png"))
        files["thumb"] = "thumb.png"
    summ = measure.summary(state, topo)
    density = opts.get("density")
    if density:
        summ["mass_g"] = geom.rnd(summ["volume_mm3"] / 1000.0 * density, 4)
    counts = created_counts(state)
    for r in run.results:
        if r["status"] in ("ok", "warning"):
            r["faces"] = counts.get(r["name"], 0)
    checks = run_checks(state, opts.get("checks") or [], density) if opts.get("checks") else []
    return {
        "status": "failed" if run.failed else ("warning" if any(r["status"] == "warning" for r in run.results) else "ok"),
        "error": run.failed,
        "features": run.results,
        "summary": summ,
        "files": files,
        "triangles": mesh.triangle_count(m),
        "cached": run.cached,
        "build_ms": run.ms,
        "checks": checks,
    }


def job_ctx(job):
    assets = job.get("assets") or {}
    return {
        "assets": {k: v.get("path") for k, v in assets.items()},
        "asset_hashes": {k: v.get("hash") for k, v in assets.items()},
    }


def state_for(job):
    """The built state of a job's tree (fails if the tree does not build)."""
    run = run_tree(job.get("tree") or {}, job_ctx(job))
    return run
