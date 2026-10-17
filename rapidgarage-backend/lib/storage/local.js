const fs = require('fs/promises');
const path = require('path');

const KEY_RE = /^[a-z0-9][a-z0-9/_-]*\.webp$/;

class LocalStorage {
  constructor(dir) { this.dir = dir; }

  resolve(key) {
    if (!KEY_RE.test(key) || key.includes('..')) throw new Error('Invalid storage key');
    return path.join(this.dir, key);
  }

  async put(key, buffer) {
    const file = this.resolve(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buffer, { flag: 'wx' });
  }

  async remove(key) {
    try { await fs.unlink(this.resolve(key)); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  }

  read(key) { return fs.readFile(this.resolve(key)); }
}

module.exports = LocalStorage;
