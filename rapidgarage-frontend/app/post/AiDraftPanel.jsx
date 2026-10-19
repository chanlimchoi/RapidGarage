import React from 'react';
import { Sparkles, Plus, RotateCcw } from 'lucide-react';
import { suggestItems, addItemsBulk, fetchAiKey, errorMessage } from '../api';
import AiKeyChoice, { keySource } from './AiKeyChoice';
import { Alert, Spinner } from '../components/ui';
import { centsInput, validateItemFields, ITEM_NAME_MAX } from '../lib/items';
import toast from '../components/toast';
import { t } from '../i18n';

// Items editor: "Draft items from photos". Claude suggests names and prices
// from the sale's photos; the seller edits, unticks what they don't want and
// adds the rest in one go. Nothing is saved until they press Add.
// props: post, photos, room (items left before the limit), onAdded(items),
//        config ({ aiSiteKey, userAiKeys, userAiKeySave })
// Key: a one-time key typed here (sent once, then cleared from the page and
// never stored), else the seller's saved key, else the site's.
export default class AiDraftPanel extends React.Component {
  constructor(props) {
    super(props);
    this.state = { busy: false, adding: false, error: '', drafts: null, saved: null, useOnce: false, oneTimeKey: '' };
  }

  componentDidMount() {
    this.mounted = true;
    if (this.props.config && this.props.config.userAiKeys) {
      fetchAiKey().then(({ ok, data }) => { if (this.mounted && ok) this.setState({ saved: data }); }).catch(() => null);
    }
  }
  componentWillUnmount() { this.mounted = false; }

  source() { return keySource(this.props.config, this.state.saved, this.state.useOnce); }

  draft() {
    const once = this.source() === 'one_time';
    const key = once ? this.state.oneTimeKey.trim() : null;
    if (once && !key) return this.setState({ error: t('aikey.pasteKey') });
    // The one-time key leaves the page's state the moment it is sent.
    this.setState({ busy: true, error: '', oneTimeKey: '' });
    suggestItems(this.props.post.id, null, key).then(({ ok, data }) => {
      if (!ok) return this.setState({ busy: false, error: errorMessage(data, t('ai.failed')) });
      const drafts = data.suggestions.map((s, i) => ({ key: i, keep: i < data.room, name: s.name, price: s.priceCents === null ? '' : centsInput(s.priceCents), photoId: s.photoId, errors: {} }));
      this.setState({ busy: false, drafts });
      if (!drafts.length) this.setState({ error: t('ai.none') });
    }).catch(() => this.setState({ busy: false, error: t('common.network') }));
  }

  set(key, patch) {
    this.setState({ drafts: this.state.drafts.map((d) => (d.key === key ? Object.assign({}, d, patch, { errors: {} }) : d)) });
  }

  add() {
    const kept = this.state.drafts.filter((d) => d.keep);
    if (!kept.length) return;
    let bad = false;
    const checked = this.state.drafts.map((d) => {
      if (!d.keep) return d;
      const errors = validateItemFields(d);
      if (Object.keys(errors).length) bad = true;
      return Object.assign({}, d, { errors });
    });
    if (bad) return this.setState({ drafts: checked });
    if (kept.length > this.props.room) return this.setState({ error: t('ai.tooMany', { count: this.props.room }) });
    this.setState({ adding: true, error: '' });
    const body = kept.map((d) => ({ name: d.name.trim(), price: d.price.trim().replace(/^\$/, '') || null, photoId: d.photoId || null }));
    addItemsBulk(this.props.post.id, body).then(({ ok, data }) => {
      if (!ok) return this.setState({ adding: false, error: errorMessage(data, t('items.addFailed')) });
      toast.success(t('ai.added', { count: data.items.length }));
      this.setState({ adding: false, drafts: null });
      if (this.props.onAdded) this.props.onAdded(data.items);
    }).catch(() => this.setState({ adding: false, error: t('common.network') }));
  }

  render() {
    const { photos, room } = this.props;
    const { busy, adding, error, drafts } = this.state;
    const thumb = (id) => { const p = photos.find((x) => x.id === id); return p ? <img src={p.thumbUrl} alt="" className="ai-draft-thumb" /> : <span className="ai-draft-thumb" aria-hidden="true" />; };
    const keptCount = drafts ? drafts.filter((d) => d.keep).length : 0;
    return (
      <section className="card-form ai-draft" aria-labelledby="ai-draft-title" aria-busy={busy}>
        <h2 id="ai-draft-title" className="h4"><Sparkles size={18} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />{t('ai.title')}</h2>
        <p className="small muted">{t('ai.lead', { count: Math.min(photos.length, 5) })}</p>
        {!drafts ? <AiKeyChoice id="ai-draft" config={this.props.config} saved={this.state.saved} useOnce={this.state.useOnce} oneTimeKey={this.state.oneTimeKey}
          onChange={(patch) => this.setState(Object.assign({ error: '' }, patch))} /> : null}
        {!drafts ? (
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" disabled={busy || !room || !this.source()} onClick={() => this.draft()}>
              {busy ? <Spinner /> : <Sparkles size={16} aria-hidden="true" />}{busy ? t('ai.working') : t('ai.draft')}
            </button>
          </div>
        ) : (
          <React.Fragment>
            <ul className="ai-draft-list">
              {drafts.map((d) => (
                <li key={d.key} className={'ai-draft-row' + (d.keep ? '' : ' is-off')}>
                  <input type="checkbox" checked={d.keep} onChange={(e) => this.set(d.key, { keep: e.target.checked })} aria-label={t('ai.keep', { name: d.name })} />
                  {thumb(d.photoId)}
                  <div className="ai-draft-fields">
                    <input className="input" value={d.name} maxLength={ITEM_NAME_MAX} disabled={!d.keep} aria-label={t('items.item')}
                      aria-invalid={d.errors.name ? 'true' : undefined} onChange={(e) => this.set(d.key, { name: e.target.value })} />
                    <input className="input ai-draft-price" value={d.price} inputMode="decimal" maxLength={9} disabled={!d.keep} placeholder={t('items.pricePlaceholder')}
                      aria-label={t('items.price')} aria-invalid={d.errors.price ? 'true' : undefined} onChange={(e) => this.set(d.key, { price: e.target.value })} />
                    {d.errors.name || d.errors.price ? <span className="field-error">{d.errors.name || d.errors.price}</span> : null}
                  </div>
                </li>
              ))}
            </ul>
            <p className="small muted">{t('ai.review')}</p>
            <div className="form-actions">
              <button type="button" className="btn btn-primary" disabled={adding || !keptCount} onClick={() => this.add()}>
                {adding ? <Spinner /> : <Plus size={16} aria-hidden="true" />}{t('ai.addSelected', { count: keptCount })}
              </button>
              <button type="button" className="btn btn-ghost" disabled={adding} onClick={() => this.setState({ drafts: null, error: '' })}>
                <RotateCcw size={16} aria-hidden="true" />{t('ai.discard')}
              </button>
            </div>
          </React.Fragment>
        )}
        {error ? <Alert tone={drafts && !drafts.length ? 'info' : 'danger'}>{error}</Alert> : null}
        <p className="small muted ai-draft-privacy">{t('ai.privacy')}</p>
      </section>
    );
  }
}
