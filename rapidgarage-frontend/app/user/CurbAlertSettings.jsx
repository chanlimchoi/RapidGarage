import React from 'react';
import { Link } from 'react-router-dom';
import { Gift, LocateFixed } from 'lucide-react';
import { fetchCurbAlert, saveCurbAlert, deleteCurbAlert, errorMessage } from '../api';
import { Alert, SkeletonBlock, Spinner } from '../components/ui';
import toast from '../components/toast';
import { RADIUS_CHOICES, radiusLabel } from '../lib/curbPost';
import { t } from '../i18n';

// Settings > Free stuff nearby: opt in to a bell + push when someone puts
// free stuff at the curb within a radius of a place you set (your location,
// stored rounded; never shown to anyone).
export default class CurbAlertSettings extends React.Component {
  constructor(props) {
    super(props);
    this.state = { loading: true, alert: null, radius: '1', busy: false, error: '' };
  }

  componentDidMount() {
    this.mounted = true;
    fetchCurbAlert().then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) return this.setState({ loading: false, error: errorMessage(data, t('curbAlert.loadFailed')) });
      const a = data.alert;
      return this.setState({ loading: false, alert: a, radius: a ? String(a.radiusMiles) : '1' });
    }).catch(() => this.mounted && this.setState({ loading: false, error: t('common.networkShort') }));
  }
  componentWillUnmount() { this.mounted = false; }

  save(body) {
    this.setState({ busy: true, error: '' });
    return saveCurbAlert(body).then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) return this.setState({ busy: false, error: errorMessage(data, t('curbAlert.saveFailed')) });
      this.setState({ busy: false, alert: data.alert, radius: String(data.alert.radiusMiles) });
      toast.success(data.alert.enabled ? t('curbAlert.on') : t('curbAlert.paused'));
    }).catch(() => this.mounted && this.setState({ busy: false, error: t('common.networkShort') }));
  }

  // Turn on (or move the circle): needs the device location.
  locateAndSave() {
    if (!navigator.geolocation) return this.setState({ error: t('list.noGeo') });
    this.setState({ busy: true, error: '' });
    return navigator.geolocation.getCurrentPosition(
      (pos) => this.save({ lat: pos.coords.latitude, lng: pos.coords.longitude, radiusMiles: Number(this.state.radius), enabled: true }),
      () => this.mounted && this.setState({ busy: false, error: t('list.geoFailed') }),
      { timeout: 10000, maximumAge: 300000 }
    );
  }

  update(patch) {
    const a = this.state.alert;
    return this.save(Object.assign({ lat: a.lat, lng: a.lng, radiusMiles: a.radiusMiles, enabled: a.enabled }, patch));
  }

  remove() {
    this.setState({ busy: true, error: '' });
    deleteCurbAlert().then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) return this.setState({ busy: false, error: errorMessage(data, t('curbAlert.saveFailed')) });
      this.setState({ busy: false, alert: null });
      toast.success(t('curbAlert.removed'));
    }).catch(() => this.mounted && this.setState({ busy: false, error: t('common.networkShort') }));
  }

  render() {
    const s = this.state;
    const a = s.alert;
    return (
      <section className="settings-section card-form" id="curb-alerts" aria-labelledby="curb-alerts-heading">
        <header>
          <h2 id="curb-alerts-heading"><Gift size={18} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />{t('curbAlert.title')}</h2>
          <p>{t('curbAlert.lead')} <Link to="/curb/new">{t('curbAlert.postLink')}</Link></p>
        </header>
        {s.loading ? <SkeletonBlock lines={2} /> : (
          <div className="stack">
            <label className="field-label" htmlFor="curb-radius">{t('curbAlert.radius')}</label>
            <select id="curb-radius" className="input" value={s.radius} disabled={s.busy}
              onChange={(e) => { this.setState({ radius: e.target.value }); if (a) this.update({ radiusMiles: Number(e.target.value) }); }}>
              {RADIUS_CHOICES.map((r) => <option key={r} value={String(r)}>{radiusLabel(r)}</option>)}
            </select>
            {a ? (
              <label className="checkbox-row" htmlFor="curb-enabled">
                <span className="switch">
                  <input id="curb-enabled" type="checkbox" role="switch" checked={a.enabled} disabled={s.busy} onChange={(e) => this.update({ enabled: e.target.checked })} />
                  <span className="switch-track" aria-hidden="true" />
                </span>
                <span><strong>{t('curbAlert.enabled')}</strong><span className="field-hint" style={{ display: 'block' }}>{t('curbAlert.privacy')}</span></span>
              </label>
            ) : <p className="field-hint">{t('curbAlert.privacy')}</p>}
            <div className="row">
              <button type="button" className="btn btn-secondary btn-sm" disabled={s.busy} onClick={() => this.locateAndSave()}>
                {s.busy ? <Spinner /> : <LocateFixed size={16} aria-hidden="true" />}{a ? t('curbAlert.move') : t('curbAlert.turnOn')}
              </button>
              {a ? <button type="button" className="btn btn-ghost btn-sm" disabled={s.busy} onClick={() => this.remove()}>{t('curbAlert.remove')}</button> : null}
            </div>
            {s.error ? <Alert tone="danger">{s.error}</Alert> : null}
          </div>
        )}
      </section>
    );
  }
}
