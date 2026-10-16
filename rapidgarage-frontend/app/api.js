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
