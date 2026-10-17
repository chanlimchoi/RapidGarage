import React from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Camera, Search, Store } from 'lucide-react';
import { t } from '../i18n';

const FEATURES = [
  [Search, 'about.f1.title', 'about.f1.text'],
  [Camera, 'about.f2.title', 'about.f2.text'],
  [MapPin, 'about.f3.title', 'about.f3.text'],
];

export default function About() {
  return (
    <div className="container container-narrow">
      <header className="page-header"><div><h1>{t('about.title')}</h1><p>{t('about.lead')}</p></div></header>
      <div className="stack">
        {FEATURES.map(([Icon, title, text]) => (
          <div key={title} className="panel row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
            <span className="empty-icon" style={{ margin: 0, width: 44, height: 44, flex: 'none' }}><Icon size={20} aria-hidden="true" /></span>
            <div><h2 className="h4" style={{ marginBottom: 4 }}>{t(title)}</h2><p className="muted" style={{ margin: 0 }}>{t(text)}</p></div>
          </div>
        ))}
        <div className="form-actions"><Link className="btn btn-primary" to="/newpost"><Store size={16} aria-hidden="true" />{t('nav.postSale')}</Link><Link className="btn btn-secondary" to="/">{t('nav.browseSales')}</Link></div>
      </div>
    </div>
  );
}
