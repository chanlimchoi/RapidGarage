import React from 'react';
import { Sparkles, CheckCircle2, ShieldCheck, Trash2, ExternalLink } from 'lucide-react';
import { fetchAiKey, saveAiKey, deleteAiKey, fetchPasswordStatus, errorMessage } from '../api';
import { Field, Alert, SkeletonBlock, Spinner } from '../components/ui';
import { serverFieldErrors } from '../lib/validate';
import PasswordInput from './PasswordInput';
import toast from '../components/toast';
import { t, intlLocale } from '../i18n';

// Attributes that keep password managers from offering to save or fill an API key.
export const NO_SAVE = { autoComplete: 'off', spellCheck: false, 'data-1p-ignore': 'true', 'data-lpignore': 'true', 'data-bwignore': 'true', 'data-form-type': 'other' };

// Settings > Your Anthropic key: save one (encrypted; only the last 4
// characters are ever shown again) or delete it. Drafts can also use a
// one-time key instead (Edit items), which is never saved.
export default class AiKeySettings extends React.Component {
  constructor(props) {
    super(props);
    this.state = { loading: true, hasKey: false, last4: null, setAt: null, hasPassword: true, key: '', currentPassword: '', busy: false, error: '', fieldErrors: {} };
  }

  componentDidMount() {
    this.mounted = true;
    Promise.all([fetchAiKey(), fetchPasswordStatus()]).then(([k, p]) => {
      if (!this.mounted) return;
      if (!k.ok) return this.setState({ loading: false, error: errorMessage(k.data, t('aikey.loadFailed')) });
      this.setState({ loading: false, hasKey: k.data.hasKey, last4: k.data.last4, setAt: k.data.setAt, hasPassword: !(p.ok && p.data && p.data.hasPassword === false) });
    }).catch(() => this.mounted && this.setState({ loading: false, error: t('common.networkShort') }));
  }
  componentWillUnmount() { this.mounted = false; }

  save(e) {
    e.preventDefault();
    const key = this.state.key.trim();
    if (!key) return this.setState({ fieldErrors: { key: t('aikey.pasteKey') } });
    const currentPassword = this.state.currentPassword;
    // Clear the fields right away: the key lives in this page only until it is sent.
    this.setState({ busy: true, error: '', fieldErrors: {}, key: '', currentPassword: '' });
    saveAiKey(key, currentPassword).then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) {
        const fields = serverFieldErrors(data);
        return this.setState({ busy: false, fieldErrors: fields, error: Object.keys(fields).length ? '' : errorMessage(data, t('aikey.saveFailed')) });
      }
      this.setState({ busy: false, hasKey: data.hasKey, last4: data.last4, setAt: data.setAt });
      toast.success(t('aikey.saved'));
    }).catch(() => this.mounted && this.setState({ busy: false, error: t('common.networkShort') }));
  }

  remove() {
    if (!window.confirm(t('aikey.confirmDelete'))) return;
    this.setState({ busy: true, error: '' });
    deleteAiKey().then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) return this.setState({ busy: false, error: errorMessage(data, t('aikey.deleteFailed')) });
      this.setState({ busy: false, hasKey: false, last4: null, setAt: null });
      toast.success(t('aikey.deleted'));
    }).catch(() => this.mounted && this.setState({ busy: false, error: t('common.networkShort') }));
  }

  render() {
    const s = this.state;
    const canSave = this.props.canSave !== false;
    const when = s.setAt ? new Date(s.setAt).toLocaleDateString(intlLocale(), { dateStyle: 'medium' }) : '';
    return (
      <section id="ai-key" className="settings-section card-form" aria-labelledby="ai-key-heading">
        <header>
          <h2 id="ai-key-heading"><Sparkles size={18} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />{t('aikey.title')}</h2>
          <p>{t('aikey.lead')}</p>
        </header>
        <div className="stack">
          <Alert tone="info" live={false}>
            <p><ShieldCheck size={16} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 4 }} />{t('aikey.protection')}</p>
          </Alert>
          {s.loading ? <SkeletonBlock lines={2} height={44} /> : (
            <React.Fragment>
              <div className="key-status">
                {s.hasKey
                  ? <React.Fragment><CheckCircle2 size={18} aria-hidden="true" style={{ color: 'var(--color-success)' }} /><span>{t('aikey.savedStatus', { last4: s.last4, date: when })}</span></React.Fragment>
                  : <span>{t('aikey.none')}</span>}
              </div>
              {s.hasKey ? (
                <div className="form-actions">
                  <button type="button" className="btn btn-danger" onClick={() => this.remove()} disabled={s.busy}>
                    {s.busy ? <Spinner /> : <Trash2 size={16} aria-hidden="true" />}{t('aikey.delete')}
                  </button>
                </div>
              ) : null}
              {canSave ? (
                <form onSubmit={(e) => this.save(e)} noValidate className="form-grid" autoComplete="off">
                  <Field id="aiKey" label={s.hasKey ? t('aikey.replace') : t('aikey.key')} error={s.fieldErrors.key} hint={t('aikey.keyHint')}>
                    <PasswordInput id="aiKey" name="rg-anthropic-key" placeholder="sk-ant-…" value={s.key} {...NO_SAVE}
                      onChange={(e) => this.setState({ key: e.target.value, fieldErrors: {} })} />
                  </Field>
                  {s.hasPassword ? (
                    <Field id="aiKeyPassword" label={t('pwset.current')} error={s.fieldErrors.currentPassword} hint={t('aikey.passwordHint')}>
                      <PasswordInput id="aiKeyPassword" name="current-password" autoComplete="current-password" value={s.currentPassword}
                        onChange={(e) => this.setState({ currentPassword: e.target.value, fieldErrors: {} })} />
                    </Field>
                  ) : null}
                  <div className="form-actions">
                    <button type="submit" className="btn btn-primary" disabled={s.busy}>{s.busy ? <Spinner /> : null}{s.hasKey ? t('settings.replace') : t('common.save')}</button>
                    <a className="btn btn-ghost" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">{t('aikey.getKey')} <ExternalLink size={12} aria-hidden="true" /></a>
                  </div>
                </form>
              ) : <p className="small muted">{t('aikey.cantSave')}</p>}
            </React.Fragment>
          )}
          {s.error ? <Alert tone="danger">{s.error}</Alert> : null}
        </div>
      </section>
    );
  }
}
