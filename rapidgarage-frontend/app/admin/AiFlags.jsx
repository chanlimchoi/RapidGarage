import React from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, Check, EyeOff, Trash2, ExternalLink, ImageOff } from 'lucide-react';
import { apiFetch, errorMessage, moderatePost } from '../api';
import { Alert, EmptyState, SkeletonBlock, Spinner } from '../components/ui';
import { timeAgo } from '../lib/format';
import toast from '../components/toast';
import { t } from '../i18n';

// Literal keys so the i18n check can see every one.
const CATEGORY = {
  weapons: () => t('aiflag.cat.weapons'),
  drugs: () => t('aiflag.cat.drugs'),
  alcohol_tobacco: () => t('aiflag.cat.alcohol_tobacco'),
  counterfeit: () => t('aiflag.cat.counterfeit'),
  stolen: () => t('aiflag.cat.stolen'),
  recalled: () => t('aiflag.cat.recalled'),
  animals: () => t('aiflag.cat.animals'),
  hazardous: () => t('aiflag.cat.hazardous'),
  adult: () => t('aiflag.cat.adult'),
  scam: () => t('aiflag.cat.scam'),
  offensive: () => t('aiflag.cat.offensive'),
  spam: () => t('aiflag.cat.spam'),
  personal_info: () => t('aiflag.cat.personal_info'),
  other: () => t('aiflag.cat.other'),
};
const categoryLabel = (c) => (CATEGORY[c] ? CATEGORY[c]() : c);

// Admin > Reports > AI flags: sales the automated review suggested a person
// look at (backend lib/aiReview.js). Advisory only: nothing was hidden.
export default class AiFlags extends React.Component {
  constructor(props) {
    super(props);
    this.state = { loading: true, error: '', results: [], busy: null };
  }

  componentDidMount() { this.mounted = true; this.load(); }
  componentWillUnmount() { this.mounted = false; }

  load() {
    apiFetch('/admin/ai-flags').then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) return this.setState({ loading: false, error: errorMessage(data, t('aiflag.loadFailed')) });
      this.setState({ loading: false, results: data.results });
      if (this.props.onCount) this.props.onCount(data.results.length);
    }).catch(() => this.mounted && this.setState({ loading: false, error: t('common.networkShort') }));
  }

  act(post, action) {
    if (action === 'delete' && !window.confirm(t('aiflag.confirmDelete', { title: post.title }))) return;
    this.setState({ busy: post.id + action });
    moderatePost(post.id, action).then(({ ok, data }) => {
      if (!this.mounted) return;
      this.setState({ busy: null });
      if (!ok) return toast.error(errorMessage(data, t('aiflag.actFailed')));
      const results = this.state.results.filter((r) => r.id !== post.id);
      this.setState({ results });
      if (this.props.onCount) this.props.onCount(results.length);
      return toast.success(action === 'dismiss' ? t('aiflag.dismissed') : action === 'hide' ? t('aiflag.hidden') : t('aiflag.deleted'));
    }).catch(() => { if (this.mounted) { this.setState({ busy: null }); toast.error(t('common.networkShort')); } });
  }

  render() {
    const s = this.state;
    if (s.loading) return <SkeletonBlock lines={3} height={80} />;
    return (
      <div className="stack">
        <p className="small muted"><Sparkles size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 4 }} />{t('aiflag.lead')}</p>
        {s.error ? <Alert tone="danger">{s.error}</Alert> : null}
        {!s.results.length ? <EmptyState icon={Check} title={t('aiflag.none')} /> : (
          <ul className="report-list">
            {s.results.map((p) => (
              <li key={p.id} className="panel report-group">
                <div className="report-head">
                  {p.thumbUrl ? <img src={p.thumbUrl} alt="" className="report-thumb" /> : <span className="report-thumb report-thumb-empty" aria-hidden="true"><ImageOff size={16} /></span>}
                  <div>
                    <Link to={'/post/' + p.id}><strong>{p.title}</strong> <ExternalLink size={12} aria-hidden="true" /></Link>
                    <div className="small muted">{p.seller} · {t('aiflag.flagged', { when: timeAgo(p.flaggedAt) })}</div>
                  </div>
                </div>
                <div className="chips">{p.categories.map((c) => <span key={c} className="chip chip-warning">{categoryLabel(c)}</span>)}</div>
                {p.reason ? <p className="small">{p.reason}</p> : null}
                <div className="form-actions">
                  <button type="button" className="btn btn-secondary btn-sm" disabled={!!s.busy} onClick={() => this.act(p, 'dismiss')}>{s.busy === p.id + 'dismiss' ? <Spinner /> : <Check size={14} aria-hidden="true" />}{t('aiflag.dismiss')}</button>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={!!s.busy} onClick={() => this.act(p, 'hide')}>{s.busy === p.id + 'hide' ? <Spinner /> : <EyeOff size={14} aria-hidden="true" />}{t('aiflag.hide')}</button>
                  <button type="button" className="btn btn-danger btn-sm" disabled={!!s.busy} onClick={() => this.act(p, 'delete')}>{s.busy === p.id + 'delete' ? <Spinner /> : <Trash2 size={14} aria-hidden="true" />}{t('aiflag.delete')}</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
}
