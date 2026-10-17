import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Same dev setup as the old webpack-dev-server: port 3000, and /api/* proxied
// to the backend on :8000 with the /api prefix stripped.
const BACKEND = process.env.BACKEND_URL || 'http://localhost:8000';
const proxy = {
  '/api': {
    target: BACKEND,
    changeOrigin: false,
    rewrite: (p) => p.replace(/^\/api/, ''),
  },
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Back-compat: the webpack build read GOOGLE_MAPS_API_KEY. Only VITE_* vars
  // are exposed to the client, so map the legacy name onto the new one.
  const mapsKey = env.VITE_GOOGLE_MAPS_API_KEY || env.GOOGLE_MAPS_API_KEY || '';
  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_GOOGLE_MAPS_API_KEY': JSON.stringify(mapsKey),
    },
    server: { port: 3000, strictPort: true, proxy },
    preview: { port: 3000, strictPort: true, proxy },
    build: { outDir: 'build', sourcemap: true },
  };
});
