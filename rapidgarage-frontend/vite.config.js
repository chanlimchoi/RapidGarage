import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import pwa from './pwa/vite-plugin.js';

// Same dev setup as the old webpack-dev-server: port 3000, and /api/* proxied
// to the backend on :8000 with the /api prefix stripped.
const BACKEND = process.env.BACKEND_URL || 'http://localhost:8000';
const proxy = {
  '/api': {
    target: BACKEND,
    changeOrigin: false,
    rewrite: (p) => p.replace(/^\/api/, ''),
  },
  // QR short links (/s/<code>, not /saved, /settings, /signup...) go to the
  // backend unchanged; it counts the scan and redirects to the post. xfwd adds
  // X-Forwarded-For so repeat scans can be told apart (the IP is only hashed).
  '^/s/[A-Za-z0-9]+/?(\\?.*)?$': {
    target: BACKEND,
    changeOrigin: false,
    xfwd: true,
  },
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Back-compat: the webpack build read GOOGLE_MAPS_API_KEY. Only VITE_* vars
  // are exposed to the client, so map the legacy name onto the new one.
  const mapsKey = env.VITE_GOOGLE_MAPS_API_KEY || env.GOOGLE_MAPS_API_KEY || '';
  return {
    plugins: [react(), pwa()],
    define: {
      'import.meta.env.VITE_GOOGLE_MAPS_API_KEY': JSON.stringify(mapsKey),
    },
    server: { port: 3000, strictPort: true, proxy },
    preview: { port: 3000, strictPort: true, proxy },
    build: { outDir: 'build', sourcemap: true },
  };
});
