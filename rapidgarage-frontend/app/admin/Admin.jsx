import React from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, errorMessage } from '../api';

// Admin-only page. The server enforces this (403 for non-admins); the UI
// check below just avoids showing an empty page.
export default class Admin extends React.Component {
  constructor(props) {
    super(props);
    this.state = { loading: true, settings: null, users: [], error: '', notice: '', busy: false };
  }

  componentDidMount() {
    this.load();
  }

  componentDidUpdate(prevProps) {
    if ((prevProps.user && prevProps.user.role) !== (this.props.user && this.props.user.role)) this.load();
  }

  isAdmin() {
    return !!(this.props.user && this.props.user.role === 'admin');
  }

  load() {
    if (!this.isAdmin()) {
      this.setState({ loading: false });
      return;
    }
    Promise.all([apiFetch('/admin/settings'), apiFetch('/admin/users')])
      .then(([s, u]) => {
        if (!s.ok || !u.ok) {
          this.setState({ loading: false, error: errorMessage(s.ok ? u.data : s.data, 'Could not load admin data.') });
          return;
        }
        this.setState({ loading: false, settings: s.data, users: u.data, error: '' });
      })
      .catch(() => this.setState({ loading: false, error: 'Unable to reach the server.' }));
  }

  toggleMapsKeys() {
    const next = !this.state.settings.userMapsKeys;
    this.setState({ busy: true, error: '', notice: '' });
    apiFetch('/admin/settings', { method: 'PUT', body: JSON.stringify({ userMapsKeys: next }) })
      .then(({ ok, data }) => {
        if (!ok) return this.setState({ busy: false, error: errorMessage(data, 'Could not save the setting.') });
        this.setState({ busy: false, settings: data, notice: 'Setting saved.' });
        if (this.props.onConfigChange) this.props.onConfigChange();
        return null;
      })
      .catch(() => this.setState({ busy: false, error: 'Unable to reach the server.' }));
  }

  setRole(u, role) {
    if (!window.confirm((role === 'admin' ? 'Make ' : 'Remove admin from ') + u.email + '?')) return;
    this.setState({ busy: true, error: '', notice: '' });
    apiFetch('/admin/users/' + u.id + '/role', { method: 'PUT', body: JSON.stringify({ role }) })
      .then(({ ok, data }) => {
        if (!ok) return this.setState({ busy: false, error: errorMessage(data, 'Could not change the role.') });
        this.setState({ busy: false, notice: 'Role updated.', users: this.state.users.map((x) => (x.id === u.id ? data : x)) });
        // Demoting yourself drops your access; refresh who we are.
        if (u.id === this.props.user.id && this.props.onAuthChange) this.props.onAuthChange();
        return null;
      })
      .catch(() => this.setState({ busy: false, error: 'Unable to reach the server.' }));
  }

  render() {
    if (!this.props.user) return <div className="col-sm-8"><p><Link to="/login">Log in</Link> first.</p></div>;
    if (!this.isAdmin()) return <div className="col-sm-8"><p>Admins only.</p></div>;
    const s = this.state;
    return (
      <div className="col-sm-10 rg-admin">
        <h3>Admin</h3>
        {s.loading ? <p>Loading…</p> : null}
        {s.settings ? (
          <div className="rg-admin-settings">
            <h4>Settings</h4>
            <label>
              <input id="toggleUserMapsKeys" type="checkbox" checked={!!s.settings.userMapsKeys} disabled={s.busy}
                onChange={() => this.toggleMapsKeys()} />
              {' '}Let users add their own Google Maps key
            </label>
            <p className="text-muted">When off, the map uses only the server's key. Saved user keys are kept but not used.</p>
          </div>
        ) : null}
        {s.users.length ? (
          <div className="rg-admin-users">
            <h4>Users</h4>
            <table className="table table-condensed">
              <thead><tr><th>Email</th><th>Name</th><th>Role</th><th></th></tr></thead>
              <tbody>
                {s.users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.email}</td>
                    <td>{[u.firstName, u.lastName].filter(Boolean).join(' ')}</td>
                    <td>{u.role}</td>
                    <td>
                      {u.role === 'admin'
                        ? <button type="button" className="btn btn-default btn-xs" disabled={s.busy} onClick={() => this.setRole(u, 'user')}>Remove admin</button>
                        : <button type="button" className="btn btn-info btn-xs" disabled={s.busy} onClick={() => this.setRole(u, 'admin')}>Make admin</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {s.notice ? <p className="text-success">{s.notice}</p> : null}
        {s.error ? <p className="text-danger">{s.error}</p> : null}
      </div>
    );
  }
}
