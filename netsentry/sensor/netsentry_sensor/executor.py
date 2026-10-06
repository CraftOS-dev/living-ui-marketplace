"""
The monitor's executor (docs/SYSTEM-V2-PLAN.md §23.3): applies NetSentry's own
approved fixes on THIS machine, one typed action at a time, and undoes them.

Safety, in order:
  1. Off unless switched on here: NETSENTRY_EXECUTOR=on in the monitor's environment.
     The console can never turn it on (a compromised console cannot make it act).
  2. Only the actions below, with parameters checked HERE too (its own allow-list).
  3. Before each step the previous state is saved locally; any failure undoes
     every step already done, in reverse. Verification failures undo too.
  4. Every step is reported (and audited by the console).
"""

from __future__ import annotations

import glob
import io
import json
import os
import re
import signal
import tarfile
import time
import urllib.parse

from .client import ConsoleError
from .util import SYSTEM, read_text, run, which

# What app.config.set may ever change (app setting → the only value allowed). Anything else is refused.
ALLOWED_CONFIG = {
    "Preferences/WebUI\\AuthSubnetWhitelistEnabled": "false",
    "Preferences/WebUI\\LocalHostAuth": "true",
}
SSH_DROPIN = "/etc/ssh/sshd_config.d/10-netsentry.conf"
SSH_CONTENT = "# Added by NetSentry (fix: turn off password logins). Delete this file to undo.\nPasswordAuthentication no\nKbdInteractiveAuthentication no\n"


class StepFailed(Exception):
    pass


def enabled() -> bool:
    return os.environ.get("NETSENTRY_EXECUTOR", "").strip().lower() in ("1", "on", "true", "yes")


# ------------------------------------------------------------------ router

def _router(router_id: str):
    from .collectors.probe import _http, is_private, parse_device, ssdp_search
    for loc in ssdp_search():
        host = urllib.parse.urlparse(loc).hostname or ""
        if not is_private(host):
            continue
        status, body, _ = _http("GET", loc)
        if status != 200:
            continue
        dev = parse_device(body.decode("utf-8", "replace"), loc)
        if (dev["identity"].get("UDN") or loc) == router_id and dev["control_url"]:
            return dev
    raise StepFailed("the router did not answer (UPnP)")


def _find_mapping(dev, ext: int, proto: str) -> dict | None:
    from .collectors.probe import parse_mapping, soap_call
    for i in range(256):
        st, xml = soap_call(dev["control_url"], dev["service"], "GetGenericPortMappingEntry", {"NewPortMappingIndex": i})
        if st != 200:
            return None
        m = parse_mapping(xml)
        if m["external_port"] == ext and m["proto"] == proto:
            return m
    return None


def router_remove(params: dict) -> dict:
    from .collectors.probe import soap_call
    ext, proto = int(params["external_port"]), str(params["proto"]).upper()
    if not (0 < ext < 65536) or proto not in ("TCP", "UDP"):
        raise StepFailed("bad port or protocol")
    dev = _router(str(params["router_id"]))
    before = _find_mapping(dev, ext, proto)
    if not before:
        return {"router_id": params["router_id"], "mapping": None, "note": "the rule was already gone"}
    from .collectors.probe import local_ips
    if before.get("internal_client") not in local_ips():
        raise StepFailed("refused: that router rule sends traffic to another server, not this one")
    st, _ = soap_call(dev["control_url"], dev["service"], "DeletePortMapping", {"NewRemoteHost": "", "NewExternalPort": ext, "NewProtocol": proto})
    if st != 200 or _find_mapping(dev, ext, proto):
        raise StepFailed("the router refused to remove the rule (it may have been added by hand — remove it in the router's settings)")
    return {"router_id": params["router_id"], "mapping": before}


def router_restore(saved: dict) -> None:
    from .collectors.probe import soap_call
    m = saved.get("mapping")
    if not m:
        return
    dev = _router(saved["router_id"])
    st, _ = soap_call(dev["control_url"], dev["service"], "AddPortMapping", {
        "NewRemoteHost": m.get("remote_host", ""), "NewExternalPort": m["external_port"], "NewProtocol": m["proto"],
        "NewInternalPort": m["internal_port"], "NewInternalClient": m["internal_client"], "NewEnabled": 1,
        "NewPortMappingDescription": m.get("description", ""), "NewLeaseDuration": 0})
    if st != 200:
        raise StepFailed("the router refused to put the rule back")


# --------------------------------------------------------------------- SSH

def _authorized_keys_present() -> bool:
    paths = glob.glob("/root/.ssh/authorized_keys") + glob.glob("/home/*/.ssh/authorized_keys")
    for p in paths:
        for line in (read_text(p) or "").splitlines():
            if line.strip() and not line.strip().startswith("#"):
                return True
    return False


def _sshd_effective() -> dict:
    code, out = run(["sshd", "-T"])
    if code != 0:
        raise StepFailed("could not read the effective SSH settings (sshd -T)")
    vals = {}
    for line in out.splitlines():
        parts = line.split(None, 1)
        if len(parts) == 2:
            vals.setdefault(parts[0].lower(), parts[1].strip().lower())
    return vals


def _reload_sshd() -> None:
    for unit in ("ssh", "sshd"):
        if which("systemctl") and run(["systemctl", "reload", unit])[0] == 0:
            return
    code, out = run(["pidof", "sshd"])
    pids = [int(p) for p in out.split()] if code == 0 else []
    if not pids:
        raise StepFailed("could not reload SSH")
    os.kill(min(pids), signal.SIGHUP)  # the listener (oldest) reloads its settings; sessions stay


def ssh_disable_passwords(params: dict) -> dict:
    if SYSTEM != "linux":
        raise StepFailed("this fix is available on Linux only")
    if not _authorized_keys_present():
        raise StepFailed("no sign-in key is set up on this server — turning passwords off would lock everyone out")
    previous = read_text(SSH_DROPIN)
    os.makedirs(os.path.dirname(SSH_DROPIN), exist_ok=True)
    with open(SSH_DROPIN, "w", encoding="utf-8") as f:
        f.write(SSH_CONTENT)
    code, out = run(["sshd", "-t"])
    if code != 0:
        _restore_file(SSH_DROPIN, previous)
        raise StepFailed("SSH rejected the new settings: " + out[:200])
    _reload_sshd()
    time.sleep(1)
    if _sshd_effective().get("passwordauthentication") != "no":
        _restore_file(SSH_DROPIN, previous)
        _reload_sshd()
        raise StepFailed("SSH still allows passwords (the main config may not include sshd_config.d)")
    return {"previous": previous}


def ssh_restore(saved: dict) -> None:
    _restore_file(SSH_DROPIN, saved.get("previous"))
    _reload_sshd()


def _restore_file(path: str, previous: str | None) -> None:
    if previous is None:
        if os.path.exists(path):
            os.remove(path)
    else:
        with open(path, "w", encoding="utf-8") as f:
            f.write(previous)


# ---------------------------------------------------------- app settings

def set_ini_value(text: str, key: str, value: str) -> str:
    """Set Section/Name=value in an INI text, keeping everything else as it was."""
    section, _, name = key.partition("/")
    lines = text.splitlines()
    out, current, done = [], None, False
    for line in lines:
        m = re.match(r"^\s*\[(.+)\]\s*$", line)
        if m:
            if current == section and not done:
                out.append(f"{name}={value}")
                done = True
            current = m.group(1)
        elif current == section and line.split("=", 1)[0] == name:
            line = f"{name}={value}"
            done = True
        out.append(line)
    if not done:
        if current == section:
            out.append(f"{name}={value}")
        else:
            out += ["", f"[{section}]", f"{name}={value}"]
    return "\n".join(out) + "\n"


def _docker():
    from .collectors.containers import DockerApi
    return DockerApi()


def _container_id(api, name: str) -> str:
    for c in api.json("/containers/json?all=1"):
        if name in [n.lstrip("/") for n in c.get("Names") or []]:
            return c["Id"]
    raise StepFailed(f"container {name} not found")


def _put_file(api, cid: str, path: str, text: str) -> None:
    buf = io.BytesIO()
    data = text.encode("utf-8")
    with tarfile.open(fileobj=buf, mode="w") as t:
        info = tarfile.TarInfo(os.path.basename(path))
        info.size, info.mode, info.mtime = len(data), 0o644, int(time.time())
        info.uid = info.gid = 1000
        t.addfile(info, io.BytesIO(data))
    status, body = api.send("PUT", f"/containers/{cid}/archive?path={urllib.parse.quote(os.path.dirname(path))}", buf.getvalue(), {"Content-Type": "application/x-tar"})
    if status != 200:
        raise StepFailed(f"could not write the settings file ({status})")


def _restart(api, cid: str, stop_first: bool) -> None:
    if stop_first:
        api.send("POST", f"/containers/{cid}/stop?t=20")
    status, _ = api.send("POST", f"/containers/{cid}/start")
    if status not in (204, 304):
        raise StepFailed(f"the app did not start again ({status})")


def app_config_set(params: dict) -> dict:
    key, value = str(params.get("key", "")), str(params.get("value", ""))
    if ALLOWED_CONFIG.get(key) != value or params.get("format") != "ini":
        raise StepFailed("this setting is not one NetSentry may change")
    api = _docker()
    if not api.available:
        raise StepFailed("Docker is not reachable from the monitor")
    cid = _container_id(api, str(params["container"]))
    from .collectors.containers import allowed_read
    image = ((api.json(f"/containers/{cid}/json").get("Config") or {}).get("Image")) or ""
    ok = allowed_read(image, str(params["path"]), "ini", [{"key": key}])
    if not ok or not ok[0]:
        raise StepFailed("refused: that container and file are not ones NetSentry may change")
    original = api.read_file(cid, str(params["path"]))
    if original is None:
        raise StepFailed("could not read the settings file")
    api.send("POST", f"/containers/{cid}/stop?t=20")  # stop first: the app rewrites its settings when it stops
    _put_file(api, cid, str(params["path"]), set_ini_value(api.read_file(cid, str(params["path"])) or original, key, value))
    _restart(api, cid, stop_first=False)
    return {"container": params["container"], "path": params["path"], "original": original}


def app_config_restore(saved: dict) -> None:
    api = _docker()
    cid = _container_id(api, saved["container"])
    api.send("POST", f"/containers/{cid}/stop?t=20")
    _put_file(api, cid, saved["path"], saved["original"])
    _restart(api, cid, stop_first=False)


# ------------------------------------------------------------------- cloud

WORLD = ("0.0.0.0/0", "::/0")


def _aws_ec2(action: str, params: list) -> tuple[int, str]:
    """An EC2 call with this instance's own role (the opt-in remediator: the role must be allowed to change security groups)."""
    from .collectors.cloud import Aws
    aws = Aws()
    creds = aws.creds()
    if not creds:
        raise StepFailed("this instance has no cloud role")
    region = aws.md("placement/region") or "us-east-1"
    body = urllib.parse.urlencode([("Action", action), ("Version", "2016-11-15")] + params).encode()
    s, b = aws.call("POST", "ec2", region, aws.url("ec2", region), creds, body, {"content-type": "application/x-www-form-urlencoded; charset=utf-8"})
    return s, b.decode("utf-8", "replace")


def _rule_params(p: dict) -> list:
    field = "Ipv6Ranges.1.CidrIpv6" if ":" in p["cidr"] else "IpRanges.1.CidrIp"
    return [("GroupId", p["group"]), ("IpPermissions.1.IpProtocol", p["proto"]), ("IpPermissions.1.FromPort", str(p["from_port"])),
            ("IpPermissions.1.ToPort", str(p["to_port"])), (f"IpPermissions.1.{field}", p["cidr"])]


def aws_revoke_ingress(params: dict) -> dict:
    """Remove ONE security-group rule that lets the whole internet in. Nothing else is touched."""
    p = {"group": str(params.get("group", "")), "proto": str(params.get("proto", "tcp")).lower(), "from_port": int(params.get("from_port", -1)),
         "to_port": int(params.get("to_port", -1)), "cidr": str(params.get("cidr", ""))}
    if not re.fullmatch(r"sg-[0-9a-f]{8,32}", p["group"]) or p["cidr"] not in WORLD or p["proto"] not in ("tcp", "udp") or not (0 <= p["from_port"] <= p["to_port"] < 65536):
        raise StepFailed("refused: only a rule open to the whole internet on a security group can be removed")
    from .collectors.cloud import Aws
    aws = Aws()
    mine = aws.md(f"network/interfaces/macs/{aws.md('mac')}/security-group-ids").split()
    if p["group"] not in mine:
        raise StepFailed("refused: that security group is not this instance's")
    s, text = _aws_ec2("RevokeSecurityGroupIngress", _rule_params(p))
    if s == 403 or "UnauthorizedOperation" in text:
        raise StepFailed("the instance's role may not change security groups (add ec2:RevokeSecurityGroupIngress and ec2:AuthorizeSecurityGroupIngress to let NetSentry fix this)")
    if s != 200:
        raise StepFailed(f"AWS refused to remove the rule ({s})")
    return {"rule": p}


def aws_restore_ingress(saved: dict) -> None:
    p = saved.get("rule")
    if not p:
        return
    s, text = _aws_ec2("AuthorizeSecurityGroupIngress", _rule_params(p))
    if s != 200 and "InvalidPermission.Duplicate" not in text:
        raise StepFailed(f"AWS refused to put the rule back ({s})")


# ------------------------------------------------------------------ v3: running things

# Never started/stopped/restarted through NetSentry: what keeps the machine reachable, its
# security, Docker itself, and this monitor. Matched on the name without ".service".
PROTECTED_SERVICES = {
    "ssh", "sshd", "openssh-server", "networking", "network", "networkmanager", "systemd-networkd", "systemd-resolved",
    "dbus", "dbus-broker", "polkit", "udev", "systemd-udevd", "systemd-journald", "systemd-logind", "getty@tty1",
    "docker", "containerd", "podman", "ufw", "firewalld", "nftables", "iptables", "apparmor", "auditd", "fail2ban",
    "tailscaled", "cloudflared", "wg-quick@wg0", "netsentry-sensor",
    # Windows: remote management, networking, security, the event log
    "rpcss", "rpceptmapper", "lanmanserver", "lanmanworkstation", "winrm", "termservice", "dhcp", "dnscache", "nsi",
    "eventlog", "mpssvc", "windefend", "bfe", "sense", "wuauserv", "schedule", "netsentry",
}
WAIT_SECONDS = 30


def _protected(unit: str) -> bool:
    return unit.lower().removesuffix(".service") in PROTECTED_SERVICES


def _is_me(api, cid: str, inspect: dict) -> bool:
    """This monitor's own container (labelled by our templates, or the container we run in)."""
    labels = (inspect.get("Config") or {}).get("Labels") or {}
    if labels.get("netsentry.role") == "monitor":
        return True
    me = os.environ.get("HOSTNAME", "")
    return bool(me) and os.path.exists("/.dockerenv") and cid.startswith(me)


def _container_state(api, cid: str) -> dict:
    return (api.json(f"/containers/{cid}/json").get("State") or {})


def _wait_state(api, cid: str, running: bool) -> dict:
    """Until the container is (not) running, up to 30 s; then the proof."""
    end = time.time() + WAIT_SECONDS
    st = {}
    while time.time() < end:
        st = _container_state(api, cid)
        if bool(st.get("Running")) == running and not st.get("Restarting"):
            return st
        time.sleep(1)
    raise StepFailed(f"it is still {'not running' if running else 'running'} after {WAIT_SECONDS} s ({st.get('Status', '?')})")


def _operate_container(params: dict, what: str) -> dict:
    name = str(params.get("container", ""))
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}", name):
        raise StepFailed("refused: that is not a container name")
    api = _docker()
    if not api.available:
        raise StepFailed("Docker is not reachable from the monitor")
    cid = _container_id(api, name)
    inspect = api.json(f"/containers/{cid}/json")
    if _is_me(api, cid, inspect):
        raise StepFailed("refused: that is NetSentry's own monitor")
    was_running = bool((inspect.get("State") or {}).get("Running"))
    path = {"restart": f"/containers/{cid}/restart?t=20", "stop": f"/containers/{cid}/stop?t=20", "start": f"/containers/{cid}/start"}[what]
    status, body = api.send("POST", path)
    if status not in (204, 304):
        raise StepFailed(f"Docker refused ({status}): {body[:160].decode('utf-8', 'replace')}")
    st = _wait_state(api, cid, running=(what != "stop"))
    health = (st.get("Health") or {}).get("Status", "")
    note = f"{name} is {'running' if st.get('Running') else 'stopped'}" + (f" (health: {health})" if health else "")
    return {"container": name, "was_running": was_running, "note": note}


def container_restart(params: dict) -> dict:
    return _operate_container(params, "restart")


def container_stop(params: dict) -> dict:
    return _operate_container(params, "stop")


def container_start(params: dict) -> dict:
    return _operate_container(params, "start")


def container_put_back(saved: dict) -> None:
    """Undo a stop/start: leave the container as it was before (running or not)."""
    if "was_running" not in saved:
        return
    api = _docker()
    cid = _container_id(api, saved["container"])
    running = bool(_container_state(api, cid).get("Running"))
    if running != saved["was_running"]:
        api.send("POST", f"/containers/{cid}/{'start' if saved['was_running'] else 'stop?t=20'}")


def _service_check(unit: str) -> str:
    # A service only (a bare name or name.service) — never a target, socket or timer (reboot.target, ssh.socket…).
    if not re.fullmatch(r"[A-Za-z0-9@_-][A-Za-z0-9@_.-]{0,110}", unit) or ("." in unit and not unit.endswith(".service")):
        raise StepFailed("refused: that is not a service name")
    if _protected(unit):
        raise StepFailed("refused: NetSentry never starts or stops what keeps the server reachable or safe, Docker, or itself")
    return unit


def _systemd_active(unit: str) -> str:
    _, out = run(["systemctl", "show", unit, "-p", "ActiveState,LoadState", "--no-pager"])
    kv = dict(line.split("=", 1) for line in out.splitlines() if "=" in line)
    if kv.get("LoadState") != "loaded":
        raise StepFailed(f"there is no service {unit} on this server")
    return kv.get("ActiveState", "")


def _windows_service(unit: str) -> dict:
    from .util import powershell_json
    r = powershell_json(f"Get-Service -Name '{unit}' -ErrorAction Stop | Select-Object Name,Status | ConvertTo-Json -Compress")
    if not r:
        raise StepFailed(f"there is no service {unit} on this server")
    return {"running": str(r.get("Status")) in ("4", "Running")}


def _operate_service(params: dict, what: str) -> dict:
    unit = _service_check(str(params.get("unit", "")))
    if SYSTEM == "linux":
        before = _systemd_active(unit)
        code, _ = run(["systemctl", what, unit], timeout=90)
        if code != 0:
            raise StepFailed(f"systemctl {what} {unit} failed (exit {code})")
        end, state = time.time() + WAIT_SECONDS, ""
        want = "inactive" if what == "stop" else "active"
        while time.time() < end:
            state = _systemd_active(unit)
            if state == want or (want == "inactive" and state == "failed"):
                return {"unit": unit, "was_running": before == "active", "note": f"{unit} is {state}"}
            time.sleep(1)
        raise StepFailed(f"{unit} is {state} after {WAIT_SECONDS} s")
    if SYSTEM == "windows":
        before = _windows_service(unit)["running"]
        verb = {"restart": "Restart-Service", "stop": "Stop-Service", "start": "Start-Service"}[what]
        code, _ = run(["powershell", "-NoProfile", "-NonInteractive", "-Command", f"{verb} -Name '{unit}' -ErrorAction Stop"], timeout=90)
        if code != 0:
            raise StepFailed(f"{verb} {unit} failed")
        now = _windows_service(unit)["running"]
        if now != (what != "stop"):
            raise StepFailed(f"{unit} is {'running' if now else 'stopped'} afterwards")
        return {"unit": unit, "was_running": before, "note": f"{unit} is {'running' if now else 'stopped'}"}
    raise StepFailed("services can be managed on Linux (systemd) and Windows only")


def service_restart(params: dict) -> dict:
    return _operate_service(params, "restart")


def service_stop(params: dict) -> dict:
    return _operate_service(params, "stop")


def service_start(params: dict) -> dict:
    return _operate_service(params, "start")


def service_put_back(saved: dict) -> None:
    if "was_running" not in saved:
        return
    unit = _service_check(saved["unit"])
    if SYSTEM == "linux":
        running = _systemd_active(unit) == "active"
        if running != saved["was_running"]:
            run(["systemctl", "start" if saved["was_running"] else "stop", unit], timeout=90)
    elif SYSTEM == "windows":
        if _windows_service(unit)["running"] != saved["was_running"]:
            verb = "Start-Service" if saved["was_running"] else "Stop-Service"
            run(["powershell", "-NoProfile", "-NonInteractive", "-Command", f"{verb} -Name '{unit}'"], timeout=90)


# ------------------------------------------------------------------ v3: updates

_CONTEXT: dict = {}  # set by Executor for the step running now: {"rid", "fixes"}


def app_update(params: dict) -> dict:
    from . import update
    try:
        return update.apply(params, _CONTEXT.get("rid", ""), _is_me)
    except update.UpdateFailed as e:
        raise StepFailed(str(e)) from e


def app_update_undo(saved: dict) -> None:
    from . import update
    update.put_back(update._api(), saved)


def app_rollback(params: dict) -> dict:
    """"Roll back" an update done earlier: what THIS monitor recorded when it did it, never the console's word."""
    from . import update
    change = str(params.get("change_id", ""))
    entry = ((_CONTEXT.get("fixes") or {}).get(change) or {}).get("0") or {}
    saved = entry.get("state") if entry.get("action") == "app.update" else None
    if not saved or saved.get("container") != params.get("container"):
        raise StepFailed("this server has no record of that update (or it is older than 14 days)")
    if saved.get("rolled_back"):
        raise StepFailed("that update was already rolled back (doing it again would overwrite newer data)")
    try:
        note = update.put_back(update._api(), saved)
    except update.UpdateFailed as e:
        raise StepFailed(str(e)) from e
    saved["rolled_back"] = True
    return {"note": note}


# Never upgraded by a security-update job: what could lock the owner out or stop the machine booting.
# (They still show as waiting; a person does them with a restart planned.)
RISKY_PACKAGES = re.compile(r"^(openssh-server|openssh|linux-image.*|linux-headers.*|linux-generic.*|kernel.*|grub.*|systemd.*|udev|netplan.*|network-manager|ifupdown|iptables|nftables|firewalld|ufw|docker.*|containerd.*|runc|cloud-init|shim.*)$")


def os_security_updates(params: dict) -> dict:
    pkgs = [str(p) for p in params.get("packages") or []]
    if not pkgs or any(not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9+.:~_-]{0,127}", p) for p in pkgs):
        raise StepFailed("refused: not a list of package names")
    # "openssh-server:amd64" (apt) and "kernel.x86_64" (dnf) are judged by their name alone.
    base = lambda p: re.sub(r"(:[a-z0-9]+|\.(x86_64|aarch64|i686|noarch|armv7hl|ppc64le|s390x))$", "", p)
    skipped = [p for p in pkgs if RISKY_PACKAGES.match(base(p))]
    pkgs = [p for p in pkgs if p not in skipped]
    if not pkgs:
        raise StepFailed("everything waiting needs a person (remote login, the kernel, networking or Docker) — install those with a restart planned")
    if SYSTEM != "linux":
        raise StepFailed("NetSentry installs operating-system updates on Linux; on Windows use Windows Update")
    env = dict(os.environ, DEBIAN_FRONTEND="noninteractive")
    if which("apt-get"):
        import subprocess
        upd = subprocess.run(["apt-get", "update", "-q"], capture_output=True, text=True, timeout=600, env=env)
        if upd.returncode != 0:
            raise StepFailed("apt-get update failed")
        r = subprocess.run(["apt-get", "install", "--only-upgrade", "-y", "-q", "-o", "Dpkg::Options::=--force-confold", *pkgs], capture_output=True, text=True, timeout=1800, env=env)
    elif which("dnf"):
        import subprocess
        r = subprocess.run(["dnf", "upgrade", "-y", "-q", *pkgs], capture_output=True, text=True, timeout=1800)
    else:
        raise StepFailed("no supported package manager (apt, dnf)")
    if r.returncode != 0:
        raise StepFailed(f"the package manager failed: {(r.stderr or r.stdout).strip().splitlines()[-1:] or ['?']}")
    note = f"installed {len(pkgs)} security update(s)" + (f"; left for a person: {', '.join(skipped[:8])}" if skipped else "")
    return {"note": note, "installed": pkgs, "skipped": skipped}


def os_reboot(params: dict) -> dict:
    delay = int(params.get("delay_minutes", 0))
    if not 1 <= delay <= 1440:
        raise StepFailed("refused: a restart is scheduled 1 minute to 24 hours ahead")
    if SYSTEM == "linux":
        code, _ = run(["shutdown", "-r", f"+{delay}", "NetSentry: restart a person confirmed"])
    elif SYSTEM == "windows":
        code, _ = run(["shutdown", "/r", "/t", str(delay * 60), "/c", "NetSentry: restart a person confirmed"])
    else:
        raise StepFailed("restarts are scheduled on Linux and Windows")
    if code != 0:
        raise StepFailed("the server refused to schedule the restart (the monitor needs to run as root / an administrator)")
    return {"note": f"restart scheduled in {delay} minute(s)", "scheduled": True}


def os_reboot_cancel(saved: dict) -> None:
    if saved.get("scheduled"):
        run(["shutdown", "-c"] if SYSTEM == "linux" else ["shutdown", "/a"])


def _nothing(saved: dict) -> None:
    return None


def _backup(fn):
    def go(params: dict) -> dict:
        from . import backup
        try:
            return getattr(backup, fn)(params)
        except backup.BackupFailed as e:
            raise StepFailed(str(e)) from e
    return go


def app_install(params: dict) -> dict:
    from . import install
    if params.get("template") == "custom":  # v4 §7.4: a pasted Compose file, every risk accepted
        from . import compose
        try:
            return compose.install_custom(params)
        except compose.ComposeFailed as e:
            raise StepFailed(str(e)) from e
    try:
        return install.apply(params)
    except install.InstallFailed as e:
        raise StepFailed(str(e)) from e


def app_install_undo(saved: dict) -> None:
    from . import install
    install.undo(saved)


# ------------------------------------------------------------------ v4: everyday and server jobs (§7)

def _v4(module: str, fn: str, error: str, with_context: bool = False):
    """A v4 job's function, its own error turned into StepFailed."""
    def go(arg):
        import importlib
        mod = importlib.import_module(f".{module}", __package__)
        try:
            f = getattr(mod, fn)
            return f(arg, _CONTEXT) if with_context else f(arg)
        except getattr(mod, error) as e:
            raise StepFailed(str(e)) from e
    return go


def files_upload(params: dict) -> dict:
    from . import files
    fetch = _CONTEXT.get("fetch_transfer")
    if not fetch:
        raise StepFailed("the file couldn't be fetched from NetSentry")
    try:
        return files.upload(params, fetch)
    except files.FilesFailed as e:
        raise StepFailed(str(e)) from e


def command_run(params: dict) -> dict:
    from . import terminal
    try:
        return terminal.command_run(params)
    except terminal.CommandFailed as e:
        raise StepFailed(str(e)) from e


V4_ACTIONS = {
    "files.write": (_v4("files", "write", "FilesFailed"), _v4("files", "write_undo", "FilesFailed")),
    "files.mkdir": (_v4("files", "mkdir", "FilesFailed"), _v4("files", "mkdir_undo", "FilesFailed")),
    "files.move": (_v4("files", "move", "FilesFailed"), _v4("files", "move_undo", "FilesFailed")),
    "files.delete": (_v4("files", "delete", "FilesFailed"), _v4("files", "delete_undo", "FilesFailed")),
    "files.upload": (files_upload, _v4("files", "upload_undo", "FilesFailed")),
    "app.settings.set": (_v4("compose", "settings_set", "ComposeFailed"), _v4("compose", "file_undo", "ComposeFailed")),
    "app.compose.apply": (_v4("compose", "apply_file", "ComposeFailed"), _v4("compose", "file_undo", "ComposeFailed")),
    "app.remove": (_v4("compose", "remove", "ComposeFailed"), _v4("compose", "remove_undo", "ComposeFailed")),
    "disk.cleanup": (_v4("disk", "cleanup", "CleanupFailed", with_context=True), _nothing),
    "process.stop": (_v4("procs", "stop", "ProcFailed"), _nothing),
    "firewall.allow": (_v4("firewall", "allow", "FirewallFailed"), _v4("firewall", "allow_undo", "FirewallFailed")),
    "firewall.remove": (_v4("firewall", "remove", "FirewallFailed"), _v4("firewall", "remove_undo", "FirewallFailed")),
    "firewall.enable": (_v4("firewall", "enable", "FirewallFailed"), _v4("firewall", "enable_undo", "FirewallFailed")),
    "firewall.rule.toggle": (_v4("firewall", "toggle", "FirewallFailed"), _v4("firewall", "toggle_undo", "FirewallFailed")),
    "firewall.block": (_v4("firewall", "block", "FirewallFailed"), _v4("firewall", "block_undo", "FirewallFailed")),
    "firewall.profile": (_v4("firewall", "profile", "FirewallFailed"), _v4("firewall", "profile_undo", "FirewallFailed")),
    "ssh.key.add": (_v4("keys", "add", "KeysFailed"), _v4("keys", "add_undo", "KeysFailed")),
    "ssh.key.remove": (_v4("keys", "remove", "KeysFailed"), _v4("keys", "remove_undo", "KeysFailed")),
    "schedule.set": (_v4("schedules", "set_paused", "ScheduleFailed"), _v4("schedules", "set_paused_undo", "ScheduleFailed")),
    "schedule.create": (_v4("schedules", "create", "ScheduleFailed"), _v4("schedules", "create_undo", "ScheduleFailed")),
    "schedule.delete": (_v4("schedules", "delete", "ScheduleFailed"), _v4("schedules", "delete_undo", "ScheduleFailed")),
    "remote.tailscale.install": (_v4("remote_access", "install", "RemoteFailed"), _v4("remote_access", "install_undo", "RemoteFailed")),
    "command.run": (command_run, _nothing),
}


ACTIONS = {
    "app.install": (app_install, app_install_undo),
    "backup.run": (_backup("run"), _nothing),
    "backup.test": (_backup("test"), _nothing),
    "backup.restore": (_backup("restore"), _nothing),
    "app.update": (app_update, app_update_undo),
    "app.rollback": (app_rollback, _nothing),
    "os.security_updates": (os_security_updates, _nothing),
    "os.reboot": (os_reboot, os_reboot_cancel),
    "container.restart": (container_restart, container_put_back),
    "container.stop": (container_stop, container_put_back),
    "container.start": (container_start, container_put_back),
    "service.restart": (service_restart, service_put_back),
    "service.stop": (service_stop, service_put_back),
    "service.start": (service_start, service_put_back),
    "router.remove_port_mapping": (router_remove, router_restore),
    "cloud.aws.revoke_ingress": (aws_revoke_ingress, aws_restore_ingress),
    "ssh.disable_passwords": (ssh_disable_passwords, ssh_restore),
    "app.config.set": (app_config_set, app_config_restore),
}
ACTIONS.update(V4_ACTIONS)
# Results people read in full (a command's output) are longer than a step's usual one line.
LONG_NOTES = {"command.run": 3800}
# Actions that run a command someone typed: they come with the terminal (NETSENTRY_TERMINAL).
COMMANDS = ("command.run", "schedule.create")


def available_actions() -> list[str]:
    """What this monitor will do — a command (now, or on a schedule) only when the terminal is switched on here too."""
    from . import terminal
    return sorted(a for a in ACTIONS if a not in COMMANDS or terminal.enabled())


# ------------------------------------------------------------------ runner

class Executor:
    def __init__(self, client, state: dict, log=print, state_dir: str = ""):
        self.client = client
        self.state = state.setdefault("fixes", {})
        self.log = log
        if state_dir:
            from . import files, update
            update.SNAPSHOT_ROOT = os.path.join(state_dir, "snapshots")
            files.STATE_DIR = state_dir

    def housekeeping(self) -> None:
        """Old containers and copies kept for "Roll back" go after 14 days; the bins empty after 7."""
        from . import compose, files, update
        for clean in (files.housekeeping, compose.housekeeping):
            try:
                clean()
            except Exception as e:
                self.log(f"[housekeeping] {e}")
        updates = {rid: e["0"]["state"] for rid, e in self.state.items() if isinstance(e, dict) and (e.get("0") or {}).get("action") == "app.update"}
        for rid in update.housekeeping(updates):
            self.state.pop(rid, None)

    def _report(self, rid: str, event: str, keep: bool = True, **kw) -> dict:
        """Tell NetSentry how a change went. Once a change has started, what happened on the server
        must reach NetSentry: a report the console can't take now (busy, unreachable) is kept and sent
        before anything else (``flush_outbox``) — a lost "done" would leave the change "executing"."""
        params = dict({"remediation_id": rid, "event": event}, **kw)
        outbox = self.state.setdefault("outbox", [])
        if keep and outbox:
            outbox.append(params)  # keep the order: earlier reports of this change go first
            return {}
        try:
            return self.client.call("fixes.monitor-report", params)
        except ConsoleError as e:
            if not keep or e.status not in (429, 500, 502, 503, 504):
                raise
        except OSError:
            if not keep:
                raise
        outbox.append(params)
        self.log(f"[fix {rid}] NetSentry didn't take the '{event}' report; kept to send again")
        return {}

    def flush_outbox(self) -> bool:
        """Send the reports kept earlier, in order; True when none are left."""
        outbox = self.state.get("outbox") or []
        while outbox:
            try:
                self.client.call("fixes.monitor-report", outbox[0])
            except ConsoleError as e:
                if e.status in (429, 500, 502, 503, 504):
                    return False
                self.log(f"[fix {outbox[0].get('remediation_id')}] NetSentry refused a kept report: {e}")
            except OSError:
                return False
            outbox.pop(0)
        return True

    def run(self, jobs: list[dict]) -> None:
        if not enabled():
            return
        if not self.flush_outbox():
            return  # what already happened goes first
        for job in jobs:
            try:
                self.apply(job) if job.get("kind") == "apply" else self.undo(job)
            except Exception as e:  # one job must not stop the monitor
                self.log(f"[fix {job.get('id')}] {type(e).__name__}: {e}")

    def apply(self, job: dict) -> None:
        rid, steps = job["id"], job["plan"]["steps"]
        for s in steps:
            if s.get("action") not in available_actions():
                raise StepFailed(f"unknown action {s.get('action')}")
        self._report(rid, "claim", keep=False)  # nothing happens on the server unless NetSentry agreed
        saved = self.state.setdefault(rid, {})
        for i, s in enumerate(steps):
            do, _ = ACTIONS[s["action"]]
            _CONTEXT.update(rid=rid, fixes=self.state, fetch_transfer=getattr(self.client, "fetch_transfer", None))
            try:
                state = do(s.get("params") or {})
                saved[str(i)] = {"action": s["action"], "state": state}  # undo uses THIS, never the console's word
            except Exception as e:
                reason = str(e) if isinstance(e, StepFailed) else f"{type(e).__name__}: {e}"
                self._report(rid, "step", step_index=i, outcome="failed", output=reason[:LONG_NOTES.get(s["action"], 300)])
                self._undo_steps(steps, saved, range(i - 1, -1, -1))
                saved["_undone"] = True
                self._report(rid, "fail", reason=f"Step {i + 1} failed: {reason}"[:max(500, LONG_NOTES.get(s["action"], 0))], rolled_back=i > 0)
                self.log(f"[fix {rid}] step {i + 1} failed ({reason}); earlier steps undone")
                return
            # The step worked: a report that doesn't get through is kept, never taken for a failed step.
            self._report(rid, "step", step_index=i, outcome="ok", output=str(state.get("note", "done"))[:LONG_NOTES.get(s["action"], 900)])
            self.log(f"[fix {rid}] step {i + 1}: {s['description']} — done")
        self._report(rid, "complete", plan_hash=job["plan_hash"])
        self.log(f"[fix {rid}] applied; NetSentry now checks it worked")

    def undo(self, job: dict) -> None:
        rid, steps = job["id"], job["plan"]["steps"]
        saved = self.state.setdefault(rid, {})
        # Already undone here (its report was kept and NetSentry asked again meanwhile): never twice.
        if not saved.get("_undone"):
            self._undo_steps(steps, saved, sorted(job.get("done_steps") or [], reverse=True))
            saved["_undone"] = True
        elif any(o.get("remediation_id") == rid and o.get("event") == "rolled_back" for o in self.state.get("outbox") or []):
            return  # its report is already waiting to be sent
        self._report(rid, "rolled_back", output="Every step was undone on the server.")
        self.log(f"[fix {rid}] undone")

    def _undo_steps(self, steps, saved, order) -> None:
        for i in order:
            entry = saved.get(str(i))
            if not entry or entry.get("action") not in ACTIONS:
                continue  # nothing this monitor recorded doing: nothing to undo
            _, undo = ACTIONS[entry["action"]]
            undo(entry["state"])
