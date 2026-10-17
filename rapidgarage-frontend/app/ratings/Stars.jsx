import React from 'react';
import { Link } from 'react-router-dom';
import { Star } from 'lucide-react';
import { t } from '../i18n';

// Indexed by star count (1-5); getters so the words follow the current language.
export const STAR_WORDS = {
  0: '',
  get 1() { return t('stars.1'); }, get 2() { return t('stars.2'); }, get 3() { return t('stars.3'); },
  get 4() { return t('stars.4'); }, get 5() { return t('stars.5'); },
};

// Read-only stars; supports halves for averages (4.5 -> 4 full + 1 half).
export function Stars({ value, size }) {
  const v = Math.max(0, Math.min(5, Number(value) || 0));
  const px = size || 14;
  return (
    <span className="stars" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = v >= i ? 1 : v >= i - 0.75 && v > i - 1 ? 0.5 : 0;
        return (
          <span key={i} className="star" style={{ width: px, height: px }}>
            <Star size={px} className="star-empty" />
            {fill ? <span className="star-fill" style={{ width: (fill * 100) + '%' }}><Star size={px} /></span> : null}
          </span>
        );
      })}
    </span>
  );
}

export function ratingText(summary) {
  if (!summary || !summary.count) return t('stars.none');
  return t('stars.summary', { avg: summary.average.toFixed(1), count: summary.count });
}

// "★ 4.5 (2)" link to the person's ratings page.
export function RatingBadge({ summary, personId, compact }) {
  const has = summary && summary.count;
  const label = has ? t('stars.label', { avg: summary.average.toFixed(1), count: summary.count }) : t('stars.none');
  const body = has ? (
    <React.Fragment><Star size={13} className="rating-badge-star" aria-hidden="true" />{summary.average.toFixed(1)}<span className="rating-badge-count">({summary.count})</span></React.Fragment>
  ) : (compact ? null : <span className="rating-badge-none">{t('stars.none')}</span>);
  if (!body) return null;
  return personId
    ? <Link className="rating-badge" to={'/people/' + personId} aria-label={t('stars.see', { label })}>{body}</Link>
    : <span className="rating-badge" aria-label={label}>{body}</span>;
}

// Radio-group star picker (arrow keys work; each star is a labelled radio).
export class StarInput extends React.Component {
  constructor(props) { super(props); this.state = { hover: 0 }; }
  render() {
    const { value, onChange, name, disabled } = this.props;
    const shown = this.state.hover || value || 0;
    return (
      <div className="star-input" role="radiogroup" aria-label={t('stars.rating')} onMouseLeave={() => this.setState({ hover: 0 })}>
        {[1, 2, 3, 4, 5].map((i) => (
          <label key={i} className={'star-input-item' + (i <= shown ? ' on' : '')} onMouseEnter={() => this.setState({ hover: i })}>
            <input type="radio" className="sr-only" name={name || 'stars'} value={i} checked={value === i} disabled={disabled} onChange={() => onChange(i)} />
            <Star size={30} aria-hidden="true" />
            <span className="sr-only">{t('stars.nStars', { count: i, word: STAR_WORDS[i] })}</span>
          </label>
        ))}
        <span className="star-input-word" aria-hidden="true">{STAR_WORDS[shown] || t('stars.tap')}</span>
      </div>
    );
  }
}
