import React from 'react';
import { Eye, ScanLine, Bookmark, MessageCircle } from 'lucide-react';
import BarChart from './BarChart';
import { sum, weekChange } from '../lib/dashboard';
import { t } from '../i18n';

export const METRIC_ICON = { views: Eye, scans: ScanLine, saves: Bookmark, messages: MessageCircle };
// Literal keys (the i18n test checks every key exists).
export const METRIC_LABEL = { get views() { return t('dash.m.views'); }, get scans() { return t('dash.m.scans'); }, get saves() { return t('dash.m.saves'); }, get messages() { return t('dash.m.messages'); } };
export const METRIC_TOTAL = {
  views: (n) => t('dash.total.views', { count: n }), scans: (n) => t('dash.total.scans', { count: n }),
  saves: (n) => t('dash.total.saves', { count: n }), messages: (n) => t('dash.total.messages', { count: n }),
};
export const STATUS_LABEL = {
  get upcoming() { return t('dash.status.upcoming'); }, get open() { return t('dash.status.open'); }, get ended() { return t('dash.status.ended'); },
  get hidden() { return t('dash.status.hidden'); }, get nodates() { return t('dash.status.nodates'); },
};
export const STATUS_CLASS = { upcoming: 'chip-info', open: 'chip-success', ended: '', hidden: 'chip-warning', nodates: '' };

// One metric: total (all time; saves = current), last 14 days, today, sparkline, week-over-week.
export function MetricCard({ metric, total, today, series }) {
  const Icon = METRIC_ICON[metric];
  const wk = weekChange(series);
  return (
    <section className={'panel metric-card metric-' + metric} aria-labelledby={'metric-' + metric}>
      <div className="metric-head"><Icon size={18} aria-hidden="true" /><h3 id={'metric-' + metric} className="metric-label">{METRIC_LABEL[metric]}</h3></div>
      <div className="metric-total">{total}</div>
      <div className="metric-sub small muted">
        <span>{t('dash.last14', { n: sum(series) })}</span>
        <span>{t('dash.todayN', { n: today })}</span>
      </div>
      <BarChart series={series} label={METRIC_LABEL[metric]} compact />
      {wk.delta !== null ? <div className={'metric-delta small ' + (wk.delta >= 0 ? 'up' : 'down')}>{wk.delta >= 0 ? t('dash.up', { n: wk.delta }) : t('dash.down', { n: -wk.delta })}</div>
        : <div className="metric-delta small muted">{t('dash.noBase')}</div>}
    </section>
  );
}

export function ItemsBar({ items }) {
  if (!items || !items.total) return <span className="small muted">{t('dash.noItems')}</span>;
  const pct = Math.round((items.sold / items.total) * 100);
  return (
    <div className="items-progress">
      <div className="items-progress-label small"><span>{t('dash.itemsSold', { sold: items.sold, total: items.total })}</span>{items.reserved ? <span className="muted">{t('dash.reserved', { n: items.reserved })}</span> : null}</div>
      <div className="items-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={items.total} aria-valuenow={items.sold} aria-label={t('dash.itemsSold', { sold: items.sold, total: items.total })}>
        <span style={{ width: pct + '%' }} />
      </div>
    </div>
  );
}
