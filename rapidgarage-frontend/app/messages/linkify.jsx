import React from 'react';

// Turn plain text into React nodes, linking http(s) URLs only. Everything
// else stays text (React escapes it), so message bodies can never inject HTML.
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
const TRAILING = /[.,:;!?)\]}'"]+$/;

export default function linkify(text) {
  const out = [];
  let last = 0;
  let m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    let url = m[0];
    const trail = (url.match(TRAILING) || [''])[0];
    if (trail) url = url.slice(0, -trail.length);
    let href = null;
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') href = u.href;
    } catch (e) { href = null; }
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(href ? <a key={m.index} href={href} target="_blank" rel="noopener noreferrer nofollow ugc">{url}</a> : url);
    last = m.index + url.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
