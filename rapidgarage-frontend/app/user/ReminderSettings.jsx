import React from 'react';
import { CalendarClock } from 'lucide-react';
import { fetchReminderSettings, saveReminderSettings, errorMessage } from '../api';
import { Alert, SkeletonBlock } from '../components/ui';
import * as saved from '../lib/saved';
import { timeLabel } from '../lib/schedule';
import toast from '../components/toast';
import { t } from '../i18n';

// Settings > Morning-of reminders: the default for newly saved sales, and a
// one-time "apply to the sales I've already saved".
export default class ReminderSettings extends React.Component {
  constructor(props) {
    super(props);
    this.state = { loading: true, defaultOn: false, emailAvailable: true, hour: 7, nightBefore: true, eveHour: 19, applyToSaved: false, busy: false, error: '' };
  }

  componentDidMount() {
    this.mounted = true;
    fetchReminderSettings().then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) return this.setState({ loading: false, error: errorMessage(data, t('rem.loadFailed')) });
      this.setState({ loading: false, defaultOn: data.defaultOn, emailAvailable: data.emailAvailable, hour: data.hour, nightBefore: data.nightBefore !== false, eveHour: data.eveHour || 19 });
      if (window.location.hash === '#reminders' && this.ref && this.ref.scrollIntoView) this.ref.scrollIntoView({ block: 'start' });
    }).catch(() => this.mounted && this.setState({ loading: false, error: t('common.networkShort') }));
  }
  componentWillUnmount() { this.mounted = false; }

  save(patch) {
    const next = Object.assign({ defaultOn: this.state.defaultOn, applyToSaved: this.state.applyToSaved }, patch);
    this.setState({ busy: true, error: '' });
    saveReminderSettings(next).then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) return this.setState({ busy: false, error: errorMessage(data, t('rem.saveFailed')) });
      this.setState({ busy: false, defaultOn: data.defaultOn, applyToSaved: false });
      toast.success(next.applyToSaved ? t('rem.appliedToast', { count: data.changed || 0 }) : t('rem.settingsSaved'));
      if (next.applyToSaved) saved.refresh();
    }).catch(() => this.mounted && this.setState({ busy: false, error: t('common.networkShort') }));
  }

  // Night-before reminder (bell + push): its own switch.
  saveNightBefore(on) {
    this.setState({ busy: true, error: '' });
    saveReminderSettings({ nightBefore: on }).then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) return this.setState({ busy: false, error: errorMessage(data, t('rem.saveFailed')) });
      this.setState({ busy: false, nightBefore: data.nightBefore });
      toast.success(t('rem.settingsSaved'));
    }).catch(() => this.mounted && this.setState({ busy: false, error: t('common.networkShort') }));
  }

  render() {
    const s = this.state;
    const time = timeLabel(String(s.hour).padStart(2, '0') + ':00');
    return (
      <section className="settings-section card-form" id="reminders" aria-labelledby="reminders-heading" ref={(el) => { this.ref = el; }}>
        <header>
          <h2 id="reminders-heading"><CalendarClock size={18} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />{t('rem.settingsTitle')}</h2>
          <p>{t('rem.settingsLead', { time })}</p>
        </header>
        {s.loading ? <SkeletonBlock lines={2} /> : (
          <div className="stack">
            <label className="checkbox-row" htmlFor="remind-default">
              <span className="switch">
                <input id="remind-default" type="checkbox" role="switch" checked={s.defaultOn} disabled={s.busy}
                  onChange={(e) => this.save({ defaultOn: e.target.checked, applyToSaved: false })} />
                <span className="switch-track" aria-hidden="true" />
              </span>
              <span><strong>{t('rem.defaultLabel')}</strong><span className="field-hint" style={{ display: 'block' }}>{t('rem.defaultHint')}</span></span>
            </label>
            <div className="row reminder-apply">
              <button type="button" className="btn btn-secondary btn-sm" disabled={s.busy} onClick={() => this.save({ applyToSaved: true })}>
                {s.defaultOn ? t('rem.applyOn') : t('rem.applyOff')}
              </button>
            </div>
            <label className="checkbox-row" htmlFor="remind-eve">
              <span className="switch">
                <input id="remind-eve" type="checkbox" role="switch" checked={s.nightBefore} disabled={s.busy}
                  onChange={(e) => this.saveNightBefore(e.target.checked)} />
                <span className="switch-track" aria-hidden="true" />
              </span>
              <span><strong>{t('rem.eveLabel')}</strong><span className="field-hint" style={{ display: 'block' }}>{t('rem.eveHint', { time: timeLabel(String(s.eveHour).padStart(2, '0') + ':00') })}</span></span>
            </label>
            {!s.emailAvailable ? <Alert tone="info" live={false}><p>{t('rem.noEmail')}</p></Alert> : null}
            {s.error ? <Alert tone="danger">{s.error}</Alert> : null}
          </div>
        )}
      </section>
    );
  }
}
