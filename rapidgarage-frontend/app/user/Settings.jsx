import React from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, ShieldAlert, Trash2, LogIn, CheckCircle2, ExternalLink } from 'lucide-react';
import { apiFetch, errorMessage } from '../api';
import { Field, Alert, EmptyState, SkeletonBlock, Spinner } from '../components/ui';
import PasswordInput from './PasswordInput';
import toast from '../components/toast';
import SaleAlerts from './SaleAlerts';

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
      else this.setState({ loading: false, error: errorMessage(data, 'Could not load your settings.') });
    }).catch(() => this.setState({ loading: false, error: 'Unable to reach the server.' }));
  }

  save(e) {
    e.preventDefault();
    const key = this.state.input.trim();
    if (!key) return this.setState({ fieldError: 'Paste your Google Maps API key.' });
    this.setState({ busy: true, error: '', fieldError: '' });
    apiFetch('/me/maps-key', { method: 'PUT', body: JSON.stringify({ key: this.state.input }) })
      .then(({ ok, data }) => {
        if (!ok) {
          this.setState({ busy: false, fieldError: errorMessage(data, 'Could not save the key.') });
          return;
        }
        this.setState({ busy: false, hasKey: data.hasKey, last4: data.last4, input: '' });
        toast.success('Key saved.');
        if (this.props.onAuthChange) this.props.onAuthChange();
      })
      .catch(() => this.setState({ busy: false, error: 'Unable to reach the server.' }));
  }

  remove() {
    if (!window.confirm('Remove your Google Maps key?')) return;
    this.setState({ busy: true, error: '', fieldError: '' });
    apiFetch('/me/maps-key', { method: 'DELETE' })
      .then(({ ok, data }) => {
        if (!ok) {
          this.setState({ busy: false, error: errorMessage(data, 'Could not remove the key.') });
          return;
        }
        this.setState({ busy: false, hasKey: false, last4: null });
        toast.success('Key removed.');
        if (this.props.onAuthChange) this.props.onAuthChange();
      })
      .catch(() => this.setState({ busy: false, error: 'Unable to reach the server.' }));
  }

  header() {
    return (
      <header className="page-header">
        <div><h1>Settings</h1><p>Manage how RapidGarage works for you.</p></div>
      </header>
    );
  }

  render() {
    if (!this.props.user) {
      if (!this.props.ready) return <div className="container container-narrow"><SkeletonBlock lines={4} /></div>;
      return (
        <div className="container container-narrow">
          <EmptyState icon={LogIn} title="Log in to manage your settings" action={<Link className="btn btn-primary" to="/login">Log in</Link>} />
        </div>
      );
    }
    if (this.props.config && this.props.config.userMapsKeys === false) {
      return (
        <div className="container rg-settings">
          {this.header()}
          <div className="stack-lg"><SaleAlerts user={this.props.user} /></div>
        </div>
      );
    }
    const s = this.state;
    return (
      <div className="container rg-settings">
        {this.header()}
        <div className="stack-lg">
          <SaleAlerts user={this.props.user} />
          <section className="settings-section card-form" aria-labelledby="maps-key-heading">
            <header>
              <h2 id="maps-key-heading"><KeyRound size={18} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />Google Maps key</h2>
              <p>The map uses your own Google Maps API key. Signing in with Google does not create one for you.</p>
            </header>
            <div className="stack">
              <ol className="steps">
                <li>In <a href="https://console.cloud.google.com/google/maps-apis/credentials" target="_blank" rel="noopener noreferrer">Google Cloud Console <ExternalLink size={12} aria-hidden="true" /></a>, create a browser key.</li>
                <li>Enable the <strong>Maps JavaScript API</strong> and <strong>Geocoding API</strong>.</li>
                <li>Paste the key below.</li>
              </ol>
              <Alert tone="warning" live={false}>
                <p>A Maps key is a browser key and is visible to anyone using the page while the map loads.
                Restrict it in Google Cloud Console by <strong>HTTP referrer</strong> (this site only) and to those
                two <strong>APIs</strong>, so it can't be reused elsewhere.</p>
              </Alert>
              {s.loading ? <SkeletonBlock lines={2} height={44} /> : (
                <React.Fragment>
                  <div className="key-status rg-key-status">
                    {s.hasKey
                      ? <React.Fragment><CheckCircle2 size={18} aria-hidden="true" style={{ color: 'var(--color-success)' }} /><span>Saved key: <code>••••••••{s.last4}</code></span></React.Fragment>
                      : <React.Fragment><ShieldAlert size={18} aria-hidden="true" /><span>No key saved.</span></React.Fragment>}
                  </div>
                  <form onSubmit={this.save} autoComplete="off" noValidate>
                    <Field id="mapsKey" label={s.hasKey ? 'Replace key' : 'API key'} error={s.fieldError} hint="Stored encrypted. Only the last 4 characters are ever shown.">
                      <PasswordInput name="mapsKey" placeholder="AIza…" value={s.input} autoComplete="off" spellCheck="false"
                        onChange={(e) => this.setState({ input: e.target.value, fieldError: '' })} required />
                    </Field>
                    <div className="form-actions">
                      <button type="submit" className="btn btn-primary" disabled={s.busy}>{s.busy ? <Spinner /> : null}{s.hasKey ? 'Replace' : 'Save'}</button>
                      {s.hasKey ? <button type="button" className="btn btn-danger" onClick={this.remove} disabled={s.busy}><Trash2 size={16} aria-hidden="true" />Remove</button> : null}
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
