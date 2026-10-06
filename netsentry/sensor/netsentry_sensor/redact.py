"""Redaction at the source: command lines (cron entries, service paths, Run keys)
often carry secrets. Nothing that looks like a credential leaves the host."""

from __future__ import annotations

import re

_PATTERNS = [
    # key=value / --flag value style secrets
    (re.compile(r"(?i)((?:pass(?:word)?|pwd|secret|token|api[_-]?key|auth|bearer)\s*[=:]\s*)(\"[^\"]*\"|'[^']*'|\S+)"), r"\1***"),
    (re.compile(r"(?i)(--?(?:pass(?:word)?|secret|token|api[_-]?key)[= ]+)(\S+)"), r"\1***"),
    # user:password after -u / --user (curl, wget, httpie …)
    (re.compile(r"(?i)((?:^|\s)(?:-u|--user|--http-user)\s*=?\s*[^:\s]+:)(\S+)"), r"\1***"),
    # credentials inside URLs
    (re.compile(r"(?i)(\w+://)[^/\s:@]+:[^/\s@]+@"), r"\1***:***@"),
    # long opaque strings (keys, tokens, hashes)
    (re.compile(r"\b[A-Za-z0-9+/_\-]{32,}={0,2}"), "***"),
]


def redact(text: str, limit: int = 200) -> str:
    out = str(text or "")
    for pattern, repl in _PATTERNS:
        out = pattern.sub(repl, out)
    return out[:limit]
