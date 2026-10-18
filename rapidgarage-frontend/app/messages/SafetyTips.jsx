import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, X } from 'lucide-react';
import { t } from '../i18n';

// Short tips at the top of a new conversation; dismissed per conversation
// (remembered on this device only).
export default function SafetyTips({ onDismiss }) {
  return (
    <aside className="safety-tips" aria-labelledby="safety-tips-title">
      <div className="safety-tips-head">
        <h3 id="safety-tips-title"><ShieldCheck size={16} aria-hidden="true" />{t('safetyTips.title')}</h3>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={t('safetyTips.hide')} onClick={onDismiss}><X size={16} aria-hidden="true" /></button>
      </div>
      <ul>
        <li>{t('safetyTips.t1')}</li>
        <li>{t('safetyTips.t2')}</li>
        <li>{t('safetyTips.t3')}</li>
        <li>{t('safetyTips.t4')}</li>
      </ul>
      <Link to="/safety" className="small">{t('safetyTips.more')}</Link>
    </aside>
  );
}

// "Safety tips" link shown in every conversation and on the hold flow.
export function SafetyLink({ className, hash }) {
  return <Link to={'/safety' + (hash ? '#' + hash : '')} className={'safety-link ' + (className || '')}><ShieldCheck size={14} aria-hidden="true" />{t('safety.link')}</Link>;
}
