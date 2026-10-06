"""Answers to what a person (or the agent) asked to see on THIS server (v4 plan N-B9).

One road for every "look": the console queues a request, the monitor answers at check-in, the
answer lives two minutes in the console's memory. Each kind is checked here too, and errors come
back as words, never as a crash.
"""

from __future__ import annotations

from . import compose, disk, files, firewall, keys, procs, remote_access, schedules

KINDS = {
    "files.list": lambda p: files.list_dir(str(p.get("path", ""))),
    "files.read": lambda p: files.read_file(str(p.get("path", ""))),
    "app.settings": compose.settings,
    "compose.check": compose.check,
    "disk.usage": disk.usage,
    "process.list": procs.listing,
    "firewall.status": firewall.status,
    "users.list": keys.listing,
    "schedule.list": schedules.listing,
    "remote.tailscale_login": remote_access.login,
}

KINDS["files.download"] = None  # answered with the client (below)

KNOWN_ERRORS = (files.FilesFailed, compose.ComposeFailed, disk.CleanupFailed, procs.ProcFailed, firewall.FirewallFailed,
                keys.KeysFailed, schedules.ScheduleFailed, remote_access.RemoteFailed)


def answer(request: dict, client=None) -> tuple[dict | None, str]:
    kind = str(request.get("kind", ""))
    fn = KINDS.get(kind)
    if kind == "files.download" and client is not None:
        # the file itself goes to NetSentry as a file, for the person who asked (never through this answer)
        rid = str(request.get("id", ""))
        fn = lambda p: files.download(str(p.get("path", "")), lambda name, data: client.send_transfer(name, data, rid))
    if not fn:
        return None, "this monitor doesn't know how to answer that (update it: run its installer again)"
    params = request.get("params") if isinstance(request.get("params"), dict) else {}
    try:
        return fn(params), ""
    except KNOWN_ERRORS as e:
        return None, str(e)[:400]
    except PermissionError:
        return None, "the monitor isn't allowed to read that (it needs to run as root / an administrator)"
    except Exception as e:  # report why, never crash the monitor
        return None, f"{type(e).__name__}: {e}"[:400]
