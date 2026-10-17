// Regenerate the PNG app icons from public/icons/icon.svg and scripts/maskable.svg.
// Needs sharp (not a frontend dependency): SHARP=/path/to/node_modules/sharp node scripts/make-icons.cjs
const path = require('path');
const sharp = require(process.env.SHARP || 'sharp');
const dir = path.join(__dirname, '..', 'public', 'icons');
const any = path.join(dir, 'icon.svg');
const maskable = path.join(__dirname, 'maskable.svg');
const jobs = [
  [any, 'icon-192.png', 192], [any, 'icon-512.png', 512], [any, 'favicon-32.png', 32], [any, 'shortcut-96.png', 96],
  [maskable, 'maskable-192.png', 192], [maskable, 'maskable-512.png', 512], [maskable, 'apple-touch-icon.png', 180],
];
Promise.all(jobs.map(([src, name, size]) => sharp(src, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toFile(path.join(dir, name))))
  .then(() => console.log('icons written to', dir));
