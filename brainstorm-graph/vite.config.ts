import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Ports come from env (CraftBot injects PORT / BACKEND_PORT) with local defaults.
// ponytail: no {{PLACEHOLDER}} tokens in code files — a raw token is invalid JS and
// crashes the config parse before the app can start. Env-with-default works whether
// or not anything substitutes it.
const PORT = Number(process.env.PORT) || 3100
const BACKEND_PORT = Number(process.env.BACKEND_PORT) || 3101

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: PORT,
    host: true,
    proxy: {
      '/api': `http://localhost:${BACKEND_PORT}`,
    },
  },
  preview: {
    port: PORT,
    host: true,
    proxy: {
      '/api': `http://localhost:${BACKEND_PORT}`,
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
