"""Files on THIS server (v4 plan §7.1, N-B10/N-B11).

Where: the folders the server's owner allows — set HERE, never by the console:
  read-write  the app folders (each Compose project's own folder), /srv and NETSENTRY_FOLDERS
              (or exactly NETSENTRY_FILE_ROOTS when set)
  read-only   /etc and /var/log (or exactly NETSENTRY_FILE_READ_ROOTS when set)
Every path is resolved with realpath first (a symlink can't climb out) and matched to the
most specific root. The monitor's own folders (its token, its code) are never shown.

Deleting moves to <root>/.netsentry-bin (7 days, then gone); saving keeps the previous copy
for Undo (14 days). Uploads and downloads travel as data, up to 20 MB.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import stat
import time
import uuid

from .util import SYSTEM

STATE_DIR = ""  # set by the runner: the monitor's own state (never shown)
PROTECT: list[str] = []  # NetSentry's own folder on this server, from the check-in: never shown either
BIN = ".netsentry-bin"
MAX_TEXT = 1_000_000
MAX_TRANSFER = 20_000_000
MAX_ENTRIES = 2000
BIN_DAYS = 7
HISTORY_DAYS = 14


class FilesFailed(Exception):
    pass


FilesError = FilesFailed


def _norm(p: str) -> str:
    return os.path.normcase(os.path.realpath(p))


def _env_list(name: str) -> list[str] | None:
    raw = os.environ.get(name)
    if raw is None:
        return None
    return [r.strip() for r in raw.split(",") if r.strip()]


def app_folders() -> dict[str, str]:
    """Compose projects' own folders on this server → project name (from Docker's labels)."""
    out: dict[str, str] = {}
    try:
        from .collectors.containers import DockerApi
        api = DockerApi()
        if not api.available:
            return out
        for c in api.json("/containers/json?all=1"):
            labels = c.get("Labels") or {}
            wd = labels.get("com.docker.compose.project.working_dir")
            if wd and os.path.isabs(wd) and os.path.isdir(wd):
                out[wd] = labels.get("com.docker.compose.project", "")
    except Exception:
        pass
    return out


def _forbidden() -> list[str]:
    """The monitor's own places: never listed, read or changed."""
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    places = [here, "/opt/netsentry", "/var/lib/netsentry-sensor"]
    if SYSTEM == "windows":
        places += [os.path.join(os.environ.get("ProgramData", r"C:\ProgramData"), "NetSentrySensor"),
                   os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "NetSentry")]
    if STATE_DIR:
        places.append(STATE_DIR)
    # NetSentry itself (its database, its code) when it runs on this server: the console says where.
    # It can only ever add to what is hidden, never widen what is shown.
    places += [p for p in PROTECT if isinstance(p, str) and os.path.isabs(p)]
    return [_norm(p) for p in places if p]


def _windows_data_drives() -> list[str]:
    """Fixed drives other than the one Windows runs from (D:\\, E:\\ …): where people keep their things."""
    try:
        import ctypes
        k32 = ctypes.windll.kernel32
        mask = k32.GetLogicalDrives()
    except Exception:
        return []
    system = (os.environ.get("SystemDrive") or "C:").rstrip("\\").upper()
    out = []
    for i in range(26):
        if not mask & (1 << i):
            continue
        letter = f"{chr(65 + i)}:"
        if letter == system:
            continue
        if k32.GetDriveTypeW(letter + "\\") == 3:  # DRIVE_FIXED (not removable, network or CD)
            out.append(letter + "\\")
    return out


def roots() -> list[dict]:
    """The folders people may see here: [{path, mode: rw|ro, why}] — the most specific wins."""
    out: list[dict] = []
    seen: set[str] = set()

    def add(path: str, mode: str, why: str, whole_drive: bool = False) -> None:
        if not path or not os.path.isabs(path) or not os.path.isdir(path):
            return
        key = _norm(path)
        if key in seen:
            return
        # Never the whole system disk; a Windows data drive (D:\\, E:\\) is people's things, so it may be.
        if not whole_drive and (key == "/" or os.path.dirname(key.rstrip("\\/")) == key.rstrip("\\/") or key == _norm(os.path.abspath(os.sep))):
            return
        seen.add(key)
        out.append({"path": os.path.realpath(path), "mode": mode, "why": why})

    rw = _env_list("NETSENTRY_FILE_ROOTS")
    if rw is None:
        for folder, project in sorted(app_folders().items()):
            add(folder, "rw", f"the folder of {project or 'an app'}")
        if SYSTEM != "windows":
            add("/srv", "rw", "the usual place for apps and their data")
        else:
            # Windows (v4 §17): people's own folders and the data drives — where a person keeps their things.
            add(os.path.join(os.environ.get("SystemDrive", "C:") + "\\", "Users"), "rw", "everyone's own folders (Desktop, Documents, Downloads…)")
            for drive in _windows_data_drives():
                add(drive, "rw", "a data drive", whole_drive=True)
        for r in _env_list("NETSENTRY_FOLDERS") or []:
            add(r, "rw", "a folder the owner listed")
    else:
        for r in rw:
            add(r, "rw", "a folder the owner listed")
    ro = _env_list("NETSENTRY_FILE_READ_ROOTS")
    words = {"/etc": "the server's own settings", "/var/log": "the server's logs"}
    if SYSTEM == "windows":
        program_data = os.environ.get("ProgramData", r"C:\\ProgramData")
        win_logs = os.path.join(os.environ.get("SystemRoot", r"C:\\Windows"), "Logs")
        words.update({program_data: "programs' settings and data", win_logs: "Windows' own logs"})
        defaults = [program_data, win_logs]
    else:
        defaults = ["/etc", "/var/log"]
    for r in (ro if ro is not None else defaults):
        add(r, "ro", words.get(r, "a folder the owner listed"))
    return out


def _inside(real: str, root: str) -> bool:
    r = _norm(root)
    return real == r or real.startswith(r.rstrip(os.sep) + os.sep)


def resolve(path: str, write: bool = False) -> tuple[str, dict]:
    """(the real path, its root) — or refused. `path` must be absolute."""
    if not isinstance(path, str) or not path or "\x00" in path or not os.path.isabs(path):
        raise FilesError("refused: not a full path")
    real = os.path.realpath(path)
    key = os.path.normcase(real)
    for f in _forbidden():
        if key == f or key.startswith(f.rstrip(os.sep) + os.sep):
            raise FilesError("refused: that is NetSentry's own folder")
    if (os.sep + BIN + os.sep) in (key + os.sep):
        raise FilesError("refused: that is NetSentry's bin (use Undo on the change instead)")
    best = None
    for r in roots():
        if _inside(key, r["path"]) and (best is None or len(r["path"]) > len(best["path"])):
            best = r
    if not best:
        raise FilesError("refused: that folder isn't one this server allows (Settings → Monitor shows which)")
    if write and best["mode"] != "rw":
        raise FilesError("refused: that folder is read-only here")
    return real, best


def _name_ok(name: str) -> bool:
    return bool(name) and name not in (".", "..", BIN) and len(name) <= 255 and not any(ch in name for ch in "/\\\x00") and (SYSTEM != "windows" or not any(ch in name for ch in ':*?"<>|'))


def _entry(path: str, name: str) -> dict:
    try:
        st = os.lstat(os.path.join(path, name))
    except OSError:
        return {"name": name, "kind": "unknown"}
    kind = "link" if stat.S_ISLNK(st.st_mode) else "dir" if stat.S_ISDIR(st.st_mode) else "file" if stat.S_ISREG(st.st_mode) else "other"
    return {"name": name, "kind": kind, "size": st.st_size if kind == "file" else None, "modified": int(st.st_mtime), "perm": stat.filemode(st.st_mode)}


def list_dir(path: str) -> dict:
    if not path:
        return {"path": "", "roots": roots(), "entries": []}
    real, root = resolve(path)
    if not os.path.isdir(real):
        raise FilesError("that is not a folder")
    try:
        names = os.listdir(real)
    except PermissionError as e:
        raise FilesError("the monitor may not read that folder") from e
    hidden = _forbidden()
    names = [n for n in names if n != BIN and _norm(os.path.join(real, n)) not in hidden]  # NetSentry's own: not even its name
    entries = [_entry(real, n) for n in sorted(names, key=str.lower)[:MAX_ENTRIES]]
    entries.sort(key=lambda e: (e.get("kind") != "dir", e["name"].lower()))
    parent = os.path.dirname(real.rstrip(os.sep)) if _norm(real) != _norm(root["path"]) else ""
    return {"path": real, "root": root, "parent": parent, "entries": entries, "more": max(0, len(names) - MAX_ENTRIES)}


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def _read_bytes(real: str, limit: int) -> bytes:
    if not os.path.isfile(real):
        raise FilesError("that is not a file")
    size = os.path.getsize(real)
    if size > limit:
        raise FilesError(f"it is {size / 1e6:.1f} MB — more than NetSentry opens ({limit / 1e6:.0f} MB); use the terminal")
    try:
        with open(real, "rb") as f:
            return f.read()
    except PermissionError as e:
        raise FilesError("the monitor may not read that file") from e


def read_file(path: str) -> dict:
    real, root = resolve(path)
    data = _read_bytes(real, MAX_TEXT)
    binary = b"\x00" in data[:8192]
    text = None
    if not binary:
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            binary = True
    return {"path": real, "root": root, "size": len(data), "sha256": sha256_bytes(data), "binary": binary, "text": text, "modified": int(os.path.getmtime(real))}


def download(path: str, send) -> dict:
    """A file a person wants on their own computer: sent to NetSentry as a file (`send(name, data)` → its id)."""
    real, _ = resolve(path)
    data = _read_bytes(real, MAX_TRANSFER)
    name = os.path.basename(real)
    return {"name": name, "size": len(data), "sha256": sha256_bytes(data), "transfer_id": send(name, data)}


# ------------------------------------------------------------------ changes (executor actions)

def _history_dir() -> str:
    d = os.path.join(STATE_DIR or ".", "file-history")
    os.makedirs(d, mode=0o700, exist_ok=True)
    return d


def _owner_like(path: str, like: str) -> None:
    if not hasattr(os, "chown"):
        return
    try:
        st = os.stat(like)
        os.chown(path, st.st_uid, st.st_gid)
    except OSError:
        pass


def _write_atomic(real: str, data: bytes) -> None:
    folder = os.path.dirname(real)
    tmp = os.path.join(folder, f".{os.path.basename(real)}.netsentry-{uuid.uuid4().hex[:8]}")
    with open(tmp, "wb") as f:
        f.write(data)
    if os.path.exists(real):
        st = os.stat(real)
        os.chmod(tmp, stat.S_IMODE(st.st_mode))
        _owner_like(tmp, real)
    else:
        _owner_like(tmp, folder)
    os.replace(tmp, real)


def write(params: dict) -> dict:
    """Save a text file (new or changed) — refused if it changed since the person opened it."""
    path = str(params.get("path", ""))
    content = params.get("content")
    if not isinstance(content, str) or len(content.encode("utf-8")) > MAX_TEXT:
        raise FilesError("refused: not text, or more than 1 MB")
    folder, name = os.path.dirname(path), os.path.basename(path)
    if not _name_ok(name):
        raise FilesError("refused: not a file name")
    real_folder, _ = resolve(folder, write=True)
    real = os.path.join(real_folder, name)
    resolve(real, write=True)
    expected = str(params.get("expected_sha256", ""))
    previous = None
    if os.path.lexists(real):
        if not os.path.isfile(real) or os.path.islink(real):
            raise FilesError("refused: that is not an ordinary file")
        current = _read_bytes(real, MAX_TEXT)
        if sha256_bytes(current) != expected:
            raise FilesError("it changed on the server since you opened it — open it again")
        previous = os.path.join(_history_dir(), f"{int(time.time())}-{uuid.uuid4().hex[:8]}")
        shutil.copy2(real, previous)
    elif expected:
        raise FilesError("it was removed on the server since you opened it")
    _write_atomic(real, content.encode("utf-8"))
    return {"path": real, "previous": previous, "note": f"saved {real}" + (" (the previous copy is kept for Undo)" if previous else " (new file)")}


def write_undo(saved: dict) -> None:
    real = saved.get("path")
    if not real:
        return
    if saved.get("previous") and os.path.isfile(saved["previous"]):
        with open(saved["previous"], "rb") as f:
            _write_atomic(real, f.read())
    elif not saved.get("previous") and os.path.isfile(real):
        os.remove(real)


def mkdir(params: dict) -> dict:
    path = str(params.get("path", ""))
    folder, name = os.path.dirname(path), os.path.basename(path)
    if not _name_ok(name):
        raise FilesError("refused: not a folder name")
    real_folder, _ = resolve(folder, write=True)
    real = os.path.join(real_folder, name)
    if os.path.lexists(real):
        raise FilesError("something with that name is already there")
    os.mkdir(real, 0o755)
    _owner_like(real, real_folder)
    return {"path": real, "note": f"made {real}"}


def mkdir_undo(saved: dict) -> None:
    p = saved.get("path")
    if p and os.path.isdir(p) and not os.listdir(p):
        os.rmdir(p)


def move(params: dict) -> dict:
    """Rename or move — both ends inside read-write roots."""
    src, _ = resolve(str(params.get("path", "")), write=True)
    to = str(params.get("to", ""))
    if not _name_ok(os.path.basename(to)):
        raise FilesError("refused: not a name")
    dest_folder, _ = resolve(os.path.dirname(to), write=True)
    dest = os.path.join(dest_folder, os.path.basename(to))
    if os.path.lexists(dest):
        raise FilesError("something with that name is already there")
    if any(_norm(src) == _norm(r["path"]) for r in roots()):
        raise FilesError("refused: that is one of the allowed folders itself")
    shutil.move(src, dest)
    return {"from": src, "to": dest, "note": f"moved {src} to {dest}"}


def move_undo(saved: dict) -> None:
    if saved.get("to") and os.path.lexists(saved["to"]) and not os.path.lexists(saved["from"]):
        shutil.move(saved["to"], saved["from"])


def delete(params: dict) -> dict:
    """To the bin of its root (7 days)."""
    real, root = resolve(str(params.get("path", "")), write=True)
    if any(_norm(real) == _norm(r["path"]) for r in roots()):
        raise FilesError("refused: that is one of the allowed folders itself")
    if not os.path.lexists(real):
        raise FilesError("it isn't there any more")
    slot = os.path.join(root["path"], BIN, f"{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}")
    os.makedirs(slot, mode=0o700, exist_ok=True)
    with open(os.path.join(slot, ".netsentry.json"), "w", encoding="utf-8") as f:
        json.dump({"from": real, "at": time.time()}, f)
    shutil.move(real, os.path.join(slot, os.path.basename(real)))
    return {"path": real, "bin": os.path.join(slot, os.path.basename(real)), "note": f"moved {real} to NetSentry's bin (kept {BIN_DAYS} days)"}


def delete_undo(saved: dict) -> None:
    b = saved.get("bin")
    if b and os.path.lexists(b) and not os.path.lexists(saved["path"]):
        shutil.move(b, saved["path"])


def upload(params: dict, fetch) -> dict:
    """A file a person sent through NetSentry: fetched from the console, checked against its hash."""
    folder, name = str(params.get("folder", "")), str(params.get("name", ""))
    if not _name_ok(name):
        raise FilesError("refused: not a file name")
    real_folder, _ = resolve(folder, write=True)
    real = os.path.join(real_folder, name)
    if os.path.lexists(real):
        raise FilesError("a file with that name is already there")
    data = fetch(str(params.get("transfer_id", "")))
    if len(data) > MAX_TRANSFER or sha256_bytes(data) != str(params.get("sha256", "")):
        raise FilesError("the file that arrived isn't the one you chose (its fingerprint differs)")
    _write_atomic(real, data)
    size = f"{len(data) / 1e6:.1f} MB" if len(data) >= 1_000_000 else f"{round(len(data) / 1e3)} KB" if len(data) >= 1000 else f"{len(data)} bytes"
    return {"path": real, "note": f"saved {real} ({size})"}


def upload_undo(saved: dict) -> None:
    p = saved.get("path")
    if p and os.path.isfile(p):
        os.remove(p)


def housekeeping(now: float | None = None) -> None:
    """The bin empties after 7 days; previous copies go after 14."""
    now = now or time.time()
    for r in roots():
        b = os.path.join(r["path"], BIN)
        if not os.path.isdir(b) or r["mode"] != "rw":
            continue
        for slot in os.listdir(b):
            p = os.path.join(b, slot)
            try:
                with open(os.path.join(p, ".netsentry.json"), encoding="utf-8") as f:
                    at = float(json.load(f).get("at", now))
            except (OSError, ValueError):
                at = os.path.getmtime(p)
            if now - at > BIN_DAYS * 86400:
                shutil.rmtree(p, ignore_errors=True)
    h = os.path.join(STATE_DIR or ".", "file-history")
    if os.path.isdir(h):
        for name in os.listdir(h):
            p = os.path.join(h, name)
            if now - os.path.getmtime(p) > HISTORY_DAYS * 86400:
                os.remove(p)


def bin_size() -> int:
    total = 0
    for r in roots():
        b = os.path.join(r["path"], BIN)
        for dirpath, _, names in os.walk(b):
            for n in names:
                try:
                    total += os.path.getsize(os.path.join(dirpath, n))
                except OSError:
                    pass
    return total


def empty_bin() -> int:
    freed = bin_size()
    for r in roots():
        if r["mode"] == "rw":
            shutil.rmtree(os.path.join(r["path"], BIN), ignore_errors=True)
    return freed
