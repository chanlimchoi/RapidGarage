import React from 'react';
import { Link } from 'react-router-dom';
import { Search, ShieldCheck, Send } from 'lucide-react';
import { errorMessage, fetchMeetupSpots, searchMeetupPlaces, proposeMeetup, meetupAction } from '../api';
import { Alert, Dialog, Spinner } from '../components/ui';
import { t, formatNumber } from '../i18n';
import { kindLabel } from './meetupText';

const MAX_DAYS = 14;
const pad = (n) => String(n).padStart(2, '0');
// <input type="datetime-local"> value for a Date, in local time.
const localInput = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
// Default: tomorrow at 10 AM (daylight), or the time being countered.
function defaultWhen(counterOf) {
  if (counterOf && new Date(counterOf.meetAt) > new Date()) return localInput(new Date(counterOf.meetAt));
  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0);
  return localInput(d);
}
const miles = (s) => (s.distanceMiles === null || s.distanceMiles === undefined ? null
  : t(s.distanceApprox ? 'meet.miApprox' : 'meet.mi', { n: formatNumber(s.distanceMiles) }));

// "Suggest a meetup spot" (or, with counterOf, "Suggest another time or place").
// Spots come from the admin-curated list, nearest the sale's area; a typed-in
// public place (or a nearby search result, when the site has a Places key) also works.
export default class MeetupDialog extends React.Component {
  constructor(props) {
    super(props);
    this.state = { spots: null, origin: null, placesSearch: false, loadError: '', choice: '', placeName: '', placeAddress: '', when: defaultWhen(props.counterOf),
      note: '', busy: false, error: '', fieldErrors: {}, q: '', searching: false, results: null, searchError: '' };
  }
  componentDidMount() {
    this.unmounted = false; // StrictMode (dev) mounts, unmounts and mounts again
    fetchMeetupSpots(this.props.conversationId)
      .then(({ ok, data }) => {
        if (this.unmounted) return;
        if (!ok) { this.setState({ spots: [], loadError: errorMessage(data, t('meet.loadFailed')), choice: 'other' }); return; }
        this.setState({ spots: data.results, origin: data.origin, placesSearch: data.placesSearch, choice: data.results.length ? 'spot:' + data.results[0].id : 'other' });
      })
      .catch(() => { if (!this.unmounted) this.setState({ spots: [], loadError: t('common.networkShort'), choice: 'other' }); });
  }
  componentWillUnmount() { this.unmounted = true; }

  search(e) {
    if (e) e.preventDefault();
    const q = this.state.q.trim();
    if (q.length < 2) return;
    this.setState({ searching: true, searchError: '' });
    searchMeetupPlaces(this.props.conversationId, q)
      .then(({ ok, data }) => { if (!this.unmounted) this.setState(ok ? { searching: false, results: data.results } : { searching: false, results: null, searchError: errorMessage(data, t('meet.searchFailed')) }); })
      .catch(() => { if (!this.unmounted) this.setState({ searching: false, searchError: t('common.networkShort') }); });
  }

  body() {
    const { choice, placeName, placeAddress, when, note, results } = this.state;
    const errors = {};
    const out = { note: note.trim() || undefined };
    if (choice.indexOf('spot:') === 0) out.spotId = Number(choice.slice(5));
    else if (choice.indexOf('found:') === 0) { const p = results[Number(choice.slice(6))]; out.place = { name: p.name, address: p.address || undefined, lat: p.lat, lng: p.lng }; }
    else if (placeName.trim().length < 2) errors.place = t('meet.nameIt');
    else out.place = { name: placeName.trim(), address: placeAddress.trim() || undefined };
    const d = when ? new Date(when) : null;
    if (!d || isNaN(d.getTime())) errors.meetAt = t('meet.pickTime');
    else if (d <= new Date()) errors.meetAt = t('meet.future');
    else out.meetAt = d.toISOString();
    return { errors, out };
  }

  submit(e) {
    e.preventDefault();
    const { errors, out } = this.body();
    if (Object.keys(errors).length) { this.setState({ fieldErrors: errors, error: '' }); return; }
    const c = this.props.counterOf;
    this.setState({ busy: true, error: '', fieldErrors: {} });
    (c ? meetupAction(c.id, 'counter', out) : proposeMeetup(this.props.conversationId, out))
      .then(({ ok, data }) => {
        if (this.unmounted) return;
        if (ok) { this.props.onDone(data); return; }
        const details = (data && data.error && data.error.details) || {};
        const fe = {};
        if (details.spotId || details.place) fe.place = details.spotId || details.place;
        if (details.meetAt) fe.meetAt = details.meetAt;
        if (details.note) fe.note = details.note;
        this.setState({ busy: false, fieldErrors: fe, error: Object.keys(fe).length ? '' : errorMessage(data, t('meet.failed')) });
      })
      .catch(() => { if (!this.unmounted) this.setState({ busy: false, error: t('common.networkShort') }); });
  }

  renderChoice(value, title, meta, notes) {
    return (
      <label key={value} className={'meet-choice' + (this.state.choice === value ? ' is-selected' : '')}>
        <input type="radio" name="meet-place" value={value} checked={this.state.choice === value} onChange={() => this.setState({ choice: value, fieldErrors: {} })} />
        <span className="meet-choice-main">
          <strong>{title}</strong>
          {meta ? <span className="small muted">{meta}</span> : null}
          {notes ? <span className="small meet-choice-notes">{notes}</span> : null}
        </span>
      </label>
    );
  }

  render() {
    const { counterOf, otherName, onClose } = this.props;
    const { spots, origin, placesSearch, loadError, choice, placeName, placeAddress, when, note, busy, error, fieldErrors, q, searching, results, searchError } = this.state;
    const now = new Date();
    const max = new Date(now.getTime() + MAX_DAYS * 86400000);
    const lead = origin && origin.label ? t('meet.lead', { area: origin.label, name: otherName }) : t('meet.leadNoArea', { name: otherName });
    return (
      <Dialog id="meetup-dialog" title={counterOf ? t('meet.counterTitle') : t('meet.dialogTitle')} description={lead} onClose={() => !busy && onClose()}>
        <form onSubmit={(e) => this.submit(e)} noValidate className="meet-form">
          {spots === null ? <Spinner /> : (
            <fieldset className="field meet-places" aria-describedby={fieldErrors.place ? 'meet-place-error' : undefined}>
              <legend className="field-label">{t('meet.spots')}</legend>
              {loadError ? <Alert tone="warning">{loadError}</Alert> : null}
              {!loadError && !spots.length ? <p className="small muted">{t('meet.noSpots')}</p> : null}
              <div className="meet-choices">
                {spots.map((s) => this.renderChoice('spot:' + s.id, s.name,
                  [kindLabel(s.kind), [s.address, s.city].filter(Boolean).join(', '), miles(s)].filter(Boolean).join(' · '), s.notes))}
                {results ? results.map((p, i) => this.renderChoice('found:' + i, p.name, [p.address, miles(p)].filter(Boolean).join(' · '))) : null}
                {this.renderChoice('other', t('meet.other'), t('meet.otherHint'))}
              </div>
              {placesSearch ? (
                <div className="meet-search">
                  <label htmlFor="meet-q" className="sr-only">{t('meet.search')}</label>
                  <input id="meet-q" className="input" value={q} placeholder={t('meet.searchPlaceholder')} maxLength={80}
                    onChange={(e) => this.setState({ q: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') this.search(e); }} />
                  <button type="button" className="btn btn-secondary btn-sm" disabled={searching || q.trim().length < 2} onClick={() => this.search()}>
                    {searching ? <Spinner /> : <Search size={14} aria-hidden="true" />}{t('meet.search')}
                  </button>
                  {results && !results.length ? <p className="small muted">{t('meet.searchNone')}</p> : null}
                  {searchError ? <p className="small field-error" role="alert">{searchError}</p> : null}
                </div>
              ) : null}
              {choice === 'other' ? (
                <div className="meet-other">
                  <label className="field" htmlFor="meet-place-name">
                    <span className="field-label">{t('meet.placeName')}</span>
                    <input id="meet-place-name" className="input" value={placeName} maxLength={120} aria-invalid={fieldErrors.place ? 'true' : undefined}
                      onChange={(e) => this.setState({ placeName: e.target.value, fieldErrors: {} })} placeholder={t('meet.placeNamePlaceholder')} />
                  </label>
                  <label className="field" htmlFor="meet-place-address">
                    <span className="field-label">{t('meet.placeAddress')} <span className="muted small">{t('ui.optional')}</span></span>
                    <input id="meet-place-address" className="input" value={placeAddress} maxLength={200} onChange={(e) => this.setState({ placeAddress: e.target.value })} />
                  </label>
                  <p className="field-hint">{t('meet.placeHint')}</p>
                </div>
              ) : null}
              {fieldErrors.place ? <span id="meet-place-error" className="field-error" role="alert">{fieldErrors.place}</span> : null}
            </fieldset>
          )}
          <label className="field" htmlFor="meet-when">
            <span className="field-label">{t('meet.when')}</span>
            <input id="meet-when" type="datetime-local" className="input" value={when} min={localInput(now)} max={localInput(max)}
              aria-invalid={fieldErrors.meetAt ? 'true' : undefined} aria-describedby="meet-when-hint" onChange={(e) => this.setState({ when: e.target.value, fieldErrors: {} })} />
            {fieldErrors.meetAt ? <span className="field-error" role="alert">{fieldErrors.meetAt}</span> : <span id="meet-when-hint" className="field-hint">{t('meet.whenHint', { n: MAX_DAYS })}</span>}
          </label>
          <label className="field" htmlFor="meet-note">
            <span className="field-label">{t('meet.note')} <span className="muted small">{t('ui.optional')}</span></span>
            <input id="meet-note" className="input" value={note} maxLength={200} placeholder={t('meet.notePlaceholder')} onChange={(e) => this.setState({ note: e.target.value })} />
            {fieldErrors.note ? <span className="field-error" role="alert">{fieldErrors.note}</span> : null}
          </label>
          <p className="small muted meet-tip"><ShieldCheck size={14} aria-hidden="true" /> {t('meet.tip')} <Link to="/safety" target="_blank" rel="noopener">{t('safety.link')}</Link></p>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <div className="dialog-footer">
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>{t('common.cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={busy || spots === null}>{busy ? <Spinner /> : <Send size={16} aria-hidden="true" />}{t('meet.send')}</button>
          </div>
        </form>
      </Dialog>
    );
  }
}
