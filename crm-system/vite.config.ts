import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'frontend'),
    },
  },
  server: {
    port: {{PORT}},
    host: true,
    proxy: {
      '/api': 'http://localhost:{{BACKEND_PORT}}',
    },
  },
  preview: {
    port: {{PORT}},
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
