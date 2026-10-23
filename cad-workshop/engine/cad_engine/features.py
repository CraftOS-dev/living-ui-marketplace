"""Features: one typed operation each, applied to a state.

Every feature function takes (state, name, params, ctx) and returns a new
state plus a list of warnings. Material features build a tool solid whose
faces are named first, then join it to the model with the operation the
feature asks for (new body, add, cut or intersect).
"""

import math

from OCP.BRepAlgoAPI import BRepAlgoAPI_Common, BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.BRepFilletAPI import BRepFilletAPI_MakeChamfer, BRepFilletAPI_MakeFillet
from OCP.BRepOffset import BRepOffset_Skin
from OCP.BRepOffsetAPI import BRepOffsetAPI_MakeThickSolid
from OCP.BRepPrimAPI import (
    BRepPrimAPI_MakeBox,
    BRepPrimAPI_MakeCone,
    BRepPrimAPI_MakeCylinder,
    BRepPrimAPI_MakePrism,
    BRepPrimAPI_MakeRevol,
    BRepPrimAPI_MakeSphere,
    BRepPrimAPI_MakeTorus,
)
from OCP.GeomAbs import GeomAbs_Arc
from OCP.ShapeUpgrade import ShapeUpgrade_UnifySameDomain
from OCP.STEPControl import STEPControl_Reader
from OCP.IFSelect import IFSelect_RetDone
from OCP.TopExp import TopExp
from OCP.TopoDS import TopoDS
from OCP.gp import gp_Ax1, gp_Ax2, gp_Vec
from OCP.OCP.collections import List_TopoDS_Shape

from . import geom, refs, sketch as sk
from .errors import CadError, invalid
from .state import Body, History, OpHistory, Tool, ToolsHistory, TransformHistory, face_map, name_result
from .topology import topology

OPERATIONS = ("new", "add", "cut", "intersect")


def shape_list(shapes):
    lst = List_TopoDS_Shape()
    for s in shapes:
        lst.Append(s)
    return lst


def faces_of(shape):
    return geom.faces(shape)


def named(shape, generated, feature):
    """Keys for a freshly built tool whose faces all come from `generated`."""
    return name_result(shape, [], History(), generated, feature)


def unify(shape, keys, feature):
    """Merge faces left split by a boolean on one surface (a boss flush with a
    side), keeping keys: the earliest source key wins."""
    try:
        u = ShapeUpgrade_UnifySameDomain(shape, True, True, False)
        u.Build()
        out = u.Shape()
        hist = ToolsHistory(u.History())
    except Exception:
        return shape, keys
    fm = face_map(shape)
    sources = [(fm.FindKey(i + 1), keys[i]) for i in range(len(keys))]
    return out, name_result(out, sources, hist, [], feature)


def check_valid(shape, feature, what):
    if not geom.is_valid(shape):
        raise CadError(
            "invalid_solid",
            what + " produced an invalid solid. The geometry is probably too thin, self-intersecting or tangent at this size; change a dimension slightly.",
            feature=feature,
        )


def boolean(kind, target, tools, feature):
    """Run a boolean of one target against tool shapes; returns (result, op)."""
    if kind == "add":
        op = BRepAlgoAPI_Fuse()
    elif kind == "cut":
        op = BRepAlgoAPI_Cut()
    else:
        op = BRepAlgoAPI_Common()
    op.SetArguments(shape_list([target]))
    op.SetTools(shape_list(tools))
    op.SetRunParallel(False)
    op.Build()
    if not op.IsDone():
        raise CadError("kernel_failed", "The kernel could not " + {"add": "join", "cut": "cut", "intersect": "intersect"}[kind] + " this shape with the model. Check that the profile and the model overlap cleanly.", feature=feature)
    return op.Shape(), op


def combine(state, feature, tool_shapes, operation, params, body_name=None):
    """Join named tool solids to the model: new body, add, cut or intersect.

    tool_shapes: [(shape, keys)]. Returns (state, warnings, targets).
    """
    warnings = []
    st = state.copy()
    if operation == "new":
        shapes = [s for s, _ in tool_shapes]
        sources = []
        for s, keys in tool_shapes:
            fm = face_map(s)
            sources.extend((fm.FindKey(i + 1), keys[i]) for i in range(len(keys)))
        if len(shapes) == 1:
            res = shapes[0]
        else:
            res, op = boolean("add", shapes[0], shapes[1:], feature)
            keys = name_result(res, sources, OpHistory(op), [], feature)
            res, keys = unify(res, keys, feature)
            fm = face_map(res)
            sources = [(fm.FindKey(i + 1), keys[i]) for i in range(len(keys))]
        norm = geom.normalize(res)
        if norm is None:
            raise CadError("empty_result", "The new body has no volume.", feature=feature)
        name = body_name or feature
        if name in st.bodies:
            raise invalid("A body named " + repr(name) + " already exists; give body_name a new name.")
        keys = name_result(norm, sources, History(), [], feature)
        check_valid(norm, feature, "This feature")
        st.bodies[name] = Body(name, norm, keys, feature)
        st.tools[feature] = Tool(norm, keys, "new", [name])
        return st, warnings, [name]

    targets = st.target_bodies(params, feature)
    if operation == "add" and len(targets) != 1:
        raise invalid("add joins material to one body; give target one body name.")
    tools = [s for s, _ in tool_shapes]
    tool_sources = []
    for s, keys in tool_shapes:
        fm = face_map(s)
        tool_sources.extend((fm.FindKey(i + 1), keys[i]) for i in range(len(keys)))
    for tname in targets:
        body = st.bodies[tname]
        before = geom.volume(body.shape)
        res, op = boolean(operation, body.shape, tools, feature)
        keys = name_result(res, body.face_list() + tool_sources, OpHistory(op), [], feature)
        res, keys = unify(res, keys, feature)
        norm = geom.normalize(res)
        if norm is None:
            if operation == "cut":
                raise CadError("empty_result", "The cut removes all of " + tname + ".", feature=feature)
            raise CadError("empty_result", "Nothing of " + tname + " is left after intersecting.", feature=feature)
        if norm is not res:
            keys = name_result(norm, [(f, k) for f, k in zip([face_map(res).FindKey(i + 1) for i in range(len(keys))], keys)], History(), [], feature)
        after = geom.volume(norm)
        if abs(after - before) <= max(1e-6, 1e-9 * abs(before)):
            verb = {"add": "adds no material: the new shape is entirely inside " + tname, "cut": "removes no material: the cut does not reach " + tname, "intersect": "changes nothing: " + tname + " is entirely inside the shape"}[operation]
            raise CadError("no_effect", "This feature " + verb + ".", feature=feature)
        check_valid(norm, feature, "This feature")
        n_solids = len(geom.solids(norm))
        if n_solids > 1:
            warnings.append(tname + " is now " + str(n_solids) + " separate solids.")
        st.bodies[tname] = Body(tname, norm, keys, body.origin)
    tool_shape = tools[0] if len(tools) == 1 else geom.compound(tools)
    all_keys = name_result(tool_shape, tool_sources, History(), [], feature)
    st.tools[feature] = Tool(tool_shape, all_keys, operation, targets)
    return st, warnings, targets


def read_operation(params, default="new"):
    return geom.choice(params, "operation", OPERATIONS, default=default)


def read_body_name(params):
    v = params.get("body_name")
    if v is None or v == "":
        return None
    if not isinstance(v, str) or not sk.ID_RE.match(v):
        raise invalid("body_name must be a short lower-case name like bracket or lid (letters, digits, _)")
    return v


def need_sketch(state, params, feature):
    name = geom.text(params, "sketch")
    if name not in state.sketches:
        raise CadError("reference_order", feature + " uses sketch " + repr(name) + ", which is not built before it. Sketches so far: " + (", ".join(state.sketches) or "none") + ".", feature=feature, candidates=list(state.sketches))
    return state.sketches[name]


def profile_items(sketch, params):
    items = params.get("items")
    if items is None:
        items = sketch.default_items()
    if not isinstance(items, list) or not items or not all(isinstance(x, str) for x in items):
        raise invalid("items must be a list of sketch item ids, e.g. [\"r1\"]")
    if not items:
        raise invalid("The sketch has no closed profile to use")
    return items


def model_extent(state, extra=None):
    boxes = [geom.bbox(b.shape, optimal=False) for b in state.bodies.values()]
    if extra is not None:
        boxes.append(geom.bbox(extra, optimal=False))
    b = geom.bbox_union(boxes)
    if b is None:
        return 100.0
    return geom.norm(geom.sub(b[1], b[0])) + 10.0


# ---------------------------------------------------------------- sketch


def f_sketch(state, name, params, ctx):
    plane = geom.choice(params, "plane", ("XY", "XZ", "YZ", "face"), default="XY")
    offset = geom.num(params, "offset", default=0.0)
    if plane == "face":
        face = refs.one_face(state, params.get("face"), "face", planar=True)
        pl = geom.plane_of(face.shape)
        frame = geom.frame_for_normal(pl[0], pl[1], (1.0, 0.0, 0.0)).moved(offset)
    else:
        frame = geom.base_frame(plane, offset)
    data = sk.build(name, frame, params.get("items"))
    st = state.copy()
    st.sketches[name] = data
    return st, []


# --------------------------------------------------------------- extrude


def _prism(region, vec, sketch, feature, moved=None):
    """A prism from a region face with its faces named; `moved` maps edges
    of a translated copy back to the sketch's edges."""
    mk = BRepPrimAPI_MakePrism(region, vec)
    mk.Build()
    if not mk.IsDone():
        raise CadError("kernel_failed", "The kernel could not extrude this profile.", feature=feature)
    solid = mk.Shape()
    gen = []
    first = faces_of(mk.FirstShape())
    last = faces_of(mk.LastShape())
    gen.append((first, feature + ".cap_start"))
    gen.append((last, feature + ".cap_end"))
    for e in geom.edges(region):
        src = moved.get(e) if moved is not None else e
        sid = sketch.seg_id(src) if src is not None else None
        if sid is None:
            continue
        gen.append((faces_of_list(mk.Generated(e)), feature + ".side." + sid))
    return solid, named(solid, gen, feature)


def faces_of_list(shapes):
    out = []
    for s in shapes:
        out.extend(faces_of(s))
    return out


class _EdgeMap:
    """Edges of a moved region mapped to the sketch's original edges."""

    def __init__(self, pairs):
        self.m = shape_map_empty()
        self.src = []
        for moved, orig in pairs:
            if self.m.FindIndex(moved) == 0:
                self.m.Add(moved)
                self.src.append(orig)

    def get(self, e):
        i = self.m.FindIndex(e)
        return self.src[i - 1] if i > 0 else None


def shape_map_empty():
    from OCP.OCP.collections import IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher as ShapeMap

    return ShapeMap()


def f_extrude(state, name, params, ctx):
    sketch = need_sketch(state, params, name)
    items = profile_items(sketch, params)
    operation = read_operation(params)
    body_name = read_body_name(params)
    extent = params.get("extent")
    if not isinstance(extent, dict):
        raise invalid("extent must be an object, e.g. {\"type\": \"distance\", \"distance\": 10}")
    etype = geom.choice(extent, "type", ("distance", "symmetric", "two_sided", "through_all", "up_to"), where="extent")
    direction = geom.choice(params, "direction", ("normal", "reverse"), default="normal")
    sign = 1.0 if direction == "normal" else -1.0
    n = sketch.frame.n
    if etype == "distance":
        d = geom.num(extent, "distance", where="extent")
        if abs(d) < 1e-9:
            raise invalid("extent.distance cannot be 0")
        start, end = 0.0, sign * d
    elif etype == "symmetric":
        d = geom.num(extent, "distance", positive=True, where="extent")
        start, end = -d / 2, d / 2
    elif etype == "two_sided":
        d1 = geom.num(extent, "distance", minimum=0.0, where="extent")
        d2 = geom.num(extent, "distance2", minimum=0.0, where="extent")
        if d1 + d2 <= 1e-9:
            raise invalid("extent.distance plus extent.distance2 must be more than 0")
        start, end = -sign * d2, sign * d1
    elif etype == "through_all":
        if operation not in ("cut", "intersect"):
            raise invalid("extent through_all is for cuts; use a distance to add material")
        L = model_extent(state)
        if extent.get("both_sides") is True:
            start, end = -L, L
        else:
            start, end = 0.0, sign * L
    else:
        target = refs.one_face(state, extent.get("face"), "extent.face", planar=True)
        pl = geom.plane_of(target.shape)
        if abs(abs(geom.dot(pl[1], n)) - 1.0) > 1e-6:
            raise invalid("extent.face must be parallel to the sketch plane")
        dist = geom.dot(geom.sub(pl[0], sketch.frame.origin), n)
        dist += geom.num(extent, "offset", default=0.0, where="extent") * (1 if dist >= 0 else -1)
        if abs(dist) < 1e-9:
            raise invalid("extent.face lies on the sketch plane, so there is nothing to extrude up to")
        start, end = 0.0, dist
    lo, hi = min(start, end), max(start, end)
    tools = []
    for iid in items:
        region = sketch.region(iid)
        vec = gp_Vec(n[0] * (hi - lo), n[1] * (hi - lo), n[2] * (hi - lo))
        if abs(lo) > 1e-12:
            moved, op = geom.transformed(region, geom.trsf_translate(geom.mul(n, lo)), copy=True)
            pairs = [(op.ModifiedShape(e), e) for e in geom.edges(region)]
            emap = _EdgeMap(pairs)
            solid, keys = _prism(TopoDS.Face(moved), vec, sketch, name, emap)
        else:
            solid, keys = _prism(region, vec, sketch, name)
        # When the prism runs against the normal its caps swap ends; keep
        # cap_start on the sketch plane.
        tools.append((solid, keys))
    if lo < -1e-12 and hi <= 1e-12:
        tools = [(s, [_swap_caps(k, name) for k in keys]) for s, keys in tools]
    if len(tools) > 1:
        solid, keys = _fuse_named(tools, name)
        tools = [(solid, keys)]
    st, warns, _ = combine(state, name, tools, operation, params, body_name)
    return st, warns


def _swap_caps(k, feature):
    if k == feature + ".cap_start":
        return feature + ".cap_end"
    if k == feature + ".cap_end":
        return feature + ".cap_start"
    return k


def _fuse_named(tools, feature):
    sources = []
    for s, keys in tools:
        fm = face_map(s)
        sources.extend((fm.FindKey(i + 1), keys[i]) for i in range(len(keys)))
    res, op = boolean("add", tools[0][0], [t[0] for t in tools[1:]], feature)
    keys = name_result(res, sources, OpHistory(op), [], feature)
    return unify(res, keys, feature)


# ---------------------------------------------------------------- revolve


def _revolve_axis(state, sketch, params, feature):
    axis = params.get("axis")
    if isinstance(axis, str):
        if axis not in geom.AXES:
            raise invalid("axis must be X, Y or Z, {\"segment\": \"r1.left\"} (a sketch segment or line) or {\"edge\": reference}")
        return (0.0, 0.0, 0.0), geom.AXES[axis]
    if isinstance(axis, dict) and "segment" in axis:
        sid = axis["segment"]
        if not isinstance(sid, str):
            raise invalid("axis.segment must be a segment id like r1.left or a line id")
        edge = sketch.lines.get(sid)
        if edge is None:
            for iid in sketch.order:
                for e, s in sketch.loops[iid].edge_ids:
                    if s == sid:
                        edge = e
        if edge is None:
            raise invalid("Sketch " + sketch.name + " has no segment or line " + repr(sid) + ".")
        ln = geom.line_of(edge)
        if ln is None:
            raise invalid("axis.segment " + sid + " must be a straight segment")
        return ln
    if isinstance(axis, dict) and "edge" in axis:
        res = refs.resolve(state, axis["edge"], "axis.edge", kind="edges")
        if res.count() != 1:
            raise CadError("stale_reference", "axis.edge must select exactly 1 edge, found " + str(res.count()) + ".", found=res.count(), expected="1", candidates=res.keys()[:10])
        e = res.edges[0]
        if e.direction is not None:
            return e.center, e.direction
        if e.axis is not None:
            return e.axis
        raise invalid("axis.edge must be a straight or circular edge")
    raise invalid("axis must be X, Y or Z, {\"segment\": \"r1.left\"} or {\"edge\": reference}")


def _point_on_face(p, face, tol=1e-6):
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex
    from OCP.BRepExtrema import BRepExtrema_DistShapeShape

    d = BRepExtrema_DistShapeShape(BRepBuilderAPI_MakeVertex(geom.pnt(p)).Vertex(), face)
    return d.IsDone() and d.Value() <= tol


def f_revolve(state, name, params, ctx):
    sketch = need_sketch(state, params, name)
    items = profile_items(sketch, params)
    operation = read_operation(params)
    body_name = read_body_name(params)
    origin, direction = _revolve_axis(state, sketch, params, name)
    angle = geom.num(params, "angle_deg", default=360.0, minimum=0.0, maximum=360.0)
    if angle <= 1e-9:
        raise invalid("angle_deg must be more than 0")
    if geom.choice(params, "direction", ("normal", "reverse"), default="normal") == "reverse":
        direction = geom.mul(direction, -1.0)
    ax = gp_Ax1(geom.pnt(origin), geom.gdir(direction))
    tools = []
    for iid in items:
        region = sketch.region(iid)
        mk = BRepPrimAPI_MakeRevol(region, ax, math.radians(angle))
        mk.Build()
        if not mk.IsDone():
            raise CadError("kernel_failed", "The kernel could not revolve " + iid + " about this axis.", feature=name)
        solid = mk.Shape()
        gen = []
        if angle < 360 - 1e-9:
            gen.append((faces_of(mk.FirstShape()), name + ".start"))
            gen.append((faces_of(mk.LastShape()), name + ".end"))
        lost = []
        for e in geom.edges(region):
            sid = sketch.seg_id(e)
            if sid is None:
                continue
            g = faces_of_list(mk.Generated(e))
            if g:
                gen.append((g, name + ".side." + sid))
            else:
                lost.append((e, sid))
        # A full turn rebuilds the flat faces swept by segments square to the
        # axis, and OCCT reports no history for them. Each swept face still
        # contains its segment, so the segment's middle identifies it.
        for e, sid in lost:
            mid = geom.edge_mid(e)
            hits = [f for f in faces_of(solid) if _point_on_face(mid, f)]
            if hits:
                gen.append((hits, name + ".side." + sid))
        keys = named(solid, gen, name)
        if not geom.is_valid(solid):
            raise CadError("kernel_failed", "Revolving " + iid + " makes an invalid solid: the axis probably crosses the profile. Move the profile to one side of the axis.", feature=name)
        tools.append((solid, keys))
    if len(tools) > 1:
        tools = [_fuse_named(tools, name)]
    st, warns, _ = combine(state, name, tools, operation, params, body_name)
    return st, warns


# -------------------------------------------------------------- primitive

SHAPES = ("box", "cylinder", "sphere", "cone", "torus")


def _axis_frame(axis_name, base):
    d = geom.AXES[axis_name]
    u = (1.0, 0.0, 0.0) if axis_name != "X" else (0.0, 1.0, 0.0)
    return gp_Ax2(geom.pnt(base), geom.gdir(d), geom.gdir(u)), d


def _name_axial(solid, d, feature, side_role="side"):
    gen = []
    for f in faces_of(solid):
        pl = geom.plane_of(f)
        if pl is None:
            gen.append(([f], feature + "." + side_role))
        elif geom.dot(pl[1], d) > 0:
            gen.append(([f], feature + ".cap_end"))
        else:
            gen.append(([f], feature + ".cap_start"))
    return named(solid, gen, feature)


def f_primitive(state, name, params, ctx):
    shape = geom.choice(params, "shape", SHAPES)
    operation = read_operation(params)
    body_name = read_body_name(params)
    pos = geom.vec(params, "position", 3, default=(0, 0, 0))
    if shape == "box":
        sx, sy, sz = geom.vec(params, "size", 3)
        if min(sx, sy, sz) <= 0:
            raise invalid("size must be three positive numbers [x, y, z]")
        anchor = geom.choice(params, "anchor", ("bottom", "center", "corner"), default="bottom")
        if anchor == "corner":
            lo = pos
        elif anchor == "center":
            lo = (pos[0] - sx / 2, pos[1] - sy / 2, pos[2] - sz / 2)
        else:
            lo = (pos[0] - sx / 2, pos[1] - sy / 2, pos[2])
        solid = BRepPrimAPI_MakeBox(geom.pnt(lo), sx, sy, sz).Shape()
        names = {(1, 0, 0): "right", (-1, 0, 0): "left", (0, 1, 0): "back", (0, -1, 0): "front", (0, 0, 1): "top", (0, 0, -1): "bottom"}
        gen = []
        for f in faces_of(solid):
            nrm = geom.plane_of(f)[1]
            key = tuple(int(round(c)) for c in nrm)
            gen.append(([f], name + "." + names[key]))
        keys = named(solid, gen, name)
    elif shape in ("cylinder", "cone"):
        axis = geom.choice(params, "axis", ("X", "Y", "Z"), default="Z")
        h = geom.num(params, "height", positive=True)
        anchor = geom.choice(params, "anchor", ("bottom", "center"), default="bottom")
        d = geom.AXES[axis]
        base = pos if anchor == "bottom" else geom.sub(pos, geom.mul(d, h / 2))
        ax2, d = _axis_frame(axis, base)
        if shape == "cylinder":
            if params.get("radius") is not None and params.get("diameter") is None:
                r = geom.num(params, "radius", positive=True)
            else:
                r = geom.num(params, "diameter", positive=True) / 2
            solid = BRepPrimAPI_MakeCylinder(ax2, r, h).Shape()
        else:
            r1 = geom.num(params, "diameter_start", minimum=0.0) / 2
            r2 = geom.num(params, "diameter_end", minimum=0.0) / 2
            if r1 + r2 <= 1e-9 or abs(r1 - r2) < 1e-9:
                raise invalid("a cone needs two different diameters, at least one more than 0 (use a cylinder for equal ones)")
            solid = BRepPrimAPI_MakeCone(ax2, r1, r2, h).Shape()
        keys = _name_axial(solid, d, name)
    elif shape == "sphere":
        r = geom.num(params, "diameter", positive=True) / 2
        solid = BRepPrimAPI_MakeSphere(geom.pnt(pos), r).Shape()
        keys = named(solid, [(faces_of(solid), name + ".surface")], name)
    else:
        axis = geom.choice(params, "axis", ("X", "Y", "Z"), default="Z")
        R = geom.num(params, "major_diameter", positive=True) / 2
        r = geom.num(params, "minor_diameter", positive=True) / 2
        if r >= R:
            raise invalid("minor_diameter must be smaller than major_diameter")
        ax2, _ = _axis_frame(axis, pos)
        solid = BRepPrimAPI_MakeTorus(ax2, R, r).Shape()
        keys = named(solid, [(faces_of(solid), name + ".surface")], name)
    st, warns, _ = combine(state, name, [(solid, keys)], operation, params, body_name)
    return st, warns


# ------------------------------------------------------------------- hole

# ISO metric sizes. clearance: ISO 273 medium fit; close: ISO 273 fine fit;
# tap: ISO 261 coarse thread tap drill; insert: hole for common tapered
# brass heat-set inserts (check the insert's own datasheet).
# counterbore: DIN 974-1 for ISO 4762 socket head cap screws, depth = head
# height + 0.4; countersink: ISO 10642 head diameter at 90 degrees.
HOLE_SIZES = {
    "M2": {"clearance": 2.4, "close": 2.2, "tap": 1.6, "insert": 3.2, "insert_depth": 4.0, "cbore": 4.3, "cbore_depth": 2.4, "csink": 3.8},
    "M2.5": {"clearance": 2.9, "close": 2.7, "tap": 2.05, "insert": 3.6, "insert_depth": 5.0, "cbore": 5.0, "cbore_depth": 2.9, "csink": 4.7},
    "M3": {"clearance": 3.4, "close": 3.2, "tap": 2.5, "insert": 4.0, "insert_depth": 5.7, "cbore": 6.0, "cbore_depth": 3.4, "csink": 6.72},
    "M4": {"clearance": 4.5, "close": 4.3, "tap": 3.3, "insert": 5.6, "insert_depth": 8.1, "cbore": 8.0, "cbore_depth": 4.4, "csink": 8.96},
    "M5": {"clearance": 5.5, "close": 5.3, "tap": 4.2, "insert": 6.4, "insert_depth": 9.5, "cbore": 10.0, "cbore_depth": 5.4, "csink": 11.2},
    "M6": {"clearance": 6.6, "close": 6.4, "tap": 5.0, "cbore": 11.0, "cbore_depth": 6.4, "csink": 13.44},
    "M8": {"clearance": 9.0, "close": 8.4, "tap": 6.8, "cbore": 15.0, "cbore_depth": 8.4, "csink": 17.92},
    "M10": {"clearance": 11.0, "close": 10.5, "tap": 8.5, "cbore": 18.0, "cbore_depth": 10.4, "csink": 22.4},
    "M12": {"clearance": 13.5, "close": 13.0, "tap": 10.2, "cbore": 20.0, "cbore_depth": 12.4, "csink": 26.88},
}
FITS = ("clearance", "close", "tap", "insert")
HEADS = ("none", "counterbore", "countersink")


def hole_spec(params):
    """Diameters for one hole feature: explicit numbers win over the size table."""
    size = params.get("size")
    table = None
    if size is not None:
        size = geom.choice(params, "size", tuple(HOLE_SIZES.keys()))
        table = HOLE_SIZES[size]
    fit = geom.choice(params, "fit", FITS, default="clearance")
    head = geom.choice(params, "head", HEADS, default="none")
    if params.get("diameter") is not None:
        dia = geom.num(params, "diameter", positive=True)
    elif table is not None:
        if fit not in table:
            raise invalid("fit " + fit + " has no standard size for " + size + "; give diameter")
        dia = table[fit]
    else:
        raise invalid("give diameter, or size (M2 to M12) with fit, e.g. size: \"M3\", fit: \"clearance\"")
    spec = {"diameter": dia, "head": head, "size": size, "fit": fit}
    if head == "counterbore":
        cb = params.get("counterbore") or {}
        if not isinstance(cb, dict):
            raise invalid("counterbore must be {\"diameter\": n, \"depth\": n}")
        spec["cb_d"] = geom.num(cb, "diameter", default=table["cbore"] if table else None, positive=True, where="counterbore")
        spec["cb_depth"] = geom.num(cb, "depth", default=table["cbore_depth"] if table else None, positive=True, where="counterbore")
        if spec["cb_d"] <= dia:
            raise invalid("counterbore.diameter must be larger than the hole diameter")
    elif head == "countersink":
        cs = params.get("countersink") or {}
        if not isinstance(cs, dict):
            raise invalid("countersink must be {\"diameter\": n, \"angle_deg\": 90}")
        spec["cs_d"] = geom.num(cs, "diameter", default=table["csink"] if table else None, positive=True, where="countersink")
        spec["cs_angle"] = geom.num(cs, "angle_deg", default=90.0, minimum=30.0, maximum=150.0, where="countersink")
        if spec["cs_d"] <= dia:
            raise invalid("countersink.diameter must be larger than the hole diameter")
    if params.get("through") is True:
        spec["depth"] = None
    elif params.get("depth") is not None:
        spec["depth"] = geom.num(params, "depth", positive=True)
    elif fit == "insert" and table is not None and "insert_depth" in table:
        spec["depth"] = table["insert_depth"]
    else:
        raise invalid("give depth, or through: true")
    return spec


def f_hole(state, name, params, ctx):
    face = refs.one_face(state, params.get("face"), "face", planar=True)
    pl = geom.plane_of(face.shape)
    frame = geom.frame_for_normal(pl[0], pl[1], (1.0, 0.0, 0.0))
    pts = []
    if params.get("positions") is not None:
        raw = params["positions"]
        if not isinstance(raw, list) or not raw:
            raise invalid("positions must be a list of [u, v] points on the face, e.g. [[10, 10], [-10, 10]]")
        for i, p in enumerate(raw):
            q = geom.vec({"p": p}, "p", 2, where="positions[" + str(i) + "]")
            pts.append(frame.at(q[0], q[1]))
    if params.get("points") is not None:
        raw = params["points"]
        if not isinstance(raw, list) or not raw:
            raise invalid("points must be a list of [x, y, z] world points, e.g. [[10, 10, 5]]")
        for i, p in enumerate(raw):
            q = geom.vec({"p": p}, "p", 3, where="points[" + str(i) + "]")
            u, v = frame.local(q)
            pts.append(frame.at(u, v))
    if not pts:
        raise invalid("give positions ([u, v] on the face) or points ([x, y, z] in the world)")
    if len(pts) > 500:
        raise invalid("a hole feature makes at most 500 holes")
    spec = hole_spec(params)
    targets = state.target_bodies({"target": face.body}, name)
    body = state.bodies[targets[0]]
    n = frame.n
    down = geom.mul(n, -1.0)
    lift = 0.05 + 1e-3 * model_extent(state)
    if spec["depth"] is None:
        b = geom.bbox(body.shape, optimal=False)
        corners = [(x, y, z) for x in (b[0][0], b[1][0]) for y in (b[0][1], b[1][1]) for z in (b[0][2], b[1][2])]
        depth = max(geom.dot(geom.sub(pts[0], c), n) for c in corners) + 1.0
        depth = max(depth, 1.0)
    else:
        depth = spec["depth"]
    r = spec["diameter"] / 2
    tools = []
    for i, p in enumerate(pts):
        idx = str(i + 1)
        top = geom.add(p, geom.mul(n, lift))
        parts = []
        bore = BRepPrimAPI_MakeCylinder(gp_Ax2(geom.pnt(top), geom.gdir(down)), r, depth + lift).Shape()
        parts.append(bore)
        if spec["head"] == "counterbore":
            parts.append(BRepPrimAPI_MakeCylinder(gp_Ax2(geom.pnt(top), geom.gdir(down)), spec["cb_d"] / 2, spec["cb_depth"] + lift).Shape())
        elif spec["head"] == "countersink":
            R = spec["cs_d"] / 2
            h = (R - r) / math.tan(math.radians(spec["cs_angle"] / 2))
            above = lift
            parts.append(BRepPrimAPI_MakeCone(gp_Ax2(geom.pnt(top), geom.gdir(down)), R + above * math.tan(math.radians(spec["cs_angle"] / 2)), r, h + above).Shape())
        if len(parts) > 1:
            solid, op = boolean("add", parts[0], parts[1:], name)
            solid = geom.normalize(solid)
        else:
            solid = parts[0]
        gen = []
        for f in faces_of(solid):
            t = geom.face_type(f)
            fi_area, c = geom.surface_props(f)
            depth_at = geom.dot(geom.sub(p, c), n)
            if t == "cylinder":
                from OCP.BRepAdaptor import BRepAdaptor_Surface

                rad = BRepAdaptor_Surface(f).Cylinder().Radius()
                role = "bore" if abs(rad - r) < 1e-6 else "cbore"
            elif t == "cone":
                role = "csink"
            elif t == "plane":
                if depth_at < -lift / 2:
                    role = "top"
                elif spec["head"] == "counterbore" and abs(depth_at - spec["cb_depth"]) < 1e-6:
                    role = "cbore_floor"
                else:
                    role = "floor"
            else:
                role = "wall"
            gen.append(([f], name + "." + role + "." + idx))
        tools.append((solid, named(solid, gen, name)))
    st, warns, _ = combine(state, name, tools, "cut", {"target": body.name}, None)
    if spec["depth"] is not None:
        thick = _thickness_along(body.shape, pts[0], down)
        if thick is not None and spec["depth"] > thick + 1e-6:
            warns.append("The hole is deeper than the material under it (" + geom.fmt(thick) + " mm), so it goes through.")
    return st, warns


def _thickness_along(shape, p, d):
    """Length of material straight under point p (the first solid stretch along d)."""
    b = geom.bbox(shape, optimal=False)
    if b is None:
        return None
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge

    L = geom.norm(geom.sub(b[1], b[0])) + 1
    a = geom.add(p, geom.mul(d, -1e-3))
    e = BRepBuilderAPI_MakeEdge(geom.pnt(a), geom.pnt(geom.add(p, geom.mul(d, L)))).Edge()
    com = BRepAlgoAPI_Common(e, shape)
    if not com.IsDone():
        return None
    segs = geom.edges(com.Shape())
    if not segs:
        return None
    s0 = min(segs, key=lambda s: geom.dot(geom.sub(geom.edge_mid(s), p), d))
    return geom.length(s0)


# -------------------------------------------------------- fillet, chamfer


def _edges_by_body(state, params, name, label="edges"):
    res = refs.resolve(state, params.get(label), label, kind="edges")
    if res.count() == 0:
        raise CadError("stale_reference", label + " selects no edges.", found=0, expected="at least 1")
    bodies = {}
    for e in sorted(res.edges, key=lambda x: x.key):
        bodies.setdefault(e.body, []).append(e)
    return bodies


def _blend(state, name, params, kind):
    if kind == "fillet":
        radius = geom.num(params, "radius", positive=True)
    else:
        dist = geom.num(params, "distance", positive=True)
        dist2 = geom.num(params, "distance2", positive=True) if params.get("distance2") is not None else None
        ang = geom.num(params, "angle_deg", minimum=1.0, maximum=89.0) if params.get("angle_deg") is not None else None
        if dist2 is not None and ang is not None:
            raise invalid("give distance2 or angle_deg, not both")
    st = state.copy()
    warns = []
    topo = topology(state)
    counter = 0
    for bname, elist in _edges_by_body(state, params, name).items():
        body = st.bodies[bname]
        if kind == "fillet":
            mk = BRepFilletAPI_MakeFillet(body.shape)
            for e in elist:
                mk.Add(radius, e.shape)
        else:
            mk = BRepFilletAPI_MakeChamfer(body.shape)
            for e in elist:
                ref_face = topo.faces[e.faces[0]].shape
                if dist2 is not None:
                    mk.Add(dist, dist2, e.shape, ref_face)
                elif ang is not None:
                    mk.AddDA(dist, math.radians(ang), e.shape, ref_face)
                else:
                    mk.Add(dist, e.shape)
        try:
            mk.Build()
            ok = mk.IsDone()
        except Exception:
            ok = False
        if not ok:
            bad = []
            if kind == "fillet":
                try:
                    for ic in range(1, mk.NbFaultyContours() + 1):
                        c = mk.FaultyContour(ic)
                        for j in range(1, mk.NbEdges(c) + 1):
                            hit = topo.edge_of(mk.Edge(c, j))
                            if hit is not None:
                                bad.append(hit.key)
                except Exception:
                    bad = []
            size = (geom.fmt(radius) + " mm fillet") if kind == "fillet" else (geom.fmt(dist) + " mm chamfer")
            raise CadError(
                "kernel_failed",
                "The " + size + " does not fit" + (" on " + ", ".join(bad[:4]) if bad else "") + ". The faces next to these edges are probably narrower than the " + ("radius" if kind == "fillet" else "distance") + "; try a smaller one or fewer edges.",
                feature=name,
                candidates=bad[:10] or None,
            )
        res = mk.Shape()
        gen = []
        for e in elist:
            counter += 1
            role = "blend" if kind == "fillet" else "bevel"
            gen.append((faces_of_list(mk.Generated(e.shape)), name + "." + role + "." + str(counter)))
        if kind == "fillet":
            vmap = shape_map_empty()
            for e in elist:
                v0 = TopoDS.Vertex(TopExp.FirstVertex_s(e.shape))
                v1 = TopoDS.Vertex(TopExp.LastVertex_s(e.shape))
                for v in (v0, v1):
                    if vmap.FindIndex(v) == 0:
                        vmap.Add(v)
            for j in range(1, vmap.Extent() + 1):
                fs = faces_of_list(mk.Generated(vmap.FindKey(j)))
                if fs:
                    gen.append((fs, name + ".corner." + str(j)))
        keys = name_result(res, body.face_list(), OpHistory(mk), gen, name)
        norm = geom.normalize(res)
        if norm is None:
            raise CadError("empty_result", "The " + kind + " left no solid.", feature=name)
        if norm is not res:
            fm = face_map(res)
            keys = name_result(norm, [(fm.FindKey(i + 1), keys[i]) for i in range(len(keys))], History(), [], name)
        check_valid(norm, name, "This " + kind)
        st.bodies[bname] = Body(bname, norm, keys, body.origin)
    return st, warns


def f_fillet(state, name, params, ctx):
    return _blend(state, name, params, "fillet")


def f_chamfer(state, name, params, ctx):
    return _blend(state, name, params, "chamfer")


# ------------------------------------------------------------------ shell


def f_shell(state, name, params, ctx):
    thickness = geom.num(params, "thickness", positive=True)
    direction = geom.choice(params, "direction", ("inside", "outside"), default="inside")
    remove = []
    bname = None
    if params.get("remove") is not None:
        res = refs.resolve(state, params["remove"], "remove", kind="faces")
        remove = res.faces
        names = set(f.body for f in remove)
        if len(names) > 1:
            raise invalid("remove must select faces of one body")
        bname = next(iter(names)) if names else None
    if bname is None:
        bname = state.target_bodies(params, name)[0]
    st = state.copy()
    body = st.bodies[bname]
    mk = BRepOffsetAPI_MakeThickSolid()
    offset = -thickness if direction == "inside" else thickness
    try:
        mk.MakeThickSolidByJoin(body.shape, shape_list([f.shape for f in remove]), offset, 1e-4, BRepOffset_Skin, False, False, GeomAbs_Arc, False)
        mk.Build()
        ok = mk.IsDone()
    except Exception:
        ok = False
    if not ok:
        raise CadError("kernel_failed", "A " + geom.fmt(thickness) + " mm shell could not be built. Walls thinner than the smallest fillet or feature usually fix this; try a thinner shell or remove fillets before the shell.", feature=name)
    res = mk.Shape()
    sources = body.face_list()
    gen = []
    for f, k in sources:
        g = faces_of_list(mk.Generated(f))
        if g:
            gen.append((g, name + ".inner." + k))
    # Faces that survive keep their keys (the rim left of a removed face
    # keeps that face's key); each face's offset copy is generated from it.
    keys = name_result(res, sources, OpHistory(mk), gen, name)
    norm = geom.normalize(res)
    if norm is None:
        raise CadError("empty_result", "The shell left no solid.", feature=name)
    if norm is not res:
        fm = face_map(res)
        keys = name_result(norm, [(fm.FindKey(i + 1), keys[i]) for i in range(len(keys))], History(), [], name)
    check_valid(norm, name, "This shell")
    st.bodies[bname] = Body(bname, norm, keys, body.origin)
    return st, []


# -------------------------------------------------- patterns and mirror


def _sources(state, params, name):
    src = params.get("source")
    if not isinstance(src, dict) or len([k for k in ("features", "bodies") if k in src]) != 1:
        raise invalid("source must be {\"features\": [\"hole1\"]} or {\"bodies\": [\"bracket\"]}")
    if "features" in src:
        names = src["features"]
        if not isinstance(names, list) or not names or not all(isinstance(x, str) for x in names):
            raise invalid("source.features must be a list of feature names")
        out = []
        for f in names:
            t = state.tools.get(f)
            if t is None:
                raise CadError("reference_order", name + " repeats " + repr(f) + ", which is not a feature before it that adds or removes material (extrude, revolve, hole, primitive, or another pattern).", feature=name, candidates=list(state.tools)[:10])
            if t.operation == "new":
                raise invalid(repr(f) + " creates a body; to repeat a whole body use source: {\"bodies\": [...]}")
            out.append((f, t))
        return "features", out
    names = src["bodies"]
    if not isinstance(names, list) or not names or not all(isinstance(x, str) for x in names):
        raise invalid("source.bodies must be a list of body names")
    for b in names:
        if b not in state.bodies:
            raise CadError("stale_reference", "No body named " + repr(b) + ".", found=0, expected="1", candidates=list(state.bodies)[:10])
    return "bodies", names


def _repeat(state, name, params, trsfs):
    """Apply each transform in trsfs [(suffix, gp_Trsf)] to the sources."""
    mode, sources = _sources(state, params, name)
    st = state.copy()
    warns = []
    if mode == "features":
        groups = {}
        for f, tool in sources:
            fm = face_map(tool.shape)
            src_faces = [(fm.FindKey(i + 1), tool.keys[i]) for i in range(len(tool.keys))]
            for suffix, trsf in trsfs:
                moved, op = geom.transformed(tool.shape, trsf, copy=True)
                keys = name_result(moved, [(fa, k + "@" + name + "." + suffix) for fa, k in src_faces], TransformHistory(op), [], name)
                gk = (tool.operation, tuple(tool.targets))
                groups.setdefault(gk, []).append((moved, keys))
        for (operation, targets), tools in groups.items():
            live = [t for t in targets if t in st.bodies]
            if not live:
                raise CadError("reference_order", "The bodies the repeated features changed no longer exist.", feature=name)
            for t in live:
                st, w, _ = combine(st, name, tools, operation, {"target": t}, None)
                warns.extend(w)
        return st, warns
    merge = params.get("merge") is True
    for bname in sources:
        body = st.bodies[bname]
        copies = []
        for suffix, trsf in trsfs:
            moved, op = geom.transformed(body.shape, trsf, copy=True)
            keys = name_result(moved, [(fa, k + "@" + name + "." + suffix) for fa, k in body.face_list()], TransformHistory(op), [], name)
            copies.append((suffix, moved, keys))
        if merge:
            st, w, _ = combine(st, name, [(m, k) for _, m, k in copies], "add", {"target": bname}, None)
            warns.extend(w)
        else:
            for suffix, moved, keys in copies:
                new_name = bname + "_" + suffix.replace(".", "_")
                if new_name in st.bodies:
                    raise invalid("A body named " + new_name + " already exists")
                st.bodies[new_name] = Body(new_name, moved, keys, name)
    return st, warns


def _axis_spec(state, spec, label):
    if isinstance(spec, str):
        if spec in geom.AXES:
            return (0.0, 0.0, 0.0), geom.AXES[spec]
        raise invalid(label + " must be X, Y, Z, {\"edge\": reference} or {\"origin\": [x,y,z], \"direction\": [x,y,z]}")
    if isinstance(spec, dict) and "edge" in spec:
        res = refs.resolve(state, spec["edge"], label + ".edge", kind="edges")
        if res.count() != 1:
            raise CadError("stale_reference", label + ".edge must select exactly 1 edge, found " + str(res.count()) + ".", found=res.count(), expected="1", candidates=res.keys()[:10])
        e = res.edges[0]
        if e.direction is not None:
            return e.center, e.direction
        if e.axis is not None:
            return e.axis
        raise invalid(label + ".edge must be straight or circular")
    if isinstance(spec, dict) and "direction" in spec:
        o = geom.vec(spec, "origin", 3, default=(0, 0, 0), where=label)
        d = geom.unit(geom.vec(spec, "direction", 3, where=label))
        return o, d
    raise invalid(label + " must be X, Y, Z, {\"edge\": reference} or {\"origin\": [x,y,z], \"direction\": [x,y,z]}")


def _direction(state, spec, label):
    if isinstance(spec, dict) and "edge" in spec:
        o, d = _axis_spec(state, spec, label)
        return d
    return geom.axis_vector(spec, label)


def f_pattern_linear(state, name, params, ctx):
    d1 = _direction(state, params.get("direction"), "direction")
    n1 = int(geom.num(params, "count", integer=True, minimum=1, maximum=500))
    s1 = geom.num(params, "spacing")
    n2 = 1
    d2 = None
    s2 = 0.0
    if params.get("direction2") is not None:
        d2 = _direction(state, params.get("direction2"), "direction2")
        n2 = int(geom.num(params, "count2", integer=True, minimum=1, maximum=500))
        s2 = geom.num(params, "spacing2")
    if n1 * n2 < 2:
        raise invalid("a pattern needs at least 2 instances in total")
    if n1 * n2 > 1000:
        raise invalid("a pattern makes at most 1000 instances")
    trsfs = []
    for j in range(n2):
        for i in range(n1):
            if i == 0 and j == 0:
                continue
            v = geom.mul(d1, s1 * i)
            if d2 is not None:
                v = geom.add(v, geom.mul(d2, s2 * j))
            suffix = str(i + 1) if d2 is None else str(i + 1) + "." + str(j + 1)
            trsfs.append((suffix, geom.trsf_translate(v)))
    return _repeat(state, name, params, trsfs)


def f_pattern_circular(state, name, params, ctx):
    origin, axis = _axis_spec(state, params.get("axis"), "axis")
    n = int(geom.num(params, "count", integer=True, minimum=2, maximum=500))
    total = geom.num(params, "angle_deg", default=360.0, minimum=0.0, maximum=360.0)
    if total <= 1e-9:
        raise invalid("angle_deg must be more than 0")
    step = total / n if abs(total - 360.0) < 1e-9 else total / (n - 1)
    trsfs = [(str(i + 1), geom.trsf_rotate(origin, axis, step * i)) for i in range(1, n)]
    return _repeat(state, name, params, trsfs)


def _mirror_plane(state, params):
    plane = params.get("plane")
    if isinstance(plane, str) and plane in geom.BASE_PLANES:
        f = geom.base_frame(plane, geom.num(params, "offset", default=0.0))
        return f.origin, f.n
    if isinstance(plane, dict) and "face" in plane:
        face = refs.one_face(state, plane["face"], "plane.face", planar=True)
        pl = geom.plane_of(face.shape)
        return pl[0], pl[1]
    raise invalid("plane must be XY, XZ or YZ (with offset), or {\"face\": reference}")


def f_mirror(state, name, params, ctx):
    o, n = _mirror_plane(state, params)
    return _repeat(state, name, params, [("m", geom.trsf_mirror(o, n))])


# ----------------------------------------------------- boolean, transform


def f_boolean(state, name, params, ctx):
    target = geom.text(params, "target")
    if target not in state.bodies:
        raise CadError("stale_reference", "No body named " + repr(target) + ".", found=0, expected="1", candidates=list(state.bodies)[:10])
    tools = params.get("tools")
    if isinstance(tools, str):
        tools = [tools]
    if not isinstance(tools, list) or not tools or not all(isinstance(t, str) for t in tools):
        raise invalid("tools must be a list of body names")
    for t in tools:
        if t not in state.bodies:
            raise CadError("stale_reference", "No body named " + repr(t) + ".", found=0, expected="1", candidates=list(state.bodies)[:10])
        if t == target:
            raise invalid("a body cannot be its own tool")
    operation = geom.choice(params, "operation", ("add", "cut", "intersect"))
    keep = params.get("keep_tools") is True
    tool_shapes = [(state.bodies[t].shape, state.bodies[t].keys) for t in tools]
    st, warns, _ = combine(state, name, tool_shapes, operation, {"target": target}, None)
    if not keep:
        for t in tools:
            st.bodies.pop(t, None)
    return st, warns


def f_transform(state, name, params, ctx):
    bodies = params.get("bodies")
    if bodies == "*" or bodies == ["*"]:
        bodies = list(state.bodies)
    if isinstance(bodies, str):
        bodies = [bodies]
    if not isinstance(bodies, list) or not bodies or not all(isinstance(b, str) for b in bodies):
        raise invalid("bodies must be a list of body names (or \"*\" for all)")
    for b in bodies:
        if b not in state.bodies:
            raise CadError("stale_reference", "No body named " + repr(b) + ".", found=0, expected="1", candidates=list(state.bodies)[:10])
    from OCP.gp import gp_Trsf

    trsf = gp_Trsf()
    rot = params.get("rotate")
    if rot is not None:
        if not isinstance(rot, dict):
            raise invalid("rotate must be {\"axis\": \"Z\", \"angle_deg\": 90, \"origin\": [0, 0, 0]}")
        axis = geom.axis_vector(rot.get("axis", "Z"), "rotate.axis")
        ang = geom.num(rot, "angle_deg", where="rotate")
        o = geom.vec(rot, "origin", 3, default=(0, 0, 0), where="rotate")
        trsf = geom.trsf_rotate(o, axis, ang)
    t = geom.vec(params, "translate", 3, default=(0, 0, 0))
    if rot is None and geom.norm(t) < 1e-12:
        raise invalid("give translate [x, y, z] and/or rotate {axis, angle_deg}")
    move = geom.trsf_translate(t)
    total = move.Multiplied(trsf)
    st = state.copy()
    for b in bodies:
        body = st.bodies[b]
        moved, op = geom.transformed(body.shape, total, copy=True)
        keys = name_result(moved, body.face_list(), TransformHistory(op), [], name)
        st.bodies[b] = Body(b, moved, keys, body.origin)
    return st, []


# ------------------------------------------------------------ import STEP


def f_import_step(state, name, params, ctx):
    asset = geom.text(params, "asset")
    path = ctx.get("assets", {}).get(asset)
    if path is None:
        raise invalid("No file for asset " + repr(asset) + ". Add the STEP file with assets.add first.")
    reader = STEPControl_Reader()
    if reader.ReadFile(path) != IFSelect_RetDone:
        raise CadError("import_failed", "The file could not be read as STEP.", feature=name)
    reader.TransferRoots()
    shape = reader.OneShape()
    solids = geom.solids(shape)
    if not solids:
        raise CadError("import_failed", "The STEP file has no closed solids (only surfaces or wires), so it cannot become a body.", feature=name)
    res = solids[0] if len(solids) == 1 else geom.compound(solids)
    scale = geom.num(params, "scale", default=1.0, positive=True)
    from OCP.gp import gp_Trsf, gp_Pnt

    if abs(scale - 1.0) > 1e-12:
        t = gp_Trsf()
        t.SetScale(gp_Pnt(0, 0, 0), scale)
        res, _ = geom.transformed(res, t, copy=True)
    rot = params.get("rotate")
    t = geom.vec(params, "translate", 3, default=(0, 0, 0))
    trsf = gp_Trsf()
    if isinstance(rot, dict):
        trsf = geom.trsf_rotate(geom.vec(rot, "origin", 3, default=(0, 0, 0), where="rotate"), geom.axis_vector(rot.get("axis", "Z"), "rotate.axis"), geom.num(rot, "angle_deg", where="rotate"))
    total = geom.trsf_translate(t).Multiplied(trsf)
    res, _ = geom.transformed(res, total, copy=True)
    fl = faces_of(res)
    keys = named(res, [([f], name + ".f" + str(i + 1)) for i, f in enumerate(fl)], name)
    operation = read_operation(params)
    st, warns, _ = combine(state, name, [(res, keys)], operation, params, read_body_name(params))
    warns.append("Faces of an imported file are named by their order in the file; re-importing a changed file can rename them.")
    return st, warns


# ------------------------------------------------------------- push / pull


def f_push_pull(state, name, params, ctx):
    """Move a flat face along its normal: outward adds material, inward cuts.

    The face's outline is swept along the normal into a prism that is joined
    to (or cut from) the body that owns the face. Faces: NAME.cap (the face in
    its new place) and NAME.side.<i>, one per edge of the face in order.
    """
    f = refs.one_face(state, params.get("face"), "face", planar=True)
    d = geom.num(params, "distance")
    if abs(d) < 1e-9:
        raise invalid("distance cannot be 0")
    pl = geom.plane_of(f.shape)
    n = pl[1]
    face = TopoDS.Face(f.shape)
    vec = gp_Vec(n[0] * d, n[1] * d, n[2] * d)
    mk = BRepPrimAPI_MakePrism(face, vec)
    mk.Build()
    if not mk.IsDone():
        raise CadError("kernel_failed", "The kernel could not move this face.", feature=name)
    solid = mk.Shape()
    gen = [(faces_of(mk.LastShape()), name + ".cap"), (faces_of(mk.FirstShape()), name + ".base")]
    for i, e in enumerate(geom.edges(face)):
        gen.append((faces_of_list(mk.Generated(e)), name + ".side." + str(i + 1)))
    keys = named(solid, gen, name)
    operation = "add" if d > 0 else "cut"
    st, warns, _ = combine(state, name, [(solid, keys)], operation, {"target": f.body}, None)
    return st, warns


KINDS = {
    "sketch": f_sketch,
    "extrude": f_extrude,
    "revolve": f_revolve,
    "primitive": f_primitive,
    "hole": f_hole,
    "fillet": f_fillet,
    "chamfer": f_chamfer,
    "shell": f_shell,
    "pattern_linear": f_pattern_linear,
    "pattern_circular": f_pattern_circular,
    "mirror": f_mirror,
    "boolean": f_boolean,
    "transform": f_transform,
    "import_step": f_import_step,
    "push_pull": f_push_pull,
}


def apply(state, feature, ctx):
    kind = feature.get("kind")
    fn = KINDS.get(kind)
    if fn is None:
        raise invalid("Unknown feature kind " + repr(kind) + ". Kinds: " + ", ".join(KINDS))
    params = feature.get("params") or {}
    if not isinstance(params, dict):
        raise invalid("params must be an object")
    return fn(state, feature["name"], params, ctx)
