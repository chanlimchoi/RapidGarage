import React from 'react';
import { Link } from 'react-router-dom';
import { Gift, Clock, Pencil, CircleStop, Check, Undo2, ShieldCheck, LogIn, History } from 'lucide-react';
import { startCurbside, stopCurbside } from '../api';
import { liveOffer, pickupChoices, pickChoice, validateCurb, curbBody, offerable, markList, freeItems, NOTE_MAX } from '../lib/curbside';
import { holdTime } from '../messages/holdText';
import { Alert, Field, Spinner } from '../components/ui';
import { t } from '../i18n';

const CHOICE_KEYS = { endOfDay: 'curb.choice.endOfDay', hours: 'curb.choice.hours', tomorrowNoon: 'curb.choice.tomorrowNoon', max: 'curb.choice.max' };
const GONE_KEYS = { neighbor: 'curb.gone.neighbor', seller: 'curb.gone.seller', items: 'curb.gone.items' };
const ERROR_KEYS = { 'curb.err.items': 'curb.err.items', 'curb.err.until': 'curb.err.until', 'curb.err.note': 'curb.err.note' };

// "Free on the curb" on the sale page. The seller starts, edits and stops the
// offer and sees who marked things taken; neighbors see the offer and, for a
// whole-sale offer, can say it's all gone (per-item "Taken" is in ItemList).
// props: post, user, act(promise, okMessage) -> Promise<bool> (merges the answer)
export default class CurbsidePanel extends React.Component {
  constructor(props) {
    super(props);
    this.state = { editing: false, busy: '', all: true, itemIds: [], until: '', note: '', errors: {} };
  }

  openForm() {
    const { post } = this.props;
    const cs = post.curbside || {};
    const editing = cs.state === 'active' || cs.state === 'paused';
    const choices = pickupChoices(cs);
    const items = offerable(post.items);
    const current = editing && !cs.all ? (post.items || []).filter((i) => i.curbside).map((i) => i.id) : [];
    this.setState({
      editing: true, errors: {}, choices,
      all: editing ? !!cs.all : true,
      itemIds: current.length ? current : [],
      until: pickChoice(choices, editing ? cs.until : null),
      note: editing ? cs.note || '' : '',
    });
  }

  submit(e) {
    e.preventDefault();
    const errors = validateCurb(this.state);
    if (Object.keys(errors).length) { this.setState({ errors }); return; }
    const cs = this.props.post.curbside || {};
    const live = cs.state === 'active' || cs.state === 'paused';
    this.setState({ busy: 'save', errors: {} });
    this.props.act(startCurbside(this.props.post.id, curbBody(this.state)), live ? t('curb.saved') : t('curb.started'))
      .then((ok) => this.setState({ busy: '', editing: !ok }));
  }

  stop() {
    this.setState({ busy: 'stop' });
    this.props.act(stopCurbside(this.props.post.id), t('curb.stopped')).then(() => this.setState({ busy: '', editing: false }));
  }

  toggleItem(id, on) {
    const ids = this.state.itemIds.filter((x) => x !== id);
    this.setState({ itemIds: on ? ids.concat([id]) : ids, errors: {} });
  }

  renderForm() {
    const { post } = this.props;
    const s = this.state;
    const items = offerable(post.items);
    const cs = post.curbside || {};
    const live = cs.state === 'active' || cs.state === 'paused';
    const err = (k) => (s.errors[k] ? t(ERROR_KEYS[s.errors[k]], { max: NOTE_MAX }) : undefined);
    const left = NOTE_MAX - s.note.length;
    return (
      <form className="curb-form stack" onSubmit={(e) => this.submit(e)} noValidate>
        <fieldset className="field">
          <legend className="field-label">{t('curb.whatLabel')}</legend>
          <label className="radio-row">
            <input type="radio" name="curb-what" checked={s.all} onChange={() => this.setState({ all: true, errors: {} })} />
            <span>{t('curb.whole')} <span className="small muted">{t('curb.wholeHint')}</span></span>
          </label>
          <label className="radio-row">
            <input type="radio" name="curb-what" checked={!s.all} disabled={!items.length} onChange={() => this.setState({ all: false, errors: {} })} />
            <span>{t('curb.choose')} <span className="small muted">{items.length ? t('curb.chooseHint') : t('curb.noItems')}</span></span>
          </label>
          {!s.all ? (
            <ul className="curb-item-picks" aria-label={t('curb.choose')}>
              {items.map((i) => (
                <li key={i.id}><label className="checkbox-row">
                  <input type="checkbox" checked={s.itemIds.indexOf(i.id) >= 0} onChange={(e) => this.toggleItem(i.id, e.target.checked)} />
                  <span>{i.name}</span>
                </label></li>
              ))}
            </ul>
          ) : null}
          {err('items') ? <span className="field-error" role="alert">{err('items')}</span> : null}
        </fieldset>
        <Field id="curb-until" label={t('curb.untilLabel')} error={err('until')} hint={t('curb.untilHint')}>
          <select className="select" value={s.until} onChange={(e) => this.setState({ until: e.target.value })}>
            {(s.choices || []).map((c) => <option key={c.value} value={c.value}>{t(CHOICE_KEYS[c.kind], { time: holdTime(c.value), hours: c.hours })}</option>)}
          </select>
        </Field>
        <Field id="curb-note" label={t('curb.noteLabel')} optional error={err('note')} hint={left >= 0 ? t('common.charsLeft', { count: left }) : t('common.tooLongBy', { n: -left })}>
          <textarea className="textarea" rows={2} maxLength={NOTE_MAX} value={s.note} placeholder={t('curb.notePlaceholder')}
            onChange={(e) => this.setState({ note: e.target.value })} />
        </Field>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary curb-submit" disabled={!!s.busy}>{s.busy === 'save' ? <Spinner /> : <Gift size={16} aria-hidden="true" />}{live ? t('curb.save') : t('curb.start')}</button>
          <button type="button" className="btn btn-ghost" disabled={!!s.busy} onClick={() => this.setState({ editing: false })}>{t('common.cancel')}</button>
        </div>
      </form>
    );
  }

  renderMarks() {
    const { post } = this.props;
    const marks = markList(post.curbside, post.items);
    if (!marks.length) return null;
    return (
      <div className="curb-marks">
        <h3 className="h5"><History size={14} aria-hidden="true" />{t('curb.marksTitle')}</h3>
        <ul>
          {marks.map((m) => (
            <li key={m.id} className={'small' + (m.undone ? ' muted curb-mark-undone' : '')}>
              {m.item === null ? t('curb.markLineAll', { name: m.who }) : t('curb.markLine', { name: m.who, item: m.item || t('hold.anItem') })}
              {' · '}<time dateTime={m.at}>{holdTime(m.at)}</time>
              {m.undone ? ' · ' + t('curb.markUndone') : null}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  renderOwner() {
    const { post } = this.props;
    const cs = post.curbside;
    if (!cs || post.hidden) return null;
    const s = this.state;
    const live = cs.state === 'active' || cs.state === 'paused';
    if (s.editing) {
      return (
        <section className="panel curb-panel curb-owner" aria-labelledby="curb-title">
          <h2 id="curb-title" className="h4"><Gift size={18} aria-hidden="true" />{t('curb.ownerTitle')}</h2>
          {this.renderForm()}
        </section>
      );
    }
    if (!live) {
      return (
        <section className="panel curb-panel curb-owner" aria-labelledby="curb-title">
          <h2 id="curb-title" className="h4"><Gift size={18} aria-hidden="true" />{t('curb.ownerTitle')}</h2>
          {cs.state === 'expired' ? <p className="small">{t('curb.expired', { time: holdTime(cs.until) })}</p> : null}
          {cs.state === 'gone' ? <p className="small">{t(GONE_KEYS[cs.goneSource] || 'curb.gone.items')}</p> : null}
          {cs.state === 'gone' && cs.all ? (
            <button type="button" className="btn btn-ghost btn-sm curb-undo-all" disabled={!!s.busy} onClick={() => this.props.undo(null)}><Undo2 size={14} aria-hidden="true" />{t('curb.undoGone')}</button>
          ) : null}
          {cs.canStart ? (
            <React.Fragment>
              {cs.state === 'off' ? <p className="small muted">{t('curb.ownerLead')}</p> : null}
              <button type="button" className="btn btn-secondary curb-start" onClick={() => this.openForm()}><Gift size={16} aria-hidden="true" />{cs.state === 'off' ? t('curb.start') : t('curb.startAgain')}</button>
            </React.Fragment>
          ) : <p className="small muted">{t('curb.tooEarly', { hours: 12 })}</p>}
          {this.renderMarks()}
        </section>
      );
    }
    const left = cs.all ? null : cs.itemsLeft;
    return (
      <section className={'panel curb-panel curb-owner' + (cs.state === 'active' ? ' curb-live' : ' curb-paused')} aria-labelledby="curb-title">
        <h2 id="curb-title" className="h4"><Gift size={18} aria-hidden="true" />{t('curb.ownerTitle')}</h2>
        {cs.state === 'paused' ? <Alert tone="warning">{cs.pausedReason === 'hidden' ? t('curb.pausedHidden') : t('curb.paused')}</Alert> : null}
        <p className="curb-until"><Clock size={14} aria-hidden="true" />{t('curb.pickupUntil', { time: holdTime(cs.until) })}</p>
        <p className="small">{cs.all ? t('curb.everything') : t('curb.itemsLeft', { count: left })}</p>
        {cs.note ? <p className="small curb-note">“{cs.note}”</p> : null}
        <div className="form-actions">
          <button type="button" className="btn btn-secondary btn-sm curb-edit" disabled={!!s.busy} onClick={() => this.openForm()}><Pencil size={14} aria-hidden="true" />{t('curb.edit')}</button>
          {cs.all ? <button type="button" className="btn btn-secondary btn-sm curb-all-gone" disabled={!!s.busy} onClick={() => this.props.taken(null)}><Check size={14} aria-hidden="true" />{t('curb.markAllGone')}</button> : null}
          <button type="button" className="btn btn-ghost btn-sm curb-stop" disabled={!!s.busy} onClick={() => this.stop()}>{s.busy === 'stop' ? <Spinner /> : <CircleStop size={14} aria-hidden="true" />}{t('curb.stop')}</button>
        </div>
        {this.renderMarks()}
      </section>
    );
  }

  renderPublic() {
    const { post, user } = this.props;
    const cs = liveOffer(post);
    if (!cs) return null;
    const left = cs.all ? null : freeItems(post).length;
    return (
      <section className="panel curb-panel curb-public" aria-labelledby="curb-title">
        <h2 id="curb-title" className="h4"><Gift size={18} aria-hidden="true" />{t('curb.kicker')}</h2>
        <p className="curb-until"><Clock size={14} aria-hidden="true" />{t('curb.pickupUntil', { time: holdTime(cs.until) })}</p>
        <p className="small">{cs.all ? t('curb.everything') : t('curb.itemsLeft', { count: left })}</p>
        {cs.note ? <p className="small curb-note">“{cs.note}”</p> : null}
        <p className="small muted curb-safety"><ShieldCheck size={14} aria-hidden="true" />{t('curb.safety')}</p>
        {cs.all ? (
          user ? (
            <div className="stack-sm">
              <span className="small muted">{t('curb.takenAllHint')}</span>
              <button type="button" className="btn btn-secondary btn-sm curb-taken-all" onClick={() => this.props.taken(null)}><Check size={14} aria-hidden="true" />{t('curb.takenAll')}</button>
            </div>
          ) : <Link className="btn btn-ghost btn-sm curb-login" to="/login"><LogIn size={14} aria-hidden="true" />{t('curb.loginToMark')}</Link>
        ) : (!user ? <Link className="btn btn-ghost btn-sm curb-login" to="/login"><LogIn size={14} aria-hidden="true" />{t('curb.loginToMark')}</Link> : null)}
      </section>
    );
  }

  render() {
    const { post, user } = this.props;
    const mine = !!(user && post && user.id === post.userId);
    return mine ? this.renderOwner() : this.renderPublic();
  }
}
