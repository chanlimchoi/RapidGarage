import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Users, SlidersHorizontal, Lock, LogIn } from 'lucide-react';
import { apiFetch, errorMessage } from '../api';
import { Alert, EmptyState, SkeletonBlock } from '../components/ui';
import { initials, displayName } from '../lib/format';
import toast from '../components/toast';

// Admin-only page. The server enforces this (403 for non-admins); the UI
// check below just avoids showing an empty page.
export default class Admin extends React.Component {
  constructor(props) {
    super(props);
    this.state = { loading: true, settings: null, users: [], error: '', busy: false };
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
    this.setState({ loading: true });
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
    this.setState({ busy: true, error: '' });
    apiFetch('/admin/settings', { method: 'PUT', body: JSON.stringify({ userMapsKeys: next }) })
      .then(({ ok, data }) => {
        if (!ok) { this.setState({ busy: false }); toast.error(errorMessage(data, 'Could not save the setting.')); return null; }
        this.setState({ busy: false, settings: data });
        toast.success('Setting saved. Users ' + (data.userMapsKeys ? 'can' : 'can no longer') + ' add their own Maps key.');
        if (this.props.onConfigChange) this.props.onConfigChange();
        return null;
      })
      .catch(() => { this.setState({ busy: false }); toast.error('Unable to reach the server.'); });
  }

  setRole(u, role) {
    if (!window.confirm((role === 'admin' ? 'Make ' : 'Remove admin from ') + u.email + '?')) return;
    this.setState({ busy: true, error: '' });
    apiFetch('/admin/users/' + u.id + '/role', { method: 'PUT', body: JSON.stringify({ role }) })
      .then(({ ok, data }) => {
        if (!ok) { this.setState({ busy: false }); toast.error(errorMessage(data, 'Could not change the role.')); return null; }
        this.setState({ busy: false, users: this.state.users.map((x) => (x.id === u.id ? data : x)) });
        toast.success('Role updated: ' + u.email + ' is now ' + (role === 'admin' ? 'an admin' : 'a regular user') + '.');
        // Demoting yourself drops your access; refresh who we are.
        if (u.id === this.props.user.id && this.props.onAuthChange) this.props.onAuthChange();
        return null;
      })
      .catch(() => { this.setState({ busy: false }); toast.error('Unable to reach the server.'); });
  }

  render() {
    if (!this.props.user) {
      if (!this.props.ready) return <div className="container"><SkeletonBlock lines={4} /></div>;
      return <div className="container container-narrow"><EmptyState icon={LogIn} title="Log in first" action={<Link className="btn btn-primary" to="/login">Log in</Link>}>The admin area needs an admin account.</EmptyState></div>;
    }
    if (!this.isAdmin()) return <div className="container container-narrow"><EmptyState icon={Lock} title="Admins only">You don't have access to this page.</EmptyState></div>;
    const s = this.state;
    const admins = s.users.filter((u) => u.role === 'admin').length;
    return (
      <div className="container rg-admin">
        <header className="page-header">
          <div>
            <h1><ShieldCheck size={26} aria-hidden="true" style={{ verticalAlign: '-4px', marginRight: 8, color: 'var(--color-brand)' }} />Admin</h1>
            <p>{s.loading ? 'Loading…' : s.users.length + ' user' + (s.users.length === 1 ? '' : 's') + ' · ' + admins + ' admin' + (admins === 1 ? '' : 's')}</p>
          </div>
        </header>
        {s.error ? <Alert tone="danger">{s.error}</Alert> : null}
        {s.loading ? <SkeletonBlock height={120} lines={4} /> : (
          <div className="stack">
            {s.settings ? (
              <section className="settings-section card-form rg-admin-settings" aria-labelledby="admin-settings-heading">
                <header>
                  <h2 id="admin-settings-heading"><SlidersHorizontal size={18} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />Settings</h2>
                  <p>Site-wide options.</p>
                </header>
                <label className="checkbox-row" htmlFor="toggleUserMapsKeys">
                  <span className="switch">
                    <input id="toggleUserMapsKeys" type="checkbox" role="switch" checked={!!s.settings.userMapsKeys} disabled={s.busy}
                      onChange={() => this.toggleMapsKeys()} aria-describedby="toggleUserMapsKeys-hint" />
                    <span className="switch-track" aria-hidden="true" />
                  </span>
                  <span>
                    <strong>Let users add their own Google Maps key</strong>
                    <span id="toggleUserMapsKeys-hint" className="field-hint" style={{ display: 'block' }}>When off, the map uses only the server's key. Saved user keys are kept but not used.</span>
                  </span>
                </label>
              </section>
            ) : null}
            <section className="rg-admin-users" aria-labelledby="admin-users-heading">
              <h2 id="admin-users-heading" className="h4" style={{ margin: '8px 0 12px' }}><Users size={18} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />Users</h2>
              {s.users.length ? (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th scope="col">User</th><th scope="col">Role</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                    <tbody>
                      {s.users.map((u) => (
                        <tr key={u.id}>
                          <td>
                            <div className="user-cell">
                              <span className="avatar" aria-hidden="true">{initials(u)}</span>
                              <span><strong>{displayName(u)}</strong><small>{u.email}</small></span>
                            </div>
                          </td>
                          <td className="cell-role"><span className={'chip badge-role ' + (u.role === 'admin' ? 'chip-brand' : '')}>{u.role}</span></td>
                          <td>
                            {u.role === 'admin'
                              ? <button type="button" className="btn btn-secondary btn-sm" disabled={s.busy} onClick={() => this.setRole(u, 'user')}>Remove admin</button>
                              : <button type="button" className="btn btn-primary btn-sm" disabled={s.busy} onClick={() => this.setRole(u, 'admin')}>Make admin</button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <EmptyState icon={Users} title="No users yet" />}
            </section>
          </div>
        )}
      </div>
    );
  }
}
