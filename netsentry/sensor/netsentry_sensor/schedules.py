"""Scheduled jobs on THIS server (v4 plan §7.9): cron lines, systemd timers, Windows tasks — in
words, with Pause and Resume.

Pausing a cron line comments it out with a "#netsentry-paused " marker in its own file (Resume
removes the marker); a timer is disabled and stopped; a Windows task is disabled. NetSentry's own
jobs are never paused here.

A new job (v4 §17, N-B42) is made only in NetSentry's own place — /etc/cron.d/made-in-netsentry-<name>
(as root) or the Task Scheduler folder \\Made in NetSentry\\ (as SYSTEM) — and only those are deleted
here. Running a command on a schedule is running a command, so it comes with the terminal: off unless
NETSENTRY_TERMINAL is on at the server.
"""

from __future__ import annotations

import base64
import glob
import hashlib
import os
import re

from .util import SYSTEM, as_list, powershell_json, read_text, run, which

PAUSED = "#netsentry-paused "
DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
SPECIAL = {"@reboot": "when the server starts", "@yearly": "once a year", "@annually": "once a year", "@monthly": "once a month",
           "@weekly": "once a week", "@daily": "every day at midnight", "@midnight": "every day at midnight", "@hourly": "every hour"}


class ScheduleFailed(Exception):
    pass


def words(schedule: str) -> str:
    """A cron schedule in plain words (the common shapes; anything else as written)."""
    s = schedule.strip()
    if s in SPECIAL:
        return SPECIAL[s]
    f = s.split()
    if len(f) != 5:
        return s
    mi, h, dom, mon, dow = f
    at = f"at {int(h):02d}:{int(mi):02d}" if mi.isdigit() and h.isdigit() else ""
    if m := re.fullmatch(r"\*/(\d+)", mi):
        if h == dom == mon == dow == "*":
            return f"every {m.group(1)} minutes"
    if mi.isdigit() and h == "*" and dom == mon == dow == "*":
        return f"every hour at :{int(mi):02d}"
    if mi.isdigit() and (m := re.fullmatch(r"\*/(\d+)", h)) and dom == mon == dow == "*":
        return f"every {m.group(1)} hours at :{int(mi):02d}"
    if at and dom == mon == "*" and dow == "*":
        return f"every day {at}"
    if at and dom == mon == "*" and dow.isdigit() and 0 <= int(dow) <= 7:
        return f"every {DAYS[int(dow) % 7]} {at}"
    if at and dom.isdigit() and mon == dow == "*":
        return f"on day {dom} of every month {at}"
    return s


def _cron_files() -> list[tuple[str, bool]]:
    """(path, has a user column)."""
    out = [("/etc/crontab", True)] + [(p, True) for p in sorted(glob.glob("/etc/cron.d/*")) if os.path.isfile(p)]
    for d in ("/var/spool/cron/crontabs", "/var/spool/cron", "/etc/crontabs"):  # Debian, Red Hat, Alpine
        out += [(p, False) for p in sorted(glob.glob(os.path.join(d, "*"))) if os.path.isfile(p)]
    return [(p, u) for p, u in out if not os.path.basename(p).startswith(".")]


def _line_id(path: str, line: str) -> str:
    return hashlib.sha256(f"{path}\n{line}".encode()).hexdigest()[:16]


def parse_cron(path: str, text: str, user_column: bool) -> list[dict]:
    from .logs import mask
    out = []
    owner = "" if user_column else os.path.basename(path)
    made = _is_made_file(path)
    title = re.search(r"^# Made in NetSentry: (.+)$", text, re.M) if made else None
    for raw in text.splitlines():
        s = raw.strip()
        paused = s.startswith(PAUSED)
        if paused:
            s = s[len(PAUSED):].strip()
        if not s or s.startswith("#") or re.match(r"^[A-Za-z_][A-Za-z0-9_]*\s*=", s):
            continue
        parts = s.split()
        if parts[0].startswith("@"):
            sched, rest = parts[0], parts[1:]
        elif len(parts) >= 6:
            sched, rest = " ".join(parts[:5]), parts[5:]
        else:
            continue
        user = owner
        if user_column and rest:
            user, rest = rest[0], rest[1:]
        command = " ".join(rest)
        out.append({"kind": "cron", "id": _line_id(path, s), "file": path, "user": user, "schedule": sched, "when": words(sched),
                    "command": mask(command.replace("\\%", "%"))[:240], "paused": paused, "ours": "netsentry" in command.lower(),
                    "made": made, "name": title.group(1).strip() if title else ""})
    return out


def _timers() -> list[dict]:
    # systemd must actually be running (its unit files can exist in a container without it)
    if not which("systemctl") or not os.path.isdir("/run/systemd/system"):
        return []
    code, out = run(["systemctl", "list-unit-files", "--type=timer", "--no-legend", "--no-pager"], timeout=30)
    names = [line.split()[0] for line in out.splitlines() if code == 0 and line.split() and line.split()[0].endswith(".timer")][:60]
    rows = []
    for n in names:
        _, info = run(["systemctl", "show", n, "-p", "Description,UnitFileState,ActiveState,Unit,NextElapseUSecRealtime,LastTriggerUSec", "--no-pager"], timeout=15)
        kv = dict(line.split("=", 1) for line in info.splitlines() if "=" in line)
        rows.append({"kind": "timer", "id": n, "unit": n, "description": kv.get("Description", ""), "runs": kv.get("Unit", ""),
                     "next": kv.get("NextElapseUSecRealtime", ""), "last": kv.get("LastTriggerUSec", ""),
                     "paused": kv.get("UnitFileState") in ("disabled", "masked") or kv.get("ActiveState") != "active",
                     "state": kv.get("UnitFileState", ""), "ours": "netsentry" in n.lower()})
    return rows


WIN_TASKS = (
    "Get-ScheduledTask | Where-Object { $_.TaskPath -notlike '\\Microsoft\\*' } | Select-Object -First 80 | ForEach-Object { "
    "[pscustomobject]@{ n = $_.TaskName; p = $_.TaskPath; s = [string]$_.State; d = $_.Description; "
    "t = @($_.Triggers | ForEach-Object { [pscustomobject]@{ k = $_.CimClass.CimClassName; b = $_.StartBoundary; i = $_.Repetition.Interval; "
    "w = $_.DaysOfWeek; v = $_.DaysInterval; e = $_.Enabled } }) } } | ConvertTo-Json -Compress -Depth 4"
)


def _duration_words(iso: str) -> str:
    """PT15M → '15 minutes', PT1H → 'hour'."""
    m = re.fullmatch(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", iso or "")
    if not m or not any(m.groups()):
        return ""
    d, h, mi, _ = (int(x or 0) for x in m.groups())
    if d:
        return "day" if d == 1 and not h and not mi else f"{d} days"
    if h and not mi:
        return "hour" if h == 1 else f"{h} hours"
    return f"{h * 60 + mi} minutes"


def task_when(triggers: list) -> str:
    """A Windows task's triggers in plain words."""
    out = []
    for t in triggers:
        if t.get("e") is False:
            continue
        kind, start = str(t.get("k") or ""), str(t.get("b") or "")
        at = start[11:16] if len(start) >= 16 else ""
        every = _duration_words(str(t.get("i") or ""))
        if kind.endswith("BootTrigger"):
            out.append("when the computer starts")
        elif kind.endswith("LogonTrigger"):
            out.append("when someone signs in")
        elif kind.endswith("DailyTrigger"):
            n = int(t.get("v") or 1)
            out.append(("every day" if n == 1 else f"every {n} days") + (f" at {at}" if at else "") + (f", then every {every}" if every else ""))
        elif kind.endswith("WeeklyTrigger"):
            mask = int(t.get("w") or 0)
            days = [DAYS[i] for i in range(7) if mask & (1 << i)]
            on = "every day" if len(days) == 7 else f"every {' and '.join(days)}" if len(days) <= 2 else f"weekly on {', '.join(d[:3] for d in days)}"
            out.append(on + (f" at {at}" if at else ""))
        elif kind.endswith("TimeTrigger"):
            out.append(f"every {every}" if every else f"once, on {start[:10]}" + (f" at {at}" if at else ""))
        elif kind.endswith("IdleTrigger"):
            out.append("when the computer is idle")
        elif kind.endswith("EventTrigger"):
            out.append("when Windows logs a certain event")
        elif kind.endswith("SessionStateChangeTrigger"):
            out.append("when someone locks, unlocks or connects")
        elif kind.endswith("RegistrationTrigger"):
            out.append("when it was set up")
        elif kind:
            out.append("on its own trigger")
    return "; ".join(dict.fromkeys(out)) or "only when started by hand"


def create_capability() -> dict:
    """Whether a new job can be made here, and as whom."""
    from . import terminal
    if SYSTEM not in ("linux", "windows"):
        return {"available": False, "reason": "New scheduled jobs are made on Linux and Windows."}
    if not terminal.enabled():
        return {"available": False, "reason": "Making a job means running a command on a schedule, so it comes with the terminal — switched on at the server itself (NETSENTRY_TERMINAL=on)."}
    if SYSTEM == "linux" and not (os.path.isdir(CRON_D) and (which("cron") or which("crond"))):
        return {"available": False, "reason": "This server has no cron to run it (install cron, then try again)."}
    return {"available": True, "runs_as": "SYSTEM" if SYSTEM == "windows" else "root", "shell": "PowerShell" if SYSTEM == "windows" else "sh"}


def listing(params: dict | None = None) -> dict:
    if SYSTEM == "windows":
        rows = as_list(powershell_json(WIN_TASKS))
        return {"create": create_capability(), "jobs": [{
            "kind": "task", "id": f"{r.get('p')}{r.get('n')}", "name": r.get("n"), "path": r.get("p"),
            "when": task_when(as_list(r.get("t"))), "description": str(r.get("d") or "")[:200],
            "paused": str(r.get("s")) in ("1", "Disabled"), "ours": "netsentry" in str(r.get("n")).lower(), "made": r.get("p") == MADE_FOLDER,
        } for r in rows]}
    if SYSTEM != "linux":
        return {"jobs": [], "why_not": "Scheduled jobs are listed on Linux and Windows."}
    jobs = []
    for path, user_column in _cron_files():
        text = read_text(path)
        if text is not None:
            jobs += parse_cron(path, text, user_column)
    return {"create": create_capability(), "jobs": _timers() + jobs}


def _rewrite_cron(path: str, line_id: str, pause: bool) -> None:
    if path not in [p for p, _ in _cron_files()]:
        raise ScheduleFailed("refused: that isn't one of this server's cron files")
    text = read_text(path)
    if text is None:
        raise ScheduleFailed("the monitor may not read that file")
    out, found = [], False
    for raw in text.splitlines():
        s = raw.strip()
        paused = s.startswith(PAUSED)
        bare = s[len(PAUSED):].strip() if paused else s
        if not found and bare and _line_id(path, bare) == line_id:
            if "netsentry" in bare.lower():
                raise ScheduleFailed("refused: that is NetSentry's own job")
            found = True
            out.append(PAUSED + bare if pause else bare)
            continue
        out.append(raw)
    if not found:
        raise ScheduleFailed("that job isn't in the file any more")
    st = os.stat(path)
    tmp = path + ".netsentry"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")
    os.chmod(tmp, st.st_mode & 0o7777)
    if hasattr(os, "chown"):
        os.chown(tmp, st.st_uid, st.st_gid)
    os.replace(tmp, path)  # a new file: cron sees its folder changed and reads it again


def set_paused(params: dict) -> dict:
    kind, pause = str(params.get("kind", "")), bool(params.get("pause"))
    verb = "paused" if pause else "resumed"
    if kind == "cron":
        _rewrite_cron(str(params.get("file", "")), str(params.get("id", "")), pause)
        return {"kind": kind, "file": params["file"], "id": params["id"], "pause": pause, "note": f"{verb} a job in {params['file']}"}
    if kind == "timer":
        unit = str(params.get("unit", ""))
        if not re.fullmatch(r"[A-Za-z0-9@_.:-]{1,120}\.timer", unit) or "netsentry" in unit.lower():
            raise ScheduleFailed("refused: not a timer NetSentry may pause")
        code, out = run(["systemctl", "disable" if pause else "enable", "--now", unit], timeout=60)
        if code != 0:
            raise ScheduleFailed(f"systemctl couldn't {'pause' if pause else 'resume'} {unit}")
        return {"kind": kind, "unit": unit, "pause": pause, "note": f"{verb} {unit}"}
    if kind == "task":
        name, path = str(params.get("name", "")), str(params.get("path", "\\"))
        if not re.fullmatch(r"[^'\"`$;|&<>]{1,200}", name) or not re.fullmatch(r"\\[^'\"`$;|&<>]{0,200}", path) or path.startswith("\\Microsoft\\") or "netsentry" in name.lower():
            raise ScheduleFailed("refused: not a task NetSentry may pause")
        verb_ps = "Disable-ScheduledTask" if pause else "Enable-ScheduledTask"
        code, _ = run(["powershell", "-NoProfile", "-NonInteractive", "-Command", f"{verb_ps} -TaskName '{name}' -TaskPath '{path}' -ErrorAction Stop | Out-Null"], timeout=60)
        if code != 0:
            raise ScheduleFailed(f"Windows refused to {'pause' if pause else 'resume'} {name}")
        return {"kind": kind, "name": name, "path": path, "pause": pause, "note": f"{verb} {name}"}
    raise ScheduleFailed("refused: not a kind of scheduled job")


def set_paused_undo(saved: dict) -> None:
    again = dict(saved, pause=not saved.get("pause"))
    if saved.get("kind") == "cron":
        _rewrite_cron(saved["file"], saved["id"], not saved.get("pause"))
    else:
        set_paused(again)


# ------------------------------------------------------------------ a new job (v4 §17, N-B42)

CRON_D = "/etc/cron.d"
MADE_PREFIX = "made-in-netsentry-"  # cron.d runs only files named [A-Za-z0-9_-]: never a dot
MADE_FOLDER = "\\Made in NetSentry\\"
NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9 _.()-]{0,59}")
EVERY_MINUTES = (5, 10, 15, 30)


def _is_made_file(path: str) -> bool:
    base = os.path.basename(path)
    return os.path.dirname(path) == CRON_D and base.startswith(MADE_PREFIX) and re.fullmatch(r"[a-z0-9-]{1,80}", base) is not None


def _q(text: str) -> str:
    """A PowerShell single-quoted string."""
    return "'" + str(text).replace("'", "''") + "'"


def _ps(script: str, timeout: int = 60) -> tuple[int, str]:
    return run(["powershell", "-NoProfile", "-NonInteractive", "-Command",
                "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); $ErrorActionPreference = 'Stop'; " + script],
               timeout, encoding="utf-8")


def _int(value, low: int, high: int, what: str) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        raise ScheduleFailed(f"refused: {what}") from None
    if not low <= n <= high:
        raise ScheduleFailed(f"refused: {what}")
    return n


def check_when(when) -> dict:
    """The few schedules people pick from (anything else belongs in the terminal)."""
    w = when if isinstance(when, dict) else {}
    every = str(w.get("every", ""))
    if every == "minutes":
        n = _int(w.get("n"), 1, 60, "every 5, 10, 15 or 30 minutes")
        if n not in EVERY_MINUTES:
            raise ScheduleFailed("refused: every 5, 10, 15 or 30 minutes")
        return {"every": every, "n": n}
    if every == "hour":
        return {"every": every, "minute": _int(w.get("minute", 0), 0, 59, "a minute is 0–59")}
    if every in ("day", "week"):
        m = re.fullmatch(r"([01]\d|2[0-3]):([0-5]\d)", str(w.get("at", "")))
        if not m:
            raise ScheduleFailed("refused: a time is HH:MM")
        out = {"every": every, "at": m.group(0)}
        if every == "week":
            out["day"] = _int(w.get("day"), 0, 6, "a day is 0 (Sunday) to 6 (Saturday)")
        return out
    if every == "start":
        return {"every": every}
    raise ScheduleFailed("refused: not a schedule NetSentry makes")


def when_words(w: dict) -> str:
    e = w["every"]
    if e == "minutes":
        return f"every {w['n']} minutes"
    if e == "hour":
        return f"every hour at :{w['minute']:02d}"
    if e == "day":
        return f"every day at {w['at']}"
    if e == "week":
        return f"every {DAYS[w['day']]} at {w['at']}"
    return "when the server starts"


def cron_expr(w: dict) -> str:
    e = w["every"]
    if e == "minutes":
        return f"*/{w['n']} * * * *"
    if e == "hour":
        return f"{w['minute']} * * * *"
    if e in ("day", "week"):
        h, m = w["at"].split(":")
        return f"{int(m)} {int(h)} * * {w['day'] if e == 'week' else '*'}"
    return "@reboot"


def task_trigger(w: dict) -> str:
    e = w["every"]
    if e == "minutes":  # no -RepetitionDuration: it repeats for ever
        return f"New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes {w['n']})"
    if e == "hour":
        return f"New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddMinutes({w['minute']}) -RepetitionInterval (New-TimeSpan -Hours 1)"
    if e == "day":
        return f"New-ScheduledTaskTrigger -Daily -At '{w['at']}'"
    if e == "week":
        return f"New-ScheduledTaskTrigger -Weekly -DaysOfWeek {DAYS[w['day']]} -At '{w['at']}'"
    return "New-ScheduledTaskTrigger -AtStartup"


def _check(params: dict) -> tuple[str, str, dict]:
    name = str(params.get("name", "")).strip()
    if not NAME.fullmatch(name) or "netsentry" in name.lower():
        raise ScheduleFailed("refused: a name is up to 60 letters, numbers, spaces and - _ . ( ) — and not NetSentry's own")
    command = str(params.get("command", "")).strip()
    if not 1 <= len(command) <= 1000 or any(c in command for c in "\0\r\n"):
        raise ScheduleFailed("refused: a command is one line, up to 1000 characters")
    return name, command, check_when(params.get("when"))


def create(params: dict) -> dict:
    """Make a job that runs one command on a schedule — as root (cron) or SYSTEM (Task Scheduler)."""
    cap = create_capability()
    if not cap["available"]:
        raise ScheduleFailed(f"refused: {cap['reason']}")
    name, command, when = _check(params)
    note = f"made “{name}”: {when_words(when)}"
    if SYSTEM == "windows":
        encoded = base64.b64encode(command.encode("utf-16-le")).decode()  # never re-quoted: runs exactly as typed
        code, _ = _ps(
            f"if (Get-ScheduledTask -TaskName {_q(name)} -TaskPath {_q(MADE_FOLDER)} -ErrorAction SilentlyContinue) {{ exit 3 }}; "
            f"$a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand {encoded}'; "
            f"$t = {task_trigger(when)}; "
            "$p = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest; "
            "$s = New-ScheduledTaskSettingsSet -StartWhenAvailable; "
            f"Register-ScheduledTask -TaskName {_q(name)} -TaskPath {_q(MADE_FOLDER)} -Action $a -Trigger $t -Principal $p -Settings $s "
            f"-Description {_q(('Made in NetSentry: ' + command)[:1000])} | Out-Null")
        if code == 3:
            raise ScheduleFailed(f"a job called “{name}” is already there")
        if code != 0:
            raise ScheduleFailed("Windows refused to make the job")
        return {"kind": "task", "name": name, "path": MADE_FOLDER, "note": note}
    path = os.path.join(CRON_D, MADE_PREFIX + (re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "job"))
    if os.path.exists(path):
        raise ScheduleFailed(f"a job called “{name}” is already there")
    text = (f"# Made in NetSentry: {name}\n# Runs {when_words(when)}, as root. Delete it in NetSentry (Server → Scheduled jobs).\n"
            "SHELL=/bin/sh\nPATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n"
            f"{cron_expr(when)} root {command.replace('%', chr(92) + '%')}\n")  # cron reads a bare % as a new line
    _put(path, text)
    return {"kind": "cron", "file": path, "note": note}


def _put(path: str, text: str) -> None:
    tmp = path + ".tmp"  # cron ignores a name with a dot, so it never runs half a file
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.chmod(tmp, 0o644)  # cron.d skips files others can write
    os.replace(tmp, path)


def _remove(saved: dict) -> None:
    if saved.get("kind") == "task":
        code, _ = _ps(f"Unregister-ScheduledTask -TaskName {_q(saved['name'])} -TaskPath {_q(MADE_FOLDER)} -Confirm:$false")
        if code != 0:
            raise ScheduleFailed("Windows refused to delete the job")
    elif _is_made_file(saved.get("file", "")):
        try:
            os.remove(saved["file"])
        except FileNotFoundError:
            pass


def create_undo(saved: dict) -> None:
    _remove(saved)


def delete(params: dict) -> dict:
    """Delete a job made in NetSentry (only those: everything else can be paused)."""
    kind = str(params.get("kind", ""))
    if kind == "task":
        name = str(params.get("name", ""))
        if not NAME.fullmatch(name) or str(params.get("path", "")) != MADE_FOLDER:
            raise ScheduleFailed("refused: only jobs made in NetSentry are deleted here — pause the others")
        code, xml = _ps(f"Export-ScheduledTask -TaskName {_q(name)} -TaskPath {_q(MADE_FOLDER)}")
        if code != 0 or "<Task" not in xml:
            raise ScheduleFailed("that job isn't there any more")
        saved = {"kind": "task", "name": name, "xml": xml.strip()}
        _remove(saved)
        return dict(saved, note=f"deleted “{name}”")
    if kind == "cron":
        path = str(params.get("file", ""))
        if not _is_made_file(path):
            raise ScheduleFailed("refused: only jobs made in NetSentry are deleted here — pause the others")
        text = read_text(path)
        if text is None:
            raise ScheduleFailed("that job isn't there any more")
        _remove({"kind": "cron", "file": path})
        return {"kind": "cron", "file": path, "text": text, "note": f"deleted {os.path.basename(path)}"}
    raise ScheduleFailed("refused: not a kind of scheduled job")


def delete_undo(saved: dict) -> None:
    if saved.get("kind") == "task":
        code, _ = _ps(f"Register-ScheduledTask -Xml {_q(saved['xml'])} -TaskName {_q(saved['name'])} -TaskPath {_q(MADE_FOLDER)} | Out-Null")
        if code != 0:
            raise ScheduleFailed("Windows refused to put the job back")
    elif _is_made_file(saved.get("file", "")) and not os.path.exists(saved["file"]):
        _put(saved["file"], saved["text"])
