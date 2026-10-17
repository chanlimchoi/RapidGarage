import React, { Component } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Package, Plus, Pencil, Trash2, ArrowUp, ArrowDown, Check, SearchX, Lock, ImageOff } from 'lucide-react';
import { apiFetch, errorMessage } from '../api';
import { Field, Alert, EmptyState, SkeletonBlock, Spinner, Dialog } from '../components/ui';
import { formatCents, centsInput, validateItemFields, itemSummary, ITEM_NAME_MAX } from '../lib/items';
import toast from '../components/toast';

const MAX_ITEMS = 100;
const blank = () => ({ name: '', price: '', photoId: null });

// Photo picker limited to the sale's existing photos.
function PhotoChoice({ idPrefix, photos, value, onChange }) {
  if (!photos.length) return <p className="small muted">Add photos to the sale to pick one for an item.</p>;
  return (
    <fieldset className="photo-choice">
      <legend>Photo <span className="muted small">(optional)</span></legend>
      <label title="No photo">
        <input type="radio" name={idPrefix + '-photo'} checked={!value} onChange={() => onChange(null)} aria-label="No photo" />
        <ImageOff size={18} aria-hidden="true" />
      </label>
      {photos.map((p, i) => (
        <label key={p.id} title={'Photo ' + (i + 1)}>
          <input type="radio" name={idPrefix + '-photo'} checked={value === p.id} onChange={() => onChange(p.id)} aria-label={'Photo ' + (i + 1)} />
          <img src={p.thumbUrl} alt="" />
        </label>
      ))}
    </fieldset>
  );
}

function ItemFields({ idPrefix, values, errors, photos, onChange }) {
  return (
    <React.Fragment>
      <div className="item-form-row">
        <Field id={idPrefix + '-name'} label="Item" error={errors.name}>
          <input id={idPrefix + '-name'} className="input" value={values.name} maxLength={ITEM_NAME_MAX} placeholder="e.g. Road bike"
            onChange={(e) => onChange({ name: e.target.value })} aria-invalid={errors.name ? 'true' : undefined} />
        </Field>
        <Field id={idPrefix + '-price'} label="Price ($)" optional error={errors.price}>
          <input id={idPrefix + '-price'} className="input" value={values.price} inputMode="decimal" maxLength={9} placeholder="e.g. 5"
            onChange={(e) => onChange({ price: e.target.value })} aria-invalid={errors.price ? 'true' : undefined} />
        </Field>
      </div>
      <PhotoChoice idPrefix={idPrefix} photos={photos} value={values.photoId} onChange={(photoId) => onChange({ photoId })} />
    </React.Fragment>
  );
}

const bodyOf = (v) => ({ name: v.name.trim(), price: v.price.trim().replace(/^\$/, '') || null, photoId: v.photoId || null });

// /post/:id/items: the seller's item list editor (add, edit, reorder, sold, delete).
class ItemsEditor extends Component {
  constructor(props) {
    super(props);
    this.state = { post: null, loadError: '', draft: blank(), draftErrors: {}, adding: false, editing: null, edit: null, editErrors: {}, busy: null, confirm: null };
  }

  componentDidMount() { this.load(); }

  load() {
    apiFetch('/post/' + encodeURIComponent(this.props.match.params.id)).then(({ ok, data }) => {
      if (!ok) return this.setState({ loadError: errorMessage(data, 'Post not found.') });
      return this.setState({ post: data });
    }).catch(() => this.setState({ loadError: 'Unable to reach the server. Please try again.' }));
  }

  items() { return (this.state.post && this.state.post.items) || []; }
  setItems(items) { this.setState({ post: Object.assign({}, this.state.post, { items }) }); }
  url(rest) { return '/post/' + this.state.post.id + '/items' + (rest || ''); }

  call(path, method, body) {
    return apiFetch(this.url(path), { method, body: body ? JSON.stringify(body) : undefined }).catch(() => ({ ok: false, data: null, network: true }));
  }

  add(e) {
    e.preventDefault();
    const errors = validateItemFields(this.state.draft);
    this.setState({ draftErrors: errors });
    if (Object.keys(errors).length) { const el = document.getElementById('new-' + Object.keys(errors)[0]); if (el) el.focus(); return; }
    this.setState({ adding: true });
    this.call('', 'POST', bodyOf(this.state.draft)).then(({ ok, data }) => {
      if (!ok) {
        const d = (data && data.error && data.error.details) || {};
        this.setState({ adding: false, draftErrors: d });
        if (!Object.keys(d).length) toast.error(errorMessage(data, "Couldn't add the item."));
        return;
      }
      this.setItems(this.items().concat(data));
      this.setState({ adding: false, draft: Object.assign(blank(), { photoId: null }), draftErrors: {} });
      toast.success(data.name + ' added.');
      const el = document.getElementById('new-name');
      if (el) el.focus();
    });
  }

  startEdit(item) {
    this.setState({ editing: item.id, edit: { name: item.name, price: centsInput(item.priceCents), photoId: item.photoId }, editErrors: {} });
  }

  saveEdit(e, item) {
    e.preventDefault();
    const errors = validateItemFields(this.state.edit);
    this.setState({ editErrors: errors });
    if (Object.keys(errors).length) return;
    this.setState({ busy: item.id });
    this.call('/' + item.id, 'PUT', bodyOf(this.state.edit)).then(({ ok, data }) => {
      this.setState({ busy: null });
      if (!ok) {
        const d = (data && data.error && data.error.details) || {};
        this.setState({ editErrors: d });
        if (!Object.keys(d).length) toast.error(errorMessage(data, "Couldn't save the item."));
        return;
      }
      this.setItems(this.items().map((i) => (i.id === data.id ? data : i)));
      this.setState({ editing: null, edit: null });
      toast.success('Saved.');
    });
  }

  toggleSold(item) {
    this.setState({ busy: item.id });
    this.call('/' + item.id, 'PUT', { sold: !item.sold }).then(({ ok, data }) => {
      this.setState({ busy: null });
      if (!ok) { toast.error(errorMessage(data, "Couldn't update the item.")); return; }
      this.setItems(this.items().map((i) => (i.id === data.id ? data : i)));
    });
  }

  move(index, delta) {
    const list = this.items().slice();
    const j = index + delta;
    if (j < 0 || j >= list.length) return;
    const [x] = list.splice(index, 1);
    list.splice(j, 0, x);
    const before = this.items();
    this.setItems(list);
    this.call('/order', 'PUT', { ids: list.map((i) => i.id) }).then(({ ok, data }) => {
      if (!ok) { this.setItems(before); toast.error(errorMessage(data, "Couldn't reorder.")); return; }
      this.setItems(data.items);
      const btn = document.querySelector('[data-item-id="' + x.id + '"] .move-' + (delta < 0 ? 'up' : 'down'));
      if (btn && !btn.disabled) btn.focus();
    });
  }

  remove(item) {
    this.setState({ busy: item.id });
    this.call('/' + item.id, 'DELETE').then(({ ok, data }) => {
      this.setState({ busy: null, confirm: null });
      if (!ok) { toast.error(errorMessage(data, "Couldn't delete the item.")); return; }
      this.setItems(this.items().filter((i) => i.id !== item.id));
      toast.success(item.name + ' deleted.');
    });
  }

  renderRow(item, index, photos) {
    const { editing, edit, editErrors, busy } = this.state;
    const photo = photos.find((p) => p.id === item.photoId);
    const n = this.items().length;
    if (editing === item.id) {
      return (
        <li key={item.id} className="item-row" data-item-id={item.id}>
          <form className="item-form item-edit" onSubmit={(e) => this.saveEdit(e, item)} noValidate>
            <ItemFields idPrefix={'edit-' + item.id} values={edit} errors={editErrors} photos={photos}
              onChange={(patch) => this.setState({ edit: Object.assign({}, this.state.edit, patch) })} />
            <div className="form-actions">
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy === item.id}>{busy === item.id ? <Spinner /> : <Check size={14} aria-hidden="true" />}Save</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => this.setState({ editing: null, edit: null })}>Cancel</button>
            </div>
          </form>
        </li>
      );
    }
    return (
      <li key={item.id} className={'item-row' + (item.sold ? ' is-sold' : '')} data-item-id={item.id}>
        {photo ? <span className="item-thumb item-thumb-empty"><img src={photo.thumbUrl} alt="" /></span> : <span className="item-thumb item-thumb-empty" aria-hidden="true"><Package size={16} /></span>}
        <span className="item-name">{item.name}{item.sold ? <span className="sr-only"> (sold)</span> : null}</span>
        {item.priceCents !== null ? <span className={'item-price' + (item.priceCents === 0 ? ' is-free' : '')}>{formatCents(item.priceCents)}</span> : null}
        <span className="item-actions">
          <button type="button" className={'btn btn-sm item-sold-toggle ' + (item.sold ? 'btn-ghost' : 'btn-secondary')} aria-pressed={item.sold} disabled={busy === item.id}
            aria-label={item.sold ? 'Mark ' + item.name + ' available' : 'Mark ' + item.name + ' sold'} onClick={() => this.toggleSold(item)}>
            <Check size={14} aria-hidden="true" />{item.sold ? 'Sold' : 'Mark sold'}
          </button>
          <button type="button" className="btn btn-ghost btn-icon btn-sm move-up" aria-label={'Move ' + item.name + ' up'} disabled={index === 0} onClick={() => this.move(index, -1)}><ArrowUp size={14} aria-hidden="true" /></button>
          <button type="button" className="btn btn-ghost btn-icon btn-sm move-down" aria-label={'Move ' + item.name + ' down'} disabled={index === n - 1} onClick={() => this.move(index, 1)}><ArrowDown size={14} aria-hidden="true" /></button>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={'Edit ' + item.name} onClick={() => this.startEdit(item)}><Pencil size={14} aria-hidden="true" /></button>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={'Delete ' + item.name} onClick={() => this.setState({ confirm: item })}><Trash2 size={14} aria-hidden="true" /></button>
        </span>
      </li>
    );
  }

  render() {
    const { post, loadError, draft, draftErrors, adding, confirm, busy } = this.state;
    if (loadError) return <div className="container container-narrow"><EmptyState icon={SearchX} title="We couldn't load that sale" action={<Link className="btn btn-primary" to="/">Browse sales</Link>}>{loadError}</EmptyState></div>;
    if (!post) return <div className="container container-narrow"><SkeletonBlock height={240} lines={4} /></div>;
    const user = this.props.user;
    if (this.props.ready && (!user || user.id !== post.userId)) {
      return <div className="container container-narrow"><EmptyState icon={Lock} title="Only the seller can edit items" action={<Link className="btn btn-secondary" to={'/post/' + post.id}>Back to the sale</Link>}>Items are managed by the person who posted the sale.</EmptyState></div>;
    }
    const items = this.items();
    const photos = post.photos || [];
    return (
      <div className="container container-narrow items-editor">
        <Link to={'/post/' + post.id} className="back-link"><ArrowLeft size={16} aria-hidden="true" />Back to the sale</Link>
        <header className="page-header"><div><h1>Items for sale</h1><p>{post.title}{items.length ? ' · ' + itemSummary(items) : ''}</p></div></header>
        <div className="stack">
          <form className="card-form item-form" onSubmit={(e) => this.add(e)} noValidate aria-labelledby="add-item-title">
            <h2 id="add-item-title" className="h4">Add an item</h2>
            <ItemFields idPrefix="new" values={draft} errors={draftErrors} photos={photos}
              onChange={(patch) => this.setState({ draft: Object.assign({}, draft, patch) })} />
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={adding || items.length >= MAX_ITEMS}>{adding ? <Spinner /> : <Plus size={16} aria-hidden="true" />}Add item</button>
              {items.length >= MAX_ITEMS ? <span className="small muted">That's the maximum of {MAX_ITEMS} items.</span> : null}
            </div>
            <p className="small muted">Buyers can search for item names. Sold items stay on the list, struck through, and stop matching searches.</p>
          </form>
          {items.length ? <ul className="item-list">{items.map((it, i) => this.renderRow(it, i, photos))}</ul>
            : <Alert tone="info">No items yet. Add a few highlights; you don't need to list everything.</Alert>}
          <div className="form-actions"><Link className="btn btn-secondary" to={'/post/' + post.id}>Done</Link></div>
        </div>
        {confirm ? (
          <Dialog id="delete-item" title={'Delete ' + confirm.name + '?'} onClose={() => busy !== confirm.id && this.setState({ confirm: null })}
            description="This removes it from the list. To show it's gone but keep it listed, mark it sold instead."
            footer={(
              <React.Fragment>
                <button type="button" className="btn btn-ghost" onClick={() => this.setState({ confirm: null })}>Cancel</button>
                <button type="button" className="btn btn-danger" disabled={busy === confirm.id} onClick={() => this.remove(confirm)}>{busy === confirm.id ? <Spinner /> : <Trash2 size={16} aria-hidden="true" />}Delete</button>
              </React.Fragment>
            )} />
        ) : null}
      </div>
    );
  }
}

export default ItemsEditor;
