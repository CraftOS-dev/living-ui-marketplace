"""Safe updates (v3 plan §10.2), run by the executor on THIS machine.

    pull the new image (the app keeps running) → stop it → copy its settings
    folders → recreate it on the new image with exactly what the owner set →
    health gate (running, healthy, not restarting, its port answers) →
    on any failure: the old container and its settings go back, by itself.

Once the new version passes, the old container is removed (left behind, `docker compose
up` would adopt it as the app's own and start it again — tested 2026-10-01). What "Roll back"
needs is kept 14 days instead: the old container's own description, its image (pinned with a
netsentry-rollback/<name>:<time> tag so a prune doesn't take it) and the copy of its settings. Copies go through Docker's own archive API,
so this works whether the monitor runs on the host or in a container.
Nothing here is reachable except through the executor's typed actions.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import socket
import time
import urllib.parse

KEEP_DAYS = 14
HEALTH_SECONDS = 180
STEADY_SECONDS = 30
MAX_COPY_BYTES = int(float(os.environ.get("NETSENTRY_SNAPSHOT_MAX_GB", "5")) * 1e9)
SNAPSHOT_ROOT = ""  # set by the executor: <state dir>/snapshots


class UpdateFailed(Exception):
    pass


def _api():
    from .collectors.containers import DockerApi
    api = DockerApi()
    if not api.available:
        raise UpdateFailed("Docker is not reachable from the monitor")
    return api


def _post_json(api, path: str, body: dict | None = None) -> tuple[int, dict]:
    status, raw = api.send("POST", path, json.dumps(body).encode() if body is not None else None, {"Content-Type": "application/json"} if body is not None else None)
    try:
        return status, json.loads(raw) if raw else {}
    except ValueError:
        return status, {"message": raw[:300].decode("utf-8", "replace")}


# ------------------------------------------------------------------ pure parts (tested)


def split_ref(image: str) -> tuple[str, str]:
    """'lscr.io/linuxserver/sonarr:4.0' → ('lscr.io/linuxserver/sonarr', '4.0'); no tag → 'latest'."""
    name, tag = image, "latest"
    m = re.match(r"^(.+?)(?::([^:/@]+))?$", image)
    if m:
        name, tag = m.group(1), m.group(2) or "latest"
    return name, tag


def user_config(container: dict, image: dict) -> dict:
    """What the OWNER set on this container (not what its old image defaulted) — so the new image's own
    defaults (command, entrypoint, environment) apply, exactly as `docker compose up` would."""
    cfg = container.get("Config") or {}
    img = image.get("Config") or {}
    out = {}
    img_env = set(img.get("Env") or [])
    out["Env"] = [e for e in (cfg.get("Env") or []) if e not in img_env]
    for key in ("Cmd", "Entrypoint", "WorkingDir", "User", "StopSignal", "Healthcheck"):
        if cfg.get(key) not in (None, "", []) and cfg.get(key) != img.get(key):
            out[key] = cfg[key]
    img_labels = img.get("Labels") or {}
    out["Labels"] = {k: v for k, v in (cfg.get("Labels") or {}).items() if img_labels.get(k) != v}
    img_ports = set((img.get("ExposedPorts") or {}).keys())
    extra_ports = {p: {} for p in (cfg.get("ExposedPorts") or {}) if p not in img_ports}
    if extra_ports:
        out["ExposedPorts"] = extra_ports
    for key in ("Tty", "OpenStdin", "StdinOnce", "AttachStdin", "AttachStdout", "AttachStderr"):
        if cfg.get(key):
            out[key] = cfg[key]
    # A hostname the owner chose is kept; Docker's default (the old container's id) is not.
    if cfg.get("Hostname") and not (container.get("Id") or "").startswith(cfg["Hostname"]):
        out["Hostname"] = cfg["Hostname"]
    if cfg.get("Domainname"):
        out["Domainname"] = cfg["Domainname"]
    return out


def _bind_target(bind: str) -> str:
    """'/srv/x:/config:ro' → '/config'."""
    return next((p for p in str(bind).split(":")[1:] if p.startswith("/")), "")


def create_body(container: dict, image: dict, new_image: str) -> tuple[dict, list[tuple[str, dict]]]:
    """The /containers/create body for the new container, and the extra networks to connect afterwards."""
    body = user_config(container, image)
    body["Image"] = new_image
    host = dict(container.get("HostConfig") or {})
    # A volume the image declares (VOLUME /config) and nobody named is in no setting — only in Mounts.
    # It goes along, as `docker compose` does, or the new version starts with an empty /config.
    declared = {_bind_target(b) for b in host.get("Binds") or []} | {m.get("Target") for m in host.get("Mounts") or []}
    carried = [{"Type": "volume", "Source": m["Name"], "Target": m["Destination"], "ReadOnly": not m.get("RW", True)}
               for m in container.get("Mounts") or [] if m.get("Type") == "volume" and m.get("Name") and m.get("Destination") not in declared]
    if carried:
        host["Mounts"] = list(host.get("Mounts") or []) + carried
    body["HostConfig"] = host
    networks = ((container.get("NetworkSettings") or {}).get("Networks") or {})
    endpoint = lambda n: {k: v for k, v in (networks[n] or {}).items() if k in ("Aliases", "IPAMConfig", "Links", "DriverOpts", "MacAddress") and v}
    names = list(networks)
    mode = (body["HostConfig"] or {}).get("NetworkMode", "")
    first = mode if mode in names else (names[0] if names else "")
    if first and not mode.startswith(("container:", "host", "none")):
        body["NetworkingConfig"] = {"EndpointsConfig": {first: endpoint(first)}}
    extra = [(n, endpoint(n)) for n in names if n != first and not mode.startswith(("container:", "host", "none"))]
    return body, extra


def compose_line_swap(text: str, old: str, new: str) -> str | None:
    """Change the one `image: <old>` line of a Compose file to <new>; None when it isn't exactly one line."""
    pattern = re.compile(r"^(\s*image:\s*)(['\"]?)" + re.escape(old) + r"\2(\s*(?:#.*)?)$", re.M)
    found = pattern.findall(text)
    if len(found) != 1:
        return None
    return pattern.sub(lambda m: f"{m.group(1)}{m.group(2)}{new}{m.group(2)}{m.group(3)}", text)


# ------------------------------------------------------------------ steps


def _container(api, name: str) -> dict:
    for c in api.json("/containers/json?all=1"):
        if name in [n.lstrip("/") for n in c.get("Names") or []]:
            return api.json(f"/containers/{c['Id']}/json")
    raise UpdateFailed(f"container {name} not found")


def _pull(api, image: str) -> None:
    name, tag = image.split("@", 1) if "@" in image else split_ref(image)  # repo@sha256:… pulls that exact build
    status, raw = api.send("POST", f"/images/create?fromImage={urllib.parse.quote(name)}&tag={urllib.parse.quote(tag)}")
    text = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else str(raw)
    if status != 200:
        # An image only on this machine (built here) is fine to use as it is.
        local, _ = api.get(f"/images/{urllib.parse.quote(image, safe='')}/json")
        if local == 200:
            return
        raise UpdateFailed(f"could not download {image} ({status}: {text[:160]})")
    for line in text.splitlines():
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        if msg.get("error"):
            local, _ = api.get(f"/images/{urllib.parse.quote(image, safe='')}/json")
            if local == 200:
                return
            raise UpdateFailed(f"could not download {image}: {msg['error'][:200]}")


def _copy_out(api, cid: str, destination: str, folder: str) -> str:
    status, raw = api.get(f"/containers/{cid}/archive?path={urllib.parse.quote(destination)}")
    if status != 200:
        raise UpdateFailed(f"could not copy {destination} ({status})")
    if len(raw) > MAX_COPY_BYTES:
        raise UpdateFailed(f"{destination} is {len(raw) / 1e9:.1f} GB — more than NetSentry copies before an update (back it up first)")
    path = os.path.join(folder, re.sub(r"[^A-Za-z0-9._-]", "_", destination.strip("/")) + ".tar")
    with open(path, "wb") as f:
        f.write(raw)
    return path


def _copy_in(api, cid: str, destination: str, tar_path: str) -> None:
    parent = os.path.dirname(destination.rstrip("/")) or "/"
    with open(tar_path, "rb") as f:
        status, raw = api.send("PUT", f"/containers/{cid}/archive?path={urllib.parse.quote(parent)}", f.read(), {"Content-Type": "application/x-tar"})
    if status != 200:
        raise UpdateFailed(f"could not put {destination} back ({status})")


def _port_answers(port: int | None, host: str | None = None) -> bool:
    if not port:
        return True
    # An app published on one address only answers there (0.0.0.0 = every address, so loopback works).
    hosts = [host] if host and host not in ("0.0.0.0", "::", "") else ["127.0.0.1", "::1"]
    for host in hosts:
        try:
            with socket.create_connection((host, int(port)), timeout=3):
                return True
        except OSError:
            continue
    return False


def health_gate(api, cid: str, port: int | None, seconds: int = HEALTH_SECONDS, steady: int = STEADY_SECONDS, host: str | None = None) -> str:
    """Running, healthy (when it has a health check), its port answering, no restart for `steady` seconds."""
    end = time.time() + seconds
    steady_since = None
    last = ""
    while time.time() < end:
        c = api.json(f"/containers/{cid}/json")
        st = c.get("State") or {}
        health = (st.get("Health") or {}).get("Status", "")
        if st.get("Status") in ("exited", "dead") and not st.get("Restarting"):
            raise UpdateFailed(f"the new version stopped (exit code {st.get('ExitCode')})")
        ok = st.get("Running") and not st.get("Restarting") and int(c.get("RestartCount") or 0) == 0 and health in ("", "healthy") and _port_answers(port, host)
        last = f"{st.get('Status')}{f', {health}' if health else ''}, restarts {c.get('RestartCount') or 0}"
        if health == "unhealthy":
            raise UpdateFailed("the new version reports itself unhealthy")
        if ok:
            steady_since = steady_since or time.time()
            if time.time() - steady_since >= steady:
                return f"running{f' and {health}' if health else ''} for {steady} s"
        else:
            steady_since = None
        time.sleep(2)
    raise UpdateFailed(f"the new version didn't settle in {seconds} s ({last})")


def _remove_current(api, name: str, keep_id: str = "") -> None:
    try:
        new = _container(api, name)
    except UpdateFailed:
        return
    if new["Id"] != keep_id:
        api.send("POST", f"/containers/{new['Id']}/stop?t=20")
        api.send("DELETE", f"/containers/{new['Id']}?force=1")  # never its volumes


def _save_json(folder: str, name: str, data: dict) -> str:
    path = os.path.join(folder, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)
    return path


def _recreate_old(api, saved: dict) -> str:
    """Roll back after the old container was removed: build it again from what it was, on its old image."""
    name = saved["container"]
    with open(saved["old_inspect"], encoding="utf-8") as f:
        old_c = json.load(f)
    with open(saved["old_image_inspect"], encoding="utf-8") as f:
        old_img = json.load(f)
    status, _ = api.get(f"/images/{saved['old_image_id']}/json")
    if status != 200:
        digests = old_img.get("RepoDigests") or []
        if not digests:
            raise UpdateFailed("the old version's image is gone from this server and can't be downloaded again")
        _pull(api, digests[0])
    # Its tag points at the old build again ("latest" goes back to what ran before).
    repo_name, tag = split_ref(saved["from_image"])
    api.send("POST", f"/images/{saved['old_image_id']}/tag?repo={urllib.parse.quote(repo_name)}&tag={urllib.parse.quote(tag)}")
    _remove_current(api, name)
    body, extra = create_body(old_c, old_img, saved["from_image"])
    status, made = _post_json(api, f"/containers/create?name={urllib.parse.quote(name)}", body)
    if status != 201:
        raise UpdateFailed(f"Docker couldn't create the old version again: {made.get('message', status)}")
    cid = made["Id"]
    for net, cfg in extra:
        _post_json(api, f"/networks/{urllib.parse.quote(net)}/connect", {"Container": cid, "EndpointConfig": cfg})
    for item in saved.get("copies", []):
        _copy_in(api, cid, item["destination"], item["tar"])
    if saved.get("compose_backup") and saved.get("compose_file"):
        shutil.copyfile(saved["compose_backup"], saved["compose_file"])
    if saved.get("was_running", True):
        status, _ = api.send("POST", f"/containers/{cid}/start")
        if status not in (204, 304):
            raise UpdateFailed(f"the old version didn't start again ({status}) — start {name} by hand")
    return f"{name} is back on {saved.get('from_image')} with its settings as they were"


def put_back(api, saved: dict) -> str:
    """Undo an update: remove the new container, the old one returns under its name with its settings."""
    if saved.get("old_removed"):
        return _recreate_old(api, saved)
    name = saved["container"]
    try:
        new = _container(api, name)
        if new["Id"] != saved.get("old_id"):
            api.send("POST", f"/containers/{new['Id']}/stop?t=20")
            api.send("DELETE", f"/containers/{new['Id']}?force=1")
    except UpdateFailed:
        pass
    old_id = saved["old_id"]
    api.send("POST", f"/containers/{old_id}/rename?name={urllib.parse.quote(name)}")
    for item in saved.get("copies", []):
        _copy_in(api, old_id, item["destination"], item["tar"])
    if saved.get("compose_backup") and saved.get("compose_file"):
        shutil.copyfile(saved["compose_backup"], saved["compose_file"])
    if saved.get("was_running", True):
        status, _ = api.send("POST", f"/containers/{old_id}/start")
        if status not in (204, 304):
            raise UpdateFailed(f"the old version didn't start again ({status}) — start {name} by hand")
    return f"{name} is back on {saved.get('from_image')} with its settings as they were"


def apply(params: dict, change_id: str, is_me) -> dict:
    """The app.update action. Returns what undo needs; raises UpdateFailed after putting everything back."""
    api = _api()
    name, new_image, from_image = str(params["container"]), str(params["image"]), str(params["from_image"])
    c = _container(api, name)
    if is_me(api, c["Id"], c):
        raise UpdateFailed("refused: that is NetSentry's own monitor")
    if (c.get("Config") or {}).get("Image") != from_image:
        raise UpdateFailed(f"refused: {name} runs {(c.get('Config') or {}).get('Image')}, not {from_image} (it changed since NetSentry looked)")
    # Security review 2026-10-01 (C1): an update is another tag of the SAME image, never a different image —
    # the new container keeps every mount and setting of the old one.
    if not re.fullmatch(r"[a-z0-9][a-z0-9._/:-]{0,254}", new_image or "") or "@" in new_image or split_ref(new_image)[0] != split_ref(from_image)[0]:
        raise UpdateFailed(f"refused: {new_image} is not a newer version of {from_image}")
    allowed = {m.get("Destination") for m in c.get("Mounts") or []}
    keep = [m for m in params.get("keep") or [] if m.get("destination") in allowed]
    old_image = api.json(f"/images/{c['Image']}/json")

    _pull(api, new_image)  # the app keeps running while the download happens
    folder = os.path.join(SNAPSHOT_ROOT or ".", f"{name}-{time.strftime('%Y%m%d-%H%M%S')}")
    os.makedirs(folder, exist_ok=True)
    saved = {"container": name, "old_id": c["Id"], "from_image": from_image, "to_image": new_image, "folder": folder,
             "was_running": bool((c.get("State") or {}).get("Running")), "copies": [], "at": time.time(), "change_id": change_id}
    try:
        api.send("POST", f"/containers/{c['Id']}/stop?t=30")
        for m in keep:
            saved["copies"].append({"destination": m["destination"], "tar": _copy_out(api, c["Id"], m["destination"], folder)})
        # A Compose app keeps its file in step, so the next `docker compose up` doesn't undo the update.
        # (C2) the Compose file is the one Docker recorded for this container, never one the console names
        cf = (str(((c.get("Config") or {}).get("Labels") or {}).get("com.docker.compose.project.config_files") or "").split(",")[0]).strip()
        if cf and new_image != from_image and os.path.isfile(cf):
            text = open(cf, encoding="utf-8").read()
            swapped = compose_line_swap(text, from_image, new_image)
            if swapped is not None:
                backup = os.path.join(folder, "compose.yaml.before")
                shutil.copyfile(cf, backup)
                with open(cf, "w", encoding="utf-8") as f:
                    f.write(swapped)
                saved.update(compose_file=cf, compose_backup=backup)
        stamp = time.strftime("%Y%m%d%H%M%S")
        status, _ = api.send("POST", f"/containers/{c['Id']}/rename?name={urllib.parse.quote(f'{name}-netsentry-old-{stamp}')}")
        if status not in (200, 204):
            raise UpdateFailed(f"could not set the old version aside ({status})")
        body, extra = create_body(c, old_image, new_image)
        status, made = _post_json(api, f"/containers/create?name={urllib.parse.quote(name)}", body)
        if status != 201:
            raise UpdateFailed(f"Docker couldn't create the new version: {made.get('message', status)}")
        new_id = made["Id"]
        saved["new_id"] = new_id
        for net, cfg in extra:
            _post_json(api, f"/networks/{urllib.parse.quote(net)}/connect", {"Container": new_id, "EndpointConfig": cfg})
        status, _ = api.send("POST", f"/containers/{new_id}/start")
        if status not in (204, 304):
            raise UpdateFailed(f"the new version didn't start ({status})")
        probe = params.get("probe") or {}
        proof = health_gate(api, new_id, probe.get("port") if probe.get("proto", "tcp") == "tcp" else None, host=probe.get("bind"))
    except Exception as e:
        reason = str(e) if isinstance(e, UpdateFailed) else f"{type(e).__name__}: {e}"
        try:
            back = put_back(api, saved)
        except Exception as e2:
            raise UpdateFailed(f"{reason}; putting it back ALSO failed: {e2}") from e
        raise UpdateFailed(f"{reason} — {back}") from e
    # It worked. The old container goes (so Compose can't bring it back); what Roll back needs stays.
    saved.update(old_image_id=c["Image"], old_inspect=_save_json(folder, "old-container.json", c),
                 old_image_inspect=_save_json(folder, "old-image.json", old_image))
    pin = "netsentry-rollback/" + (re.sub(r"[^a-z0-9._-]+", "-", name.lower()).strip(".-_") or "app")
    status, _ = api.send("POST", f"/images/{c['Image']}/tag?repo={urllib.parse.quote(pin)}&tag={stamp}")
    if status in (200, 201):
        saved["rollback_tag"] = f"{pin}:{stamp}"
    status, _ = api.send("DELETE", f"/containers/{c['Id']}")  # never its volumes: the new version uses them
    saved["old_removed"] = status in (204, 404)
    saved["note"] = f"{name} updated to {new_image}: {proof}" + (f"; {saved['compose_file']} now says {new_image}" if saved.get("compose_file") else "")
    return saved


def housekeeping(updates: dict, now: float | None = None) -> list[str]:
    """Remove old containers and copies kept for "Roll back" after 14 days. → change ids cleared."""
    now = now or time.time()
    done = []
    try:
        api = _api()
    except UpdateFailed:
        return done
    for cid_change, saved in list(updates.items()):
        if now - float(saved.get("at", now)) < KEEP_DAYS * 86400:
            continue
        if saved.get("old_removed"):
            if saved.get("rollback_tag"):
                api.send("DELETE", f"/images/{urllib.parse.quote(saved['rollback_tag'], safe='')}")  # the pin; refused while in use
        else:
            api.send("DELETE", f"/containers/{saved['old_id']}")  # never its volumes
        shutil.rmtree(saved.get("folder", ""), ignore_errors=True)
        done.append(cid_change)
    return done
