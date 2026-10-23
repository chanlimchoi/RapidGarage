import React from 'react';
import { Star, Pencil, Trash2 } from 'lucide-react';
import { errorMessage, fetchConversationRating, saveRating, deleteRating, RATING_COMMENT_MAX } from '../api';
import { Dialog, Field, Spinner } from '../components/ui';
import toast from '../components/toast';
import { Stars, StarInput, STAR_WORDS } from './Stars';
import { t } from '../i18n';
import { ratePrompt } from '../lib/ratePrompt';

// Strip shown in a conversation: invites a rating once both sides have
// written, shows mine (editable) and theirs. `refreshKey` changes when the
// thread changes in a way that may affect eligibility (new messages, block).
export default class RatePanel extends React.Component {
  constructor(props) {
    super(props);
    this.state = { data: null, open: false, stars: 0, comment: '', saving: false, error: '' };
  }

  componentDidMount() { this.load(); }
  componentDidUpdate(prev) {
    if (prev.conversationId !== this.props.conversationId || prev.refreshKey !== this.props.refreshKey) this.load();
  }

  load() {
    const id = this.props.conversationId;
    return fetchConversationRating(id).then(({ ok, data }) => {
      if (ok && id === this.props.conversationId) this.setState({ data });
    }).catch(() => null);
  }

  openEditor() {
    const mine = this.state.data.mine;
    this.setState({ open: true, error: '', stars: mine ? mine.stars : 0, comment: mine && mine.comment ? mine.comment : '' });
  }

  save(e) {
    e.preventDefault();
    const { stars, comment } = this.state;
    if (!stars) { this.setState({ error: t('rate.choose') }); return; }
    const locked = this.state.data.mine && this.state.data.mine.commentLocked;
    this.setState({ saving: true, error: '' });
    saveRating(this.props.conversationId, stars, locked ? null : comment.trim() || null).then(({ ok, data }) => {
      if (!ok) { this.setState({ saving: false, error: errorMessage(data, t('rate.saveFailed')) }); return; }
      const first = !this.state.data.mine;
      this.setState({ saving: false, open: false, data });
      toast.success(first ? t('rate.thanks', { name: data.other.name }) : t('rate.updated'));
    }).catch(() => this.setState({ saving: false, error: t('common.networkShort') }));
  }

  remove() {
    if (!window.confirm(t('rate.confirmDelete'))) return;
    this.setState({ saving: true });
    deleteRating(this.props.conversationId).then(({ ok, data }) => {
      this.setState({ saving: false, open: false });
      if (!ok) { toast.error(errorMessage(data, t('rate.deleteFailed'))); return; }
      this.setState({ data });
      toast.success(t('rate.deleted'));
    }).catch(() => this.setState({ saving: false }));
  }

  renderDialog() {
    const { data, stars, comment, saving, error } = this.state;
    const locked = data.mine && data.mine.commentLocked;
    const left = RATING_COMMENT_MAX - comment.length;
    return (
      <Dialog id="rate" title={t(data.mine ? 'rate.editTitle' : 'rate.title', { name: data.other.name })} onClose={() => this.setState({ open: false })}
        description={t('rate.public')}
        footer={(
          <React.Fragment>
            {data.mine ? <button type="button" className="btn btn-ghost btn-danger-text" disabled={saving} onClick={() => this.remove()}><Trash2 size={16} aria-hidden="true" />{t('common.delete')}</button> : null}
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btn-secondary" onClick={() => this.setState({ open: false })}>{t('common.cancel')}</button>
            <button type="submit" form="rate-form" className="btn btn-primary" disabled={saving}>{saving ? <Spinner /> : null}{data.mine ? t('edit.saveChanges') : t('rate.post')}</button>
          </React.Fragment>
        )}>
        <form id="rate-form" className="stack" onSubmit={(e) => this.save(e)} noValidate>
          <StarInput value={stars} onChange={(v) => this.setState({ stars: v, error: '' })} />
          {locked ? (
            <p className="small muted">{t('rate.commentRemoved')}</p>
          ) : (
            <Field id="rate-comment" label={t('rate.comment')} optional hint={left < 60 ? t('common.charsLeft', { count: left }) : t('rate.commentHint')}>
              <textarea id="rate-comment" className="textarea textarea-short" rows={3} maxLength={RATING_COMMENT_MAX} value={comment} onChange={(e) => this.setState({ comment: e.target.value })}
                placeholder={t('rate.commentPlaceholder')} />
            </Field>
          )}
          {error ? <p className="field-error" role="alert">{error}</p> : null}
        </form>
      </Dialog>
    );
  }

  render() {
    const d = this.state.data;
    const show = ratePrompt(d);
    if (show === 'none') return null;
    // The buyer gets a quiet hint that rating opens after the meetup or sale.
    if (show === 'hint') return <div className="rate-strip rate-strip-quiet small muted"><Star size={14} aria-hidden="true" />{t('rate.afterSale', { name: d.other.name })}</div>;
    const { mine, theirs } = d;
    return (
      <div className="rate-strip" aria-label={t('rep.ratings')}>
        <div className="rate-strip-main">
          {mine ? (
            <span className="rate-mine"><span className="small muted">{t('rate.youRated', { name: d.other.name })}</span>
              <Stars value={mine.stars} /><span className="sr-only">{t('rate.outOf5', { n: mine.stars, word: STAR_WORDS[mine.stars] })}</span>
              {mine.commentRemoved ? <span className="chip chip-warning">{t('rate.removedChip')}</span> : null}
            </span>
          ) : d.canRate ? (
            <span className="small"><strong>{t('rate.how', { name: d.other.name })}</strong> <span className="muted">{t('rate.once')}</span></span>
          ) : null}
          {theirs ? <span className="rate-theirs small muted">{t('rate.theyRated', { name: d.other.name })} <Stars value={theirs.stars} /><span className="sr-only">{t('rate.nOutOf5', { n: theirs.stars })}</span></span> : null}
        </div>
        <div className="rate-strip-actions">
          {d.canRate ? (
            <button type="button" className={'btn btn-sm ' + (mine ? 'btn-ghost' : 'btn-primary')} onClick={() => this.openEditor()}>
              {mine ? <Pencil size={14} aria-hidden="true" /> : <Star size={14} aria-hidden="true" />}{mine ? t('rate.edit') : t('rate.title', { name: d.other.name })}
            </button>
          ) : d.reason === 'blocked' ? <span className="small muted">{t('rate.blocked')}</span> : null}
        </div>
        {this.state.open ? this.renderDialog() : null}
      </div>
    );
  }
}
