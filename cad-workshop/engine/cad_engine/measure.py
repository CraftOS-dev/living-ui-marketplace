"""Exact measurements from the kernel: properties, distances, angles, checks."""

import math

from OCP.BRepAlgoAPI import BRepAlgoAPI_Common
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepExtrema import BRepExtrema_DistShapeShape

from . import geom, refs
from .errors import invalid
from .topology import topology


def body_props(body, density):
    f = body.facts()
    vol = f["volume"]
    out = {
        "name": body.name,
        "volume_mm3": geom.rnd(vol, 4),
        "area_mm2": geom.rnd(f["area"], 4),
        "bbox": geom.bbox_dict(f["bbox"]),
        "center_of_mass": geom.rnd3(f["com"], 4),
        "solids": f["solids"],
        "faces": body.fmap.Extent(),
    }
    if density is not None and density > 0:
        out["mass_g"] = geom.rnd(vol / 1000.0 * density, 4)
    return out


def properties(state, density=None):
    bodies = [body_props(b, density) for b in state.bodies.values()]
    total_v = sum(b["volume_mm3"] for b in bodies)
    total_a = sum(b["area_mm2"] for b in bodies)
    boxes = [b.facts()["bbox"] for b in state.bodies.values()]
    com = (0.0, 0.0, 0.0)
    if total_v > 0:
        acc = [0.0, 0.0, 0.0]
        for b in bodies:
            for i in range(3):
                acc[i] += b["center_of_mass"][i] * b["volume_mm3"]
        com = (acc[0] / total_v, acc[1] / total_v, acc[2] / total_v)
    out = {
        "volume_mm3": geom.rnd(total_v, 4),
        "area_mm2": geom.rnd(total_a, 4),
        "bbox": geom.bbox_dict(geom.bbox_union(boxes)),
        "center_of_mass": geom.rnd3(com, 4),
        "bodies": bodies,
        "solids": sum(b["solids"] for b in bodies),
    }
    if density is not None and density > 0:
        out["mass_g"] = geom.rnd(total_v / 1000.0 * density, 4)
        out["density_g_cm3"] = density
    return out


def summary(state, topo):
    p = properties(state)
    valid = all(b.facts()["valid"] for b in state.bodies.values())
    return {
        "volume_mm3": p["volume_mm3"],
        "area_mm2": p["area_mm2"],
        "bbox": p["bbox"],
        "center_of_mass": p["center_of_mass"],
        "bodies": [{"name": b["name"], "volume_mm3": b["volume_mm3"], "bbox": b["bbox"], "solids": b["solids"]} for b in p["bodies"]],
        "solids": p["solids"],
        "faces": len(topo.faces),
        "edges": len(topo.edges),
        "valid": valid,
    }


# --------------------------------------------------------------- measure


def _entity(state, spec, label):
    """A reference or a bare key, resolved to exactly one face, edge or body."""
    topo = topology(state)
    if isinstance(spec, str):
        if spec in state.bodies:
            return "body", spec, state.bodies[spec].shape
        if spec in topo.face_by_key:
            f = topo.face_by_key[spec]
            return "face", f, f.shape
        if spec in topo.edge_by_key:
            e = topo.edge_by_key[spec]
            return "edge", e, e.shape
        res = None
        for kind in ("faces", "edges"):
            try:
                r = refs.resolve(state, {kind: {"keys": [spec]}, "expect": 1}, label)
                res = r
                break
            except Exception:
                continue
        if res is None:
            raise invalid(label + ": nothing has the key " + repr(spec) + ". Use model.describe to list keys.")
    else:
        res = refs.resolve(state, spec, label)
        if res.count() != 1:
            raise invalid(label + " must select exactly one face, edge or body (found " + str(res.count()) + ")")
    if res.kind == "faces":
        f = res.faces[0]
        return "face", f, f.shape
    if res.kind == "edges":
        e = res.edges[0]
        return "edge", e, e.shape
    b = res.bodies[0]
    return "body", b, state.bodies[b].shape


def _describe(kind, info, state, topo):
    if kind == "face":
        return {"kind": "face", **topo.face_json(info)}
    if kind == "edge":
        return {"kind": "edge", **topo.edge_json(info)}
    body = state.bodies[info]
    return {"kind": "body", **body_props(body, None)}


def measure(state, a, b=None):
    topo = topology(state)
    ka, ia, sa = _entity(state, a, "a")
    out = {"a": _describe(ka, ia, state, topo)}
    if b is None:
        return out
    kb, ib, sb = _entity(state, b, "b")
    out["b"] = _describe(kb, ib, state, topo)
    d = BRepExtrema_DistShapeShape(sa, sb)
    if d.IsDone() and d.NbSolution() > 0:
        p1 = geom.tup(d.PointOnShape1(1))
        p2 = geom.tup(d.PointOnShape2(1))
        delta = geom.sub(p2, p1)
        out["distance"] = {
            "min_mm": geom.rnd(d.Value(), 5),
            "from": geom.rnd3(p1, 4),
            "to": geom.rnd3(p2, 4),
            "dx": geom.rnd(delta[0], 4),
            "dy": geom.rnd(delta[1], 4),
            "dz": geom.rnd(delta[2], 4),
        }
    va = _direction_of(ka, ia)
    vb = _direction_of(kb, ib)
    if va is not None and vb is not None:
        c = max(-1.0, min(1.0, geom.dot(va, vb)))
        ang = math.degrees(math.acos(c))
        out["angle_deg"] = geom.rnd(ang, 4)
        if ka == "face" and kb == "face" and ia.normal is not None and ib.normal is not None and abs(abs(c) - 1) < 1e-9:
            gap = abs(geom.dot(geom.sub(ib.center, ia.center), ia.normal))
            out["parallel_gap_mm"] = geom.rnd(gap, 5)
    if ka == "edge" and kb == "edge" and ia.axis is not None and ib.axis is not None:
        cdist = geom.norm(geom.sub(ia.axis[0], ib.axis[0]))
        out["center_distance_mm"] = geom.rnd(cdist, 5)
    if ka == "face" and kb == "face" and ia.axis is not None and ib.axis is not None:
        o1, d1 = ia.axis
        o2, d2 = ib.axis
        if abs(abs(geom.dot(d1, d2)) - 1) < 1e-9:
            v = geom.sub(o2, o1)
            perp = geom.sub(v, geom.mul(d1, geom.dot(v, d1)))
            out["axis_distance_mm"] = geom.rnd(geom.norm(perp), 5)
    return out


def _direction_of(kind, info):
    if kind == "face" and info.normal is not None:
        return info.normal
    if kind == "edge" and info.direction is not None:
        return info.direction
    if kind == "face" and info.axis is not None:
        return info.axis[1]
    return None


# ----------------------------------------------------------------- check


def check(state):
    topo = topology(state)
    bodies = []
    ok = True
    for name, body in state.bodies.items():
        an = BRepCheck_Analyzer(body.shape)
        valid = an.IsValid()
        ss = geom.solids(body.shape)
        closed = True
        for s in ss:
            if geom.volume(s) <= 0:
                closed = False
        tiny_faces = [f.key for f in topo.faces if f.body == name and f.area < 1e-3]
        short_edges = [e.key for e in topo.edges if e.body == name and e.length < 1e-3]
        problems = []
        if not valid:
            problems.append("The kernel reports this body as invalid geometry.")
        if not closed:
            problems.append("A solid has no positive volume (it is inside out or open).")
        if len(ss) > 1:
            problems.append("The body is " + str(len(ss)) + " separate solids.")
        if tiny_faces:
            problems.append(str(len(tiny_faces)) + " sliver face(s) smaller than 0.001 mm2.")
        if short_edges:
            problems.append(str(len(short_edges)) + " edge(s) shorter than 0.001 mm.")
        if not valid or not closed:
            ok = False
        bodies.append(
            {
                "name": name,
                "valid": valid,
                "closed": closed,
                "solids": len(ss),
                "sliver_faces": tiny_faces[:10],
                "short_edges": short_edges[:10],
                "problems": problems,
            }
        )
    return {"ok": ok and all(not b["problems"] for b in bodies), "valid": ok, "bodies": bodies, "interference": interference(state)}


def interference(state):
    names = list(state.bodies.keys())
    out = []
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a = state.bodies[names[i]].shape
            b = state.bodies[names[j]].shape
            ba = geom.bbox(a, optimal=False)
            bb = geom.bbox(b, optimal=False)
            if ba is None or bb is None:
                continue
            if any(ba[1][k] < bb[0][k] or bb[1][k] < ba[0][k] for k in range(3)):
                continue
            com = BRepAlgoAPI_Common(a, b)
            if not com.IsDone():
                continue
            v = geom.volume(com.Shape())
            if v > 1e-6:
                out.append({"a": names[i], "b": names[j], "overlap_mm3": geom.rnd(v, 4)})
    return out


def resolve(state, ref):
    res = refs.resolve(state, ref, "ref", require=False)
    topo = topology(state)
    lo_hi = None
    e = ref.get("expect") if isinstance(ref, dict) else None
    if isinstance(e, int) and not isinstance(e, bool):
        lo_hi = (e, e)
    elif isinstance(e, dict):
        lo_hi = (e.get("min", 1), e.get("max"))
    count = res.count()
    meets = True
    if lo_hi is not None:
        lo, hi = lo_hi
        meets = count >= (lo or 0) and (hi is None or count <= hi)
    elif count == 0:
        meets = False
    items = []
    if res.kind == "faces":
        items = [topo.face_json(f) for f in res.faces]
    elif res.kind == "edges":
        items = [topo.edge_json(x) for x in res.edges]
    else:
        items = [{"name": b} for b in res.bodies]
    return {"kind": res.kind, "count": count, "meets_expect": meets, "keys": res.keys(), "items": items[:200]}
