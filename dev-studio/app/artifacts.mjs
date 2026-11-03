import * as fs from "node:fs/promises";
import { safePath, readDocument, sensitive } from "./filesystem.mjs";
export async function inspectArtifacts(root, paths, started) {
  const files = [],
    warnings = [];
  let truncated = false;
  async function walk(path, depth = 0) {
    if (files.length >= 100 || depth > 8) {
      truncated = true;
      return;
    }
    const full = await safePath(root, path, { secret: false }),
      st = await fs.lstat(full);
    if (st.isSymbolicLink()) throw Error("Linked artifacts are excluded.");
    if (st.isDirectory()) {
      for (const name of await fs.readdir(full)) {
        if (
          sensitive(name) ||
          name.toLowerCase() === ".git" ||
          name === "node_modules"
        )
          continue;
        await walk(path + "/" + name, depth + 1);
      }
    } else if (st.isFile()) {
      const d = await readDocument(root, path, { secret: false });
      files.push({
        path,
        size: d.size,
        digest: d.digest,
        binary: !!d.binary,
        large: !!d.large,
        updatedDuringRun: st.mtimeMs >= Date.parse(started) - 1000,
      });
    }
  }
  for (const path of paths) {
    try {
      await walk(path);
    } catch (e) {
      if (!["ENOENT", "ENOTDIR"].includes(e.code))
        warnings.push({ path, message: e.message });
    }
  }
  return { files, truncated, warnings };
}
