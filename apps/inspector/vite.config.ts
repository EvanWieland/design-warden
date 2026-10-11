import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API = 'http://127.0.0.1:4400';
const DEV_ORIGINS = new Set(['http://localhost:5180', 'http://127.0.0.1:5180']);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    proxy: {
      '/api': {
        target: API,
        // The service only answers requests addressed to itself (Host check) ...
        changeOrigin: true,
        // ... and refuses POSTs from other origins (CSRF). Present this dev server as the service's own origin;
        // any other origin passes through unchanged and is still refused.
        configure: (proxy) => {
          proxy.on('proxyReq', (req) => {
            const origin = req.getHeader('origin');
            if (typeof origin === 'string' && DEV_ORIGINS.has(origin)) req.setHeader('origin', API);
          });
        },
      },
    },
  },
  build: { outDir: 'dist' },
});
