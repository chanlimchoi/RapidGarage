import { t, locale } from './i18n';
// Small fetch helpers shared by the components.
// The backend answers errors as { error: { code, message, details? } }.
export function errorMessage(data, fallback) {
  if (data && data.error) {
    const details = data.error.details;
    if (details && typeof details === 'object') {
      const first = Object.keys(details).map((k) => details[k])[0];
      if (first) return data.error.message + ' ' + first;
    }
    return data.error.message || fallback;
  }
  return fallback;
}

// Resolves to { ok, status, data }; data is null for empty bodies (e.g. 204).
export function apiFetch(path, options) {
  const opts = Object.assign({ credentials: 'same-origin' }, options || {});
  opts.headers = Object.assign({ 'Accept': 'application/json', 'Accept-Language': locale() }, opts.body ? { 'Content-Type': 'application/json' } : {}, opts.headers || {});
  return fetch('/api' + path, opts).then((response) =>
    response.text().then((text) => {
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
      return { ok: response.ok, status: response.status, data };
    })
  );
}

// Ask the server who is logged in. Resolves to the user or null.
export function fetchMe() {
  return apiFetch('/me')
    .then(({ ok, data }) => (ok && data && data.user ? data.user : null))
    .catch(() => null);
}

export const MAX_PHOTOS = 5;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Upload File objects to a post (multipart field "photos").
// Resolves to { ok, status, data } like apiFetch.
export function uploadPhotos(postId, files) {
  const form = new FormData();
  files.forEach((f) => form.append('photos', f, f.name));
  return fetch('/api/post/' + postId + '/photos', { method: 'POST', body: form, credentials: 'same-origin', headers: { 'Accept-Language': locale() } })
    .then((response) => response.text().then((text) => {
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
      return { ok: response.ok, status: response.status, data };
    }));
}

export function deletePhoto(postId, photoId) {
  return apiFetch('/post/' + postId + '/photos/' + photoId, { method: 'DELETE' });
}

export function canEditPost(user, post) {
  return !!user && !!post && (user.id === post.userId || user.role === 'admin');
}

export const SEARCH_RADII = [5, 10, 25, 50];

// GET /search. params: { lat, lng } or { q }, plus radius, page, pageSize.
export function searchPosts(params) {
  const qs = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&');
  return apiFetch('/search?' + qs);
}

// ---- Reports & moderation ----------------------------------------------
export const REPORT_REASONS = [
  { value: 'spam', get label() { return t('reason.spam'); } },
  { value: 'scam', get label() { return t('reason.scam'); } },
  { value: 'prohibited', get label() { return t('reason.prohibited'); } },
  { value: 'offensive', get label() { return t('reason.offensive'); } },
  { value: 'wrong_info', get label() { return t('reason.wrongInfo'); } },
  { value: 'other', get label() { return t('reason.other'); } },
];
export const REPORT_NOTE_MAX = 500;
export function reasonLabel(value) {
  const r = REPORT_REASONS.filter((x) => x.value === value)[0];
  return r ? r.label : value;
}

export function reportPost(postId, reason, note) {
  return apiFetch('/post/' + postId + '/report', { method: 'POST', body: JSON.stringify({ reason, note: note || undefined }) });
}

export function fetchReportQueue() { return apiFetch('/admin/reports'); }
export function fetchReportHistory(page) { return apiFetch('/admin/reports/history?page=' + (page || 1)); }
export function moderatePost(postId, action, note) {
  return apiFetch('/admin/posts/' + postId + '/moderate', { method: 'POST', body: JSON.stringify({ action, note: note || undefined }) });
}

// ---- Messaging -----------------------------------------------------------
export const MESSAGE_MAX = 2000;
export const fetchConversations = () => apiFetch('/conversations');
export const fetchConversation = (id) => apiFetch('/conversations/' + id);
// Item holds (lib/holds.js on the server).
export const fetchHolds = (conversationId) => apiFetch('/conversations/' + conversationId + '/holds');
export const requestHold = (conversationId, body) => apiFetch('/conversations/' + conversationId + '/holds', { method: 'POST', body: JSON.stringify(body) });
export const holdAction = (holdId, action, body) => apiFetch('/holds/' + holdId + '/' + action, { method: 'POST', body: JSON.stringify(body || {}) });
export const fetchMessagesAfter = (id, afterId) => apiFetch('/conversations/' + id + '/messages?after=' + (afterId || 0));
export const fetchMessagesBefore = (id, beforeId) => apiFetch('/conversations/' + id + '/messages?before=' + beforeId);
export const startConversation = (postId) => apiFetch('/conversations', { method: 'POST', body: JSON.stringify({ postId }) });
export const sendMessage = (id, body) => apiFetch('/conversations/' + id + '/messages', { method: 'POST', body: JSON.stringify({ body }) });
export const setBlocked = (id, blocked) => apiFetch('/conversations/' + id + '/block', { method: blocked ? 'POST' : 'DELETE' });
// Resolves to the unread count, or null if it couldn't be fetched.
export function fetchUnreadCount() {
  return apiFetch('/conversations/unread')
    .then(({ ok, data }) => (ok && data ? data.count : null))
    .catch(() => null);
}

// ---- Conversation reports --------------------------------------------------
export const CONVERSATION_REPORT_REASONS = [
  { value: 'harassment', get label() { return t('reason.harassment'); } },
  { value: 'scam', get label() { return t('reason.scam'); } },
  { value: 'spam', get label() { return t('reason.spam'); } },
  { value: 'offensive', get label() { return t('reason.offensive'); } },
  { value: 'other', get label() { return t('reason.other'); } },
];
export function conversationReasonLabel(value) {
  const r = CONVERSATION_REPORT_REASONS.filter((x) => x.value === value)[0];
  return r ? r.label : value;
}
export const reportConversation = (id, reason, note, block) =>
  apiFetch('/conversations/' + id + '/report', { method: 'POST', body: JSON.stringify({ reason, note: note || undefined, block: !!block }) });
export const fetchConversationReportQueue = () => apiFetch('/admin/conversation-reports');
export const fetchConversationReportHistory = (page) => apiFetch('/admin/conversation-reports/history?page=' + (page || 1));
export const fetchReportedConversation = (id) => apiFetch('/admin/conversations/' + id);
export const moderateConversation = (id, body) => apiFetch('/admin/conversations/' + id + '/moderate', { method: 'POST', body: JSON.stringify(body) });

// ---- Sale alerts -----------------------------------------------------------
export const ALERT_RADIUS = { min: 1, max: 50 };
export const fetchAlerts = () => apiFetch('/alerts');
export const createAlert = (body) => apiFetch('/alerts', { method: 'POST', body: JSON.stringify(body) });
export const updateAlert = (id, body) => apiFetch('/alerts/' + id, { method: 'PUT', body: JSON.stringify(body) });
export const deleteAlert = (id) => apiFetch('/alerts/' + id, { method: 'DELETE' });
export const unsubscribeAlert = (a, t) => apiFetch('/alerts/unsubscribe', { method: 'POST', body: JSON.stringify({ a, t }) });

// ---- Ratings ------------------------------------------------------------
export const RATING_COMMENT_MAX = 280;
export const RATING_REPORT_REASONS = [
  { value: 'harassment', get label() { return t('reason.harassmentInsults'); } },
  { value: 'offensive', get label() { return t('reason.offensiveLanguage'); } },
  { value: 'spam', get label() { return t('reason.spamAds'); } },
  { value: 'fake', get label() { return t('reason.fake'); } },
  { value: 'other', get label() { return t('reason.other'); } },
];
export const ratingReasonLabel = (v) => (RATING_REPORT_REASONS.find((r) => r.value === v) || { label: v }).label;
export const fetchConversationRating = (id) => apiFetch('/ratings/conversations/' + id);
export const saveRating = (id, stars, comment) => apiFetch('/ratings/conversations/' + id, { method: 'PUT', body: JSON.stringify({ stars, comment }) });
export const deleteRating = (id) => apiFetch('/ratings/conversations/' + id, { method: 'DELETE' });
export const fetchPersonRatings = (id, page) => apiFetch('/ratings/users/' + id + '?page=' + (page || 1));
export const reportRating = (id, reason, note) => apiFetch('/ratings/' + id + '/report', { method: 'POST', body: JSON.stringify({ reason, note: note || undefined }) });
export const fetchRatingReportQueue = () => apiFetch('/admin/ratings/reports');
export const moderateRating = (id, action, note) => apiFetch('/admin/ratings/' + id + '/moderate', { method: 'POST', body: JSON.stringify({ action, note: note || undefined }) });

// ---- QR flyers & scan counts ---------------------------------------------
export const fetchPrintInfo = (postId) => apiFetch('/post/' + postId + '/print');
export function printAssetUrl(postId, file, params) {
  const q = Object.keys(params || {}).filter((k) => params[k] !== undefined && params[k] !== null).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
  return '/api/post/' + postId + '/print/' + file + (q ? '?' + q : '');
}
