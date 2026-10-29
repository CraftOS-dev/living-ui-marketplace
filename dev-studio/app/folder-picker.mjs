import { execFile } from "node:child_process";
import { mkdir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { dataDir } from "./config.mjs";

const exec = promisify(execFile);
let active = false;
async function nativeExecutable() {
  const source = fileURLToPath(
    new URL("../scripts/ProjectFolderPicker.cs", import.meta.url),
  );
  const hash = createHash("sha256")
    .update(await readFile(source))
    .digest("hex")
    .slice(0, 16);
  const cache = join(dataDir(), "native");
  await mkdir(cache, { recursive: true });
  const executable = join(cache, `studio-folder-picker-${hash}.exe`);
  if ((await stat(executable).catch(() => null))?.isFile()) return executable;
  const powershell = join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const compiler = fileURLToPath(
    new URL("../scripts/compile-folder-picker.ps1", import.meta.url),
  );
  try {
    await exec(
      powershell,
      ["-NoProfile", "-NonInteractive", "-File", compiler],
      {
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 32768,
        env: {
          ...process.env,
          STUDIO_PICKER_SOURCE: source,
          STUDIO_PICKER_EXE: executable,
        },
      },
    );
  } catch {
    throw new Error(
      "Windows could not prepare the folder picker. Enter the folder path, or check that Windows PowerShell is available.",
    );
  }
  return executable;
}

export async function pickProjectFolder(initial = "") {
  if (process.platform !== "win32")
    throw new Error(
      "Folder browsing is available on Windows. Enter the absolute folder path instead.",
    );
  if (active)
    throw new Error(
      "The folder picker is already open. Choose a folder or cancel that window first.",
    );
  active = true;
  try {
    let start = isAbsolute(initial) ? initial : homedir();
    if (!(await stat(start).catch(() => null))?.isDirectory())
      start = dirname(start);
    const executable = await nativeExecutable();
    const result = await new Promise((resolve, reject) => {
      // This is a GUI executable: displaying its native picker creates no console.
      const child = execFile(
        executable,
        [],
        {
          windowsHide: false,
          timeout: 300000,
          maxBuffer: 32768,
          encoding: "utf8",
          // User input is data, never interpolated into executable source or commands.
          env: { ...process.env, STUDIO_FOLDER_START: start },
        },
        (error, stdout) => {
          process.removeListener("exit", stop);
          if (error?.code === 2) return resolve({ canceled: true });
          if (error)
            return reject(
              new Error(
                error.killed
                  ? "The folder picker timed out. Click Browse to try again, or enter the path."
                  : "Windows could not open the folder picker. Enter the folder path or try Browse again.",
              ),
            );
          resolve({ canceled: false, path: stdout.replace(/^\uFEFF/, "") });
        },
      );
      const stop = () => child.kill();
      process.once("exit", stop);
    });
    if (result.canceled) return result;
    if (
      typeof result.path !== "string" ||
      !isAbsolute(result.path) ||
      !(await stat(result.path).catch(() => null))?.isDirectory()
    )
      throw new Error(
        "The selected folder is no longer available. Choose another folder.",
      );
    return result;
  } finally {
    active = false;
  }
}
