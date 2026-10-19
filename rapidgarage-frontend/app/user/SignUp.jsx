import React from 'react';
import { Link, Navigate } from 'react-router-dom';
import { errorMessage } from '../api';
import { Field, Alert, Spinner } from '../components/ui';
import { rules, validateAll, serverFieldErrors, focusFirstError } from '../lib/validate';
import PasswordInput from './PasswordInput';
import toast from '../components/toast';
import { t, locale } from '../i18n';

const SCHEMA = {
  email: rules.email,
  password: rules.password,
  passwordConfirm: (v, all) => (!v ? t('signup.retype') : v !== all.password ? t('signup.mismatch') : ''),
  firstName: rules.required(() => t('form.firstName')),
};

class SignUp extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      redirectToNewPage: false, error: '', busy: false, submitted: false, touched: {}, serverErrors: {},
      values: { email: '', password: '', passwordConfirm: '', firstName: '', lastName: '' },
    };
    this.formRef = React.createRef();
    this.handleSubmit = this.handleSubmit.bind(this);
  }

  set(name) {
    return (e) => {
      const serverErrors = Object.assign({}, this.state.serverErrors);
      delete serverErrors[name];
      this.setState({ values: Object.assign({}, this.state.values, { [name]: e.target.value }), serverErrors });
    };
  }

  touch(name) {
    return () => this.setState({ touched: Object.assign({}, this.state.touched, { [name]: true }) });
  }

  handleSubmit(e) {
    e.preventDefault();
    const errors = validateAll(this.state.values, SCHEMA);
    this.setState({ submitted: true });
    if (Object.keys(errors).length) return focusFirstError(this.formRef.current, errors);
    const v = this.state.values;
    this.setState({ busy: true, error: '' });
    fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept-Language': locale() },
      credentials: 'same-origin',
      body: JSON.stringify({ firstName: v.firstName.trim(), lastName: v.lastName.trim(), email: v.email.trim(), password: v.password, locale: locale() }),
    })
      .then((response) => response.json().catch(() => null).then((data) => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) {
          const serverErrors = serverFieldErrors(data);
          this.setState({ busy: false, serverErrors, error: errorMessage(data, t('signup.failed')) });
          focusFirstError(this.formRef.current, serverErrors);
          return;
        }
        // The signup endpoint logs the user in, so reflect that in the UI.
        if (this.props.onAuthChange) this.props.onAuthChange();
        toast.success(t('signup.welcome', { name: v.firstName.trim() }));
        this.setState({ redirectToNewPage: true, error: '' });
      })
      .catch(() => this.setState({ busy: false, error: t('common.network') }));
  }

  render() {
    if (this.state.redirectToNewPage) return <Navigate replace to="/" />;
    const errors = Object.assign({}, this.state.serverErrors, validateAll(this.state.values, SCHEMA));
    const shown = (n) => (this.state.serverErrors[n] || ((this.state.submitted || this.state.touched[n]) ? errors[n] : ''));
    const v = this.state.values;
    const input = (name, extra) => (
      <input name={name} className="input" value={v[name]} onChange={this.set(name)} onBlur={this.touch(name)} {...extra} />
    );
    return (
      <div className="container container-auth">
        <div className="card-form auth-card">
          <h1>{t('signup.title')}</h1>
          <p className="lead">{t('signup.lead')}</p>
          <form ref={this.formRef} onSubmit={this.handleSubmit} noValidate className="form-grid">
            <div className="form-grid form-grid-2">
              <Field id="firstname" label={t('form.firstName')} error={shown('firstName')}>
                {input('firstName', { type: 'text', autoComplete: 'given-name', required: true, autoFocus: true })}
              </Field>
              <Field id="lastname" label={t('form.lastName')} optional>
                {input('lastName', { type: 'text', autoComplete: 'family-name' })}
              </Field>
            </div>
            <Field id="email" label={t('form.email')} error={shown('email')}>
              {input('email', { type: 'email', autoComplete: 'email', placeholder: t('form.emailPlaceholder'), required: true })}
            </Field>
            <Field id="password" label={t('form.password')} error={shown('password')} hint={t('signup.passwordHint')}>
              <PasswordInput name="password" autoComplete="new-password" minLength={8} value={v.password}
                onChange={this.set('password')} onBlur={this.touch('password')} required />
            </Field>
            <Field id="passwordConfirm" label={t('signup.confirm')} error={shown('passwordConfirm')}>
              <PasswordInput name="passwordConfirm" autoComplete="new-password" value={v.passwordConfirm}
                onChange={this.set('passwordConfirm')} onBlur={this.touch('passwordConfirm')} required />
            </Field>
            {this.state.error ? <Alert tone="danger">{this.state.error}</Alert> : null}
            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={this.state.busy}>
              {this.state.busy ? <Spinner /> : null}{t('signup.submit')}
            </button>
          </form>
          <p className="auth-switch">{t('signup.haveAccount')} <Link to="/login">{t('nav.logIn')}</Link></p>
        </div>
      </div>
    );
  }
}

export default SignUp;
