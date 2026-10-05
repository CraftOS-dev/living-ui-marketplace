"""Backups the monitor takes, restores and tests (v3 plan §11).

    run      copy an app's settings folders (through Docker, so it works from a
             container too) and dump its database with the database's own tool,
             into ONE file: <folder>/netsentry-backups/<container>/<when>.tar.gz
             (+ .sha256); keep 7 daily / 4 weekly / 6 monthly; delete the rest.
    restore  put a copy back: a safety copy of what is there now first, then
             the backup, then the health gate; if it doesn't come back, the
             safety copy goes back by itself.
    test     open every file in a copy, check its fingerprint, and check every
             SQLite database and dump inside it — "it restores", not just "it exists".

Where copies may go is checked HERE: an existing folder, never a system folder,
and — when the machine's owner set NETSENTRY_FOLDERS — only under those.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import io
import json
import os
import re
import sqlite3
import tarfile
import tempfile
import time
import urllib.parse

ARCHIVE = re.compile(r"^\d{4}-\d{2}-\d{2}_\d{6}\.tar\.gz$")
SYSTEM_DIRS = ("/proc", "/sys", "/dev", "/run", "/boot", "/etc", "/usr", "/bin", "/sbin", "/lib", "/lib32", "/lib64", "/libx32", "/opt/netsentry",
               "/var/lib", "/var/spool", "/var/log", "/var/run", "/var/cache", "/var/mail", "/root", "/snap",
               "C:\\Windows", "C:\\Program Files", "C:\\Program Files (x86)", "C:\\ProgramData")
DUMPS = {
    # image name contains → the dump command run inside the container (its own credentials stay inside it)
    "postgres": ["sh", "-c", 'pg_dumpall -U "${POSTGRES_USER:-postgres}"'],
    "postgis": ["sh", "-c", 'pg_dumpall -U "${POSTGRES_USER:-postgres}"'],
    "mariadb": ["sh", "-c", 'mariadb-dump --all-databases --single-transaction -uroot -p"${MARIADB_ROOT_PASSWORD:-$MYSQL_ROOT_PASSWORD}"'],
    "mysql": ["sh", "-c", 'mysqldump --all-databases --single-transaction -uroot -p"${MYSQL_ROOT_PASSWORD}"'],
}
DUMP_END = (b"-- PostgreSQL database cluster dump complete", b"-- Dump completed")


class BackupFailed(Exception):
    pass


def _api():
    from .update import _api as api
    return api()


# ------------------------------------------------------------------ pure parts (tested)


def check_folder(path: str) -> str:
    """Where copies may go: an absolute, existing folder, not a system one, inside NETSENTRY_FOLDERS if set."""
    raw = str(path or "").strip()
    if not raw or not os.path.isabs(raw):
        raise BackupFailed("refused: give the full path of a folder on the server (another disk or a NAS share)")
    # The real place (links and ".." resolved), so "/srv/../etc" or a link to /etc is judged as /etc.
    p = os.path.realpath(raw)
    posix = p.replace("\\", "/").rstrip("/") or "/"
    system = [d.replace("\\", "/").rstrip("/").lower() for d in SYSTEM_DIRS]
    if os.path.dirname(p) == p or posix == "/" or re.fullmatch(r"[A-Za-z]:", posix) or any(posix.lower() == d or posix.lower().startswith(d + "/") for d in system):
        raise BackupFailed("refused: backups go to a folder of their own (another disk or a NAS share), never a system folder")
    roots = [os.path.realpath(r.strip()) for r in os.environ.get("NETSENTRY_FOLDERS", "").split(",") if r.strip()]
    if roots and not any(p == r or p.startswith(r.rstrip("/\\") + os.sep) for r in roots):
        raise BackupFailed(f"refused: this server only allows backups under {', '.join(roots)} (NETSENTRY_FOLDERS)")
    # A monitor in a container sees its own files, not the machine's: there, only folders the owner listed.
    if not roots and os.path.exists("/.dockerenv"):
        raise BackupFailed("refused: a monitor in a container only uses folders listed in NETSENTRY_FOLDERS")
    if not os.path.isdir(p):
        # The last folder may be made here when its parent is a place the owner chose (a NETSENTRY_FOLDERS root)
        # or a mounted disk/share — never on a bare mount point whose disk is missing (that would fill the system disk).
        parent = os.path.dirname(p)
        under_root = os.path.dirname(parent) == parent  # never a new folder straight under / or a drive
        if os.path.isdir(parent) and not under_root and (parent in roots or os.path.ismount(parent)):
            os.makedirs(p, mode=0o700, exist_ok=True)
        else:
            raise BackupFailed(f"{p} doesn't exist on this server (is the disk or share mounted?)")
    return p


def _private_dirs(root: str, folder: str) -> None:
    """Copies hold databases and passwords: only the monitor's own user may read them (0700 / 0600)."""
    for d in (os.path.join(root, "netsentry-backups"), folder):
        os.makedirs(d, mode=0o700, exist_ok=True)
        try:
            os.chmod(d, 0o700)
        except OSError:
            pass


def _private_file(path: str) -> None:
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def app_folder(root: str, container: str) -> str:
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}", container or ""):
        raise BackupFailed("refused: not a container name")
    return os.path.join(root, "netsentry-backups", container)


def keep_set(names: list[str], daily: int, weekly: int, monthly: int) -> set[str]:
    """Which copies to keep: the newest per day for `daily` days, per ISO week for `weekly`, per month for `monthly`."""
    dated = []
    for n in names:
        if ARCHIVE.match(n):
            dated.append((dt.datetime.strptime(n[:17], "%Y-%m-%d_%H%M%S"), n))
    dated.sort(reverse=True)
    keep: set[str] = set()
    for count, key in ((daily, lambda d: d.date()), (weekly, lambda d: d.isocalendar()[:2]), (monthly, lambda d: (d.year, d.month))):
        seen = []
        for when, n in dated:
            k = key(when)
            if k in seen:
                continue
            if len(seen) >= count:
                break
            seen.append(k)
            keep.add(n)
    if dated:
        keep.add(dated[0][1])  # never delete the newest
    return keep


def dump_command(image: str) -> list[str] | None:
    name = (image or "").split("/")[-1].split(":")[0].lower()
    for key, cmd in DUMPS.items():
        if key in name:
            return cmd
    return None


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def inspect_archive(path: str) -> dict:
    """Open every file in a copy; check SQLite databases and dumps inside it. → {ok, files, databases, problems}."""
    problems, files, databases = [], 0, 0
    with tempfile.TemporaryDirectory() as tmp:
        try:
            with tarfile.open(path, "r:gz") as outer:
                for m in outer.getmembers():
                    f = outer.extractfile(m) if m.isfile() else None
                    if f is None:
                        continue
                    data = f.read()
                    files += 1
                    if m.name.startswith("paths/") and m.name.endswith(".tar"):
                        with tarfile.open(fileobj=io.BytesIO(data)) as inner:
                            for im in inner.getmembers():
                                if not im.isfile():
                                    continue
                                body = inner.extractfile(im).read()
                                files += 1
                                if re.search(r"\.(db|sqlite|sqlite3)$", im.name) and body[:16] == b"SQLite format 3\x00":
                                    databases += 1
                                    target = os.path.join(tmp, f"db{databases}.sqlite")
                                    with open(target, "wb") as out:
                                        out.write(body)
                                    con = sqlite3.connect(target)
                                    try:
                                        result = con.execute("PRAGMA integrity_check").fetchone()[0]
                                        if result != "ok":
                                            problems.append(f"{im.name}: {result[:80]}")
                                    except sqlite3.DatabaseError as e:
                                        problems.append(f"{im.name}: {e}")
                                    finally:
                                        con.close()
                    elif m.name == "dump.sql":
                        databases += 1
                        if not any(end in data[-4096:] for end in DUMP_END):
                            problems.append("the database dump is incomplete")
        except (tarfile.TarError, OSError, EOFError) as e:
            problems.append(f"the copy can't be opened: {e}")
    return {"ok": not problems, "files": files, "databases": databases, "problems": problems[:5]}


# ------------------------------------------------------------------ Docker helpers


def _exec(api, cid: str, cmd: list[str]) -> tuple[int, bytes]:
    from .logs import demux
    from .update import _post_json
    status, made = _post_json(api, f"/containers/{cid}/exec", {"Cmd": cmd, "AttachStdout": True, "AttachStderr": False})
    if status != 201:
        raise BackupFailed(f"Docker couldn't run the database's own backup tool ({status})")
    status, raw = api.send("POST", f"/exec/{made['Id']}/start", json.dumps({"Detach": False, "Tty": False}).encode(), {"Content-Type": "application/json"})
    info = api.json(f"/exec/{made['Id']}/json")
    out = b"".join(_frames(raw))
    return int(info.get("ExitCode") or 0), out


def _frames(raw: bytes):
    i = 0
    if len(raw) >= 8 and raw[0] in (0, 1, 2) and raw[1:4] == b"\x00\x00\x00":
        while i + 8 <= len(raw):
            size = int.from_bytes(raw[i + 4:i + 8], "big")
            if raw[i] == 1:
                yield raw[i + 8:i + 8 + size]
            i += 8 + size
    else:
        yield raw


def _container(api, name: str) -> dict:
    from .update import _container as find
    return find(api, name)


# ------------------------------------------------------------------ actions


def run(params: dict) -> dict:
    api = _api()
    root = check_folder(params.get("dest", ""))
    name = str(params.get("container", ""))
    folder = app_folder(root, name)
    _private_dirs(root, folder)
    c = _container(api, name)
    allowed = {m.get("Destination") for m in c.get("Mounts") or []}
    keep = [m["destination"] for m in params.get("keep") or [] if m.get("destination") in allowed]
    dump = dump_command((c.get("Config") or {}).get("Image", ""))
    stamp = time.strftime("%Y-%m-%d_%H%M%S", time.gmtime())
    final = os.path.join(folder, f"{stamp}.tar.gz")
    part = final + ".part"
    running = bool((c.get("State") or {}).get("Running"))
    stopped = False
    contents = []
    try:
        with open(part, "wb") as raw_out:
            _private_file(part)
        with tarfile.open(part, "w:gz") as out:
            manifest = {"app": params.get("app", name), "container": name, "image": (c.get("Config") or {}).get("Image", ""), "taken_at": stamp, "paths": keep}
            use_dump = bool(dump and running)  # a stopped database's files are consistent: copy them instead
            if use_dump:
                code, sql = _exec(api, c["Id"], dump)
                if code != 0 or not any(end in sql[-4096:] for end in DUMP_END):
                    raise BackupFailed("the database's own backup tool did not finish (check its user and password settings)")
                _add_bytes(out, "dump.sql", sql)
                contents.append("database dump")
            elif keep and running:
                # Files of a running app can be half-written: stop it for the few seconds the copy takes.
                api.send("POST", f"/containers/{c['Id']}/stop?t=30")
                stopped = True
            for dest in keep if not use_dump else []:
                status, raw = api.get(f"/containers/{c['Id']}/archive?path={urllib.parse.quote(dest)}")
                if status != 200:
                    raise BackupFailed(f"could not copy {dest} ({status})")
                _add_bytes(out, f"paths/{re.sub(r'[^A-Za-z0-9._-]', '_', dest.strip('/'))}.tar", raw)
                contents.append(dest)
            manifest["contents"] = contents
            if use_dump:
                manifest["paths"] = []  # a dump restores through the database itself, not as files
            _add_bytes(out, "manifest.json", json.dumps(manifest, indent=1).encode())
    except Exception:
        try:
            os.remove(part)
        except OSError:
            pass
        raise
    finally:
        if stopped:
            api.send("POST", f"/containers/{c['Id']}/start")
    if not contents:
        os.remove(part)
        raise BackupFailed("there was nothing to copy (no settings folders or database found)")
    os.replace(part, final)
    _private_file(final)
    digest = sha256_file(final)
    with open(final + ".sha256", "w", encoding="ascii") as f:
        f.write(f"{digest}  {os.path.basename(final)}\n")
    _private_file(final + ".sha256")
    names = sorted(n for n in os.listdir(folder) if ARCHIVE.match(n))
    keep_names = keep_set(names, int(params.get("keep_daily") or 7), int(params.get("keep_weekly") or 4), int(params.get("keep_monthly") or 6))
    removed = []
    for n in names:
        if n not in keep_names:
            for p in (n, n + ".sha256"):
                try:
                    os.remove(os.path.join(folder, p))
                except OSError:
                    pass
            removed.append(n)
    size = os.path.getsize(final)
    note = json.dumps({"backup": os.path.basename(final), "size": size, "sha256": digest, "contents": ", ".join(contents)[:80], "removed": removed[:10]}, separators=(",", ":"))
    return {"note": note, "archive": final}


def _add_bytes(tar: tarfile.TarFile, name: str, data: bytes) -> None:
    info = tarfile.TarInfo(name)
    info.size, info.mtime, info.mode = len(data), int(time.time()), 0o600
    tar.addfile(info, io.BytesIO(data))


def _archive_path(params: dict) -> str:
    root = check_folder(params.get("dest", ""))
    folder = app_folder(root, str(params.get("container", "")))
    name = os.path.basename(str(params.get("archive", "")))
    if not ARCHIVE.match(name):
        raise BackupFailed("refused: not one of NetSentry's backups")
    path = os.path.join(folder, name)
    if not os.path.isfile(path):
        raise BackupFailed(f"{name} isn't there any more")
    want = (open(path + ".sha256", encoding="ascii").read().split() or [""])[0] if os.path.exists(path + ".sha256") else ""
    if want and sha256_file(path) != want:
        raise BackupFailed(f"{name} has changed since it was made (its fingerprint doesn't match) — NetSentry won't use it")
    return path


def test(params: dict) -> dict:
    path = _archive_path(params)
    r = inspect_archive(path)
    words = f"opened {r['files']} file(s), checked {r['databases']} database(s)" + ("" if r["ok"] else f": {'; '.join(r['problems'])}")
    note = json.dumps({"tested": os.path.basename(path), "ok": r["ok"], "result": words[:250]}, separators=(",", ":"))
    if not r["ok"]:
        raise BackupFailed(f"the copy {os.path.basename(path)} would not restore cleanly: {'; '.join(r['problems'])}")
    return {"note": note}


def restore(params: dict) -> dict:
    from .update import health_gate
    path = _archive_path(params)
    api = _api()
    name = str(params.get("container", ""))
    c = _container(api, name)
    with tarfile.open(path, "r:gz") as outer:
        members = {m.name: outer.extractfile(m).read() for m in outer.getmembers() if m.isfile()}
    manifest = json.loads(members.get("manifest.json", b"{}"))
    if manifest.get("container") != name:
        raise BackupFailed(f"refused: that copy is of {manifest.get('container')}, not {name}")
    folder = os.path.dirname(path)
    safety = os.path.join(folder, f".before-restore-{time.strftime('%Y%m%d-%H%M%S')}")
    os.makedirs(safety, mode=0o700, exist_ok=True)
    paths = manifest.get("paths") or []
    if paths:
        api.send("POST", f"/containers/{c['Id']}/stop?t=30")
    saved = []
    try:
        for dest in manifest.get("paths") or []:
            status, raw = api.get(f"/containers/{c['Id']}/archive?path={urllib.parse.quote(dest)}")
            if status == 200:
                p = os.path.join(safety, re.sub(r"[^A-Za-z0-9._-]", "_", dest.strip("/")) + ".tar")
                with open(p, "wb") as f:
                    f.write(raw)
                _private_file(p)
                saved.append((dest, p))
        for dest in manifest.get("paths") or []:
            raw = members.get(f"paths/{re.sub(r'[^A-Za-z0-9._-]', '_', dest.strip('/'))}.tar")
            if raw is None:
                continue
            parent = os.path.dirname(dest.rstrip("/")) or "/"
            status, _ = api.send("PUT", f"/containers/{c['Id']}/archive?path={urllib.parse.quote(parent)}", raw, {"Content-Type": "application/x-tar"})
            if status != 200:
                raise BackupFailed(f"could not put {dest} back ({status})")
        api.send("POST", f"/containers/{c['Id']}/start")
        if "dump.sql" in members:
            buf = io.BytesIO()
            with tarfile.open(fileobj=buf, mode="w") as t:
                info = tarfile.TarInfo("netsentry-restore.sql")
                info.size = len(members["dump.sql"])
                t.addfile(info, io.BytesIO(members["dump.sql"]))
            api.send("PUT", f"/containers/{c['Id']}/archive?path=/tmp", buf.getvalue(), {"Content-Type": "application/x-tar"})
            time.sleep(5)  # the database needs a moment to accept connections
            image = (c.get("Config") or {}).get("Image", "").lower()
            cmd = ["sh", "-c", 'psql -U "${POSTGRES_USER:-postgres}" -f /tmp/netsentry-restore.sql postgres'] if "post" in image else \
                ["sh", "-c", 'mariadb -uroot -p"${MARIADB_ROOT_PASSWORD:-$MYSQL_ROOT_PASSWORD}" < /tmp/netsentry-restore.sql || mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" < /tmp/netsentry-restore.sql']
            code, _ = _exec(api, c["Id"], cmd)
            if code != 0:
                raise BackupFailed("the database refused the copy")
        probe = params.get("probe") or {}
        proof = health_gate(api, c["Id"], probe.get("port"), seconds=180, steady=20, host=probe.get("bind"))
    except Exception as e:
        reason = str(e) if isinstance(e, BackupFailed) else f"{type(e).__name__}: {e}"
        api.send("POST", f"/containers/{c['Id']}/stop?t=30")
        for dest, p in saved:
            parent = os.path.dirname(dest.rstrip("/")) or "/"
            with open(p, "rb") as f:
                api.send("PUT", f"/containers/{c['Id']}/archive?path={urllib.parse.quote(parent)}", f.read(), {"Content-Type": "application/x-tar"})
        api.send("POST", f"/containers/{c['Id']}/start")
        raise BackupFailed(f"{reason} — what was there before is back") from e
    return {"note": f"restored {os.path.basename(path)}; {proof}", "safety": safety}
