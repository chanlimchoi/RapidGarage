// Share links (pure; see test/share.test.js). The link carries ?lang= outside
// English, so the preview a chat app fetches is in the sharer's language
// (the server's link-preview tags read it; the app itself ignores it).
const PATHS = { post: '/post/', event: '/events/', wanted: '/wanted/' };

export function shareUrl(origin, kind, id, locale) {
  const base = String(origin || '').replace(/\/+$/, '') + PATHS[kind] + id;
  return locale && locale !== 'en' ? base + '?lang=' + encodeURIComponent(locale) : base;
}

// Quick links that need no app key. KakaoTalk has no keyless web share, so
// it copies the link instead (see ShareButton).
export function quickLinks(url, title) {
  const text = title ? title + ' ' + url : url;
  return {
    facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url),
    whatsapp: 'https://wa.me/?text=' + encodeURIComponent(text),
    x: 'https://x.com/intent/post?text=' + encodeURIComponent(title || '') + '&url=' + encodeURIComponent(url),
  };
}

// Whether an item may be shared: public and still current (the same rule the
// server uses for detailed previews).
export function canShare(kind, item, now) {
  if (!item || item.hidden) return false;
  const t = (now || new Date()).getTime();
  if (kind === 'wanted') return item.status === 'active';
  if (kind === 'event') return !item.ended;
  const days = item.schedule && Array.isArray(item.schedule.days) ? item.schedule.days : [];
  const ended = days.length ? days.every((d) => new Date(d.endsAt).getTime() <= t) : false;
  const curb = item.curbside && item.curbside.state === 'active';
  return !ended || !!curb;
}
