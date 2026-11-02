import React, { Component } from 'react';
import { Link } from 'react-router-dom';
import { HeartHandshake, LocateFixed } from 'lucide-react';
import { fetchNearbyDonations, fetchMyDonations, fetchCurbAlert, errorMessage } from '../api';
import { Alert, EmptyState, Spinner } from '../components/ui';
import { RADII } from '../lib/donations';
import { holdTime } from '../messages/holdText';
import { t } from '../i18n';

// /donations: leftovers from ended sales nearby, free to whoever picks them
// up (people or organizations), plus my own donation pickups.
class Donations extends Component {
  constructor(props) {
    super(props);
    this.state = { radius: '10', coords: null, results: null, mine: [], busy: false, error: '' };
  }

  componentDidMount() {
    this.mounted = true;
    if (this.props.user) {
      fetchMyDonations().then(({ ok, data }) => this.mounted && ok && this.setState({ mine: data.results })).catch(() => {});
      // Start from the free-stuff alert place, if the person set one.
      fetchCurbAlert().then(({ ok, data }) => { if (this.mounted && ok && data.alert) this.search({ lat: data.alert.lat, lng: data.alert.lng }); }).catch(() => {});
    }
  }
  componentWillUnmount() { this.mounted = false; }

  locate() {
    if (!navigator.geolocation) return this.setState({ error: t('list.noGeo') });
    this.setState({ busy: true, error: '' });
    return navigator.geolocation.getCurrentPosition(
      (pos) => this.search({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => this.setState({ busy: false, error: t('list.geoFailed') }),
      { timeout: 10000, maximumAge: 60000 }
    );
  }

  search(coords, radius) {
    const r = radius || this.state.radius;
    this.setState({ busy: true, coords, error: '' });
    fetchNearbyDonations(coords.lat, coords.lng, r).then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) return this.setState({ busy: false, error: errorMessage(data, t('donation.loadFailed')) });
      return this.setState({ busy: false, results: data.results });
    }).catch(() => this.mounted && this.setState({ busy: false, error: t('common.network') }));
  }

  render() {
    const s = this.state;
    return (
      <div className="container container-narrow donations-page">
        <header className="page-header"><div><h1><HeartHandshake size={22} aria-hidden="true" /> {t('donation.nearbyTitle')}</h1><p>{t('donation.nearbyIntro')}</p></div></header>
        {s.mine.length ? (
          <section aria-labelledby="don-mine">
            <h2 id="don-mine" className="h5">{t('donation.mine')}</h2>
            <ul className="stack">{s.mine.map((l) => (
              <li key={l.id}><Link to={l.role === 'seller' ? '/post/' + l.postId + '/donate' : '/donations/' + l.postId}>{l.title}</Link>
                {l.chosen ? <span className="muted small"> · {holdTime(l.chosen.start)}</span> : null}</li>
            ))}</ul>
          </section>
        ) : null}
        <div className="form-actions">
          <button type="button" className="btn btn-primary btn-sm" disabled={s.busy} onClick={() => this.locate()}>{s.busy ? <Spinner /> : <LocateFixed size={14} aria-hidden="true" />}{t('donation.nearMe')}</button>
          <label className="small">{t('donation.within')}{' '}
            <select className="input input-sm" value={s.radius} onChange={(e) => { this.setState({ radius: e.target.value }); if (s.coords) this.search(s.coords, e.target.value); }}>
              {RADII.map((r) => <option key={r} value={String(r)}>{t('donation.miles', { count: r })}</option>)}
            </select>
          </label>
        </div>
        {s.error ? <Alert tone="danger">{s.error}</Alert> : null}
        {s.results && !s.results.length ? <EmptyState level={2} icon={HeartHandshake} title={t('donation.none')}>{t('donation.noneText')}</EmptyState> : null}
        {s.results && s.results.length ? (
          <ul className="stack" aria-live="polite">{s.results.map((l) => (
            <li key={l.id} className="card-form">
              <Link to={'/donations/' + l.postId}><strong>{l.title}</strong></Link>
              <p className="small muted">{[t('donation.milesAway', { count: l.distanceMiles }), l.city, t('donation.itemCount', { count: l.itemCount })].filter(Boolean).join(' · ')}</p>
            </li>
          ))}</ul>
        ) : null}
      </div>
    );
  }
}

export default Donations;
