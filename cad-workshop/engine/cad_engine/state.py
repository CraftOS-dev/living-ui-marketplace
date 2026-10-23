"""Model state and face naming.

A state is what the tree has built so far: named bodies (each one OCCT
shape), the sketches, and the material each feature added or removed (so a
pattern or mirror can repeat it). Every face of every body carries a base key
that says which feature made it and in what role (`ext1.cap_end`,
`ext1.side.r1.top`, `fil1.blend.3`). Keys travel through later features by
OCCT's own history (Modified, Generated, IsDeleted), never by guessing.
"""

from OCP.TopAbs import TopAbs_FACE
from OCP.TopExp import TopExp
from OCP.OCP.collections import IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher as ShapeMap

from . import geom
from .errors import CadError


def face_map(shape):
    m = ShapeMap()
    TopExp.MapShapes_s(shape, TopAbs_FACE, m)
    return m


def shape_map(shape, kind):
    m = ShapeMap()
    TopExp.MapShapes_s(shape, kind, m)
    return m


class Body:
    """A named solid (or a compound of solids) with one base key per face."""

    __slots__ = ("name", "shape", "fmap", "keys", "origin", "_facts")

    def __init__(self, name, shape, keys, origin):
        self.name = name
        self.shape = shape
        self.fmap = face_map(shape)
        if len(keys) != self.fmap.Extent():
            raise RuntimeError("face keys out of step with the shape")
        self.keys = list(keys)
        # The feature that created the body.
        self.origin = origin
        self._facts = None

    def facts(self):
        """Volume, centre of mass, area, exact bounding box and validity,
        computed once (a body never changes after it is made)."""
        if self._facts is None:
            vol, com = geom.volume_props(self.shape)
            self._facts = {
                "volume": vol,
                "com": com,
                "area": geom.area(self.shape),
                "bbox": geom.bbox(self.shape),
                "valid": geom.is_valid(self.shape),
                "solids": len(geom.solids(self.shape)),
            }
        return self._facts

    def face_list(self):
        return [(self.fmap.FindKey(i + 1), self.keys[i]) for i in range(len(self.keys))]

    def key_of(self, face):
        i = self.fmap.FindIndex(face)
        return self.keys[i - 1] if i > 0 else None


class Tool:
    """The material a feature added or removed, kept so it can be repeated."""

    __slots__ = ("shape", "keys", "operation", "targets")

    def __init__(self, shape, keys, operation, targets):
        self.shape = shape
        self.keys = keys
        self.operation = operation
        self.targets = targets


class State:
    __slots__ = ("bodies", "sketches", "tools", "_topo")

    def __init__(self, bodies=None, sketches=None, tools=None):
        self.bodies = dict(bodies or {})
        self.sketches = dict(sketches or {})
        self.tools = dict(tools or {})
        # The topology of this state, computed on first use (topology.py).
        self._topo = None

    def copy(self):
        return State(self.bodies, self.sketches, self.tools)

    def body_names(self):
        return list(self.bodies.keys())

    def target_bodies(self, params, feature, allow_all=True):
        """The bodies a feature works on: `target` (a name or a list), else the only body."""
        t = params.get("target")
        names = self.body_names()
        if t is None or t == "":
            if len(names) == 1:
                return [names[0]]
            if len(names) == 0:
                raise CadError("param_invalid", "There is no body yet. Start with a feature whose operation is new.")
            raise CadError(
                "param_invalid",
                "This part has " + str(len(names)) + " bodies, so " + feature + " needs a target: one of " + ", ".join(names) + ".",
                candidates=names,
            )
        wanted = [t] if isinstance(t, str) else t
        if not isinstance(wanted, list) or not all(isinstance(x, str) for x in wanted):
            raise CadError("param_invalid", "target must be a body name or a list of body names")
        if allow_all and wanted == ["*"]:
            return names
        for w in wanted:
            if w not in self.bodies:
                raise CadError("param_invalid", "No body named " + repr(w) + ". Bodies: " + (", ".join(names) or "none") + ".", candidates=names)
        return wanted


class History:
    """What an operation did to the faces it was given."""

    def modified(self, shape):
        return []

    def deleted(self, shape):
        return False


class OpHistory(History):
    """History of a BRepBuilderAPI_MakeShape (booleans, fillets, sweeps, shells)."""

    def __init__(self, op):
        self.op = op

    def modified(self, shape):
        try:
            return list(self.op.Modified(shape))
        except Exception:
            return []

    def deleted(self, shape):
        try:
            return bool(self.op.IsDeleted(shape))
        except Exception:
            return False


class ToolsHistory(History):
    """History of a BRepTools_History (ShapeUpgrade_UnifySameDomain)."""

    def __init__(self, hist):
        self.hist = hist

    def modified(self, shape):
        try:
            return list(self.hist.Modified(shape))
        except Exception:
            return []

    def deleted(self, shape):
        try:
            return bool(self.hist.IsRemoved(shape))
        except Exception:
            return False


class TransformHistory(History):
    def __init__(self, op):
        self.op = op

    def modified(self, shape):
        return [self.op.ModifiedShape(shape)]


def name_result(result, sources, history, generated, feature):
    """Base keys for every face of `result`.

    sources: [(face, key)] in priority order (earlier wins when several
    faces merge into one; the target body comes before the tool).
    generated: [(faces, key)] for faces the operation made from edges or
    vertices (fillet blends, sweep sides).
    Faces no history accounts for are named `<feature>.face.<n>` in a
    deterministic order (by position).
    """
    rmap = face_map(result)
    n = rmap.Extent()
    cand = [None] * n
    for prio, (f, k) in enumerate(sources):
        hits = []
        i = rmap.FindIndex(f)
        if i > 0:
            hits.append(i)
        elif not history.deleted(f):
            for nf in history.modified(f):
                j = rmap.FindIndex(nf)
                if j > 0:
                    hits.append(j)
        for j in hits:
            if cand[j - 1] is None or cand[j - 1][0] > prio:
                cand[j - 1] = (prio, k)
    base = len(sources)
    for gi, (gfaces, k) in enumerate(generated):
        for nf in gfaces:
            j = rmap.FindIndex(nf)
            if j > 0 and cand[j - 1] is None:
                cand[j - 1] = (base + gi, k)
    keys = [c[1] if c is not None else None for c in cand]
    unnamed = [i for i in range(n) if keys[i] is None]
    if unnamed:
        placed = []
        for i in unnamed:
            _, c = geom.surface_props(rmap.FindKey(i + 1))
            placed.append((tuple(round(x, 6) for x in c), i))
        placed.sort()
        for idx, (_, i) in enumerate(placed):
            keys[i] = feature + ".face." + str(idx + 1)
    return keys


def body_from(name, shape, sources, history, generated, feature, origin):
    keys = name_result(shape, sources, history, generated, feature)
    return Body(name, shape, keys, origin)
