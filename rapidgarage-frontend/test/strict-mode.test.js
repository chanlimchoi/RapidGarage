// StrictMode (development) mounts every component, unmounts it and mounts it
// again. A class that sets an "unmounted" flag in componentWillUnmount must
// clear it in componentDidMount (or use a "mounted" flag set on every mount),
// or the remounted component ignores every response and stays on its loading
// state forever (the Messages page did, after StrictMode was enabled).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.(jsx?|mjs)$/.test(e.name) ? [p] : [];
  });
}
// The body of `name() { ... }` (first occurrence), by brace counting.
function method(src, name) {
  const i = src.search(new RegExp('\\n\\s+' + name + '\\(\\)\\s*\\{'));
  if (i < 0) return null;
  let depth = 0;
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(i, j + 1);
  }
  return null;
}

test('components that flag themselves unmounted reset the flag on mount', () => {
  const bad = [];
  let checked = 0;
  for (const f of files(APP)) {
    const src = fs.readFileSync(f, 'utf8');
    const unmount = method(src, 'componentWillUnmount');
    if (!unmount) continue;
    const mount = method(src, 'componentDidMount') || '';
    const rel = path.relative(APP, f);
    for (const m of unmount.matchAll(/this\.(\w+) = (true|false);/g)) {
      const [, flag, value] = m;
      if (!/mount|alive|dead|closed/i.test(flag)) continue;
      checked++;
      const reset = value === 'true' ? 'false' : 'true';
      if (!new RegExp('this\\.' + flag + ' = ' + reset + '\\b').test(mount)) bad.push(rel + ': componentWillUnmount sets this.' + flag + ' = ' + value + ' but componentDidMount never sets it back to ' + reset);
    }
  }
  assert.ok(checked > 10, 'expected to find the mount flags (found ' + checked + ')');
  assert.deepStrictEqual(bad, []);
});
