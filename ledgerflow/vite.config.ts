import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3108,
    host: true,
    proxy: {
      '/api': 'http://localhost:3109',
    },
  },
  preview: {
    port: 3108,
    host: true,
    proxy: {
      '/api': 'http://localhost:3109',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
