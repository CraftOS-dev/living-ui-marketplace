"""Reach this server from away (v4 plan §7.10, N-B19): Tailscale, installed with its official installer.

Installing is a change a person confirms. Signing in is the person's own: NetSentry starts
`tailscale up` and hands back the sign-in link — only to the admin who asked, never stored (whoever
opens that link would attach this server to THEIR tailnet). Afterwards NetSentry's checks watch
that nothing is shared to the whole internet (Funnel).
Cloudflare Tunnel stays guided: its token is a secret NetSentry shouldn't carry.
"""

from __future__ import annotations

import re
import subprocess

from .util import SYSTEM, run, which

INSTALLER = "https://tailscale.com/install.sh"


class RemoteFailed(Exception):
    pass


def install(params: dict) -> dict:
    if SYSTEM != "linux":
        raise RemoteFailed("NetSentry installs Tailscale on Linux; on Windows use tailscale.com/download")
    if which("tailscale"):
        return {"installed": False, "note": "Tailscale was already installed"}
    if not which("curl"):
        raise RemoteFailed("this server needs curl to fetch Tailscale's installer")
    r = subprocess.run(["sh", "-c", f"curl -fsSL {INSTALLER} | sh"], capture_output=True, text=True, timeout=900)
    if r.returncode != 0 or not which("tailscale"):
        raise RemoteFailed("Tailscale's installer didn't finish: " + ((r.stderr or r.stdout).strip().splitlines() or ["?"])[-1][:200])
    return {"installed": True, "note": "Tailscale installed — now sign it in (Server → Network & firewall)"}


def install_undo(saved: dict) -> None:
    if not saved.get("installed"):
        return
    run(["tailscale", "down"], timeout=30)
    if which("apt-get"):
        run(["apt-get", "remove", "-y", "tailscale"], timeout=600)
    elif which("dnf"):
        run(["dnf", "remove", "-y", "tailscale"], timeout=600)


def login(params: dict) -> dict:
    """Start Tailscale's sign-in; the link to finish it (read: only for the admin who asked)."""
    if not which("tailscale"):
        raise RemoteFailed("Tailscale isn't installed here yet")
    code, out = run(["tailscale", "status", "--json"], timeout=15)
    if code == 0 and '"BackendState": "Running"' in out:
        return {"connected": True, "url": ""}
    r = subprocess.run(["tailscale", "up", "--timeout=15s"], capture_output=True, text=True, timeout=40)
    m = re.search(r"https://login\.tailscale\.com/\S+", (r.stderr or "") + (r.stdout or ""))
    if not m:
        if r.returncode == 0:
            return {"connected": True, "url": ""}
        raise RemoteFailed("Tailscale didn't give a sign-in link: " + ((r.stderr or r.stdout).strip().splitlines() or ["?"])[-1][:200])
    return {"connected": False, "url": m.group(0)}
