import React, { Component } from 'react';
import { MAX_PHOTO_BYTES, PHOTO_TYPES } from '../api';

// Pick up to `max` photos and preview them before upload.
// Calls onChange(files) with the current File list.
class PhotoPicker extends Component {
  constructor(props) {
    super(props);
    this.state = { items: [], error: '' };
    this.handleFiles = this.handleFiles.bind(this);
  }

  componentWillUnmount() {
    this.state.items.forEach((i) => URL.revokeObjectURL(i.preview));
  }

  handleFiles(e) {
    const max = this.props.max;
    const picked = Array.prototype.slice.call(e.target.files || []);
    e.target.value = '';
    let error = '';
    const ok = picked.filter((f) => {
      if (PHOTO_TYPES.indexOf(f.type) === -1) { error = f.name + ' is not a JPEG, PNG or WebP image.'; return false; }
      if (f.size > MAX_PHOTO_BYTES) { error = f.name + ' is larger than 8 MB.'; return false; }
      return true;
    });
    let items = this.state.items.concat(ok.map((file) => ({ file, preview: URL.createObjectURL(file) })));
    if (items.length > max) {
      items.slice(max).forEach((i) => URL.revokeObjectURL(i.preview));
      items = items.slice(0, max);
      error = 'You can add ' + max + ' more photo' + (max === 1 ? '' : 's') + ' to this post.';
    }
    this.setState({ items, error });
    this.props.onChange(items.map((i) => i.file));
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
    const full = this.state.items.length >= max;
    return (
      <div className="photo-picker">
        <label className="btn btn-default" style={full ? { opacity: 0.5 } : null}>
          Add photos
          <input type="file" name="photos" accept={PHOTO_TYPES.join(',')} multiple disabled={full}
            onChange={this.handleFiles} style={{ display: 'none' }} data-testid="photo-input" />
        </label>
        <small className="text-muted"> JPEG, PNG or WebP, up to 8 MB each. {Math.max(0, max - this.state.items.length)} left.</small>
        <div className="photo-previews" style={{ display: 'flex', flexWrap: 'wrap', marginTop: 8 }}>
          {this.state.items.map((item, i) => (
            <div key={item.preview} style={{ position: 'relative', marginRight: 8, marginBottom: 8 }}>
              <img src={item.preview} alt={'Preview ' + (i + 1)} className="photo-preview" style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 4 }} />
              <button type="button" className="btn btn-xs btn-danger" aria-label={'Remove ' + item.file.name}
                style={{ position: 'absolute', top: 2, right: 2 }} onClick={() => this.remove(i)}>×</button>
            </div>
          ))}
        </div>
        {this.state.error ? <p className="text-danger">{this.state.error}</p> : null}
      </div>
    );
  }
}

export default PhotoPicker;
