import React from 'react';
import { Languages } from 'lucide-react';
import { LOCALES, locale, t } from '../i18n';
import { chooseLocale } from '../i18n/prefs';

// Language switcher. variant "select" (nav bar) or "segmented" (Settings).
// Each language is labelled in its own language, with lang= so screen readers
// pronounce it correctly.
export default function LanguagePicker({ id, user, variant, onChosen }) {
  const current = locale();
  const pick = (code) => {
    if (code === current) return;
    chooseLocale(code, user).then(() => onChosen && onChosen(code));
  };
  if (variant === 'segmented') {
    return (
      <div className="segmented language-picker" role="group" aria-label={t('nav.language')} id={id}>
        {LOCALES.map((l) => (
          <button key={l.code} type="button" lang={l.code} aria-pressed={current === l.code} onClick={() => pick(l.code)}>{l.name}</button>
        ))}
      </div>
    );
  }
  return (
    <label className="language-select" htmlFor={id}>
      <Languages size={16} aria-hidden="true" />
      <span className="sr-only">{t('nav.language')}</span>
      <select id={id} value={current} onChange={(e) => pick(e.target.value)}>
        {LOCALES.map((l) => <option key={l.code} value={l.code} lang={l.code}>{l.name}</option>)}
      </select>
    </label>
  );
}
