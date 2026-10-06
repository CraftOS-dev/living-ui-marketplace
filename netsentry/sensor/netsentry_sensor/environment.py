"""Where is this sensor running? Cloud (AWS / GCP / Azure metadata services),
container, and OS facts. Each probe has a 1-second timeout, so a laptop pays
at most a few seconds once at start-up. Used by the console to suggest the
right cloud adapter later — nothing here is sent anywhere else."""

from __future__ import annotations

import os
import platform
import socket
import urllib.request

from .util import SYSTEM, read_text


def _get(url: str, headers: dict, method: str = "GET") -> str | None:
    try:
        req = urllib.request.Request(url, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=1) as r:  # noqa: S310 — fixed metadata URLs
            return r.read(2048).decode("utf-8", "replace")
    except Exception:
        return None


def detect_cloud() -> str | None:
    imds = os.environ.get("NETSENTRY_AWS_IMDS", "http://169.254.169.254/latest")  # lab only: an emulated metadata service
    token = _get(f"{imds}/api/token", {"X-aws-ec2-metadata-token-ttl-seconds": "60"}, "PUT")
    if token and _get(f"{imds}/meta-data/instance-id", {"X-aws-ec2-metadata-token": token}):
        return "aws"
    if _get("http://metadata.google.internal/computeMetadata/v1/instance/id", {"Metadata-Flavor": "Google"}):
        return "gcp"
    if _get("http://169.254.169.254/metadata/instance?api-version=2021-02-01", {"Metadata": "true"}):
        return "azure"
    return None


def in_container() -> bool:
    if os.path.exists("/.dockerenv"):
        return True
    cgroup = read_text("/proc/1/cgroup") or ""
    return any(k in cgroup for k in ("docker", "containerd", "kubepods"))


def describe() -> dict:
    return {
        "cloud": detect_cloud(),
        "container": in_container() if SYSTEM == "linux" else False,
        "os_family": SYSTEM,
        "machine": platform.machine(),
    }


def hostname() -> str:
    return socket.gethostname()


def os_label() -> str:
    if SYSTEM == "linux":
        text = read_text("/etc/os-release") or ""
        for line in text.splitlines():
            if line.startswith("PRETTY_NAME="):
                return line.split("=", 1)[1].strip().strip('"')
    return f"{platform.system()} {platform.release()} ({platform.version()})"
