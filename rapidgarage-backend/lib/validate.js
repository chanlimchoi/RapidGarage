const { validatePrice } = require('./price');
const { validateMarkdown } = require('./markdown');
const { validateBundle } = require('./bundles');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZIP_RE = /^\d{5}(-\d{4})?$/;

const isStr = (v) => typeof v === 'string';
const blank = (v) => v === undefined || v === null || (isStr(v) && v.trim() === '');

function validateSignup(body) {
  const errors = {};
  if (!isStr(body.email) || !EMAIL_RE.test(body.email.trim())) errors.email = 'A valid email is required.';
  if (!isStr(body.password) || body.password.length < 8) errors.password = 'Password must be at least 8 characters.';
  if (!isStr(body.firstName) || blank(body.firstName)) errors.firstName = 'First name is required.';
  if (!blank(body.lastName) && !isStr(body.lastName)) errors.lastName = 'Last name must be text.';
  return errors;
}

const POST_FIELDS = ['title', 'street', 'city', 'state', 'zipCode', 'description', 'imagesUrl', 'startDate', 'endDate'];

// partial=true for updates: only validate fields that are present.
// existing: the stored post (updates), so price rules see the final values.
function validatePost(body, partial, existing) {
  const errors = {};
  const out = {};
  for (const f of POST_FIELDS) {
    if (body[f] === undefined) continue;
    if (f === 'startDate' || f === 'endDate') {
      if (body[f] === null || body[f] === '') { out[f] = null; continue; }
      const d = new Date(body[f]);
      if (!isStr(body[f]) || isNaN(d.getTime())) errors[f] = 'Must be a valid date.';
      else out[f] = d;
      continue;
    }
    if (body[f] !== null && !isStr(body[f])) { errors[f] = 'Must be text.'; continue; }
    out[f] = isStr(body[f]) ? body[f].trim() : body[f];
  }
  if (!partial || out.title !== undefined) {
    if (blank(out.title)) errors.title = 'Title is required.';
    else if (out.title.length > 255) errors.title = 'Title is too long.';
  }
  if (!partial || out.zipCode !== undefined) {
    if (!isStr(out.zipCode) || !ZIP_RE.test(out.zipCode)) errors.zipCode = 'A 5-digit zip code is required.';
  }
  if (out.startDate && out.endDate && out.endDate < out.startDate) errors.endDate = 'End date must be after start date.';
  const price = validatePrice(body, existing);
  Object.assign(errors, price.errors);
  Object.assign(out, price.values);
  const markdown = validateMarkdown(body, existing);
  Object.assign(errors, markdown.errors);
  Object.assign(out, markdown.values);
  if (body.category !== undefined) {
    const { CATEGORY_KEYS } = require('./wanted');
    if (body.category === null || body.category === '') out.category = null;
    else if (CATEGORY_KEYS.indexOf(body.category) === -1) errors.category = 'Choose one of the categories.';
    else out.category = body.category;
  }
  const bundle = validateBundle(body, existing);
  Object.assign(errors, bundle.errors);
  Object.assign(out, bundle.values);
  const early = require('./earlyBird').validate(body);
  Object.assign(errors, early.errors);
  Object.assign(out, early.values);
  return { errors, values: out };
}

module.exports = { validateSignup, validatePost, ZIP_RE, EMAIL_RE };
