import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, MapPin, Search, Wallet, Lock, Flag, MessageCircle } from 'lucide-react';
import { t } from '../i18n';

// /safety: buying and selling safely. Linked from the footer, every
// conversation, the hold flow and the meetup dialog.
const SECTIONS = [
  ['meet', MapPin, 'safety.meet.title', ['safety.meet.1', 'safety.meet.2', 'safety.meet.3', 'safety.meet.4', 'safety.meet.5']],
  ['inspect', Search, 'safety.inspect.title', ['safety.inspect.1', 'safety.inspect.2']],
  ['pay', Wallet, 'safety.pay.title', ['safety.pay.1', 'safety.pay.2', 'safety.pay.3', 'safety.pay.4', 'safety.pay.5']],
  ['privacy', Lock, 'safety.privacy.title', ['safety.privacy.1', 'safety.privacy.2', 'safety.privacy.3']],
  ['report', Flag, 'safety.report.title', ['safety.report.1', 'safety.report.2', 'safety.report.3']],
];

export default class SafetyPage extends React.Component {
  componentDidMount() {
    document.title = t('safety.title') + ' · RapidGarage';
    const id = (window.location.hash || '').slice(1);
    const el = id && document.getElementById('safety-' + id);
    if (el && el.scrollIntoView) el.scrollIntoView();
  }
  render() {
    return (
      <div className="container container-narrow safety-page">
        <header className="page-header"><div><h1><ShieldCheck size={26} aria-hidden="true" className="safety-h1-icon" />{t('safety.title')}</h1><p>{t('safety.lead')}</p></div></header>
        <div className="stack">
          {SECTIONS.map(([key, Icon, title, items]) => (
            <section key={key} id={'safety-' + key} className="panel safety-section" aria-labelledby={'safety-' + key + '-h'}>
              <h2 id={'safety-' + key + '-h'} className="h4"><span className="safety-icon" aria-hidden="true"><Icon size={18} /></span>{t(title)}</h2>
              <ul>{items.map((k) => <li key={k}>{t(k)}</li>)}</ul>
            </section>
          ))}
          <p className="small muted">{t('safety.emergency')}</p>
          <div className="form-actions"><Link className="btn btn-primary" to="/messages"><MessageCircle size={16} aria-hidden="true" />{t('safety.toMessages')}</Link><Link className="btn btn-secondary" to="/">{t('nav.browseSales')}</Link></div>
        </div>
      </div>
    );
  }
}
