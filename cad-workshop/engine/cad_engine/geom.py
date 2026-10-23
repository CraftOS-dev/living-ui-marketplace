"""Geometry helpers: parameter readers, frames, shape measures.

Conventions (repeated in the app guide): millimetres and degrees,
right-handed, Z up, XY is the ground plane, the Front view looks from -Y.
"""

import math

from OCP.Bnd import Bnd_Box
from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.GCPnts import GCPnts_AbscissaPoint
from OCP.GProp import GProp_GProps
from OCP.GeomAbs import (
    GeomAbs_BezierSurface,
    GeomAbs_BSplineSurface,
    GeomAbs_Circle,
    GeomAbs_Cone,
    GeomAbs_Cylinder,
    GeomAbs_Ellipse,
    GeomAbs_Line,
    GeomAbs_Plane,
    GeomAbs_Sphere,
    GeomAbs_SurfaceOfExtrusion,
    GeomAbs_SurfaceOfRevolution,
    GeomAbs_Torus,
)
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_REVERSED, TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS, TopoDS_Compound
from OCP.BRep import BRep_Builder
from OCP.gp import gp_Ax1, gp_Ax2, gp_Ax3, gp_Dir, gp_Pln, gp_Pnt, gp_Trsf, gp_Vec

from .errors import invalid

EPS = 1e-7
LIN_TOL = 1e-6

AXES = {
    "X": (1.0, 0.0, 0.0),
    "Y": (0.0, 1.0, 0.0),
    "Z": (0.0, 0.0, 1.0),
}

DIRECTIONS = {
    "+X": (1.0, 0.0, 0.0),
    "-X": (-1.0, 0.0, 0.0),
    "+Y": (0.0, 1.0, 0.0),
    "-Y": (0.0, -1.0, 0.0),
    "+Z": (0.0, 0.0, 1.0),
    "-Z": (0.0, 0.0, -1.0),
}

# --------------------------------------------------------------- readers


def num(params, name, default=None, minimum=None, maximum=None, positive=False, integer=False, where=""):
    """A number param (the app resolves expressions before the engine sees them)."""
    label = (where + "." if where else "") + name
    if name not in params or params[name] is None:
        if default is None:
            raise invalid(label + " is required")
        return default
    v = params[name]
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise invalid(label + " must be a number (got " + repr(v) + ")")
    v = float(v)
    if integer:
        if abs(v - round(v)) > 1e-9:
            raise invalid(label + " must be a whole number (got " + fmt(v) + ")")
        v = float(round(v))
    if positive and not v > 0:
        raise invalid(label + " must be more than 0 (got " + fmt(v) + ")")
    if minimum is not None and v < minimum - 1e-12:
        raise invalid(label + " must be at least " + fmt(minimum) + " (got " + fmt(v) + ")")
    if maximum is not None and v > maximum + 1e-12:
        raise invalid(label + " must be at most " + fmt(maximum) + " (got " + fmt(v) + ")")
    return v


def vec(params, name, size, default=None, where=""):
    label = (where + "." if where else "") + name
    if name not in params or params[name] is None:
        if default is None:
            raise invalid(label + " is required, e.g. " + name + ": " + str([0] * size))
        return tuple(float(x) for x in default)
    v = params[name]
    if not isinstance(v, (list, tuple)) or len(v) != size:
        raise invalid(label + " must be a list of " + str(size) + " numbers, e.g. " + str([0] * size))
    out = []
    for i, x in enumerate(v):
        if isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x):
            raise invalid(label + "[" + str(i) + "] must be a number")
        out.append(float(x))
    return tuple(out)


def choice(params, name, values, default=None, where=""):
    label = (where + "." if where else "") + name
    if name not in params or params[name] is None:
        if default is None:
            raise invalid(label + " is required, one of: " + ", ".join(values))
        return default
    v = params[name]
    if not isinstance(v, str) or v not in values:
        raise invalid(label + " must be one of: " + ", ".join(values) + " (got " + repr(v) + ")")
    return v


def text(params, name, default=None, where=""):
    label = (where + "." if where else "") + name
    if name not in params or params[name] is None:
        if default is None:
            raise invalid(label + " is required")
        return default
    v = params[name]
    if not isinstance(v, str) or v.strip() == "":
        raise invalid(label + " must be non-empty text")
    return v.strip()


def fmt(x):
    """A number as a person reads it: up to 4 decimals, no trailing zeros."""
    if x is None:
        return "?"
    r = round(float(x), 4)
    if r == 0:
        r = 0.0
    s = ("%.4f" % r).rstrip("0").rstrip(".")
    return s if s != "-0" else "0"


# ---------------------------------------------------------------- vectors


def add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def mul(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def norm(a):
    return math.sqrt(dot(a, a))


def unit(a):
    n = norm(a)
    if n < EPS:
        raise invalid("a direction cannot be zero")
    return (a[0] / n, a[1] / n, a[2] / n)


def pnt(p):
    return gp_Pnt(p[0], p[1], p[2])


def tup(p):
    return (p.X(), p.Y(), p.Z())


def gdir(d):
    return gp_Dir(d[0], d[1], d[2])


def rnd(x, n=6):
    v = round(float(x), n)
    return 0.0 if v == 0 else v


def rnd3(p, n=6):
    return [rnd(p[0], n), rnd(p[1], n), rnd(p[2], n)]


def axis_vector(spec, label):
    """'X'/'Y'/'Z', '+Z'/'-X' style, or [x, y, z]."""
    if isinstance(spec, str):
        if spec in AXES:
            return AXES[spec]
        if spec in DIRECTIONS:
            return DIRECTIONS[spec]
        raise invalid(label + " must be X, Y, Z, +X ... -Z, or a vector [x, y, z]")
    if isinstance(spec, (list, tuple)) and len(spec) == 3 and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in spec):
        return unit((float(spec[0]), float(spec[1]), float(spec[2])))
    raise invalid(label + " must be X, Y, Z, +X ... -Z, or a vector [x, y, z]")


# ----------------------------------------------------------------- frames


class Frame:
    """A sketch plane: origin, u (right), v (up) and normal, right-handed."""

    __slots__ = ("origin", "u", "v", "n")

    def __init__(self, origin, u, n):
        self.origin = origin
        self.n = unit(n)
        self.u = unit(sub(u, mul(self.n, dot(u, self.n))))
        self.v = cross(self.n, self.u)

    def at(self, x, y):
        return add(self.origin, add(mul(self.u, x), mul(self.v, y)))

    def local(self, p):
        d = sub(p, self.origin)
        return (dot(d, self.u), dot(d, self.v))

    def project(self, p):
        """A 3D point dropped onto the plane, as plane coordinates."""
        return self.local(p)

    def ax2(self):
        return gp_Ax2(pnt(self.origin), gdir(self.n), gdir(self.u))

    def ax3(self):
        return gp_Ax3(pnt(self.origin), gdir(self.n), gdir(self.u))

    def pln(self):
        return gp_Pln(self.ax3())

    def moved(self, offset):
        return Frame(add(self.origin, mul(self.n, offset)), self.u, self.n)

    def describe(self):
        return {"origin": rnd3(self.origin), "u": rnd3(self.u), "v": rnd3(self.v), "normal": rnd3(self.n)}


BASE_PLANES = {
    # normal, u: looking at the plane from the side its normal points to,
    # u is right and v is up.
    "XY": ((0.0, 0.0, 1.0), (1.0, 0.0, 0.0)),
    "XZ": ((0.0, -1.0, 0.0), (1.0, 0.0, 0.0)),
    "YZ": ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0)),
}


def base_frame(name, offset):
    n, u = BASE_PLANES[name]
    return Frame(mul(n, offset), u, n)


def frame_for_normal(origin_on_plane, n, fallback_u):
    """A frame on a plane: world-aligned when the normal is a world axis,
    so face coordinates read as world coordinates seen from outside."""
    n = unit(n)
    # The foot of the perpendicular from the world origin: face coordinates
    # then read as world coordinates.
    if abs(abs(n[2]) - 1.0) < 1e-9:
        return Frame(mul(n, dot(origin_on_plane, n)), (1.0, 0.0, 0.0), n)
    if abs(n[2]) < 1e-9:
        # Horizontal normal: v is +Z, u is to the right when looking at the face.
        u = cross((0.0, 0.0, 1.0), n)
        origin = mul(n, dot(origin_on_plane, n))
        return Frame(origin, u, n)
    return Frame(origin_on_plane, fallback_u, n)


# ------------------------------------------------------------- shape facts


def explore(shape, kind):
    out = []
    ex = TopExp_Explorer(shape, kind)
    while ex.More():
        out.append(ex.Current())
        ex.Next()
    return out


def solids(shape):
    return [TopoDS.Solid(s) for s in explore(shape, TopAbs_SOLID)]


def faces(shape):
    return [TopoDS.Face(s) for s in explore(shape, TopAbs_FACE)]


def edges(shape):
    return [TopoDS.Edge(s) for s in explore(shape, TopAbs_EDGE)]


def compound(shapes):
    c = TopoDS_Compound()
    b = BRep_Builder()
    b.MakeCompound(c)
    for s in shapes:
        b.Add(c, s)
    return c


def normalize(shape):
    """One solid as itself; several as a compound of solids; none as None."""
    ss = solids(shape)
    if len(ss) == 0:
        return None
    if len(ss) == 1:
        return ss[0]
    return compound(ss)


def volume(shape):
    p = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, p)
    return p.Mass()


def volume_props(shape):
    p = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, p)
    c = p.CentreOfMass()
    return p.Mass(), (c.X(), c.Y(), c.Z())


def area(shape):
    p = GProp_GProps()
    BRepGProp.SurfaceProperties_s(shape, p)
    return p.Mass()


def surface_props(shape):
    p = GProp_GProps()
    BRepGProp.SurfaceProperties_s(shape, p)
    c = p.CentreOfMass()
    return p.Mass(), (c.X(), c.Y(), c.Z())


def length(edge):
    return GCPnts_AbscissaPoint.Length_s(BRepAdaptor_Curve(edge))


def bbox(shape, optimal=True):
    b = Bnd_Box()
    if optimal:
        BRepBndLib.AddOptimal_s(shape, b, False, False)
    else:
        BRepBndLib.Add_s(shape, b, False)
    if b.IsVoid():
        return None
    lo = b.CornerMin()
    hi = b.CornerMax()
    return (lo.X(), lo.Y(), lo.Z()), (hi.X(), hi.Y(), hi.Z())


def bbox_union(boxes):
    boxes = [b for b in boxes if b is not None]
    if not boxes:
        return None
    lo = tuple(min(b[0][i] for b in boxes) for i in range(3))
    hi = tuple(max(b[1][i] for b in boxes) for i in range(3))
    return lo, hi


def bbox_dict(b):
    if b is None:
        return None
    lo, hi = b
    return {"min": rnd3(lo, 4), "max": rnd3(hi, 4), "size": rnd3(sub(hi, lo), 4)}


def is_valid(shape):
    return BRepCheck_Analyzer(shape).IsValid()


FACE_TYPES = {
    GeomAbs_Plane: "plane",
    GeomAbs_Cylinder: "cylinder",
    GeomAbs_Cone: "cone",
    GeomAbs_Sphere: "sphere",
    GeomAbs_Torus: "torus",
    GeomAbs_BSplineSurface: "bspline",
    GeomAbs_BezierSurface: "bspline",
    GeomAbs_SurfaceOfRevolution: "revolution",
    GeomAbs_SurfaceOfExtrusion: "extrusion",
}

EDGE_TYPES = {
    GeomAbs_Line: "line",
    GeomAbs_Circle: "circle",
    GeomAbs_Ellipse: "ellipse",
}


def face_type(face):
    return FACE_TYPES.get(BRepAdaptor_Surface(face).GetType(), "other")


def edge_type(edge):
    return EDGE_TYPES.get(BRepAdaptor_Curve(edge).GetType(), "curve")


def plane_of(face):
    """(point on plane, outward normal) of a planar face, or None."""
    s = BRepAdaptor_Surface(face)
    if s.GetType() != GeomAbs_Plane:
        return None
    pl = s.Plane()
    d = pl.Axis().Direction()
    n = (d.X(), d.Y(), d.Z())
    if face.Orientation() == TopAbs_REVERSED:
        n = (-n[0], -n[1], -n[2])
    o = pl.Location()
    return (o.X(), o.Y(), o.Z()), n


def face_normal_at(face, u, v):
    from OCP.BRepLProp import BRepLProp_SLProps

    s = BRepAdaptor_Surface(face)
    props = BRepLProp_SLProps(s, u, v, 1, 1e-6)
    if not props.IsNormalDefined():
        return None
    d = props.Normal()
    n = (d.X(), d.Y(), d.Z())
    if face.Orientation() == TopAbs_REVERSED:
        n = (-n[0], -n[1], -n[2])
    return n


def line_of(edge):
    """(point, unit direction) of a straight edge, or None."""
    c = BRepAdaptor_Curve(edge)
    if c.GetType() != GeomAbs_Line:
        return None
    ln = c.Line()
    o = ln.Location()
    d = ln.Direction()
    return (o.X(), o.Y(), o.Z()), (d.X(), d.Y(), d.Z())


def edge_mid(edge):
    c = BRepAdaptor_Curve(edge)
    t = (c.FirstParameter() + c.LastParameter()) / 2.0
    return tup(c.Value(t))


def edge_ends(edge):
    c = BRepAdaptor_Curve(edge)
    return tup(c.Value(c.FirstParameter())), tup(c.Value(c.LastParameter()))


def is_degenerated(edge):
    return BRep_Tool.Degenerated_s(edge)


# -------------------------------------------------------------- transforms


def trsf_translate(v):
    t = gp_Trsf()
    t.SetTranslation(gp_Vec(v[0], v[1], v[2]))
    return t


def trsf_rotate(origin, axis, angle_deg):
    t = gp_Trsf()
    t.SetRotation(gp_Ax1(pnt(origin), gdir(axis)), math.radians(angle_deg))
    return t


def trsf_mirror(origin, normal):
    t = gp_Trsf()
    t.SetMirror(gp_Ax2(pnt(origin), gdir(normal)))
    return t


def transformed(shape, trsf, copy=True):
    """(new shape, the transform op) so callers can map sub-shapes with ModifiedShape."""
    op = BRepBuilderAPI_Transform(shape, trsf, copy)
    return op.Shape(), op
