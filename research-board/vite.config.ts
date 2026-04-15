import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3100,
    host: true,
    proxy: {
      '/api': 'http://localhost:{{BACKEND_PORT}}',
    },
  },
  preview: {
    port: 3100,
    host: true,
    proxy: {
      '/api': 'http://localhost:{{BACKEND_PORT}}',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
