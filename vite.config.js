import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { createAskHandler } from './server/ask.js'

export default defineConfig(({ mode }) => {
  // Loaded with an empty prefix so ANTHROPIC_API_KEY is readable here without
  // a VITE_ prefix — which also guarantees Vite never inlines it into the
  // client bundle.
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      {
        name: 'daic-archive-api',
        configureServer(server) {
          server.middlewares.use('/api/ask', createAskHandler(env.ANTHROPIC_API_KEY))
        },
      },
    ],
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.js'],
      css: false,
    },
    server: {
      // host: true binds every interface, so the phone can reach it over Wi-Fi
      // without passing --host. Port 5180 avoids the CortexEdge dev server
      // that already squats on 5173.
      host: true,
      port: 5180,
      strictPort: true,
    },
  }
})
