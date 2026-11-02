import React, { Component } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ListChecks, Lock, Plus, Pencil, Trash2, RotateCcw, Check, BellRing } from 'lucide-react';
import { fetchChecklist, addChecklistItem, updateChecklistItem, deleteChecklistItem, resetChecklist, setChecklistRemind, errorMessage } from '../api';
import { Alert, EmptyState, Field, SkeletonBlock, Spinner, Dialog } from '../components/ui';
import { DEFAULT_LABEL_KEYS, groupByDue, progress, dueHeading, isOverdue, todayIn } from '../lib/checklist';
import { dayName } from '../lib/weatherText';
import toast from '../components/toast';
import { t } from '../i18n';

const paramId = (props) => (props.match && props.match.params && props.match.params.id) || (props.params && props.params.id);
const LABEL = {
  'checklist.item.flyers': () => t('checklist.item.flyers'), 'checklist.item.pricing': () => t('checklist.item.pricing'),
  'checklist.item.signs': () => t('checklist.item.signs'), 'checklist.item.change': () => t('checklist.item.change'),
  'checklist.item.setup': () => t('checklist.item.setup'),
};
const HEADING = {
  'checklist.due.saleDay': () => t('checklist.due.saleDay'),
  'checklist.due.dayBefore': () => t('checklist.due.dayBefore'),
  'checklist.due.daysBefore': (v) => t('checklist.due.daysBefore', v),
};
const labelOf = (i) => (i.key && DEFAULT_LABEL_KEYS[i.key] ? LABEL[DEFAULT_LABEL_KEYS[i.key]]() : i.label || '');
const DUE_OPTIONS = Array.from({ length: 15 }, (_, n) => n);
const dueOption = (n) => { const h = dueHeading(n); return HEADING[h.key](h.vars); };

// /post/:id/checklist (seller only): to-dos counted back from the sale's
// first day, with reminders in the bell (and push) on each due day.
class Checklist extends Component {
  constructor(props) {
    super(props);
    this.state = { data: null, error: '', label: '', dueDays: '1', addErrors: {}, adding: false, busy: null, editing: null, edit: null, editErrors: {}, confirmReset: false };
  }

  componentDidMount() {
    this.mounted = true;
    fetchChecklist(paramId(this.props)).then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) return this.setState({ error: errorMessage(data, t('checklist.loadFailed')) });
      return this.setState({ data });
    }).catch(() => this.mounted && this.setState({ error: t('common.network') }));
  }
  componentWillUnmount() { this.mounted = false; }

  run(promise, busy, after) {
    this.setState({ busy });
    return promise.then(({ ok, data }) => {
      this.setState({ busy: null });
      if (!ok) { toast.error(errorMessage(data, t('checklist.saveFailed'))); return false; }
      this.setState({ data });
      if (after) after(data);
      return true;
    }).catch(() => { this.setState({ busy: null }); toast.error(t('common.network')); return false; });
  }

  add(e) {
    e.preventDefault();
    const label = this.state.label.trim();
    if (!label) { this.setState({ addErrors: { label: t('checklist.errLabel') } }); return; }
    this.setState({ adding: true, addErrors: {} });
    addChecklistItem(paramId(this.props), { label, dueDays: Number(this.state.dueDays) }).then(({ ok, data }) => {
      this.setState({ adding: false });
      if (!ok) { const d = (data && data.error && data.error.details) || {}; this.setState({ addErrors: d }); if (!Object.keys(d).length) toast.error(errorMessage(data, t('checklist.saveFailed'))); return; }
      this.setState({ data, label: '' });
    }).catch(() => { this.setState({ adding: false }); toast.error(t('common.network')); });
  }

  saveEdit(e, item) {
    e.preventDefault();
    const label = this.state.edit.label.trim();
    if (!label) { this.setState({ editErrors: { label: t('checklist.errLabel') } }); return; }
    const body = { dueDays: Number(this.state.edit.dueDays) };
    if (label !== labelOf(item)) body.label = label;
    this.run(updateChecklistItem(paramId(this.props), item.id, body), item.id, () => this.setState({ editing: null, edit: null, editErrors: {} }));
  }

  render() {
    const s = this.state;
    const id = paramId(this.props);
    const back = <Link to={'/dashboard/sales/' + id} className="back-link"><ArrowLeft size={16} aria-hidden="true" />{t('dash.saleStats')}</Link>;
    if (this.props.ready && !this.props.user) {
      return <div className="container container-narrow"><EmptyState level={1} icon={Lock} title={t('dash.loginTitle')} action={<Link className="btn btn-primary" to="/login">{t('nav.logIn')}</Link>}>{t('dash.loginText')}</EmptyState></div>;
    }
    if (s.error) return <div className="container container-narrow">{back}<Alert tone="danger">{s.error}</Alert></div>;
    if (!s.data) return <div className="container container-narrow"><SkeletonBlock lines={6} /></div>;
    const d = s.data;
    const pr = progress(d.items);
    const today = todayIn(d.timeZone);
    return (
      <div className="container container-narrow checklist-page">
        {back}
        <header className="page-header">
          <div>
            <h1><ListChecks size={22} aria-hidden="true" /> {t('checklist.title')}</h1>
            <p>{d.saleDate ? t('checklist.forSale', { day: dayName(d.saleDate) }) : t('checklist.noDate')}</p>
          </div>
        </header>
        <div className="card-form">
          <p className="small" id="cl-progress">{t('checklist.progress', { done: pr.done, total: pr.total })}</p>
          <progress className="checklist-progress" max={100} value={pr.percent} aria-labelledby="cl-progress" />
          <label className="checkbox-row">
            <input type="checkbox" checked={d.remind} disabled={s.busy === 'remind'} onChange={(e) => this.run(setChecklistRemind(id, e.target.checked), 'remind')} />
            <BellRing size={14} aria-hidden="true" /> {t('checklist.remind', { hour: new Date(2000, 0, 1, d.reminderHour).toLocaleTimeString(undefined, { hour: 'numeric' }) })}
          </label>
        </div>
        {groupByDue(d.items).map((g) => {
          const h = dueHeading(g.dueDays);
          return (
            <section key={g.dueDays} className="checklist-group" aria-labelledby={'cl-g-' + g.dueDays}>
              <h2 id={'cl-g-' + g.dueDays} className="h5">{HEADING[h.key](h.vars)}{g.dueDate ? <span className="muted small"> · {dayName(g.dueDate)}</span> : null}</h2>
              <ul className="checklist-list">
                {g.items.map((i) => (s.editing === i.id ? (
                  <li key={i.id}>
                    <form className="item-form" onSubmit={(e) => this.saveEdit(e, i)} noValidate>
                      <div className="item-form-row">
                        <Field id={'cl-e-' + i.id} label={t('checklist.what')} error={s.editErrors.label}>
                          <input id={'cl-e-' + i.id} className="input" maxLength={d.limits.labelMax} value={s.edit.label} onChange={(e) => this.setState({ edit: Object.assign({}, s.edit, { label: e.target.value }) })} />
                        </Field>
                        <Field id={'cl-ed-' + i.id} label={t('checklist.when')}>
                          <select id={'cl-ed-' + i.id} className="input" value={s.edit.dueDays} onChange={(e) => this.setState({ edit: Object.assign({}, s.edit, { dueDays: e.target.value }) })}>
                            {DUE_OPTIONS.map((n) => <option key={n} value={String(n)}>{dueOption(n)}</option>)}
                          </select>
                        </Field>
                      </div>
                      <div className="form-actions">
                        <button type="submit" className="btn btn-primary btn-sm" disabled={s.busy === i.id}>{s.busy === i.id ? <Spinner /> : <Check size={14} aria-hidden="true" />}{t('common.save')}</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => this.setState({ editing: null, edit: null })}>{t('common.cancel')}</button>
                      </div>
                    </form>
                  </li>
                ) : (
                  <li key={i.id} className={'checklist-row' + (i.done ? ' is-done' : '') + (isOverdue(i, today) ? ' is-overdue' : '')}>
                    <label className="checkbox-row">
                      <input type="checkbox" checked={i.done} disabled={s.busy === i.id} onChange={(e) => this.run(updateChecklistItem(id, i.id, { done: e.target.checked }), i.id)} />
                      <span>{labelOf(i)}</span>
                      {isOverdue(i, today) ? <span className="chip chip-warning">{t('checklist.overdue')}</span> : null}
                    </label>
                    <span className="item-actions">
                      <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={t('common.editNamed', { name: labelOf(i) })} onClick={() => this.setState({ editing: i.id, edit: { label: labelOf(i), dueDays: String(i.dueDays) }, editErrors: {} })}><Pencil size={14} aria-hidden="true" /></button>
                      <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={t('common.deleteNamed', { name: labelOf(i) })} disabled={s.busy === i.id} onClick={() => this.run(deleteChecklistItem(id, i.id), i.id)}><Trash2 size={14} aria-hidden="true" /></button>
                    </span>
                  </li>
                )))}
              </ul>
            </section>
          );
        })}
        <form className="card-form" onSubmit={(e) => this.add(e)} noValidate aria-labelledby="cl-add">
          <h2 id="cl-add" className="h5">{t('checklist.add')}</h2>
          <div className="item-form-row">
            <Field id="cl-label" label={t('checklist.what')} error={s.addErrors.label}>
              <input id="cl-label" className="input" maxLength={d.limits.labelMax} placeholder={t('checklist.placeholder')} value={s.label} onChange={(e) => this.setState({ label: e.target.value })} />
            </Field>
            <Field id="cl-due" label={t('checklist.when')} error={s.addErrors.dueDays}>
              <select id="cl-due" className="input" value={s.dueDays} onChange={(e) => this.setState({ dueDays: e.target.value })}>
                {DUE_OPTIONS.map((n) => <option key={n} value={String(n)}>{dueOption(n)}</option>)}
              </select>
            </Field>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary btn-sm" disabled={s.adding || d.items.length >= d.limits.maxItems}>{s.adding ? <Spinner /> : <Plus size={14} aria-hidden="true" />}{t('checklist.addButton')}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => this.setState({ confirmReset: true })}><RotateCcw size={14} aria-hidden="true" />{t('checklist.reset')}</button>
          </div>
        </form>
        {s.confirmReset ? (
          <Dialog id="reset-checklist" title={t('checklist.resetTitle')} onClose={() => this.setState({ confirmReset: false })}
            description={t('checklist.resetText')}
            footer={(
              <React.Fragment>
                <button type="button" className="btn btn-ghost" onClick={() => this.setState({ confirmReset: false })}>{t('common.cancel')}</button>
                <button type="button" className="btn btn-danger" disabled={s.busy === 'reset'} onClick={() => this.run(resetChecklist(id), 'reset', () => this.setState({ confirmReset: false }))}>{t('checklist.reset')}</button>
              </React.Fragment>
            )} />
        ) : null}
      </div>
    );
  }
}

export default Checklist;
