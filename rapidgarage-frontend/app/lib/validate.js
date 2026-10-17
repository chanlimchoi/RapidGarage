// Client-side mirrors of the server's rules (rapidgarage-backend/lib/validate.js),
// used for inline, as-you-go form errors. The server still has the final say.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const ZIP_RE = /^\d{5}(-\d{4})?$/;

export const rules = {
  email: (v) => (!v || !v.trim() ? 'Enter your email address.' : !EMAIL_RE.test(v.trim()) ? 'Enter a valid email, like name@example.com.' : ''),
  required: (label) => (v) => (!v || !String(v).trim() ? label + ' is required.' : ''),
  password: (v) => (!v ? 'Enter a password.' : v.length < 8 ? 'Use at least 8 characters.' : ''),
  zip: (v) => (!v || !v.trim() ? 'Zip code is required.' : !ZIP_RE.test(v.trim()) ? 'Use a 5-digit zip code, like 10001.' : ''),
  title: (v) => (!v || !v.trim() ? 'Give your sale a title.' : v.trim().length > 255 ? 'Keep the title under 255 characters.' : ''),
};

// Run { field: validator } over values. Returns { field: message } for failures.
export function validateAll(values, schema) {
  const errors = {};
  Object.keys(schema).forEach((k) => {
    const msg = schema[k](values[k], values);
    if (msg) errors[k] = msg;
  });
  return errors;
}

// Map the server's { error: { details: { field: msg } } } onto form fields.
export function serverFieldErrors(data, aliases) {
  const details = data && data.error && data.error.details;
  if (!details || typeof details !== 'object') return {};
  const out = {};
  Object.keys(details).forEach((k) => { out[(aliases && aliases[k]) || k] = details[k]; });
  return out;
}

// Focus the first invalid field so keyboard and screen-reader users land on it.
export function focusFirstError(form, errors) {
  if (!form) return;
  // DOM order, not schema order, so focus lands on the topmost bad field.
  const els = Array.prototype.slice.call(form.querySelectorAll('[name]'));
  const el = els.find((e) => Object.prototype.hasOwnProperty.call(errors, e.name) && errors[e.name]);
  if (el && el.focus) el.focus();
}
