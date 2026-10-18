// Words for last-hour markdowns (logic in lib/markdown.js).
import { t } from '../i18n';
import { timeLabel } from './schedule';
import { chipKind, markdownErrorKeys } from './markdown';

// "50% off now" / "50% off from 2 PM" / null.
export function chipLabel(post, now) {
  const kind = chipKind(post, now);
  if (kind === 'now') return t('md.chipNow', { percent: post.markdown.percent });
  if (kind === 'soon') return t('md.chipFrom', { percent: post.markdown.percent, time: timeLabel(post.markdown.from) });
  return null;
}

// "Everything is 50% off from 2 PM each sale day." (or "on the last day").
export function describe(m) {
  if (!m) return '';
  const vars = { percent: m.percent, time: timeLabel(m.from) };
  return m.lastDayOnly ? t('md.describeLastDay', vars) : t('md.describeDaily', vars);
}

export function markdownErrors(v) {
  const keys = markdownErrorKeys(v);
  const out = {};
  Object.keys(keys).forEach((k) => { out[k] = t(keys[k]); });
  return out;
}
