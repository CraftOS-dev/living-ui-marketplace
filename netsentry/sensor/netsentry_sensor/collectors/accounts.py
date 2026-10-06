"""Who has an account in an app, and who is an administrator (docs/SYSTEM-V2-PLAN.md §16.7, D12).

Organisation mode only, and only for an app someone gave NetSentry a READ-ONLY key for
(e.g. a Gitea token with just the "read:admin" scope). The console hands the key to this
monitor at check-in; it is kept in memory for the call and never written to disk or logs.
Names, admin flags and last sign-in times are reported — no email addresses.

Observations:
  app.account          {app_key, login, is_admin, active, last_login, created}
  app.accounts_status  {app_key, ok, error, count}
"""

from __future__ import annotations

import ipaddress
import json
import urllib.parse

from .base import Collector
from .probe import _http, local_ips

MAX_PAGES = 20
NEVER = ("", "0001-01-01T00:00:00Z", "1970-01-01T00:00:00Z")


def parse_gitea_users(users: list) -> list[dict]:
    """Gitea / Forgejo GET /api/v1/admin/users → accounts (no emails)."""
    out = []
    for u in users if isinstance(users, list) else []:
        if not isinstance(u, dict) or not u.get("login"):
            continue
        last = str(u.get("last_login") or "")
        out.append({"login": str(u["login"])[:100], "is_admin": bool(u.get("is_admin")),
                    "active": bool(u.get("active", True)) and not bool(u.get("prohibit_login")),
                    "last_login": "" if last in NEVER else last[:40], "created": str(u.get("created") or "")[:40]})
    return out


def list_gitea(base: str, token: str) -> list[dict]:
    accounts = []
    for page in range(1, MAX_PAGES + 1):
        status, body, _ = _http("GET", f"{base}/api/v1/admin/users?limit=50&page={page}", headers={"Authorization": f"token {token}", "Accept": "application/json"}, timeout=10)
        if status == 401 or status == 403:
            raise PermissionError("the key was refused (it needs the read:admin scope)")
        if status != 200:
            raise OSError(f"the app answered {status}")
        batch = parse_gitea_users(json.loads(body.decode("utf-8", "replace") or "[]"))
        accounts += batch
        if len(batch) < 50:
            break
    return accounts


def _xmlrpc(base: str, endpoint: str, method: str, args: tuple):
    """One XML-RPC call through the monitor's own HTTP (no redirects, a time limit)."""
    import xmlrpc.client
    body = xmlrpc.client.dumps(args, method, allow_none=True).encode()
    status, raw, _ = _http("POST", f"{base}/xmlrpc/2/{endpoint}", body=body, headers={"Content-Type": "text/xml"}, timeout=15)
    if status != 200:
        raise OSError(f"the app answered {status}")
    try:
        return xmlrpc.client.loads(raw.decode("utf-8", "replace"))[0][0]
    except xmlrpc.client.Fault as f:
        if "Access" in str(f.faultString) or "denied" in str(f.faultString).lower():
            raise PermissionError("the key was refused") from f
        raise OSError("the app refused the question") from f


def parse_odoo_key(token: str) -> tuple[str, str, str]:
    """'login:key' or 'database/login:key' → (database or '', login, key)."""
    db, _, rest = token.rpartition("/") if "/" in token.split(":", 1)[0] else ("", "", token)
    login, _, key = rest.partition(":")
    if not login or not key:
        raise PermissionError("paste it as login:key (or database/login:key)")
    return db, login, key


def parse_odoo_users(users: list, admins: set) -> list[dict]:
    out = []
    for u in users if isinstance(users, list) else []:
        if not isinstance(u, dict) or not u.get("login"):
            continue
        last = str(u.get("login_date") or "")
        out.append({"login": str(u["login"])[:100], "is_admin": u.get("id") in admins, "active": bool(u.get("active")),
                    "last_login": "" if last in ("", "False") else last.replace(" ", "T")[:19] + "Z", "created": str(u.get("create_date") or "").replace(" ", "T")[:19] + "Z"})
    return out


def list_odoo(base: str, token: str) -> list[dict]:
    """Odoo (14+): an ordinary internal user's API key can list the internal users and ask which are administrators."""
    db, login, key = parse_odoo_key(token)
    if not db:
        dbs = _xmlrpc(base, "db", "list", ())
        if not isinstance(dbs, list) or len(dbs) != 1:
            raise PermissionError("Odoo has several databases (or hides the list): paste it as database/login:key")
        db = dbs[0]
    uid = _xmlrpc(base, "common", "authenticate", (db, login, key, {}))
    if not uid:
        raise PermissionError("the key was refused")
    users = _xmlrpc(base, "object", "execute_kw", (db, uid, key, "res.users", "search_read", [[["share", "=", False]]],
                                                   {"fields": ["id", "login", "active", "login_date", "create_date"], "context": {"active_test": False}, "limit": 500}))
    admins = set()
    for u in users[:500]:
        if _xmlrpc(base, "object", "execute_kw", (db, uid, key, "res.users", "has_group", [[u["id"]], "base.group_system"])):
            admins.add(u["id"])
    return parse_odoo_users(users, admins)


LISTERS = {"gitea": list_gitea, "forgejo": list_gitea, "odoo": list_odoo}


class Accounts(Collector):
    id = "probe.accounts"

    def collect(self) -> dict:
        jobs = self.config.get("app_accounts") or []
        if not jobs:
            return {"observations": [], "note": "no app access keys given"}
        mine = local_ips()  # v4: apps on this server only
        obs = []
        for j in jobs:
            key, kind, base, token = str(j.get("app_key", "")), str(j.get("kind", "")), str(j.get("base_url", "")).rstrip("/"), str(j.get("token", ""))
            host = urllib.parse.urlparse(base).hostname or ""
            allowed = host in mine
            status = {"app_key": key, "ok": False, "error": "", "count": 0}
            if not allowed or kind not in LISTERS or not token:
                status["error"] = "not allowed from this monitor" if not allowed else "this app's accounts can't be listed"
            else:
                try:
                    accounts = LISTERS[kind](base, token)
                    for a in accounts:
                        obs.append({"kind": "app.account", "subject": f"{key}|{a['login']}", "data": dict(a, app_key=key)})
                    status.update(ok=True, count=len(accounts))
                except PermissionError as e:
                    status["error"] = str(e)
                except (OSError, ValueError) as e:
                    status["error"] = f"couldn't list accounts ({type(e).__name__})"
            obs.append({"kind": "app.accounts_status", "subject": key, "data": status})
        return {"observations": obs}
