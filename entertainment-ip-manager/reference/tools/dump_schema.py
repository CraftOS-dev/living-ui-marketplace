import sqlite3, sys, json
c = sqlite3.connect(sys.argv[1])
out = {}
for name, fields in c.execute("select name, fields from _collections"):
    fs = json.loads(fields)
    out[name] = {f['name']: {k: f.get(k) for k in ('type', 'values', 'collectionId', 'maxSelect') if f.get(k) is not None} for f in fs}
ids = {i: n for i, n in c.execute("select id, name from _collections")}
for n, fs in out.items():
    for f in fs.values():
        if 'collectionId' in f:
            f['to'] = ids.get(f.pop('collectionId'))
json.dump(out, open(sys.argv[2], 'w'), indent=0)
print(len(out), 'collections')
