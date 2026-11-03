// Optional Node preloader for a transient Windows sharing violation during the
// pinned framework's atomic backup publication. No backup or gate is skipped.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { resolve, dirname } from "node:path";
if (process.platform === "win32") {
  const rename = fs.renameSync;
  fs.renameSync = function (from, to) {
    const source = resolve(String(from)),
      destination = resolve(String(to));
    const backup =
      source.startsWith(destination + ".staging-") &&
      dirname(destination).replaceAll("\\", "/").endsWith("/.a2app/backups");
    const deadline = Date.now() + 8000;
    for (;;) {
      try {
        return rename.call(fs, from, to);
      } catch (error) {
        if (
          !backup ||
          !["EPERM", "EBUSY", "EACCES"].includes(error.code) ||
          Date.now() >= deadline
        )
          throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
      }
    }
  };
  syncBuiltinESMExports();
}
