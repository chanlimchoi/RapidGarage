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

// ---- Passwords (forgot / reset / change) --------------------------------
export const requestPasswordReset = (email) => apiFetch('/password-reset', { method: 'POST', body: JSON.stringify({ email }) });
export const checkPasswordReset = (token) => apiFetch('/password-reset/check', { method: 'POST', body: JSON.stringify({ token }) });
export const confirmPasswordReset = (token, password) => apiFetch('/password-reset/confirm', { method: 'POST', body: JSON.stringify({ token, password }) });
export const fetchPasswordStatus = () => apiFetch('/me/password');
export const changePassword = (currentPassword, newPassword) => apiFetch('/me/password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) });

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
// alts (optional): a description per file, saved right after the upload.
export function uploadPhotos(postId, files, alts) {
  const form = new FormData();
  files.forEach((f) => form.append('photos', f, f.name));
  return fetch('/api/post/' + postId + '/photos', { method: 'POST', body: form, credentials: 'same-origin', headers: { 'Accept-Language': locale() } })
    .then((response) => response.text().then((text) => {
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
      return { ok: response.ok, status: response.status, data };
    }))
    .then((up) => {
      if (!up.ok || !Array.isArray(up.data) || !alts) return up;
      const todo = up.data.map((p, i) => [p, (alts[i] || '').trim()]).filter(([, a]) => a);
      return Promise.all(todo.map(([p, a]) => savePhotoAlt(postId, p.id, a).then((r) => { if (r.ok) p.alt = r.data.alt; return r.ok; })))
        .then((oks) => Object.assign(up, { altFailed: oks.some((x) => !x) }))
        .catch(() => Object.assign(up, { altFailed: true }));
    });
}

// The seller's description of a photo (empty: back to the default text).
export function savePhotoAlt(postId, photoId, alt) {
  return apiFetch('/post/' + postId + '/photos/' + photoId, { method: 'PUT', body: JSON.stringify({ alt: alt || null }) });
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

// Free stuff at the curb (backend controllers/curb.js).
export const createCurbPost = (body) => apiFetch('/curb', { method: 'POST', body: JSON.stringify(body) });
export const endCurbPost = (id) => apiFetch('/curb/' + id + '/end', { method: 'POST' });
export const fetchCurbAlert = () => apiFetch('/curb/alert');
export const saveCurbAlert = (body) => apiFetch('/curb/alert', { method: 'PUT', body: JSON.stringify(body) });
export const deleteCurbAlert = () => apiFetch('/curb/alert', { method: 'DELETE' });

// Individual items matching the words (backend controllers/search.js /items).
export function searchItems(params) {
  const qs = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&');
  return apiFetch('/search/items?' + qs);
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
// { itemIds, pickupAt? } : ask for a bundle deal (lib/bundles.js).
export const requestBundle = (conversationId, body) => apiFetch('/conversations/' + conversationId + '/bundles', { method: 'POST', body: JSON.stringify(body) });
export const holdAction = (holdId, action, body) => apiFetch('/holds/' + holdId + '/' + action, { method: 'POST', body: JSON.stringify(body || {}) });
// Meetup suggestions (see the backend's lib/meetups.js).
export const fetchMeetups = (conversationId) => apiFetch('/conversations/' + conversationId + '/meetups');
export const fetchMeetupSpots = (conversationId) => apiFetch('/conversations/' + conversationId + '/meetup-spots');
export const searchMeetupPlaces = (conversationId, q) => apiFetch('/conversations/' + conversationId + '/meetup-places?q=' + encodeURIComponent(q));
export const proposeMeetup = (conversationId, body) => apiFetch('/conversations/' + conversationId + '/meetups', { method: 'POST', body: JSON.stringify(body) });
export const meetupAction = (id, action, body) => apiFetch('/meetups/' + id + '/' + action, { method: 'POST', body: JSON.stringify(body || {}) });
// Pickup scheduling after an accepted hold (see the backend's lib/pickups.js).
export const fetchPickup = (conversationId) => apiFetch('/conversations/' + conversationId + '/pickup');
export const offerPickup = (conversationId, body) => apiFetch('/conversations/' + conversationId + '/pickup', { method: 'POST', body: JSON.stringify(body) });
export const pickupAction = (conversationId, action, body) => apiFetch('/conversations/' + conversationId + '/pickup/' + action, { method: 'POST', body: JSON.stringify(body || {}) });
export const fetchUpcomingPickups = () => apiFetch('/pickups/upcoming');
// Rain checks (backend lib/weather.js, lib/rainChecks.js).
export const fetchSaleWeather = (postId) => apiFetch('/post/' + postId + '/weather');
export const postponeSale = (postId, body) => apiFetch('/post/' + postId + '/postpone', { method: 'POST', body: JSON.stringify(body) });
export const dismissRainCheck = (postId, date) => apiFetch('/post/' + postId + '/rain-check/dismiss', { method: 'POST', body: JSON.stringify({ date }) });
export const fetchRainChecks = () => apiFetch('/dashboard/rain-checks');
// Admin: safe meetup spots.
export const adminSpots = (q) => apiFetch('/admin/meetup-spots' + (q ? '?q=' + encodeURIComponent(q) : ''));
export const adminSaveSpot = (id, body) => apiFetch('/admin/meetup-spots' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
export const adminDeleteSpot = (id) => apiFetch('/admin/meetup-spots/' + id, { method: 'DELETE' });
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

// ---- neighborhood sales (controllers/events.js) ----
export const EVENT_RADII = [0.25, 0.5, 1, 2, 3, 5];
export const EVENT_MAX_DAYS = 7;
const qs = (params) => Object.keys(params || {}).filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
  .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
const jsonBody = (method, body) => ({ method, body: JSON.stringify(body || {}) });
export const fetchEvents = (params) => apiFetch('/events' + (params ? '?' + qs(params) : ''));
export const fetchMyEvents = () => apiFetch('/events/mine');
export const fetchEvent = (id) => apiFetch('/events/' + id);
export const createEvent = (body) => apiFetch('/events', jsonBody('POST', body));
export const updateEvent = (id, body) => apiFetch('/events/' + id, jsonBody('PUT', body));
export const deleteEvent = (id) => apiFetch('/events/' + id, { method: 'DELETE' });
export const joinEvent = (id, postId) => apiFetch('/events/' + id + '/join', jsonBody('POST', { postId }));
export const approveParticipant = (id, postId) => apiFetch('/events/' + id + '/participants/' + postId + '/approve', jsonBody('POST'));
export const removeParticipant = (id, postId) => apiFetch('/events/' + id + '/participants/' + postId, { method: 'DELETE' });
export const reportEvent = (id, reason, note) => apiFetch('/events/' + id + '/report', jsonBody('POST', { reason, note: note || undefined }));
export const fetchEventPrint = (id) => apiFetch('/events/' + id + '/print');
export const eventsForPost = (postId) => apiFetch('/events/for-post/' + postId);
export const fetchEventReports = () => apiFetch('/admin/events/reports');
export const moderateEvent = (id, action, note) => apiFetch('/admin/events/' + id + '/moderate', jsonBody('POST', { action, note: note || undefined }));
export function eventAssetUrl(eventId, file, params) {
  const q = qs(params);
  return '/api/events/' + eventId + '/' + file + (q ? '?' + q : '');
}

// ---- Seller dashboard ----------------------------------------------------
export const fetchDashboard = (tz) => apiFetch('/dashboard' + (tz ? '?tz=' + encodeURIComponent(tz) : ''));
export const fetchDashboardSale = (id) => apiFetch('/dashboard/sales/' + id);
// Sale page view beacon. The server decides whether it counts (never the seller,
// admins, bots, prefetches or hidden sales) and stores no visitor data.
export const recordView = (postId) => apiFetch('/post/' + postId + '/view', { method: 'POST' }).catch(() => null);

// ---- Wanted posts (controllers/wanted.js) ----------------------------------
export const fetchWantedBoard = (params) => apiFetch('/wanted' + (params && qs(params) ? '?' + qs(params) : ''));
export const fetchMyWanted = () => apiFetch('/wanted/mine');
export const fetchWanted = (id) => apiFetch('/wanted/' + id);
export const createWanted = (body) => apiFetch('/wanted', jsonBody('POST', body));
export const updateWanted = (id, body) => apiFetch('/wanted/' + id, jsonBody('PUT', body));
export const renewWanted = (id, days) => apiFetch('/wanted/' + id + '/renew', jsonBody('POST', { days }));
export const fulfillWanted = (id) => apiFetch('/wanted/' + id + '/fulfill', jsonBody('POST'));
export const deleteWanted = (id) => apiFetch('/wanted/' + id, { method: 'DELETE' });
export const reportWanted = (id, reason, note) => apiFetch('/wanted/' + id + '/report', jsonBody('POST', { reason, note: note || undefined }));
export const contactWanted = (wantedId) => apiFetch('/conversations', jsonBody('POST', { wantedId }));
export const unsubscribeWanted = (w, token) => apiFetch('/wanted/unsubscribe', jsonBody('POST', { w, t: token }));
export const fetchWantedReports = () => apiFetch('/admin/wanted/reports');
export const moderateWanted = (id, action, note) => apiFetch('/admin/wanted/' + id + '/moderate', jsonBody('POST', { action, note: note || undefined }));
// { count, wantedMatches } for the nav badges, or null.
export function fetchBadges() {
  return apiFetch('/conversations/unread')
    .then(({ ok, data }) => (ok && data ? { count: data.count, wantedMatches: data.wantedMatches || 0, reminders: data.reminders || 0, notifications: data.notifications || 0 } : null))
    .catch(() => null);
}

// ---- Route planner (controllers/route.js) ----------------------------------
export const planRoute = (body) => apiFetch('/route', jsonBody('POST', body));

// ---- In-app notifications (controllers/notifications.js) --------------------
export const fetchNotifications = () => apiFetch('/notifications');
export const markNotificationsSeen = (ids) => apiFetch('/notifications/seen', jsonBody('POST', ids ? { ids } : {}));

// ---- Free on the curb (controllers/curbside.js) ------------------------------
// Each answers { id, items, curbside } for the caller, to merge into the post.
export const startCurbside = (postId, body) => apiFetch('/post/' + postId + '/curbside', jsonBody('PUT', body));
export const stopCurbside = (postId) => apiFetch('/post/' + postId + '/curbside', { method: 'DELETE' });
export const markCurbTaken = (postId, itemId) => apiFetch('/post/' + postId + '/curbside/taken', jsonBody('POST', itemId ? { itemId } : {}));
export const undoCurbTaken = (postId, itemId) => apiFetch('/post/' + postId + '/curbside/undo', jsonBody('POST', itemId ? { itemId } : {}));

// ---- Morning-of reminders (controllers/reminders.js, controllers/saved.js) -----
export const setSavedReminder = (postId, on) => apiFetch('/saved/' + postId + '/reminder', jsonBody('PUT', { on }));
export const fetchReminderSettings = () => apiFetch('/reminders/settings');
export const saveReminderSettings = (body) => apiFetch('/reminders/settings', jsonBody('PUT', body));
export const fetchTodayReminders = () => apiFetch('/reminders/today');
export const markReminderSeen = (id) => apiFetch('/reminders/' + id + '/seen', jsonBody('POST', {}));
export const unsubscribeReminders = (r, token) => apiFetch('/reminders/unsubscribe', jsonBody('POST', { r, t: token }));

// ---- Item drafts from photos (lib/aiItems.js on the server) ----------------
// oneTimeKey: an Anthropic key used for this one request and never saved.
export const suggestItems = (postId, photoIds, oneTimeKey) => apiFetch('/post/' + postId + '/items/suggest', jsonBody('POST', Object.assign(photoIds ? { photoIds } : {}, oneTimeKey ? { oneTimeKey } : {})));
// Own Anthropic key, saved encrypted (only the last 4 characters come back).
export const fetchAiKey = () => apiFetch('/me/ai-key');
export const saveAiKey = (key, currentPassword) => apiFetch('/me/ai-key', jsonBody('PUT', { key, currentPassword: currentPassword || undefined }));
export const deleteAiKey = () => apiFetch('/me/ai-key', { method: 'DELETE' });
export const addItemsBulk = (postId, items) => apiFetch('/post/' + postId + '/items/bulk', jsonBody('POST', { items }));
// Seller tools (backend lib/sellerTools.js): AI title & description, duplicate, summary.
export const describeSale = (postId, oneTimeKey) => apiFetch('/post/' + postId + '/describe', jsonBody('POST', oneTimeKey ? { oneTimeKey } : {}));
export const duplicateSale = (postId) => apiFetch('/post/' + postId + '/duplicate', { method: 'POST' });
export const fetchSaleSummary = (postId) => apiFetch('/post/' + postId + '/summary');
export const fetchSaleReport = (postId) => apiFetch('/post/' + postId + '/report');

// ---- Following sellers (lib/follows.js on the server) ----------------------
export const fetchFollows = () => apiFetch('/follows');
export const fetchFollowStatus = (sellerId) => apiFetch('/follows/' + sellerId);
export const setFollowing = (sellerId, on) => apiFetch('/follows/' + sellerId, on ? jsonBody('PUT', {}) : { method: 'DELETE' });
export const setFollowEmails = (sellerId, notify) => apiFetch('/follows/' + sellerId, jsonBody('PUT', { notify }));
export const unsubscribeFollow = (f, token) => apiFetch('/follows/unsubscribe', jsonBody('POST', { f, t: token }));

// ---- Share button (controllers/post.js POST /post/:id/share) ------------------
// Fire-and-forget; counted once per person per day for the seller dashboard.
export function recordShare(postId, channel) {
  try { return apiFetch('/post/' + postId + '/share', { method: 'POST', body: JSON.stringify({ channel }), keepalive: true }).catch(() => null); } catch (e) { return Promise.resolve(null); }
}

// Photo-to-listing: a title, category and price range suggested from one photo
// (and the title typed so far). Nothing is saved; the seller accepts or edits.
export function suggestListing(file, hint) {
  const form = new FormData();
  if (file) form.append('photo', file, file.name);
  if (hint) form.append('hint', String(hint).slice(0, 255));
  return fetch('/api/post/suggest', { method: 'POST', body: form, credentials: 'same-origin', headers: { 'Accept-Language': locale() } })
    .then((response) => response.text().then((text) => {
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
      return { ok: response.ok, status: response.status, data };
    }));
}

// "This weekend" calendar (GET /calendar): see rapidgarage-backend/controllers/saleCalendar.js.
export const fetchCalendar = (params) => {
  const q = new URLSearchParams();
  Object.keys(params || {}).forEach((k) => { if (params[k] !== undefined && params[k] !== null && params[k] !== '') q.set(k, String(params[k])); });
  return apiFetch('/calendar?' + q.toString());
};
