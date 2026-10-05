"""The terminal (v4 plan §6, N-B20): a real shell on THIS server, opened by an admin from NetSentry.

Guards, in order:
  1. Off unless switched on HERE: NETSENTRY_TERMINAL=on in the monitor's environment (the installer
     asks). The console can never turn it on.
  2. Runs as NETSENTRY_TERMINAL_USER (the installer's sudo user) — root only when set to root.
  3. The console starts a session only after a fresh password check, and only for an admin.
  4. Recorded: the output (masked like logs) goes to the console as the transcript. Typed input is
     never recorded on its own — what the shell echoes is in the output, and a password typed while
     the terminal doesn't echo is never seen.
  5. 15 minutes without typing, or 4 hours in all, and it closes.

Bytes go monitor ⇄ console over the same connection as everything else, in ~60 ms batches.
Windows: PowerShell, line by line (no full-screen programs) — said on screen.
"""

from __future__ import annotations

import base64
import os
import re
import select
import signal
import subprocess
import threading
import time

from .client import ConsoleError
from .util import SYSTEM

IDLE_SECONDS = 15 * 60
MAX_SECONDS = 4 * 3600
TICK = 0.05          # at most ~20 sends a second while output flows
IDLE_WAIT_MS = 900   # nothing to send: the console holds the request until the admin types (or this passes)
ROUTE = "/api/netsentry/terminal/exchange"
MAX_CHUNK = 65536
ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[=>]|\r")


def enabled() -> bool:
    return os.environ.get("NETSENTRY_TERMINAL", "").strip().lower() in ("1", "on", "true", "yes")


def run_as() -> str:
    return os.environ.get("NETSENTRY_TERMINAL_USER", "").strip()


def capability() -> dict:
    if not enabled():
        return {"available": False, "reason": "the terminal is off on this server (set NETSENTRY_TERMINAL=on for the monitor to allow it)"}
    user = run_as()
    if SYSTEM == "windows":
        return {"available": True, "user": user or os.environ.get("USERNAME", ""), "mode": "line"}
    if not user:
        return {"available": False, "reason": "set NETSENTRY_TERMINAL_USER to the account the terminal runs as (the installer does)"}
    try:
        import pwd
        pwd.getpwnam(user)
    except (KeyError, ImportError):
        return {"available": False, "reason": f"the account {user} doesn't exist on this server"}
    return {"available": True, "user": user, "mode": "pty"}


# Where you are, after every line (PowerShell without a console prints no prompt of its own).
WIN_PROMPT = b"[Console]::Out.Write('PS ' + $PWD.Path + '> '); [Console]::Out.Flush()\n"


def _oem_codepage() -> str:
    """Windows' console code page for programs without a console (e.g. cp850, cp437)."""
    try:
        import ctypes
        return f"cp{ctypes.windll.kernel32.GetOEMCP()}"
    except Exception:
        return "cp437"


def transcript_text(raw: bytes) -> str:
    """What the transcript keeps of some output: control sequences gone, secrets hidden."""
    from .logs import mask_all
    text = ANSI.sub("", raw.decode("utf-8", "replace"))
    text = "".join(ch for ch in text if ch in "\n\t" or ord(ch) >= 32)
    return "\n".join(mask_all(text.split("\n")))


class Session(threading.Thread):
    def __init__(self, sid: str, client, cols: int, rows: int, log=print, on_end=None):
        super().__init__(name=f"netsentry-terminal-{sid[:6]}", daemon=True)
        self.sid, self.client, self.log, self.on_end = sid, client, log, on_end
        self.cols, self.rows = max(20, min(400, int(cols or 100))), max(5, min(200, int(rows or 30)))
        self.fd = -1
        self.pid = 0
        self.proc: subprocess.Popen | None = None
        self.started = time.time()
        self.last_input = time.time()
        self._win_out: list[bytes] = []
        self._win_lock = threading.Lock()
        self.ended = False  # the shell is gone (its last output is still sent)

    # ------------------------------------------------------------ start
    def _start_pty(self) -> None:
        import pty
        import pwd
        user = pwd.getpwnam(run_as())
        pid, fd = pty.fork()
        if pid == 0:  # the child: become the user, start a login shell
            try:
                if os.geteuid() == 0:
                    os.initgroups(user.pw_name, user.pw_gid)
                    os.setgid(user.pw_gid)
                    os.setuid(user.pw_uid)
                elif os.geteuid() != user.pw_uid:
                    os.write(2, b"NetSentry: the monitor isn't root, so it can only open a terminal as its own account.\r\n")
                    os._exit(1)
                shell = user.pw_shell if user.pw_shell and os.path.exists(user.pw_shell) and not user.pw_shell.endswith(("nologin", "false")) else "/bin/sh"
                env = {"HOME": user.pw_dir, "USER": user.pw_name, "LOGNAME": user.pw_name, "SHELL": shell, "TERM": "xterm-256color",
                       "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "LANG": os.environ.get("LANG", "C.UTF-8")}
                os.chdir(user.pw_dir if os.path.isdir(user.pw_dir) else "/")
                os.execve(shell, [f"-{os.path.basename(shell)}"], env)
            except Exception as e:  # never return into the monitor's code
                os.write(2, f"NetSentry: could not start the shell: {e}\r\n".encode())
                os._exit(1)
        self.pid, self.fd = pid, fd
        self._resize(self.cols, self.rows)

    def _start_line(self) -> None:
        self.proc = subprocess.Popen(["powershell", "-NoLogo", "-NoExit", "-Command", "-"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                     creationflags=0x08000000)

        def pump():
            assert self.proc and self.proc.stdout
            while True:
                b = self.proc.stdout.read1(4096) if hasattr(self.proc.stdout, "read1") else self.proc.stdout.read(1)
                if not b:
                    break
                with self._win_lock:
                    self._win_out.append(b)

        threading.Thread(target=pump, daemon=True).start()
        # Output as UTF-8, so names with accents (and the box-drawing of some commands) arrive intact.
        self.proc.stdin.write(b"try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}; $OutputEncoding = New-Object System.Text.UTF8Encoding($false)\n")
        self.proc.stdin.write(WIN_PROMPT)
        self.proc.stdin.flush()

    def _resize(self, cols: int, rows: int) -> None:
        if self.fd < 0:
            return
        import fcntl
        import struct
        import termios
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

    # ------------------------------------------------------------ loop
    def _read(self, wait: float = 0) -> bytes:
        if SYSTEM == "windows":
            if wait:
                time.sleep(wait)
            with self._win_lock:
                data, self._win_out = b"".join(self._win_out), []
            return data
        out = b""
        first = True
        while len(out) < MAX_CHUNK and not self.ended:
            r, _, _ = select.select([self.fd], [], [], wait if first else 0)
            first = False
            if not r:
                break
            try:
                chunk = os.read(self.fd, 16384)
            except OSError:
                chunk = b""
            if not chunk:
                self.ended = True  # what was read before the end is kept and sent (it was lost: v4 walk)
                break
            out += chunk
        return out

    def _alive(self) -> bool:
        if SYSTEM == "windows":
            return bool(self.proc and self.proc.poll() is None)
        try:
            pid, _ = os.waitpid(self.pid, os.WNOHANG)
            return pid == 0
        except ChildProcessError:
            return False

    def _write(self, data: bytes) -> None:
        if SYSTEM == "windows":
            if self.proc and self.proc.stdin:
                # PowerShell reads what it's given in Windows' own (OEM) code page, whatever is set later:
                # send typed text in it, so "café" arrives as "café" (output comes back as UTF-8).
                text = data.decode("utf-8", "replace").replace("\r\n", "\n").replace("\r", "\n")
                self.proc.stdin.write(text.encode(_oem_codepage(), "replace"))
                if text.endswith("\n"):
                    self.proc.stdin.write(WIN_PROMPT)
                self.proc.stdin.flush()
            return
        os.write(self.fd, data)

    def _exchange(self, out: bytes, closed: bool = False, reason: str = "", wait_ms: int = 0) -> dict:
        from .client import ConsoleError
        body = {"session_id": self.sid, "out": base64.b64encode(out).decode() if out else "", "transcript": transcript_text(out) if out else "", "wait_ms": wait_ms}
        if closed:
            body.update(closed=True, reason=reason)
        # A dropped connection or a busy console mustn't end the session (or lose its output): try again for ~8 s.
        for pause in (0.5, 1, 2, 4, 0):
            try:
                return self.client.post(ROUTE, body) or {}
            except ConsoleError as e:
                if e.status not in (429, 500, 502, 503, 504) or not pause:
                    raise
            except OSError:
                if not pause:
                    raise
            time.sleep(pause)
        return {}

    def run(self) -> None:
        reason = "the shell ended (exit)"
        try:
            self._start_line() if SYSTEM == "windows" else self._start_pty()
            banner = (f"\x1b[2mNetSentry terminal on this server as {run_as() or 'this account'} — recorded. "
                      f"Closes after 15 min without typing.{' (Windows: line by line.)' if SYSTEM == 'windows' else ''}\x1b[0m\r\n").encode()
            self._exchange(banner)
            typed = False
            while True:
                if time.time() - self.last_input > IDLE_SECONDS:
                    reason = "closed after 15 minutes without typing"
                    break
                if time.time() - self.started > MAX_SECONDS:
                    reason = "closed after 4 hours (the longest a terminal stays open)"
                    break
                # Just typed: give the shell a moment to echo, so the echo goes back at once.
                out = self._read(0.03 if typed else 0)
                resp = self._exchange(out, wait_ms=0 if out or self.ended else IDLE_WAIT_MS)
                if self.ended:
                    reason = "the shell ended (exit)"
                    break
                typed = False
                for chunk in resp.get("input") or []:
                    self.last_input = time.time()
                    self._write(base64.b64decode(chunk))
                    typed = True
                size = resp.get("resize")
                if size and SYSTEM != "windows":
                    self._resize(int(size.get("cols") or self.cols), int(size.get("rows") or self.rows))
                if resp.get("close"):
                    reason = "closed in NetSentry"
                    break
                if not self._alive():
                    rest = self._read()
                    if rest:
                        self._exchange(rest)
                    reason = "the shell ended (exit)"
                    break
                if out and not typed:
                    time.sleep(TICK)  # output is flowing: gather it in batches
        except (OSError, ConsoleError) as e:
            reason = "the connection to NetSentry was lost"
            self.log(f"[terminal {self.sid}] {e}")
        except Exception as e:
            reason = "something went wrong on the server (see the monitor's log)"
            self.log(f"[terminal {self.sid}] {type(e).__name__}: {e}")
        finally:
            self._stop()
            try:
                self._exchange(b"", closed=True, reason=reason)
            except Exception:
                pass
            if self.on_end:
                self.on_end(self.sid)

    def _stop(self) -> None:
        if SYSTEM == "windows":
            if self.proc and self.proc.poll() is None:
                self.proc.kill()
            return
        if self.pid:
            try:
                os.killpg(os.getpgid(self.pid), signal.SIGHUP)
            except OSError:
                pass
            for _ in range(10):
                if not self._alive():
                    break
                time.sleep(0.1)
            else:
                try:
                    os.killpg(os.getpgid(self.pid), signal.SIGKILL)
                except OSError:
                    pass
                try:
                    os.waitpid(self.pid, 0)
                except ChildProcessError:
                    pass
        if self.fd >= 0:
            try:
                os.close(self.fd)
            except OSError:
                pass


# ------------------------------------------------------------------ command.run (§8, N-B21)

class CommandFailed(Exception):
    pass


def command_run(params: dict) -> dict:
    """An exact command a person confirmed (often prepared by the agent): runs as root, output recorded masked."""
    if not enabled():
        raise CommandFailed("commands are off on this server (they come with the terminal: NETSENTRY_TERMINAL=on)")
    argv = params.get("argv")
    if not isinstance(argv, list) or not 1 <= len(argv) <= 64 or any(not isinstance(a, str) or "\x00" in a or len(a) > 4000 for a in argv):
        raise CommandFailed("refused: not a command")
    timeout = int(params.get("timeout") or 120)
    if not 1 <= timeout <= 600:
        raise CommandFailed("refused: a command runs for 10 minutes at most")
    cwd = str(params.get("cwd") or "") or None
    if cwd and (not os.path.isabs(cwd) or not os.path.isdir(cwd)):
        raise CommandFailed("refused: the folder to run it in doesn't exist")
    from .logs import mask_all
    try:
        r = subprocess.run(argv, capture_output=True, text=True, errors="replace", timeout=timeout, cwd=cwd, stdin=subprocess.DEVNULL)
    except FileNotFoundError as e:
        raise CommandFailed(f"there is no program {argv[0]} on this server") from e
    except subprocess.TimeoutExpired as e:
        raise CommandFailed(f"it was still running after {timeout} s, so it was stopped") from e
    lines = mask_all(((r.stdout or "") + (r.stderr or "")).splitlines())[-120:]
    tail = "\n".join(lines)[-3500:]
    if r.returncode != 0:
        raise CommandFailed(f"it ended with exit code {r.returncode}:\n{tail}")
    return {"exit": 0, "note": f"exit code 0\n{tail}" if tail else "exit code 0 (no output)"}
