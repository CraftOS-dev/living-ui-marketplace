"""Small helpers shared by collectors. Commands never raise: they return (code, output)."""

from __future__ import annotations

import ctypes
import json
import os
import platform
import shutil
import subprocess

SYSTEM = platform.system().lower()  # 'linux' | 'windows' | 'darwin'


def run(args: list[str], timeout: int = 30, encoding: str | None = None) -> tuple[int, str]:
    """Run a command; (127, '') if missing, (124, '') on timeout. Output is text."""
    kwargs = {}
    if encoding:
        kwargs["encoding"] = encoding
    if SYSTEM == "windows":
        kwargs["creationflags"] = 0x08000000  # CREATE_NO_WINDOW: never flash a console
    try:
        p = subprocess.run(args, capture_output=True, text=True, errors="replace", timeout=timeout, **kwargs)
        return p.returncode, p.stdout
    except FileNotFoundError:
        return 127, ""
    except subprocess.TimeoutExpired:
        return 124, ""
    except OSError:
        return 126, ""


def powershell_json(script: str, timeout: int = 60):
    """Run a PowerShell snippet ending in ConvertTo-Json; returns parsed JSON or None."""
    # UTF-8 both ways: Windows' names in other languages (and "é") arrive as they are (v4 §17).
    script = "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); " + script
    code, out = run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], timeout, encoding="utf-8")
    if code != 0 or not out.strip():
        return None
    try:
        return json.loads(out)
    except ValueError:
        return None


def as_list(value) -> list:
    """PowerShell's ConvertTo-Json returns an object for one item and an array for many."""
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def which(name: str) -> bool:
    return shutil.which(name) is not None


def is_admin() -> bool:
    try:
        if SYSTEM == "windows":
            return bool(ctypes.windll.shell32.IsUserAnAdmin())
        return os.geteuid() == 0
    except Exception:
        return False


def read_text(path: str) -> str | None:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return None
