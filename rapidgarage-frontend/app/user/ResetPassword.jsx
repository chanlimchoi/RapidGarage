import React from 'react';
import { Link, Navigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { checkPasswordReset, confirmPasswordReset, errorMessage } from '../api';
import { Field, Alert, EmptyState, SkeletonBlock, Spinner } from '../components/ui';
import { rules, validateAll, focusFirstError, serverFieldErrors } from '../lib/validate';
import PasswordInput from './PasswordInput';
import toast from '../components/toast';
import { t } from '../i18n';

const SCHEMA = {
  password: rules.password,
  confirm: (v, all) => (!v ? t('signup.retype') : v !== all.password ? t('signup.mismatch') : ''),
};

// Step 2: the link from the email (/reset-password?t=<token>). Checks the
// link first so an expired one says so before anyone types a new password.
export default class ResetPassword extends React.Component {
  constructor(props) {
    super(props);
    this.token = new URLSearchParams(props.location.search).get('t') || '';
    this.state = { status: this.token ? 'checking' : 'invalid', values: { password: '', confirm: '' }, touched: {}, submitted: false, busy: false, error: '', serverErrors: {}, done: false };
    this.formRef = React.createRef();
    this.submit = this.submit.bind(this);
  }

  componentDidMount() {
    if (!this.token) return;
    checkPasswordReset(this.token)
      .then(({ ok, data }) => this.setState({ status: ok && data && data.valid ? 'ready' : 'invalid' }))
      .catch(() => this.setState({ status: 'ready' })); // let the submit report it
  }

  set(name) {
    return (e) => this.setState({ values: Object.assign({}, this.state.values, { [name]: e.target.value }), serverErrors: {} });
  }

  touch(name) {
    return () => this.setState({ touched: Object.assign({}, this.state.touched, { [name]: true }) });
  }

  submit(e) {
    e.preventDefault();
    const errors = validateAll(this.state.values, SCHEMA);
    this.setState({ submitted: true });
    if (Object.keys(errors).length) return focusFirstError(this.formRef.current, errors);
    this.setState({ busy: true, error: '' });
    confirmPasswordReset(this.token, this.state.values.password).then(({ ok, data }) => {
      if (ok) {
        if (this.props.onAuthChange) this.props.onAuthChange();
        toast.success(t('reset.done'));
        return this.setState({ done: true });
      }
      if (data && data.error && data.error.code === 'invalid_token') return this.setState({ busy: false, status: 'invalid' });
      this.setState({ busy: false, serverErrors: serverFieldErrors(data), error: serverFieldErrors(data).password ? '' : errorMessage(data, t('reset.failed')) });
    }).catch(() => this.setState({ busy: false, error: t('common.network') }));
  }

  render() {
    const s = this.state;
    if (s.done) return <Navigate replace to="/" />;
    if (s.status === 'checking') return <div className="container container-narrow"><SkeletonBlock lines={3} /></div>;
    if (s.status === 'invalid') {
      return (
        <div className="container container-narrow" aria-live="polite">
          <EmptyState level={1} icon={AlertCircle} title={t('reset.invalidTitle')} action={<Link className="btn btn-primary" to="/forgot-password">{t('reset.requestNew')}</Link>}>
            {t('reset.invalidText')}
          </EmptyState>
        </div>
      );
    }
    const errors = validateAll(s.values, SCHEMA);
    const shown = (n) => s.serverErrors[n] || ((s.submitted || s.touched[n]) ? errors[n] : '');
    return (
      <div className="container container-auth">
        <div className="card-form auth-card">
          <h1>{t('reset.title')}</h1>
          <p className="lead">{t('reset.lead')}</p>
          <form ref={this.formRef} onSubmit={this.submit} noValidate className="form-grid">
            {/* Lets password managers save the new password under the right account. */}
            <input type="text" name="username" autoComplete="username" hidden readOnly value="" />
            <Field id="password" label={t('reset.newPassword')} error={shown('password')} hint={t('reset.passwordHint')}>
              <PasswordInput id="password" name="password" autoComplete="new-password" value={s.values.password}
                onChange={this.set('password')} onBlur={this.touch('password')} required autoFocus />
            </Field>
            <Field id="confirm" label={t('reset.confirmPassword')} error={shown('confirm')}>
              <PasswordInput id="confirm" name="confirm" autoComplete="new-password" value={s.values.confirm}
                onChange={this.set('confirm')} onBlur={this.touch('confirm')} required />
            </Field>
            {s.error ? <Alert tone="danger">{s.error}</Alert> : null}
            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={s.busy}>
              {s.busy ? <Spinner /> : null}{t('reset.save')}
            </button>
          </form>
        </div>
      </div>
    );
  }
}
