"""Tessellation and mesh files: the viewer's view.bin, STL, 3MF and GLB.

view.bin (little endian), read by the app's viewer:
    4 bytes  b"CWV1"
    uint32   header length in bytes (a multiple of 4)
    header   JSON, space padded: nv, nt, nep, faces [[tri_start, tri_count, body]],
             edges [[pt_start, pt_count]], bodies [names], bbox
    float32  positions  nv * 3
    float32  normals    nv * 3
    uint32   indices    nt * 3
    float32  edge points nep * 3 (each edge a polyline)
`faces` and `edges` are in the same order as topology.json, so a picked
triangle or line point maps straight to its face or edge key.
"""

import io
import json
import struct
import zipfile

import numpy as np
from OCP.BRep import BRep_Tool
from OCP.BRepLib import BRepLib_ToolTriangulatedShape
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.TopAbs import TopAbs_REVERSED
from OCP.TopLoc import TopLoc_Location

from . import geom


class Mesh:
    """Triangles per face and polylines per edge, in topology order."""

    def __init__(self):
        self.positions = []
        self.normals = []
        self.indices = []
        self.face_ranges = []
        self.edge_points = []
        self.edge_ranges = []
        self.bodies = []
        self.missing = 0


def deflection_for(state, tolerance=None):
    boxes = [geom.bbox(b.shape, optimal=False) for b in state.bodies.values()]
    bb = geom.bbox_union(boxes)
    diag = geom.norm(geom.sub(bb[1], bb[0])) if bb is not None else 100.0
    if tolerance is not None:
        return tolerance, 0.2
    return max(0.005, min(0.5, diag * 0.0008)), 0.3


def tessellate(state, topo, tolerance=None):
    lin, ang = deflection_for(state, tolerance)
    for body in state.bodies.values():
        BRepMesh_IncrementalMesh(body.shape, lin, False, ang, True)
    m = Mesh()
    m.bodies = list(state.bodies.keys())
    body_index = {n: i for i, n in enumerate(m.bodies)}
    tris_of_face = {}
    for fi in topo.faces:
        face = fi.shape
        loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(face, loc)
        start_tri = len(m.indices) // 3
        if tri is None or tri.NbTriangles() == 0:
            m.missing += 1
            m.face_ranges.append([start_tri, 0, body_index[fi.body]])
            continue
        if not tri.HasNormals():
            BRepLib_ToolTriangulatedShape.ComputeNormals_s(face, tri)
        trsf = loc.Transformation()
        identity = loc.IsIdentity()
        rev = face.Orientation() == TopAbs_REVERSED
        base = len(m.positions) // 3
        nn = tri.NbNodes()
        for i in range(1, nn + 1):
            p = tri.Node(i)
            n = tri.Normal(i)
            if not identity:
                p = p.Transformed(trsf)
                n = n.Transformed(trsf)
            m.positions.extend((p.X(), p.Y(), p.Z()))
            if rev:
                m.normals.extend((-n.X(), -n.Y(), -n.Z()))
            else:
                m.normals.extend((n.X(), n.Y(), n.Z()))
        nt = tri.NbTriangles()
        for i in range(1, nt + 1):
            a, b, c = tri.Triangle(i).Get()
            if rev:
                m.indices.extend((base + a - 1, base + c - 1, base + b - 1))
            else:
                m.indices.extend((base + a - 1, base + b - 1, base + c - 1))
        m.face_ranges.append([start_tri, nt, body_index[fi.body]])
        tris_of_face[fi.i] = (tri, loc)
    for ei in topo.edges:
        start = len(m.edge_points) // 3
        pts = _edge_polyline(ei, topo, tris_of_face, lin, ang)
        for p in pts:
            m.edge_points.extend(p)
        m.edge_ranges.append([start, len(pts)])
    return m


def _edge_polyline(ei, topo, tris_of_face, lin, ang):
    for fidx in ei.faces:
        hit = tris_of_face.get(fidx)
        if hit is None:
            continue
        tri, loc = hit
        poly = BRep_Tool.PolygonOnTriangulation_s(ei.shape, tri, loc)
        if poly is None:
            continue
        nodes = poly.Nodes()
        trsf = loc.Transformation()
        identity = loc.IsIdentity()
        out = []
        for i in range(nodes.Lower(), nodes.Upper() + 1):
            p = tri.Node(nodes.Value(i))
            if not identity:
                p = p.Transformed(trsf)
            out.append((p.X(), p.Y(), p.Z()))
        if len(out) >= 2:
            return out
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.GCPnts import GCPnts_TangentialDeflection

    c = BRepAdaptor_Curve(ei.shape)
    d = GCPnts_TangentialDeflection(c, ang, lin)
    return [geom.tup(d.Value(i)) for i in range(1, d.NbPoints() + 1)]


# ------------------------------------------------------------- view.bin


def write_view(m, path, bbox):
    header = {
        "version": 1,
        "nv": len(m.positions) // 3,
        "nt": len(m.indices) // 3,
        "nep": len(m.edge_points) // 3,
        "faces": m.face_ranges,
        "edges": m.edge_ranges,
        "bodies": m.bodies,
        "bbox": bbox,
    }
    hj = json.dumps(header, separators=(",", ":")).encode("utf-8")
    hj += b" " * ((4 - len(hj) % 4) % 4)
    with open(path, "wb") as f:
        f.write(b"CWV1")
        f.write(struct.pack("<I", len(hj)))
        f.write(hj)
        f.write(np.asarray(m.positions, dtype="<f4").tobytes())
        f.write(np.asarray(m.normals, dtype="<f4").tobytes())
        f.write(np.asarray(m.indices, dtype="<u4").tobytes())
        f.write(np.asarray(m.edge_points, dtype="<f4").tobytes())


# --------------------------------------------------------- mesh exports


def _body_arrays(m, body_idx):
    """Welded vertices and triangles of one body (shared vertices across faces)."""
    pos = np.asarray(m.positions, dtype=np.float64).reshape(-1, 3)
    idx = np.asarray(m.indices, dtype=np.int64).reshape(-1, 3)
    tris = []
    for start, count, b in m.face_ranges:
        if b == body_idx and count > 0:
            tris.append(idx[start : start + count])
    if not tris:
        return np.zeros((0, 3)), np.zeros((0, 3), dtype=np.int64)
    t = np.concatenate(tris)
    used = np.unique(t)
    q = np.round(pos[used] / 1e-5).astype(np.int64)
    _, inverse, first = _unique_rows(q)
    remap = np.empty(pos.shape[0], dtype=np.int64)
    remap[used] = inverse
    verts = pos[used][first]
    tri = remap[t]
    keep = (tri[:, 0] != tri[:, 1]) & (tri[:, 1] != tri[:, 2]) & (tri[:, 0] != tri[:, 2])
    return verts, tri[keep]


def _unique_rows(q):
    uniq, first, inverse = np.unique(q, axis=0, return_index=True, return_inverse=True)
    return uniq, inverse.reshape(-1), first


def write_stl(m, path, name):
    tris = []
    for b in range(len(m.bodies)):
        verts, tri = _body_arrays(m, b)
        if len(tri):
            tris.append(verts[tri])
    data = np.concatenate(tris) if tris else np.zeros((0, 3, 3))
    n = np.cross(data[:, 1] - data[:, 0], data[:, 2] - data[:, 0])
    ln = np.linalg.norm(n, axis=1)
    ln[ln == 0] = 1.0
    n = n / ln[:, None]
    rec = np.zeros(len(data), dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
    rec["n"] = n
    rec["v"] = data
    head = ("CAD Workshop STL " + name).encode("ascii", "replace")[:80].ljust(80, b" ")
    with open(path, "wb") as f:
        f.write(head)
        f.write(struct.pack("<I", len(data)))
        f.write(rec.tobytes())
    return len(data)


def _xml_escape(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def write_3mf(m, path, name):
    objects = []
    items = []
    count = 0
    for b, bname in enumerate(m.bodies):
        verts, tri = _body_arrays(m, b)
        if len(tri) == 0:
            continue
        oid = len(objects) + 1
        vx = "".join('<vertex x="%.6f" y="%.6f" z="%.6f"/>' % (v[0], v[1], v[2]) for v in verts)
        tx = "".join('<triangle v1="%d" v2="%d" v3="%d"/>' % (t[0], t[1], t[2]) for t in tri)
        objects.append('<object id="%d" name="%s" type="model"><mesh><vertices>%s</vertices><triangles>%s</triangles></mesh></object>' % (oid, _xml_escape(bname), vx, tx))
        items.append('<item objectid="%d"/>' % oid)
        count += len(tri)
    model = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
        '<metadata name="Title">' + _xml_escape(name) + "</metadata>"
        '<metadata name="Application">CAD Workshop</metadata>'
        "<resources>" + "".join(objects) + "</resources><build>" + "".join(items) + "</build></model>"
    )
    types = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>'
        "</Types>"
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>'
        "</Relationships>"
    )
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", types)
        z.writestr("_rels/.rels", rels)
        z.writestr("3D/3dmodel.model", model)
    return count


def write_glb(m, path, name):
    """Binary glTF 2.0, one mesh per body. glTF is in metres, so the model is scaled by 0.001."""
    buf = io.BytesIO()
    views = []
    accessors = []
    meshes = []
    nodes = []
    count = 0

    def add_view(data, target):
        off = buf.tell()
        buf.write(data)
        pad = (4 - buf.tell() % 4) % 4
        buf.write(b"\x00" * pad)
        views.append({"buffer": 0, "byteOffset": off, "byteLength": len(data), "target": target})
        return len(views) - 1

    for b, bname in enumerate(m.bodies):
        verts, tri = _body_arrays(m, b)
        if len(tri) == 0:
            continue
        v = (verts * 0.001).astype("<f4")
        nrm = _vertex_normals(verts, tri).astype("<f4")
        idx = tri.astype("<u4").reshape(-1)
        pv = add_view(v.tobytes(), 34962)
        nv = add_view(nrm.tobytes(), 34962)
        iv = add_view(idx.tobytes(), 34963)
        a0 = len(accessors)
        accessors.append({"bufferView": pv, "componentType": 5126, "count": len(v), "type": "VEC3", "min": v.min(axis=0).tolist(), "max": v.max(axis=0).tolist()})
        accessors.append({"bufferView": nv, "componentType": 5126, "count": len(nrm), "type": "VEC3"})
        accessors.append({"bufferView": iv, "componentType": 5125, "count": len(idx), "type": "SCALAR"})
        meshes.append({"name": bname, "primitives": [{"attributes": {"POSITION": a0, "NORMAL": a0 + 1}, "indices": a0 + 2, "material": 0}]})
        nodes.append({"name": bname, "mesh": len(meshes) - 1})
        count += len(tri)
    gltf = {
        "asset": {"version": "2.0", "generator": "CAD Workshop"},
        "scene": 0,
        "scenes": [{"name": name, "nodes": list(range(len(nodes)))}],
        "nodes": nodes,
        "meshes": meshes,
        "materials": [{"name": "body", "pbrMetallicRoughness": {"baseColorFactor": [0.72, 0.74, 0.78, 1.0], "metallicFactor": 0.1, "roughnessFactor": 0.6}}],
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"byteLength": buf.tell()}],
    }
    js = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    js += b" " * ((4 - len(js) % 4) % 4)
    bin_data = buf.getvalue()
    total = 12 + 8 + len(js) + 8 + len(bin_data)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack("<II", len(bin_data), 0x004E4942))
        f.write(bin_data)
    return count


def _vertex_normals(verts, tri):
    n = np.zeros_like(verts)
    fn = np.cross(verts[tri[:, 1]] - verts[tri[:, 0]], verts[tri[:, 2]] - verts[tri[:, 0]])
    for k in range(3):
        np.add.at(n, tri[:, k], fn)
    ln = np.linalg.norm(n, axis=1)
    ln[ln == 0] = 1.0
    return n / ln[:, None]


def triangle_count(m):
    return len(m.indices) // 3

