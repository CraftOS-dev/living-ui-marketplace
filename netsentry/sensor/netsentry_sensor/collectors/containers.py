"""Containers and the app facts inside them (plan §18.1).

`host.containers` reports every container with what NetSentry needs to
recognise the app in it and to judge who can reach it: image, Compose
project/service, published ports with the address they are published on,
volumes, health and restarts.

`host.app_config` reads ONLY the config keys the console asks for (the app
catalogue decides which), from a file inside a container or on the host.
Values of keys marked secret are never read out: only whether they are set
and what form they take (e.g. "argon2 hash" vs "plain text").

Docker is reached through its Engine API (unix socket, or DOCKER_HOST
tcp://127.0.0.1), falling back to the docker CLI (Windows/macOS Docker Desktop).
"""

from __future__ import annotations

import configparser
import http.client
import io
import json
import os
import re
import socket
import tarfile
import urllib.parse

from ..util import run, which
from .base import Collector, Unavailable

SOCKET = "/var/run/docker.sock"


class _UnixConnection(http.client.HTTPConnection):
    def __init__(self, path: str, timeout: int = 10):
        super().__init__("localhost", timeout=timeout)
        self._path = path

    def connect(self):
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(self.timeout)
        s.connect(self._path)
        self.sock = s


class DockerApi:
    """Read-only Docker Engine API calls. Raises Unavailable when Docker cannot be reached."""

    def __init__(self):
        host = os.environ.get("DOCKER_HOST", "")
        if host.startswith("tcp://"):
            u = urllib.parse.urlparse(host)
            if u.hostname not in ("127.0.0.1", "localhost", "::1"):
                raise Unavailable("DOCKER_HOST points to another server — NetSentry only reads Docker on its own server")
            self._conn = lambda: http.client.HTTPConnection(u.hostname, u.port or 2375, timeout=10)
        else:
            path = host[len("unix://"):] if host.startswith("unix://") else SOCKET
            if not hasattr(socket, "AF_UNIX") or not os.path.exists(path):
                self._conn = None
            else:
                self._conn = lambda: _UnixConnection(path)

    @property
    def available(self) -> bool:
        return self._conn is not None

    def get(self, path: str) -> tuple[int, bytes]:
        return self.send("GET", path)

    def send(self, method: str, path: str, body: bytes | None = None, headers: dict | None = None) -> tuple[int, bytes]:
        """Any Engine API call. Collectors only GET; the executor (fixes a person approved) may stop/start/write."""
        c = self._conn()
        try:
            c.request(method, path, body=body, headers=dict({"Host": "docker"}, **(headers or {})))
            r = c.getresponse()
            return r.status, r.read()
        except (OSError, http.client.HTTPException) as e:
            raise Unavailable(f"cannot talk to Docker ({e}) — is it running, and can the monitor use it?") from e
        finally:
            c.close()

    def stream(self, path: str, timeout: float = 3600):
        """A long-lived GET (Docker's event stream): returns (connection, response); the caller closes."""
        c = self._conn()
        c.timeout = timeout
        try:
            c.request("GET", path, headers={"Host": "docker"})
            return c, c.getresponse()
        except (OSError, http.client.HTTPException) as e:
            c.close()
            raise Unavailable(f"cannot talk to Docker ({e})") from e

    def json(self, path: str):
        status, body = self.get(path)
        if status != 200:
            raise Unavailable(f"Docker answered {status} for {path.split('?')[0]}")
        return json.loads(body)

    def read_file(self, container_id: str, path: str, limit: int = 256 * 1024) -> str | None:
        """One file from inside a container (Engine API archive = a tar stream), or None."""
        status, body = self.get(f"/containers/{container_id}/archive?path={urllib.parse.quote(path)}")
        if status != 200:
            return None
        with tarfile.open(fileobj=io.BytesIO(body)) as t:
            for m in t.getmembers():
                if m.isfile():
                    f = t.extractfile(m)
                    return f.read(limit).decode("utf-8", "replace") if f else None
        return None


# ------------------------------------------------------------------ parsing


def container_from_inspect(c: dict) -> dict:
    """docker inspect JSON → the facts NetSentry keeps (plain function, tested on recorded output)."""
    cfg = c.get("Config") or {}
    host = c.get("HostConfig") or {}
    state = c.get("State") or {}
    labels = cfg.get("Labels") or {}
    ports = []
    for key, binds in sorted(((c.get("NetworkSettings") or {}).get("Ports") or {}).items()):
        cport, _, proto = key.partition("/")
        for b in binds or []:
            ports.append({"host_ip": b.get("HostIp") or "0.0.0.0", "host_port": int(b.get("HostPort") or 0),
                          "container_port": int(cport), "proto": proto or "tcp"})
    mounts = [{"source": m.get("Source", ""), "destination": m.get("Destination", ""), "type": m.get("Type", ""), "rw": bool(m.get("RW"))}
              for m in c.get("Mounts") or []]
    health = (state.get("Health") or {}).get("Status", "")
    return {
        "id": (c.get("Id") or "")[:12],
        "name": (c.get("Name") or "").lstrip("/"),
        "image": cfg.get("Image", ""),
        "image_id": (c.get("Image") or "")[:80],
        "compose_project": labels.get("com.docker.compose.project", ""),
        "compose_service": labels.get("com.docker.compose.service", ""),
        "compose_file": labels.get("com.docker.compose.project.config_files", ""),
        "state": state.get("Status", ""),
        "health": health,
        "restart_count": int(c.get("RestartCount") or 0),
        "started_at": state.get("StartedAt", ""),
        "exit_code": state.get("ExitCode"),
        "oom_killed": bool(state.get("OOMKilled")),
        "finished_at": state.get("FinishedAt", ""),
        "ports": ports,
        "mounts": mounts,
        "privileged": bool(host.get("Privileged")),
        "network_mode": host.get("NetworkMode", ""),
        "env_keys": sorted({e.split("=", 1)[0] for e in cfg.get("Env") or []}),
    }


def _inspect_all() -> list[dict]:
    api = DockerApi()
    if api.available:
        ids = [c["Id"] for c in api.json("/containers/json?all=1")]
        return [api.json(f"/containers/{i}/json") for i in ids]
    if not which("docker"):
        raise Unavailable("Docker is not installed on this server")
    code, out = run(["docker", "ps", "-aq"])
    if code != 0:
        raise Unavailable("cannot talk to the Docker daemon (not running, or the monitor lacks permission)")
    ids = out.split()
    if not ids:
        return []
    code, out = run(["docker", "inspect", *ids], timeout=60)
    return json.loads(out) if code == 0 and out.strip() else []


def _images() -> dict:
    """image id → {digests: [registry digests], created} (the builds pulled from a registry)."""
    out = {}
    api = DockerApi()
    try:
        if api.available:
            rows = api.json("/images/json")
            for r in rows:
                out[r.get("Id", "")] = {"digests": sorted(set(r.get("RepoDigests") or []))[:6], "created": r.get("Created", 0)}
        elif which("docker"):
            code, text = run(["docker", "image", "ls", "--no-trunc", "--digests", "--format", "{{json .}}"], timeout=60)
            if code == 0:
                for line in text.splitlines():
                    try:
                        r = json.loads(line)
                    except ValueError:
                        continue
                    if r.get("Digest") and r.get("Digest") != "<none>":
                        out.setdefault(r.get("ID", ""), {"digests": [], "created": 0})["digests"].append(f"{r.get('Repository')}@{r.get('Digest')}")
    except Unavailable:
        return {}
    for v in out.values():
        if isinstance(v.get("created"), int) and v["created"]:
            import time as _t
            v["created"] = _t.strftime("%Y-%m-%dT%H:%M:%SZ", _t.gmtime(v["created"]))
    return out


class Containers(Collector):
    id = "host.containers"

    def collect(self) -> dict:
        obs, health = [], []
        images = _images()
        for c in _inspect_all():
            d = container_from_inspect(c)
            # v3 §10.1: which exact build it runs (the registry digest), so updates can be found and undone.
            img = images.get(c.get("Image") or "") or {}
            d["repo_digests"] = img.get("digests", [])
            d["image_created"] = img.get("created", "")
            # Health flips on its own; it is its own kind so the container's change history stays readable.
            stable = {k: v for k, v in d.items() if k not in ("restart_count", "started_at", "health", "state", "exit_code", "oom_killed", "finished_at")}
            stable["running"] = d["state"] == "running"
            obs.append({"kind": "container", "subject": d["name"], "data": stable})
            health.append({"kind": "container.health", "subject": d["name"],
                           "data": {"state": d["state"], "health": d["health"], "restart_count": d["restart_count"],
                                    "exit_code": d["exit_code"], "oom_killed": d["oom_killed"],
                                    "finished_at": d["finished_at"] if d["state"] != "running" else "",
                                    "started_at": d["started_at"] if d["restart_count"] else ""}})
        return {"observations": obs + health}


# --------------------------------------------------------------- app config

def _ini_value(text: str, key: str) -> str | None:
    """qBittorrent-style INI ('[Preferences]\\nWebUI\\Port=8080'); key = 'Section/Name'."""
    section, _, name = key.partition("/")
    cp = configparser.RawConfigParser(strict=False, interpolation=None)
    cp.optionxform = str  # keep case and backslashes
    try:
        cp.read_string(text)
    except configparser.Error:
        return None
    return cp.get(section, name, fallback=None) if cp.has_section(section) else None


def _json_value(text: str, key: str):
    try:
        cur = json.loads(text)
    except ValueError:
        return None
    for part in key.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def _env_value(text: str, key: str) -> str | None:
    for line in text.splitlines():
        m = re.match(r"\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$", line)
        if m and m.group(1) == key:
            return m.group(2).strip().strip("'\"")
    return None


def _xml_value(text: str, key: str) -> str | None:
    m = re.search(rf"<{re.escape(key)}>([^<]*)</{re.escape(key)}>", text)
    return m.group(1) if m else None


READERS = {"ini": _ini_value, "json": _json_value, "env": _env_value, "xml": _xml_value}
# "container_env": the listed keys of a container's own environment (apps configured by env vars, e.g. Vaultwarden)
FORMATS = set(READERS) | {"container_env"}


def secret_form(value) -> str:
    """What a secret looks like, never what it is."""
    if value in (None, ""):
        return "empty"
    s = str(value)
    if s.startswith("$argon2"):
        return "argon2"
    if s.startswith(("$2a$", "$2b$", "$2y$")):
        return "bcrypt"
    if s.startswith("@ByteArray(") or re.fullmatch(r"[A-Za-z0-9+/=]{40,}:[A-Za-z0-9+/=]{40,}", s):
        return "hashed"
    return "plain"


# What the monitor will ever read from an app's settings (security review 2026-09-30): the console asks,
# but only these (image → file → format, keys, which keys are secret) are read — never a file on the
# machine itself, never another key. Mirrors the catalogue (tests/catalogue.test.js keeps them equal).
_QBIT = {"/config/qBittorrent/qBittorrent.conf": ("ini", {"Preferences/WebUI\\AuthSubnetWhitelistEnabled", "Preferences/WebUI\\AuthSubnetWhitelist", "Preferences/WebUI\\LocalHostAuth"}, set())}
_STHG = ("xml", {"user", "password", "address"}, {"password"})
_VW = {"env": ("container_env", {"SIGNUPS_ALLOWED", "ADMIN_TOKEN"}, {"ADMIN_TOKEN"})}
ALLOWED_READS = {
    "lscr.io/linuxserver/qbittorrent": _QBIT, "linuxserver/qbittorrent": _QBIT,
    "lscr.io/linuxserver/syncthing": {"/config/config.xml": _STHG}, "linuxserver/syncthing": {"/config/config.xml": _STHG},
    "syncthing/syncthing": {"/var/syncthing/config/config.xml": _STHG},
    "vaultwarden/server": _VW, "ghcr.io/dani-garcia/vaultwarden": _VW,
}


def image_repo(image: str) -> str:
    """"lscr.io/linuxserver/jellyfin:10.9@sha256:…" → "lscr.io/linuxserver/jellyfin" (docker.io and library/ dropped)."""
    s = (image or "").lower().split("@")[0]
    last = s.rfind("/")
    colon = s.find(":", last + 1)
    if colon >= 0:
        s = s[:colon]
    for p in ("docker.io/", "index.docker.io/"):
        if s.startswith(p):
            s = s[len(p):]
    if s.startswith("library/"):
        s = s[len("library/"):]
    return s


def allowed_read(image: str, path: str, fmt: str, keys: list) -> tuple[list[dict], set] | None:
    """The requested keys this monitor allows for this container image and file, or None (refused)."""
    spec = (ALLOWED_READS.get(image_repo(image)) or {}).get(path)
    if not spec or spec[0] != fmt:
        return None
    ok = [k for k in keys if isinstance(k, dict) and k.get("key") in spec[1]]
    return ok, spec[2]


def config_facts(text: str, fmt: str, keys: list[dict], secret_keys: set | None = None) -> dict:
    """Only the requested keys; secret ones as {set, form}."""
    read = READERS["env" if fmt == "container_env" else fmt]
    out = {}
    for k in keys:
        v = read(text, k["key"])
        # secret by the monitor's own list (keys are already limited to it) — never because the console says it isn't
        secret = bool(k.get("secret")) or k["key"] in (secret_keys or set())
        out[k["key"]] = {"set": v not in (None, ""), "form": secret_form(v)} if secret else (v[:200] if isinstance(v, str) else v)
    return out


def container_env(api, cid, name) -> list[str] | None:
    """A container's environment lines (read in memory; only catalogue-listed keys ever leave config_facts)."""
    if api.available and cid:
        return list((api.json(f"/containers/{cid}/json").get("Config") or {}).get("Env") or [])
    if name and which("docker"):
        code, out = run(["docker", "inspect", "--format", "{{json .Config.Env}}", name])
        if code == 0 and out.strip():
            return json.loads(out)
    return None


class AppConfig(Collector):
    id = "host.app_config"

    def collect(self) -> dict:
        requests = self.config.get("app_config") or []
        if not requests:
            return {"observations": [], "note": "no app config to read yet"}
        api = DockerApi()
        by_name, images = {}, {}
        if api.available:
            for c in api.json("/containers/json?all=1"):
                name = (c.get("Names") or ["/"])[0].lstrip("/")
                by_name[name], images[name] = c["Id"], c.get("Image", "")
        obs, missing, refused = [], [], 0
        for r in requests:
            if r.get("format") not in FORMATS or not r.get("container"):
                refused += 1  # the monitor never reads a file on the machine itself for the console
                continue
            name = r["container"]
            ok = allowed_read(images.get(name, ""), r.get("path", ""), r["format"], r.get("keys") or [])
            if ok is None:
                refused += 1
                continue
            keys, secret_keys = ok
            text = None
            if r["format"] == "container_env":
                env = container_env(api, by_name.get(name), name)
                text = None if env is None else chr(10).join(env)
            else:
                cid = by_name.get(name)
                text = api.read_file(cid, r["path"]) if cid else None
            subject = f"{r['app']}:{name}:{r['path']}"
            if text is None:
                missing.append(subject)
                obs.append({"kind": "app.config", "subject": subject, "data": {"readable": False}})
                continue
            obs.append({"kind": "app.config", "subject": subject,
                        "data": {"readable": True, "format": r["format"], "values": config_facts(text, r["format"], keys, secret_keys)}})
        notes = ([f"could not read {len(missing)} file(s)"] if missing else []) + ([f"refused {refused} request(s) outside the monitor's own list"] if refused else [])
        return {"observations": obs, "note": "; ".join(notes)}
