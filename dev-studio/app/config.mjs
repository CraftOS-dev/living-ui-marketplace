import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
export const framework = JSON.parse(readFileSync(join(ROOT, "framework.lock.json"), "utf8"));
export const dataDir = () => resolve(process.env.A2APP_DATA_DIR || join(ROOT, "data"));
export const appPort = () => Number(process.env.PORT || manifest.port);
export const allowedOrigins = () => ["http://127.0.0.1:" + appPort(), "http://localhost:" + appPort()];
export function requireHuman(ctx) {
  if (ctx.credentialId !== "ui") throw new Error("This action requires the local app interface.");
}
