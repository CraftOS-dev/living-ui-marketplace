"""Topology: every face and edge of a state with its key and its geometry.

Face key: the base key from the feature that made the face; when several
faces share a base key (a cut split a face), each gets `~n`, numbered by
position. Edge key: the keys of the two faces it joins, sorted and joined
with `|`, plus `~n` when two faces meet along several edges. Seam edges (a
face meeting itself, like a cylinder's seam) are not listed.
"""

from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.GeomAPI import GeomAPI_ProjectPointOnSurf
from OCP.GeomAbs import GeomAbs_Circle, GeomAbs_Cone, GeomAbs_Cylinder, GeomAbs_Sphere, GeomAbs_Torus
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_REVERSED
from OCP.TopExp import TopExp, TopExp_Explorer
from OCP.TopoDS import TopoDS
from OCP.OCP.collections import IndexedDataMap_TopoDS_Shape_List_TopoDS_Shape_TopTools_ShapeMapHasher as AncestorMap
from OCP.OCP.collections import IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher as ShapeMap

from . import geom


def key_feature(key):
    return key.split(".", 1)[0]


def key_role(key):
    head = key.split("~", 1)[0]
    parts = head.split(".", 1)
    return parts[1] if len(parts) > 1 else ""


def key_creators(key):
    """The feature that made a face and every pattern or mirror that copied it."""
    head = key.split("~", 1)[0]
    out = [head.split(".", 1)[0]]
    for part in head.split("@")[1:]:
        out.append(part.split(".", 1)[0])
    return out


def strip_ordinal(key):
    i = key.find("~")
    return key if i < 0 else key[:i]


def edge_key(a, b):
    return a + "|" + b if a <= b else b + "|" + a


class FaceInfo:
    __slots__ = ("i", "shape", "body", "key", "base", "type", "area", "center", "normal", "frame", "axis", "radius", "bbox")


class EdgeInfo:
    __slots__ = ("i", "shape", "body", "key", "base", "type", "length", "center", "direction", "radius", "axis", "faces", "convexity", "ends")


def _face_facts(fi, face):
    s = BRepAdaptor_Surface(face)
    t = s.GetType()
    fi.type = geom.FACE_TYPES.get(t, "other")
    fi.area, fi.center = geom.surface_props(face)
    fi.normal = None
    fi.frame = None
    fi.axis = None
    fi.radius = None
    if fi.type == "plane":
        pl = geom.plane_of(face)
        fi.normal = pl[1]
        # The frame a sketch on this face uses (features.f_sketch).
        fi.frame = geom.frame_for_normal(pl[0], pl[1], (1.0, 0.0, 0.0))
    elif t in (GeomAbs_Cylinder, GeomAbs_Cone, GeomAbs_Sphere, GeomAbs_Torus):
        if t == GeomAbs_Cylinder:
            c = s.Cylinder()
            fi.radius = c.Radius()
            ax = c.Axis()
        elif t == GeomAbs_Cone:
            c = s.Cone()
            fi.radius = c.RefRadius()
            ax = c.Axis()
        elif t == GeomAbs_Sphere:
            c = s.Sphere()
            fi.radius = c.Radius()
            ax = c.Position().Axis()
        else:
            c = s.Torus()
            fi.radius = c.MajorRadius()
            ax = c.Axis()
        o = ax.Location()
        d = ax.Direction()
        fi.axis = ((o.X(), o.Y(), o.Z()), (d.X(), d.Y(), d.Z()))
    fi.bbox = geom.bbox(face, optimal=False)


def _edge_facts(ei, edge):
    c = BRepAdaptor_Curve(edge)
    t = c.GetType()
    ei.type = geom.EDGE_TYPES.get(t, "curve")
    ei.length = geom.length(edge)
    ei.center = geom.edge_mid(edge)
    ei.ends = geom.edge_ends(edge)
    ei.direction = None
    ei.radius = None
    ei.axis = None
    if ei.type == "line":
        d = c.Line().Direction()
        ei.direction = (d.X(), d.Y(), d.Z())
    elif t == GeomAbs_Circle:
        circ = c.Circle()
        ei.radius = circ.Radius()
        o = circ.Location()
        d = circ.Axis().Direction()
        ei.axis = ((o.X(), o.Y(), o.Z()), (d.X(), d.Y(), d.Z()))


def _oriented_in(face, edge):
    ex = TopExp_Explorer(face, TopAbs_EDGE)
    while ex.More():
        e = ex.Current()
        if e.IsSame(edge):
            return TopoDS.Edge(e)
        ex.Next()
    return None


def convexity(edge, f1, f2):
    """convex, concave or smooth, from the two faces' normals at the edge's middle."""
    try:
        oe = _oriented_in(f1, edge)
        if oe is None:
            return "unknown"
        c = BRepAdaptor_Curve(oe)
        tm = (c.FirstParameter() + c.LastParameter()) / 2.0
        from OCP.gp import gp_Pnt, gp_Vec

        p = gp_Pnt()
        v = gp_Vec()
        c.D1(tm, p, v)
        tvec = (v.X(), v.Y(), v.Z())
        if oe.Orientation() == TopAbs_REVERSED:
            tvec = (-tvec[0], -tvec[1], -tvec[2])
        n1 = _normal_near(f1, p)
        n2 = _normal_near(f2, p)
        if n1 is None or n2 is None or geom.norm(tvec) < 1e-12:
            return "unknown"
        inward1 = geom.cross(n1, geom.unit(tvec))
        d = geom.dot(inward1, n2)
        if abs(geom.dot(n1, n2)) > 1 - 1e-6 and geom.dot(n1, n2) > 0:
            return "smooth"
        if d < -1e-6:
            return "convex"
        if d > 1e-6:
            return "concave"
        return "smooth"
    except Exception:
        return "unknown"


def _normal_near(face, p):
    surf = BRep_Tool.Surface_s(face)
    proj = GeomAPI_ProjectPointOnSurf(p, surf)
    if proj.NbPoints() == 0:
        return None
    u, v = proj.LowerDistanceParameters()
    return geom.face_normal_at(face, u, v)


def _order_key(center, extra=0.0):
    return (round(center[0], 5), round(center[1], 5), round(center[2], 5), round(extra, 5))


class Topology:
    def __init__(self, state):
        self.faces = []
        self.edges = []
        self.bodies = []
        self.sketches = [state.sketches[k] for k in state.sketches]
        self._fmap = ShapeMap()
        self._emap = ShapeMap()
        self._eindex = []
        for name, body in state.bodies.items():
            self.bodies.append(name)
            for face, base in body.face_list():
                fi = FaceInfo()
                fi.i = len(self.faces)
                fi.shape = TopoDS.Face(face)
                fi.body = name
                fi.base = base
                _face_facts(fi, fi.shape)
                self.faces.append(fi)
                self._fmap.Add(face)
        # Unique face keys.
        groups = {}
        for fi in self.faces:
            groups.setdefault(fi.base, []).append(fi)
        for base, items in groups.items():
            if len(items) == 1:
                items[0].key = base
            else:
                items.sort(key=lambda f: _order_key(f.center, f.area))
                for n, fi in enumerate(items):
                    fi.key = base + "~" + str(n + 1)
        # Edges with their two faces.
        for name, body in state.bodies.items():
            anc = AncestorMap()
            TopExp.MapShapesAndAncestors_s(body.shape, TopAbs_EDGE, TopAbs_FACE, anc)
            for k in range(1, anc.Extent() + 1):
                edge = TopoDS.Edge(anc.FindKey(k))
                if BRep_Tool.Degenerated_s(edge):
                    continue
                if self._emap.FindIndex(edge) > 0:
                    continue
                fl = []
                for f in anc.FindFromIndex(k):
                    j = self._fmap.FindIndex(f)
                    if j > 0 and (j - 1) not in fl:
                        fl.append(j - 1)
                if len(fl) != 2:
                    continue
                ei = EdgeInfo()
                ei.i = len(self.edges)
                ei.shape = edge
                ei.body = name
                ei.faces = sorted(fl, key=lambda j: self.faces[j].key)
                _edge_facts(ei, edge)
                ei.convexity = convexity(edge, self.faces[ei.faces[0]].shape, self.faces[ei.faces[1]].shape)
                self.edges.append(ei)
                self._emap.Add(edge)
                self._eindex.append(ei.i)
        egroups = {}
        for ei in self.edges:
            a = self.faces[ei.faces[0]]
            b = self.faces[ei.faces[1]]
            ei.base = edge_key(a.base, b.base)
            egroups.setdefault(edge_key(a.key, b.key), []).append(ei)
        for k, items in egroups.items():
            if len(items) == 1:
                items[0].key = k
            else:
                items.sort(key=lambda e: _order_key(e.center, e.length))
                for n, ei in enumerate(items):
                    ei.key = k + "~" + str(n + 1)
        self.face_by_key = {f.key: f for f in self.faces}
        self.edge_by_key = {e.key: e for e in self.edges}

    def face_of(self, shape):
        j = self._fmap.FindIndex(shape)
        return self.faces[j - 1] if j > 0 else None

    def edge_of(self, shape):
        j = self._emap.FindIndex(shape)
        return self.edges[self._eindex[j - 1]] if j > 0 else None

    # ------------------------------------------------------------ output

    def face_json(self, fi):
        out = {
            "i": fi.i,
            "key": fi.key,
            "base": fi.base,
            "feature": key_feature(fi.base),
            "role": key_role(fi.base),
            "body": fi.body,
            "type": fi.type,
            "area": geom.rnd(fi.area, 4),
            "center": geom.rnd3(fi.center, 4),
        }
        if fi.normal is not None:
            out["normal"] = geom.rnd3(fi.normal, 6)
        if fi.frame is not None:
            out["frame"] = fi.frame.describe()
        if fi.radius is not None:
            out["radius"] = geom.rnd(fi.radius, 4)
        if fi.axis is not None:
            out["axis"] = {"origin": geom.rnd3(fi.axis[0], 4), "direction": geom.rnd3(fi.axis[1], 6)}
        return out

    def edge_json(self, ei):
        out = {
            "i": ei.i,
            "key": ei.key,
            "base": ei.base,
            "body": ei.body,
            "type": ei.type,
            "length": geom.rnd(ei.length, 4),
            "center": geom.rnd3(ei.center, 4),
            "faces": [self.faces[j].key for j in ei.faces],
            "convexity": ei.convexity,
            "ends": [geom.rnd3(ei.ends[0], 5), geom.rnd3(ei.ends[1], 5)],
        }
        if ei.direction is not None:
            out["direction"] = geom.rnd3(ei.direction, 6)
        if ei.radius is not None:
            out["radius"] = geom.rnd(ei.radius, 4)
        if ei.axis is not None:
            out["axis"] = {"origin": geom.rnd3(ei.axis[0], 4), "direction": geom.rnd3(ei.axis[1], 6)}
        return out

    def to_json(self):
        return {
            "bodies": self.bodies,
            "faces": [self.face_json(f) for f in self.faces],
            "edges": [self.edge_json(e) for e in self.edges],
            "sketches": [s.outline() for s in self.sketches],
        }


def topology(state):
    t = getattr(state, "_topo", None)
    if t is None:
        t = Topology(state)
        state._topo = t
    return t


def parallel(a, b, tol=1e-6):
    return abs(abs(geom.dot(geom.unit(a), geom.unit(b))) - 1.0) < tol


def perpendicular(a, b, tol=1e-6):
    return abs(geom.dot(geom.unit(a), geom.unit(b))) < tol
