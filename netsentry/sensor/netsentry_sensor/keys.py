"""Who can sign in to THIS server, and their SSH keys (v4 plan §7.8, N-B18).

Adding a key: one `type base64 [comment]` line, into the user's own ~/.ssh/authorized_keys
(created 700/600 and owned by the user). Removing: refused when it would leave no administrator
with a key while password logins are off — that would lock everyone out.
"""

from __future__ import annotations

import os
import re

from .collectors.host import key_fingerprint, parse_passwd_group, parse_sshd_t
from .util import SYSTEM, read_text, run, which

KEY_LINE = re.compile(r"^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) ([A-Za-z0-9+/]{40,}={0,3})(?: ([\x20-\x7e]{1,100}))?$")


class KeysFailed(Exception):
    pass


def _users() -> list[dict]:
    rows = parse_passwd_group(read_text("/etc/passwd") or "", read_text("/etc/group") or "")
    out = []
    for r in rows:
        d = r["data"]
        out.append({"name": r["subject"], "uid": d.get("uid"), "admin": bool(d.get("admin")), "home": d.get("home") or ""})
    return out


def _keys_of(home: str) -> list[dict]:
    path = os.path.join(home, ".ssh", "authorized_keys")
    text = read_text(path)
    out = []
    for line in (text or "").splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        fp = key_fingerprint(s)
        if fp:
            comment = s.split()[-1] if len(s.split()) >= 3 and not s.split()[-1].startswith("AAAA") else ""
            out.append({"type": fp[0], "fingerprint": fp[1], "comment": comment[:100]})
    return out


def password_login() -> bool | None:
    if not which("sshd"):
        return None
    code, out = run(["sshd", "-T"])
    return parse_sshd_t(out)["password_authentication"] if code == 0 else None


def listing(params: dict | None = None) -> dict:
    if SYSTEM != "linux":
        return {"users": [], "why_not": "Keys are managed here on Linux servers; on Windows use its own settings."}
    users = _users()
    for u in users:
        u["keys"] = _keys_of(u["home"]) if u["home"] else []
    return {"users": users, "password_login": password_login()}


def _user(name: str) -> dict:
    for u in _users():
        if u["name"] == name:
            if not u["home"] or not os.path.isdir(u["home"]):
                raise KeysFailed(f"{name} has no home folder")
            return u
    raise KeysFailed(f"refused: {name} isn't an account that can sign in here")


def _own(path: str, uid: int | None, mode: int) -> None:
    os.chmod(path, mode)
    if uid is not None and hasattr(os, "chown"):
        try:
            import pwd
            gid = pwd.getpwuid(uid).pw_gid
        except (KeyError, ImportError):
            gid = uid
        try:
            os.chown(path, uid, gid)
        except OSError:
            pass


def add(params: dict) -> dict:
    if SYSTEM != "linux":
        raise KeysFailed("keys are changed here on Linux servers")
    line = str(params.get("key", "")).strip()
    if not KEY_LINE.match(line):
        raise KeysFailed("refused: that isn't one public SSH key line (it starts with ssh-ed25519, ssh-rsa or ecdsa-…)")
    fp = key_fingerprint(line)
    if not fp:
        raise KeysFailed("refused: the key's data isn't valid")
    u = _user(str(params.get("user", "")))
    folder = os.path.join(u["home"], ".ssh")
    path = os.path.join(folder, "authorized_keys")
    if any(k["fingerprint"] == fp[1] for k in _keys_of(u["home"])):
        raise KeysFailed("that key is already there")
    made_dir = not os.path.isdir(folder)
    if made_dir:
        os.makedirs(folder)
    _own(folder, u["uid"], 0o700)
    made_file = not os.path.exists(path)
    existing = read_text(path) or ""
    with open(path, "a", encoding="utf-8") as f:
        if existing and not existing.endswith("\n"):
            f.write("\n")
        f.write(line + "\n")
    _own(path, u["uid"], 0o600)
    return {"user": u["name"], "path": path, "fingerprint": fp[1], "note": f"added a {fp[0]} key for {u['name']} ({fp[1][:20]}…)"}


def _drop(path: str, fingerprint: str) -> str | None:
    text = read_text(path) or ""
    kept, removed = [], None
    for line in text.splitlines():
        fp = key_fingerprint(line.strip()) if line.strip() and not line.strip().startswith("#") else None
        if fp and fp[1] == fingerprint and removed is None:
            removed = line
            continue
        kept.append(line)
    if removed is None:
        return None
    st = os.stat(path)
    tmp = path + ".netsentry"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("\n".join(kept) + ("\n" if kept else ""))
    os.chmod(tmp, st.st_mode & 0o777)
    if hasattr(os, "chown"):
        os.chown(tmp, st.st_uid, st.st_gid)
    os.replace(tmp, path)
    return removed


def add_undo(saved: dict) -> None:
    _drop(saved["path"], saved["fingerprint"])


def remove(params: dict) -> dict:
    if SYSTEM != "linux":
        raise KeysFailed("keys are changed here on Linux servers")
    u = _user(str(params.get("user", "")))
    fingerprint = str(params.get("fingerprint", ""))
    if password_login() is False:
        others = sum(len([k for k in _keys_of(x["home"]) if not (x["name"] == u["name"] and k["fingerprint"] == fingerprint)])
                     for x in _users() if x["admin"] and x["home"])
        if others == 0:
            raise KeysFailed("refused: password logins are off, and this is the last key an administrator signs in with — removing it would lock everyone out")
    path = os.path.join(u["home"], ".ssh", "authorized_keys")
    line = _drop(path, fingerprint)
    if line is None:
        raise KeysFailed("that key isn't there any more")
    return {"user": u["name"], "path": path, "line": line, "uid": u["uid"], "note": f"removed a key of {u['name']} ({fingerprint[:20]}…)"}


def remove_undo(saved: dict) -> None:
    with open(saved["path"], "a", encoding="utf-8") as f:
        f.write(saved["line"].strip() + "\n")
