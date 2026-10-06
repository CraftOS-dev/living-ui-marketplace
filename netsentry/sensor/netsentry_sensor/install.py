"""Install an app from NetSentry's list (v3 plan §12), on THIS machine.

The console sends a Compose project as data. The monitor trusts none of it
until it passed the monitor's OWN rules:

  - the template is one this monitor knows, and every image is one that
    template may use (the list below, in the monitor's code);
  - no privileged containers, no added capabilities, no devices, no host
    PID/IPC, host networking only for the apps that need it (Plex, Home
    Assistant);
  - folders only inside the app's own new folder, or folders a person chose
    for media (checked like a backup folder: never a system folder);
  - ports only on one address (never every address);

then it writes compose.yaml and .env itself (every password generated HERE,
never sent to the console), and starts it with `docker compose`.
"""

from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import subprocess
import time

from .util import which

# template → the image repositories it may run (the monitor's own allow-list)
ALLOWED = {
    "jellyfin": ["jellyfin/jellyfin"],
    "plex": ["lscr.io/linuxserver/plex"],
    "sonarr": ["lscr.io/linuxserver/sonarr"],
    "radarr": ["lscr.io/linuxserver/radarr"],
    "prowlarr": ["lscr.io/linuxserver/prowlarr"],
    "qbittorrent": ["lscr.io/linuxserver/qbittorrent"],
    "homeassistant": ["ghcr.io/home-assistant/home-assistant"],
    "immich": ["ghcr.io/immich-app/immich-server", "ghcr.io/immich-app/immich-machine-learning", "docker.io/valkey/valkey", "ghcr.io/immich-app/postgres"],
    "vaultwarden": ["vaultwarden/server"],
    "nextcloud": ["nextcloud", "postgres", "redis"],
    "uptimekuma": ["louislam/uptime-kuma"],
    "odoo": ["odoo", "postgres"],
    "gitea": ["gitea/gitea"],
    "wikijs": ["ghcr.io/requarks/wiki"],
    "mattermost": ["mattermost/mattermost-team-edition", "postgres"],
}
HOST_NETWORK = {"plex", "homeassistant"}
SERVICE_KEYS = {"image", "restart", "logging", "environment", "env_file", "ports", "volumes", "user", "depends_on", "healthcheck", "network_mode", "shm_size"}
NAME = re.compile(r"^[a-z0-9][a-z0-9_-]{0,62}$")
SECRET_NAME = re.compile(r"^[A-Z][A-Z0-9_]{0,40}$")
KEY = re.compile(r"^[A-Za-z0-9_.-]{1,80}$")
PLACEHOLDER = re.compile(r"\$\{([A-Z][A-Z0-9_]{0,40})\}")
LOGGING = {"driver": "json-file", "options": {"max-size": "20m", "max-file": "3"}}


def _walk(value, path, secrets_ok, problems, allow_placeholders=False):
    """Every key a plain name (no line breaks, no YAML tricks); no '$' except ${SECRET} where allowed."""
    if isinstance(value, dict):
        for k, v in value.items():
            if not isinstance(k, str) or not KEY.match(k):
                problems.append(f"{path}: a key that isn't a plain name")
                continue
            _walk(v, f"{path}.{k}", secrets_ok, problems, allow_placeholders)
    elif isinstance(value, list):
        for i, v in enumerate(value):
            _walk(v, f"{path}[{i}]", secrets_ok, problems, allow_placeholders)
    elif isinstance(value, str):
        if "\n" in value or "\r" in value or "\x00" in value:
            problems.append(f"{path}: a line break")
        rest = PLACEHOLDER.sub(lambda m: "" if allow_placeholders and m.group(1) in secrets_ok else "$!", value)
        if "$" in rest:
            problems.append(f"{path}: Compose substitution (only its own generated passwords may be referenced)")
    elif not (value is None or isinstance(value, (bool, int, float))):
        problems.append(f"{path}: an unexpected value")


class InstallFailed(Exception):
    pass


def _repo_of(image: str) -> str:
    ref = image.split("@")[0]
    last = ref.rsplit("/", 1)[-1]
    return ref[: len(ref) - len(last)] + last.split(":")[0] if ":" in last else ref


HEALTH_TESTS = (
    re.compile(r"curl -fsS http://localhost:[0-9]{2,5}/[A-Za-z0-9/_-]{0,40} >/dev/null \|\| exit 1"),
    re.compile(r"redis-cli ping \| grep -q PONG \|\| exit 1"),
)


def _healthcheck_ok(h) -> bool:
    if not isinstance(h, dict) or set(h) - {"test", "interval", "timeout", "retries", "start_period"}:
        return False
    test = h.get("test")
    if not (isinstance(test, list) and len(test) == 2 and test[0] == "CMD-SHELL" and any(r.fullmatch(str(test[1])) for r in HEALTH_TESTS)):
        return False
    return all(re.fullmatch(r"[0-9]{1,4}[smh]", str(h[k])) for k in ("interval", "timeout", "start_period") if k in h) and \
        (("retries" not in h) or (isinstance(h["retries"], int) and 0 < h["retries"] < 20))


def _inside(folder: str, rel: str) -> str:
    """A path inside the app's folder, or refused (C6: no backslashes, drive letters or climbing out)."""
    if not rel or "\\" in rel or ":" in rel or rel.startswith("/") or ".." in rel.split("/"):
        raise InstallFailed("refused: a path outside the app's folder")
    full = os.path.realpath(os.path.join(folder, rel))
    if not full.startswith(os.path.realpath(folder) + os.sep):
        raise InstallFailed("refused: a path outside the app's folder")
    return full


def _source(volume: str) -> str:
    """The machine side of a Compose volume ("SRC:DST[:MODE]"), including Windows drive letters ("C:/x:/media")."""
    if re.match(r"^[A-Za-z]:[\\/]", volume):
        return volume[:2] + volume[2:].split(":")[0]
    return volume.split(":")[0]


def validate(params: dict) -> None:
    """The monitor's own rules for what an install may contain. Raises InstallFailed."""
    template = str(params.get("template", ""))
    if template not in ALLOWED:
        raise InstallFailed("refused: not an app NetSentry installs")
    if not NAME.match(str(params.get("project", ""))):
        raise InstallFailed("refused: not a project name")
    spec = params.get("spec") or {}
    services = spec.get("services") or {}
    if not services or not isinstance(services, dict):
        raise InstallFailed("refused: nothing to install")
    data_roots = [str(r) for r in params.get("data_roots") or []]
    from .backup import BackupFailed, check_folder
    for r in data_roots:
        try:
            check_folder(r)
        except BackupFailed as e:
            raise InstallFailed(f"the media folder {r}: {e}") from e
    bind = str(params.get("bind", ""))
    if not re.fullmatch(r"(127\.0\.0\.1|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])(\.\d{1,3}){2})", bind):
        raise InstallFailed("refused: apps are published on this server's own private address or 127.0.0.1 only")
    secrets_ok = {str(s) for s in params.get("secrets") or []}
    problems: list[str] = []
    for name, svc in services.items():
        if not NAME.match(name) or not isinstance(svc, dict):
            raise InstallFailed("refused: not a service name")
        for key, value in svc.items():
            _walk(value, f"{name}.{key}", secrets_ok, problems, allow_placeholders=(key == "environment"))
        # (C5) a health check is one of the few NetSentry writes itself; the app never runs as root by request
        if "healthcheck" in svc and not _healthcheck_ok(svc["healthcheck"]):
            raise InstallFailed(f"refused: {name} has a health check NetSentry doesn't write")
        if "user" in svc and not re.fullmatch(r"[1-9][0-9]{2,6}:[1-9][0-9]{2,6}", str(svc["user"])):
            raise InstallFailed(f"refused: {name} would run as {svc['user']}")
        if "logging" in svc and svc["logging"] != LOGGING:
            raise InstallFailed(f"refused: {name} sends its logs somewhere other than this server")
        for dep in svc.get("depends_on") or []:
            if dep not in services:
                raise InstallFailed(f"refused: {name} depends on something outside the app")
        extra = set(svc) - SERVICE_KEYS
        if extra:
            raise InstallFailed(f"refused: {name} asks for {', '.join(sorted(extra))}, which installs never use")
        if _repo_of(str(svc.get("image", ""))) not in ALLOWED[template]:
            raise InstallFailed(f"refused: {svc.get('image')} is not an image {template} uses")
        if "network_mode" in svc and not (svc["network_mode"] == "host" and template in HOST_NETWORK):
            raise InstallFailed(f"refused: {name} may not share the server's network")
        for p in svc.get("ports") or []:
            if not str(p).startswith(bind + ":"):
                raise InstallFailed(f"refused: {name} publishes {p} beyond {bind}")
        for v in svc.get("volumes") or []:
            src = _source(str(v))
            if src.startswith("./") and ".." not in src:
                continue
            if re.fullmatch(r"[a-z0-9][a-z0-9_-]*", src) and src in (spec.get("volumes") or {}):
                continue  # a named volume the project declares
            if str(v) == "/etc/localtime:/etc/localtime:ro":
                continue
            if any(src == r or src.startswith(r.rstrip("/") + "/") for r in data_roots) and ".." not in src:
                continue
            raise InstallFailed(f"refused: {name} would see {src} on the server")
        for f in svc.get("env_file") or []:
            if f != ".env":
                raise InstallFailed("refused: an env file other than its own .env")
    _walk(spec.get("volumes") or {}, "volumes", set(), problems)
    # (F-gap) a declared volume is a plain named volume — never one bound to a folder on the machine
    for vname, vdef in (spec.get("volumes") or {}).items():
        if vdef not in (None, {}):
            raise InstallFailed(f"refused: volume {vname} is bound to something on the server")
    if problems:
        raise InstallFailed(f"refused: {problems[0]}")
    for s in params.get("secrets") or []:
        if not SECRET_NAME.match(str(s)):
            raise InstallFailed("refused: a password name")
    for f in params.get("files") or []:
        path = str(f.get("path", ""))
        if not path or "\\" in path or ":" in path or path.startswith(("/", "..")) or ".." in path.split("/"):
            raise InstallFailed("refused: a file outside the app's folder")
        if path == ".env":
            # docker compose reads .env itself: plain app variables only — never DOCKER_* or COMPOSE_*,
            # never a substitution other than this app's own generated passwords.
            for line in str(f.get("content", "")).splitlines():
                if not line.strip():
                    continue
                m = re.fullmatch(r"([A-Z][A-Z0-9_]{0,40})=([^\r\n]*)", line)
                if not m or m.group(1).startswith(("DOCKER_", "COMPOSE_")):
                    raise InstallFailed("refused: a setting in .env that isn't the app's own")
                if "$" in PLACEHOLDER.sub(lambda x: "" if x.group(1) in secrets_ok else "$!", m.group(2)):
                    raise InstallFailed("refused: a substitution in .env")
    for d in params.get("dirs") or []:
        dp = str(d.get("path", ""))
        if not dp or "\\" in dp or ":" in dp or dp.startswith(("/", "..")) or ".." in dp.split("/"):
            raise InstallFailed("refused: a folder outside the app's folder")
        if d.get("owner") and not re.fullmatch(r"[0-9]{1,6}:[0-9]{1,6}", str(d["owner"])):
            raise InstallFailed("refused: an owner that isn't a user and group number")


def to_yaml(value, indent: int = 0) -> str:
    """A small YAML writer for the Compose data above (strings always double-quoted, so nothing is misread)."""
    pad = "  " * indent
    if isinstance(value, dict):
        if not value:
            return "{}"
        lines = []
        for k, v in value.items():
            if isinstance(v, (dict, list)) and v:
                lines.append(f"{pad}{k}:\n{to_yaml(v, indent + 1)}")
            else:
                lines.append(f"{pad}{k}: {to_yaml(v, 0)}")
        return "\n".join(lines)
    if isinstance(value, list):
        if not value:
            return "[]"
        out = []
        for v in value:
            if isinstance(v, (dict, list)) and v:
                inner = to_yaml(v, indent + 1).lstrip()
                out.append(f"{pad}- {inner}")
            else:
                out.append(f"{pad}- {to_yaml(v, 0)}")
        return "\n".join(out)
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if value is None:
        return "null"
    return json.dumps(str(value))


def _owner(path: str, owner: str) -> None:
    if not owner or not hasattr(os, "chown"):
        return
    try:
        uid, gid = (int(x) for x in owner.split(":"))
        os.chown(path, uid, gid)
    except (ValueError, PermissionError, OSError):
        pass


def _compose(folder: str, project: str, *args: str, timeout: int = 900) -> subprocess.CompletedProcess:
    return subprocess.run(["docker", "compose", "-p", project, "-f", os.path.join(folder, "compose.yaml"), *args], cwd=folder, capture_output=True, text=True, timeout=timeout)


def apply(params: dict) -> dict:
    validate(params)
    if not which("docker") or subprocess.run(["docker", "compose", "version"], capture_output=True).returncode != 0:
        raise InstallFailed("this server needs Docker with its compose plugin (docker compose) to install apps")
    from .backup import BackupFailed, check_folder
    root = str(params.get("root", ""))
    try:
        root = check_folder(root)
    except BackupFailed as e:
        raise InstallFailed(f"the apps folder {root}: {e}") from e
    project = str(params["project"])
    folder = os.path.join(root, project)
    if os.path.exists(folder) and os.listdir(folder):
        raise InstallFailed(f"{folder} already exists and isn't empty — pick another name")
    os.makedirs(folder, mode=0o750, exist_ok=True)
    values = {s: secrets.token_urlsafe(24) for s in params.get("secrets") or []}
    for d in params.get("dirs") or []:
        p = _inside(folder, str(d["path"]))
        os.makedirs(p, exist_ok=True)
        _owner(p, str(d.get("owner") or ""))
    env_lines = [f"{k}={v}" for k, v in values.items()]
    for f in params.get("files") or []:
        content = str(f.get("content", ""))
        for k, v in values.items():
            content = content.replace("${" + k + "}", v)
        if f["path"] == ".env":
            env_lines = [line for line in content.splitlines() if line] + [line for line in env_lines if line.split("=", 1)[0] + "=" not in content]
            continue
        p = _inside(folder, str(f["path"]))
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as out:
            out.write(content)
        os.chmod(p, 0o640)
        owner = next((str(d.get("owner") or "") for d in params.get("dirs") or [] if f["path"].startswith(d["path"] + "/")), "")
        _owner(p, owner)
    env_path = os.path.join(folder, ".env")
    with open(env_path, "w", encoding="utf-8") as out:
        out.write("# Made by NetSentry. Passwords here were generated on this server and never sent anywhere.\n" + "\n".join(env_lines) + "\n")
    os.chmod(env_path, 0o600)
    spec = params["spec"]
    doc = {"name": project, "services": spec["services"]}
    if spec.get("volumes"):
        doc["volumes"] = spec["volumes"]
    with open(os.path.join(folder, "compose.yaml"), "w", encoding="utf-8") as out:
        out.write(f"# {params.get('app', project)} — installed by NetSentry on {time.strftime('%Y-%m-%d')}. Yours to change.\n" + to_yaml(doc) + "\n")
    r = _compose(folder, project, "up", "-d")
    if r.returncode != 0:
        _compose(folder, project, "down", timeout=300)
        raise InstallFailed(f"docker compose couldn't start it: {(r.stderr or r.stdout).strip().splitlines()[-1:] or ['?']}")
    from .update import _api, _container, health_gate
    api = _api()
    primary = str(params.get("primary") or next(iter(spec["services"])))
    try:
        c = _container(api, f"{project}-{primary}-1")
        proof = health_gate(api, c["Id"], params.get("probe_port"), seconds=600, steady=20, host=str(params.get("bind") or ""))
    except Exception as e:
        _compose(folder, project, "down", timeout=300)
        raise InstallFailed(f"it didn't come up healthy ({e}); stopped it — its folder is kept at {folder}") from e
    return {"note": f"{params.get('app', project)} runs ({proof}); its folder is {folder}", "folder": folder, "project": project}


def undo(saved: dict) -> None:
    if saved.get("folder") and saved.get("project"):
        _compose(saved["folder"], saved["project"], "down", timeout=300)
