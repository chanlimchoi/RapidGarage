// Multi-language listings helpers (pure; no imports so node tests can load them).

// A listing needs the language badge when it records a language that differs
// from the reader's app language.
export function differs(postLanguage, uiLanguage) {
  return !!postLanguage && !!uiLanguage && postLanguage !== uiLanguage;
}

// "ko" shown in the reader's language ("Korean", "coreano"...), via
// Intl.DisplayNames; falls back to the given names, then the code.
export function languageName(code, intl, fallback) {
  try {
    const dn = new Intl.DisplayNames([intl || 'en-US'], { type: 'language', fallback: 'none' });
    const n = dn.of(code);
    if (n && n !== code) return n.charAt(0).toLocaleUpperCase(intl) + n.slice(1);
  } catch (e) { /* older browsers */ }
  return (fallback && fallback[code]) || code;
}

// The post as shown: translated title, description and item names (matched by
// id so live item updates keep their state), or the post itself.
export function applyTranslation(post, tr) {
  if (!post || !tr || !tr.translated) return post;
  const names = new Map((tr.items || []).map((i) => [i.id, i.name]));
  return Object.assign({}, post, {
    title: tr.title || post.title,
    description: post.description ? (tr.description || post.description) : post.description,
    items: (post.items || []).map((i) => (names.has(i.id) ? Object.assign({}, i, { name: names.get(i.id) }) : i)),
  });
}

// Message key for a translation that came back untranslated.
export function failureKey(reason) {
  if (reason === 'too_long') return 'lang.tooLong';
  if (reason === 'same') return null;
  return 'lang.failed';
}
