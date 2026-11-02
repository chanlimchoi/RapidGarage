import React, { Component } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, HeartHandshake, MessageCircle, SearchX } from 'lucide-react';
import { fetchDonation, claimDonation, donationStep, errorMessage } from '../api';
import { Alert, EmptyState, Field, SkeletonBlock, Spinner } from '../components/ui';
import { openSlots } from '../lib/donations';
import { holdTime } from '../messages/holdText';
import toast from '../components/toast';
import { t } from '../i18n';

const paramId = (props) => (props.match && props.match.params && props.match.params.postId) || (props.params && props.params.postId);

// /donations/:postId: one sale's leftovers up for donation. Signed-in people
// claim it for one pickup time (optionally for an organization).
class DonationLot extends Component {
  constructor(props) {
    super(props);
    this.state = { lot: null, error: '', slot: '', org: '', errors: {}, busy: false };
  }

  componentDidMount() { this.mounted = true; this.load(); }
  componentWillUnmount() { this.mounted = false; }
  load() {
    fetchDonation(paramId(this.props)).then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) return this.setState({ error: errorMessage(data, t('donation.notFound')) });
      return this.setState({ lot: data });
    }).catch(() => this.mounted && this.setState({ error: t('common.network') }));
  }

  claim(e) {
    e.preventDefault();
    if (!this.state.slot) { this.setState({ errors: { slot: t('donation.pickTime') } }); return; }
    this.setState({ busy: true, errors: {} });
    claimDonation(paramId(this.props), { slot: this.state.slot, org: this.state.org.trim() || null }).then(({ ok, status, data }) => {
      this.setState({ busy: false });
      if (!ok) {
        const d = (data && data.error && data.error.details) || {};
        this.setState({ errors: d });
        if (!Object.keys(d).length) toast.error(errorMessage(data, t('donation.claimFailed')));
        if (status === 409) this.load();
        return;
      }
      this.setState({ lot: data });
      toast.success(t('donation.claimed'));
    }).catch(() => { this.setState({ busy: false }); toast.error(t('common.network')); });
  }

  unclaim() {
    this.setState({ busy: true });
    donationStep(paramId(this.props), 'unclaim').then(({ ok, data }) => {
      this.setState({ busy: false });
      if (!ok) { toast.error(errorMessage(data, t('donation.claimFailed'))); return; }
      this.setState({ lot: data, slot: '' });
    }).catch(() => { this.setState({ busy: false }); toast.error(t('common.network')); });
  }

  render() {
    const s = this.state;
    const back = <Link to="/donations" className="back-link"><ArrowLeft size={16} aria-hidden="true" />{t('donation.nearbyTitle')}</Link>;
    if (s.error) return <div className="container container-narrow">{back}<EmptyState level={1} icon={SearchX} title={t('donation.notFound')}>{s.error}</EmptyState></div>;
    if (!s.lot) return <div className="container container-narrow"><SkeletonBlock lines={5} /></div>;
    const lot = s.lot;
    const slots = openSlots(lot);
    const user = this.props.user;
    return (
      <div className="container container-narrow donation-lot">
        {back}
        <header className="page-header">
          <div>
            <h1><HeartHandshake size={22} aria-hidden="true" /> {t('donation.title', { title: lot.title || '' })}</h1>
            <p>{[lot.seller ? t('bell.by', { name: lot.seller.name }) : '', lot.city].filter(Boolean).join(' · ')}</p>
          </div>
        </header>
        <div className="card-form">
          {lot.items.length ? <ul>{lot.items.map((i) => <li key={i.id}>{i.name}</li>)}</ul> : null}
          {lot.note ? <p>{lot.note}</p> : null}
          <p><Link to={'/post/' + lot.postId}>{t('donation.seeSale')}</Link></p>
        </div>
        {lot.role === 'claimer' ? (
          <div className="card-form" role="status">
            <p><strong>{t('donation.yours')}</strong></p>
            {lot.chosen ? <p>{t('donate.pickupAt', { time: holdTime(lot.chosen.start) })}</p> : null}
            <div className="form-actions">
              {lot.conversationId ? <Link className="btn btn-primary btn-sm" to={'/messages/' + lot.conversationId}><MessageCircle size={14} aria-hidden="true" />{t('donation.messageSeller')}</Link> : null}
              <button type="button" className="btn btn-ghost btn-sm" disabled={s.busy} onClick={() => this.unclaim()}>{t('donation.unclaim')}</button>
            </div>
          </div>
        ) : lot.role === 'seller' ? (
          <p><Link className="btn btn-secondary btn-sm" to={'/post/' + lot.postId + '/donate'}>{t('donation.manage')}</Link></p>
        ) : lot.claimed ? (
          <Alert tone="info">{t('donation.taken')}</Alert>
        ) : !slots.length ? (
          <Alert tone="info">{t('donation.noTimes')}</Alert>
        ) : !user ? (
          <p><Link className="btn btn-primary" to="/login">{t('donation.loginToClaim')}</Link></p>
        ) : (
          <form className="card-form" onSubmit={(e) => this.claim(e)} noValidate>
            <fieldset>
              <legend>{t('donation.pickTime')}</legend>
              {slots.map((sl) => (
                <label key={sl.start} className="checkbox-row">
                  <input type="radio" name="donation-slot" value={sl.start} checked={s.slot === sl.start} onChange={() => this.setState({ slot: sl.start })} />
                  <span>{holdTime(sl.start)}</span>
                </label>
              ))}
              {s.errors.slot ? <p className="field-error">{s.errors.slot}</p> : null}
            </fieldset>
            <Field id="donation-org" label={t('donation.org')} optional error={s.errors.org}>
              <input id="donation-org" className="input" maxLength={80} placeholder={t('donation.orgPlaceholder')} value={s.org} onChange={(e) => this.setState({ org: e.target.value })} />
            </Field>
            <div className="form-actions"><button type="submit" className="btn btn-primary" disabled={s.busy}>{s.busy ? <Spinner /> : <HeartHandshake size={16} aria-hidden="true" />}{t('donation.claim')}</button></div>
          </form>
        )}
      </div>
    );
  }
}

export default DonationLot;
