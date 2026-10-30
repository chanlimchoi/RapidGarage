import React from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight, Bell, BellRing, MapPin, Navigation, UsersRound, Tag, LocateFixed, LogIn } from 'lucide-react';
import { fetchCalendar, fetchAlerts, errorMessage } from '../api';
import { Alert, EmptyState, SkeletonBlock } from '../components/ui';
import * as saved from '../lib/saved';
import { browserTimeZone, dateIn, timeLabel, dayLabel } from '../lib/schedule';
import { formatPrice } from '../lib/price';
import { formatMiles } from '../lib/format';
import { VIEWS, RADII, shift, fromQuery, toQuery, apiParams, totalSales } from '../lib/calendarView';
import { t } from '../i18n';

const VIEW_LABEL = { weekend: 'cal.viewWeekend', day: 'cal.viewDay', week: 'cal.viewWeek' };
const WHERE_KEYS = { all: 'cal.whereAll', near: 'cal.whereNear', zip: 'cal.whereZip' };

// "This weekend" calendar: upcoming sales date first (weekend / day / week),
// near the viewer, a zip, or one of their saved searches. "Remind me" saves
// the sale with a reminder (the evening before and the morning of).
export default class SaleCalendar extends React.Component {
  constructor(props) {
    super(props);
    const q = fromQuery(props.location && props.location.search);
    this.state = Object.assign(q, { zipInput: q.zip, coords: null, data: null, loading: true, error: '', alerts: null, locating: false });
    this.unsub = null;
  }

  componentDidMount() {
    this.mounted = true;
    document.title = t('cal.pageTitle') + ' · RapidGarage';
    this.unsub = saved.subscribe(() => this.mounted && this.forceUpdate());
    if (this.props.user) this.loadAlerts();
    if (this.state.where === 'near') this.locate(); else this.load();
  }
  componentDidUpdate(prev) {
    if (this.props.user && !prev.user) this.loadAlerts();
  }
  componentWillUnmount() { this.mounted = false; if (this.unsub) this.unsub(); }

  loadAlerts() {
    fetchAlerts().then(({ ok, data }) => {
      if (!this.mounted || !ok) return;
      this.setState({ alerts: Array.isArray(data) ? data : (data && (data.results || data.alerts)) || [] });
    }).catch(() => null);
  }

  update(patch) {
    this.setState(patch, () => {
      if (this.props.history) this.props.history.replace('/calendar' + toQuery(this.state));
      if (this.state.where === 'near' && !this.state.coords) this.locate(); else this.load();
    });
  }

  locate() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return this.setState({ loading: false, error: t('list.noGeo') });
    this.setState({ locating: true, loading: true, error: '' });
    navigator.geolocation.getCurrentPosition(
      (pos) => this.mounted && this.setState({ locating: false, coords: { lat: pos.coords.latitude, lng: pos.coords.longitude } }, () => this.load()),
      () => this.mounted && this.setState({ locating: false, loading: false, error: t('cal.geoDenied') }),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
    );
    return undefined;
  }

  load() {
    const seq = (this.seq = (this.seq || 0) + 1);
    this.setState({ loading: true, error: '' });
    fetchCalendar(apiParams(this.state, this.state.coords, browserTimeZone())).then(({ ok, data }) => {
      if (!this.mounted || seq !== this.seq) return;
      if (!ok) return this.setState({ loading: false, error: errorMessage(data, t('cal.loadFailed')) });
      return this.setState({ loading: false, data });
    }).catch(() => this.mounted && seq === this.seq && this.setState({ loading: false, error: t('common.networkShort') }));
  }

  anchor() { return this.state.date || (this.state.data && this.state.data.date) || dateIn(new Date(), browserTimeZone()); }

  heading() {
    const d = this.state.data;
    if (!d || !d.dates || !d.dates.length) return '';
    if (d.dates.length === 1) return dayLabel(d.dates[0]);
    return t('cal.range', { from: dayLabel(d.dates[0]), to: dayLabel(d.dates[d.dates.length - 1]) });
  }

  remindButton(sale) {
    if (sale.own) return <span className="small muted">{t('cal.yourSale')}</span>;
    if (!this.props.user) return <Link className="btn btn-ghost btn-sm" to="/login"><LogIn size={16} aria-hidden="true" />{t('cal.logInToRemind')}</Link>;
    const on = saved.isReminding(sale.postId);
    const pending = saved.isPending(sale.postId);
    return (
      <button type="button" className={'btn btn-sm ' + (on ? 'btn-secondary' : 'btn-ghost')} aria-pressed={on} disabled={pending}
        onClick={() => saved.setReminder({ id: sale.postId }, !on)}>
        {on ? <BellRing size={16} aria-hidden="true" /> : <Bell size={16} aria-hidden="true" />}{on ? t('cal.reminding') : t('cal.remindMe')}
      </button>
    );
  }

  renderSale(s) {
    const price = formatPrice(s);
    return (
      <li key={s.postId + '-' + s.date} className="cal-sale">
        <div className="cal-time">
          <span className="cal-time-start">{timeLabel(s.start)}</span>
          <span className="small muted">{timeLabel(s.end)}</span>
        </div>
        {s.thumbUrl ? <img className="cal-thumb" src={s.thumbUrl} alt="" loading="lazy" width="56" height="56" /> : <span className="cal-thumb cal-thumb-empty" aria-hidden="true"><Tag size={18} /></span>}
        <div className="cal-body">
          <Link className="cal-title" to={'/post/' + s.postId}>{s.title || t('bell.untitled')}</Link>
          <div className="chips">
            {s.open ? <span className="chip chip-brand">{t('cal.openNow')}</span> : null}
            {price ? <span className={'chip chip-price' + (s.isFree ? ' chip-free' : '')}>{price}</span> : null}
            {s.city ? <span className="chip"><MapPin size={12} aria-hidden="true" />{[s.city, s.state].filter(Boolean).join(', ')}</span> : null}
            {s.distanceMiles !== null && s.distanceMiles !== undefined ? <span className="chip"><Navigation size={12} aria-hidden="true" />{formatMiles(s.distanceMiles)}</span> : null}
            {s.event ? <Link className="chip chip-event" to={'/events/' + s.event.id}><UsersRound size={12} aria-hidden="true" />{t('ev.partOf', { name: s.event.name })}</Link> : null}
          </div>
        </div>
        <div className="cal-action">{this.remindButton(s)}</div>
      </li>
    );
  }

  render() {
    const s = this.state;
    const alerts = s.alerts || [];
    const d = s.data;
    return (
      <div className="container">
        <header className="page-header">
          <div>
            <h1><CalendarDays size={26} aria-hidden="true" style={{ verticalAlign: '-4px', marginRight: 8 }} />{t('cal.pageTitle')}</h1>
            <p>{t('cal.lead')}</p>
          </div>
        </header>
        <section className="panel cal-controls" aria-label={t('cal.controls')}>
          <div className="segmented" role="group" aria-label={t('cal.view')}>
            {VIEWS.map((v) => <button key={v} type="button" aria-pressed={s.view === v} onClick={() => this.update({ view: v })}>{t(VIEW_LABEL[v])}</button>)}
          </div>
          <div className="cal-nav">
            <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={t('cal.prev')} onClick={() => this.update({ date: shift(s.view, this.anchor(), -1) })}><ChevronLeft size={18} aria-hidden="true" /></button>
            <span className="cal-range" aria-live="polite">{this.heading()}</span>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={t('cal.next')} onClick={() => this.update({ date: shift(s.view, this.anchor(), 1) })}><ChevronRight size={18} aria-hidden="true" /></button>
            {s.date ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => this.update({ date: null })}>{t('cal.today')}</button> : null}
          </div>
          <div className="cal-where">
            <label className="sr-only" htmlFor="cal-where">{t('cal.where')}</label>
            <select id="cal-where" className="input" value={s.where === 'alert' ? 'alert:' + s.alert : s.where}
              onChange={(e) => {
                const v = e.target.value;
                if (v.indexOf('alert:') === 0) this.update({ where: 'alert', alert: Number(v.slice(6)) });
                else this.update({ where: v, alert: null });
              }}>
              {Object.keys(WHERE_KEYS).map((k) => <option key={k} value={k}>{t(WHERE_KEYS[k])}</option>)}
              {alerts.length ? (
                <optgroup label={t('cal.savedSearches')}>
                  {alerts.map((a) => <option key={a.id} value={'alert:' + a.id}>{a.label || (a.keyword ? '“' + a.keyword + '”' : t('cal.savedSearchN', { n: a.id }))}</option>)}
                </optgroup>
              ) : null}
              {s.where === 'alert' && !alerts.some((a) => a.id === s.alert) ? <option value={'alert:' + s.alert}>{t('cal.savedSearch')}</option> : null}
            </select>
            {s.where === 'zip' ? (
              <form className="cal-zip" onSubmit={(e) => { e.preventDefault(); this.update({ zip: s.zipInput.trim() }); }}>
                <label className="sr-only" htmlFor="cal-zip">{t('cal.zipLabel')}</label>
                <input id="cal-zip" className="input" type="search" inputMode="text" maxLength={200} placeholder={t('cal.zipPlaceholder')} value={s.zipInput}
                  onChange={(e) => this.setState({ zipInput: e.target.value })} />
                <button type="submit" className="btn btn-secondary btn-sm">{t('cal.go')}</button>
              </form>
            ) : null}
            {s.where === 'near' && s.locating ? <span className="small muted"><LocateFixed size={14} aria-hidden="true" /> {t('cal.locating')}</span> : null}
            {s.where === 'zip' || s.where === 'near' ? (
              <React.Fragment>
                <label className="sr-only" htmlFor="cal-radius">{t('cal.radius')}</label>
                <select id="cal-radius" className="input cal-radius" value={s.radius} onChange={(e) => this.update({ radius: Number(e.target.value) })}>
                  {RADII.map((r) => <option key={r} value={r}>{t('cal.withinMiles', { count: r })}</option>)}
                </select>
              </React.Fragment>
            ) : null}
          </div>
        </section>
        {d && d.notice ? <Alert tone="info">{d.notice.message}</Alert> : null}
        {s.error ? <Alert tone="danger">{s.error}</Alert> : null}
        {s.loading && !d ? <SkeletonBlock lines={6} /> : null}
        {d && !s.error ? (
          <div className="cal-days" aria-busy={s.loading}>
            {totalSales(d) === 0 ? (
              <EmptyState icon={CalendarDays} title={t('cal.noneTitle')}
                action={<Link className="btn btn-primary" to="/">{t('nav.browseSales')}</Link>}>
                {t('cal.noneText')}
              </EmptyState>
            ) : d.days.map((day) => (
              <section key={day.date} className="cal-day panel" aria-labelledby={'cal-day-' + day.date}>
                <h2 className="h4 cal-day-title" id={'cal-day-' + day.date}>
                  {dayLabel(day.date)} <span className="small muted">{t('cal.salesCount', { count: day.sales.length })}</span>
                </h2>
                {day.sales.length ? <ul className="cal-list">{day.sales.map((x) => this.renderSale(x))}</ul> : <p className="small muted">{t('cal.noneDay')}</p>}
              </section>
            ))}
            {d.truncated ? <p className="small muted">{t('cal.truncated')}</p> : null}
            <p className="small muted cal-foot">{t('cal.remindNote')} <Link to="/settings#reminders">{t('cal.remindSettings')}</Link></p>
          </div>
        ) : null}
      </div>
    );
  }
}
