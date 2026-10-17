// Build step: write build/sw.js from pwa/sw-template.js + pwa/sw-core.js with
// the list of shell files and a content version. Dev builds get no worker.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { shellFiles } from './sw-core.js';

const here = path.dirname(new URL(import.meta.url).pathname);

function walk(dir, base) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = base ? base + '/' + e.name : e.name;
    return e.isDirectory() ? walk(path.join(dir, e.name), rel) : [rel];
  });
}

export function buildServiceWorker(outDir) {
  const files = shellFiles(walk(outDir, ''));
  const core = fs.readFileSync(path.join(here, 'sw-core.js'), 'utf8').replace(/^export \{[^}]*\};?\s*$/m, '');
  const template = fs.readFileSync(path.join(here, 'sw-template.js'), 'utf8');
  // Version = the shell's content plus the worker's own code.
  const hash = crypto.createHash('sha256').update(core).update(template);
  files.forEach((f) => { hash.update(f); hash.update(fs.readFileSync(path.join(outDir, f.slice(1)))); });
  const version = hash.digest('hex').slice(0, 12);
  const sw = template
    .replace('/* __CORE__ */', () => core)
    .replace('__VERSION__', version)
    .replace('__PRECACHE__', () => JSON.stringify(files, null, 2));
  fs.writeFileSync(path.join(outDir, 'sw.js'), sw);
  return { version, files };
}

export default function pwa() {
  let outDir;
  return {
    name: 'rapidgarage-pwa',
    apply: 'build',
    configResolved(config) { outDir = path.resolve(config.root, config.build.outDir); },
    closeBundle() {
      const { version, files } = buildServiceWorker(outDir);
      console.log(`[pwa] sw.js ${version}: ${files.length} shell files precached`);
    },
  };
}
