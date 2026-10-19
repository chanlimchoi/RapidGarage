import React from 'react';
import { Link } from 'react-router-dom';
import { NO_SAVE } from '../user/AiKeySettings';
import PasswordInput from '../user/PasswordInput';
import { t } from '../i18n';

// Which Anthropic key the next AI request uses, as the server will choose it
// (backend lib/aiAccess.js): a one-time key typed here, else the seller's
// saved key, else the site's. null = no way to call the AI.
export function keySource(config, saved, useOnce) {
  const c = config || {};
  if (c.userAiKeys && useOnce) return 'one_time';
  if (c.userAiKeys && saved && saved.hasKey) return 'saved';
  if (c.aiSiteKey) return 'site';
  return c.userAiKeys ? 'one_time' : null;
}

// The key picker shared by "Draft items from photos" and "Write with AI".
// Controlled: props config, saved ({ hasKey, last4 }), useOnce, oneTimeKey,
// onChange(patch) with { useOnce?, oneTimeKey? }, id (unique per page).
// The parent clears oneTimeKey from its state as soon as it sends it.
export default function AiKeyChoice({ config, saved, useOnce, oneTimeKey, onChange, id }) {
  const c = config || {};
  const src = keySource(c, saved, useOnce);
  const canChoose = c.userAiKeys && (c.aiSiteKey || (saved && saved.hasKey));
  const inputId = id + '-once-key';
  return (
    <div className="ai-key-choice small">
      {src === 'saved' ? <p>{t('aikey.usesSaved', { last4: saved.last4 })}</p> : null}
      {src === 'site' ? <p className="muted">{t('aikey.usesSite')}</p> : null}
      {src === 'one_time' ? (
        <div className="stack">
          <label htmlFor={inputId} className="field-label">{t('aikey.onceLabel')}</label>
          <PasswordInput id={inputId} name={'rg-' + id + '-once'} placeholder="sk-ant-…" value={oneTimeKey} {...NO_SAVE}
            aria-describedby={inputId + '-hint'} onChange={(e) => onChange({ oneTimeKey: e.target.value })} />
          <span id={inputId + '-hint'} className="field-hint">{t('aikey.onceHint')}</span>
        </div>
      ) : null}
      <div className="row ai-key-links">
        {canChoose ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange({ useOnce: !useOnce, oneTimeKey: '' })}>
            {useOnce ? t('aikey.cancelOnce') : t('aikey.useOnce')}
          </button>
        ) : null}
        {c.userAiKeys && c.userAiKeySave ? <Link className="btn btn-ghost btn-sm" to="/settings#ai-key">{saved && saved.hasKey ? t('aikey.manage') : t('aikey.saveInSettings')}</Link> : null}
      </div>
    </div>
  );
}
