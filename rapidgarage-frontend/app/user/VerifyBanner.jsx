import React from 'react';
import { MailWarning } from 'lucide-react';
import { apiFetch, errorMessage } from '../api';
import { Spinner } from '../components/ui';
import toast from '../components/toast';
import { t } from '../i18n';

// "Confirm your email" reminder for new accounts that haven't yet (posting
// and messaging wait for it; see the backend's lib/emailVerify.js).
export default class VerifyBanner extends React.Component {
  constructor(props) {
    super(props);
    this.state = { busy: false, sent: false };
  }

  resend() {
    this.setState({ busy: true });
    apiFetch('/verify-email/send', { method: 'POST' }).then(({ ok, data }) => {
      this.setState({ busy: false });
      if (!ok) return toast.error(errorMessage(data, t('verify.failed')));
      if (data.status === 'verified') { if (this.props.onVerified) this.props.onVerified(); return null; }
      this.setState({ sent: true });
      return toast.success(t('verify.sent', { email: this.props.user.email }));
    }).catch(() => { this.setState({ busy: false }); toast.error(t('common.networkShort')); });
  }

  render() {
    const { user } = this.props;
    return (
      <div className="verify-banner" role="status">
        <MailWarning size={18} aria-hidden="true" />
        <span>{t('verify.banner', { email: user.email })}</span>
        <button type="button" className="btn btn-secondary btn-sm" disabled={this.state.busy} onClick={() => this.resend()}>
          {this.state.busy ? <Spinner /> : null}{this.state.sent ? t('verify.resendAgain') : t('verify.resend')}
        </button>
      </div>
    );
  }
}
