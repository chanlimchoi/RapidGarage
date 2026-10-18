import React, { Component } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { MAX_PHOTO_BYTES, PHOTO_TYPES } from '../api';
import { t } from '../i18n';

export const ALT_MAX = 250;

// Pick (or drop) up to `max` photos and preview them before upload.
// Calls onChange(files, alts) with the current File list and the description
// typed for each one (alt text for people who can't see the photo).
class PhotoPicker extends Component {
  constructor(props) {
    super(props);
    this.state = { items: [], error: '', dragging: false };
    this.handleFiles = this.handleFiles.bind(this);
  }

  componentWillUnmount() {
    this.state.items.forEach((i) => URL.revokeObjectURL(i.preview));
  }

  addFiles(list) {
    const max = this.props.max;
    const picked = Array.prototype.slice.call(list || []);
    let error = '';
    const ok = picked.filter((f) => {
      if (PHOTO_TYPES.indexOf(f.type) === -1) { error = t('photos.badType', { name: f.name }); return false; }
      if (f.size > MAX_PHOTO_BYTES) { error = t('photos.tooBig', { name: f.name }); return false; }
      return true;
    });
    let items = this.state.items.concat(ok.map((file) => ({ file, alt: '', preview: URL.createObjectURL(file) })));
    if (items.length > max) {
      items.slice(max).forEach((i) => URL.revokeObjectURL(i.preview));
      items = items.slice(0, max);
      error = t('photos.canAdd', { count: max });
    }
    this.setState({ items, error });
    this.emit(items);
  }

  emit(items) { this.props.onChange(items.map((i) => i.file), items.map((i) => i.alt)); }

  setAlt(index, alt) {
    const items = this.state.items.map((it, i) => (i === index ? Object.assign({}, it, { alt }) : it));
    this.setState({ items });
    this.emit(items);
  }

  handleFiles(e) {
    const files = e.target.files;
    this.addFiles(files);
    e.target.value = '';
  }

  onDrop(e) {
    e.preventDefault();
    this.setState({ dragging: false });
    if (this.state.items.length >= this.props.max) return;
    this.addFiles(e.dataTransfer && e.dataTransfer.files);
  }

  remove(index) {
    const items = this.state.items.slice();
    URL.revokeObjectURL(items[index].preview);
    items.splice(index, 1);
    this.setState({ items, error: '' });
    this.emit(items);
  }

  render() {
    const { max } = this.props;
    const left = Math.max(0, max - this.state.items.length);
    const full = left === 0;
    return (
      <div className="photo-picker">
        <label className={'dropzone' + (this.state.dragging ? ' dragging' : '')} aria-disabled={full ? 'true' : undefined}
          onDragOver={(e) => { e.preventDefault(); if (!this.state.dragging) this.setState({ dragging: true }); }}
          onDragLeave={() => this.setState({ dragging: false })}
          onDrop={(e) => this.onDrop(e)}>
          <ImagePlus size={28} aria-hidden="true" />
          <strong>{full ? t('photos.limit') : t('photos.add')}</strong>
          <span className="small">{t('photos.hint', { count: left })}</span>
          <input type="file" name="photos" accept={PHOTO_TYPES.join(',')} multiple disabled={full}
            onChange={this.handleFiles} className="sr-only" data-testid="photo-input" />
        </label>
        {this.state.items.length ? (
          <React.Fragment>
          <div className="photo-grid photo-entries photo-previews">
            {this.state.items.map((item, i) => (
              <div key={item.preview} className="photo-entry">
                <div className="photo-tile">
                  <img src={item.preview} alt={item.alt.trim() || t('photos.preview', { n: i + 1 })} className="photo-preview" />
                  <button type="button" className="btn photo-remove" aria-label={t('photos.remove', { name: item.file.name })} onClick={() => this.remove(i)}><X size={16} aria-hidden="true" /></button>
                </div>
                <label className="photo-alt" htmlFor={'photo-alt-new-' + i}>
                  <span className="small">{t('photos.describeN', { n: i + 1 })} <span className="muted">{t('ui.optional')}</span></span>
                  <input id={'photo-alt-new-' + i} className="input input-sm" type="text" maxLength={ALT_MAX} value={item.alt}
                    placeholder={t('photos.describePlaceholder')} onChange={(e) => this.setAlt(i, e.target.value)} />
                </label>
              </div>
            ))}
          </div>
          <p className="field-hint">{t('photos.describeHint')}</p>
          </React.Fragment>
        ) : null}
        {this.state.error ? <p className="field-error" role="alert" style={{ marginTop: 8 }}>{this.state.error}</p> : null}
      </div>
    );
  }
}

export default PhotoPicker;
