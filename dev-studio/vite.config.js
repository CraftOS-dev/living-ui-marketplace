/**
 * Vite build config for the React View (AGENT-OWNED).
 *
 * `npm run build` (the pipeline build step) compiles index.html + src/ into
 * dist/, which server.mjs serves with real cache validators. `npm run dev:ui`
 * runs Vite's dev server for tight View iteration, proxying the data plane
 * (/api and the update watcher) to the running app on the manifest's port —
 * start it with `agent-app <dir> serve` (or `dev`) first.
 */
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
const backend = `http://127.0.0.1:${manifest.port ?? 8091}`;

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist" },
  server: {
    proxy: {
      "/api": backend,
      "/_a2app": backend,
    },
  },
});
