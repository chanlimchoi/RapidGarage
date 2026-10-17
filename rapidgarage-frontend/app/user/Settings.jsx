import React from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, ShieldAlert, Trash2, LogIn, CheckCircle2, ExternalLink, Languages } from 'lucide-react';
import LanguagePicker from '../components/LanguagePicker';
import { apiFetch, errorMessage } from '../api';
import { Field, Alert, EmptyState, SkeletonBlock, Spinner } from '../components/ui';
import PasswordInput from './PasswordInput';
import toast from '../components/toast';
import SaleAlerts from './SaleAlerts';
import ReminderSettings from './ReminderSettings';
import { t } from '../i18n';
import { tx } from '../i18n/rich';

// Bring-your-own Google Maps key. The key is stored encrypted on the server
// and only its last 4 characters are ever shown here.
export default class Settings extends React.Component {
  constructor(props) {
    super(props);
    this.state = { loading: true, hasKey: false, last4: null, input: '', error: '', fieldError: '', busy: false };
    this.save = this.save.bind(this);
    this.remove = this.remove.bind(this);
  }

  componentDidMount() {
    this.load();
  }

  componentDidUpdate(prevProps) {
    const flag = (p) => !(p.config && p.config.userMapsKeys === false);
    if ((prevProps.user && prevProps.user.id) !== (this.props.user && this.props.user.id) || flag(prevProps) !== flag(this.props)) this.load();
  }

  load() {
    if (!this.props.user || (this.props.config && this.props.config.userMapsKeys === false)) {
      this.setState({ loading: false });
      return;
    }
    apiFetch('/me/maps-key').then(({ ok, data }) => {
      if (ok) this.setState({ loading: false, hasKey: data.hasKey, last4: data.last4 });
      else this.setState({ loading: false, error: errorMessage(data, t('settings.loadFailed')) });
    }).catch(() => this.setState({ loading: false, error: t('common.networkShort') }));
  }

  save(e) {
    e.preventDefault();
    const key = this.state.input.trim();
    if (!key) return this.setState({ fieldError: t('settings.pasteKey') });
    this.setState({ busy: true, error: '', fieldError: '' });
    apiFetch('/me/maps-key', { method: 'PUT', body: JSON.stringify({ key: this.state.input }) })
      .then(({ ok, data }) => {
        if (!ok) {
          this.setState({ busy: false, fieldError: errorMessage(data, t('settings.saveKeyFailed')) });
          return;
        }
        this.setState({ busy: false, hasKey: data.hasKey, last4: data.last4, input: '' });
        toast.success(t('settings.keySaved'));
        if (this.props.onAuthChange) this.props.onAuthChange();
      })
      .catch(() => this.setState({ busy: false, error: t('common.networkShort') }));
  }

  remove() {
    if (!window.confirm(t('settings.confirmRemove'))) return;
    this.setState({ busy: true, error: '', fieldError: '' });
    apiFetch('/me/maps-key', { method: 'DELETE' })
      .then(({ ok, data }) => {
        if (!ok) {
          this.setState({ busy: false, error: errorMessage(data, t('settings.removeKeyFailed')) });
          return;
        }
        this.setState({ busy: false, hasKey: false, last4: null });
        toast.success(t('settings.keyRemoved'));
        if (this.props.onAuthChange) this.props.onAuthChange();
      })
      .catch(() => this.setState({ busy: false, error: t('common.networkShort') }));
  }

  languageSection() {
    return (
      <section className="settings-section card-form" aria-labelledby="language-heading">
        <header>
          <h2 id="language-heading"><Languages size={18} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />{t('settings.language')}</h2>
          <p>{t('settings.languageLead')}</p>
        </header>
        <LanguagePicker id="settings-language" user={this.props.user} variant="segmented" />
      </section>
    );
  }

  header() {
    return (
      <header className="page-header">
        <div><h1>{t('nav.settings')}</h1><p>{t('settings.lead')}</p></div>
      </header>
    );
  }

  render() {
    if (!this.props.user) {
      if (!this.props.ready) return <div className="container container-narrow"><SkeletonBlock lines={4} /></div>;
      return (
        <div className="container container-narrow">
          <EmptyState icon={LogIn} title={t('settings.loginTitle')} action={<Link className="btn btn-primary" to="/login">{t('nav.logIn')}</Link>} />
        </div>
      );
    }
    if (this.props.config && this.props.config.userMapsKeys === false) {
      return (
        <div className="container rg-settings">
          {this.header()}
          <div className="stack-lg">{this.languageSection()}<SaleAlerts user={this.props.user} /><ReminderSettings user={this.props.user} /></div>
        </div>
      );
    }
    const s = this.state;
    return (
      <div className="container rg-settings">
        {this.header()}
        <div className="stack-lg">
          {this.languageSection()}
          <SaleAlerts user={this.props.user} /><ReminderSettings user={this.props.user} />
          <section className="settings-section card-form" aria-labelledby="maps-key-heading">
            <header>
              <h2 id="maps-key-heading"><KeyRound size={18} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />{t('settings.mapsKey')}</h2>
              <p>{t('settings.mapsLead')}</p>
            </header>
            <div className="stack">
              <ol className="steps">
                <li>{tx('settings.step1', { console: <a href="https://console.cloud.google.com/google/maps-apis/credentials" target="_blank" rel="noopener noreferrer">Google Cloud Console <ExternalLink size={12} aria-hidden="true" /></a> })}</li>
                <li>{tx('settings.step2', { maps: <strong>Maps JavaScript API</strong>, geocoding: <strong>Geocoding API</strong> })}</li>
                <li>{t('settings.step3')}</li>
              </ol>
              <Alert tone="warning" live={false}>
                <p>{tx('settings.keyWarning', { referrer: <strong>{t('settings.referrer')}</strong>, apis: <strong>{t('settings.apis')}</strong> })}</p>
              </Alert>
              {s.loading ? <SkeletonBlock lines={2} height={44} /> : (
                <React.Fragment>
                  <div className="key-status rg-key-status">
                    {s.hasKey
                      ? <React.Fragment><CheckCircle2 size={18} aria-hidden="true" style={{ color: 'var(--color-success)' }} /><span>{tx('settings.savedKey', { key: <code>••••••••{s.last4}</code> })}</span></React.Fragment>
                      : <React.Fragment><ShieldAlert size={18} aria-hidden="true" /><span>{t('settings.noKey')}</span></React.Fragment>}
                  </div>
                  <form onSubmit={this.save} autoComplete="off" noValidate>
                    <Field id="mapsKey" label={s.hasKey ? t('settings.replaceKey') : t('settings.apiKey')} error={s.fieldError} hint={t('settings.keyHint')}>
                      <PasswordInput name="mapsKey" placeholder="AIza…" value={s.input} autoComplete="off" spellCheck="false"
                        onChange={(e) => this.setState({ input: e.target.value, fieldError: '' })} required />
                    </Field>
                    <div className="form-actions">
                      <button type="submit" className="btn btn-primary" disabled={s.busy}>{s.busy ? <Spinner /> : null}{s.hasKey ? t('settings.replace') : t('common.save')}</button>
                      {s.hasKey ? <button type="button" className="btn btn-danger" onClick={this.remove} disabled={s.busy}><Trash2 size={16} aria-hidden="true" />{t('common.remove')}</button> : null}
                    </div>
                  </form>
                </React.Fragment>
              )}
              {s.error ? <Alert tone="danger">{s.error}</Alert> : null}
            </div>
          </section>
        </div>
      </div>
    );
  }
}
