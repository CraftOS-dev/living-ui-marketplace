"""The engine process: one per app data folder, started by the app's hooks.

    img-engine.exe -I -m img_engine.server --ipc <dir> [--parent <pid>]

Jobs arrive as JSON files in <dir>/inbox (written to a .tmp name, then
renamed); each result is written to <dir>/outbox/<job id>.json the same way.
The process writes <dir>/ready once its libraries are loaded, refreshes
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
    sys.stderr.write("[img-engine] " + " ".join(str(p) for p in parts) + "\n")
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


# The prefix of a Windows long path.
LONG = "\\\\?\\"


def _long_paths(v):
    """Absolute Windows paths near the 260-character limit in their long form
    (the LONG prefix), which every file call accepts; a deep app folder plus a
    long file name would otherwise look like a missing file."""
    if isinstance(v, str):
        if os.name == "nt" and len(v) >= 240 and len(v) < 32000 and v[1:3] == ":\\" and not v.startswith(LONG):
            return LONG + os.path.normpath(v)
        return v
    if isinstance(v, dict):
        return {k: _long_paths(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_long_paths(x) for x in v]
    return v


def _short_paths(v):
    """Answers carry paths in their usual form."""
    if isinstance(v, str):
        return v[len(LONG):] if v.startswith(LONG) else v
    if isinstance(v, dict):
        return {k: _short_paths(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_short_paths(x) for x in v]
    return v


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
        result = {"id": name_id, "ok": False, "error": {"code": "engine_failed", "message": "The engine could not read this job (" + str(e) + "). Try again."}, "ms": 0}
        write_atomic(os.path.join(outbox, name_id + ".json"), json.dumps(result, separators=(",", ":")))
        return
    jid = str(job.get("id") or name_id)
    from .errors import ImgError
    from .jobs import handle

    log("job", jid, job.get("kind"), "started")
    # A job that runs this long is stuck somewhere; write where to the log.
    faulthandler.dump_traceback_later(45, repeat=True, file=sys.stderr)

    try:
        result = {"id": jid, "ok": True, "result": _short_paths(handle(_long_paths(job)))}
    except ImgError as e:
        result = {"id": jid, "ok": False, "error": e.to_dict()}
    except MemoryError:
        log("job", jid, "ran out of memory")
        result = {"id": jid, "ok": False, "error": {"code": "out_of_memory", "message": "The image is too large for this job on this computer; make it smaller first (Resize) and try again."}}
    except Exception as e:
        log("job", jid, "failed:", traceback.format_exc())
        result = {"id": jid, "ok": False, "error": {"code": "engine_failed", "message": "The engine failed on this job: " + (str(e).strip() or type(e).__name__)}}
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
    # Load the libraries before announcing readiness.
    import numpy  # noqa: F401
    from PIL import Image  # noqa: F401

    from . import ENGINE_VERSION, jobs  # noqa: F401

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
