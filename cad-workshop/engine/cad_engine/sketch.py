"""Sketches: dimension-driven profiles on a plane.

Every item is placed by explicit numbers (the app has already resolved
parameter expressions). Items: rectangle (optionally rounded), circle, slot,
polygon, path (lines and three-point arcs) and construction lines. Each
closed item is one loop; a loop inside another is a hole in it. Loops that
cross or touch are refused (sketch_invalid) rather than guessed at.

Each segment has an id (`r1.top`, `c1`, `p1.s3`) that later features use to
name the faces it sweeps (`ext1.side.r1.top`).
"""

import math
import re

from OCP.BRepBuilderAPI import (
    BRepBuilderAPI_MakeEdge,
    BRepBuilderAPI_MakeFace,
    BRepBuilderAPI_MakeVertex,
    BRepBuilderAPI_MakeWire,
)
from OCP.GC import GC_MakeArcOfCircle
from OCP.gp import gp_Circ
from OCP.TopAbs import TopAbs_EDGE
from OCP.TopoDS import TopoDS

from . import geom
from .errors import CadError, invalid
from .state import shape_map

ID_RE = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
ITEM_TYPES = ("rectangle", "circle", "slot", "polygon", "path", "line")
ARC_SAMPLES = 48


def sketch_error(message, **extra):
    return CadError("sketch_invalid", message, **extra)


# ------------------------------------------------------------ 2D segments


class Seg2:
    """One 2D segment: a line (a, b), an arc (a, m, b) through m, or a full circle."""

    __slots__ = ("sid", "kind", "a", "m", "b", "center", "radius")

    def __init__(self, sid, kind, a=None, m=None, b=None, center=None, radius=None):
        self.sid = sid
        self.kind = kind
        self.a = a
        self.m = m
        self.b = b
        self.center = center
        self.radius = radius

    def samples(self):
        if self.kind == "line":
            return [self.a, self.b]
        if self.kind == "circle":
            cx, cy = self.center
            return [(cx + self.radius * math.cos(2 * math.pi * i / ARC_SAMPLES), cy + self.radius * math.sin(2 * math.pi * i / ARC_SAMPLES)) for i in range(ARC_SAMPLES + 1)]
        c, r, a0, sweep = arc_params(self.a, self.m, self.b)
        n = max(4, int(abs(sweep) / (2 * math.pi) * ARC_SAMPLES) + 2)
        return [(c[0] + r * math.cos(a0 + sweep * i / n), c[1] + r * math.sin(a0 + sweep * i / n)) for i in range(n + 1)]

    def reversed(self):
        if self.kind == "line":
            return Seg2(self.sid, "line", a=self.b, b=self.a)
        if self.kind == "arc":
            return Seg2(self.sid, "arc", a=self.b, m=self.m, b=self.a)
        return self


def arc_params(a, m, b):
    """Center, radius, start angle and signed sweep of the arc a -> m -> b."""
    ax, ay = a
    bx, by = m
    cx, cy = b
    d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    if abs(d) < 1e-12:
        raise sketch_error("An arc's three points lie on one line, so they do not define a circle.")
    ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d
    uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d
    r = math.hypot(ax - ux, ay - uy)
    a0 = math.atan2(ay - uy, ax - ux)
    am = math.atan2(by - uy, bx - ux)
    a1 = math.atan2(cy - uy, cx - ux)

    def ccw(frm, to):
        x = (to - frm) % (2 * math.pi)
        return x

    if ccw(a0, am) < ccw(a0, a1):
        sweep = ccw(a0, a1)
    else:
        sweep = -((a0 - a1) % (2 * math.pi))
    return (ux, uy), r, a0, sweep


def rot(p, center, angle):
    if angle == 0:
        return p
    c = math.cos(angle)
    s = math.sin(angle)
    x = p[0] - center[0]
    y = p[1] - center[1]
    return (center[0] + x * c - y * s, center[1] + x * s + y * c)


def signed_area(points):
    s = 0.0
    for i in range(len(points) - 1):
        s += points[i][0] * points[i + 1][1] - points[i + 1][0] * points[i][1]
    return s / 2.0


def same2(p, q, tol=1e-6):
    return abs(p[0] - q[0]) <= tol and abs(p[1] - q[1]) <= tol


# ------------------------------------------------------------- item rules


def item_id(item, idx, seen):
    iid = item.get("id")
    if not isinstance(iid, str) or not ID_RE.match(iid):
        raise invalid("items[" + str(idx) + "].id must be a short lower-case name like r1 or outline (letters, digits, _)")
    if iid in seen:
        raise invalid("Two sketch items share the id " + repr(iid) + "; ids must be unique in a sketch.")
    seen.add(iid)
    return iid


def loop_rectangle(item, iid):
    w = geom.num(item, "width", positive=True, where=iid)
    h = geom.num(item, "height", positive=True, where=iid)
    ang = math.radians(geom.num(item, "angle_deg", default=0.0, where=iid))
    if "corner" in item and item["corner"] is not None:
        x0, y0 = geom.vec(item, "corner", 2, where=iid)
        cx, cy = x0 + w / 2, y0 + h / 2
    else:
        cx, cy = geom.vec(item, "center", 2, default=(0, 0), where=iid)
    r = geom.num(item, "corner_radius", default=0.0, minimum=0.0, where=iid)
    if r > min(w, h) / 2 + 1e-9:
        raise invalid(iid + ".corner_radius " + geom.fmt(r) + " is more than half the shorter side (" + geom.fmt(min(w, h) / 2) + ")")
    r = min(r, min(w, h) / 2)
    x0, x1, y0, y1 = cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2
    c = (cx, cy)

    def P(x, y):
        return rot((x, y), c, ang)

    segs = []
    if r <= 1e-9:
        corners = [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)]
        names = ["bottom", "right", "top", "left"]
        for i in range(4):
            segs.append(Seg2(iid + "." + names[i], "line", a=corners[i], b=corners[(i + 1) % 4]))
        return segs

    def line(name, a, b):
        if math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-9:
            segs.append(Seg2(iid + "." + name, "line", a=P(*a), b=P(*b)))

    def arc(name, ccx, ccy, a_from, a_to):
        am = (a_from + a_to) / 2
        segs.append(
            Seg2(
                iid + "." + name,
                "arc",
                a=P(ccx + r * math.cos(a_from), ccy + r * math.sin(a_from)),
                m=P(ccx + r * math.cos(am), ccy + r * math.sin(am)),
                b=P(ccx + r * math.cos(a_to), ccy + r * math.sin(a_to)),
            )
        )

    line("bottom", (x0 + r, y0), (x1 - r, y0))
    arc("corner_br", x1 - r, y0 + r, -math.pi / 2, 0.0)
    line("right", (x1, y0 + r), (x1, y1 - r))
    arc("corner_tr", x1 - r, y1 - r, 0.0, math.pi / 2)
    line("top", (x1 - r, y1), (x0 + r, y1))
    arc("corner_tl", x0 + r, y1 - r, math.pi / 2, math.pi)
    line("left", (x0, y1 - r), (x0, y0 + r))
    arc("corner_bl", x0 + r, y0 + r, math.pi, 1.5 * math.pi)
    return segs


def loop_circle(item, iid):
    if item.get("radius") is not None and item.get("diameter") is None:
        r = geom.num(item, "radius", positive=True, where=iid)
    else:
        r = geom.num(item, "diameter", positive=True, where=iid) / 2
    c = geom.vec(item, "center", 2, default=(0, 0), where=iid)
    return [Seg2(iid, "circle", center=c, radius=r)]


def loop_slot(item, iid):
    L = geom.num(item, "length", positive=True, where=iid)
    W = geom.num(item, "width", positive=True, where=iid)
    c = geom.vec(item, "center", 2, default=(0, 0), where=iid)
    ang = math.radians(geom.num(item, "angle_deg", default=0.0, where=iid))
    h = L / 2
    r = W / 2

    def P(x, y):
        return rot((c[0] + x, c[1] + y), c, ang)

    return [
        Seg2(iid + ".side_a", "line", a=P(-h, -r), b=P(h, -r)),
        Seg2(iid + ".end_b", "arc", a=P(h, -r), m=P(h + r, 0), b=P(h, r)),
        Seg2(iid + ".side_b", "line", a=P(h, r), b=P(-h, r)),
        Seg2(iid + ".end_a", "arc", a=P(-h, r), m=P(-h - r, 0), b=P(-h, -r)),
    ]


def loop_polygon(item, iid):
    n = int(geom.num(item, "sides", integer=True, minimum=3, maximum=64, where=iid))
    if item.get("across_flats") is not None:
        af = geom.num(item, "across_flats", positive=True, where=iid)
        R = af / 2 / math.cos(math.pi / n)
    else:
        R = geom.num(item, "diameter", positive=True, where=iid) / 2
    c = geom.vec(item, "center", 2, default=(0, 0), where=iid)
    a0 = math.radians(geom.num(item, "angle_deg", default=0.0, where=iid))
    pts = [(c[0] + R * math.cos(a0 + 2 * math.pi * i / n), c[1] + R * math.sin(a0 + 2 * math.pi * i / n)) for i in range(n)]
    return [Seg2(iid + ".e" + str(i + 1), "line", a=pts[i], b=pts[(i + 1) % n]) for i in range(n)]


def loop_path(item, iid):
    start = geom.vec(item, "start", 2, where=iid)
    raw = item.get("segments")
    if not isinstance(raw, list) or len(raw) < 1:
        raise invalid(iid + ".segments must be a list like [{\"to\": [10, 0]}, {\"to\": [0, 0], \"via\": [5, 5]}]")
    segs = []
    seen = set()
    cur = start
    for i, s in enumerate(raw):
        where = iid + ".segments[" + str(i) + "]"
        if not isinstance(s, dict):
            raise invalid(where + " must be an object with to (and via for an arc)")
        sid = s.get("id")
        if sid is None:
            sid = "s" + str(i + 1)
        if not isinstance(sid, str) or not ID_RE.match(sid):
            raise invalid(where + ".id must be a short lower-case name")
        if sid in seen:
            raise invalid(where + ".id " + repr(sid) + " is used twice in " + iid)
        seen.add(sid)
        to = geom.vec(s, "to", 2, where=where)
        if same2(to, cur):
            raise invalid(where + " has zero length (it ends where it starts)")
        if s.get("via") is not None:
            via = geom.vec(s, "via", 2, where=where)
            segs.append(Seg2(iid + "." + sid, "arc", a=cur, m=via, b=to))
            arc_params(cur, via, to)
        else:
            segs.append(Seg2(iid + "." + sid, "line", a=cur, b=to))
        cur = to
    if not same2(cur, start, 1e-6):
        raise sketch_error(
            "Path " + iid + " is not closed: it ends at (" + geom.fmt(cur[0]) + ", " + geom.fmt(cur[1]) + ") but starts at (" + geom.fmt(start[0]) + ", " + geom.fmt(start[1]) + "). End the last segment at the start point."
        )
    if len(segs) < 2 and segs[0].kind == "line":
        raise sketch_error("Path " + iid + " needs at least 2 segments to enclose an area.")
    return segs


BUILDERS = {
    "rectangle": loop_rectangle,
    "circle": loop_circle,
    "slot": loop_slot,
    "polygon": loop_polygon,
    "path": loop_path,
}

# ------------------------------------------------------------ 2D topology


def _seg_intersect(p1, p2, p3, p4):
    """True when segments p1p2 and p3p4 cross or touch."""

    def orient(a, b, c):
        v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        if abs(v) < 1e-10:
            return 0
        return 1 if v > 0 else -1

    def on(a, b, c):
        return min(a[0], b[0]) - 1e-10 <= c[0] <= max(a[0], b[0]) + 1e-10 and min(a[1], b[1]) - 1e-10 <= c[1] <= max(a[1], b[1]) + 1e-10

    o1 = orient(p1, p2, p3)
    o2 = orient(p1, p2, p4)
    o3 = orient(p3, p4, p1)
    o4 = orient(p3, p4, p2)
    if o1 != o2 and o3 != o4:
        return True
    if o1 == 0 and on(p1, p2, p3):
        return True
    if o2 == 0 and on(p1, p2, p4):
        return True
    if o3 == 0 and on(p3, p4, p1):
        return True
    if o4 == 0 and on(p3, p4, p2):
        return True
    return False


def _bounds(poly):
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    return min(xs), min(ys), max(xs), max(ys)


def polylines_touch(a, b):
    ba = _bounds(a)
    bb = _bounds(b)
    if ba[2] < bb[0] - 1e-9 or bb[2] < ba[0] - 1e-9 or ba[3] < bb[1] - 1e-9 or bb[3] < ba[1] - 1e-9:
        return False
    for i in range(len(a) - 1):
        for j in range(len(b) - 1):
            if _seg_intersect(a[i], a[i + 1], b[j], b[j + 1]):
                return True
    return False


def point_in(poly, p):
    inside = False
    x, y = p
    n = len(poly) - 1
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[i + 1]
        if (y1 > y) != (y2 > y):
            xi = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if xi > x:
                inside = not inside
    return inside


# ------------------------------------------------------------- 3D building


class Loop:
    __slots__ = ("iid", "segs", "wire", "edge_ids", "poly", "area")

    def __init__(self, iid, segs, wire, edge_ids, poly, area):
        self.iid = iid
        self.segs = segs
        self.wire = wire
        self.edge_ids = edge_ids
        self.poly = poly
        self.area = area


class SketchData:
    """A built sketch: its frame, loops, holes and construction lines."""

    def __init__(self, name, frame):
        self.name = name
        self.frame = frame
        self.loops = {}
        self.order = []
        self.parent = {}
        self.depth = {}
        self.lines = {}
        self.line_ends = {}
        self._emap = None
        self._eids = None

    def seg_edges(self):
        """(map of every loop edge, ids aligned with it) for naming swept faces."""
        if self._emap is None:
            from OCP.OCP.collections import IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher as ShapeMap

            m = ShapeMap()
            ids = []
            for iid in self.order:
                lp = self.loops[iid]
                for e, sid in lp.edge_ids:
                    if m.FindIndex(e) == 0:
                        m.Add(e)
                        ids.append(sid)
            self._emap = m
            self._eids = ids
        return self._emap, self._eids

    def seg_id(self, edge):
        m, ids = self.seg_edges()
        i = m.FindIndex(edge)
        return ids[i - 1] if i > 0 else None

    def children(self, iid):
        return [c for c in self.order if self.parent.get(c) == iid]

    def default_items(self):
        return [i for i in self.order if self.depth[i] % 2 == 0]

    def region(self, iid):
        """The face of loop `iid` with its direct children cut out as holes."""
        if iid not in self.loops:
            if iid in self.lines:
                raise invalid("Sketch item " + repr(iid) + " in " + self.name + " is a construction line, not a closed profile.")
            raise invalid("Sketch " + self.name + " has no item " + repr(iid) + ". Items: " + ", ".join(self.order) + ".", candidates=list(self.order))
        lp = self.loops[iid]
        mk = BRepBuilderAPI_MakeFace(self.frame.pln(), lp.wire, True)
        for c in self.children(iid):
            mk.Add(TopoDS.Wire(self.loops[c].wire.Reversed()))
        if not mk.IsDone():
            raise sketch_error("Could not make a face from sketch item " + iid + ".")
        return mk.Face()

    def outline(self):
        """The sketch as drawn: closed loops (2D polylines in the sketch frame,
        with nesting depth) and construction lines, for the viewer."""
        return {
            "name": self.name,
            "frame": self.frame.describe(),
            "loops": [
                {"id": i, "poly": [[geom.rnd(p[0], 5), geom.rnd(p[1], 5)] for p in self.loops[i].poly], "depth": self.depth[i], "inside": self.parent.get(i)}
                for i in self.order
            ],
            "lines": [{"id": k, "from": [geom.rnd(a[0], 5), geom.rnd(a[1], 5)], "to": [geom.rnd(b[0], 5), geom.rnd(b[1], 5)]} for k, (a, b) in sorted(self.line_ends.items())],
        }

    def describe(self):
        return {
            "frame": self.frame.describe(),
            "items": [
                {
                    "id": i,
                    "segments": [s.sid for s in self.loops[i].segs],
                    "area": geom.rnd(self.loops[i].area, 4),
                    "inside": self.parent.get(i),
                    "is_hole": self.depth[i] % 2 == 1,
                }
                for i in self.order
            ],
            "lines": sorted(self.lines.keys()),
        }


def _vertex(frame, p):
    return BRepBuilderAPI_MakeVertex(geom.pnt(frame.at(p[0], p[1]))).Vertex()


def _edges_for(frame, segs):
    """3D edges for one closed loop, consecutive edges sharing their vertex."""
    out = []
    if len(segs) == 1 and segs[0].kind == "circle":
        s = segs[0]
        c = frame.at(*s.center)
        circ = gp_Circ(geom.Frame(c, frame.u, frame.n).ax2(), s.radius)
        e = BRepBuilderAPI_MakeEdge(circ).Edge()
        return [(e, s.sid)]
    verts = [_vertex(frame, s.a) for s in segs]
    for i, s in enumerate(segs):
        v0 = verts[i]
        v1 = verts[(i + 1) % len(segs)]
        if s.kind == "line":
            mk = BRepBuilderAPI_MakeEdge(v0, v1)
        else:
            arc = GC_MakeArcOfCircle(geom.pnt(frame.at(*s.a)), geom.pnt(frame.at(*s.m)), geom.pnt(frame.at(*s.b))).Value()
            mk = BRepBuilderAPI_MakeEdge(arc, v0, v1)
        if not mk.IsDone():
            raise sketch_error("Segment " + s.sid + " could not be built (it may have zero length).")
        out.append((mk.Edge(), s.sid))
    return out


def _line_edge(frame, item, iid):
    a = geom.vec(item, "from", 2, where=iid)
    b = geom.vec(item, "to", 2, where=iid)
    if same2(a, b):
        raise invalid(iid + " has zero length")
    return BRepBuilderAPI_MakeEdge(geom.pnt(frame.at(*a)), geom.pnt(frame.at(*b))).Edge()


def build(name, frame, items):
    if not isinstance(items, list) or len(items) == 0:
        raise invalid("items must be a non-empty list of sketch items (rectangle, circle, slot, polygon, path, line)")
    sk = SketchData(name, frame)
    seen = set()
    raw_loops = []
    for idx, item in enumerate(items):
        if not isinstance(item, dict):
            raise invalid("items[" + str(idx) + "] must be an object")
        kind = item.get("type")
        if kind not in ITEM_TYPES:
            raise invalid("items[" + str(idx) + "].type must be one of: " + ", ".join(ITEM_TYPES))
        iid = item_id(item, idx, seen)
        if kind == "line":
            sk.lines[iid] = _line_edge(frame, item, iid)
            sk.line_ends[iid] = (geom.vec(item, "from", 2, where=iid), geom.vec(item, "to", 2, where=iid))
            continue
        segs = BUILDERS[kind](item, iid)
        poly = []
        for s in segs:
            pts = s.samples()
            if poly:
                pts = pts[1:]
            poly.extend(pts)
        if not same2(poly[0], poly[-1], 1e-6):
            poly.append(poly[0])
        a = signed_area(poly)
        if abs(a) < 1e-9:
            raise sketch_error("Sketch item " + iid + " encloses no area.")
        if a < 0:
            segs = [s.reversed() for s in reversed(segs)]
            poly = list(reversed(poly))
        raw_loops.append((iid, segs, poly, abs(a)))

    # Loops must not cross or touch; nesting is decided by containment.
    for i in range(len(raw_loops)):
        for j in range(i + 1, len(raw_loops)):
            if polylines_touch(raw_loops[i][2], raw_loops[j][2]):
                raise sketch_error(
                    "Sketch items " + raw_loops[i][0] + " and " + raw_loops[j][0] + " cross or touch. Profiles in one sketch must be separate or fully inside one another; use a second sketch or move one of them.",
                    candidates=[raw_loops[i][0], raw_loops[j][0]],
                )
    for iid, segs, poly, a in raw_loops:
        holders = [(oa, oid) for oid, _, opoly, oa in raw_loops if oid != iid and oa > a and point_in(opoly, poly[0])]
        sk.depth[iid] = len(holders)
        sk.parent[iid] = min(holders)[1] if holders else None

    for iid, segs, poly, a in raw_loops:
        edge_ids = _edges_for(frame, segs)
        mk = BRepBuilderAPI_MakeWire()
        for e, _ in edge_ids:
            mk.Add(e)
        if not mk.IsDone():
            raise sketch_error("The segments of " + iid + " do not join into a closed outline.")
        wire = mk.Wire()
        # The wire must hold the very edges that carry the segment ids.
        wmap = shape_map(wire, TopAbs_EDGE)
        for e, sid in edge_ids:
            if wmap.FindIndex(e) == 0:
                raise sketch_error("Internal: segment " + sid + " was rebuilt while joining " + iid + ".")
        sk.loops[iid] = Loop(iid, segs, wire, edge_ids, poly, a)
        sk.order.append(iid)
    if not sk.order and not sk.lines:
        raise invalid("The sketch has no items")
    return sk
