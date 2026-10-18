import React from 'react';
import { Link } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { requestPasswordReset, errorMessage } from '../api';
import { Field, Alert, EmptyState, Spinner } from '../components/ui';
import { rules, validateAll, focusFirstError } from '../lib/validate';
import { t } from '../i18n';

const SCHEMA = { email: rules.email };

// Step 1 of a password reset: ask for the account's email. The server answers
// the same way whether or not the email has an account, and so does this page.
export default class ForgotPassword extends React.Component {
  constructor(props) {
    super(props);
    this.state = { email: '', touched: false, submitted: false, busy: false, error: '', sentTo: null, minutes: 60 };
    this.formRef = React.createRef();
    this.submit = this.submit.bind(this);
  }

  submit(e) {
    e.preventDefault();
    const errors = validateAll({ email: this.state.email }, SCHEMA);
    this.setState({ submitted: true });
    if (Object.keys(errors).length) return focusFirstError(this.formRef.current, errors);
    const email = this.state.email.trim();
    this.setState({ busy: true, error: '' });
    requestPasswordReset(email).then(({ ok, data }) => {
      if (!ok) return this.setState({ busy: false, error: errorMessage(data, t('forgot.failed')) });
      this.setState({ busy: false, sentTo: email, minutes: (data && data.expiresInMinutes) || 60 });
    }).catch(() => this.setState({ busy: false, error: t('common.network') }));
  }

  render() {
    const s = this.state;
    if (s.sentTo) {
      return (
        <div className="container container-narrow" aria-live="polite">
          <EmptyState level={1} icon={MailCheck} title={t('forgot.sentTitle')} action={<Link className="btn btn-primary" to="/login">{t('forgot.backToLogin')}</Link>}>
            {t('forgot.sentText', { email: s.sentTo, count: s.minutes })}
          </EmptyState>
        </div>
      );
    }
    const error = (s.submitted || s.touched) ? validateAll({ email: s.email }, SCHEMA).email : '';
    return (
      <div className="container container-auth">
        <div className="card-form auth-card">
          <h1>{t('forgot.title')}</h1>
          <p className="lead">{t('forgot.lead')}</p>
          <form ref={this.formRef} onSubmit={this.submit} noValidate className="form-grid">
            <Field id="email" label={t('form.email')} error={error}>
              <input name="email" type="email" autoComplete="username" className="input" value={s.email} autoFocus required
                onChange={(e) => this.setState({ email: e.target.value })} onBlur={() => this.setState({ touched: true })} placeholder={t('form.emailPlaceholder')} />
            </Field>
            {s.error ? <Alert tone="danger">{s.error}</Alert> : null}
            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={s.busy}>
              {s.busy ? <Spinner /> : null}{t('forgot.send')}
            </button>
          </form>
          <p className="auth-switch"><Link to="/login">{t('forgot.backToLogin')}</Link></p>
        </div>
      </div>
    );
  }
}
