"""Programs running on THIS server (v4 plan §7.6): the busiest ones, which app they belong to, and Stop.

A stop is bound to the program the person saw (pid + start time + name, so a reused pid is
refused), never reaches what keeps the server reachable, Docker or NetSentry itself (N-B16), and
never a program inside an app's container (stop or restart the app instead). TERM first; KILL
after 10 seconds if it's still there.
"""

from __future__ import annotations

import os
import re
import signal
import time

from .util import SYSTEM, as_list, powershell_json

SAMPLE_SECONDS = 0.5
TOP = 40
PROTECTED = {
    "systemd", "init", "sshd", "sshd-session", "dockerd", "containerd", "containerd-shim", "containerd-shim-runc-v2", "docker-proxy", "runc",
    "systemd-journald", "systemd-logind", "systemd-udevd", "systemd-networkd", "systemd-resolved", "systemd-timesyncd", "dbus-daemon", "dbus-broker",
    "agetty", "login", "polkitd", "networkmanager", "wpa_supplicant", "dhclient", "dhcpcd", "pocketbase", "tailscaled", "cloudflared", "chronyd",
    "rsyslogd", "auditd", "udevd", "kubelet", "snapd", "multipathd", "netsentry-sensor",
    # Windows
    "system", "idle", "registry", "smss", "csrss", "wininit", "winlogon", "services", "lsass", "svchost", "fontdrvhost", "dwm", "memory compression",
    "msmpeng", "sihost", "spoolsv", "lsaiso",
}


class ProcFailed(Exception):
    pass


def _stat(pid: str) -> dict | None:
    try:
        with open(f"/proc/{pid}/stat", encoding="utf-8", errors="replace") as f:
            raw = f.read()
    except OSError:
        return None
    m = re.match(r"^(\d+) \((.*)\) (\S) (.*)$", raw.strip(), re.S)
    if not m:
        return None
    rest = m.group(4).split()
    # rest[0] = ppid (field 4); utime = field 14, stime = 15, starttime = 22, rss = 24
    return {"pid": int(m.group(1)), "name": m.group(2), "state": m.group(3), "ppid": int(rest[0]),
            "cpu": int(rest[10]) + int(rest[11]), "start": int(rest[18]), "rss_pages": int(rest[20])}


def _cgroup_container(pid) -> str:
    try:
        with open(f"/proc/{pid}/cgroup", encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return ""
    m = re.search(r"(?:docker[-/]|containerd[-/]|libpod-)([0-9a-f]{64})", text)
    return m.group(1) if m else ""


def _container_of(pid: int) -> str:
    """The app container a program runs in — '' on the server itself. A monitor that runs in a
    container itself looks after what runs beside it: its own container counts as the server."""
    cid = _cgroup_container(pid)
    return "" if cid and cid == _cgroup_container("self") else cid


def _user(pid: int) -> str:
    try:
        with open(f"/proc/{pid}/status", encoding="utf-8") as f:
            for line in f:
                if line.startswith("Uid:"):
                    uid = int(line.split()[1])
                    try:
                        import pwd
                        return pwd.getpwuid(uid).pw_name
                    except (KeyError, ImportError):
                        return str(uid)
    except OSError:
        pass
    return ""


def _cmdline(pid: int) -> str:
    from .logs import mask
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            raw = f.read().replace(b"\x00", b" ").decode("utf-8", "replace").strip()
    except OSError:
        return ""
    return mask(raw)[:240]


def _names() -> dict[str, str]:
    """Container id → the app's container name."""
    try:
        from .collectors.containers import DockerApi
        api = DockerApi()
        if not api.available:
            return {}
        return {c["Id"]: (c.get("Names") or ["?"])[0].lstrip("/") for c in api.json("/containers/json")}
    except Exception:
        return {}


def _mine() -> set[int]:
    """The monitor and its parents (stopping them would stop NetSentry)."""
    out, pid = set(), os.getpid()
    for _ in range(12):
        out.add(pid)
        s = _stat(str(pid)) if SYSTEM == "linux" else None
        if not s or s["ppid"] <= 1:
            break
        pid = s["ppid"]
    return out


def protected(name: str, pid: int, ppid: int, cmdline: str = "") -> str:
    """Why a program may not be stopped through NetSentry ('' when it may)."""
    if pid in (0, 1) or ppid in (0, 2):
        return "it is part of the operating system"
    if name.lower() in PROTECTED or name.lower().removesuffix(".exe") in PROTECTED:
        return "it keeps the server reachable, safe or running"
    if "netsentry_sensor" in cmdline or pid in _mine():
        return "it is NetSentry itself"
    return ""


def listing(params: dict) -> dict:
    if SYSTEM == "windows":
        rows = as_list(powershell_json(
            f"Get-Process | Sort-Object CPU -Descending | Select-Object -First {TOP} Id,ProcessName,CPU,WorkingSet64,"
            "@{n='Start';e={try{$_.StartTime.ToString('o')}catch{''}}} | ConvertTo-Json -Compress"))
        procs = [{"pid": r.get("Id"), "name": r.get("ProcessName"), "cpu_seconds": round(float(r.get("CPU") or 0), 1), "memory": int(r.get("WorkingSet64") or 0),
                  "start": r.get("Start") or "", "user": "", "cmdline": "", "container": "", "protected": protected(str(r.get("ProcessName") or ""), int(r.get("Id") or 0), -1)} for r in rows]
        return {"processes": procs, "cpu_note": "processor time used since it started (Windows)"}
    if SYSTEM != "linux":
        raise ProcFailed("programs can be listed on Linux and Windows")
    ticks = os.sysconf("SC_CLK_TCK")
    page = os.sysconf("SC_PAGE_SIZE")
    first = {p: _stat(p) for p in os.listdir("/proc") if p.isdigit()}
    time.sleep(SAMPLE_SECONDS)
    rows = []
    for p, a in first.items():
        b = _stat(p)
        if not a or not b or b["start"] != a["start"] or b["ppid"] == 2 or b["pid"] == 2:
            continue
        rows.append(dict(b, cpu_pct=round(100.0 * (b["cpu"] - a["cpu"]) / (ticks * SAMPLE_SECONDS), 1), memory=b["rss_pages"] * page))
    rows.sort(key=lambda r: (-r["cpu_pct"], -r["memory"]))
    names = _names()
    out = []
    for r in rows[:TOP]:
        cid = _container_of(r["pid"])
        cmd = _cmdline(r["pid"])
        app = next((n for i, n in names.items() if i == cid), "") if cid else ""
        out.append({"pid": r["pid"], "name": r["name"], "cpu_pct": r["cpu_pct"], "memory": r["memory"], "start": str(r["start"]), "user": _user(r["pid"]),
                    "cmdline": cmd, "container": app or (cid[:12] if cid else ""), "protected": protected(r["name"], r["pid"], r["ppid"], cmd) or ("it runs inside an app — stop or restart the app instead" if cid else "")})
    return {"processes": out, "cpu_note": f"processor use over {SAMPLE_SECONDS} s (100% = one core)"}


def stop(params: dict) -> dict:
    pid, start, name = int(params.get("pid") or 0), str(params.get("start", "")), str(params.get("name", ""))
    if pid <= 1 or not name:
        raise ProcFailed("refused: not a program NetSentry may stop")
    if SYSTEM == "windows":
        r = powershell_json(f"Get-Process -Id {pid} -ErrorAction Stop | Select-Object Id,ProcessName,@{{n='Start';e={{try{{$_.StartTime.ToString('o')}}catch{{''}}}}}} | ConvertTo-Json -Compress")
        if not r or str(r.get("ProcessName")) != name or str(r.get("Start") or "") != start:
            raise ProcFailed("that program isn't running any more (a new one has its number)")
        why = protected(name, pid, -1)
        if why:
            raise ProcFailed(f"refused: {why}")
        from .util import run
        code, _ = run(["powershell", "-NoProfile", "-NonInteractive", "-Command", f"Stop-Process -Id {pid} -ErrorAction Stop"], timeout=30)
        if code != 0:
            raise ProcFailed("Windows refused to stop it")
        return {"note": f"stopped {name} ({pid})"}
    s = _stat(str(pid))
    if not s or s["name"] != name or str(s["start"]) != start:
        raise ProcFailed("that program isn't running any more (a new one has its number)")
    cmd = _cmdline(pid)
    why = protected(name, pid, s["ppid"], cmd)
    if why:
        raise ProcFailed(f"refused: {why}")
    if _container_of(pid):
        raise ProcFailed("refused: it runs inside an app — stop or restart the app instead")
    os.kill(pid, signal.SIGTERM)
    for _ in range(20):
        time.sleep(0.5)
        now = _stat(str(pid))
        if not now or str(now["start"]) != start or now["state"] == "Z":
            return {"note": f"stopped {name} ({pid})"}
    os.kill(pid, signal.SIGKILL)
    time.sleep(2)
    now = _stat(str(pid))
    if now and str(now["start"]) == start and now["state"] != "Z":
        raise ProcFailed(f"{name} didn't stop, even when forced")
    return {"note": f"stopped {name} ({pid}) — it had to be forced after 10 s"}
