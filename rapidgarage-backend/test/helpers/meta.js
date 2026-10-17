// Minimal HTML <head> reader for link-preview tests: finds <title>, <meta>
// and <link> tags, parses quoted/unquoted attributes and decodes entities the
// way a crawler would. Also checks the rules preview crawlers rely on.
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (ENTITIES[e.toLowerCase()] !== undefined) return ENTITIES[e.toLowerCase()];
  if (/^#x/i.test(e)) return String.fromCodePoint(parseInt(e.slice(2), 16));
  if (/^#/.test(e)) return String.fromCodePoint(Number(e.slice(1)));
  return m;
});
function attrs(src) {
  const out = {};
  const re = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(src))) out[m[1].toLowerCase()] = decode(m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '');
  return out;
}
function parseHead(html) {
  const head = (/<head[^>]*>([\s\S]*?)<\/head>/i.exec(html) || [])[1];
  if (head === undefined) throw new Error('no <head>');
  if (/<body/i.test(head)) throw new Error('<body> inside <head>');
  const titles = [...head.matchAll(/<title>([\s\S]*?)<\/title>/gi)].map((m) => decode(m[1]));
  const metas = [...head.matchAll(/<meta\b([^>]*)>/gi)].map((m) => attrs(m[1]));
  const links = [...head.matchAll(/<link\b([^>]*)>/gi)].map((m) => attrs(m[1]));
  const lang = (/<html[^>]*\slang="([^"]*)"/i.exec(html) || [])[1];
  const all = (key) => metas.filter((x) => x.property === key || x.name === key).map((x) => x.content);
  const one = (key) => { const v = all(key); if (v.length !== 1) throw new Error(key + ' appears ' + v.length + ' times'); return v[0]; };
  return { titles, metas, links, lang, all, one, canonical: (links.find((l) => l.rel === 'canonical') || {}).href };
}
// What Facebook / X / Slack / WhatsApp / KakaoTalk need; throws on the first problem.
function validate(h) {
  if (h.titles.length !== 1) throw new Error(h.titles.length + ' <title>s');
  ['og:title', 'og:description', 'og:url', 'og:image', 'og:type', 'og:site_name', 'og:locale', 'og:image:width', 'og:image:height', 'og:image:alt', 'og:image:type',
    'twitter:card', 'twitter:title', 'twitter:description', 'twitter:image', 'description'].forEach((k) => { if (!h.one(k)) throw new Error('empty ' + k); });
  ['og:url', 'og:image', 'twitter:image'].forEach((k) => { if (!/^https?:\/\/[^/]+\//.test(h.one(k))) throw new Error(k + ' is not absolute: ' + h.one(k)); });
  if (h.one('twitter:card') !== 'summary_large_image') throw new Error('twitter:card');
  if (h.one('og:image:width') !== '1200' || h.one('og:image:height') !== '630') throw new Error('image size');
  if (!/^[a-z]{2}_[A-Z]{2}$/.test(h.one('og:locale'))) throw new Error('og:locale');
  if (h.one('description').length > 300) throw new Error('description too long');
  if (!/^https?:\/\//.test(h.canonical || '')) throw new Error('canonical');
  return true;
}
module.exports = { parseHead, validate, decode };
