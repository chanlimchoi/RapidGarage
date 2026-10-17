import React from 'react';
import { Link } from 'react-router-dom';
import { Package, Check, ListPlus, Pencil } from 'lucide-react';
import { apiFetch, errorMessage } from '../api';
import { formatCents, itemSummary } from '../lib/items';
import { Spinner } from '../components/ui';
import toast from '../components/toast';
import { t } from '../i18n';

// A sale's items on the sale page. Sold items are struck through and
// dimmed; the seller can mark them sold right here.
export default class ItemList extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hideSold: false, busy: null };
  }

  toggleSold(item) {
    const { post, onItems } = this.props;
    this.setState({ busy: item.id });
    apiFetch('/post/' + post.id + '/items/' + item.id, { method: 'PUT', body: JSON.stringify({ sold: !item.sold }) })
      .then(({ ok, data }) => {
        this.setState({ busy: null });
        if (!ok) { toast.error(errorMessage(data, t('items.updateFailed'))); return; }
        onItems(post.items.map((i) => (i.id === data.id ? data : i)));
        toast.success(data.sold ? t('items.markedSold', { name: data.name }) : t('items.availableAgain', { name: data.name }));
      })
      .catch(() => { this.setState({ busy: null }); toast.error(t('common.networkProblem')); });
  }

  render() {
    const { post, owner, onPhoto } = this.props;
    const items = post.items || [];
    if (!items.length) {
      return owner ? (
        <section className="items-section items-empty">
          <h2 className="h4"><Package size={18} aria-hidden="true" />{t('edit.items')}</h2>
          <p className="muted small">{t('items.listLead')}</p>
          <Link className="btn btn-secondary btn-sm" to={'/post/' + post.id + '/items'}><ListPlus size={16} aria-hidden="true" />{t('post.addItems')}</Link>
        </section>
      ) : null;
    }
    const photos = post.photos || [];
    const photoIndex = (id) => photos.findIndex((p) => p.id === id);
    const anySold = items.some((i) => i.sold);
    const shown = this.state.hideSold ? items.filter((i) => !i.sold) : items;
    return (
      <section className="items-section" aria-labelledby="items-title">
        <div className="items-head">
          <h2 id="items-title" className="h4"><Package size={18} aria-hidden="true" />{t('edit.items')} <span className="muted small items-count">{itemSummary(items)}</span></h2>
          <div className="row items-tools">
            {anySold ? (
              <label className="checkbox-row small" htmlFor="hide-sold">
                <span className="switch">
                  <input id="hide-sold" type="checkbox" role="switch" checked={this.state.hideSold} onChange={(e) => this.setState({ hideSold: e.target.checked })} />
                  <span className="switch-track" aria-hidden="true" />
                </span>
                <span>{t('items.hideSold')}</span>
              </label>
            ) : null}
            {owner ? <Link className="btn btn-ghost btn-sm" to={'/post/' + post.id + '/items'}><Pencil size={14} aria-hidden="true" />{t('post.editItems')}</Link> : null}
          </div>
        </div>
        <ul className="item-list">
          {shown.map((item) => {
            const pi = item.photoId ? photoIndex(item.photoId) : -1;
            const price = formatCents(item.priceCents);
            return (
              <li key={item.id} className={'item-row' + (item.sold ? ' is-sold' : '')}>
                {pi >= 0 ? (
                  <button type="button" className="item-thumb" onClick={() => onPhoto && onPhoto(pi)} aria-label={t('items.showPhotoOf', { name: item.name })}>
                    <img src={photos[pi].thumbUrl} alt="" />
                  </button>
                ) : <span className="item-thumb item-thumb-empty" aria-hidden="true"><Package size={16} /></span>}
                <span className="item-name">{item.name}{item.sold ? <span className="sr-only">{t('items.soldSr')}</span> : null}</span>
                {price ? <span className={'item-price' + (item.priceCents === 0 ? ' is-free' : '')}>{price}</span> : null}
                {item.sold ? <span className="chip chip-muted item-sold-chip" aria-hidden="true">{t('items.sold')}</span> : null}
                {owner ? (
                  <button type="button" className={'btn btn-sm item-sold-toggle ' + (item.sold ? 'btn-ghost' : 'btn-secondary')} aria-pressed={item.sold}
                    disabled={this.state.busy === item.id} onClick={() => this.toggleSold(item)}
                    aria-label={item.sold ? t('items.markAvailable', { name: item.name }) : t('items.markSoldNamed', { name: item.name })}>
                    {this.state.busy === item.id ? <Spinner /> : <Check size={14} aria-hidden="true" />}{item.sold ? t('items.undo') : t('items.sold')}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
        {this.state.hideSold && !shown.length ? <p className="muted small">{t('items.allSold')}</p> : null}
      </section>
    );
  }
}
