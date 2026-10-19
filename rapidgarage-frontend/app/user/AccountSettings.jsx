import React from 'react';
import { Download, Trash2, UserX } from 'lucide-react';
import { apiFetch, fetchPasswordStatus, errorMessage } from '../api';
import { Field, Alert, Spinner, Dialog } from '../components/ui';
import { serverFieldErrors } from '../lib/validate';
import PasswordInput from './PasswordInput';
import toast from '../components/toast';
import { t } from '../i18n';

// Settings > Your account: download everything (JSON), or delete the account.
export default class AccountSettings extends React.Component {
  constructor(props) {
    super(props);
    this.state = { open: false, hasPassword: true, password: '', confirm: '', busy: false, error: '', fieldErrors: {} };
  }

  componentDidMount() {
    this.mounted = true;
    fetchPasswordStatus().then(({ ok, data }) => { if (this.mounted && ok) this.setState({ hasPassword: !!data.hasPassword }); }).catch(() => null);
  }
  componentWillUnmount() { this.mounted = false; }

  remove(e) {
    e.preventDefault();
    if (this.state.confirm !== 'DELETE') return this.setState({ fieldErrors: { confirm: t('account.typeDelete') } });
    this.setState({ busy: true, error: '', fieldErrors: {} });
    apiFetch('/me', { method: 'DELETE', body: JSON.stringify({ currentPassword: this.state.password || undefined, confirm: 'DELETE' }) }).then(({ ok, data }) => {
      if (!this.mounted) return null;
      if (!ok) {
        const fields = serverFieldErrors(data);
        return this.setState({ busy: false, fieldErrors: fields, error: Object.keys(fields).length ? '' : errorMessage(data, t('account.deleteFailed')) });
      }
      toast.success(t('account.deleted'));
      if (this.props.onAuthChange) this.props.onAuthChange();
      if (this.props.history) this.props.history.push('/');
      return null;
    }).catch(() => this.mounted && this.setState({ busy: false, error: t('common.networkShort') }));
    return null;
  }

  render() {
    const s = this.state;
    return (
      <section id="account" className="settings-section card-form" aria-labelledby="account-heading">
        <header>
          <h2 id="account-heading"><UserX size={18} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />{t('account.title')}</h2>
          <p>{t('account.lead')}</p>
        </header>
        <div className="form-actions">
          <a className="btn btn-secondary" href="/api/me/export" download><Download size={16} aria-hidden="true" />{t('account.download')}</a>
          <button type="button" className="btn btn-danger" onClick={() => this.setState({ open: true, password: '', confirm: '', error: '', fieldErrors: {} })}>
            <Trash2 size={16} aria-hidden="true" />{t('account.delete')}
          </button>
        </div>
        {s.open ? (
          <Dialog id="delete-account" title={t('account.deleteTitle')} description={t('account.deleteDesc')} onClose={() => !s.busy && this.setState({ open: false })}
            footer={(
              <React.Fragment>
                <button type="button" className="btn btn-ghost" disabled={s.busy} onClick={() => this.setState({ open: false })}>{t('common.cancel')}</button>
                <button type="submit" form="delete-account-form" className="btn btn-danger" disabled={s.busy || s.confirm !== 'DELETE'}>{s.busy ? <Spinner /> : <Trash2 size={16} aria-hidden="true" />}{t('account.deleteForever')}</button>
              </React.Fragment>
            )}>
            <form id="delete-account-form" className="stack" onSubmit={(e) => this.remove(e)} noValidate>
              {s.hasPassword ? (
                <Field id="deletePassword" label={t('pwset.current')} error={s.fieldErrors.currentPassword}>
                  <PasswordInput id="deletePassword" name="current-password" autoComplete="current-password" value={s.password} onChange={(e) => this.setState({ password: e.target.value })} />
                </Field>
              ) : null}
              <Field id="deleteConfirm" label={t('account.typeDeleteLabel')} error={s.fieldErrors.confirm}>
                <input className="input" autoComplete="off" spellCheck="false" value={s.confirm} onChange={(e) => this.setState({ confirm: e.target.value })} />
              </Field>
              {s.error ? <Alert tone="danger">{s.error}</Alert> : null}
            </form>
          </Dialog>
        ) : null}
      </section>
    );
  }
}
