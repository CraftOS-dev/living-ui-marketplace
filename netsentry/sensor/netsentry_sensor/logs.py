"""The last lines of an app's or a service's log, when a person asks (v3 plan §9).

Read on demand only, never collected in the background, never stored by the
console. Secrets are hidden HERE, before anything leaves the machine:
passwords, tokens, keys and credentials inside URLs become [hidden].
"""

from __future__ import annotations

import re
import struct
import urllib.parse

from .util import SYSTEM, run, which

MAX_LINES = 500
MAX_LINE = 2000

# key=value / key: value where the key looks secret
_SECRET_KV = re.compile(
    r"(?i)\b([A-Za-z0-9_.-]*(?:pass(?:word|wd)?|secret|token|api[_-]?key|apikey|auth|credential|private[_-]?key|session|cookie)[A-Za-z0-9_.-]*)"
    r"(\s*[=:]\s*)(\"[^\"]*\"|'[^']*'|[^\s,;&\"']+)"
)
_BEARER = re.compile(r"(?i)\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{12,}")
_URL_CREDS = re.compile(r"([a-z][a-z0-9+.-]*://)[^/\s:@]+:[^/\s@]+@", re.I)
_PRIVATE_KEY = re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?(-----END [A-Z ]*PRIVATE KEY-----|$)", re.S)
_JWT = re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b")
_LONG_HEX = re.compile(r"\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*[0-9])[0-9a-f]{32,}\b", re.I)
_LONG_B64 = re.compile(r"(?<![A-Za-z0-9+/=_-])[A-Za-z0-9+/_-]{40,}={0,2}(?![A-Za-z0-9+/=_-])")
_AWS_KEY = re.compile(r"\b(AKIA|ASIA)[A-Z0-9]{16}\b")
_PHRASE = re.compile(r"(?i)\b(password|passwd|passphrase|secret|token|api key)( is| was|:)?\s+[\"']?[^\s\"',;]{4,}")


def mask(line: str) -> str:
    """Hide what looks like a secret in one log line."""
    s = _PRIVATE_KEY.sub("[hidden private key]", line)
    s = _URL_CREDS.sub(lambda m: f"{m.group(1)}[hidden]@", s)
    s = _BEARER.sub(lambda m: f"{m.group(1)} [hidden]", s)
    s = _JWT.sub("[hidden]", s)
    s = _AWS_KEY.sub("[hidden]", s)
    s = _SECRET_KV.sub(lambda m: f"{m.group(1)}{m.group(2)}[hidden]", s)
    s = _LONG_HEX.sub("[hidden]", s)
    s = _LONG_B64.sub("[hidden]", s)
    s = _PHRASE.sub(lambda m: f"{m.group(1)}{m.group(2) or ''} [hidden]", s)
    return s[:MAX_LINE]


def mask_all(lines: list[str]) -> list[str]:
    """Mask line by line, and hide everything between a private key's BEGIN and END lines."""
    out, inside = [], False
    for line in lines:
        if "PRIVATE KEY-----" in line and "BEGIN" in line:
            inside = "END" not in line.split("BEGIN", 1)[1]
            out.append("[hidden private key]")
            continue
        if inside:
            if "PRIVATE KEY-----" in line and "END" in line:
                inside = False
            continue
        out.append(mask(line))
    return out


def demux(raw: bytes) -> list[str]:
    """Docker's log stream: 8-byte frames (stream, 0, 0, 0, size) unless the container has a TTY."""
    out, i = [], 0
    if len(raw) >= 8 and raw[0] in (0, 1, 2) and raw[1:4] == b"\x00\x00\x00":
        chunks = []
        while i + 8 <= len(raw):
            size = struct.unpack(">I", raw[i + 4:i + 8])[0]
            chunks.append(raw[i + 8:i + 8 + size])
            i += 8 + size
        raw = b"".join(chunks)
    for line in raw.decode("utf-8", "replace").splitlines():
        out.append(line)
    return out


def container_lines(name: str, lines: int, since: str = "") -> list[str]:
    from .collectors.containers import DockerApi
    from .executor import _container_id
    api = DockerApi()
    if not api.available:
        raise RuntimeError("Docker is not reachable from the monitor")
    cid = _container_id(api, name)
    q = {"stdout": "1", "stderr": "1", "tail": str(lines), "timestamps": "1"}
    if since:
        q["since"] = since
    status, body = api.get(f"/containers/{cid}/logs?{urllib.parse.urlencode(q)}")
    if status != 200:
        raise RuntimeError(f"Docker answered {status}")
    return demux(body)


def service_lines(unit: str, lines: int, since: str = "") -> list[str]:
    if not re.fullmatch(r"[A-Za-z0-9@_.-]{1,120}", unit):
        raise RuntimeError("not a service name")
    if SYSTEM == "linux" and which("journalctl"):
        args = ["journalctl", "-u", unit, "-n", str(lines), "--no-pager", "-o", "short-iso"]
        if since:
            args += ["--since", since.replace("T", " ").rstrip("Z")]
        code, out = run(args, timeout=30)
        if code != 0:
            raise RuntimeError("journalctl could not read it")
        return out.splitlines()
    if SYSTEM == "windows":
        from .util import as_list, powershell_json
        rows = powershell_json(
            "Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Service Control Manager'} -MaxEvents 300 -ErrorAction SilentlyContinue | "
            f"Where-Object {{ $_.Message -like '*{unit}*' }} | Select-Object -First {lines} TimeCreated,Message | ConvertTo-Json -Compress")
        return [f"{r.get('TimeCreated', '')} {str(r.get('Message', '')).strip()}" for r in reversed(as_list(rows))]
    raise RuntimeError("service logs can be read on Linux (systemd) and Windows")


def read(request: dict) -> tuple[list[str], str]:
    """One log request from the console → (masked lines, error)."""
    try:
        lines = max(10, min(MAX_LINES, int(request.get("lines") or 200)))
    except (TypeError, ValueError):
        lines = 200
    try:
        if request.get("kind") == "container":
            raw = container_lines(str(request.get("name", "")), lines, str(request.get("since") or ""))
        elif request.get("kind") == "service":
            raw = service_lines(str(request.get("name", "")), lines, str(request.get("since") or ""))
        else:
            return [], "unknown kind of log"
    except Exception as e:  # report why, never crash the monitor
        return [], str(e)[:300]
    return mask_all(raw)[-lines:], ""
