import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3110,
    host: true,
    proxy: {
      '/api': 'http://localhost:3111',
    },
  },
  preview: {
    port: 3110,
    host: true,
    proxy: {
      '/api': 'http://localhost:3111',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
