"""Network collectors (lite profile — no packet capture, no root required):
connection sampling, DNS names, and IDS engine alerts when an engine is installed.

Volume control: connections and DNS names are only sent the first time they
are seen within an hour, so a busy host sends new destinations, not every
sample."""

from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timezone

from ..util import SYSTEM, run, which
from .base import Collector, Unavailable
from .host import parse_ss, parse_netstat_windows, parse_tasklist, split_addr_port

SEEN_TTL = 3600
MAX_LINES = 20000

SURICATA_EVE = os.environ.get("NETSENTRY_SURICATA_EVE", "/var/log/suricata/eve.json")
FALCO_LOG = os.environ.get("NETSENTRY_FALCO_LOG", "/var/log/falco/events.json")
ZEEK_DIRS = [d for d in (os.environ.get("NETSENTRY_ZEEK_DIR"), "/opt/zeek/logs/current", "/var/log/zeek/current", "/usr/local/zeek/logs/current") if d]


def tail_new_lines(state: dict, key: str, path: str, limit: int = MAX_LINES) -> list[str]:
    """Lines appended to `path` since the last call (offset kept in state[key]).
    Handles rotation (file shrank → start over) and never skips lines past `limit`
    — the rest is read next time."""
    offset = int(state.get(key, 0))
    if os.path.getsize(path) < offset:
        offset = 0
    lines = []
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            f.seek(offset)
            while len(lines) < limit:
                line = f.readline()
                if not line or not line.endswith("\n"):
                    break  # EOF, or a line still being written
                lines.append(line)
                offset = f.tell()
    except OSError:
        raise Unavailable(f"{path} is not readable (run the sensor as root)")
    state[key] = offset
    return lines


def zeek_dir() -> str | None:
    return next((d for d in ZEEK_DIRS if os.path.isdir(d)), None)


def parse_zeek(lines: list[str]) -> list[dict]:
    """Zeek log lines in either format: JSON (LogAscii::use_json) or the default TSV
    with a `#fields` header. Returns one dict per record."""
    out, fields = [], None
    for line in lines:
        line = line.rstrip("\n")
        if not line:
            continue
        if line.startswith("{"):
            try:
                out.append(json.loads(line))
            except ValueError:
                pass
        elif line.startswith("#fields"):
            fields = line.split("\t")[1:]
        elif not line.startswith("#") and fields:
            vals = line.split("\t")
            out.append({k: (None if v in ("-", "(empty)") else v) for k, v in zip(fields, vals)})
    return out


def zeek_tail(state: dict, name: str) -> list[dict]:
    """New records of a Zeek log. The TSV header is re-read each time so records parse
    even when the offset is mid-file."""
    d = zeek_dir()
    path = os.path.join(d, name) if d else None
    if not path or not os.path.exists(path):
        return []
    header = []
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for _ in range(10):
            line = f.readline()
            if line.startswith("#"):
                header.append(line)
            else:
                break
    lines = tail_new_lines(state, "zeek_" + name, path)
    return parse_zeek(header + [ln for ln in lines if not ln.startswith("#")])


def _minute_iso(t: float | None = None) -> str:
    t = time.time() if t is None else t
    return datetime.fromtimestamp(int(t // 60) * 60, timezone.utc).isoformat().replace("+00:00", "Z")


def _is_loopback(ip: str) -> bool:
    ip = ip.strip("[]")
    return ip.startswith("127.") or ip in ("::1", "0.0.0.0", "::", "*")


def parse_ss_established(output: str) -> list[dict]:
    """`ss -Htnp state established`: Recv-Q Send-Q Local:Port Peer:Port [users:(("curl",pid=1,fd=3))]"""
    rows = []
    for line in output.splitlines():
        parts = line.split()
        if len(parts) < 4:
            continue
        local, peer = split_addr_port(parts[2]), split_addr_port(parts[3])
        if not local or not peer:
            continue
        proc = re.search(r'users:\(\("([^"]+)",pid=(\d+)', line)
        rows.append({"local_port": local[1], "remote_ip": peer[0].split("%")[0].strip("[]"), "remote_port": peer[1],
                     "process": proc.group(1) if proc else None, "pid": int(proc.group(2)) if proc else None})
    return rows


def parse_netstat_established(output: str, names: dict[int, str]) -> list[dict]:
    rows = []
    for line in output.splitlines():
        parts = line.split()
        if len(parts) < 5 or parts[0].upper() != "TCP" or parts[3].upper() != "ESTABLISHED":
            continue
        local, peer = split_addr_port(parts[1]), split_addr_port(parts[2])
        if not local or not peer:
            continue
        pid = int(parts[4]) if parts[4].isdigit() else None
        rows.append({"local_port": local[1], "remote_ip": peer[0].strip("[]"), "remote_port": peer[1],
                     "process": names.get(pid) if pid is not None else None, "pid": pid})
    return rows


def parse_lsof_established(output: str) -> list[dict]:
    """lsof NAME column: 10.0.0.5:51234->93.184.216.34:443 (ESTABLISHED)"""
    rows = []
    for line in output.splitlines()[1:]:
        parts = line.split()
        if len(parts) < 9 or "->" not in parts[8]:
            continue
        a, b = parts[8].split("->", 1)
        local, peer = split_addr_port(a), split_addr_port(b)
        if local and peer:
            rows.append({"local_port": local[1], "remote_ip": peer[0].strip("[]"), "remote_port": peer[1], "process": parts[0],
                         "pid": int(parts[1]) if parts[1].isdigit() else None})
    return rows


def classify(rows: list[dict], listening_ports: set[int]) -> list[dict]:
    """Drop loopback; mark inbound (to a local listener) vs outbound."""
    out = []
    for r in rows:
        if _is_loopback(r["remote_ip"]):
            continue
        r = dict(r)
        r["direction"] = "inbound" if r["local_port"] in listening_ports else "outbound"
        out.append(r)
    return out


def fresh(state: dict, bucket: str, keys: list[str], now: float) -> set[str]:
    """Keys not reported in the last hour. A persistent connection is re-reported
    hourly (not refreshed on every sighting), so it is re-checked against
    blocklists that may have changed since."""
    seen = state.setdefault(bucket, {})
    for k, t in list(seen.items()):
        if now - t >= SEEN_TTL:
            del seen[k]
    new = {k for k in keys if k not in seen}
    for k in new:
        seen[k] = now
    return new


def parse_ps_process_info(output: str) -> dict[int, dict]:
    """PowerShell `Get-Process … | ConvertTo-Json` rows → pid → {path, publisher, signed}."""
    try:
        data = json.loads(output or "[]")
    except ValueError:
        return {}
    if isinstance(data, dict):
        data = [data]
    out = {}
    for d in data or []:
        if not isinstance(d, dict) or not str(d.get("Id", "")).isdigit():
            continue
        status = str(d.get("Signed") or "")
        out[int(d["Id"])] = {
            "path": d.get("Path") or None,
            "publisher": (d.get("Company") or None),
            "signed": True if status == "Valid" else False if status in ("NotSigned", "HashMismatch", "NotTrusted") else None,
        }
    return out


def process_info(pids: dict[str, int]) -> dict[str, dict]:
    """Where each program lives on disk and who published it — best effort, so a person can judge
    "is this expected?". pids: program name → one pid. Missing rights just leave fields empty."""
    info: dict[str, dict] = {}
    if not pids:
        return info
    if SYSTEM == "windows":
        ids = ",".join(str(p) for p in pids.values())
        script = (
            f"Get-Process -Id {ids} -ErrorAction SilentlyContinue | ForEach-Object {{ [pscustomobject]@{{ Id=$_.Id; Path=$_.Path; "
            "Company=$_.Company; Signed=$(if ($_.Path) { (Get-AuthenticodeSignature -LiteralPath $_.Path).Status.ToString() } else { '' }) } } | ConvertTo-Json -Compress"
        )
        _, out = run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], timeout=60)
        by_pid = parse_ps_process_info(out)
        for name, pid in pids.items():
            if pid in by_pid:
                info[name] = by_pid[pid]
        return info
    for name, pid in pids.items():
        path = None
        try:
            path = os.readlink(f"/proc/{pid}/exe") if SYSTEM == "linux" else None
        except OSError:
            path = None
        if SYSTEM == "darwin":
            _, out = run(["ps", "-o", "comm=", "-p", str(pid)])
            path = out.strip() or None
        publisher = None
        if path and SYSTEM == "linux" and which("dpkg-query"):
            code, out = run(["dpkg-query", "-S", path])
            if code == 0 and ":" in out:
                publisher = "package " + out.split(":", 1)[0].strip()
        info[name] = {"path": path, "publisher": publisher, "signed": None}
    return info


class Connections(Collector):
    id = "host.connections"

    def _sample(self) -> tuple[list[dict], set[int]]:
        if SYSTEM == "linux":
            code, est = run(["ss", "-Htnp", "state", "established"])
            if code == 127:
                raise Unavailable("the `ss` command is not installed")
            _, lst = run(["ss", "-H", "-ltn"])
            return parse_ss_established(est), {r["port"] for r in parse_ss(lst)}
        if SYSTEM == "windows":
            _, tl = run(["tasklist", "/fo", "csv", "/nh"])
            names = parse_tasklist(tl)
            rows, listening = [], set()
            for proto in ("TCP", "TCPv6"):
                _, out = run(["netstat", "-ano", "-p", proto])
                rows += parse_netstat_established(out, names)
                listening |= {r["port"] for r in parse_netstat_windows(out, names)}
            return rows, listening
        if SYSTEM == "darwin":
            _, est = run(["lsof", "-nP", "-iTCP", "-sTCP:ESTABLISHED"])
            _, lst = run(["lsof", "-nP", "-iTCP", "-sTCP:LISTEN"])
            from .host import parse_lsof

            return parse_lsof_established(est), {r["port"] for r in parse_lsof(lst)}
        raise Unavailable(f"unsupported platform {SYSTEM}")

    def collect(self) -> dict:
        rows, listening = self._sample()
        conns = classify(rows, listening)
        now = time.time()
        outbound = [c for c in conns if c["direction"] == "outbound"]
        # State: which programs talk to the network (NET-007 baselines this).
        procs = sorted({c["process"] for c in outbound if c.get("process")})
        # Look up each program once (cached): file location and publisher let a person judge it.
        cache = self.state.setdefault("proc_info", {})
        unknown = {c["process"]: c["pid"] for c in outbound if c.get("process") and c.get("pid") and c["process"] not in cache}
        if unknown:
            cache.update(process_info(unknown))
            for name in unknown:
                cache.setdefault(name, {})
        observations = [
            {"kind": "host.net_process", "subject": p,
             "data": {"process": p, **{k: v for k, v in (cache.get(p) or {}).items() if v is not None}}}
            for p in procs
        ]
        # Signals: destinations first seen this hour.
        by_key = {}
        for c in conns:
            k = f"{c['remote_ip']}|{c['remote_port']}|{c.get('process') or ''}|{c['direction']}"
            by_key[k] = c
        new = fresh(self.state, "conn_seen", list(by_key), now)
        signals = [
            {"kind": "net.conn", "key": c["remote_ip"], "window_start": _minute_iso(now), "count": 1,
             "data": {"remote_port": c["remote_port"], "process": c.get("process"), "direction": c["direction"]}}
            for k, c in sorted(by_key.items()) if k in new
        ][:1500]
        note = "" if any(c.get("process") for c in conns) or not conns else "Process names need administrator/root rights."
        # Processes the sensor cannot name are unknown, not absent: only a named view is complete.
        return {"observations": observations, "signals": signals, "complete": bool(procs) or not outbound, "note": note}


def parse_displaydns(output: str) -> list[str]:
    names = []
    for line in output.splitlines():
        m = re.match(r"^\s*Record Name[ .]*:\s*(\S+)", line)
        if m:
            names.append(m.group(1).rstrip(".").lower())
    return sorted(set(names))


class Dns(Collector):
    id = "host.dns"

    def _names(self) -> list[str]:
        # Pi-hole is configured on the sensor host (its token never goes to the console).
        url, token = os.environ.get("NETSENTRY_PIHOLE_URL"), os.environ.get("NETSENTRY_PIHOLE_TOKEN")
        if url:
            import urllib.request

            with urllib.request.urlopen(f"{url.rstrip('/')}/admin/api.php?getAllQueries=500&auth={token or ''}", timeout=10) as r:  # noqa: S310
                data = json.loads(r.read().decode())
            return sorted({str(q[2]).lower() for q in data.get("data", []) if len(q) > 2})
        if SYSTEM == "windows":
            _, out = run(["ipconfig", "/displaydns"], timeout=30)
            return parse_displaydns(out)
        if zeek_dir():
            return sorted({str(r.get("query")).lower().rstrip(".") for r in zeek_tail(self.state, "dns.log") if r.get("query")})
        raise Unavailable("DNS visibility needs the Windows DNS cache, Zeek, or NETSENTRY_PIHOLE_URL (+ NETSENTRY_PIHOLE_TOKEN) set for the sensor")

    def collect(self) -> dict:
        now = time.time()
        names = [n for n in self._names() if n and not n.endswith((".local", ".arpa", ".lan"))]
        new = fresh(self.state, "dns_seen", names, now)
        signals = [{"kind": "net.dns", "key": n, "window_start": _minute_iso(now), "count": 1, "data": {}} for n in sorted(new)][:1500]
        return {"signals": signals}


SURICATA_SEV = {1: "high", 2: "medium", 3: "low"}


def _parse_ts(ts: str) -> float:
    """'2026-09-30T11:59:00.123456+0000' / '...Z' / '...+00:00' → epoch; now if unparseable."""
    s = str(ts or "").replace("Z", "+00:00")
    s = re.sub(r"([+-]\d{2})(\d{2})$", r"\1:\2", s)
    s = re.sub(r"(\.\d{6})\d+", r"\1", s)  # Python accepts at most microseconds
    try:
        return datetime.fromisoformat(s).timestamp()
    except ValueError:
        return time.time()


def parse_eve(lines: list[str]) -> list[dict]:
    out = []
    for line in lines:
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if e.get("event_type") != "alert":
            continue
        a = e.get("alert", {})
        t = _parse_ts(e.get("timestamp", ""))
        out.append({
            "kind": "ids.alert", "key": str(e.get("src_ip", "?")), "window_start": _minute_iso(t), "count": 1,
            "data": {"engine": "suricata", "signature": str(a.get("signature", ""))[:200], "sid": a.get("signature_id"),
                     "category": str(a.get("category", ""))[:100], "severity": SURICATA_SEV.get(a.get("severity"), "medium"),
                     "dest_ip": e.get("dest_ip"), "dest_port": e.get("dest_port")},
        })
    return out


def parse_crowdsec(output: str) -> list[dict]:
    out = []
    try:
        alerts = json.loads(output or "[]")
    except ValueError:
        return out
    for a in alerts or []:
        src = (a.get("source") or {}).get("ip") or (a.get("source") or {}).get("value") or "?"
        t = _parse_ts(a.get("created_at") or "")
        out.append({"kind": "ids.alert", "key": str(src), "window_start": _minute_iso(t), "count": int(a.get("events_count") or 1),
                    "data": {"engine": "crowdsec", "signature": str(a.get("scenario", ""))[:200], "severity": "medium"}})
    return out


FALCO_SEV = {"emergency": "critical", "alert": "critical", "critical": "high", "error": "high", "warning": "medium", "notice": "low"}


def parse_falco(lines: list[str]) -> list[dict]:
    """Falco JSON output (json_output: true): {time, rule, priority, output, output_fields}."""
    out = []
    for line in lines:
        try:
            e = json.loads(line)
        except ValueError:
            continue
        sev = FALCO_SEV.get(str(e.get("priority", "")).lower())
        if not sev:
            continue  # informational / debug
        f = e.get("output_fields") or {}
        where = f.get("container.name") if f.get("container.name") not in (None, "host") else f.get("proc.name")
        out.append({
            "kind": "ids.alert", "key": str(where or e.get("hostname") or "host"), "window_start": _minute_iso(_parse_ts(e.get("time", ""))), "count": 1,
            "data": {"engine": "falco", "signature": str(e.get("rule", ""))[:200], "severity": sev, "category": ",".join(e.get("tags") or [])[:100],
                     "process": f.get("proc.cmdline") or f.get("proc.name"), "container": f.get("container.name"), "user": f.get("user.name")},
        })
    return out


def parse_zeek_notices(records: list[dict]) -> list[dict]:
    out = []
    for r in records:
        note = r.get("note")
        if not note:
            continue
        t = float(r.get("ts") or time.time())
        out.append({"kind": "ids.alert", "key": str(r.get("src") or r.get("id.orig_h") or "?"), "window_start": _minute_iso(t), "count": 1,
                    "data": {"engine": "zeek", "signature": str(note)[:200], "severity": "medium", "category": str(r.get("msg") or "")[:100],
                             "dest_ip": r.get("dst") or r.get("id.resp_h"), "dest_port": r.get("p") or r.get("id.resp_p")}})
    return out


class Ids(Collector):
    id = "host.ids"

    def collect(self) -> dict:
        signals, engines = [], []
        if os.path.exists(SURICATA_EVE):
            engines.append("suricata")
            signals += parse_eve(tail_new_lines(self.state, "eve_offset", SURICATA_EVE))
        if os.path.exists(FALCO_LOG):
            engines.append("falco")
            signals += parse_falco(tail_new_lines(self.state, "falco_offset", FALCO_LOG))
        if zeek_dir():
            engines.append("zeek")
            signals += parse_zeek_notices(zeek_tail(self.state, "notice.log"))
        if which("cscli"):
            engines.append("crowdsec")
            since = self.state.get("crowdsec_since", "10m")
            code, out = run(["cscli", "alerts", "list", "-o", "json", "--since", since], timeout=30)
            if code == 0:
                signals += parse_crowdsec(out)
            self.state["crowdsec_since"] = "2m"
        if not engines:
            raise Unavailable("no IDS engine found (install Suricata, Zeek, Falco or CrowdSec)")
        return {"signals": signals[:1500], "note": "engines: " + ", ".join(engines)}
