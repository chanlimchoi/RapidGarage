// Display helpers shared by the listing, post and profile pages.
export function formatMiles(d) {
  if (typeof d !== 'number') return null;
  return (d < 10 ? d.toFixed(1) : Math.round(d)) + ' mi';
}

export function addressLine(post) {
  return [post.street, post.city, post.state, post.zipCode].filter(Boolean).join(', ');
}

export function placeLine(post) {
  const cityState = [post.city, post.state].filter(Boolean).join(', ');
  return [cityState, post.zipCode].filter(Boolean).join(' ');
}

const valid = (d) => d instanceof Date && !isNaN(d.getTime());

export function formatDay(value) {
  const d = new Date(value);
  if (!valid(d)) return '';
  const opts = { weekday: 'short', month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

export function formatTime(value) {
  const d = new Date(value);
  if (!valid(d)) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined });
}

export function timeAgo(value) {
  const d = new Date(value);
  if (!valid(d)) return '';
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return min + ' min ago';
  const hr = Math.round(min / 60);
  if (hr < 24) return hr + ' hr ago';
  const day = Math.round(hr / 24);
  if (day < 7) return day + (day === 1 ? ' day ago' : ' days ago');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function initials(user) {
  if (!user) return '?';
  const s = ((user.firstName || '').charAt(0) + (user.lastName || '').charAt(0)) || (user.email || '?').charAt(0);
  return s.toUpperCase();
}

export function displayName(user) {
  if (!user) return '';
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
}
