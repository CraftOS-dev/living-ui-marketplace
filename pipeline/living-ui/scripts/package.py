"""Package a built V2 app as an importable Living UI ZIP.
Mirrors CraftBot's own export_project_zip skip rules, so the result is
guaranteed round-trippable through living_ui_import_zip.
Usage: python package.py <app_dir> <out_zip>

Nothing is deleted from disk — excluded paths are simply left out of the
archive, so <app_dir> stays runnable and `lui validate`-able afterwards.
"""
import os, sys, zipfile
from pathlib import Path

if len(sys.argv) != 3:
    sys.exit("usage: python package.py <app_dir> <out_zip>")
app, out = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
if not (app / "manifest.json").is_file():
    sys.exit(f"not a Living UI project (no manifest.json): {app}")
SKIP_DIRS = {"node_modules", "__pycache__", ".git", "dist", "build", "logs",
             ".venv", "venv", "pb_data", "pb_public"}
SKIP_SUFFIXES = {".pyc", ".pyo", ".log", ".db", ".sqlite", ".sqlite3", ".tsbuildinfo"}
SKIP_NAMES = {".env", ".env.local", ".env.production", ".superuser",
              "credentials.json", "token.json", ".jwt_secret", ".last_launch"}

out.parent.mkdir(parents=True, exist_ok=True)
count = 0
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk(app):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            p = Path(root) / f
            if p.suffix in SKIP_SUFFIXES or p.name in SKIP_NAMES:
                continue
            zf.write(p, p.relative_to(app))
            count += 1
print(f"PACKAGED {count} files -> {out} ({out.stat().st_size} bytes)")
