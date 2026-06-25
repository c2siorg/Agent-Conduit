import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Builds to STATIC assets served directly by the Express gateway (single self-hosted process).
 * In dev, `/api` proxies to the local gateway so the dashboard never needs its own backend.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      // Strip the /api prefix so /api/agents -> gateway /agents (HTTP in local/compose).
      '/api': {
        target: 'http://localhost:8443',
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
});
