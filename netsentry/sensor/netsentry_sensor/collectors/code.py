"""Code & supply chain — opt-in: set NETSENTRY_CODE_PATHS to the project
directories on this host (separated by the OS path separator, ':' or ';').

- Vulnerable dependencies: lockfiles are read locally and only package
  name + version + ecosystem are sent to OSV.dev (Google's open vulnerability
  database, no key). Nothing else about the project leaves the host.
- Leaked secrets: gitleaks, when installed. Only file, line, rule and a hash are
  reported — never the secret or the matching text.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import time
import urllib.error
import urllib.request

from ..util import run, which
from .base import Collector, Unavailable

OSV_BATCH = "https://api.osv.dev/v1/querybatch"
OSV_VULN = "https://api.osv.dev/v1/vulns/"
VULN_CACHE_TTL = 86400
MAX_PACKAGES = 3000
SKIP_DIRS = {"node_modules", ".git", ".venv", "venv", "__pycache__", "dist", "build", "vendor", "target"}


def code_paths() -> list[str]:
    raw = os.environ.get("NETSENTRY_CODE_PATHS", "")
    return [p for p in raw.split(os.pathsep) if p.strip() and os.path.isdir(p.strip())]


# ------------------------------------------------------------ lockfiles


def parse_package_lock(text: str) -> list[tuple[str, str]]:
    """npm package-lock.json v2/v3 ("packages") or v1 ("dependencies")."""
    d = json.loads(text)
    out = set()
    for path, p in (d.get("packages") or {}).items():
        if not path or not p.get("version"):
            continue  # "" is the project itself
        out.add((p.get("name") or path.split("node_modules/")[-1], p["version"]))

    def walk(deps):
        for name, p in (deps or {}).items():
            if p.get("version"):
                out.add((name, p["version"]))
            walk(p.get("dependencies"))

    if not out:
        walk(d.get("dependencies"))
    return sorted(out)


def parse_requirements(text: str) -> list[tuple[str, str]]:
    """Only exactly pinned lines (name==version) — ranges cannot be checked."""
    out = []
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()
        m = re.match(r"^([A-Za-z0-9_.\-]+)(\[[^\]]*\])?\s*==\s*([A-Za-z0-9_.\-+!]+)\s*(;.*)?$", line)
        if m:
            out.append((m.group(1), m.group(3)))
    return out


def parse_toml_lock(text: str) -> list[tuple[str, str]]:
    """poetry.lock / Cargo.lock / uv.lock: [[package]] blocks with name/version."""
    out = []
    for block in re.split(r"^\[\[package\]\]\s*$", text, flags=re.M)[1:]:
        name = re.search(r'^name\s*=\s*"([^"]+)"', block, re.M)
        ver = re.search(r'^version\s*=\s*"([^"]+)"', block, re.M)
        if name and ver:
            out.append((name.group(1), ver.group(1)))
    return out


def parse_pipfile_lock(text: str) -> list[tuple[str, str]]:
    d = json.loads(text)
    out = []
    for section in ("default", "develop"):
        for name, p in (d.get(section) or {}).items():
            v = str(p.get("version", ""))
            if v.startswith("=="):
                out.append((name, v[2:]))
    return out


def parse_go_sum(text: str) -> list[tuple[str, str]]:
    out = set()
    for line in text.splitlines():
        parts = line.split()
        if len(parts) >= 2 and not parts[1].endswith("/go.mod"):
            out.add((parts[0], parts[1]))
    return sorted(out)


def parse_composer_lock(text: str) -> list[tuple[str, str]]:
    d = json.loads(text)
    return [(p["name"], str(p["version"]).lstrip("v")) for p in (d.get("packages") or []) + (d.get("packages-dev") or []) if p.get("name")]


LOCKFILES = {
    "package-lock.json": ("npm", parse_package_lock),
    "requirements.txt": ("PyPI", parse_requirements),
    "poetry.lock": ("PyPI", parse_toml_lock),
    "uv.lock": ("PyPI", parse_toml_lock),
    "Pipfile.lock": ("PyPI", parse_pipfile_lock),
    "Cargo.lock": ("crates.io", parse_toml_lock),
    "go.sum": ("Go", parse_go_sum),
    "composer.lock": ("Packagist", parse_composer_lock),
}


def find_lockfiles(root: str, max_depth: int = 4) -> list[str]:
    found = []
    base = root.rstrip(os.sep).count(os.sep)
    for d, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS and not x.startswith(".")]
        if d.count(os.sep) - base >= max_depth:
            dirs[:] = []
        found += [os.path.join(d, f) for f in files if f in LOCKFILES]
    return sorted(found)


# ------------------------------------------------------------------ OSV


def _post(url: str, body: dict, timeout: int = 30) -> dict:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"content-type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 — fixed OSV endpoint
        return json.loads(r.read())


def _get(url: str, timeout: int = 20) -> dict:
    with urllib.request.urlopen(url, timeout=timeout) as r:  # noqa: S310 — fixed OSV endpoint
        return json.loads(r.read())


def summarize_vuln(v: dict) -> dict:
    """OSV record → what the console needs: CVE aliases (for KEV/EPSS), severity, fixed versions."""
    fixed = sorted({e["fixed"] for a in v.get("affected", []) for r in a.get("ranges", []) for e in r.get("events", []) if "fixed" in e})
    sev = str((v.get("database_specific") or {}).get("severity", "")).lower()
    return {
        "id": v.get("id"),
        "aliases": [a for a in v.get("aliases", []) if a.startswith("CVE-")],
        "summary": str(v.get("summary") or "")[:200],
        "severity": {"moderate": "medium"}.get(sev, sev) or None,
        "fixed": fixed[:5],
    }


def osv_lookup(packages: list[tuple[str, str, str]], cache: dict, now: float, post=_post, get=_get) -> dict:
    """packages: [(ecosystem, name, version)] → {(eco,name,version): [vuln summary]}."""
    result = {}
    for i in range(0, len(packages), 1000):
        chunk = packages[i:i + 1000]
        data = post(OSV_BATCH, {"queries": [{"package": {"ecosystem": e, "name": n}, "version": v} for e, n, v in chunk]})
        for pkg, res in zip(chunk, data.get("results", [])):
            ids = [x["id"] for x in res.get("vulns", [])]
            if ids:
                result[pkg] = ids
    out = {}
    for pkg, ids in result.items():
        vulns = []
        for vid in ids[:20]:
            hit = cache.get(vid)
            if not hit or now - hit.get("at", 0) > VULN_CACHE_TTL:
                hit = {"at": now, "v": summarize_vuln(get(OSV_VULN + vid))}
                cache[vid] = hit
            vulns.append(hit["v"])
        out[pkg] = vulns
    return out


# ------------------------------------------------------------- gitleaks


def parse_gitleaks(report: list, root: str) -> list[dict]:
    out = []
    for f in report or []:
        rel = os.path.relpath(f.get("File", ""), root) if os.path.isabs(f.get("File", "")) else f.get("File", "")
        # Stable id without the secret: gitleaks' fingerprint (commit:file:rule:line) hashed with the project.
        fid = hashlib.sha256(f"{root}|{f.get('Fingerprint') or (rel + str(f.get('StartLine')) + f.get('RuleID', ''))}".encode()).hexdigest()[:16]
        out.append({"kind": "code.secret", "subject": fid, "data": {
            "project": os.path.basename(root.rstrip(os.sep)), "file": rel.replace(os.sep, "/"), "line": f.get("StartLine"),
            "rule": f.get("RuleID"), "description": str(f.get("Description") or "")[:120], "commit": (f.get("Commit") or "")[:12] or None,
        }})
    return out


def run_gitleaks(root: str) -> list[dict]:
    fd, path = tempfile.mkstemp(suffix=".json")
    os.close(fd)
    try:
        args = ["gitleaks", "detect", "--source", root, "--report-format", "json", "--report-path", path, "--exit-code", "0", "--redact"]
        if not os.path.isdir(os.path.join(root, ".git")):
            args.append("--no-git")
        code, out = run(args, timeout=600)
        if code != 0:
            raise RuntimeError(out.strip().splitlines()[-1] if out.strip() else f"gitleaks exit {code}")
        with open(path, encoding="utf-8") as f:
            return parse_gitleaks(json.load(f) or [], root)
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


# ------------------------------------------------------------ collector


def _roots() -> list[str]:
    roots = code_paths()
    if not roots:
        raise Unavailable("opt-in: set NETSENTRY_CODE_PATHS to the project folders to check")
    return roots


class Dependencies(Collector):
    id = "host.deps"

    def collect(self) -> dict:
        roots = _roots()
        now = time.time()
        obs, notes, complete = [], [], True
        packages: dict[tuple[str, str, str], list[str]] = {}
        for root in roots:
            project = os.path.basename(root.rstrip(os.sep))
            for lf in find_lockfiles(root):
                eco, parse = LOCKFILES[os.path.basename(lf)]
                rel = f"{project}/{os.path.relpath(lf, root)}".replace(os.sep, "/")
                try:
                    with open(lf, encoding="utf-8", errors="replace") as f:
                        pairs = parse(f.read())
                except (OSError, ValueError) as e:
                    complete = False
                    notes.append(f"{rel}: unreadable ({type(e).__name__})")
                    continue
                for name, ver in pairs:
                    packages.setdefault((eco, name, ver), []).append(rel)
        keys = sorted(packages)[:MAX_PACKAGES]
        if len(packages) > MAX_PACKAGES:
            complete = False
            notes.append(f"only the first {MAX_PACKAGES} of {len(packages)} packages were checked")
        if keys:
            cache = self.state.setdefault("osv_cache", {})
            try:
                hits = osv_lookup(keys, cache, now)
            except (urllib.error.URLError, OSError, ValueError) as e:
                raise Unavailable(f"OSV.dev unreachable ({type(e).__name__})") from e
            for (eco, name, ver), vulns in hits.items():
                obs.append({"kind": "code.vulnerable_dependency", "subject": f"{eco}:{name}@{ver}",
                            "data": {"ecosystem": eco, "name": name, "version": ver, "files": packages[(eco, name, ver)][:5], "vulns": vulns}})
            for k in [k for k, v in cache.items() if now - v.get("at", 0) > VULN_CACHE_TTL * 7]:
                del cache[k]
        notes.insert(0, f"{len(keys)} packages in {len(roots)} project(s)")
        return {"observations": obs, "complete": complete, "note": "; ".join(notes)}


class Secrets(Collector):
    id = "host.secrets"

    def collect(self) -> dict:
        roots = _roots()
        if not which("gitleaks"):
            raise Unavailable("secret scanning needs gitleaks (https://github.com/gitleaks/gitleaks)")
        obs, notes, complete = [], [], True
        for root in roots:
            try:
                obs += run_gitleaks(root)
            except (RuntimeError, OSError, ValueError) as e:
                complete = False
                notes.append(f"gitleaks failed on {os.path.basename(root)}: {str(e)[:120]}")
        return {"observations": obs, "complete": complete, "note": "; ".join(notes)}
