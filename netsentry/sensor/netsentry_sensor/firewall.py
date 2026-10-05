"""The firewall on THIS server (v4 plan §7.7, N-B17).

Changed: ufw, firewalld and Windows Firewall. Shown, not changed: plain nftables.
Lock-out guard: before the firewall is switched on, SSH and NetSentry's own port are allowed
first; removing the last rule that lets SSH in is refused. Rules NetSentry adds are named
"NetSentry: …" so they're told apart from the owner's own.
"""

from __future__ import annotations

import ipaddress
import re

from .util import SYSTEM, as_list, powershell_json, run, which

LOCAL_NETS = ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")


class FirewallFailed(Exception):
    pass


def backend() -> str:
    if SYSTEM == "windows":
        return "windows"
    if SYSTEM != "linux":
        return ""
    if which("ufw"):
        return "ufw"
    if which("firewall-cmd"):
        code, out = run(["firewall-cmd", "--state"])
        if code == 0 and "running" in out:
            return "firewalld"
    if which("nft"):
        return "nftables"
    return ""


def ssh_ports() -> list[int]:
    if which("sshd"):
        code, out = run(["sshd", "-T"])
        ports = [int(line.split()[1]) for line in out.splitlines() if code == 0 and line.lower().startswith("port ") and line.split()[1].isdigit()]
        if ports:
            return sorted(set(ports))
    return [22]


def parse_ufw(text: str) -> dict:
    """`ufw status verbose` → enabled, default incoming, rules."""
    enabled = bool(re.search(r"^Status:\s*active", text, re.M))
    m = re.search(r"Default:\s*(\w+)\s*\(incoming\)", text)
    rules = []
    started = False
    for line in text.splitlines():
        if line.startswith("--"):
            started = True
            continue
        if not started or not line.strip():
            continue
        comment = ""
        if " # " in line:
            line, comment = line.split(" # ", 1)
        parts = re.split(r"\s{2,}", line.strip())
        if len(parts) < 3:
            continue
        to, action, frm = parts[0], parts[1], parts[2]
        v6 = "(v6)" in to or "(v6)" in frm
        to = to.replace(" (v6)", "").strip()
        frm = frm.replace(" (v6)", "").strip()
        pm = re.fullmatch(r"(\d{1,5})(?:/(tcp|udp))?", to)
        rules.append({"to": to, "port": int(pm.group(1)) if pm else None, "proto": (pm.group(2) or "any") if pm else "",
                      "action": action.split()[0].lower(), "from": "any" if frm.lower().startswith("anywhere") else frm,
                      "v6": v6, "ours": comment.strip().startswith("NetSentry"), "comment": comment.strip()})
    # one row per rule: a (v6) twin of an identical rule is the same rule
    seen, out = set(), []
    for r in rules:
        key = (r["to"], r["action"], r["from"])
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return {"enabled": enabled, "default_incoming": (m.group(1).lower() if m else ""), "rules": out}


def parse_ufw_added(text: str) -> list[dict]:
    """`ufw show added` (rules kept while ufw is off) → rules like parse_ufw's."""
    rules, seen = [], set()
    for line in text.splitlines():
        m = re.match(r"^ufw (allow|deny|reject|limit)(?: in)? (.+?)(?: comment '([^']*)')?$", line.strip())
        if not m:
            continue
        action, spec, comment = m.group(1), m.group(2), m.group(3) or ""
        src = re.search(r"from (\S+)", spec)
        port = re.search(r"port (\d{1,5})", spec) or re.match(r"^(\d{1,5})(?:/(tcp|udp))?$", spec)
        proto = re.search(r"proto (tcp|udp)", spec) or (re.match(r"^\d{1,5}/(tcp|udp)$", spec))
        frm = src.group(1) if src and src.group(1) != "any" else "any"
        p = int(port.group(1)) if port else None
        pr = (proto.group(1) if proto else "any") if p else ""
        key = (p, pr, frm, action)
        if key in seen:
            continue
        seen.add(key)
        rules.append({"to": f"{p}/{pr}" if p else spec, "port": p, "proto": pr, "action": action, "from": frm, "ours": comment.startswith("NetSentry"), "comment": comment})
    return rules


def collapse_local(rules: list[dict]) -> list[dict]:
    """The three private ranges NetSentry adds for "your local network" are one rule to a person."""
    out, done = [], set()
    for r in rules:
        key = (r.get("port"), r.get("proto"), r.get("action"))
        if r.get("from") in LOCAL_NETS:
            group = [x for x in rules if (x.get("port"), x.get("proto"), x.get("action")) == key and x.get("from") in LOCAL_NETS]
            if {x["from"] for x in group} == set(LOCAL_NETS):
                if key not in done:
                    done.add(key)
                    out.append(dict(r, **{"from": "local"}))
                continue
        out.append(r)
    return out


# Remote login, on any system: never blocked, and never the last rule letting it in switched off.
REMOTE_LOGIN = {22: "SSH", 3389: "Remote Desktop", 5985: "Windows Remote Management", 5986: "Windows Remote Management"}

WIN_RULES = (
    "$ports = @{}; Get-NetFirewallPortFilter -All | ForEach-Object { $ports[$_.InstanceID] = $_ }; "
    "$apps = @{}; Get-NetFirewallApplicationFilter -All | ForEach-Object { $apps[$_.InstanceID] = $_ }; "
    "$addr = @{}; Get-NetFirewallAddressFilter -All | ForEach-Object { $addr[$_.InstanceID] = $_ }; "
    "Get-NetFirewallRule -Direction Inbound | ForEach-Object { $p = $ports[$_.Name]; $a = $apps[$_.Name]; $r = $addr[$_.Name]; "
    "[pscustomobject]@{ i = $_.Name; n = $_.DisplayName; g = $_.DisplayGroup; e = [string]$_.Enabled; a = [string]$_.Action; f = [string]$_.Profile; "
    "p = [string]($p.LocalPort -join ','); t = [string]$p.Protocol; x = [string]$a.Program; r = [string](($r.RemoteAddress) -join ',') } } | ConvertTo-Json -Compress"
)


def windows_rule(r: dict) -> dict:
    """One rule from WIN_RULES → the shape every firewall here has (plus its id, group, program, profiles)."""
    ports = str(r.get("p") or "")
    proto = str(r.get("t") or "").lower()
    src = str(r.get("r") or "")
    program = str(r.get("x") or "")
    name = str(r.get("n") or "")
    return {
        "id": str(r.get("i") or ""), "name": name, "group": str(r.get("g") or ""),
        "enabled": str(r.get("e")) == "True", "action": "block" if str(r.get("a")) == "Block" else "allow",
        "profiles": str(r.get("f") or ""), "ports": "" if ports in ("Any", "") else ports,
        "port": int(ports) if ports.isdigit() else None, "proto": "" if proto in ("any", "") else proto,
        "program": "" if program in ("Any", "") else program,
        "from": "any" if src in ("Any", "") else ("local" if "LocalSubnet" in src else src),
        "to": f"{ports}/{proto}" if ports not in ("Any", "") else (program.split("\\")[-1] if program not in ("Any", "") else name),
        "ours": name.startswith("NetSentry:"),
    }


def status(params: dict | None = None) -> dict:
    b = backend()
    out: dict = {"backend": b, "ssh_ports": ssh_ports() if SYSTEM == "linux" else [22], "can_change": b in ("ufw", "firewalld", "windows")}
    if b == "ufw":
        code, text = run(["ufw", "status", "verbose"])
        if code != 0:
            raise FirewallFailed("ufw couldn't be read (the monitor needs to run as root)")
        out.update(parse_ufw(text))
        if not out.get("enabled"):
            # Off: its rules are kept, waiting — show them (they apply the moment it is switched on).
            _, added = run(["ufw", "show", "added"])
            out["rules"] = parse_ufw_added(added)
    elif b == "firewalld":
        _, zone = run(["firewall-cmd", "--get-default-zone"])
        zone = zone.strip()
        _, ports = run(["firewall-cmd", "--zone", zone, "--list-ports"])
        _, services = run(["firewall-cmd", "--zone", zone, "--list-services"])
        _, rich = run(["firewall-cmd", "--zone", zone, "--list-rich-rules"])
        rules = []
        for p in ports.split():
            m = re.fullmatch(r"(\d{1,5})/(tcp|udp)", p)
            if m:
                rules.append({"to": p, "port": int(m.group(1)), "proto": m.group(2), "action": "allow", "from": "any", "ours": False})
        for s in services.split():
            rules.append({"to": s, "port": 22 if s == "ssh" else None, "proto": "tcp" if s == "ssh" else "", "action": "allow", "from": "any", "service": s, "ours": False})
        for line in rich.splitlines():
            m = re.search(r'source address="([^"]+)".*port port="(\d+)" protocol="(tcp|udp)"', line)
            if m:
                rules.append({"to": f"{m.group(2)}/{m.group(3)}", "port": int(m.group(2)), "proto": m.group(3), "action": "allow", "from": m.group(1), "ours": False, "rich": line.strip()})
        out.update(enabled=True, default_incoming="deny", zone=zone, rules=rules)
    elif b == "windows":
        prof = as_list(powershell_json("Get-NetFirewallProfile | Select-Object Name,Enabled,DefaultInboundAction | ConvertTo-Json -Compress"))
        # v4 §17: every inbound rule — Windows' own and programs' too — so a person can manage them all here.
        rules = [windows_rule(r) for r in as_list(powershell_json(WIN_RULES, timeout=90))[:1500]]
        rules.sort(key=lambda r: (not r["enabled"], not r["ours"], r["name"].lower()))
        out.update(enabled=all(bool(p.get("Enabled")) for p in prof) if prof else False,
                   profiles=[{"name": p.get("Name"), "enabled": bool(p.get("Enabled"))} for p in prof],
                   default_incoming="deny", rules=rules, can_toggle=True)
    elif b == "nftables":
        code, text = run(["nft", "list", "ruleset"])
        out.update(enabled=bool(text.strip()), rules=[], raw=text[:20000] if code == 0 else "",
                   why_not="This server uses nftables directly; NetSentry shows its rules but doesn't change them (install ufw or firewalld to manage it here).")
    else:
        out.update(enabled=False, rules=[], why_not="No firewall NetSentry knows is installed (ufw is the simplest: apt install ufw).")
    out["rules"] = collapse_local(out.get("rules") or [])
    return out


def _check(port, proto: str, source: str) -> tuple[int, str, str]:
    try:
        port = int(port)
    except (TypeError, ValueError) as e:
        raise FirewallFailed("refused: not a port") from e
    if not 0 < port < 65536 or proto not in ("tcp", "udp"):
        raise FirewallFailed("refused: not a port")
    if source not in ("any", "local"):
        try:
            ipaddress.ip_network(source, strict=False)
        except ValueError as e:
            raise FirewallFailed("refused: not an address or network") from e
    return port, proto, source


def _sources(source: str) -> list[str]:
    return list(LOCAL_NETS) if source == "local" else [] if source == "any" else [source]


def _ufw_spec(port: int, proto: str, src: str | None) -> list[str]:
    return (["from", src, "to", "any", "port", str(port), "proto", proto] if src else [f"{port}/{proto}"])


def _apply(op: str, port: int, proto: str, source: str, label: str = "") -> None:
    b = backend()
    words = f"NetSentry: {label or f'allow {port}/{proto}'}"[:60]
    if b == "ufw":
        for src in _sources(source) or [None]:
            args = ["ufw"] + (["delete"] if op == "remove" else []) + ["allow"] + _ufw_spec(port, proto, src) + ([] if op == "remove" else ["comment", words])
            code, out = run(args, timeout=60)
            if code != 0:
                raise FirewallFailed(f"ufw refused: {out.strip()[:200]}")
    elif b == "firewalld":
        flag = "--add" if op == "add" else "--remove"
        for perm in ([], ["--permanent"]):
            if source == "any":
                code, out = run(["firewall-cmd", *perm, f"{flag}-port={port}/{proto}"])
            else:
                for src in _sources(source):
                    rule = f'rule family="ipv{6 if ":" in src else 4}" source address="{src}" port port="{port}" protocol="{proto}" accept'
                    code, out = run(["firewall-cmd", *perm, f"{flag}-rich-rule={rule}"])
            if code != 0:
                raise FirewallFailed(f"firewalld refused: {out.strip()[:200]}")
    elif b == "windows":
        name = f"{words} ({port}/{proto}{'' if source == 'any' else ', ' + source})"[:120]
        if op == "add":
            remote = "Any" if source == "any" else "LocalSubnet" if source == "local" else source
            script = f"New-NetFirewallRule -DisplayName '{name}' -Direction Inbound -Action Allow -Protocol {proto.upper()} -LocalPort {port} -RemoteAddress {remote} -ErrorAction Stop | Out-Null"
        else:
            script = f"Get-NetFirewallRule -DisplayName 'NetSentry:*' | Where-Object {{ ($_ | Get-NetFirewallPortFilter).LocalPort -eq '{port}' }} | Remove-NetFirewallRule -ErrorAction Stop"
        code, out = run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], timeout=60)
        if code != 0:
            raise FirewallFailed("Windows Firewall refused the change")
    else:
        raise FirewallFailed("NetSentry doesn't change this server's firewall (see Network & firewall)")


def _lets_ssh_in(st: dict, without: tuple | None = None) -> bool:
    ports = set(st.get("ssh_ports") or [22])
    for r in st.get("rules") or []:
        if without and (r.get("port"), r.get("proto"), r.get("from")) == without:
            continue
        if r.get("action") in ("allow", "limit") and (r.get("port") in ports or r.get("service") == "ssh" or str(r.get("to", "")).lower() in ("openssh", "ssh")):
            return True
    return False


def allow(params: dict) -> dict:
    port, proto, source = _check(params.get("port"), str(params.get("proto", "tcp")), str(params.get("source", "local")))
    _apply("add", port, proto, source, str(params.get("label", ""))[:40])
    return {"port": port, "proto": proto, "source": source, "label": str(params.get("label", ""))[:40],
            "note": f"port {port}/{proto} open to {'every network' if source == 'any' else 'your local network' if source == 'local' else source}"}


def allow_undo(saved: dict) -> None:
    _apply("remove", saved["port"], saved["proto"], saved["source"])


def remove(params: dict) -> dict:
    port, proto, source = _check(params.get("port"), str(params.get("proto", "tcp")), str(params.get("source", "any")))
    st = status()
    if st.get("enabled") and port in set(st.get("ssh_ports") or [22]) and not _lets_ssh_in(st, without=(port, proto, "any" if source == "any" else source)):
        raise FirewallFailed("refused: that is the last rule letting remote login (SSH) in — removing it would lock everyone out")
    _apply("remove", port, proto, source)
    return {"port": port, "proto": proto, "source": source, "note": f"closed port {port}/{proto}"}


def remove_undo(saved: dict) -> None:
    _apply("add", saved["port"], saved["proto"], saved["source"], "put back")


def _ps(script: str, why: str) -> None:
    code, out = run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], timeout=60)
    if code != 0:
        raise FirewallFailed(f"Windows Firewall refused: {why}")


def _q(text: str) -> str:
    """A PowerShell single-quoted string."""
    return "'" + str(text).replace("'", "''") + "'"


# any rule name, path ones too ("TCP Query User{guid}C:\...\app.exe"), but never a wildcard: -Name would match several
RULE_ID = re.compile(r"^[^\x00-\x1f\x7f*?\[\]]{1,400}$")


def _ports_of(rule: dict) -> set[int]:
    out = set()
    for part in str(rule.get("ports") or "").split(","):
        part = part.strip()
        if part.isdigit():
            out.add(int(part))
        elif "-" in part and all(x.strip().isdigit() for x in part.split("-", 1)):
            lo, hi = (int(x) for x in part.split("-", 1))
            out.update(p for p in REMOTE_LOGIN if lo <= p <= hi)
    return out


def toggle(params: dict) -> dict:
    """Switch rules off or on (Windows) — one row on screen can be several rules (TCP and UDP, each kind of
    network). Never the last rule letting remote login in."""
    if backend() != "windows":
        raise FirewallFailed("refused: switching rules off is for Windows Firewall (on Linux, close the port instead)")
    ids = [str(x) for x in (params.get("rule_ids") or ([params["rule_id"]] if params.get("rule_id") else []))]
    if not ids or len(ids) > 50 or not all(RULE_ID.match(i) for i in ids):
        raise FirewallFailed("refused: not a rule")
    on = bool(params.get("enable"))
    st = status()
    rules = [r for r in st.get("rules") or [] if r.get("id") in ids]
    if not rules:
        raise FirewallFailed("those rules aren't there any more")
    change = [r for r in rules if r["enabled"] != on]
    name = rules[0]["name"]
    if not on:
        going = {id(r) for r in change}
        for r in change:
            if r["action"] != "allow":
                continue
            for port in _ports_of(r) & set(REMOTE_LOGIN):
                if not [o for o in st["rules"] if id(o) not in going and o["enabled"] and o["action"] == "allow" and port in _ports_of(o)]:
                    raise FirewallFailed(f"refused: it's the last rule letting {REMOTE_LOGIN[port]} in — switching it off could lock everyone out")
    done = []
    try:
        for r in change:
            _ps(f"{'Enable' if on else 'Disable'}-NetFirewallRule -Name {_q(r['id'])} -ErrorAction Stop", "the rule didn't change")
            done.append(r["id"])
    except FirewallFailed:
        for rid in done:  # all or nothing
            _ps(f"{'Disable' if on else 'Enable'}-NetFirewallRule -Name {_q(rid)} -ErrorAction SilentlyContinue", "")
        raise
    return {"rule_ids": done, "was_enabled": not on, "name": name,
            "note": f"“{name}” switched {'on' if on else 'off'}" + (f" ({len(done)} rules)" if len(done) > 1 else "") if done else f"“{name}” was already {'on' if on else 'off'}"}


def toggle_undo(saved: dict) -> None:
    for rid in saved.get("rule_ids") or ([saved["rule_id"]] if saved.get("rule_id") else []):
        _ps(f"{'Enable' if saved['was_enabled'] else 'Disable'}-NetFirewallRule -Name {_q(rid)} -ErrorAction Stop", "the rule didn't change back")


def block(params: dict) -> dict:
    """Block a port (from everywhere, the local network or an address). Never remote login."""
    port, proto, source = _check(params.get("port"), str(params.get("proto", "tcp")), str(params.get("source", "any")))
    if port in REMOTE_LOGIN:
        raise FirewallFailed(f"refused: port {port} is {REMOTE_LOGIN[port]} — blocking it could lock everyone out")
    b = backend()
    name = f"NetSentry: block {port}/{proto}{'' if source == 'any' else ' from ' + source}"[:120]
    if b == "windows":
        remote = "Any" if source == "any" else "LocalSubnet" if source == "local" else source
        _ps(f"New-NetFirewallRule -DisplayName {_q(name)} -Direction Inbound -Action Block -Protocol {proto.upper()} -LocalPort {port} -RemoteAddress {remote} -ErrorAction Stop | Out-Null", "the block wasn't added")
    elif b == "ufw":
        for src in _sources(source) or [None]:
            code, out = run(["ufw", "insert", "1", "deny"] + _ufw_spec(port, proto, src) + ["comment", name[:60]], timeout=60)
            if code != 0:
                raise FirewallFailed(f"ufw refused: {out.strip()[:200]}")
    elif b == "firewalld":
        for perm in ([], ["--permanent"]):
            for src in _sources(source) or ["0.0.0.0/0"]:
                rule = f'rule family="ipv{6 if ":" in src else 4}" source address="{src}" port port="{port}" protocol="{proto}" reject'
                code, out = run(["firewall-cmd", *perm, f"--add-rich-rule={rule}"])
                if code != 0:
                    raise FirewallFailed(f"firewalld refused: {out.strip()[:200]}")
    else:
        raise FirewallFailed("NetSentry doesn't change this server's firewall (see Network & firewall)")
    return {"port": port, "proto": proto, "source": source, "name": name,
            "note": f"port {port}/{proto} blocked from {'every network' if source == 'any' else 'your local network' if source == 'local' else source}"}


def block_undo(saved: dict) -> None:
    b = backend()
    port, proto, source = saved["port"], saved["proto"], saved["source"]
    if b == "windows":
        _ps(f"Remove-NetFirewallRule -DisplayName {_q(saved['name'])} -ErrorAction Stop", "the block wasn't removed")
    elif b == "ufw":
        for src in _sources(source) or [None]:
            run(["ufw", "delete", "deny"] + _ufw_spec(port, proto, src), timeout=60)
    elif b == "firewalld":
        for perm in ([], ["--permanent"]):
            for src in _sources(source) or ["0.0.0.0/0"]:
                rule = f'rule family="ipv{6 if ":" in src else 4}" source address="{src}" port port="{port}" protocol="{proto}" reject'
                run(["firewall-cmd", *perm, f"--remove-rich-rule={rule}"])


PROFILES = ("Domain", "Private", "Public")


def profile(params: dict) -> dict:
    """Switch Windows Firewall on or off for one kind of network (Domain, Private, Public)."""
    if backend() != "windows":
        raise FirewallFailed("refused: network profiles are Windows Firewall's")
    name = str(params.get("profile") or "")
    if name not in PROFILES:
        raise FirewallFailed("refused: not a network profile")
    on = bool(params.get("enable"))
    was = next((p["enabled"] for p in status().get("profiles") or [] if p.get("name") == name), None)
    _ps(f"Set-NetFirewallProfile -Profile {name} -Enabled {'True' if on else 'False'} -ErrorAction Stop", "the profile didn't change")
    return {"profile": name, "was_enabled": bool(was) if was is not None else not on, "note": f"firewall {'on' if on else 'off'} for {name.lower()} networks"}


def profile_undo(saved: dict) -> None:
    _ps(f"Set-NetFirewallProfile -Profile {saved['profile']} -Enabled {'True' if saved['was_enabled'] else 'False'} -ErrorAction Stop", "the profile didn't change back")


def enable(params: dict) -> dict:
    b = backend()
    st = status()
    if st.get("enabled"):
        return {"was_enabled": True, "added": [], "note": "the firewall was already on"}
    keep = sorted({int(p) for p in (params.get("keep_open") or []) if str(p).isdigit()} | set(st.get("ssh_ports") or [22]))
    added = []
    for p in keep:
        if not any(r.get("port") == p and r.get("action") in ("allow", "limit") and r.get("from") == "any" for r in st.get("rules") or []):
            _apply("add", p, "tcp", "any", f"keep {p} open")
            added.append(p)
    if b == "ufw":
        code, out = run(["ufw", "--force", "enable"], timeout=60)
    elif b == "windows":
        code, out = run(["powershell", "-NoProfile", "-NonInteractive", "-Command", "Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled True"], timeout=60)
    else:
        raise FirewallFailed("NetSentry switches on ufw and Windows Firewall (firewalld is already on when it runs)")
    if code != 0:
        for p in added:
            _apply("remove", p, "tcp", "any")
        raise FirewallFailed(f"the firewall didn't switch on: {out.strip()[:200]}")
    return {"was_enabled": False, "added": added, "note": f"firewall on; kept open: {', '.join(map(str, keep))}"}


def enable_undo(saved: dict) -> None:
    if saved.get("was_enabled"):
        return
    b = backend()
    if b == "ufw":
        run(["ufw", "--force", "disable"], timeout=60)
    elif b == "windows":
        run(["powershell", "-NoProfile", "-NonInteractive", "-Command", "Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled False"], timeout=60)
    for p in saved.get("added") or []:
        try:
            _apply("remove", p, "tcp", "any")
        except FirewallFailed:
            pass
