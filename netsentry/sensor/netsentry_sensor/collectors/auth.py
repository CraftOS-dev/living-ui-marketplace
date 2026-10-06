"""Login attempts → aggregated signals (per source address per minute).
Raw log lines never leave the host; only counts, the source address and the
account names tried."""

from __future__ import annotations

import os
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

from ..util import SYSTEM, run, which
from .base import Collector, Unavailable

FAIL = [
    re.compile(r"Invalid user (?P<user>\S*) from (?P<ip>[0-9a-fA-F.:]+)"),
    re.compile(r"Failed (?:password|keyboard-interactive/pam) for (?P<user>(?!invalid user )\S+) from (?P<ip>[0-9a-fA-F.:]+)"),
]
OK = re.compile(r"Accepted (?P<method>\S+) for (?P<user>\S+) from (?P<ip>[0-9a-fA-F.:]+)")
ISO_TS = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?([+-]\d{2}:?\d{2}|Z)?")
SYSLOG_TS = re.compile(r"^([A-Z][a-z]{2})\s+(\d{1,2}) (\d{2}):(\d{2}):(\d{2})")
MONTHS = {m: i for i, m in enumerate(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}


def line_time(line: str, now: datetime) -> float | None:
    m = ISO_TS.match(line)
    if m:
        tz = (m.group(2) or "+00:00").replace("Z", "+00:00")
        if len(tz) == 5:  # +0000 → +00:00
            tz = tz[:3] + ":" + tz[3:]
        try:
            return datetime.fromisoformat(m.group(1) + tz).timestamp()
        except ValueError:
            return None
    m = SYSLOG_TS.match(line)
    if m:
        # Classic syslog has no year or zone: assume this year, local time.
        try:
            dt = datetime(now.year, MONTHS[m.group(1)], int(m.group(2)), int(m.group(3)), int(m.group(4)), int(m.group(5)))
            return dt.timestamp()
        except (KeyError, ValueError):
            return None
    return None


def parse_sshd_lines(lines: list[str], since: float, now: datetime) -> list[tuple[float, str, str, str]]:
    """→ [(epoch, 'failure'|'success', ip, user)] for lines newer than `since`."""
    events = []
    for line in lines:
        if "sshd" not in line:
            continue
        t = line_time(line, now)
        if t is None or t <= since:
            continue
        m = OK.search(line)
        if m:
            events.append((t, "success", m.group("ip"), m.group("user")))
            continue
        for p in FAIL:
            m = p.search(line)
            if m:
                events.append((t, "failure", m.group("ip"), m.group("user") or "?"))
                break
    return events


def parse_windows_events(xml_text: str) -> list[tuple[float, str, str, str]]:
    """wevtutil /f:xml output (concatenated <Event> elements) for 4625 / 4624."""
    events = []
    try:
        root = ET.fromstring("<Events>" + xml_text + "</Events>")
    except ET.ParseError:
        return events
    for ev in root:
        sys_el = next((c for c in ev if c.tag.endswith("System")), None)
        data_el = next((c for c in ev if c.tag.endswith("EventData")), None)
        if sys_el is None or data_el is None:
            continue
        eid = next((c.text for c in sys_el if c.tag.endswith("EventID")), None)
        tc = next((c for c in sys_el if c.tag.endswith("TimeCreated")), None)
        data = {d.get("Name"): (d.text or "") for d in data_el}
        ip = data.get("IpAddress", "-")
        if ip in ("-", "", "127.0.0.1", "::1"):
            continue
        if eid == "4624" and data.get("LogonType") not in ("3", "10"):
            continue  # only network / RDP logons
        try:
            t = datetime.fromisoformat(tc.get("SystemTime").replace("Z", "+00:00")[:26] + "+00:00").timestamp()
        except Exception:
            t = time.time()
        events.append((t, "failure" if eid == "4625" else "success", ip, data.get("TargetUserName", "?")))
    return events


def aggregate(events: list[tuple[float, str, str, str]]) -> list[dict]:
    """Per minute × kind × source address; failures carry the accounts tried."""
    buckets: dict[tuple, dict] = {}
    for t, outcome, ip, user in events:
        minute = int(t // 60) * 60
        key = (minute, outcome, ip, user if outcome == "success" else "")
        b = buckets.setdefault(key, {"count": 0, "users": set()})
        b["count"] += 1
        b["users"].add(user)
    out = []
    for (minute, outcome, ip, user), b in sorted(buckets.items()):
        data = {"user": user} if outcome == "success" else {"users": sorted(b["users"])[:10]}
        out.append({
            "kind": "auth." + outcome,
            "key": ip,
            "window_start": datetime.fromtimestamp(minute, timezone.utc).isoformat().replace("+00:00", "Z"),
            "count": b["count"],
            "data": data,
        })
    return out


class AuthLog(Collector):
    id = "host.auth"

    def _linux_lines(self, since: float) -> list[str]:
        if which("journalctl"):
            code, out = run(["journalctl", "-q", "--no-pager", "-o", "short-iso", f"--since=@{int(since)}", "_COMM=sshd"], timeout=60)
            if code == 0:
                return out.splitlines()
        for path in ("/var/log/auth.log", "/var/log/secure"):
            if os.path.exists(path):
                try:
                    with open(path, "r", encoding="utf-8", errors="replace") as f:
                        return f.readlines()[-20000:]
                except OSError:
                    raise Unavailable(f"{path} is not readable (run the sensor as root)")
        raise Unavailable("no SSH login log found (journald or /var/log/auth.log)")

    def collect(self) -> dict:
        now = datetime.now()
        since = float(self.state.get("auth_since") or (time.time() - 900))
        if SYSTEM == "linux":
            events = parse_sshd_lines(self._linux_lines(since), since, now)
        elif SYSTEM == "windows":
            start = datetime.fromtimestamp(since, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
            q = f"*[System[(EventID=4625 or EventID=4624) and TimeCreated[@SystemTime>'{start}']]]"
            code, out = run(["wevtutil", "qe", "Security", f"/q:{q}", "/f:xml", "/c:5000"], timeout=60)
            if code != 0:
                raise Unavailable("reading the Windows Security event log needs Administrator")
            events = [e for e in parse_windows_events(out) if e[0] > since]
        else:
            raise Unavailable("login monitoring is not supported on this platform yet")
        if events:
            self.state["auth_since"] = max(e[0] for e in events)
        else:
            self.state["auth_since"] = max(since, time.time() - 120)
        return {"signals": aggregate(events)}
