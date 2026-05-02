import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3201,
    host: true,
    proxy: {
      '/api': 'http://localhost:3200',
    },
  },
  preview: {
    port: 3201,
    host: true,
    proxy: {
      '/api': 'http://localhost:3200',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
