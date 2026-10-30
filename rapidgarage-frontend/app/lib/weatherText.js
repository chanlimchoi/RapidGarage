// Rain checks: wording for forecasts and the postpone prompt (backend lib/weather.js).
import { t, intlLocale } from '../i18n/index.js';

// "2026-11-01" -> "Sun, Nov 1" (a calendar date; no time zone shift).
export function dayName(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  try { return new Intl.DateTimeFormat(intlLocale(), { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d); } catch (e) { return date; }
}

const REASON = { storm: 'wx.reason.storm', snow: 'wx.reason.snow', rain: 'wx.reason.rain', wind: 'wx.reason.wind' };
export const reasonText = (r) => t(REASON[r] || 'wx.reason.rain');

// One forecast chip: "Sun, Nov 1: Storms likely (90%)" or "Sat, Oct 31: Looks dry".
export function dayLine(d) {
  const day = dayName(d.date);
  if (d.bad) return d.pop !== null && d.pop !== undefined ? t('wx.badPop', { day, what: reasonText(d.reason), pop: d.pop }) : t('wx.bad', { day, what: reasonText(d.reason) });
  return d.pop !== null && d.pop !== undefined && d.pop >= 30 ? t('wx.maybe', { day, pop: d.pop }) : t('wx.fine', { day });
}

// The seller's prompt: "Storms likely on Sun, Nov 1 (90%). Postpone the sale?"
export function rainPrompt(rc) {
  if (!rc) return '';
  return t('wx.prompt', { what: reasonText(rc.reason), day: dayName(rc.date), pop: rc.pop === null || rc.pop === undefined ? '–' : rc.pop });
}

// Postponed banner for 14 days after the change.
export function postponedNote(post, now) {
  if (!post || !post.postponedAt || !post.postponedFrom) return '';
  if ((now || new Date()).getTime() - new Date(post.postponedAt).getTime() > 14 * 86400000) return '';
  return t('wx.postponedFrom', { day: dayName(post.postponedFrom) });
}
