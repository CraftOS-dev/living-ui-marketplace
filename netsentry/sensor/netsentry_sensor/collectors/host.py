"""Host collectors: OS, listening ports, users, SSH. Parsers are plain functions
(tested against sample outputs); collect() only picks the platform strategy."""

from __future__ import annotations

import base64
import glob
import hashlib
import os
import platform
import re

from ..util import SYSTEM, as_list, powershell_json, read_text, run, which
from .base import Collector, Unavailable

# ------------------------------------------------------------------ OS info


class HostInfo(Collector):
    id = "host.info"

    def collect(self) -> dict:
        from ..environment import os_label
        from .probe import local_ips, primary_ip

        # This machine's own addresses: how NetSentry matches a router's port forward to it.
        main = primary_ip()
        addresses = [{"kind": "host.address", "subject": ip, "data": {"loopback": ip in ("127.0.0.1", "::1"), "primary": ip == main}}
                     for ip in sorted(local_ips())]
        return {
            "observations": [
                {"kind": "host.os", "subject": "os", "data": {"system": platform.system(), "release": platform.release(), "label": os_label(), "machine": platform.machine()}}
            ] + addresses
        }


# --------------------------------------------------------------- listeners

ALL_ADDRS = {"0.0.0.0", "::", "*", "[::]", ""}


def exposure_of(address: str) -> str:
    a = address.strip("[]")
    if a in ALL_ADDRS or address in ALL_ADDRS:
        return "all"
    if a.startswith("127.") or a == "::1" or a == "localhost":
        return "local"
    return "specific"


def split_addr_port(s: str) -> tuple[str, int] | None:
    """'0.0.0.0:22' | '[::]:22' | '*:22' | ':::22' | '127.0.0.1.631' (lsof uses ':')"""
    m = re.match(r"^(.*)[:.](\d+)$", s.strip())
    if not m:
        return None
    return m.group(1), int(m.group(2))


def parse_ss(output: str) -> list[dict]:
    """`ss -H -ltnp` lines: State Recv-Q Send-Q Local:Port Peer:Port [users:(("sshd",pid=1,fd=3))]"""
    rows = []
    for line in output.splitlines():
        parts = line.split()
        if len(parts) < 4 or parts[0] != "LISTEN":
            continue
        ap = split_addr_port(parts[3])
        if not ap:
            continue
        proc = re.search(r'users:\(\("([^"]+)"', line)
        rows.append({"proto": "tcp", "address": ap[0].split("%")[0], "port": ap[1], "process": proc.group(1) if proc else None})
    return rows


def parse_netstat_windows(output: str, names: dict[int, str]) -> list[dict]:
    """`netstat -ano -p TCP` and `-p TCPv6`: '  TCP    0.0.0.0:135    0.0.0.0:0    LISTENING    1234'"""
    rows = []
    for line in output.splitlines():
        parts = line.split()
        if len(parts) < 5 or parts[0].upper() != "TCP" or parts[3].upper() != "LISTENING":
            continue
        ap = split_addr_port(parts[1])
        if not ap:
            continue
        pid = int(parts[4]) if parts[4].isdigit() else None
        rows.append({"proto": "tcp", "address": ap[0], "port": ap[1], "process": names.get(pid) if pid is not None else None})
    return rows


def parse_lsof(output: str) -> list[dict]:
    """`lsof -nP -iTCP -sTCP:LISTEN`: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME (LISTEN)"""
    rows = []
    for line in output.splitlines()[1:]:
        parts = line.split()
        if len(parts) < 9 or "(LISTEN)" not in line:
            continue
        ap = split_addr_port(parts[8])
        if not ap:
            continue
        rows.append({"proto": "tcp", "address": ap[0], "port": ap[1], "process": parts[0]})
    return rows


def parse_tasklist(output: str) -> dict[int, str]:
    """`tasklist /fo csv /nh`: "sshd.exe","1234","Services","0","5,000 K" """
    names = {}
    for line in output.splitlines():
        cells = [c.strip('"') for c in line.split('","')]
        if len(cells) >= 2 and cells[1].strip('"').isdigit():
            names[int(cells[1].strip('"'))] = cells[0].strip('"')
    return names


def merge_listeners(rows: list[dict]) -> list[dict]:
    """One observation per protocol/port; exposure is the widest binding seen."""
    rank = {"local": 0, "specific": 1, "all": 2}
    by = {}
    for r in rows:
        key = f"{r['proto']}/{r['port']}"
        cur = by.setdefault(key, {"proto": r["proto"], "port": r["port"], "addresses": [], "exposure": "local", "process": r.get("process")})
        addr = r["address"]
        if addr not in cur["addresses"]:
            cur["addresses"].append(addr)
        e = exposure_of(addr)
        if rank[e] > rank[cur["exposure"]]:
            cur["exposure"] = e
        if not cur["process"] and r.get("process"):
            cur["process"] = r["process"]
    out = []
    for key in sorted(by, key=lambda k: (by[k]["proto"], by[k]["port"])):
        d = by[key]
        d["addresses"].sort()
        d["address"] = d["addresses"][0]
        out.append({"kind": "host.listener", "subject": key, "data": d})
    return out


class Listeners(Collector):
    id = "host.listeners"

    def collect(self) -> dict:
        if SYSTEM == "linux":
            code, out = run(["ss", "-H", "-ltnp"])
            if code == 127:
                raise Unavailable("the `ss` command is not installed")
            rows = parse_ss(out)
        elif SYSTEM == "windows":
            _, tl = run(["tasklist", "/fo", "csv", "/nh"])
            names = parse_tasklist(tl)
            rows = []
            for proto in ("TCP", "TCPv6"):
                _, out = run(["netstat", "-ano", "-p", proto])
                rows += parse_netstat_windows(out, names)
        elif SYSTEM == "darwin":
            code, out = run(["lsof", "-nP", "-iTCP", "-sTCP:LISTEN"])
            if code == 127:
                raise Unavailable("`lsof` is not available")
            rows = parse_lsof(out)
        else:
            raise Unavailable(f"unsupported platform {SYSTEM}")
        note = "" if rows and any(r.get("process") for r in rows) else "Process names need administrator/root rights."
        return {"observations": merge_listeners(rows), "note": note}


# ------------------------------------------------------------------- users

ADMIN_GROUPS = {"sudo", "wheel", "admin"}
NO_LOGIN = ("nologin", "/false", "/sync", "/shutdown", "/halt")


def parse_passwd_group(passwd: str, group: str) -> list[dict]:
    admins = set()
    for line in group.splitlines():
        parts = line.split(":")
        if len(parts) >= 4 and parts[0] in ADMIN_GROUPS:
            admins.update(u for u in parts[3].split(",") if u)
    users = []
    for line in passwd.splitlines():
        parts = line.split(":")
        if len(parts) < 7:
            continue
        name, uid, shell = parts[0], int(parts[2]) if parts[2].isdigit() else -1, parts[6]
        if uid != 0 and (uid < 1000 or uid == 65534):
            continue  # system accounts
        if any(shell.endswith(x) for x in NO_LOGIN):
            continue
        users.append({"kind": "host.user", "subject": name, "data": {"admin": uid == 0 or name in admins, "uid": uid, "home": parts[5]}})
    return users


class Users(Collector):
    id = "host.users"

    def collect(self) -> dict:
        if SYSTEM == "linux":
            passwd, group = read_text("/etc/passwd"), read_text("/etc/group") or ""
            if passwd is None:
                raise Unavailable("/etc/passwd is not readable")
            return {"observations": parse_passwd_group(passwd, group)}
        if SYSTEM == "windows":
            users = powershell_json("Get-LocalUser | Select-Object Name,Enabled | ConvertTo-Json -Compress")
            admins = powershell_json(
                "Get-LocalGroupMember -SID S-1-5-32-544 | Select-Object Name | ConvertTo-Json -Compress"
            )
            if users is None:
                raise Unavailable("could not list local users (PowerShell LocalAccounts module unavailable)")
            admin_names = {str(a.get("Name", "")).split("\\")[-1].lower() for a in as_list(admins)}
            obs = [
                {"kind": "host.user", "subject": u["Name"], "data": {"admin": u["Name"].lower() in admin_names, "enabled": bool(u.get("Enabled"))}}
                for u in as_list(users)
                if u.get("Name")
            ]
            return {"observations": obs, "complete": admins is not None, "note": "" if admins is not None else "Administrators group could not be read."}
        if SYSTEM == "darwin":
            _, out = run(["dscl", ".", "list", "/Users", "UniqueID"])
            _, adm = run(["dscl", ".", "read", "/Groups/admin", "GroupMembership"])
            admins = set(adm.replace("GroupMembership:", "").split())
            obs = []
            for line in out.splitlines():
                parts = line.split()
                if len(parts) == 2 and parts[1].isdigit() and int(parts[1]) >= 500 and not parts[0].startswith("_"):
                    obs.append({"kind": "host.user", "subject": parts[0], "data": {"admin": parts[0] in admins, "uid": int(parts[1])}})
            return {"observations": obs}
        raise Unavailable(f"unsupported platform {SYSTEM}")


# --------------------------------------------------------------------- SSH


def parse_sshd_config(text: str, read_include=None) -> dict:
    """OpenSSH semantics: the FIRST value of a keyword wins; Include is expanded in place."""
    seen: dict[str, str] = {}

    def walk(t: str, depth: int = 0):
        for raw in t.splitlines():
            line = raw.split("#", 1)[0].strip()
            if not line:
                continue
            parts = line.split(None, 1)
            key = parts[0].lower()
            val = parts[1].strip() if len(parts) > 1 else ""
            if key == "match":
                return  # settings after Match apply conditionally; stop at the first block
            if key == "include" and read_include and depth < 3:
                for sub in read_include(val):
                    walk(sub, depth + 1)
                continue
            seen.setdefault(key, val.lower())

    walk(text)
    return {
        "password_authentication": seen.get("passwordauthentication", "yes") == "yes",
        "permit_root_login": seen.get("permitrootlogin", "prohibit-password"),
        "kbd_interactive": seen.get("kbdinteractiveauthentication", seen.get("challengeresponseauthentication", "yes")) == "yes",
    }


def parse_sshd_t(output: str) -> dict:
    values = {}
    for line in output.splitlines():
        parts = line.split(None, 1)
        if len(parts) == 2:
            values.setdefault(parts[0].lower(), parts[1].strip().lower())
    return {
        "password_authentication": values.get("passwordauthentication") == "yes",
        "permit_root_login": values.get("permitrootlogin", "prohibit-password"),
        "kbd_interactive": values.get("kbdinteractiveauthentication") == "yes",
    }


def key_fingerprint(line: str) -> tuple[str, str] | None:
    """authorized_keys line → (type, 'SHA256:…') like `ssh-keygen -lf`; options prefix allowed."""
    for i, part in enumerate(line.split()):
        if part.startswith(("ssh-", "ecdsa-", "sk-")) and i + 1 < len(line.split()):
            blob = line.split()[i + 1]
            try:
                raw = base64.b64decode(blob, validate=True)
            except Exception:
                return None
            fp = base64.b64encode(hashlib.sha256(raw).digest()).decode().rstrip("=")
            return part, "SHA256:" + fp
    return None


class Ssh(Collector):
    id = "host.ssh"

    def _config(self) -> tuple[dict | None, str]:
        if which("sshd"):
            code, out = run(["sshd", "-T"])
            if code == 0 and out.strip():
                return parse_sshd_t(out), "sshd -T"
        path = r"C:\ProgramData\ssh\sshd_config" if SYSTEM == "windows" else "/etc/ssh/sshd_config"
        text = read_text(path)
        if text is None:
            return None, ""

        def include(pattern: str):
            base = os.path.dirname(path)
            for p in sorted(glob.glob(pattern if os.path.isabs(pattern) else os.path.join(base, pattern))):
                t = read_text(p)
                if t is not None:
                    yield t

        return parse_sshd_config(text, include), path

    def _key_files(self) -> list[tuple[str, str]]:
        files = []
        if SYSTEM == "windows":
            for home in glob.glob(r"C:\Users\*"):
                files.append((os.path.basename(home), os.path.join(home, ".ssh", "authorized_keys")))
            files.append(("administrators", r"C:\ProgramData\ssh\administrators_authorized_keys"))
        elif SYSTEM == "darwin":
            for home in glob.glob("/Users/*"):
                files.append((os.path.basename(home), os.path.join(home, ".ssh", "authorized_keys")))
            files.append(("root", "/var/root/.ssh/authorized_keys"))
        else:
            for line in (read_text("/etc/passwd") or "").splitlines():
                parts = line.split(":")
                if len(parts) >= 7 and parts[5] and parts[5] != "/":
                    files.append((parts[0], os.path.join(parts[5], ".ssh", "authorized_keys")))
        return files

    def collect(self) -> dict:
        obs = []
        cfg, source = self._config()
        if cfg is not None:
            cfg["source"] = source
            obs.append({"kind": "host.ssh_config", "subject": "sshd", "data": cfg})
        complete = True
        for user, path in self._key_files():
            if not os.path.exists(path):
                continue
            text = read_text(path)
            if text is None:
                complete = False  # exists but unreadable — do not report its keys as removed
                continue
            for line in text.splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                fp = key_fingerprint(line)
                if fp:
                    # Fingerprint only: key comments often hold names/emails.
                    obs.append({"kind": "host.authorized_key", "subject": f"{user}:{fp[1]}", "data": {"user": user, "type": fp[0], "fingerprint": fp[1]}})
        note = "" if complete else "Some authorized_keys files were not readable (run the sensor as root/Administrator)."
        if cfg is None and not obs:
            note = "No SSH server configuration found on this host."
        return {"observations": obs, "complete": complete, "note": note}
