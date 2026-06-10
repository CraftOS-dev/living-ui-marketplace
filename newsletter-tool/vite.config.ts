import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const manifestPath = resolve(__dirname, 'config/manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
const frontendPort: number = manifest.ports.frontend
const backendPort: number = manifest.ports.backend

// Make /config/manifest.json reachable in dev AND preview so the browser can
// discover the backend port at runtime. Reads fresh from disk every request
// so live edits to the manifest take effect on reload.
function serveManifestPlugin(): PluginOption {
  const handler = (_req: unknown, res: { setHeader: (k: string, v: string) => void; end: (b: Buffer | string) => void; statusCode?: number }) => {
    try {
      res.setHeader('Content-Type', 'application/json')
      res.end(readFileSync(manifestPath))
    } catch {
      res.statusCode = 500
      res.end('{}')
    }
  }
  return {
    name: 'serve-manifest',
    configureServer(server) {
      server.middlewares.use('/config/manifest.json', handler as never)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/config/manifest.json', handler as never)
    },
  }
}

export default defineConfig({
  plugins: [react(), serveManifestPlugin()],
  server: {
    port: frontendPort,
    host: true,
    proxy: {
      '/api': `http://localhost:${backendPort}`,
    },
  },
  preview: {
    port: frontendPort,
    host: true,
    proxy: {
      '/api': `http://localhost:${backendPort}`,
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
