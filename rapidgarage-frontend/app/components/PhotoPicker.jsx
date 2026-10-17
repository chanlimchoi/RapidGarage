import React, { Component } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { MAX_PHOTO_BYTES, PHOTO_TYPES } from '../api';
import { t } from '../i18n';

// Pick (or drop) up to `max` photos and preview them before upload.
// Calls onChange(files) with the current File list.
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
    let items = this.state.items.concat(ok.map((file) => ({ file, preview: URL.createObjectURL(file) })));
    if (items.length > max) {
      items.slice(max).forEach((i) => URL.revokeObjectURL(i.preview));
      items = items.slice(0, max);
      error = t('photos.canAdd', { count: max });
    }
    this.setState({ items, error });
    this.props.onChange(items.map((i) => i.file));
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
    this.props.onChange(items.map((i) => i.file));
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
          <div className="photo-grid photo-previews">
            {this.state.items.map((item, i) => (
              <div key={item.preview} className="photo-tile">
                <img src={item.preview} alt={t('photos.preview', { n: i + 1 })} className="photo-preview" />
                <button type="button" className="btn photo-remove" aria-label={t('photos.remove', { name: item.file.name })} onClick={() => this.remove(i)}><X size={16} aria-hidden="true" /></button>
              </div>
            ))}
          </div>
        ) : null}
        {this.state.error ? <p className="field-error" role="alert" style={{ marginTop: 8 }}>{this.state.error}</p> : null}
      </div>
    );
  }
}

export default PhotoPicker;
