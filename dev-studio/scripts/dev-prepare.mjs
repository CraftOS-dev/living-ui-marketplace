/**
 * lifecycle.dev — build a FRESH dev database by replaying the schema seed into
 * the isolated dev data directory the framework provides (`A2APP_DATA_DIR`, a
 * per-boot dir under `.a2app/dev/`), and prove the current (possibly
 * just-edited) `server.mjs` + `a2app.schema.mjs` load cleanly. `agent-app dev`
 * runs this, then boots `server.mjs` against the same directory on a hidden
 * port.
 *
 * This is the SQLite analogue of "replay the full migration chain on a fresh
 * database": the schema IS the migration (schema-in-code), so a clean re-seed
 * from empty is exactly what proves an evolve is safe to promote. It NEVER reads
 * or writes the live `data/` directory — the framework `agent-app dev` command
 * fingerprints live around this script and aborts if it touched it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { schema } from "../a2app.schema.mjs";

const HERE = dirname(fileURLToPath(import.meta.url)); // scripts/
const ROOT = join(HERE, "..");
const DEV_DATA = process.env.A2APP_DATA_DIR
  ? resolve(process.env.A2APP_DATA_DIR)
  : join(ROOT, ".a2app", "dev", "data");

/** Mirror of server.mjs materialize(): assign id, fill server-managed `created`,
 *  drop blanks. Kept self-contained so this script never boots the server. */
function materialize(fields, body) {
  const id = typeof body.id === "string" && body.id ? body.id : "rec_" + randomBytes(8).toString("hex");
  const rec = { id };
  for (const f of fields) {
    if (f.name in body && body[f.name] !== undefined && body[f.name] !== null && body[f.name] !== "") {
      rec[f.name] = body[f.name];
    } else if (f.readOnly && f.name === "created") {
      rec[f.name] = new Date().toISOString();
    }
  }
  return rec;
}

// Fresh, isolated dev DB — replaced every run.
rmSync(DEV_DATA, { recursive: true, force: true });
mkdirSync(DEV_DATA, { recursive: true });
const db = new Database(join(DEV_DATA, "db.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(
  "CREATE TABLE IF NOT EXISTS records (entity TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (entity, id))",
);
const put = db.prepare("INSERT INTO records (entity, id, data) VALUES (?, ?, ?)");
const seedAll = db.transaction(() => {
  for (const [entity, def] of Object.entries(schema.entities)) {
    for (const seed of def.seed ?? []) {
      const rec = materialize(def.fields, seed);
      put.run(entity, rec.id, JSON.stringify(rec));
    }
  }
});
seedAll();
db.close();

// Build the View from the CURRENT source: the dev instance serves dist/, so
// without this a dev boot would show a stale earlier build (or refuse to boot
// on a fresh scaffold that has never built). Vite runs through its JS entry so
// the step needs no npm shell (npm is npm.cmd on Windows).
const viteBin = join(ROOT, "node_modules", "vite", "bin", "vite.js");
if (!existsSync(viteBin)) {
  process.stderr.write("vite not found — run the pipeline install (npm install) first\n");
  process.exit(1);
}
execFileSync(process.execPath, [viteBin, "build"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });

// Prove the (possibly edited) server still parses.
execFileSync(process.execPath, ["--check", join(ROOT, "server.mjs")], { stdio: "ignore" });

process.stdout.write(
  `dev database prepared at ${DEV_DATA} — ${Object.keys(schema.entities).length} entit${
    Object.keys(schema.entities).length === 1 ? "y" : "ies"
  } re-seeded from a fresh, empty store\n`,
);
