"""Safe remote access on this machine (docs/SYSTEM-V2-PLAN.md §17): Tailscale,
Cloudflare Tunnel and WireGuard — the private ways to reach apps from away,
instead of opening ports on the router. Read-only; nothing is changed.

Observations:
  remote.tailscale        {running, name, ips}        the machine is on a tailnet
  remote.tailscale_serve  {port, target, funnel}      a port shared on the tailnet (funnel = to the internet)
  remote.cloudflared      {hostname, target_port}     a public hostname sent through a Cloudflare Tunnel
  remote.vpn              {interface}                 a VPN interface (WireGuard, OpenVPN)
"""

from __future__ import annotations

import glob
import json
import os
import re

from ..util import SYSTEM, read_text, run, which
from .base import Collector


def parse_tailscale_status(data: dict) -> dict | None:
    """`tailscale status --json` → whether this machine is on a tailnet, and how others reach it."""
    if not isinstance(data, dict) or not data.get("Self"):
        return None
    me = data["Self"]
    return {"running": data.get("BackendState") == "Running", "name": str(me.get("DNSName", "")).rstrip(".")[:120],
            "ips": [str(ip) for ip in me.get("TailscaleIPs") or []][:4]}


def parse_tailscale_serve(data: dict) -> list[dict]:
    """`tailscale serve status --json` → ports shared on the tailnet; AllowFunnel makes them public."""
    out = []
    if not isinstance(data, dict):
        return out
    funnel = {k for k, v in (data.get("AllowFunnel") or {}).items() if v}
    for hostport, conf in (data.get("Web") or {}).items():
        for path, handler in ((conf or {}).get("Handlers") or {}).items():
            target = str((handler or {}).get("Proxy", ""))
            m = re.search(r":(\d+)(?:/|$)", target)
            out.append({"port": int(hostport.rsplit(":", 1)[-1]) if ":" in hostport else 443, "target": target[:120],
                        "target_port": int(m.group(1)) if m else None, "funnel": hostport in funnel, "path": path})
    for port, conf in (data.get("TCP") or {}).items():
        target = str((conf or {}).get("TCPForward", ""))
        m = re.search(r":(\d+)$", target)
        out.append({"port": int(port), "target": target[:120], "target_port": int(m.group(1)) if m else None, "funnel": False, "path": ""})
    return out


def parse_cloudflared_config(text: str) -> list[dict]:
    """cloudflared config.yml ingress → [{hostname, target_port}] (a small YAML subset: the documented ingress list)."""
    out, host = [], None
    for line in (text or "").splitlines():
        h = re.match(r"^\s*-\s*hostname:\s*['\"]?([^'\"\s]+)", line)
        if h:
            host = h.group(1)
            continue
        s = re.match(r"^\s*-?\s*service:\s*['\"]?([^'\"\s]+)", line)
        if s and host:
            m = re.search(r":(\d+)(?:/|$)", s.group(1))
            out.append({"hostname": host[:200], "target": s.group(1)[:120], "target_port": int(m.group(1)) if m else None})
            host = None
    return out


class RemoteAccess(Collector):
    id = "host.remote_access"

    def collect(self) -> dict:
        obs = []
        if which("tailscale"):
            code, out = run(["tailscale", "status", "--json"], timeout=15)
            st = parse_tailscale_status(json.loads(out)) if code == 0 and out.strip().startswith("{") else None
            if st:
                obs.append({"kind": "remote.tailscale", "subject": "tailscale", "data": st})
                code, out = run(["tailscale", "serve", "status", "--json"], timeout=15)
                if code == 0 and out.strip().startswith("{"):
                    for s in parse_tailscale_serve(json.loads(out)):
                        obs.append({"kind": "remote.tailscale_serve", "subject": f"{s['port']}{s['path']}", "data": s})
        configs = ["/etc/cloudflared/config.yml", os.path.expanduser("~/.cloudflared/config.yml")]
        if SYSTEM == "windows":
            configs.append(os.path.expandvars(r"%USERPROFILE%\.cloudflared\config.yml"))
        for path in configs:
            for rule in parse_cloudflared_config(read_text(path) or ""):
                obs.append({"kind": "remote.cloudflared", "subject": rule["hostname"], "data": rule})
        if SYSTEM == "linux":
            for iface in sorted(glob.glob("/sys/class/net/wg*")) + sorted(glob.glob("/sys/class/net/tun*")):
                obs.append({"kind": "remote.vpn", "subject": os.path.basename(iface), "data": {"interface": os.path.basename(iface)}})
        return {"observations": obs, "note": "" if obs else "no Tailscale, Cloudflare Tunnel or VPN found"}
