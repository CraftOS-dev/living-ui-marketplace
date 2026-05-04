import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: {{PORT}},
    host: true,
    proxy: {
      '/api': 'http://localhost:{{PORT}}',
    },
  },
  preview: {
    port: {{PORT}},
    host: true,
    proxy: {
      '/api': 'http://localhost:{{PORT}}',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
