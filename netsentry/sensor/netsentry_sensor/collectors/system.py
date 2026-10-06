"""System collectors: security updates, autostart entries, file integrity,
device posture (disk encryption / firewall / antivirus), Docker ports."""

from __future__ import annotations

import glob
import hashlib
import json
import os
import re

from ..redact import redact
from ..util import SYSTEM, as_list, powershell_json, read_text, run, which
from .base import Collector, Unavailable

# ----------------------------------------------------------------- updates


_APT_INST = re.compile(r"^Inst (\S+) (?:\[([^\]]+)\] )?\((\S+)")


def parse_apt_simulate(output: str) -> dict:
    inst = [l for l in output.splitlines() if l.startswith("Inst ")]
    security = [l for l in inst if re.search(r"-security\b|/[a-z-]*-security", l)]
    packages = []
    for l in security[:300]:
        m = _APT_INST.match(l)
        if m:
            packages.append({"name": m.group(1), "from": m.group(2) or "", "to": m.group(3)})
    return {"manager": "apt", "total": len(inst), "security": len(security), "packages": packages}


def parse_dnf_security(output: str) -> dict:
    lines = [l for l in output.splitlines() if l.strip() and not l.lower().startswith(("last metadata", "updating", "security:"))]
    packages = []
    for l in lines[:300]:
        parts = l.split()
        if len(parts) >= 3:
            # NEVRA "openssl-libs-1:3.0.7-27.el9.x86_64" -> the name before the version
            m = re.match(r"^(.+?)-(?:\d+:)?\d[^-]*-[^-]+$", parts[-1])
            packages.append({"name": m.group(1) if m else parts[-1], "from": "", "to": parts[-1]})
    return {"manager": "dnf", "total": None, "security": len(lines), "packages": packages}


WU_SCRIPT = (
    "$s = New-Object -ComObject Microsoft.Update.Session; "
    "$r = $s.CreateUpdateSearcher().Search(\"IsInstalled=0 and Type='Software' and IsHidden=0\"); "
    "$u = @($r.Updates | ForEach-Object { @{ title = $_.Title; severity = [string]$_.MsrcSeverity; "
    "categories = @($_.Categories | ForEach-Object { $_.Name }) } }); "
    "$a = New-Object -ComObject Microsoft.Update.AutoUpdate; "
    "@{ updates = $u; last_install = [string]$a.Results.LastInstallationSuccessDate.ToString('o'); "
    "last_search = [string]$a.Results.LastSearchSuccessDate.ToString('o') } | ConvertTo-Json -Depth 4 -Compress"
)


def parse_windows_update(data: dict) -> dict:
    """Windows Update search result → counts. Definition updates (antivirus signatures) are not OS security updates."""
    updates = as_list((data or {}).get("updates"))
    security = [u for u in updates if "Security Updates" in as_list(u.get("categories")) or (u.get("severity") or "").strip()]
    definitions = [u for u in updates if "Definition Updates" in as_list(u.get("categories"))]
    return {"manager": "windows_update", "total": len(updates), "security": len(security),
            "critical": sum(1 for u in security if (u.get("severity") or "").lower() == "critical"),
            "definitions": len(definitions), "titles": [str(u.get("title", ""))[:120] for u in security][:20],
            "last_install": (data or {}).get("last_install", ""), "last_search": (data or {}).get("last_search", "")}


class Updates(Collector):
    id = "host.updates"
    platforms = ("linux", "windows")

    def collect(self) -> dict:
        if SYSTEM == "windows":
            # Read-only: a search for pending updates (it installs nothing). Takes 10–60 s.
            data = powershell_json(WU_SCRIPT, timeout=600)
            if data is None:
                raise Unavailable("Windows Update could not be asked for pending updates (the Windows Update service may be off)")
            return {"observations": [{"kind": "host.package_updates", "subject": "security", "data": parse_windows_update(data)}]}
        if SYSTEM != "linux":
            raise Unavailable("pending-update checks are Linux and Windows only in this version")
        if which("apt-get"):
            _, out = run(["apt-get", "-s", "-o", "Debug::NoLocking=1", "upgrade"], timeout=120)
            data = parse_apt_simulate(out)
        elif which("dnf"):
            _, out = run(["dnf", "-q", "updateinfo", "list", "--security"], timeout=180)
            data = parse_dnf_security(out)
        else:
            raise Unavailable("no supported package manager (apt, dnf) found")
        return {"observations": [{"kind": "host.package_updates", "subject": "security", "data": data}]}


# ------------------------------------------------------------- persistence


def cron_entries(path: str, text: str) -> list[dict]:
    out = []
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("#") or re.match(r"^[A-Za-z_]+=", s):
            continue
        h = hashlib.sha256(s.encode()).hexdigest()[:12]
        out.append({"kind": "host.persistence", "subject": f"cron:{path}:{h}", "data": {"type": "cron", "name": path, "command": redact(s)}})
    return out


def parse_reg_run(output: str, hive: str) -> list[dict]:
    """`reg query <key>` lines: '    Name    REG_SZ    C:\\path\\app.exe --flag'"""
    out = []
    for line in output.splitlines():
        m = re.match(r"^\s{4}(.+?)\s{4}REG_(?:EXPAND_)?SZ\s{4}(.*)$", line)
        if m:
            out.append({"kind": "host.persistence", "subject": f"run:{hive}:{m.group(1)}", "data": {"type": "run_key", "name": m.group(1), "command": redact(m.group(2))}})
    return out


class Persistence(Collector):
    id = "host.persistence"

    def collect(self) -> dict:
        obs = []
        complete = True
        if SYSTEM == "linux":
            paths = ["/etc/crontab"] + sorted(glob.glob("/etc/cron.d/*")) + sorted(glob.glob("/var/spool/cron/crontabs/*")) + sorted(glob.glob("/var/spool/cron/*"))
            for p in paths:
                if os.path.isdir(p):
                    continue
                text = read_text(p)
                if text is None:
                    complete = False
                    continue
                obs += cron_entries(p, text)
            code, out = run(["systemctl", "list-unit-files", "--state=enabled", "--no-legend", "--no-pager", "--type=service,timer"])
            if code == 0:
                for line in out.splitlines():
                    unit = line.split()[0] if line.split() else ""
                    if unit:
                        obs.append({"kind": "host.persistence", "subject": f"systemd:{unit}", "data": {"type": "systemd", "name": unit}})
        elif SYSTEM == "windows":
            for hive, key in (
                ("HKLM", r"HKLM\Software\Microsoft\Windows\CurrentVersion\Run"),
                ("HKLM", r"HKLM\Software\Microsoft\Windows\CurrentVersion\RunOnce"),
                ("HKCU", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run"),
                ("HKCU", r"HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce"),
            ):
                _, out = run(["reg", "query", key])
                obs += parse_reg_run(out, hive)
            tasks = powershell_json(
                "Get-ScheduledTask | Where-Object { $_.State -ne 'Disabled' -and $_.TaskPath -notlike '\\Microsoft\\*' } | "
                "Select-Object TaskName,TaskPath | ConvertTo-Json -Compress"
            )
            if tasks is None:
                complete = False
            for t in as_list(tasks):
                name = f"{t.get('TaskPath', '')}{t.get('TaskName', '')}"
                obs.append({"kind": "host.persistence", "subject": f"task:{name}", "data": {"type": "scheduled_task", "name": name}})
            services = powershell_json(
                "Get-CimInstance Win32_Service -Filter \"StartMode='Auto'\" | Select-Object Name,PathName | ConvertTo-Json -Compress"
            )
            if services is None:
                complete = False
            for s in as_list(services):
                obs.append({"kind": "host.persistence", "subject": f"service:{s.get('Name')}", "data": {"type": "service", "name": s.get("Name"), "command": redact(s.get("PathName") or "")}})
        elif SYSTEM == "darwin":
            dirs = ["/Library/LaunchDaemons", "/Library/LaunchAgents"] + glob.glob("/Users/*/Library/LaunchAgents")
            for d in dirs:
                for p in sorted(glob.glob(os.path.join(d, "*.plist"))):
                    obs.append({"kind": "host.persistence", "subject": f"launchd:{p}", "data": {"type": "launchd", "name": os.path.basename(p)}})
        else:
            raise Unavailable(f"unsupported platform {SYSTEM}")
        return {"observations": obs, "complete": complete, "note": "" if complete else "Some autostart locations were not readable (run as root/Administrator)."}


# --------------------------------------------------------- file integrity

DEFAULT_FIM = {
    "linux": [
        "/etc/passwd", "/etc/shadow", "/etc/group", "/etc/sudoers", "/etc/ssh/sshd_config", "/etc/hosts",
        "/etc/crontab", "/etc/ld.so.preload", "/root/.ssh/authorized_keys", "/usr/bin/sudo", "/usr/sbin/sshd", "/bin/login",
    ],
    "windows": [r"C:\Windows\System32\drivers\etc\hosts", r"C:\ProgramData\ssh\sshd_config", r"C:\ProgramData\ssh\administrators_authorized_keys"],
    "darwin": ["/etc/hosts", "/etc/sudoers", "/etc/ssh/sshd_config", "/etc/pam.d/sudo"],
}


def sha256_file(path: str) -> str | None:
    try:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        return h.hexdigest()
    except OSError:
        return None


class Fim(Collector):
    id = "host.fim"

    def collect(self) -> dict:
        paths = list(DEFAULT_FIM.get(SYSTEM, [])) + [p for p in self.config.get("fim_paths", []) if isinstance(p, str)]
        obs = []
        complete = True
        for p in dict.fromkeys(paths):
            if not os.path.exists(p):
                continue  # absent files are simply not observed (their appearance is a change)
            digest = sha256_file(p)
            if digest is None:
                complete = False
                continue
            obs.append({"kind": "host.fim", "subject": p, "data": {"sha256": digest, "size": os.path.getsize(p)}})
        return {"observations": obs, "complete": complete, "note": "" if complete else "Some watched files were not readable (run as root/Administrator)."}


# ------------------------------------------------------------ device posture


def av_enabled(product_state: int) -> bool:
    """SecurityCenter2 productState: bits 12-13 (0x1000) = real-time protection on."""
    return bool((int(product_state) >> 12) & 0x1)


class Posture(Collector):
    id = "host.posture"

    def _windows(self) -> list[dict]:
        out = []
        bl = powershell_json(
            "$v=(New-Object -ComObject Shell.Application).NameSpace($env:SystemDrive).Self.ExtendedProperty('System.Volume.BitLockerProtection'); "
            "@{v=$v} | ConvertTo-Json -Compress"
        )
        if bl is not None and bl.get("v") is not None:
            # 1 = protection on, 2 = off, 3 = encrypting (on the way), 6 = on (unlocked)
            v = int(bl["v"])
            out.append({"subject": "disk_encryption", "data": {"enabled": v in (1, 3, 5, 6), "detail": f"BitLocker state {v} on the system drive"}})
        fw = powershell_json("Get-NetFirewallProfile | Select-Object Name,Enabled | ConvertTo-Json -Compress")
        if fw is not None:
            profiles = as_list(fw)
            off = [p.get("Name") for p in profiles if not p.get("Enabled")]
            out.append({"subject": "firewall", "data": {"enabled": not off, "detail": ("Off for: " + ", ".join(off)) if off else "On for all profiles"}})
        av = powershell_json(
            "Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct | Select-Object displayName,productState | ConvertTo-Json -Compress"
        )
        if av is not None:
            products = [p for p in as_list(av) if p.get("displayName")]
            active = [p["displayName"] for p in products if av_enabled(p.get("productState", 0))]
            out.append({"subject": "antivirus", "data": {"enabled": bool(active), "detail": ("Active: " + ", ".join(active)) if active else "No antivirus reports real-time protection on"}})
        return out

    def _linux(self, cloud: str | None, container: bool = False) -> list[dict]:
        out = []
        if container:
            out.append({"subject": "disk_encryption", "data": {"enabled": None, "detail": "The monitor runs in a container, so it can't see whether the server's own disk is encrypted — check that on the server itself."}})
        elif cloud:
            out.append({"subject": "disk_encryption", "data": {"enabled": None, "detail": f"On {cloud.upper()}, encryption at rest is a cloud volume setting (checked by the cloud adapter)."}})
        elif which("findmnt") and which("lsblk"):
            _, src = run(["findmnt", "-no", "SOURCE", "/"])
            src = src.strip()
            if src:
                _, types = run(["lsblk", "-rsno", "TYPE", src])
                out.append({"subject": "disk_encryption", "data": {"enabled": "crypt" in types.split(), "detail": f"root filesystem on {src}"}})
        if which("ufw"):
            code, st = run(["ufw", "status"])
            if code == 0:
                out.append({"subject": "firewall", "data": {"enabled": "Status: active" in st, "detail": "ufw"}})
        elif which("firewall-cmd"):
            _, st = run(["firewall-cmd", "--state"])
            out.append({"subject": "firewall", "data": {"enabled": st.strip() == "running", "detail": "firewalld"}})
        return out

    def _darwin(self) -> list[dict]:
        out = []
        _, fv = run(["fdesetup", "status"])
        if fv:
            out.append({"subject": "disk_encryption", "data": {"enabled": "FileVault is On" in fv, "detail": fv.strip()[:120]}})
        _, fw = run(["/usr/libexec/ApplicationFirewall/socketfilterfw", "--getglobalstate"])
        if fw:
            out.append({"subject": "firewall", "data": {"enabled": "enabled" in fw.lower(), "detail": fw.strip()[:120]}})
        return out

    def collect(self) -> dict:
        if SYSTEM == "windows":
            rows = self._windows()
        elif SYSTEM == "linux":
            rows = self._linux(self.config.get("_cloud"), bool(self.config.get("_container")))
        elif SYSTEM == "darwin":
            rows = self._darwin()
        else:
            raise Unavailable(f"unsupported platform {SYSTEM}")
        if not rows:
            raise Unavailable("no disk-encryption, firewall or antivirus status could be read on this host")
        return {"observations": [{"kind": "device.posture", "subject": r["subject"], "data": r["data"]} for r in rows]}


# ------------------------------------------------------------------ docker


def parse_docker_ports(container: str, image: str, ports: str) -> list[dict]:
    """'0.0.0.0:8080->80/tcp, :::8080->80/tcp, 127.0.0.1:5432->5432/tcp, 6379/tcp'"""
    out = []
    seen = set()
    for part in (p.strip() for p in ports.split(",")):
        m = re.match(r"^(.*):(\d+)->(\d+)/(\w+)$", part)
        if not m:
            continue  # exposed but not published
        host_ip = m.group(1).strip("[]")
        host_ip = "::" if host_ip in ("::", "") else host_ip
        subject = f"{container}:{m.group(2)}/{m.group(4)}"
        # 0.0.0.0 and :: publish the same port twice; one observation, widest binding.
        if subject in seen:
            if host_ip in ("0.0.0.0", "::"):
                for o in out:
                    if o["subject"] == subject:
                        o["data"]["host_ip"] = "0.0.0.0"
            continue
        seen.add(subject)
        out.append({"kind": "container.published_port", "subject": subject, "data": {"container": container, "image": image, "host_ip": host_ip, "host_port": int(m.group(2)), "container_port": int(m.group(3)), "proto": m.group(4)}})
    return out


class Docker(Collector):
    id = "host.docker"

    def collect(self) -> dict:
        if not which("docker"):
            raise Unavailable("Docker is not installed")
        code, out = run(["docker", "ps", "--format", "{{json .}}"])
        if code != 0:
            raise Unavailable("cannot talk to the Docker daemon (not running, or the sensor lacks permission)")
        obs = []
        for line in out.splitlines():
            try:
                c = json.loads(line)
            except ValueError:
                continue
            obs += parse_docker_ports(c.get("Names", "?"), c.get("Image", "?"), c.get("Ports", ""))
        return {"observations": obs}
