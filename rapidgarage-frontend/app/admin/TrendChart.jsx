import React from 'react';
import { areaGeometry, nearestIndex } from '../lib/analytics';
import { shortDay } from '../dashboard/BarChart';
import { t, intlLocale } from '../i18n';

const W = 320;
const H = 120;
const PAD = 6;
const fmt = (n) => new Intl.NumberFormat(intlLocale()).format(n);

// One series over time: area + 2px line, a crosshair that snaps to the
// nearest day (pointer or arrow keys) with a tooltip, recessive axis, and the
// numbers in a table (visually hidden unless "Show table" is on).
export default class TrendChart extends React.Component {
  constructor(props) {
    super(props);
    this.state = { active: null };
    this.box = React.createRef();
  }

  pointAt(e) {
    const r = this.box.current.getBoundingClientRect();
    const f = r.width ? (e.clientX - r.left) / r.width : 0;
    this.setState({ active: nearestIndex(f, this.props.series.length) });
  }

  key(e) {
    const n = this.props.series.length;
    if (!n) return;
    const cur = this.state.active === null ? n - 1 : this.state.active;
    const next = { ArrowLeft: cur - 1, ArrowRight: cur + 1, Home: 0, End: n - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    this.setState({ active: Math.max(0, Math.min(n - 1, next)) });
  }

  render() {
    const { id, title, series, showTable } = this.props;
    const g = areaGeometry(series, W, H, PAD);
    const a = this.state.active === null ? null : g.points[this.state.active];
    const total = series.reduce((s, d) => s + d.count, 0);
    const leftPct = a ? (a.x / W) * 100 : 0;
    return (
      <figure className="trend-chart" aria-labelledby={id + '-title'}>
        <figcaption className="trend-chart-head">
          <span id={id + '-title'} className="trend-chart-title">{title}</span>
          <strong className="trend-chart-total">{fmt(total)}</strong>
        </figcaption>
        <div className="trend-chart-plot" ref={this.box} tabIndex={0} role="img"
          aria-label={t('an.chartAria', { title, total: fmt(total), from: series.length ? shortDay(series[0].date) : '', to: series.length ? shortDay(series[series.length - 1].date) : '' })}
          onPointerMove={(e) => this.pointAt(e)} onPointerLeave={() => this.setState({ active: null })}
          onFocus={() => this.setState({ active: series.length - 1 })} onBlur={() => this.setState({ active: null })} onKeyDown={(e) => this.key(e)}>
          <svg viewBox={'0 0 ' + W + ' ' + H} preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <line className="trend-gridline" x1="0" x2={W} y1={PAD} y2={PAD} />
            <line className="trend-base" x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} />
            <path className="trend-area" d={g.area} />
            <path className="trend-line" d={g.line} />
            {a ? <line className="trend-cross" x1={a.x} x2={a.x} y1="0" y2={H} /> : null}
          </svg>
          {a ? <span className="trend-dot" style={{ left: leftPct + '%', top: (a.y / H) * 100 + '%' }} aria-hidden="true" /> : null}
          {a ? (
            <div className={'trend-tip' + (leftPct > 60 ? ' is-left' : '')} style={{ left: leftPct + '%' }} aria-hidden="true">
              <strong>{fmt(a.count)}</strong>
              <span>{shortDay(a.date, { weekday: 'short' })}</span>
            </div>
          ) : null}
        </div>
        {/* Keyboard users hear the value the crosshair is on. */}
        <span className="sr-only" aria-live="polite">{a ? fmt(a.count) + ', ' + shortDay(a.date, { weekday: 'long' }) : ''}</span>
        <div className="trend-axis small muted" aria-hidden="true">
          <span>{series.length ? shortDay(series[0].date) : ''}</span>
          <span>{t('an.axisMax', { n: fmt(g.top) })}</span>
          <span>{series.length ? shortDay(series[series.length - 1].date) : ''}</span>
        </div>
        <table className={showTable ? 'trend-table' : 'sr-only'}>
          <caption className={showTable ? 'sr-only' : undefined}>{title}</caption>
          <thead><tr><th scope="col">{t('dash.date')}</th><th scope="col">{t('dash.count')}</th></tr></thead>
          <tbody>{series.map((d) => <tr key={d.date}><td>{shortDay(d.date, { weekday: 'short' })}</td><td>{fmt(d.count)}</td></tr>)}</tbody>
        </table>
      </figure>
    );
  }
}
