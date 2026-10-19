import React from 'react';
import { Lock } from 'lucide-react';
import { fetchPasswordStatus, changePassword, errorMessage } from '../api';
import { Field, Alert, SkeletonBlock, Spinner } from '../components/ui';
import { rules, validateAll, focusFirstError, serverFieldErrors } from '../lib/validate';
import PasswordInput from './PasswordInput';
import toast from '../components/toast';
import { t } from '../i18n';

const EMPTY = { currentPassword: '', newPassword: '', confirm: '' };

// Settings > Password: change it (current one required), or add one to an
// account created with Google. Other devices are signed out on save.
export default class PasswordSettings extends React.Component {
  constructor(props) {
    super(props);
    this.state = { loading: true, hasPassword: true, values: EMPTY, submitted: false, busy: false, error: '', serverErrors: {} };
    this.formRef = React.createRef();
    this.submit = this.submit.bind(this);
  }

  componentDidMount() {
    this.mounted = true;
    fetchPasswordStatus().then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) return this.setState({ loading: false, error: errorMessage(data, t('pwset.loadFailed')) });
      this.setState({ loading: false, hasPassword: !!data.hasPassword });
    }).catch(() => this.mounted && this.setState({ loading: false, error: t('common.networkShort') }));
  }
  componentWillUnmount() { this.mounted = false; }

  schema() {
    const s = {
      newPassword: rules.password,
      confirm: (v, all) => (!v ? t('signup.retype') : v !== all.newPassword ? t('signup.mismatch') : ''),
    };
    if (this.state.hasPassword) s.currentPassword = (v) => (!v ? t('login.enterPassword') : '');
    return s;
  }

  set(name) {
    return (e) => this.setState({ values: Object.assign({}, this.state.values, { [name]: e.target.value }), serverErrors: {} });
  }

  submit(e) {
    e.preventDefault();
    const errors = validateAll(this.state.values, this.schema());
    this.setState({ submitted: true });
    if (Object.keys(errors).length) return focusFirstError(this.formRef.current, errors);
    const v = this.state.values;
    this.setState({ busy: true, error: '' });
    changePassword(this.state.hasPassword ? v.currentPassword : undefined, v.newPassword).then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) {
        const fields = serverFieldErrors(data);
        return this.setState({ busy: false, serverErrors: fields, error: Object.keys(fields).length ? '' : errorMessage(data, t('pwset.failed')) });
      }
      toast.success(t('pwset.saved'));
      this.setState({ busy: false, hasPassword: true, values: EMPTY, submitted: false });
    }).catch(() => this.mounted && this.setState({ busy: false, error: t('common.networkShort') }));
  }

  render() {
    const s = this.state;
    const errors = validateAll(s.values, this.schema());
    const shown = (n) => s.serverErrors[n] || (s.submitted ? errors[n] : '');
    return (
      <section id="password" className="settings-section card-form" aria-labelledby="password-heading">
        <header>
          <h2 id="password-heading"><Lock size={18} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />{t('pwset.title')}</h2>
          <p>{s.hasPassword ? t('pwset.lead') : t('pwset.leadAdd')}</p>
        </header>
        {s.loading ? <SkeletonBlock lines={2} height={44} /> : (
          <form ref={this.formRef} onSubmit={this.submit} noValidate className="form-grid">
            <input type="text" name="username" autoComplete="username" hidden readOnly value={(this.props.user && this.props.user.email) || ''} />
            {s.hasPassword ? (
              <Field id="currentPassword" label={t('pwset.current')} error={shown('currentPassword')}>
                <PasswordInput id="currentPassword" name="currentPassword" autoComplete="current-password" value={s.values.currentPassword} onChange={this.set('currentPassword')} required />
              </Field>
            ) : null}
            <Field id="newPassword" label={t('reset.newPassword')} error={shown('newPassword')} hint={t('reset.passwordHint')}>
              <PasswordInput id="newPassword" name="newPassword" autoComplete="new-password" value={s.values.newPassword} onChange={this.set('newPassword')} required />
            </Field>
            <Field id="confirm" label={t('reset.confirmPassword')} error={shown('confirm')}>
              <PasswordInput id="confirm" name="confirm" autoComplete="new-password" value={s.values.confirm} onChange={this.set('confirm')} required />
            </Field>
            {s.error ? <Alert tone="danger">{s.error}</Alert> : null}
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={s.busy}>{s.busy ? <Spinner /> : null}{s.hasPassword ? t('pwset.change') : t('pwset.add')}</button>
            </div>
          </form>
        )}
      </section>
    );
  }
}
