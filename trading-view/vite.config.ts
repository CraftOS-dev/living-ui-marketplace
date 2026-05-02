import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3104,
    host: true,
    proxy: {
      '/api': 'http://localhost:3105',
    },
  },
  preview: {
    port: 3104,
    host: true,
    proxy: {
      '/api': 'http://localhost:3105',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
