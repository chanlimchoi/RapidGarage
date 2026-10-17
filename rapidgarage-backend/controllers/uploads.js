// GET /uploads/<key>  - read-only access to stored photos.
const router = require('express').Router();
const { getStorage } = require('../lib/storage');

router.use((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.set('Allow', 'GET, HEAD');
    return res.status(405).end();
  }
  const key = decodeURIComponent(req.path.replace(/^\/+/, ''));
  const storage = getStorage();
  let read;
  try { read = storage.read(key); } catch (_) { return res.status(404).end(); }
  return read.then((buf) => {
    res.set({
      'Content-Type': 'image/webp',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      'Cache-Control': 'public, max-age=2592000, immutable',
    });
    res.send(buf);
  }).catch((err) => {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') return res.status(404).end();
    console.error(err);
    return res.status(500).end();
  });
});

module.exports = router;
