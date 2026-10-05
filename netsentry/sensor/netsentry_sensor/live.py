"""Live data (v4 plan §16).

Two things, each on its own thread so slow checks never hold them up:

* **Sampler** (N-B24): while a person has this server on screen (check-in config ``live: true``),
  every 2 s: processor, memory, the fullest disk and every container's state, CPU and memory,
  sent with ``sensors.live``. The console answers whether anyone is still looking; when nobody is,
  the sampler stops.
* **Docker events** (N-B25): Docker's own event stream, always. A container that starts, stops,
  dies, restarts or changes health makes the monitor report containers at once (``on_event``),
  instead of at the next five-minute run.
"""

from __future__ import annotations

import json
import subprocess
import threading
import time
import urllib.parse

from .collectors.base import Unavailable
from .collectors.containers import DockerApi
from .collectors.health import HOST_PROC, container_cpu, container_memory, cpu_percent, parse_meminfo, parse_proc_stat, parse_uptime
from .util import SYSTEM, read_text, which

EVERY = 2.0
MAX_APPS = 100
# The container events that change what a person sees (exec_*, attach, top… are noise).
EVENTS = {"create", "start", "restart", "stop", "die", "kill", "oom", "pause", "unpause", "destroy", "health_status"}


# ------------------------------------------------------------------ sampling (pure parts tested)


def fullest_disk(rows: list[tuple[str, int, int, int]]) -> dict:
    """[(mountpoint, used, total, free)] → the fullest one: {disk_pct, disk_free, disk_mount}."""
    best = None
    for mnt, used, total, free in rows:
        if total <= 0:
            continue
        pct = 100.0 * used / total
        if best is None or pct > best[0]:
            best = (pct, free, mnt)
    if best is None:
        return {}
    return {"disk_pct": round(best[0], 1), "disk_free": best[1], "disk_mount": best[2]}


def container_row(c: dict) -> dict:
    """One entry of Docker's /containers/json → name, state and health (from its status words)."""
    status = str(c.get("Status") or "")
    health = "unhealthy" if "(unhealthy)" in status else "healthy" if "(healthy)" in status else "starting" if "(health: starting)" in status else ""
    return {"container": (c.get("Names") or ["/?"])[0].lstrip("/"), "state": str(c.get("State") or ""), "health": health}


def event_action(e: dict) -> str:
    """The Docker event's action ("start", "die", "health_status"), or "" when it isn't one that changes an app."""
    if (e.get("Type") or e.get("type")) != "container":
        return ""
    action = str(e.get("Action") or e.get("status") or "").split(":")[0].strip()
    return action if action in EVENTS else ""


def wanted_event(e: dict) -> bool:
    """Is this Docker event one that changes an app's state?"""
    return bool(event_action(e))


class Sampler:
    """Keeps what a CPU percentage needs between two readings."""

    def __init__(self):
        self.ticks = None
        self.prev: dict = {}

    def host(self) -> dict:
        s: dict = {}
        if SYSTEM == "linux":
            ticks = parse_proc_stat(read_text(f"{HOST_PROC}/stat") or "")
            s["cpu"] = cpu_percent(self.ticks, ticks)
            self.ticks = ticks
            s.update(parse_meminfo(read_text(f"{HOST_PROC}/meminfo") or ""))
            s["uptime_s"] = parse_uptime(read_text(f"{HOST_PROC}/uptime") or "")
        elif SYSTEM == "windows":
            from .collectors.health import _windows_sample
            w = _windows_sample()
            ticks = w.pop("cpu_ticks")
            s["cpu"] = cpu_percent(self.ticks, ticks)
            self.ticks = ticks
            s.update(w)
        else:
            from .collectors.health import _darwin_sample
            s.update(_darwin_sample())
        out = {"cpu": s.get("cpu"), "mem_used": s.get("mem_used"), "mem_total": s.get("mem_total"), "uptime_s": s.get("uptime_s")}
        if s.get("mem_total"):
            out["mem_pct"] = round(100.0 * (s.get("mem_used") or 0) / s["mem_total"], 1)
        try:
            from .collectors.storage import usages
            out.update(fullest_disk([(m, u.used, u.total, u.free) for _, m, _, u in usages()]))
        except Exception:
            pass
        return out

    def containers(self) -> list[dict]:
        api = DockerApi()
        if not api.available:
            return []
        rows, nxt = [], {}
        for c in api.json("/containers/json?all=1")[:MAX_APPS]:
            row = container_row(c)
            if row["state"] == "running":
                status, body = api.get(f"/containers/{c['Id']}/stats?stream=false&one-shot=true")
                if status == 200:
                    try:
                        stats = json.loads(body)
                    except ValueError:
                        stats = None
                    if stats:
                        cpu = stats.get("cpu_stats") or {}
                        row["cpu"] = container_cpu(self.prev.get(row["container"]), stats)
                        row["mem"] = container_memory(stats)[0]
                        nxt[row["container"]] = {"total": (cpu.get("cpu_usage") or {}).get("total_usage"), "system": cpu.get("system_cpu_usage"), "t": time.time()}
            rows.append(row)
        self.prev = nxt
        return rows

    def sample(self) -> dict:
        out = self.host()
        try:
            out["apps"] = self.containers()
        except Unavailable:
            out["apps"] = []
        return out


# ------------------------------------------------------------------ threads


class Live:
    def __init__(self, client, on_event, log=print):
        self.client = client
        self.on_event = on_event
        self.log = log
        self._sampler: threading.Thread | None = None
        self._events: threading.Thread | None = None

    # ---- sampler: runs while the console says someone is looking
    def watch(self, live: bool) -> None:
        if live and not (self._sampler and self._sampler.is_alive()):
            self._sampler = threading.Thread(target=self._sample_loop, name="netsentry-live", daemon=True)
            self._sampler.start()

    def _sample_loop(self) -> None:
        sampler = Sampler()
        sampler.sample()  # the first CPU reading only sets the baseline
        while True:
            time.sleep(EVERY)
            started = time.time()
            try:
                answer = self.client.call("sensors.live", {"sample": json.dumps(sampler.sample())})
            except Exception as e:  # console away or refused: stop; the next check-in starts it again
                self.log(f"[live] stopped: {e}")
                return
            if not (answer or {}).get("live"):
                return  # nobody is looking any more
            if time.time() - started > 10:
                self.log("[live] a sample took over 10 s; slowing down")
                time.sleep(10)

    # ---- Docker events: always
    def start_events(self) -> None:
        if not (self._events and self._events.is_alive()):
            self._events = threading.Thread(target=self._events_loop, name="netsentry-docker-events", daemon=True)
            self._events.start()

    def _events_loop(self) -> None:
        while True:
            try:
                self._follow()
            except TimeoutError:
                continue  # an hour without events: follow again
            except Exception as e:
                self.log(f"[events] {e}")
            time.sleep(5)

    def _follow(self) -> None:
        api = DockerApi()
        if api.available:
            filters = urllib.parse.quote(json.dumps({"type": ["container"]}))
            conn, resp = api.stream(f"/events?filters={filters}")
            try:
                if resp.status != 200:
                    raise Unavailable(f"Docker answered {resp.status} for /events")
                buf = b""
                while True:
                    chunk = resp.read1(65536) if hasattr(resp, "read1") else resp.readline()
                    if not chunk:
                        return  # Docker closed the stream (restart): follow again
                    buf += chunk
                    while b"\n" in buf:
                        line, buf = buf.split(b"\n", 1)
                        self._handle(line)
            finally:
                conn.close()
        elif which("docker"):
            p = subprocess.Popen(["docker", "events", "--format", "{{json .}}", "--filter", "type=container"],
                                 stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            try:
                for line in p.stdout:
                    self._handle(line)
            finally:
                p.kill()
        else:
            time.sleep(55)  # no Docker on this server: look again in a minute

    def _handle(self, line: bytes) -> None:
        try:
            e = json.loads(line)
        except ValueError:
            return
        action = event_action(e)
        if action:
            self.on_event(action)
