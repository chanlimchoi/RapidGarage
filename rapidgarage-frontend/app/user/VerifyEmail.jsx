import React from 'react';
import { Link } from 'react-router-dom';
import { MailCheck, AlertCircle } from 'lucide-react';
import { apiFetch, errorMessage } from '../api';
import { EmptyState, SkeletonBlock } from '../components/ui';
import { t } from '../i18n';

// The link from the confirmation email: /verify-email?t=<token>. Works whether
// or not this browser is logged in (the email may be opened on another device).
export default class VerifyEmail extends React.Component {
  constructor(props) {
    super(props);
    this.state = { status: 'working', error: '' };
  }

  componentDidMount() {
    const token = new URLSearchParams(this.props.location.search).get('t');
    if (!token) return this.setState({ status: 'error', error: t('verify.invalid') });
    return apiFetch('/verify-email/confirm', { method: 'POST', body: JSON.stringify({ token }) }).then(({ ok, data }) => {
      if (!ok) return this.setState({ status: 'error', error: errorMessage(data, t('verify.invalid')) });
      if (this.props.onAuthChange) this.props.onAuthChange();
      return this.setState({ status: 'done' });
    }).catch(() => this.setState({ status: 'error', error: t('common.network') }));
  }

  render() {
    const s = this.state;
    let body;
    if (s.status === 'working') body = <SkeletonBlock lines={2} />;
    else if (s.status === 'done') body = <EmptyState level={1} icon={MailCheck} title={t('verify.doneTitle')} action={<Link className="btn btn-primary" to="/newpost">{t('nav.postSale')}</Link>}>{t('verify.doneText')}</EmptyState>;
    else body = <EmptyState level={1} icon={AlertCircle} title={t('verify.failedTitle')} action={<Link className="btn btn-primary" to="/">{t('nav.browseSales')}</Link>}>{s.error}</EmptyState>;
    return <div className="container container-narrow" aria-live="polite">{body}</div>;
  }
}
