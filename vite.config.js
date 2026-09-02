import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/* The backend runs on the laptop; the tablet reaches it over the LAN.
   In development Vite proxies /api straight through, so the frontend always
   speaks to the real FastAPI service on the same origin — exactly as it
   will in production, where FastAPI serves the built bundle itself. */
const API_TARGET = process.env.DAIC_API_TARGET || 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],

  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    css: false,
  },

  server: {
    // host: true binds every interface, so a tablet can reach the dev server
    // over Wi-Fi without passing --host.
    host: true,
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        // The archive answers slowly while a local model generates.
        timeout: 120000,
        proxyTimeout: 120000,
      },
    },
  },

  build: {
    // The landing film is served from public/ untouched; everything else is
    // hashed. Warn late so the archive's own chunk size is not noise.
    chunkSizeWarningLimit: 700,
  },
})
