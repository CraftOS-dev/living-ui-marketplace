"""Disk space (plan §16.5). Each run sends the usage of every real filesystem
as a signal, so the console can see the trend ("full in about 6 days") without
filling the change history with "61% → 62%". The list of filesystems itself
is an observation (a new disk appearing is a change worth keeping)."""

from __future__ import annotations

import os
import shutil
import time

from ..util import SYSTEM, read_text, run
from .base import Collector, Unavailable

PSEUDO = {"proc", "sysfs", "devtmpfs", "devpts", "cgroup", "cgroup2", "securityfs", "pstore", "bpf", "tracefs", "debugfs",
          "mqueue", "hugetlbfs", "configfs", "fusectl", "autofs", "binfmt_misc", "nsfs", "squashfs", "ramfs", "efivarfs",
          "rpc_pipefs", "nfsd", "selinuxfs", "fuse.lxcfs", "overlay", "shm"}
SYSTEM_PREFIXES = ("/proc", "/sys", "/dev", "/run", "/var/lib/docker", "/var/lib/containers", "/snap", "/boot/efi", "/etc/")
MIN_BYTES = 16 * 1024 * 1024


def parse_mounts(text: str) -> list[tuple[str, str, str]]:
    """/proc/mounts → [(device, mountpoint, fstype)] for filesystems worth watching."""
    out, seen = [], set()
    for line in text.splitlines():
        parts = line.split()
        if len(parts) < 3:
            continue
        dev, mnt, fs = parts[0], parts[1].replace("\\040", " "), parts[2]
        if fs in PSEUDO and not (fs == "overlay" and mnt == "/"):
            continue
        # Docker's own disk image (Unraid's docker.img) is a disk that fills up: keep it.
        if mnt != "/" and mnt != "/var/lib/docker" and mnt.startswith(SYSTEM_PREFIXES):
            continue
        if fs == "tmpfs" and mnt in ("/tmp", "/dev/shm"):
            continue
        if mnt in seen:
            continue
        seen.add(mnt)
        out.append((dev, mnt, fs))
    return out


def _mounts() -> list[tuple[str, str, str]]:
    if SYSTEM == "linux":
        return parse_mounts(read_text("/proc/mounts") or "")
    if SYSTEM == "windows":
        return [(d, d, "ntfs") for d in (f"{c}:\\" for c in "CDEFGHIJKLMNOPQRSTUVWXYZ") if os.path.exists(d)]
    code, out = run(["mount"])
    return [(p.split(" on ")[0], p.split(" on ")[1].split(" (")[0], "apfs") for p in out.splitlines() if " on /" in p and "/System/Volumes/" not in p] if code == 0 else [("/", "/", "apfs")]


def usages() -> list[tuple[str, str, str, object]]:
    """Every watched filesystem with its usage: [(device, mountpoint, fstype, shutil usage)]."""
    out, seen = [], set()
    # NETSENTRY_SKIP_MOUNTS="/mnt/scratch,/media/usb": mounts the owner doesn't want watched.
    skip = {m.strip().rstrip("/") or "/" for m in os.environ.get("NETSENTRY_SKIP_MOUNTS", "").split(",") if m.strip()}
    for dev, mnt, fs in _mounts():
        if mnt in skip or any(mnt.startswith(s + "/") for s in skip if s != "/"):
            continue
        if not os.path.isdir(mnt):
            continue  # a single file bind-mounted into a container is not a disk
        try:
            u = shutil.disk_usage(mnt)
        except OSError:
            continue
        if u.total < MIN_BYTES or (dev, u.total) in seen:
            continue  # too small, or the same disk mounted again (bind mounts)
        seen.add((dev, u.total))
        out.append((dev, mnt, fs, u))
    return out


class Storage(Collector):
    id = "host.storage"

    def collect(self) -> dict:
        obs, signals = [], []
        minute = time.strftime("%Y-%m-%dT%H:%M:00Z", time.gmtime())
        for dev, mnt, fs, u in usages():
            obs.append({"kind": "host.filesystem", "subject": mnt, "data": {"device": dev[:120], "fs": fs, "total_gb": round(u.total / 1e9, 1)}})
            signals.append({"kind": "storage.usage", "key": mnt, "window_start": minute, "count": 1,
                            "data": {"used": u.used, "total": u.total, "free": u.free}})
        if not obs:
            raise Unavailable("no filesystems found")
        return {"observations": obs, "signals": signals}
