import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import pwa from './pwa/vite-plugin.js';
import shareMeta from './share/vite-plugin.js';

// Same dev setup as the old webpack-dev-server: port 3000, and /api/* proxied
// to the backend on :8000 with the /api prefix stripped.
const BACKEND = process.env.BACKEND_URL || 'http://localhost:8000';
const proxy = {
  '/api': {
    target: BACKEND,
    changeOrigin: false,
    rewrite: (p) => p.replace(/^\/api/, ''),
  },
  // robots.txt and sitemap.xml are built by the backend (lib/seo.js).
  '/robots.txt': { target: BACKEND, changeOrigin: false },
  '/sitemap.xml': { target: BACKEND, changeOrigin: false },
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
    // shareMeta: link-preview tags in the HTML when Vite serves the app
    // (see share/vite-plugin.js; the backend does it under SERVE_FRONTEND_DIR).
    plugins: [react(), pwa(), shareMeta({ backend: BACKEND })],
    define: {
      'import.meta.env.VITE_GOOGLE_MAPS_API_KEY': JSON.stringify(mapsKey),
    },
    // Marks every <script>/<link> in index.html (and adds the
    // <meta property="csp-nonce"> Vite's preload helper reads) with a
    // placeholder. When the backend serves the build (SERVE_FRONTEND_DIR,
    // Docker), it swaps in a fresh nonce per response to match its strict CSP;
    // see rapidgarage-backend/lib/frontend.js. Elsewhere it is inert.
    html: { cspNonce: '__RG_CSP_NONCE__' },
    server: { port: 3000, strictPort: true, proxy },
    preview: { port: 3000, strictPort: true, proxy },
    build: { outDir: 'build', sourcemap: true },
  };
});
