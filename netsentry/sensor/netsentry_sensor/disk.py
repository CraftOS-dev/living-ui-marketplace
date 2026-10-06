"""Disk space (v4 plan §7.5): what uses it, and clean-ups that only ever remove caches.

Clean-ups never touch volumes, people's files, images a container still uses, or the copies
"Roll back" needs (unless the button says so: "roll-back copies older than 3 days").
"""

from __future__ import annotations

import json
import os
import re
import shutil
import time
import urllib.parse

from .util import SYSTEM, run, which

FOLDER_BUDGET_SECONDS = 10
SKIP_FS = {"tmpfs", "devtmpfs", "proc", "sysfs", "cgroup", "cgroup2", "overlay", "squashfs", "nsfs", "autofs", "mqueue", "debugfs", "tracefs", "securityfs", "pstore", "bpf", "configfs", "fusectl", "hugetlbfs", "devpts", "binfmt_misc", "ramfs", "efivarfs", "rpc_pipefs", "nfsd", "fuse.lxcfs", "fuse.portal"}


class CleanupFailed(Exception):
    pass


def filesystems() -> list[dict]:
    out, seen = [], set()
    points: list[tuple[str, str]] = []
    if SYSTEM == "windows":
        try:
            points = [(d, "") for d in os.listdrives()]  # type: ignore[attr-defined]
        except Exception:
            points = [(f"{c}:\\", "") for c in "CDEFGH" if os.path.exists(f"{c}:\\")]
    else:
        try:
            with open("/proc/mounts", encoding="utf-8") as f:
                for line in f:
                    parts = line.split()
                    if len(parts) >= 3 and parts[2] not in SKIP_FS and parts[1].startswith("/"):
                        points.append((parts[1].replace("\\040", " "), parts[2]))
        except OSError:
            points = [("/", "")]
    skip = {m.strip() for m in os.environ.get("NETSENTRY_SKIP_MOUNTS", "").split(",") if m.strip()}
    for mount, fstype in points:
        if mount in skip:
            continue  # the owner said these aren't the server's own disks (e.g. a container's mounts)
        try:
            u = shutil.disk_usage(mount)
        except OSError:
            continue
        key = (u.total, u.used)
        if key in seen or u.total == 0:
            continue
        seen.add(key)
        out.append({"mount": mount, "fs": fstype, "total": u.total, "used": u.used, "free": u.free})
    return sorted(out, key=lambda d: -d["used"])[:12]


def _docker():
    from .collectors.containers import DockerApi
    api = DockerApi()
    return api if api.available else None


def _pinned(img: dict) -> bool:
    return any(str(t).startswith("netsentry-rollback/") for t in img.get("RepoTags") or [])


def docker_usage() -> dict | None:
    api = _docker()
    if not api:
        return None
    df = api.json("/system/df")
    images = df.get("Images") or []
    used = {c.get("ImageID") for c in api.json("/containers/json?all=1")}
    unused = [i for i in images if i.get("Id") not in used and not _pinned(i)]
    cache = df.get("BuildCache") or []
    vols = df.get("Volumes") or []
    return {
        "images": {"count": len(images), "size": sum(int(i.get("Size") or 0) for i in images),
                   "unused": len(unused), "unused_size": sum(int(i.get("Size") or 0) - max(0, int(i.get("SharedSize") or 0)) for i in unused)},
        "rollback_pins": sum(1 for i in images if _pinned(i)),
        "build_cache": {"size": sum(int(b.get("Size") or 0) for b in cache), "reclaimable": sum(int(b.get("Size") or 0) for b in cache if not b.get("InUse"))},
        "volumes": {"count": len(vols), "size": sum(max(0, int((v.get("UsageData") or {}).get("Size") or 0)) for v in vols),
                    "unused": sum(1 for v in vols if int((v.get("UsageData") or {}).get("RefCount") or 0) == 0)},
        "containers_size": sum(int(c.get("SizeRw") or 0) for c in df.get("Containers") or []),
    }


def journal_size() -> int | None:
    if SYSTEM != "linux" or not which("journalctl"):
        return None
    code, out = run(["journalctl", "--disk-usage"], timeout=30)
    m = re.search(r"take up ([\d.]+)\s*([KMGT]?)", out or "")
    if code != 0 or not m:
        return None
    return int(float(m.group(1)) * {"": 1, "K": 1e3, "M": 1e6, "G": 1e9, "T": 1e12}[m.group(2)])


def _size(path: str, deadline: float, counter: list) -> int:
    total = 0
    for dirpath, dirnames, names in os.walk(path, onerror=lambda e: None):
        dirnames[:] = [d for d in dirnames if not os.path.islink(os.path.join(dirpath, d))]
        for n in names:
            try:
                total += os.lstat(os.path.join(dirpath, n)).st_size
            except OSError:
                pass
            counter[0] += 1
        if time.time() > deadline:
            counter[1] = True
            break
    return total


def biggest_folders() -> tuple[list[dict], bool]:
    """The biggest folders directly inside each allowed folder (time-limited)."""
    from . import files
    deadline = time.time() + FOLDER_BUDGET_SECONDS
    counter = [0, False]
    out = []
    for r in files.roots():
        if r["path"] == "/etc":
            continue  # settings files: never what fills a disk
        try:
            children = [os.path.join(r["path"], n) for n in os.listdir(r["path"]) if n != files.BIN]
        except OSError:
            continue
        for c in children:
            if time.time() > deadline:
                counter[1] = True
                break
            if os.path.isdir(c) and not os.path.islink(c):
                out.append({"path": c, "size": _size(c, deadline, counter)})
            elif os.path.isfile(c):
                try:
                    out.append({"path": c, "size": os.path.getsize(c)})
                except OSError:
                    pass
    return sorted((x for x in out if x["size"] >= 1_000_000), key=lambda x: -x["size"])[:15], bool(counter[1])


def _dir_size(path: str) -> int:
    return _size(path, time.time() + 5, [0, False]) if path and os.path.isdir(path) else 0


def usage(params: dict) -> dict:
    from . import files, update
    folders, partial = biggest_folders()
    return {
        "filesystems": filesystems(),
        "docker": docker_usage(),
        "journal": journal_size(),
        "folders": folders,
        "folders_partial": partial,
        "netsentry": {"rollback_copies": _dir_size(update.SNAPSHOT_ROOT), "bin": files.bin_size() + _dir_size(os.path.join(files.STATE_DIR or ".", "app-bin"))},
    }


# ------------------------------------------------------------------ clean-ups (executor action)

def _images(api) -> int:
    used = {c.get("ImageID") for c in api.json("/containers/json?all=1")}
    freed = 0
    for img in api.json("/images/json"):
        if img.get("Id") in used or _pinned(img):
            continue
        st, _ = api.send("DELETE", f"/images/{urllib.parse.quote(img['Id'], safe='')}")
        if st == 200:
            freed += max(0, int(img.get("Size") or 0) - max(0, int(img.get("SharedSize") or 0)))
    return freed


def cleanup(params: dict, context: dict | None = None) -> dict:
    what = str(params.get("what", ""))
    if what in ("docker_images", "docker_build_cache"):
        api = _docker()
        if not api:
            raise CleanupFailed("Docker is not reachable from the monitor")
        if what == "docker_images":
            freed = _images(api)
        else:
            st, raw = api.send("POST", "/build/prune")
            if st != 200:
                raise CleanupFailed(f"Docker refused ({st})")
            freed = int((json.loads(raw or b"{}") or {}).get("SpaceReclaimed") or 0)
    elif what == "journal":
        if SYSTEM != "linux" or not which("journalctl"):
            raise CleanupFailed("this server has no systemd journal")
        before = journal_size() or 0
        code, _ = run(["journalctl", "--vacuum-size=200M"], timeout=300)
        if code != 0:
            raise CleanupFailed("journalctl couldn't shrink the journal (the monitor needs to run as root)")
        freed = max(0, before - (journal_size() or 0))
    elif what == "netsentry_rollbacks":
        from . import update
        fixes = (context or {}).get("fixes") or {}
        updates = {rid: e["0"]["state"] for rid, e in fixes.items() if isinstance(e, dict) and (e.get("0") or {}).get("action") == "app.update"}
        before = _dir_size(update.SNAPSHOT_ROOT)
        # Copies older than 3 days go (housekeeping keeps 14 days; looking 11 days ahead removes those older than 3).
        for rid in update.housekeeping(updates, time.time() + (update.KEEP_DAYS - 3) * 86400):
            fixes.pop(rid, None)
        freed = max(0, before - _dir_size(update.SNAPSHOT_ROOT))
    elif what == "bin":
        from . import files
        app_bin = os.path.join(files.STATE_DIR or ".", "app-bin")
        freed = files.empty_bin() + _dir_size(app_bin)
        shutil.rmtree(app_bin, ignore_errors=True)
    else:
        raise CleanupFailed("refused: not a clean-up NetSentry does")
    return {"what": what, "freed": freed, "note": f"freed {freed / 1e9:.2f} GB" if freed >= 1e8 else f"freed {freed / 1e6:.0f} MB"}
