"""References: typed queries for faces, edges or bodies.

    {"faces": {"keys": ["ext1.cap_end"]}, "expect": 1}
    {"edges": {"between": [{"keys": ["ext1.cap_end"]}, {"created_by": "ext1"}]}, "expect": 4}
    {"edges": {"created_by": "ext1", "type": "line", "parallel_to": "Z"}, "expect": 4}
    {"faces": {"normal": "+Z", "extreme": "+Z"}, "expect": 1}
    {"bodies": ["ext1"]}

A selector's fields all have to hold (AND); `any` takes the union of
selectors. A key matches an entity's exact key or its base key (the key
without `~n`). The result is checked against `expect` (a count, or
{"min": a, "max": b}); a different count fails with stale_reference, the
count found and up to ten candidate keys. Nothing is ever re-bound by
guessing.
"""

from . import geom
from .errors import CadError, invalid
from .topology import edge_key, key_creators, key_role, parallel, perpendicular, strip_ordinal, topology

FACE_FIELDS = ("keys", "created_by", "role", "role_prefix", "body", "type", "normal", "parallel_to", "perpendicular_to", "radius", "extreme", "sort", "take", "any", "not_keys")
EDGE_FIELDS = ("keys", "created_by", "body", "type", "parallel_to", "perpendicular_to", "radius", "convexity", "of_faces", "between", "extreme", "sort", "take", "any", "not_keys")
FACE_TYPES = ("plane", "cylinder", "cone", "sphere", "torus", "bspline", "revolution", "extrusion", "other")
EDGE_TYPES = ("line", "circle", "ellipse", "curve")
CONVEXITY = ("convex", "concave", "smooth")


class Resolved:
    __slots__ = ("kind", "faces", "edges", "bodies")

    def __init__(self, kind):
        self.kind = kind
        self.faces = []
        self.edges = []
        self.bodies = []

    def items(self):
        return {"faces": self.faces, "edges": self.edges, "bodies": self.bodies}[self.kind]

    def keys(self):
        if self.kind == "bodies":
            return list(self.bodies)
        return [x.key for x in self.items()]

    def count(self):
        return len(self.items())


def _norm_key(k):
    """An edge key with its two face keys in sorted order (callers may write either order)."""
    if "|" in k:
        a, b = k.split("|", 1)
        return edge_key(a, b)
    return k


def _str_list(v, label):
    if isinstance(v, str):
        return [v]
    if isinstance(v, list) and all(isinstance(x, str) for x in v):
        return v
    raise invalid(label + " must be text or a list of text")


def _center(x):
    return x.center


def _match_keys(items, keys, is_edge):
    wanted = set(_norm_key(k) for k in keys) if is_edge else set(keys)
    out = []
    for x in items:
        if x.key in wanted or x.base in wanted:
            out.append(x)
    return out


def _select(topo, kind, sel, label):
    if not isinstance(sel, dict):
        raise invalid(label + " must be an object of selector fields")
    fields = FACE_FIELDS if kind == "faces" else EDGE_FIELDS
    for k in sel:
        if k not in fields:
            raise invalid(label + " has an unknown field " + repr(k) + ". Fields: " + ", ".join(fields))
    items = list(topo.faces if kind == "faces" else topo.edges)
    is_edge = kind == "edges"

    if "any" in sel:
        subs = sel["any"]
        if not isinstance(subs, list) or not subs:
            raise invalid(label + ".any must be a non-empty list of selectors")
        seen = set()
        union = []
        for i, s in enumerate(subs):
            for x in _select(topo, kind, s, label + ".any[" + str(i) + "]"):
                if x.i not in seen:
                    seen.add(x.i)
                    union.append(x)
        keep = set(x.i for x in union)
        items = [x for x in items if x.i in keep]
    if "keys" in sel:
        items = _match_keys(items, _str_list(sel["keys"], label + ".keys"), is_edge)
    if "not_keys" in sel:
        drop = set(x.i for x in _match_keys(items, _str_list(sel["not_keys"], label + ".not_keys"), is_edge))
        items = [x for x in items if x.i not in drop]
    if "created_by" in sel:
        by = set(_str_list(sel["created_by"], label + ".created_by"))
        if is_edge:
            items = [e for e in items if any(c in by for f in e.faces for c in key_creators(topo.faces[f].base))]
        else:
            items = [f for f in items if any(c in by for c in key_creators(f.base))]
    if "role" in sel:
        roles = set(_str_list(sel["role"], label + ".role"))
        items = [f for f in items if key_role(f.base).split("@", 1)[0] in roles]
    if "role_prefix" in sel:
        pre = _str_list(sel["role_prefix"], label + ".role_prefix")
        items = [f for f in items if any(key_role(f.base).startswith(p) for p in pre)]
    if "body" in sel:
        names = set(_str_list(sel["body"], label + ".body"))
        items = [x for x in items if x.body in names]
    if "type" in sel:
        allowed = FACE_TYPES if kind == "faces" else EDGE_TYPES
        types = _str_list(sel["type"], label + ".type")
        for t in types:
            if t not in allowed:
                raise invalid(label + ".type must be one of: " + ", ".join(allowed))
        items = [x for x in items if x.type in types]
    if "normal" in sel:
        d = geom.axis_vector(sel["normal"], label + ".normal")
        items = [f for f in items if f.normal is not None and geom.dot(f.normal, d) > 1 - 1e-6]
    if "parallel_to" in sel:
        d = geom.axis_vector(sel["parallel_to"], label + ".parallel_to")
        if is_edge:
            items = [e for e in items if e.direction is not None and parallel(e.direction, d)]
        else:
            items = [f for f in items if f.normal is not None and parallel(f.normal, d)]
    if "perpendicular_to" in sel:
        d = geom.axis_vector(sel["perpendicular_to"], label + ".perpendicular_to")
        if is_edge:
            items = [e for e in items if e.direction is not None and perpendicular(e.direction, d)]
        else:
            items = [f for f in items if f.normal is not None and perpendicular(f.normal, d)]
    if "radius" in sel:
        r = geom.num(sel, "radius", positive=True, where=label)
        tol = max(1e-4, r * 1e-4)
        items = [x for x in items if x.radius is not None and abs(x.radius - r) <= tol]
    if "convexity" in sel:
        if not is_edge:
            raise invalid(label + ".convexity applies to edges")
        c = geom.choice(sel, "convexity", CONVEXITY, where=label)
        items = [e for e in items if e.convexity == c]
    if "of_faces" in sel:
        fs = set(f.i for f in _select(topo, "faces", sel["of_faces"], label + ".of_faces"))
        items = [e for e in items if any(j in fs for j in e.faces)]
    if "between" in sel:
        b = sel["between"]
        if not isinstance(b, list) or len(b) != 2:
            raise invalid(label + ".between must be a list of two face selectors")
        A = set(f.i for f in _select(topo, "faces", b[0], label + ".between[0]"))
        B = set(f.i for f in _select(topo, "faces", b[1], label + ".between[1]"))
        items = [e for e in items if (e.faces[0] in A and e.faces[1] in B) or (e.faces[1] in A and e.faces[0] in B)]
    if "extreme" in sel:
        d = geom.axis_vector(sel["extreme"], label + ".extreme")
        if items:
            top = max(geom.dot(_center(x), d) for x in items)
            items = [x for x in items if geom.dot(_center(x), d) >= top - 1e-6]
    if "sort" in sel:
        d = geom.axis_vector(sel["sort"], label + ".sort")
        items = sorted(items, key=lambda x: (-geom.dot(_center(x), d), x.key))
    if "take" in sel:
        n = int(geom.num(sel, "take", integer=True, minimum=1, where=label))
        items = items[:n]
    return items


def _expect(ref, label):
    e = ref.get("expect")
    if e is None:
        return 1, None
    if isinstance(e, bool):
        raise invalid(label + ".expect must be a count or {\"min\": a, \"max\": b}")
    if isinstance(e, (int, float)):
        n = int(geom.num(ref, "expect", integer=True, minimum=1, where=label))
        return n, n
    if isinstance(e, dict):
        lo = int(geom.num(e, "min", default=1, integer=True, minimum=0, where=label + ".expect"))
        hi = e.get("max")
        hi = None if hi is None else int(geom.num(e, "max", integer=True, minimum=lo, where=label + ".expect"))
        return lo, hi
    raise invalid(label + ".expect must be a count or {\"min\": a, \"max\": b}")


def _nearby(topo, kind, ref_sel, found):
    """Candidate keys to show when a reference misses: what it found, else
    what the same features made."""
    if found:
        return [x.key for x in found[:10]]
    feats = set()
    if isinstance(ref_sel, dict):
        for k in ref_sel.get("keys", []) if isinstance(ref_sel.get("keys"), list) else []:
            for part in _norm_key(k).split("|"):
                feats.add(strip_ordinal(part).split(".", 1)[0])
        cb = ref_sel.get("created_by")
        if isinstance(cb, str):
            feats.add(cb)
        elif isinstance(cb, list):
            feats.update(x for x in cb if isinstance(x, str))
    pool = topo.faces if kind == "faces" else topo.edges
    out = []
    for x in pool:
        creators = key_creators(x.base) if kind == "faces" else [c for f in x.faces for c in key_creators(topo.faces[f].base)]
        if feats & set(creators):
            out.append(x.key)
        if len(out) >= 10:
            break
    return out


def resolve(state, ref, label="reference", kind=None, require=True):
    """Resolve a reference against a state. `kind` restricts it to faces, edges or bodies."""
    if not isinstance(ref, dict):
        raise invalid(label + " must be a reference object like {\"faces\": {\"keys\": [\"ext1.cap_end\"]}, \"expect\": 1}")
    kinds = [k for k in ("faces", "edges", "bodies") if k in ref]
    if len(kinds) != 1:
        raise invalid(label + " needs exactly one of faces, edges or bodies")
    rk = kinds[0]
    if kind is not None and rk not in (kind if isinstance(kind, tuple) else (kind,)):
        want = kind if isinstance(kind, str) else " or ".join(kind)
        raise invalid(label + " must select " + want)
    for k in ref:
        if k not in ("faces", "edges", "bodies", "expect"):
            raise invalid(label + " has an unknown field " + repr(k) + " (use faces, edges or bodies, and expect)")
    lo, hi = _expect(ref, label)
    res = Resolved(rk)
    if rk == "bodies":
        names = _str_list(ref["bodies"], label + ".bodies")
        missing = [n for n in names if n not in state.bodies]
        if missing:
            raise CadError(
                "stale_reference",
                label + ": no body named " + ", ".join(missing) + ". Bodies: " + (", ".join(state.bodies) or "none") + ".",
                found=0,
                expected=len(names),
                candidates=list(state.bodies)[:10],
            )
        res.bodies = names
        count = len(names)
    else:
        topo = topology(state)
        found = _select(topo, rk, ref[rk], label + "." + rk)
        if rk == "faces":
            res.faces = found
        else:
            res.edges = found
        count = len(found)
    if require and (count < lo or (hi is not None and count > hi)):
        want = str(lo) if hi == lo else ("at least " + str(lo) if hi is None else str(lo) + " to " + str(hi))
        noun = rk if count != 1 else rk[:-1]
        cands = res.bodies if rk == "bodies" else _nearby(topology(state), rk, ref.get(rk), res.items())
        raise CadError(
            "stale_reference",
            label + " expected " + want + " " + (rk if want != "1" else rk[:-1]) + ", found " + str(count) + " " + noun + ". The model may have changed since the reference was made; pick the " + rk + " again or adjust the selector.",
            found=count,
            expected=want,
            candidates=cands,
        )
    return res


def one_face(state, ref, label, planar=False):
    res = resolve(state, ref, label, kind="faces")
    if res.count() != 1:
        raise CadError("stale_reference", label + " must select exactly 1 face, found " + str(res.count()) + ".", found=res.count(), expected="1", candidates=res.keys()[:10])
    f = res.faces[0]
    if planar and f.type != "plane":
        raise invalid(label + " must be a flat face; " + f.key + " is a " + f.type + ".")
    return f
