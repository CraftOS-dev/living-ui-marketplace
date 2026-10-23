"""The engine process: one per app data folder, started by the app's hooks.

    cad-engine.exe -I -m cad_engine.server --ipc <dir> [--parent <pid>]

Jobs arrive as JSON files in <dir>/inbox (written to a .tmp name, then
renamed); each result is written to <dir>/outbox/<job id>.json the same way.
The process writes <dir>/ready once the kernel is loaded, refreshes
<dir>/heartbeat every second while idle, and exits when its parent (the
app's PocketBase) is gone, when <dir>/stop appears, or after a long idle
spell (the app starts it again on the next job).
"""

import argparse
import ctypes
import faulthandler
import json
import os
import sys
import time
import traceback

ENGINE_IDLE_EXIT_S = 20 * 60


def log(*parts):
    sys.stderr.write("[cad-engine] " + " ".join(str(p) for p in parts) + "\n")
    sys.stderr.flush()


def parent_alive(pid):
    if pid <= 0:
        return True
    k = ctypes.windll.kernel32
    h = k.OpenProcess(0x1000, False, pid)
    if not h:
        return False
    code = ctypes.c_ulong()
    ok = k.GetExitCodeProcess(h, ctypes.byref(code))
    k.CloseHandle(h)
    return bool(ok) and code.value == 259


def write_atomic(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(data)
    # Windows refuses the rename while the app has the target open for a
    # read (a sharing violation); that lasts microseconds, so try again.
    for attempt in range(100):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == 99:
                raise
            time.sleep(0.01)


def beat(ipc):
    """Refresh the heartbeat. A missed beat is harmless (the app allows a few seconds)."""
    try:
        write_atomic(os.path.join(ipc, "heartbeat"), str(time.time()))
    except OSError as err:
        log("heartbeat skipped:", err)


def handle(job):
    from . import build, geom, measure, mesh, render, step_io
    from .errors import CadError
    from .topology import topology

    kind = job.get("kind")
    if kind == "ping":
        from . import ENGINE_VERSION

        return {"engine": "cad-engine " + ENGINE_VERSION, "kernel": "OpenCascade " + _occt_version()}
    if kind == "build":
        return build.build(job)

    opts = job.get("options") or {}
    run = build.state_for(job)
    state = run.state
    failed = run.failed
    base = {"failed_at": failed.get("feature") if failed else None}
    if kind == "properties":
        return dict(base, **measure.properties(state, opts.get("density")))
    if kind == "measure":
        return dict(base, **measure.measure(state, opts.get("a"), opts.get("b")))
    if kind == "check":
        return dict(base, **measure.check(state))
    if kind == "resolve":
        return dict(base, **measure.resolve(state, opts.get("ref")))
    if kind == "render":
        topo = topology(state)
        m = mesh.tessellate(state, topo)
        views = opts.get("views") or ["iso"]
        for v in views:
            if v not in render.VIEWS:
                raise CadError("param_invalid", "unknown view " + repr(v) + ". Views: " + ", ".join(render.VIEWS))
        hf = set()
        he = set()
        for k in opts.get("highlight") or []:
            if k in topo.face_by_key:
                hf.add(topo.face_by_key[k].i)
            elif k in topo.edge_by_key:
                he.add(topo.edge_by_key[k].i)
            else:
                hit = [f.i for f in topo.faces if f.base == k] + [e.i for e in topo.edges if e.base == k]
                if not hit:
                    raise CadError("param_invalid", "highlight: nothing has the key " + repr(k))
                for f in topo.faces:
                    if f.base == k:
                        hf.add(f.i)
                for e in topo.edges:
                    if e.base == k:
                        he.add(e.i)
        size = int(opts.get("size") or 768)
        size = max(256, min(1600, size))
        os.makedirs(job["out_dir"], exist_ok=True)
        path = os.path.join(job["out_dir"], opts.get("file") or "render.png")
        tiles = render.render(m, views, size, path, hf, he)
        bb = geom.bbox_union([geom.bbox(b.shape) for b in state.bodies.values()])
        return dict(base, path=path, views=tiles, bbox=geom.bbox_dict(bb))
    if kind == "export":
        fmt = opts.get("format")
        if not state.bodies:
            raise CadError("empty_result", "The part has no bodies to export yet.")
        os.makedirs(job["out_dir"], exist_ok=True)
        path = os.path.join(job["out_dir"], opts.get("file") or ("part." + fmt))
        name = opts.get("name") or "part"
        info = {}
        if fmt == "step":
            step_io.write_step(state, path, name)
            back = step_io.read_volume(path)
            vol = sum(geom.volume(b.shape) for b in state.bodies.values())
            info["volume_mm3"] = geom.rnd(vol, 4)
            info["reread_volume_mm3"] = geom.rnd(back, 4) if back is not None else None
            info["verified"] = back is not None and abs(back - vol) <= max(1e-3, vol * 1e-6)
        else:
            tol = opts.get("tolerance")
            topo = topology(state)
            m = mesh.tessellate(state, topo, tolerance=tol if tol else 0.02)
            if fmt == "stl":
                info["triangles"] = mesh.write_stl(m, path, name)
            elif fmt == "3mf":
                info["triangles"] = mesh.write_3mf(m, path, name)
            elif fmt == "glb":
                info["triangles"] = mesh.write_glb(m, path, name)
            else:
                raise CadError("param_invalid", "format must be step, stl, 3mf or glb")
        info["path"] = path
        info["bytes"] = os.path.getsize(path)
        return dict(base, **info)
    if kind == "compare":
        return dict(base, **compare(job, state))
    raise CadError("param_invalid", "unknown job kind " + repr(kind))


def compare(job, after):
    """What a change added and removed: two meshes and the volumes."""
    from . import build, geom, mesh
    from .features import boolean
    from .state import Body, State
    from .topology import topology

    before_run = build.run_tree(job.get("tree_before") or {}, build.job_ctx(job))
    before = before_run.state

    def union(st):
        shapes = [b.shape for b in st.bodies.values()]
        if not shapes:
            return None
        return shapes[0] if len(shapes) == 1 else geom.compound(shapes)

    a = union(before)
    b = union(after)
    out = {"files": {}}
    os.makedirs(job["out_dir"], exist_ok=True)
    pieces = {}
    if a is not None and b is not None:
        added, _ = boolean("cut", b, [a], "compare")
        removed, _ = boolean("cut", a, [b], "compare")
        pieces = {"added": added, "removed": removed}
    elif b is not None:
        pieces = {"added": b}
    elif a is not None:
        pieces = {"removed": a}
    for label, shape in pieces.items():
        vol = geom.volume(shape) if shape is not None else 0.0
        out[label + "_mm3"] = geom.rnd(vol, 4)
        norm = geom.normalize(shape) if shape is not None else None
        if norm is None or vol <= 1e-6:
            continue
        st = State({label: Body(label, norm, ["compare." + label] * len(geom.faces(norm)), "compare")})
        topo = topology(st)
        m = mesh.tessellate(st, topo)
        path = os.path.join(job["out_dir"], label + ".bin")
        mesh.write_view(m, path, geom.bbox_dict(geom.bbox(norm)))
        out["files"][label] = label + ".bin"
    out["before_mm3"] = geom.rnd(geom.volume(a), 4) if a is not None else 0.0
    out["after_mm3"] = geom.rnd(geom.volume(b), 4) if b is not None else 0.0
    return out


def _occt_version():
    import OCP

    # OCP is versioned as the OCCT release it binds plus its own build number.
    return ".".join(str(OCP.__version__).split(".")[:3])


# Windows briefly refuses access to a file that was just written or renamed
# (a virus scan holds it open), so file access is retried for a while.
ACCESS_RETRY_S = 10.0

# Jobs already run whose file could not be removed yet (never run twice).
_taken = set()


def _remove(path):
    deadline = time.monotonic() + 2.0
    while True:
        try:
            os.remove(path)
            return True
        except FileNotFoundError:
            return True
        except PermissionError:
            if time.monotonic() > deadline:
                return False
            time.sleep(0.02)


def read_job(path):
    """Read a job file and take it out of the inbox."""
    deadline = time.monotonic() + ACCESS_RETRY_S
    while True:
        try:
            with open(path, "r", encoding="utf-8") as f:
                text = f.read()
            break
        except PermissionError:
            if time.monotonic() > deadline:
                raise
            time.sleep(0.02)
    if not _remove(path):
        _taken.add(path)
    return json.loads(text)


def process(path, outbox):
    started = time.perf_counter()
    name_id = os.path.basename(path)[:-5]
    try:
        job = read_job(path)
    except (OSError, ValueError) as e:
        # Answer anyway: the app is waiting for this job's result.
        log("unreadable job", path, e)
        if not _remove(path):
            _taken.add(path)
        result = {"id": name_id, "ok": False, "error": {"code": "kernel_failed", "message": "The engine could not read this job (" + str(e) + "). Try again."}, "ms": 0}
        write_atomic(os.path.join(outbox, name_id + ".json"), json.dumps(result, separators=(",", ":")))
        return
    jid = str(job.get("id") or name_id)
    from .errors import CadError

    log("job", jid, job.get("kind"), "started")
    # A job that runs this long is stuck somewhere; write where to the log.
    faulthandler.dump_traceback_later(45, repeat=True, file=sys.stderr)

    try:
        result = {"id": jid, "ok": True, "result": handle(job)}
    except CadError as e:
        result = {"id": jid, "ok": False, "error": e.to_dict()}
    except Exception as e:
        log("job", jid, "failed:", traceback.format_exc())
        result = {"id": jid, "ok": False, "error": {"code": "kernel_failed", "message": "The engine failed on this job: " + (str(e).strip() or type(e).__name__)}}
    faulthandler.cancel_dump_traceback_later()
    result["ms"] = round((time.perf_counter() - started) * 1000.0, 1)
    write_atomic(os.path.join(outbox, jid + ".json"), json.dumps(result, separators=(",", ":")))
    log("job", jid, job.get("kind"), "done in", result["ms"], "ms")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ipc", required=True)
    ap.add_argument("--parent", type=int, default=0, help="the process to outlive (default: the one that started the engine)")
    args = ap.parse_args()
    parent = args.parent or os.getppid()
    ipc = args.ipc
    inbox = os.path.join(ipc, "inbox")
    outbox = os.path.join(ipc, "outbox")
    os.makedirs(inbox, exist_ok=True)
    os.makedirs(outbox, exist_ok=True)
    t = time.perf_counter()
    # Load the kernel before announcing readiness.
    from . import build  # noqa: F401
    from . import ENGINE_VERSION

    write_atomic(os.path.join(ipc, "ready"), json.dumps({"pid": os.getpid(), "version": ENGINE_VERSION, "load_ms": round((time.perf_counter() - t) * 1000.0)}))
    log("ready in", round((time.perf_counter() - t) * 1000.0), "ms, pid", os.getpid())
    last_job = time.time()
    last_beat = 0.0
    last_parent = 0.0
    while True:
        now = time.time()
        if now - last_beat >= 1.0:
            beat(ipc)
            last_beat = now
        if now - last_parent >= 2.0:
            last_parent = now
            if not parent_alive(parent):
                log("the app is gone; exiting")
                return
        if os.path.exists(os.path.join(ipc, "stop")):
            log("stop requested; exiting")
            return
        try:
            names = sorted(n for n in os.listdir(inbox) if n.endswith(".json"))
        except OSError:
            names = []
        if _taken:
            for path in list(_taken):
                if _remove(path):
                    _taken.discard(path)
            names = [n for n in names if os.path.join(inbox, n) not in _taken]
        if not names:
            if now - last_job > ENGINE_IDLE_EXIT_S:
                log("idle; exiting")
                return
            time.sleep(0.01)
            continue
        for n in names:
            process(os.path.join(inbox, n), outbox)
            last_job = time.time()
            beat(ipc)
            last_beat = time.time()


if __name__ == "__main__":
    main()
