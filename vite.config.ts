import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const configuredBasePath = process.env.VITE_BASE_PATH?.trim() || '/';
const base = configuredBasePath.endsWith('/') ? configuredBasePath : `${configuredBasePath}/`;

export default defineConfig({
  plugins: [react()],
  base,
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:4174',
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
