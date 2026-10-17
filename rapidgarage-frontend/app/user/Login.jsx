import React from 'react';
import { Redirect } from 'react-router';
import { Link } from 'react-router-dom';
import { errorMessage } from '../api';
import { Field, Alert, Spinner } from '../components/ui';
import { rules, validateAll, focusFirstError } from '../lib/validate';
import PasswordInput from './PasswordInput';
import toast from '../components/toast';
import { t, locale } from '../i18n';

const SCHEMA = { email: rules.email, password: (v) => (!v ? t('login.enterPassword') : '') };

export default class Login extends React.Component {
  constructor(props) {
    super(props);
    this.state = { redirectToNewPage: false, error: '', google: false, values: { email: '', password: '' }, touched: {}, submitted: false, busy: false };
    this.formRef = React.createRef();
    this.handleSubmit = this.handleSubmit.bind(this);
  }

  componentDidMount() {
    // Show "Sign in with Google" only if the server has it configured.
    fetch('/api/auth/providers', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((p) => this.setState({ google: !!(p && p.google) }))
      .catch(() => {});
    const m = /[?&]googleError=([^&]+)/.exec(window.location.search);
    if (m) {
      const reason = decodeURIComponent(m[1]);
      const text = {
        email_not_verified: t('login.googleUnverified'),
        linked_to_other_google_account: t('login.googleLinked'),
      }[reason] || t('login.googleFailed');
      this.setState({ error: text });
    }
  }

  set(name) {
    return (e) => this.setState({ values: Object.assign({}, this.state.values, { [name]: e.target.value }) });
  }

  touch(name) {
    return () => this.setState({ touched: Object.assign({}, this.state.touched, { [name]: true }) });
  }

  handleSubmit(e) {
    e.preventDefault();
    const errors = validateAll(this.state.values, SCHEMA);
    this.setState({ submitted: true });
    if (Object.keys(errors).length) return focusFirstError(this.formRef.current, errors);
    this.setState({ busy: true, error: '' });
    fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept-Language': locale() },
      credentials: 'same-origin',
      body: JSON.stringify({ email: this.state.values.email.trim(), password: this.state.values.password }),
    })
      // Always read the JSON body, even on 401, to show the server's message.
      .then((response) => response.json().catch(() => null).then((data) => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (!ok || !data || !data.success) {
          this.setState({ busy: false, error: errorMessage(data, t('login.incorrect')) });
          return;
        }
        if (this.props.onAuthChange) this.props.onAuthChange();
        toast.success(data.user && data.user.firstName ? t('login.welcomeBackName', { name: data.user.firstName }) : t('login.welcomeBack'));
        this.setState({ redirectToNewPage: true, error: '' });
      })
      .catch(() => this.setState({ busy: false, error: t('common.network') }));
  }

  render() {
    if (this.state.redirectToNewPage) return <Redirect to="/" />;
    const errors = validateAll(this.state.values, SCHEMA);
    const shown = (n) => ((this.state.submitted || this.state.touched[n]) ? errors[n] : '');
    const v = this.state.values;
    return (
      <div className="container container-auth">
        <div className="card-form auth-card">
          <h1>{t('nav.logIn')}</h1>
          <p className="lead">{t('login.lead')}</p>
          <form ref={this.formRef} onSubmit={this.handleSubmit} noValidate className="form-grid">
            <Field id="email" label={t('form.email')} error={shown('email')}>
              <input name="email" type="email" autoComplete="username" className="input" value={v.email}
                onChange={this.set('email')} onBlur={this.touch('email')} placeholder={t('form.emailPlaceholder')} required autoFocus />
            </Field>
            <Field id="password" label={t('form.password')} error={shown('password')}>
              <PasswordInput name="password" autoComplete="current-password" value={v.password}
                onChange={this.set('password')} onBlur={this.touch('password')} required />
            </Field>
            {this.state.error ? <Alert tone="danger">{this.state.error}</Alert> : null}
            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={this.state.busy}>
              {this.state.busy ? <Spinner /> : null}{t('nav.logIn')}
            </button>
          </form>
          {this.state.google ? (
            <React.Fragment>
              <div className="divider">{t('auth.or')}</div>
              {/* Full-page navigation: the OAuth redirect flow can't run over fetch. */}
              <a className="btn btn-secondary btn-lg btn-block google-btn" href="/api/auth/google">
                <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.4 13.7 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.2-13.5-10l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>
                {t('login.google')}
              </a>
            </React.Fragment>
          ) : null}
          <p className="auth-switch">{t('login.newHere')} <Link to="/signup">{t('new.createAccount')}</Link></p>
        </div>
      </div>
    );
  }
}
