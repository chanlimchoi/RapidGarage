import React from 'react';
import { CloudRain, CloudSun, CalendarClock } from 'lucide-react';
import { fetchSaleWeather, dismissRainCheck } from '../api';
import { Alert } from '../components/ui';
import { t } from '../i18n';
import { dayLine, rainPrompt } from '../lib/weatherText';
import PostponeDialog from './PostponeDialog';

// Forecast chips for a sale's upcoming days and, for the seller, a rain-check
// prompt with Postpone. Shows nothing when there's no forecast (weather off,
// API unreachable, or the sale is further out than the forecast).
export default class SaleWeather extends React.Component {
  constructor(props) { super(props); this.state = { data: null, open: false, dismissed: false }; }
  componentDidMount() { this.unmounted = false; this.load(); }
  componentDidUpdate(prev) { if (prev.postId !== this.props.postId || prev.version !== this.props.version) this.load(); }
  componentWillUnmount() { this.unmounted = true; }

  load() {
    fetchSaleWeather(this.props.postId).then(({ ok, data }) => { if (!this.unmounted && ok) this.setState({ data, dismissed: false }); }).catch(() => {});
  }

  keep() {
    const rc = this.state.data && this.state.data.rainCheck;
    if (!rc) return;
    this.setState({ dismissed: true });
    dismissRainCheck(this.props.postId, rc.date).catch(() => {});
  }

  render() {
    const { data, open, dismissed } = this.state;
    if (!data || !data.weather) return null;
    const rc = !dismissed && data.rainCheck;
    return (
      <div className="sale-weather">
        {rc ? (
          <Alert tone="warning" className="rain-check">
            <p><strong>{t('wx.rainCheck')}</strong>{' '}{rainPrompt(rc)}</p>
            <div className="form-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => this.setState({ open: true })}><CalendarClock size={14} aria-hidden="true" />{t('wx.postponeAction')}</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => this.keep()}>{t('wx.keepDate')}</button>
            </div>
          </Alert>
        ) : null}
        <ul className="chips weather-chips" aria-label={t('wx.forecast')}>
          {data.weather.days.map((d) => (
            <li key={d.date} className={'chip' + (d.bad ? ' chip-warning' : '')}>
              {d.bad ? <CloudRain size={12} aria-hidden="true" /> : <CloudSun size={12} aria-hidden="true" />}{dayLine(d)}
            </li>
          ))}
        </ul>
        <p className="small muted weather-credit">{t('wx.credit')} <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a></p>
        {open ? <PostponeDialog postId={this.props.postId} onClose={() => this.setState({ open: false })}
          onDone={(post) => { this.setState({ open: false }); if (this.props.onPostponed) this.props.onPostponed(post); }} /> : null}
      </div>
    );
  }
}
