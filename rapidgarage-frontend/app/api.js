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
  opts.headers = Object.assign({ 'Accept': 'application/json' }, opts.body ? { 'Content-Type': 'application/json' } : {}, opts.headers || {});
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
  return fetch('/api/post/' + postId + '/photos', { method: 'POST', body: form, credentials: 'same-origin' })
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
