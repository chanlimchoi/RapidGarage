import React from 'react';
import { BellRing } from 'lucide-react';
import { apiFetch, errorMessage } from '../api';
import { Alert, SkeletonBlock, Spinner } from '../components/ui';
import * as pushClient from '../lib/pushClient';
import toast from '../components/toast';
import { t } from '../i18n';

const KINDS = [
  { key: 'messages', label: 'notif.messages' },
  { key: 'follows', label: 'notif.follows' },
  { key: 'reminders', label: 'notif.reminders' },
];

// Settings > Notifications: push on this device, what to be told about, and a test.
export default class NotificationSettings extends React.Component {
  constructor(props) {
    super(props);
    this.state = { loading: true, settings: null, onThisDevice: false, busy: false, error: '' };
  }

  componentDidMount() {
    this.mounted = true;
    Promise.all([apiFetch('/push/settings'), pushClient.current()]).then(([r, sub]) => {
      if (!this.mounted) return;
      if (!r.ok) return this.setState({ loading: false, error: errorMessage(r.data, t('notif.loadFailed')) });
      this.setState({ loading: false, settings: r.data, onThisDevice: !!sub });
      if (window.location.hash === '#notifications' && this.ref && this.ref.scrollIntoView) this.ref.scrollIntoView({ block: 'start' });
    }).catch(() => this.mounted && this.setState({ loading: false, error: t('common.networkShort') }));
  }
  componentWillUnmount() { this.mounted = false; }

  toggleDevice() {
    const on = !this.state.onThisDevice;
    this.setState({ busy: true, error: '' });
    const run = on ? pushClient.enable(this.state.settings.publicKey) : pushClient.disable();
    run.then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) return this.setState({ busy: false, error: errorMessage(data, t('notif.failed')) });
      this.setState({ busy: false, onThisDevice: on, settings: data && data.prefs ? data : this.state.settings });
      toast.success(on ? t('notif.deviceOn') : t('notif.deviceOff'));
    }).catch((err) => {
      if (!this.mounted) return;
      const msg = err && err.code === 'denied' ? t('notif.denied') : err && err.code === 'no_worker' ? t('notif.noWorker') : t('notif.failed');
      this.setState({ busy: false, error: msg });
    });
  }

  setKind(key, value) {
    apiFetch('/push/settings', { method: 'PUT', body: JSON.stringify({ [key]: value }) }).then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) return toast.error(errorMessage(data, t('notif.failed')));
      this.setState({ settings: data });
    }).catch(() => toast.error(t('common.networkShort')));
  }

  test() {
    apiFetch('/push/test', { method: 'POST' }).then(({ ok, data }) => {
      if (!ok) return toast.error(errorMessage(data, t('notif.failed')));
      if (!data.delivered) toast.error(t('notif.noDevices'));
      else toast.success(t('notif.testSent'));
    }).catch(() => toast.error(t('common.networkShort')));
  }

  render() {
    const s = this.state;
    if (!s.loading && s.settings && !s.settings.available) return null;
    const supported = pushClient.supported();
    return (
      <section id="notifications" ref={(el) => { this.ref = el; }} className="settings-section card-form" aria-labelledby="notif-heading">
        <header>
          <h2 id="notif-heading"><BellRing size={18} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />{t('notif.title')}</h2>
          <p>{t('notif.lead')}</p>
        </header>
        {s.loading ? <SkeletonBlock lines={2} height={44} /> : s.settings ? (
          <div className="stack">
            {supported ? (
              <label className="checkbox-row" htmlFor="pushDevice">
                <span className="switch">
                  <input id="pushDevice" type="checkbox" role="switch" checked={s.onThisDevice} disabled={s.busy} onChange={() => this.toggleDevice()} aria-describedby="pushDevice-hint" />
                  <span className="switch-track" aria-hidden="true" />
                </span>
                <span>
                  <strong>{t('notif.thisDevice')}</strong>{s.busy ? <Spinner /> : null}
                  <span id="pushDevice-hint" className="field-hint" style={{ display: 'block' }}>{t('notif.devices', { count: s.settings.devices })}</span>
                </span>
              </label>
            ) : <Alert tone="info" live={false}>{t('notif.unsupported')}</Alert>}
            <fieldset className="notif-kinds">
              <legend className="field-label">{t('notif.tellMe')}</legend>
              {KINDS.map((k) => (
                <label key={k.key} className="checkbox-row" htmlFor={'notif-' + k.key}>
                  <input id={'notif-' + k.key} type="checkbox" checked={!!s.settings.prefs[k.key]} onChange={(e) => this.setKind(k.key, e.target.checked)} />
                  <span>{t(k.label)}</span>
                </label>
              ))}
            </fieldset>
            <p className="small muted">{t('notif.privacy')}</p>
            {s.settings.devices ? <div className="form-actions"><button type="button" className="btn btn-secondary" onClick={() => this.test()}>{t('notif.test')}</button></div> : null}
          </div>
        ) : null}
        {s.error ? <Alert tone="danger">{s.error}</Alert> : null}
      </section>
    );
  }
}
