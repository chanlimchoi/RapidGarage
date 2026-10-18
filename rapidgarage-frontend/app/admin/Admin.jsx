import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Users, SlidersHorizontal, Lock, LogIn, Flag, MapPin } from 'lucide-react';
import Reports from './Reports';
import MeetupSpots from './MeetupSpots';
import { apiFetch, errorMessage } from '../api';
import { Alert, EmptyState, SkeletonBlock } from '../components/ui';
import { initials, displayName } from '../lib/format';
import toast from '../components/toast';
import { t } from '../i18n';

// Admin-only page. The server enforces this (403 for non-admins); the UI
// check below just avoids showing an empty page.
export default class Admin extends React.Component {
  constructor(props) {
    super(props);
    this.state = { loading: true, settings: null, users: [], error: '', busy: false, tab: 'reports', openReports: null };
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
          this.setState({ loading: false, error: errorMessage(s.ok ? u.data : s.data, t('admin.loadFailed')) });
          return;
        }
        this.setState({ loading: false, settings: s.data, users: u.data, error: '' });
      })
      .catch(() => this.setState({ loading: false, error: t('common.networkShort') }));
  }

  toggleSaleAlerts() {
    const next = !this.state.settings.saleAlerts;
    this.setState({ busy: true, error: '' });
    apiFetch('/admin/settings', { method: 'PUT', body: JSON.stringify({ saleAlerts: next }) })
      .then(({ ok, data }) => {
        if (!ok) { this.setState({ busy: false }); toast.error(errorMessage(data, t('admin.settingFailed'))); return null; }
        this.setState({ busy: false, settings: data });
        toast.success(data.saleAlerts ? t('admin.alertsOn') : t('admin.alertsOff'));
        if (this.props.onConfigChange) this.props.onConfigChange();
        return null;
      })
      .catch(() => { this.setState({ busy: false }); toast.error(t('common.networkShort')); });
  }

  toggleAiItems() {
    const next = !this.state.settings.aiItems;
    this.setState({ busy: true, error: '' });
    apiFetch('/admin/settings', { method: 'PUT', body: JSON.stringify({ aiItems: next }) })
      .then(({ ok, data }) => {
        if (!ok) { this.setState({ busy: false }); toast.error(errorMessage(data, t('admin.settingFailed'))); return null; }
        this.setState({ busy: false, settings: data });
        toast.success(data.aiItems ? t('admin.aiOn') : t('admin.aiOff'));
        if (this.props.onConfigChange) this.props.onConfigChange();
        return null;
      })
      .catch(() => { this.setState({ busy: false }); toast.error(t('common.networkShort')); });
  }

  toggleWanted() {
    const next = !this.state.settings.wantedPosts;
    this.setState({ busy: true, error: '' });
    apiFetch('/admin/settings', { method: 'PUT', body: JSON.stringify({ wantedPosts: next }) })
      .then(({ ok, data }) => {
        if (!ok) { this.setState({ busy: false }); toast.error(errorMessage(data, t('admin.settingFailed'))); return null; }
        this.setState({ busy: false, settings: data });
        toast.success(data.wantedPosts ? t('admin.wantedOn') : t('admin.wantedOff'));
        if (this.props.onConfigChange) this.props.onConfigChange();
        return null;
      })
      .catch(() => { this.setState({ busy: false }); toast.error(t('common.networkShort')); });
  }

  toggleMapsKeys() {
    const next = !this.state.settings.userMapsKeys;
    this.setState({ busy: true, error: '' });
    apiFetch('/admin/settings', { method: 'PUT', body: JSON.stringify({ userMapsKeys: next }) })
      .then(({ ok, data }) => {
        if (!ok) { this.setState({ busy: false }); toast.error(errorMessage(data, t('admin.settingFailed'))); return null; }
        this.setState({ busy: false, settings: data });
        toast.success(data.userMapsKeys ? t('admin.keysOn') : t('admin.keysOff'));
        if (this.props.onConfigChange) this.props.onConfigChange();
        return null;
      })
      .catch(() => { this.setState({ busy: false }); toast.error(t('common.networkShort')); });
  }

  setRole(u, role) {
    if (!window.confirm(t(role === 'admin' ? 'admin.confirmMake' : 'admin.confirmRemove', { email: u.email }))) return;
    this.setState({ busy: true, error: '' });
    apiFetch('/admin/users/' + u.id + '/role', { method: 'PUT', body: JSON.stringify({ role }) })
      .then(({ ok, data }) => {
        if (!ok) { this.setState({ busy: false }); toast.error(errorMessage(data, t('admin.roleFailed'))); return null; }
        this.setState({ busy: false, users: this.state.users.map((x) => (x.id === u.id ? data : x)) });
        toast.success(t(role === 'admin' ? 'admin.nowAdmin' : 'admin.nowUser', { email: u.email }));
        // Demoting yourself drops your access; refresh who we are.
        if (u.id === this.props.user.id && this.props.onAuthChange) this.props.onAuthChange();
        return null;
      })
      .catch(() => { this.setState({ busy: false }); toast.error(t('common.networkShort')); });
  }

  render() {
    if (!this.props.user) {
      if (!this.props.ready) return <div className="container"><SkeletonBlock lines={4} /></div>;
      return <div className="container container-narrow"><EmptyState level={1} icon={LogIn} title={t('admin.loginFirst')} action={<Link className="btn btn-primary" to="/login">{t('nav.logIn')}</Link>}>{t('admin.needAdmin')}</EmptyState></div>;
    }
    if (!this.isAdmin()) return <div className="container container-narrow"><EmptyState level={1} icon={Lock} title={t('admin.only')}>{t('admin.noAccess')}</EmptyState></div>;
    const s = this.state;
    const admins = s.users.filter((u) => u.role === 'admin').length;
    return (
      <div className="container rg-admin">
        <header className="page-header">
          <div>
            <h1><ShieldCheck size={26} aria-hidden="true" style={{ verticalAlign: '-4px', marginRight: 8, color: 'var(--color-brand)' }} />{t('nav.admin')}</h1>
            <p>{s.loading ? t('ui.loadingDots') : t('admin.users', { count: s.users.length }) + ' · ' + t('admin.admins', { count: admins })}</p>
          </div>
        </header>
        {s.error ? <Alert tone="danger">{s.error}</Alert> : null}
        <div className="segmented admin-tabs" role="group" aria-label={t('admin.sections')}>
          <button type="button" aria-pressed={s.tab === 'reports'} onClick={() => this.setState({ tab: 'reports' })}><Flag size={14} aria-hidden="true" />{t('admin.reports')}{s.openReports ? <span className="count" aria-label={t('admin.open', { count: s.openReports })}>{s.openReports}</span> : null}</button>
          <button type="button" aria-pressed={s.tab === 'spots'} onClick={() => this.setState({ tab: 'spots' })}><MapPin size={14} aria-hidden="true" />{t('admin.spotsTab')}</button>
          <button type="button" aria-pressed={s.tab === 'users'} onClick={() => this.setState({ tab: 'users' })}><Users size={14} aria-hidden="true" />{t('admin.usersTab')}</button>
          <button type="button" aria-pressed={s.tab === 'settings'} onClick={() => this.setState({ tab: 'settings' })}><SlidersHorizontal size={14} aria-hidden="true" />{t('nav.settings')}</button>
        </div>
        {s.tab === 'reports' ? <Reports onCount={(n) => this.setState({ openReports: n })} /> : null}
        {s.tab === 'spots' ? <MeetupSpots /> : null}
        {s.tab !== 'reports' && s.tab !== 'spots' && s.loading ? <SkeletonBlock height={120} lines={4} /> : null}
        {s.tab === 'settings' && !s.loading ? (
          <div className="stack">
            {s.settings ? (
              <section className="settings-section card-form rg-admin-settings" aria-labelledby="admin-settings-heading">
                <header>
                  <h2 id="admin-settings-heading"><SlidersHorizontal size={18} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />{t('nav.settings')}</h2>
                  <p>{t('admin.siteWide')}</p>
                </header>
                <div className="stack">
                  <label className="checkbox-row" htmlFor="toggleUserMapsKeys">
                    <span className="switch">
                      <input id="toggleUserMapsKeys" type="checkbox" role="switch" checked={!!s.settings.userMapsKeys} disabled={s.busy}
                        onChange={() => this.toggleMapsKeys()} aria-describedby="toggleUserMapsKeys-hint" />
                      <span className="switch-track" aria-hidden="true" />
                    </span>
                    <span>
                      <strong>{t('admin.letKeys')}</strong>
                      <span id="toggleUserMapsKeys-hint" className="field-hint" style={{ display: 'block' }}>{t('admin.letKeysHint')}</span>
                    </span>
                  </label>
                  <label className="checkbox-row" htmlFor="toggleSaleAlerts">
                    <span className="switch">
                      <input id="toggleSaleAlerts" type="checkbox" role="switch" checked={!!s.settings.saleAlerts} disabled={s.busy}
                        onChange={() => this.toggleSaleAlerts()} aria-describedby="toggleSaleAlerts-hint" />
                      <span className="switch-track" aria-hidden="true" />
                    </span>
                    <span>
                      <strong>{t('admin.emailAlerts')}</strong>
                      <span id="toggleSaleAlerts-hint" className="field-hint" style={{ display: 'block' }}>{t('admin.emailAlertsHint')}</span>
                    </span>
                  </label>
                  <label className="checkbox-row" htmlFor="toggleWantedPosts">
                    <span className="switch">
                      <input id="toggleWantedPosts" type="checkbox" role="switch" checked={!!s.settings.wantedPosts} disabled={s.busy}
                        onChange={() => this.toggleWanted()} aria-describedby="toggleWantedPosts-hint" />
                      <span className="switch-track" aria-hidden="true" />
                    </span>
                    <span>
                      <strong>{t('admin.wantedPosts')}</strong>
                      <span id="toggleWantedPosts-hint" className="field-hint" style={{ display: 'block' }}>{t('admin.wantedPostsHint')}</span>
                    </span>
                  </label>
                  <label className="checkbox-row" htmlFor="toggleAiItems">
                    <span className="switch">
                      <input id="toggleAiItems" type="checkbox" role="switch" checked={!!s.settings.aiItems} disabled={s.busy}
                        onChange={() => this.toggleAiItems()} aria-describedby="toggleAiItems-hint" />
                      <span className="switch-track" aria-hidden="true" />
                    </span>
                    <span>
                      <strong>{t('admin.aiItems')}</strong>
                      <span id="toggleAiItems-hint" className="field-hint" style={{ display: 'block' }}>{t('admin.aiItemsHint')}</span>
                    </span>
                  </label>
                </div>
              </section>
            ) : null}
          </div>
        ) : null}
        {s.tab === 'users' && !s.loading ? (
          <div className="stack">
            <section className="rg-admin-users" aria-labelledby="admin-users-heading">
              <h2 id="admin-users-heading" className="h4" style={{ margin: '8px 0 12px' }}><Users size={18} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />{t('admin.usersTab')}</h2>
              {s.users.length ? (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th scope="col">{t('admin.user')}</th><th scope="col">{t('admin.role')}</th><th scope="col"><span className="sr-only">{t('admin.actions')}</span></th></tr></thead>
                    <tbody>
                      {s.users.map((u) => (
                        <tr key={u.id}>
                          <td>
                            <div className="user-cell">
                              <span className="avatar" aria-hidden="true">{initials(u)}</span>
                              <span><strong>{displayName(u)}</strong><small>{u.email}</small></span>
                            </div>
                          </td>
                          <td className="cell-role"><span className={'chip badge-role ' + (u.role === 'admin' ? 'chip-brand' : '')}>{u.role === 'admin' ? t('admin.roleAdmin') : t('admin.roleUser')}</span>{u.messagingBanned ? <span className="chip chip-danger" style={{ marginLeft: 6 }}>{t('admin.banned')}</span> : null}</td>
                          <td>
                            {u.role === 'admin'
                              ? <button type="button" className="btn btn-secondary btn-sm" disabled={s.busy} onClick={() => this.setRole(u, 'user')}>{t('admin.removeAdmin')}</button>
                              : <button type="button" className="btn btn-primary btn-sm" disabled={s.busy} onClick={() => this.setRole(u, 'admin')}>{t('admin.makeAdmin')}</button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <EmptyState icon={Users} title={t('admin.noUsers')} />}
            </section>
          </div>
        ) : null}
      </div>
    );
  }
}
