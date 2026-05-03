import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3211,
    host: true,
    proxy: {
      '/api': 'http://localhost:3211',
    },
  },
  preview: {
    port: 3211,
    host: true,
    proxy: {
      '/api': 'http://localhost:3211',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
