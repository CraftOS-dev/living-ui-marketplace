"""G7 audit: prove the deliverable ZIP satisfies CraftBot's import contract.

Usage: python audit.py <deliverable.zip>
Prints one G7-PASS / G7-FAIL line (plus the reasons) and exits 0 / 1.
"""
import json, os, sys, zipfile

if len(sys.argv) != 2:
    print("G7-FAIL\n  - usage: python audit.py <deliverable.zip>")
    sys.exit(1)
if not os.path.isfile(sys.argv[1]):
    print(f"G7-FAIL\n  - no such file: {sys.argv[1]}")
    sys.exit(1)

z = zipfile.ZipFile(sys.argv[1])
names = z.namelist()
fails = []
if any("\\" in n for n in names):
    fails.append("entry names use backslashes (build the ZIP with python zipfile, not Compress-Archive)")
if "manifest.json" not in names:
    fails.append("manifest.json is not at the ZIP root")
else:
    m = json.loads(z.read("manifest.json"))
    if m.get("livingUIVersion") != 2:
        fails.append(f"livingUIVersion is {m.get('livingUIVersion')!r}, must be 2")
    for k in ("id", "name", "port", "authMode", "pipeline"):
        if k not in m:
            fails.append(f"manifest.json is missing {k}")
if ".lui/system-hashes.json" not in names:
    fails.append(".lui/system-hashes.json missing (ownership canon)")
if not any(n.startswith("frontend/src/kit/") for n in names):
    fails.append("frontend/src/kit/ not vendored into the ZIP")
if not any(n.startswith("pb/pb_migrations/") for n in names):
    fails.append("pb/pb_migrations/ missing")
if "reference/requirements.md" not in names:
    fails.append("reference/requirements.md missing (V2 binding spec)")
bad = [n for n in names if any(p in n.split("/") for p in
       ("node_modules", "pb_data", "pb_public", "logs", "dist")) or n.endswith(".superuser")]
if bad:
    fails.append(f"runtime artifacts present: {bad[:5]}")
size = sum(i.file_size for i in z.infolist())
print(f"FILES={len(names)} UNCOMPRESSED={size} ZIPPED={os.path.getsize(sys.argv[1])}")
print("G7-PASS" if not fails else "G7-FAIL")
for f in fails:
    print("  - " + f)
sys.exit(1 if fails else 0)
