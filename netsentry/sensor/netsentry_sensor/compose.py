"""An app's settings, its Compose file, a pasted Compose file and removing an app (v4 plan §7.2–§7.4).

Docker reads every Compose file itself (`docker compose config --no-interpolate --format json`):
no YAML library, and `${VARS}` stay as they are. Changes are applied to what Docker read, written
back tidily (the old file is kept beside it as <file>.before-<time>), and brought up with the update
health gate; a failure puts the old file back and brings that up again (N-B13).

The risks of a Compose file are found HERE (N-B14): a new risk only goes ahead when the person
accepted its id, and that list is part of the plan they confirmed.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import urllib.parse
import uuid

from .util import which

MAX_COMPOSE = 256_000
SECRET_NAME = re.compile(r"(?i)(pass(word|wd)?|secret|token|api[_-]?key|private[_-]?key|credential|_key$|^key$|salt|auth)")
HIDDEN = "••• hidden •••"
SYSTEM_PATHS = ("/", "/etc", "/root", "/boot", "/proc", "/sys", "/dev", "/usr", "/bin", "/sbin", "/lib", "/lib64", "/var", "/var/lib/docker", "/run", "/var/run", "/home", "/opt")
HARMLESS = ("/etc/localtime", "/etc/timezone")
STRONG_CAPS = {"ALL", "SYS_ADMIN", "NET_ADMIN", "SYS_PTRACE", "SYS_MODULE", "DAC_READ_SEARCH", "SYS_RAWIO", "BPF", "PERFMON"}


class ComposeFailed(Exception):
    pass


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _need_compose() -> None:
    if not which("docker") or subprocess.run(["docker", "compose", "version"], capture_output=True).returncode != 0:
        raise ComposeFailed("this server needs Docker with its compose plugin (docker compose)")


def config(folder: str, project: str, files: list[str]) -> dict:
    """What Docker reads from these Compose files (variables left as written)."""
    _need_compose()
    args = ["docker", "compose", "-p", project]
    for f in files:
        args += ["-f", f]
    r = subprocess.run(args + ["config", "--no-interpolate", "--format", "json"], cwd=folder, capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        msg = (r.stderr or r.stdout).strip().splitlines()
        raise ComposeFailed("Docker can't read it: " + (msg[-1] if msg else "unknown error")[:300])
    try:
        return json.loads(r.stdout)
    except ValueError as e:
        raise ComposeFailed("Docker's answer wasn't readable") from e


def _labels(c: dict) -> dict:
    return (c.get("Config") or {}).get("Labels") or {}


def compose_of(c: dict) -> dict | None:
    """The Compose project a container came from: {project, service, folder, files} or None."""
    lab = _labels(c)
    project = lab.get("com.docker.compose.project")
    if not project:
        return None
    files = [f.strip() for f in str(lab.get("com.docker.compose.project.config_files") or "").split(",") if f.strip()]
    return {"project": project, "service": lab.get("com.docker.compose.service", ""), "folder": lab.get("com.docker.compose.project.working_dir", ""), "files": files}


def _mask_env(env) -> dict:
    out = {}
    if isinstance(env, list):
        env = dict((e.split("=", 1) + [""])[:2] for e in env)
    for k, v in (env or {}).items():
        out[k] = HIDDEN if (v and SECRET_NAME.search(k)) else v
    return out


def settings(params: dict) -> dict:
    """What an app is set to (read): ports, folders, environment (secret values hidden), restart."""
    from .update import _api, _container
    name = str(params.get("container", ""))
    api = _api()
    c = _container(api, name)
    host = c.get("HostConfig") or {}
    out = {
        "container": name, "image": (c.get("Config") or {}).get("Image"), "running": bool((c.get("State") or {}).get("Running")),
        "restart": (host.get("RestartPolicy") or {}).get("Name") or "no", "compose": False,
    }
    # What Docker says it runs with — always there, whether or not NetSentry can change it (v4 walk:
    # the screen broke on an app it couldn't change, because these were missing).
    bindings = host.get("PortBindings") or {}
    out["ports"] = [{"target": int(k.split("/")[0]), "protocol": k.split("/")[1] if "/" in k else "tcp", "published": int(b.get("HostPort") or 0), "host_ip": b.get("HostIp") or ""}
                    for k, v in bindings.items() for b in (v or []) if b.get("HostPort")]
    image_env = set(((api.json(f"/images/{c.get('Image')}/json") or {}).get("Config") or {}).get("Env") or []) if c.get("Image") else set()
    out["environment"] = _mask_env([e for e in (c.get("Config") or {}).get("Env") or [] if e not in image_env])  # what the owner set, not the image's defaults
    out["volumes"] = [{"type": m.get("Type"), "source": m.get("Source") if m.get("Type") == "bind" else m.get("Name"), "target": m.get("Destination"), "read_only": not m.get("RW", True)} for m in c.get("Mounts") or []]
    info = compose_of(c)
    if not info:
        out["why_not"] = "This app wasn't started with Docker Compose, so NetSentry shows its settings but can't change them."
        return out
    out.update(compose=True, project=info["project"], service=info["service"], folder=info["folder"], files=info["files"])
    if len(info["files"]) != 1 or not os.path.isfile(info["files"][0]):
        out["why_not"] = "This app is made of several Compose files (or its file is gone), so NetSentry can't change it safely — edit it in Files or the terminal."
        return out
    cfg = config(info["folder"], info["project"], info["files"])
    svc = (cfg.get("services") or {}).get(info["service"]) or {}
    out["ports"] = [{"target": p.get("target"), "published": int(p["published"]) if str(p.get("published", "")).isdigit() else p.get("published"), "protocol": p.get("protocol", "tcp"), "host_ip": p.get("host_ip", "")} for p in svc.get("ports") or []]
    out["environment"] = _mask_env(svc.get("environment") or {})
    out["volumes"] = [{"type": v.get("type"), "source": v.get("source"), "target": v.get("target"), "read_only": bool(v.get("read_only"))} for v in svc.get("volumes") or []]
    out["restart"] = svc.get("restart") or out["restart"]
    with open(info["files"][0], encoding="utf-8", errors="replace") as f:
        text = f.read()
    out["file"] = info["files"][0]
    out["file_sha256"] = _sha(text)
    out["file_text"] = text if len(text) <= MAX_COMPOSE else None
    out["risks"] = risks(cfg, info["folder"])
    return out


# ------------------------------------------------------------------ risks (N-B14)

def _allowed_roots(own: str) -> list[str]:
    from . import files
    roots = [r["path"] for r in files.roots() if r["mode"] == "rw"]
    if own:
        roots.append(own)
    return [os.path.normcase(os.path.realpath(r)) for r in roots if r]


def _under(path: str, roots: list[str]) -> bool:
    p = os.path.normcase(os.path.realpath(path))
    return any(p == r or p.startswith(r.rstrip(os.sep) + os.sep) for r in roots)


def risks(cfg: dict, own_folder: str = "") -> list[dict]:
    """What in a Compose project reaches beyond its own folder: [{id, words, level}] (pure, apart from the roots)."""
    allowed = _allowed_roots(own_folder)
    out: list[dict] = []

    def add(rid: str, words: str, level: str) -> None:
        if not any(r["id"] == rid for r in out):
            out.append({"id": rid, "words": words, "level": level})

    for name, svc in sorted((cfg.get("services") or {}).items()):
        if svc.get("privileged"):
            add(f"{name}:privileged", f"{name} gets full control of the server (privileged)", "high")
        for cap in svc.get("cap_add") or []:
            cap = str(cap).upper().removeprefix("CAP_")
            add(f"{name}:cap:{cap}", f"{name} gets the extra power {cap}", "high" if cap in STRONG_CAPS else "medium")
        if svc.get("devices"):
            add(f"{name}:devices", f"{name} uses the server's devices directly", "medium")
        if svc.get("network_mode") == "host":
            add(f"{name}:host-network", f"{name} shares the server's network (every port it opens is open on the server)", "medium")
        if svc.get("pid") == "host":
            add(f"{name}:host-pid", f"{name} sees and can signal every program on the server", "high")
        if svc.get("ipc") == "host":
            add(f"{name}:host-ipc", f"{name} shares the server's memory channels", "medium")
        for opt in svc.get("security_opt") or []:
            if "unconfined" in str(opt) or str(opt).replace(" ", "") in ("no-new-privileges:false", "no-new-privileges=false"):
                add(f"{name}:unconfined", f"{name} turns off Docker's protections ({opt})", "high")
        user = str(svc.get("user") or "")
        if user in ("0", "root") or user.startswith(("0:", "root:")):
            add(f"{name}:root", f"{name} runs as root inside its container", "low")
        for v in svc.get("volumes") or []:
            if v.get("type") != "bind":
                continue
            src = str(v.get("source") or "")
            ro = bool(v.get("read_only"))
            if src.rstrip("/").endswith(("docker.sock", "podman.sock")):
                add(f"{name}:docker-socket", f"{name} controls Docker — which means the whole server", "high")
            elif src in HARMLESS:
                continue
            elif src.rstrip("/") in SYSTEM_PATHS or any(src.startswith(p + "/") for p in ("/etc", "/root", "/boot", "/proc", "/sys", "/dev", "/usr", "/var/lib/docker", "/run", "/var/run")):
                add(f"{name}:sees:{src}", f"{name} can {'read' if ro else 'read and change'} {src} on the server", "high" if not ro else "medium")
            elif not _under(src, allowed):
                add(f"{name}:sees:{src}", f"{name} can {'read' if ro else 'read and change'} {src}, outside the app's own folder", "medium" if not ro else "low")
        # One risk per app, whatever its port numbers: changing a port isn't a new risk, opening it to every address is.
        everywhere = [str(p.get("published") or p.get("target")) for p in svc.get("ports") or [] if str(p.get("host_ip") or "") in ("", "0.0.0.0", "::")]
        if everywhere:
            add(f"{name}:port-all", f"{name} is reachable on every address of the server (port{'s' if len(everywhere) > 1 else ''} {', '.join(everywhere)})", "medium")
    return out


def _check_accepted(found: list[dict], accepted) -> None:
    ok = {str(a) for a in accepted or []}
    missing = [r for r in found if r["id"] not in ok]
    if missing:
        raise ComposeFailed("refused: not accepted — " + "; ".join(r["words"] for r in missing[:4]))


def _rebase(value, old: str, new: str):
    """Paths Docker resolved inside the scratch folder, moved to where the app will live."""
    if isinstance(value, dict):
        return {k: _rebase(v, old, new) for k, v in value.items()}
    if isinstance(value, list):
        return [_rebase(v, old, new) for v in value]
    if isinstance(value, str) and (value == old or value.startswith(old + os.sep) or value.startswith(old + "/")):
        return new + value[len(old):].replace(os.sep, "/")
    return value


def check(params: dict) -> dict:
    """A pasted Compose file: what Docker reads from it, and its risks (read; nothing runs)."""
    content = str(params.get("content", ""))
    if not content.strip() or len(content) > MAX_COMPOSE:
        raise ComposeFailed("paste a Compose file (up to 256 KB)")
    project = str(params.get("project") or "check")
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,39}", project):
        raise ComposeFailed("the name may use small letters, digits, - and _")
    from . import files
    base = os.path.join(files.STATE_DIR or tempfile.gettempdir(), "compose-check")
    os.makedirs(base, mode=0o700, exist_ok=True)
    folder = tempfile.mkdtemp(dir=base)
    try:
        path = os.path.join(folder, "compose.yaml")
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        cfg = config(folder, project, [path])
        # Relative folders resolve to where it will live (<apps folder>/<name>), not this scratch folder.
        root = str(params.get("root") or "/srv/apps")
        cfg = _rebase(cfg, folder, os.path.join(root, project))
        services = [{"name": n, "image": s.get("image", ""), "ports": [f"{p.get('host_ip') or 'every address'}:{p.get('published') or '?'} → {p.get('target')}/{p.get('protocol', 'tcp')}" for p in s.get("ports") or []],
                     "builds": bool(s.get("build"))} for n, s in sorted((cfg.get("services") or {}).items())]
        return {"ok": True, "services": services, "risks": risks(cfg, os.path.join(root, project)), "sha256": _sha(content)}
    finally:
        shutil.rmtree(folder, ignore_errors=True)


# ------------------------------------------------------------------ writing a project

def to_yaml_doc(cfg: dict, header: str) -> str:
    from .install import to_yaml
    return header + "\n" + to_yaml(cfg) + "\n"


def _up(folder: str, project: str, file: str, *extra: str) -> subprocess.CompletedProcess:
    return subprocess.run(["docker", "compose", "-p", project, "-f", file, "up", "-d", *extra], cwd=folder, capture_output=True, text=True, timeout=900)


def _gate(container: str, port=None, host=None) -> str:
    from .update import _api, _container, health_gate
    api = _api()
    c = _container(api, container)
    return health_gate(api, c["Id"], port, seconds=300, steady=15, host=host)


def _first_port(svc: dict):
    for p in svc.get("ports") or []:
        if str(p.get("published", "")).isdigit() and p.get("protocol", "tcp") == "tcp":
            return int(p["published"]), str(p.get("host_ip") or "") or None
    return None, None


def _replace_file(file: str, text: str) -> str:
    backup = f"{file}.before-{time.strftime('%Y%m%d-%H%M%S')}"
    shutil.copy2(file, backup)
    tmp = f"{file}.netsentry-{uuid.uuid4().hex[:6]}"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    shutil.copymode(file, tmp)
    os.replace(tmp, file)
    return backup


def _bring_back(saved: dict) -> None:
    if saved.get("backup") and os.path.isfile(saved["backup"]):
        shutil.copyfile(saved["backup"], saved["file"])
        # As it was — running or stopped (a stopped app isn't started by putting its settings back).
        _up(saved["folder"], saved["project"], saved["file"], "--remove-orphans", *([] if saved.get("was_running", True) else ["--no-start"]))


def _running(c: dict) -> bool:
    return bool((c.get("State") or {}).get("Running"))


def _project_of(params: dict) -> tuple[dict, dict]:
    from .update import _api, _container
    from .executor import _is_me
    api = _api()
    c = _container(api, str(params.get("container", "")))
    if _is_me(api, c["Id"], c):
        raise ComposeFailed("refused: that is NetSentry's own monitor")
    info = compose_of(c)
    if not info or len(info["files"]) != 1 or info["files"][0] != str(params.get("file", "")) or not os.path.isfile(info["files"][0]):
        raise ComposeFailed("refused: that app's Compose file isn't the one shown (or it's made of several files)")
    with open(info["files"][0], encoding="utf-8", errors="replace") as f:
        if _sha(f.read()) != str(params.get("file_sha256", "")):
            raise ComposeFailed("its Compose file changed on the server since you opened the settings — open them again")
    return c, info


PORT = re.compile(r"^\d{1,5}$")
IP = re.compile(r"^(\d{1,3}(\.\d{1,3}){3}|[0-9a-fA-F:]+)?$")
ENV_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_.-]{0,100}$")
RESTART = ("no", "always", "unless-stopped", "on-failure")


def _apply_changes(svc: dict, ch: dict) -> None:
    if "ports" in ch:
        ports = []
        for p in ch["ports"] or []:
            pub, tgt = str(p.get("published", "")), str(p.get("target", ""))
            if not (PORT.match(pub) and PORT.match(tgt) and 0 < int(pub) < 65536 and 0 < int(tgt) < 65536) or p.get("protocol", "tcp") not in ("tcp", "udp") or not IP.match(str(p.get("host_ip", ""))):
                raise ComposeFailed("refused: a port that isn't a port")
            item = {"mode": "ingress", "target": int(tgt), "published": pub, "protocol": p.get("protocol", "tcp")}
            if p.get("host_ip"):
                item["host_ip"] = str(p["host_ip"])
            ports.append(item)
        svc["ports"] = ports
    if "environment" in ch:
        env = dict(svc.get("environment") or {})
        for k, v in (ch["environment"] or {}).items():
            if not ENV_NAME.match(str(k)):
                raise ComposeFailed(f"refused: {k} isn't a setting name")
            if v is None:
                env.pop(k, None)
            elif v == HIDDEN:
                continue  # unchanged secret
            elif not isinstance(v, str) or "\n" in v or len(v) > 4000:
                raise ComposeFailed(f"refused: the value of {k}")
            else:
                env[k] = v
        svc["environment"] = env
    if "restart" in ch:
        if ch["restart"] not in RESTART:
            raise ComposeFailed("refused: not a restart rule")
        svc["restart"] = ch["restart"]
    if "volumes" in ch:
        vols = []
        for v in ch["volumes"] or []:
            src, tgt = str(v.get("source", "")), str(v.get("target", ""))
            if not tgt.startswith("/") or "\n" in src + tgt:
                raise ComposeFailed("refused: a folder that isn't a folder")
            kind = v.get("type") if v.get("type") in ("bind", "volume") else ("bind" if src.startswith("/") else "volume")
            item = {"type": kind, "source": src, "target": tgt}
            if v.get("read_only"):
                item["read_only"] = True
            if kind == "bind":
                item["bind"] = {"create_host_path": True}
            vols.append(item)
        svc["volumes"] = vols


def settings_set(params: dict) -> dict:
    """The form: ports, environment, restart rule, folders — applied, brought up, health-checked."""
    c, info = _project_of(params)
    cfg = config(info["folder"], info["project"], info["files"])
    before = risks(cfg, info["folder"])
    svc = (cfg.get("services") or {}).get(info["service"])
    if svc is None:
        raise ComposeFailed("that app's service isn't in its Compose file any more")
    _apply_changes(svc, params.get("changes") or {})
    added = [r for r in risks(cfg, info["folder"]) if r["id"] not in {b["id"] for b in before}]
    _check_accepted(added, params.get("accepted_risks"))
    file = info["files"][0]
    text = to_yaml_doc(cfg, f"# Rewritten by NetSentry on {time.strftime('%Y-%m-%d %H:%M')} (settings changed: {', '.join(sorted((params.get('changes') or {}).keys()))}).\n# The file as it was is kept beside this one (.before-<time>).")
    saved = {"file": file, "folder": info["folder"], "project": info["project"], "service": info["service"], "container": str(params["container"]), "was_running": _running(c)}
    saved["backup"] = _replace_file(file, text)
    try:
        # A stopped app stays stopped (v4 walk: a settings edit started an app someone had stopped on purpose).
        r = _up(info["folder"], info["project"], file, "--no-deps", *([] if saved["was_running"] else ["--no-start"]), info["service"])
        if r.returncode != 0:
            raise ComposeFailed("Docker couldn't apply the new settings: " + ((r.stderr or r.stdout).strip().splitlines() or ["?"])[-1][:200])
        if saved["was_running"]:
            port, host = _first_port(svc)
            proof = _gate(saved["container"], port, host)
    except Exception as e:
        _bring_back(saved)
        raise ComposeFailed(f"{e} — its settings are back as they were") from e
    who = params.get('app') or saved['container']
    saved["note"] = f"{who} runs with its new settings ({proof})" if saved["was_running"] else f"{who}'s new settings are saved; it stays stopped until it's started"
    return saved


def apply_file(params: dict) -> dict:
    """Advanced: a person's own edit of the Compose file — checked by Docker, new risks accepted, brought up."""
    content = str(params.get("content", ""))
    if not content.strip() or len(content) > MAX_COMPOSE:
        raise ComposeFailed("refused: empty, or more than 256 KB")
    c, info = _project_of(params)
    file = info["files"][0]
    before = risks(config(info["folder"], info["project"], info["files"]), info["folder"])
    trial = os.path.join(info["folder"], f".compose.netsentry-check-{uuid.uuid4().hex[:6]}.yaml")
    with open(trial, "w", encoding="utf-8") as f:
        f.write(content)
    try:
        cfg = config(info["folder"], info["project"], [trial])
    finally:
        os.remove(trial)
    if info["service"] not in (cfg.get("services") or {}):
        raise ComposeFailed(f"refused: the file no longer has the service {info['service']} (remove the app instead)")
    added = [r for r in risks(cfg, info["folder"]) if r["id"] not in {b["id"] for b in before}]
    _check_accepted(added, params.get("accepted_risks"))
    saved = {"file": file, "folder": info["folder"], "project": info["project"], "service": info["service"], "container": str(params["container"]), "was_running": _running(c)}
    saved["backup"] = _replace_file(file, content)
    try:
        r = _up(info["folder"], info["project"], file, "--remove-orphans", *([] if saved["was_running"] else ["--no-start"]))
        if r.returncode != 0:
            raise ComposeFailed("Docker couldn't apply it: " + ((r.stderr or r.stdout).strip().splitlines() or ["?"])[-1][:200])
        if saved["was_running"]:
            port, host = _first_port(cfg["services"][info["service"]])
            proof = _gate(saved["container"], port, host)
    except Exception as e:
        _bring_back(saved)
        raise ComposeFailed(f"{e} — the file as it was is back") from e
    who = params.get('app') or saved['container']
    saved["note"] = f"{who} runs with the edited file ({proof})" if saved["was_running"] else f"{who}'s edited file is saved; it stays stopped until it's started"
    return saved


def file_undo(saved: dict) -> None:
    _bring_back(saved)


# ------------------------------------------------------------------ install any app (§7.4)

def install_custom(params: dict) -> dict:
    """Install a pasted Compose file: Docker reads it, every risk was accepted, it comes up healthy."""
    from .backup import BackupFailed, check_folder
    content = str(params.get("content", ""))
    if _sha(content) != str(params.get("content_sha256", "")):
        raise ComposeFailed("refused: the file isn't the one you checked")
    project = str(params.get("project", ""))
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,39}", project):
        raise ComposeFailed("refused: not a project name")
    _need_compose()
    try:
        root = check_folder(str(params.get("root", "")))
    except BackupFailed as e:
        raise ComposeFailed(f"the apps folder: {e}") from e
    folder = os.path.join(root, project)
    if os.path.exists(folder) and os.listdir(folder):
        raise ComposeFailed(f"{folder} already exists and isn't empty — pick another name")
    # Every risk accepted BEFORE anything is made on the server (a refusal leaves nothing behind).
    looked = check({"content": content, "project": project, "root": root})
    _check_accepted(looked["risks"], params.get("accepted_risks"))
    os.makedirs(folder, mode=0o750, exist_ok=True)
    file = os.path.join(folder, "compose.yaml")
    with open(file, "w", encoding="utf-8") as f:
        f.write(content)
    saved = {"folder": folder, "project": project, "file": file}
    try:
        cfg = config(folder, project, [file])
        _check_accepted(risks(cfg, folder), params.get("accepted_risks"))
        r = _up(folder, project, file)
        if r.returncode != 0:
            raise ComposeFailed("docker compose couldn't start it: " + ((r.stderr or r.stdout).strip().splitlines() or ["?"])[-1][:200])
        first = sorted(cfg.get("services") or {})[0]
        name = (cfg["services"][first].get("container_name")) or f"{project}-{first}-1"
        port, host = _first_port(cfg["services"][first])
        proof = _gate(name, port, host)
    except Exception as e:
        subprocess.run(["docker", "compose", "-p", project, "-f", file, "down"], cwd=folder, capture_output=True, timeout=300)
        raise ComposeFailed(f"{e}; stopped it — its folder is kept at {folder}") from e
    saved["note"] = f"{params.get('app') or project} runs ({proof}); its folder is {folder}"
    return saved


def install_custom_undo(saved: dict) -> None:
    if saved.get("folder") and saved.get("file") and os.path.isfile(saved["file"]):
        subprocess.run(["docker", "compose", "-p", saved["project"], "-f", saved["file"], "down"], cwd=saved["folder"], capture_output=True, timeout=300)


# ------------------------------------------------------------------ remove an app (§7.3)

def _app_bin() -> str:
    from . import files
    d = os.path.join(files.STATE_DIR or ".", "app-bin")
    os.makedirs(d, mode=0o700, exist_ok=True)
    return d


def remove(params: dict) -> dict:
    """Stop and remove an app. mode keep: its folder and data stay (Undo starts it again).
    mode everything: its folder goes to NetSentry's bin (7 days) and its named volumes are deleted for good."""
    from .update import _api, _container, _save_json
    from .executor import _is_me
    mode = str(params.get("mode", "keep"))
    if mode not in ("keep", "everything"):
        raise ComposeFailed("refused: keep or everything")
    api = _api()
    c = _container(api, str(params.get("container", "")))
    if _is_me(api, c["Id"], c):
        raise ComposeFailed("refused: that is NetSentry's own monitor")
    info = compose_of(c)
    saved: dict = {"mode": mode, "container": str(params["container"])}
    if info and info["files"] and all(os.path.isfile(f) for f in info["files"]):
        for other in api.json("/containers/json?all=1"):
            lab = other.get("Labels") or {}
            if lab.get("com.docker.compose.project") == info["project"] and lab.get("netsentry.role") == "monitor":
                raise ComposeFailed("refused: NetSentry's own monitor is part of that project")
        args = ["docker", "compose", "-p", info["project"]] + sum((["-f", f] for f in info["files"]), [])
        r = subprocess.run(args + ["down"], cwd=info["folder"], capture_output=True, text=True, timeout=600)
        if r.returncode != 0:
            raise ComposeFailed("docker compose couldn't stop it: " + ((r.stderr or r.stdout).strip().splitlines() or ["?"])[-1][:200])
        saved.update(kind="compose", project=info["project"], folder=info["folder"], files=info["files"])
        if mode == "everything":
            try:
                slot = os.path.join(_app_bin(), f"{time.strftime('%Y%m%d-%H%M%S')}-{info['project']}")
                shutil.move(info["folder"], slot)
                saved["bin"] = slot
                query = urllib.parse.quote(json.dumps({"label": ["com.docker.compose.project=" + info["project"]]}))
                gone = []
                for v in api.json(f"/volumes?filters={query}").get("Volumes") or []:
                    st, _ = api.send("DELETE", f"/volumes/{urllib.parse.quote(v['Name'], safe='')}")
                    if st in (204, 404):
                        gone.append(v["Name"])
                saved["volumes_deleted"] = gone
            except Exception as e:
                # Stopped but not removed: put it back the way it was (running), then say why.
                remove_undo(saved)
                raise ComposeFailed(f"couldn't remove everything ({e}) — it runs again as it was") from e
        saved["note"] = f"removed {params.get('app') or info['project']}" + (f"; its folder is in NetSentry's bin for 7 days" if mode == "everything" else f"; its folder {info['folder']} is kept")
        return saved
    # Not made by Compose: remember exactly what it was, so Undo can make it again.
    folder = os.path.join(_app_bin(), f"{time.strftime('%Y%m%d-%H%M%S')}-{saved['container']}")
    os.makedirs(folder, mode=0o700)
    image = api.json(f"/images/{c['Image']}/json")
    saved.update(kind="container", inspect=_save_json(folder, "container.json", c), image_inspect=_save_json(folder, "image.json", image), image=(c.get("Config") or {}).get("Image"))
    api.send("POST", f"/containers/{c['Id']}/stop?t=20")
    st, body = api.send("DELETE", f"/containers/{c['Id']}?v={'1' if mode == 'everything' else '0'}")
    if st not in (204, 404):
        raise ComposeFailed(f"Docker refused to remove it ({st})")
    saved["note"] = f"removed {params.get('app') or saved['container']}"
    return saved


def remove_undo(saved: dict) -> None:
    if saved.get("kind") == "compose":
        if saved.get("bin") and os.path.isdir(saved["bin"]) and not os.path.exists(saved["folder"]):
            shutil.move(saved["bin"], saved["folder"])
        args = ["docker", "compose", "-p", saved["project"]] + sum((["-f", f] for f in saved["files"]), [])
        subprocess.run(args + ["up", "-d"], cwd=saved["folder"], capture_output=True, timeout=900)
    elif saved.get("kind") == "container":
        from .update import _api, _post_json, create_body
        api = _api()
        with open(saved["inspect"], encoding="utf-8") as f:
            c = json.load(f)
        with open(saved["image_inspect"], encoding="utf-8") as f:
            img = json.load(f)
        body, extra = create_body(c, img, saved["image"])
        st, made = _post_json(api, f"/containers/create?name={saved['container']}", body)
        if st == 201:
            for net, cfg in extra:
                _post_json(api, f"/networks/{net}/connect", {"Container": made["Id"], "EndpointConfig": cfg})
            api.send("POST", f"/containers/{made['Id']}/start")


def housekeeping(now: float | None = None) -> None:
    now = now or time.time()
    from . import files
    d = os.path.join(files.STATE_DIR or ".", "app-bin")
    if os.path.isdir(d):
        for name in os.listdir(d):
            p = os.path.join(d, name)
            if now - os.path.getmtime(p) > 7 * 86400:
                shutil.rmtree(p, ignore_errors=True)
