"""Is the machine running well? (v3 plan §7, M1)

`host.health`    CPU, load, memory, swap, uptime, temperature, reboot needed.
`host.container_stats`  CPU and memory of every running container.
`host.services`  services that failed or keep restarting (systemd, Windows).
`host.disks`     disk health (SMART, ZFS, mdadm) and Docker's own disk use
                 (container logs, Docker's data disk).

Numbers that move every minute are SIGNALS (the console keeps them as
metrics, rolled up over time); what changes rarely (boot time, a failed
service, a failing disk) is an OBSERVATION, so its change history stays short.

When the monitor runs in a container (NAS), mount the host's /proc and set
NETSENTRY_HOST_PROC=/host/proc so these read the machine, not the container.
"""

from __future__ import annotations

import glob
import json
import os
import time

from ..util import SYSTEM, read_text, run, which, powershell_json, as_list
from .base import Collector, Unavailable
from .containers import DockerApi

HOST_PROC = os.environ.get("NETSENTRY_HOST_PROC", "/proc")
HOST_SYS = os.environ.get("NETSENTRY_HOST_SYS", "/sys")


def _minute() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:00Z", time.gmtime())


# ------------------------------------------------------------------ parsing (pure, tested)


def parse_proc_stat(text: str) -> tuple[int, int] | None:
    """/proc/stat → (busy, total) jiffies of the 'cpu' line."""
    for line in text.splitlines():
        if line.startswith("cpu "):
            v = [int(x) for x in line.split()[1:]]
            idle = v[3] + (v[4] if len(v) > 4 else 0)  # idle + iowait
            total = sum(v[:8])  # guest time is already in user
            return total - idle, total
    return None


def cpu_percent(prev: tuple[int, int] | None, cur: tuple[int, int] | None) -> float | None:
    if not prev or not cur:
        return None
    busy, total = cur[0] - prev[0], cur[1] - prev[1]
    if total <= 0 or busy < 0:
        return None
    return round(100.0 * busy / total, 1)


def parse_meminfo(text: str) -> dict:
    """/proc/meminfo → bytes: total, used (total − available), swap_total, swap_used."""
    kv = {}
    for line in text.splitlines():
        name, _, rest = line.partition(":")
        parts = rest.split()
        if parts and parts[0].isdigit():
            kv[name] = int(parts[0]) * 1024
    total = kv.get("MemTotal", 0)
    avail = kv.get("MemAvailable", kv.get("MemFree", 0) + kv.get("Cached", 0))
    return {"mem_total": total, "mem_used": max(0, total - avail),
            "swap_total": kv.get("SwapTotal", 0), "swap_used": max(0, kv.get("SwapTotal", 0) - kv.get("SwapFree", 0))}


def parse_uptime(text: str) -> int | None:
    try:
        return int(float(text.split()[0]))
    except (ValueError, IndexError):
        return None


def hottest(zones: list[tuple[str, int, int | None]]) -> tuple[float | None, float | None]:
    """[(label, millidegrees, crit millidegrees|None)] → (hottest °C, its critical °C)."""
    best = None
    for label, milli, crit in zones:
        if milli is None or milli <= 0 or milli > 150000:
            continue  # unplugged sensors read 0 or nonsense
        if best is None or milli > best[0]:
            best = (milli, crit)
    if best is None:
        return None, None
    return round(best[0] / 1000, 1), (round(best[1] / 1000, 1) if best[1] else None)


def container_cpu(prev: dict | None, stats: dict) -> float | None:
    """CPU % of one container between two one-shot stats readings (100 % = one core busy)."""
    cpu = (stats.get("cpu_stats") or {})
    total = (cpu.get("cpu_usage") or {}).get("total_usage")
    system = cpu.get("system_cpu_usage")
    if total is None:
        return None
    if not prev or prev.get("total") is None:
        return None
    online = cpu.get("online_cpus") or len((cpu.get("cpu_usage") or {}).get("percpu_usage") or []) or 1
    d_total = total - prev["total"]
    if system is not None and prev.get("system") is not None and system - prev["system"] > 0:
        return round(100.0 * d_total / (system - prev["system"]) * online, 1) if d_total >= 0 else None
    d_t = time.time() - prev.get("t", time.time())
    return round(100.0 * d_total / (d_t * 1e9), 1) if d_t > 0 and d_total >= 0 else None


def container_memory(stats: dict) -> tuple[int | None, int | None]:
    """Memory in use (without the page cache the kernel can drop) and the limit."""
    m = stats.get("memory_stats") or {}
    usage = m.get("usage")
    if usage is None:
        return None, None
    s = m.get("stats") or {}
    cache = s.get("inactive_file", s.get("total_inactive_file", s.get("cache", 0))) or 0
    return max(0, usage - cache), m.get("limit")


def parse_systemctl_units(text: str) -> list[dict]:
    """`systemctl list-units --type=service --all --no-legend --plain` → failed or restarting services."""
    out = []
    for line in text.splitlines():
        parts = line.split(None, 4)
        if len(parts) < 4 or not parts[0].endswith(".service"):
            continue
        unit, load, active, sub = parts[:4]
        if active == "failed" or sub == "auto-restart":
            out.append({"unit": unit, "active": active, "sub": sub, "description": (parts[4] if len(parts) > 4 else "")[:120]})
    return out


def parse_systemctl_show(text: str) -> dict:
    kv = dict(line.split("=", 1) for line in text.splitlines() if "=" in line)
    return {"result": kv.get("Result", ""), "exit_status": kv.get("ExecMainStatus", ""),
            "since": kv.get("StateChangeTimestamp", "") or kv.get("InactiveEnterTimestamp", ""),
            "restarts": int(kv.get("NRestarts", "0") or 0)}


def parse_mdstat(text: str) -> list[dict]:
    """/proc/mdstat → [{name, level, state: ok|degraded|rebuilding, detail}]."""
    out, cur = [], None
    for line in text.splitlines():
        if line and not line.startswith(" ") and " : " in line and line.startswith("md"):
            name, _, rest = line.partition(" : ")
            words = rest.split()
            cur = {"name": name.strip(), "level": next((w for w in words if w.startswith("raid")), ""), "state": "ok", "detail": ""}
            out.append(cur)
        elif cur is not None and ("recovery" in line or "resync" in line or "reshape" in line):
            cur["state"] = "rebuilding" if cur["state"] == "ok" else cur["state"]
            cur["detail"] = line.strip()[:120]
        elif cur is not None and "blocks" in line and line.rstrip().endswith("]"):
            tail = line.strip().split()[-1]  # [UU] / [U_]
            if "_" in tail:
                cur["state"] = "degraded"
                cur["detail"] = f"disks {tail}"
    return out


def parse_zpool_list(text: str) -> list[dict]:
    """`zpool list -H -o name,health,capacity` → [{name, health, capacity}]."""
    out = []
    for line in text.splitlines():
        parts = line.split("\t") if "\t" in line else line.split()
        if len(parts) >= 3:
            out.append({"name": parts[0], "health": parts[1], "capacity_pct": int(parts[2].rstrip("%") or 0) if parts[2].rstrip("%").isdigit() else None})
    return out


def parse_smart(data: dict) -> dict:
    """`smartctl -j -a <dev>` JSON → {model, passed, temp, reallocated, pending, hours}."""
    attrs = {a.get("id"): a for a in ((data.get("ata_smart_attributes") or {}).get("table") or [])}
    raw = lambda i: ((attrs.get(i) or {}).get("raw") or {}).get("value")
    nvme = data.get("nvme_smart_health_information_log") or {}
    status = data.get("smart_status") or {}
    return {
        "model": (data.get("model_name") or data.get("model_family") or "")[:80],
        "serial_tail": str(data.get("serial_number") or "")[-4:],
        "passed": status.get("passed") if "passed" in status else None,
        "reallocated": raw(5),
        "pending": raw(197),
        "uncorrectable": raw(198),
        "media_errors": nvme.get("media_errors"),
        "percent_used": nvme.get("percentage_used"),
        # Power-on years, not hours: an observation that changed every run would bury real changes.
        "years": round(((data.get("power_on_time") or {}).get("hours") or 0) / 8766, 1),
    }


def smart_verdict(s: dict) -> str:
    """ok | warning | failing — failing when the drive itself says so or sectors are going bad."""
    if s.get("passed") is False:
        return "failing"
    if (s.get("pending") or 0) > 0 or (s.get("uncorrectable") or 0) > 0 or (s.get("media_errors") or 0) > 0:
        return "failing"
    if (s.get("reallocated") or 0) > 0 or (s.get("percent_used") or 0) >= 90:
        return "warning"
    return "ok"


# ------------------------------------------------------------------ readers


def _linux_temps() -> list[tuple[str, int, int | None]]:
    zones = []
    for hw in glob.glob(f"{HOST_SYS}/class/hwmon/hwmon*"):
        name = (read_text(f"{hw}/name") or "").strip()
        if name not in ("coretemp", "k10temp", "zenpower", "cpu_thermal", "acpitz", "soc_thermal"):
            continue
        for inp in glob.glob(f"{hw}/temp*_input"):
            crit = read_text(inp.replace("_input", "_crit"))
            try:
                zones.append((name, int((read_text(inp) or "0").strip()), int(crit.strip()) if crit and crit.strip().isdigit() else None))
            except ValueError:
                continue
    if not zones:
        for z in glob.glob(f"{HOST_SYS}/class/thermal/thermal_zone*"):
            t = (read_text(f"{z}/temp") or "").strip()
            if t.isdigit():
                zones.append(((read_text(f"{z}/type") or "").strip(), int(t), None))
    return zones


def _reboot_required() -> bool | None:
    if SYSTEM == "linux":
        root = os.path.dirname(HOST_PROC.rstrip("/")) if HOST_PROC != "/proc" else ""
        if os.path.exists(f"{root}/var/run/reboot-required") or os.path.exists(f"{root}/run/reboot-required"):
            return True
        if which("needs-restarting"):  # RHEL family
            code, _ = run(["needs-restarting", "-r"], timeout=30)
            return code == 1
        return False
    if SYSTEM == "windows":
        try:
            import winreg
            for path in (r"SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending",
                         r"SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired"):
                try:
                    winreg.CloseKey(winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, path))
                    return True
                except OSError:
                    continue
            return False
        except Exception:
            return None
    return None


def _windows_sample() -> dict:
    import ctypes
    from ctypes import wintypes

    class FILETIME(ctypes.Structure):
        _fields_ = [("lo", wintypes.DWORD), ("hi", wintypes.DWORD)]

    class MEMSTAT(ctypes.Structure):
        _fields_ = [("dwLength", wintypes.DWORD), ("dwMemoryLoad", wintypes.DWORD), ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong), ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong), ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]

    k32 = ctypes.windll.kernel32
    idle, kern, user = FILETIME(), FILETIME(), FILETIME()
    k32.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kern), ctypes.byref(user))
    v = lambda f: (f.hi << 32) | f.lo
    total = v(kern) + v(user)  # kernel time includes idle
    m = MEMSTAT()
    m.dwLength = ctypes.sizeof(MEMSTAT)
    k32.GlobalMemoryStatusEx(ctypes.byref(m))
    k32.GetTickCount64.restype = ctypes.c_ulonglong
    swap_total = max(0, m.ullTotalPageFile - m.ullTotalPhys)
    swap_used = max(0, (m.ullTotalPageFile - m.ullAvailPageFile) - (m.ullTotalPhys - m.ullAvailPhys))
    return {"cpu_ticks": (total - v(idle), total), "mem_total": m.ullTotalPhys, "mem_used": m.ullTotalPhys - m.ullAvailPhys,
            "swap_total": swap_total, "swap_used": min(swap_used, swap_total), "uptime_s": int(k32.GetTickCount64() // 1000)}


def _darwin_sample() -> dict:
    out = {}
    code, text = run(["sysctl", "-n", "hw.memsize", "kern.boottime"])
    if code == 0:
        lines = text.splitlines()
        if lines and lines[0].strip().isdigit():
            out["mem_total"] = int(lines[0])
        if len(lines) > 1 and "sec = " in lines[1]:
            out["uptime_s"] = int(time.time()) - int(lines[1].split("sec = ")[1].split(",")[0])
    code, text = run(["vm_stat"])
    if code == 0 and "mem_total" in out:
        page = 16384 if "page size of 16384" in text else 4096
        kv = {l.split(":")[0].strip(): int(l.split(":")[1].strip().rstrip(".")) for l in text.splitlines()[1:] if ":" in l and l.split(":")[1].strip().rstrip(".").isdigit()}
        free = (kv.get("Pages free", 0) + kv.get("Pages inactive", 0) + kv.get("Pages speculative", 0)) * page
        out["mem_used"] = max(0, out["mem_total"] - free)
    return out


# ------------------------------------------------------------------ collectors


class HostHealth(Collector):
    id = "host.health"

    def collect(self) -> dict:
        s: dict = {}
        if SYSTEM == "linux":
            ticks = parse_proc_stat(read_text(f"{HOST_PROC}/stat") or "")
            if ticks is None:
                raise Unavailable("cannot read /proc/stat")
            s["cpu"] = cpu_percent(tuple(self.state.get("ticks") or ()) or None, ticks)
            self.state["ticks"] = list(ticks)
            s.update(parse_meminfo(read_text(f"{HOST_PROC}/meminfo") or ""))
            s["uptime_s"] = parse_uptime(read_text(f"{HOST_PROC}/uptime") or "")
            load = (read_text(f"{HOST_PROC}/loadavg") or "").split()
            s["load1"] = float(load[0]) if load else None
            s["cores"] = os.cpu_count()
            s["temp_c"], s["temp_crit"] = hottest(_linux_temps())
        elif SYSTEM == "windows":
            w = _windows_sample()
            ticks = w.pop("cpu_ticks")
            s["cpu"] = cpu_percent(tuple(self.state.get("ticks") or ()) or None, ticks)
            self.state["ticks"] = list(ticks)
            s.update(w)
            s["cores"] = os.cpu_count()
        else:
            s.update(_darwin_sample())
            try:
                s["load1"] = round(os.getloadavg()[0], 2)
            except OSError:
                pass
            s["cores"] = os.cpu_count()
        boot = int(time.time() - s["uptime_s"]) if s.get("uptime_s") else None
        # Boot time to the minute: the same boot must not look like a change every run.
        boot_iso = time.strftime("%Y-%m-%dT%H:%M:00Z", time.gmtime(boot - boot % 60)) if boot else ""
        obs = [{"kind": "host.health", "subject": "machine",
                "data": {"booted_at": boot_iso, "cores": s.get("cores"), "mem_total": s.get("mem_total"),
                         "reboot_required": _reboot_required()}}]
        sample = {k: s.get(k) for k in ("cpu", "load1", "mem_used", "mem_total", "swap_used", "swap_total", "uptime_s", "temp_c", "temp_crit")}
        return {"observations": obs, "signals": [{"kind": "health.sample", "key": "machine", "window_start": _minute(), "count": 1, "data": sample}]}


class ContainerStats(Collector):
    id = "host.container_stats"
    MAX = 60

    def collect(self) -> dict:
        api = DockerApi()
        if not api.available:
            raise Unavailable("Docker's API isn't reachable from the monitor (container numbers need it)")
        everything = api.json("/containers/json?all=1")[: self.MAX]
        prev = self.state.get("prev") or {}
        nxt, signals = {}, []
        minute = _minute()
        for c in everything:
            name = (c.get("Names") or ["/?"])[0].lstrip("/")
            # Every container's state and restart count, each minute: a crash loop shows here first.
            try:
                inspect = api.json(f"/containers/{c['Id']}/json")
            except Unavailable:
                continue
            state = (inspect.get("State") or {}).get("Status", "")
            restarts = int(inspect.get("RestartCount") or 0)
            if state != "running":
                signals.append({"kind": "container.sample", "key": name, "window_start": minute, "count": 1, "data": {"state": state, "restarts": restarts}})
                continue
            status, body = api.get(f"/containers/{c['Id']}/stats?stream=false&one-shot=true")
            if status != 200:
                continue
            try:
                stats = json.loads(body)
            except ValueError:
                continue
            cpu_stats = stats.get("cpu_stats") or {}
            nxt[name] = {"total": (cpu_stats.get("cpu_usage") or {}).get("total_usage"), "system": cpu_stats.get("system_cpu_usage"), "t": time.time()}
            mem, limit = container_memory(stats)
            signals.append({"kind": "container.sample", "key": name, "window_start": minute, "count": 1,
                            "data": {"cpu": container_cpu(prev.get(name), stats), "mem": mem, "mem_limit": limit, "state": state, "restarts": restarts}})
        self.state["prev"] = nxt
        return {"observations": [], "signals": signals}


class Services(Collector):
    id = "host.services"
    platforms = ("linux", "windows")

    def collect(self) -> dict:
        obs = []
        if SYSTEM == "linux":
            if not which("systemctl"):
                raise Unavailable("this server doesn't use systemd")
            code, out = run(["systemctl", "list-units", "--type=service", "--all", "--no-legend", "--plain", "--no-pager"])
            if code != 0:
                raise Unavailable("systemctl didn't answer")
            for u in parse_systemctl_units(out)[:50]:
                _, more = run(["systemctl", "show", u["unit"], "-p", "Result,ExecMainStatus,StateChangeTimestamp,NRestarts", "--no-pager"])
                u.update(parse_systemctl_show(more))
                obs.append({"kind": "service.problem", "subject": u["unit"], "data": u})
        else:
            rows = powershell_json(
                "Get-CimInstance Win32_Service -Filter \"StartMode='Auto' AND State<>'Running'\" | "
                "Select-Object Name,DisplayName,State,ExitCode,DelayedAutoStart | ConvertTo-Json -Compress")
            for r in as_list(rows):
                code = r.get("ExitCode") or 0
                # 0 = stopped cleanly (many trigger-start services do), 1077 = never started: not failures.
                if code in (0, 1077):
                    continue
                obs.append({"kind": "service.problem", "subject": r.get("Name", "")[:120],
                            "data": {"unit": r.get("Name", ""), "description": (r.get("DisplayName") or "")[:120], "active": "failed",
                                     "sub": (r.get("State") or "").lower(), "exit_status": str(code), "result": "exit-code"}})
        return {"observations": obs}


class Disks(Collector):
    id = "host.disks"
    platforms = ("linux",)

    def _smart(self) -> list[dict]:
        if not which("smartctl"):
            return []
        code, out = run(["smartctl", "--scan-open", "-j"], timeout=30)
        try:
            devices = (json.loads(out).get("devices") or []) if out.strip() else []
        except ValueError:
            return []
        disks = []
        for d in devices[:24]:
            name = d.get("name") or ""
            _, text = run(["smartctl", "-j", "-a", name] + (["-d", d["type"]] if d.get("type") else []), timeout=60)
            try:
                s = parse_smart(json.loads(text))
            except ValueError:
                continue
            s["verdict"] = smart_verdict(s)
            disks.append({"kind": "disk.smart", "subject": name, "data": s})
        return disks

    def _docker(self) -> list[dict]:
        api = DockerApi()
        if not api.available:
            return []
        out = []
        try:
            info = api.json("/info")
            root = info.get("DockerRootDir") or "/var/lib/docker"
            out.append({"kind": "docker.root", "subject": root, "data": {"driver": info.get("Driver", "")}})
            for c in api.json("/containers/json?all=1")[:100]:
                full = api.json(f"/containers/{c['Id']}/json")
                log_path = full.get("LogPath") or ""
                cfg = ((full.get("HostConfig") or {}).get("LogConfig") or {})
                size = None
                if log_path:
                    # A monitor in a container only sees these when given /var/lib/docker/containers (read-only).
                    files = glob.glob(log_path + "*")
                    try:
                        size = sum(os.path.getsize(p) for p in files) if files else None
                    except OSError:
                        size = None
                out.append({"kind": "container.logs", "subject": (full.get("Name") or "").lstrip("/"),
                            "data": {"driver": cfg.get("Type", ""), "max_size": (cfg.get("Config") or {}).get("max-size", ""),
                                     # In tenths of a GB, so a growing log isn't a "change" every run.
                                     "size_gb": round(size / 1e9, 1) if size is not None else None}})
        except Unavailable:
            return out
        return out

    def collect(self) -> dict:
        obs = self._smart()
        mdstat = read_text(f"{HOST_PROC}/mdstat")
        for md in parse_mdstat(mdstat or ""):
            obs.append({"kind": "disk.raid", "subject": md["name"], "data": md})
        if which("zpool"):
            code, out = run(["zpool", "list", "-H", "-o", "name,health,capacity"], timeout=30)
            if code == 0:
                for p in parse_zpool_list(out):
                    obs.append({"kind": "disk.pool", "subject": p["name"], "data": p})
        obs += self._docker()
        return {"observations": obs}
