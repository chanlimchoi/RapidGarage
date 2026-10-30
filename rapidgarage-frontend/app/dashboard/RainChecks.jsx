import React from 'react';
import { Link } from 'react-router-dom';
import { CloudRain, CalendarClock } from 'lucide-react';
import { fetchRainChecks, dismissRainCheck } from '../api';
import { t } from '../i18n';
import { rainPrompt } from '../lib/weatherText';
import PostponeDialog from '../post/PostponeDialog';

// Dashboard: my upcoming sales with bad weather forecast, each with Postpone
// and "Keep the date". Nothing shows without a forecast.
export default class RainChecks extends React.Component {
  constructor(props) { super(props); this.state = { rows: [], open: null }; }
  componentDidMount() { this.unmounted = false; this.load(); }
  componentWillUnmount() { this.unmounted = true; }
  load() { fetchRainChecks().then(({ ok, data }) => { if (!this.unmounted && ok) this.setState({ rows: data.results || [] }); }).catch(() => {}); }

  keep(r) {
    this.setState({ rows: this.state.rows.filter((x) => x.postId !== r.postId) });
    dismissRainCheck(r.postId, r.date).catch(() => {});
  }

  render() {
    const { rows, open } = this.state;
    if (!rows.length) return null;
    return (
      <section className="panel dash-rain" aria-labelledby="dash-rain-title">
        <h2 id="dash-rain-title" className="h4"><CloudRain size={18} aria-hidden="true" className="h1-icon" />{t('wx.rainChecks')}</h2>
        <ul className="dash-pickup-list">
          {rows.map((r) => (
            <li key={r.postId} className="dash-pickup">
              <div className="dash-pickup-main">
                <strong><Link to={'/post/' + r.postId}>{r.title}</Link></strong>
                <span className="small muted">{rainPrompt(r)}</span>
              </div>
              <div className="hold-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => this.setState({ open: r.postId })}><CalendarClock size={14} aria-hidden="true" />{t('wx.postponeAction')}</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => this.keep(r)}>{t('wx.keepDate')}</button>
              </div>
            </li>
          ))}
        </ul>
        {open ? <PostponeDialog postId={open} onClose={() => this.setState({ open: null })} onDone={() => { this.setState({ open: null }); this.load(); if (this.props.onChange) this.props.onChange(); }} /> : null}
      </section>
    );
  }
}
