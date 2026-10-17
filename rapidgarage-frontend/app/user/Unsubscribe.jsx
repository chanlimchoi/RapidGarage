import React from 'react';
import { Link } from 'react-router-dom';
import { BellOff, AlertCircle } from 'lucide-react';
import { unsubscribeAlert, errorMessage } from '../api';
import { EmptyState, SkeletonBlock } from '../components/ui';
import { t } from '../i18n';

// Landing page for the email's "Turn off this alert" link. It POSTs from the
// browser, so link scanners that only GET the URL never unsubscribe anyone.
export default class Unsubscribe extends React.Component {
  constructor(props) {
    super(props);
    this.state = { status: 'working', alert: null, error: '' };
  }

  componentDidMount() {
    const q = new URLSearchParams(this.props.location.search);
    const a = q.get('a');
    const token = q.get('t');
    if (!a || !token) return this.setState({ status: 'error', error: t('unsub.incomplete') });
    unsubscribeAlert(a, token).then(({ ok, data }) => {
      if (!ok) return this.setState({ status: 'error', error: errorMessage(data, t('unsub.invalid')) });
      this.setState({ status: data.gone ? 'gone' : 'done', alert: data.alert || null });
    }).catch(() => this.setState({ status: 'error', error: t('unsub.network') }));
  }

  render() {
    const s = this.state;
    const manage = <Link className="btn btn-primary" to="/settings#alerts">{t('unsub.manage')}</Link>;
    let body;
    if (s.status === 'working') body = <SkeletonBlock lines={2} />;
    else if (s.status === 'error') body = <EmptyState icon={AlertCircle} title={t('unsub.failedTitle')} action={manage}>{s.error} {t('unsub.failedText')}</EmptyState>;
    else if (s.status === 'gone') body = <EmptyState icon={BellOff} title={t('unsub.goneTitle')} action={manage}>{t('unsub.goneText')}</EmptyState>;
    else {
      const name = s.alert && s.alert.label ? t('unsub.quoted', { label: s.alert.label }) : t('unsub.thisAlert');
      body = <EmptyState icon={BellOff} title={t('unsub.doneTitle')} action={manage}>{t('unsub.doneText', { name })}</EmptyState>;
    }
    return <div className="container container-narrow rg-unsubscribe" aria-live="polite">{body}</div>;
  }
}
