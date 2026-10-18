import React from 'react';
import { CalendarPlus, Download, ExternalLink, ChevronDown } from 'lucide-react';
import { calendarEvents, googleUrl, outlookUrl, icsPath } from '../lib/calendar';
import { dayLabel } from '../lib/schedule';
import { t } from '../i18n';

// "Add to calendar" menu for a sale (kind="post") or a neighborhood sale
// (kind="event"): an .ics download (every day, in the sale's time zone, kept
// up to date by UID/SEQUENCE when re-imported) plus Google / Outlook links,
// one per upcoming day. Nothing renders when there are no upcoming days.
export default class AddToCalendar extends React.Component {
  constructor(props) {
    super(props);
    this.state = { open: false };
    this.onDoc = this.onDoc.bind(this);
    this.onKey = this.onKey.bind(this);
  }

  componentWillUnmount() { this.listen(false); }

  listen(on) {
    const fn = on ? 'addEventListener' : 'removeEventListener';
    document[fn]('mousedown', this.onDoc);
    document[fn]('keydown', this.onKey);
  }

  onDoc(e) { if (this.root && !this.root.contains(e.target)) this.close(); }
  onKey(e) { if (e.key === 'Escape') { this.close(); if (this.button) this.button.focus(); } }

  toggle() { const open = !this.state.open; this.setState({ open }); this.listen(open); }
  close() { if (this.state.open) { this.setState({ open: false }); this.listen(false); } }

  render() {
    const { item, kind } = this.props;
    if (!item || item.hidden) return null;
    const events = calendarEvents(item, kind, typeof window !== 'undefined' ? window.location.origin : '');
    if (!events.length) return null;
    const many = events.length > 1;
    const id = 'cal-menu-' + kind + '-' + item.id;
    const link = (href, label, cls) => (
      <a className={'cal-menu-item ' + (cls || '')} href={href} target="_blank" rel="noopener noreferrer" role="menuitem" onClick={() => this.close()}>
        <ExternalLink size={14} aria-hidden="true" />{label}
      </a>
    );
    return (
      <div className={'cal-menu' + (this.state.open ? ' is-open' : '')} ref={(el) => { this.root = el; }}>
        <button type="button" className="btn btn-secondary cal-menu-btn" aria-haspopup="true" aria-expanded={this.state.open} aria-controls={id}
          ref={(el) => { this.button = el; }} onClick={() => this.toggle()}>
          <CalendarPlus size={16} aria-hidden="true" />{t('cal.add')}<ChevronDown size={14} aria-hidden="true" />
        </button>
        {this.state.open ? (
          <div className="cal-menu-list" id={id} role="menu" aria-label={t('cal.add')}>
            <a className="cal-menu-item cal-ics" href={icsPath(item, kind)} download role="menuitem" onClick={() => this.close()}>
              <Download size={14} aria-hidden="true" />
              <span><strong>{t('cal.ics')}</strong><span className="small muted cal-menu-hint">{many ? t('cal.icsAllDays', { count: events.length }) : t('cal.icsHint')}</span></span>
            </a>
            {events.map((ev) => (
              <div key={ev.date} className="cal-menu-group" role="group" aria-label={many ? dayLabel(ev.date) : t('cal.add')}>
                {many ? <span className="cal-menu-day small muted">{dayLabel(ev.date)}</span> : null}
                {link(googleUrl(ev), t('cal.google'), 'cal-google')}
                {link(outlookUrl(ev, 'live'), t('cal.outlook'), 'cal-outlook')}
                {link(outlookUrl(ev, 'office'), t('cal.office'), 'cal-office')}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }
}
