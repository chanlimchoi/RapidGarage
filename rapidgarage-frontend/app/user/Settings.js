import React from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, errorMessage } from '../api';

// Bring-your-own Google Maps key. The key is stored encrypted on the server
// and only its last 4 characters are ever shown here.
export default class Settings extends React.Component {
  constructor(props) {
    super(props);
    this.state = { loading: true, hasKey: false, last4: null, input: '', error: '', notice: '', busy: false };
    this.save = this.save.bind(this);
    this.remove = this.remove.bind(this);
  }

  componentDidMount() {
    this.load();
  }

  componentDidUpdate(prevProps) {
    if ((prevProps.user && prevProps.user.id) !== (this.props.user && this.props.user.id)) this.load();
  }

  load() {
    if (!this.props.user) {
      this.setState({ loading: false });
      return;
    }
    apiFetch('/me/maps-key').then(({ ok, data }) => {
      if (ok) this.setState({ loading: false, hasKey: data.hasKey, last4: data.last4 });
      else this.setState({ loading: false, error: errorMessage(data, 'Could not load your settings.') });
    }).catch(() => this.setState({ loading: false, error: 'Unable to reach the server.' }));
  }

  save(e) {
    e.preventDefault();
    this.setState({ busy: true, error: '', notice: '' });
    apiFetch('/me/maps-key', { method: 'PUT', body: JSON.stringify({ key: this.state.input }) })
      .then(({ ok, data }) => {
        if (!ok) {
          this.setState({ busy: false, error: errorMessage(data, 'Could not save the key.') });
          return;
        }
        this.setState({ busy: false, hasKey: data.hasKey, last4: data.last4, input: '', notice: 'Key saved.' });
        if (this.props.onAuthChange) this.props.onAuthChange();
      })
      .catch(() => this.setState({ busy: false, error: 'Unable to reach the server.' }));
  }

  remove() {
    if (!window.confirm('Remove your Google Maps key?')) return;
    this.setState({ busy: true, error: '', notice: '' });
    apiFetch('/me/maps-key', { method: 'DELETE' })
      .then(({ ok, data }) => {
        if (!ok) {
          this.setState({ busy: false, error: errorMessage(data, 'Could not remove the key.') });
          return;
        }
        this.setState({ busy: false, hasKey: false, last4: null, notice: 'Key removed.' });
        if (this.props.onAuthChange) this.props.onAuthChange();
      })
      .catch(() => this.setState({ busy: false, error: 'Unable to reach the server.' }));
  }

  render() {
    if (!this.props.user) {
      return <div className="col-sm-8"><p><Link to="/login">Log in</Link> to manage your settings.</p></div>;
    }
    const s = this.state;
    return (
      <div className="col-sm-8 rg-settings">
        <h3>Google Maps key</h3>
        <p>
          The map uses your own Google Maps API key. Signing in with Google does not create one for you:
          create a browser key in Google Cloud Console with the <strong>Maps JavaScript API</strong> and
          {' '}<strong>Geocoding API</strong> enabled.
        </p>
        <p className="text-warning">
          A Maps key is a browser key and is visible to anyone using the page while the map loads.
          Restrict it in Google Cloud Console by <strong>HTTP referrer</strong> (this site only) and to those
          two <strong>APIs</strong>, so it can't be reused elsewhere.
        </p>
        {s.loading ? <p>Loading…</p> : (
          <div>
            <p className="rg-key-status">
              {s.hasKey ? <span>Saved key: <code>••••••••{s.last4}</code></span> : 'No key saved.'}
            </p>
            <form onSubmit={this.save} autoComplete="off">
              <div className="input-group">
                <span className="input-group-addon">{s.hasKey ? 'Replace key' : 'API key'}</span>
                <input id="mapsKey" type="password" className="form-control" placeholder="AIza…" value={s.input}
                  onChange={(e) => this.setState({ input: e.target.value })} required autoComplete="off" spellCheck="false" />
              </div>
              <br />
              <button type="submit" className="btn btn-info" disabled={s.busy}>{s.hasKey ? 'Replace' : 'Save'}</button>{' '}
              {s.hasKey ? <button type="button" className="btn btn-danger" onClick={this.remove} disabled={s.busy}>Remove</button> : null}
            </form>
          </div>
        )}
        {s.notice ? <p className="text-success">{s.notice}</p> : null}
        {s.error ? <p className="text-danger">{s.error}</p> : null}
      </div>
    );
  }
}
