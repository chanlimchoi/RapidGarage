import React from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Store, Plus, Menu as MenuIcon, X, ChevronDown, User, Settings as SettingsIcon, ShieldCheck, LogOut, LogIn, UserPlus, Search, Info, MessageCircle, Star, UsersRound, LayoutDashboard, PackageSearch, UserCheck } from 'lucide-react';
import { initials, displayName } from '../lib/format';
import InstallMenuItem from '../pwa/InstallMenuItem';
import LanguagePicker from './LanguagePicker';
import { t } from '../i18n';

const badgeText = (n) => (n > 99 ? '99+' : String(n));
const unreadLabel = (n) => t('nav.unreadMessages', { count: n });
const wantedLabel = (n) => t('nav.wantedMatches', { count: n });

// Sticky top bar. Signed out: Log in / Sign up. Signed in: a user menu with
// Profile, Settings, Admin (admins only) and Log out.
export default class NavBar extends React.Component {
  constructor(props) {
    super(props);
    // fit: 0 = full links, 1 = icon-only links, 2 = menu button (like phones),
    // 3 = also just the logo mark (very narrow windows / big zoom).
    // Chosen by measuring, so long labels in any language never push the
    // header wider than the window (WCAG 1.4.10).
    this.state = { menuOpen: false, mobileOpen: false, fit: 0, announce: '' };
    this.menuRef = React.createRef();
    this.triggerRef = React.createRef();
    this.innerRef = React.createRef();
    this.toggleRef = React.createRef();
    this.mobileRef = React.createRef();
    this.onResize = this.onResize.bind(this);
    this.onDocClick = this.onDocClick.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
  }

  componentDidMount() {
    document.addEventListener('mousedown', this.onDocClick);
    document.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('resize', this.onResize);
    if (typeof ResizeObserver !== 'undefined' && this.innerRef.current) {
      this.observer = new ResizeObserver(() => this.onResize());
      this.observer.observe(this.innerRef.current);
    }
    this.fit();
  }

  componentWillUnmount() {
    document.removeEventListener('mousedown', this.onDocClick);
    document.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('resize', this.onResize);
    if (this.observer) this.observer.disconnect();
    cancelAnimationFrame(this.raf);
  }

  componentDidUpdate(prev, prevState) {
    if (prev.location.pathname !== this.props.location.pathname && (this.state.menuOpen || this.state.mobileOpen)) {
      this.setState({ menuOpen: false, mobileOpen: false });
    }
    // New unread messages / wanted matches are announced (politely) to screen
    // readers; the badges themselves only change silently.
    if (prev.user && this.props.user && prev.user.id === this.props.user.id) {
      const parts = [];
      if ((this.props.unread || 0) > (prev.unread || 0)) parts.push(unreadLabel(this.props.unread));
      if ((this.props.wantedNew || 0) > (prev.wantedNew || 0)) parts.push(wantedLabel(this.props.wantedNew));
      if (parts.length) this.setState({ announce: parts.join('. ') + (this.state.announce.endsWith('\u00a0') ? '' : '\u00a0') });
    }
    // Text changes (language, login, badges) can change what fits.
    if (prev.user !== this.props.user || prev.ready !== this.props.ready || prev.unread !== this.props.unread || prev.wantedNew !== this.props.wantedNew) this.onResize();
    else if (prevState.fit !== this.state.fit) this.fit();
  }

  // Start from the roomiest layout again and step down until it fits.
  onResize() {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => { if (this.state.fit !== 0) this.setState({ fit: 0 }); else this.fit(); });
  }

  fit() {
    const el = this.innerRef.current;
    if (!el || this.state.fit >= 3) return;
    if (el.scrollWidth > el.clientWidth + 1) this.setState({ fit: this.state.fit + 1 });
  }

  onDocClick(e) {
    if (this.state.menuOpen && this.menuRef.current && !this.menuRef.current.contains(e.target)) this.setState({ menuOpen: false });
  }

  onKeyDown(e) {
    if (e.key !== 'Escape') return;
    if (this.state.menuOpen) {
      this.setState({ menuOpen: false });
      if (this.triggerRef.current) this.triggerRef.current.focus();
    }
    if (this.state.mobileOpen) {
      this.setState({ mobileOpen: false });
      if (this.toggleRef.current) this.toggleRef.current.focus();
    }
  }

  toggleMobile() {
    this.setState({ mobileOpen: !this.state.mobileOpen }, () => {
      const first = this.state.mobileOpen && this.mobileRef.current && this.mobileRef.current.querySelector('a[href], button, select');
      if (first) first.focus();
    });
  }

  toggleMenu() {
    this.setState({ menuOpen: !this.state.menuOpen }, () => {
      if (this.state.menuOpen && this.menuRef.current) {
        const first = this.menuRef.current.querySelector('[role="menuitem"]');
        if (first) first.focus();
      }
    });
  }

  // Arrow-key navigation inside the open menu.
  // Arrow / Home / End move inside the open menu; Tab closes it and moves on.
  onMenuKey(e) {
    if (e.key === 'Tab') { this.setState({ menuOpen: false }); return; }
    const items = Array.prototype.slice.call(this.menuRef.current.querySelectorAll('[role="menuitem"]'));
    const i = items.indexOf(document.activeElement);
    let next = null;
    if (e.key === 'ArrowDown') next = (i + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next === null) return;
    e.preventDefault();
    items[next].focus();
  }

  renderUserMenu(user, isAdmin) {
    const close = () => this.setState({ menuOpen: false });
    const unread = this.props.unread || 0;
    return (
      <div className="menu user-menu" ref={this.menuRef}>
        <button type="button" className="menu-trigger" ref={this.triggerRef} aria-haspopup="menu" aria-expanded={this.state.menuOpen}
          onClick={() => this.toggleMenu()}>
          <span className="avatar-wrap" aria-hidden="true">
            <span className="avatar">{initials(user)}</span>
            {unread ? <span className="nav-badge avatar-badge">{badgeText(unread)}</span> : null}
          </span>
          <span className="sr-only">{t('nav.accountMenuFor', { name: displayName(user) }) + (unread ? ', ' + unreadLabel(unread) : '')}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        {this.state.menuOpen ? (
          <div className="menu-panel" role="menu" aria-label={t('nav.account')} onKeyDown={(e) => this.onMenuKey(e)}>
            <div className="menu-header">
              <strong>{displayName(user)}</strong>
              <span>{user.email}</span>
            </div>
            <Link role="menuitem" className="menu-item" to="/messages" onClick={close}><MessageCircle size={18} aria-hidden="true" />{t('nav.messages')}
              {unread ? <span className="nav-badge menu-badge" aria-label={unreadLabel(unread)}>{badgeText(unread)}</span> : null}</Link>
            <Link role="menuitem" className="menu-item" to="/saved" onClick={close}><Star size={18} aria-hidden="true" />{t('nav.savedSales')}</Link>
            <Link role="menuitem" className="menu-item" to="/following" onClick={close}><UserCheck size={18} aria-hidden="true" />{t('nav.following')}</Link>
            <Link role="menuitem" className="menu-item" to="/dashboard" onClick={close}><LayoutDashboard size={18} aria-hidden="true" />{t('nav.sellerDashboard')}</Link>
            <Link role="menuitem" className="menu-item" to="/profile" onClick={close}><User size={18} aria-hidden="true" />{t('nav.profileListings')}</Link>
            <Link role="menuitem" className="menu-item" to="/settings" onClick={close}><SettingsIcon size={18} aria-hidden="true" />{t('nav.settings')}</Link>
            {isAdmin ? <Link role="menuitem" className="menu-item" to="/admin" onClick={close}><ShieldCheck size={18} aria-hidden="true" />{t('nav.admin')}</Link> : null}
            <InstallMenuItem role="menuitem" onClick={close} />
            <div className="menu-sep" role="separator" />
            <Link role="menuitem" className="menu-item" to="/logout" onClick={close}><LogOut size={18} aria-hidden="true" />{t('nav.logOut')}</Link>
          </div>
        ) : null}
      </div>
    );
  }

  render() {
    const { user, ready } = this.props;
    const isAdmin = !!(user && user.role === 'admin');
    const mobileOpen = this.state.mobileOpen;
    // Icon-only links keep their words as a tooltip (and for screen readers).
    const tip = (k) => (this.state.fit === 1 ? t(k) : undefined);
    return (
      <header className={'nav' + (['', ' nav-fit-icons', ' nav-fit-menu', ' nav-fit-menu nav-fit-tight'][this.state.fit])}>
        <a className="skip-link" href="#main" onClick={(e) => { const m = document.getElementById('main'); if (m) { e.preventDefault(); m.focus(); m.scrollIntoView(); } }}>{t('nav.skip')}</a>
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{this.state.announce}</div>
        <div className="nav-inner" ref={this.innerRef}>
          <Link to="/" className="brand" aria-label={t('nav.home')}>
            <span className="brand-mark" aria-hidden="true"><Store size={18} /></span>
            <span className="brand-name">RapidGarage</span>
          </Link>
          <nav className={'nav-links' + (user ? ' nav-has-user' : '')} aria-label={t('nav.main')}>
            <NavLink exact to="/" className="nav-link" activeClassName="active" title={tip('nav.browse')}><Search size={16} aria-hidden="true" /><span className="nav-label">{t('nav.browse')}</span></NavLink>
            {user ? (
              <NavLink to="/messages" className="nav-link nav-messages" activeClassName="active" title={tip('nav.messages')}>
                <MessageCircle size={16} aria-hidden="true" /><span className="nav-label">{t('nav.messages')}</span>
                {this.props.unread ? <span className="nav-badge" aria-label={unreadLabel(this.props.unread)}>{badgeText(this.props.unread)}</span> : null}
              </NavLink>
            ) : null}
            {user ? <NavLink to="/saved" className="nav-link nav-saved" activeClassName="active" title={tip('nav.saved')}><Star size={16} aria-hidden="true" /><span className="nav-label">{t('nav.saved')}</span></NavLink> : null}
            {user ? <NavLink to="/dashboard" className="nav-link nav-dashboard" activeClassName="active" title={tip('nav.dashboard')}><LayoutDashboard size={16} aria-hidden="true" /><span className="nav-label">{t('nav.dashboard')}</span></NavLink> : null}
            <NavLink to="/events" className="nav-link nav-events" activeClassName="active" title={tip('nav.events')}><UsersRound size={16} aria-hidden="true" /><span className="nav-label">{t('nav.events')}</span></NavLink>
            <NavLink to="/wanted" className="nav-link nav-wanted" activeClassName="active" title={tip('nav.wanted')}><PackageSearch size={16} aria-hidden="true" /><span className="nav-label">{t('nav.wanted')}</span>
              {this.props.wantedNew ? <span className="nav-badge" aria-label={wantedLabel(this.props.wantedNew)}>{badgeText(this.props.wantedNew)}</span> : null}
            </NavLink>
            <NavLink to="/about" className="nav-link nav-about" activeClassName="active" title={tip('nav.about')}><Info size={16} aria-hidden="true" /><span className="nav-label">{t('nav.about')}</span></NavLink>
          </nav>
          <div className="nav-spacer" />
          <div className="nav-actions">
            <span className="hide-mobile"><LanguagePicker id="nav-language" user={user} /></span>
            <Link to="/newpost" className="btn btn-primary hide-mobile"><Plus size={16} aria-hidden="true" />{t('nav.postSale')}</Link>
            <Link to="/newpost" className="btn btn-primary btn-icon show-mobile" aria-label={t('nav.postSale')}><Plus size={20} aria-hidden="true" /></Link>
            {!ready ? null : user ? this.renderUserMenu(user, isAdmin) : (
              <React.Fragment>
                <Link to="/login" className="btn btn-ghost hide-mobile">{t('nav.logIn')}</Link>
                <Link to="/signup" className="btn btn-secondary hide-mobile">{t('nav.signUp')}</Link>
              </React.Fragment>
            )}
            <button type="button" ref={this.toggleRef} className="btn btn-ghost btn-icon nav-toggle" aria-expanded={mobileOpen} aria-controls="mobile-nav"
              aria-label={mobileOpen ? t('nav.closeMenu') : t('nav.openMenu')} onClick={() => this.toggleMobile()}>
              {mobileOpen ? <X size={22} aria-hidden="true" /> : <MenuIcon size={22} aria-hidden="true" />}
            </button>
          </div>
        </div>
        {mobileOpen ? (
          <nav id="mobile-nav" className="mobile-nav" aria-label={t('nav.mobile')} ref={this.mobileRef}>
            <Link className="menu-item" to="/"><Search size={18} aria-hidden="true" />{t('nav.browseSales')}</Link>
            <Link className="menu-item" to="/newpost"><Plus size={18} aria-hidden="true" />{t('nav.postSale')}</Link>
            <Link className="menu-item" to="/events"><UsersRound size={18} aria-hidden="true" />{t('nav.events')}</Link>
            <Link className="menu-item" to="/wanted"><PackageSearch size={18} aria-hidden="true" />{t('nav.wanted')}
              {this.props.wantedNew ? <span className="nav-badge menu-badge" aria-label={wantedLabel(this.props.wantedNew)}>{badgeText(this.props.wantedNew)}</span> : null}</Link>
            <Link className="menu-item" to="/about"><Info size={18} aria-hidden="true" />{t('nav.about')}</Link>
            <InstallMenuItem />
            <div className="menu-item menu-language"><LanguagePicker id="mobile-language" user={user} /></div>
            <div className="menu-sep" role="separator" />
            {user ? (
              <React.Fragment>
                <Link className="menu-item" to="/messages"><MessageCircle size={18} aria-hidden="true" />{t('nav.messages')}
                  {this.props.unread ? <span className="nav-badge menu-badge" aria-label={unreadLabel(this.props.unread)}>{badgeText(this.props.unread)}</span> : null}</Link>
                <Link className="menu-item" to="/saved"><Star size={18} aria-hidden="true" />{t('nav.savedSales')}</Link>
                <Link className="menu-item" to="/following"><UserCheck size={18} aria-hidden="true" />{t('nav.following')}</Link>
                <Link className="menu-item" to="/dashboard"><LayoutDashboard size={18} aria-hidden="true" />{t('nav.sellerDashboard')}</Link>
                <Link className="menu-item" to="/profile"><User size={18} aria-hidden="true" />{t('nav.profileListings')}</Link>
                <Link className="menu-item" to="/settings"><SettingsIcon size={18} aria-hidden="true" />{t('nav.settings')}</Link>
                {isAdmin ? <Link className="menu-item" to="/admin"><ShieldCheck size={18} aria-hidden="true" />{t('nav.admin')}</Link> : null}
                <Link className="menu-item" to="/logout"><LogOut size={18} aria-hidden="true" />{t('nav.logOut')}</Link>
              </React.Fragment>
            ) : ready ? (
              <React.Fragment>
                <Link className="menu-item" to="/login"><LogIn size={18} aria-hidden="true" />{t('nav.logIn')}</Link>
                <Link className="menu-item" to="/signup"><UserPlus size={18} aria-hidden="true" />{t('nav.signUp')}</Link>
              </React.Fragment>
            ) : null}
          </nav>
        ) : null}
      </header>
    );
  }
}
