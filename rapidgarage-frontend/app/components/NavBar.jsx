import React from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Store, Plus, Menu as MenuIcon, X, ChevronDown, User, Settings as SettingsIcon, ShieldCheck, LogOut, LogIn, UserPlus, Search, Info, MessageCircle, Star } from 'lucide-react';
import { initials, displayName } from '../lib/format';

const badgeText = (n) => (n > 99 ? '99+' : String(n));
const unreadLabel = (n) => n + ' unread message' + (n === 1 ? '' : 's');

// Sticky top bar. Signed out: Log in / Sign up. Signed in: a user menu with
// Profile, Settings, Admin (admins only) and Log out.
export default class NavBar extends React.Component {
  constructor(props) {
    super(props);
    this.state = { menuOpen: false, mobileOpen: false };
    this.menuRef = React.createRef();
    this.triggerRef = React.createRef();
    this.onDocClick = this.onDocClick.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
  }

  componentDidMount() {
    document.addEventListener('mousedown', this.onDocClick);
    document.addEventListener('keydown', this.onKeyDown);
  }

  componentWillUnmount() {
    document.removeEventListener('mousedown', this.onDocClick);
    document.removeEventListener('keydown', this.onKeyDown);
  }

  componentDidUpdate(prev) {
    if (prev.location.pathname !== this.props.location.pathname && (this.state.menuOpen || this.state.mobileOpen)) {
      this.setState({ menuOpen: false, mobileOpen: false });
    }
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
    if (this.state.mobileOpen) this.setState({ mobileOpen: false });
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
  onMenuKey(e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.prototype.slice.call(this.menuRef.current.querySelectorAll('[role="menuitem"]'));
    const i = items.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next].focus();
  }

  renderUserMenu(user, isAdmin) {
    const close = () => this.setState({ menuOpen: false });
    const unread = this.props.unread || 0;
    return (
      <div className="menu user-menu" ref={this.menuRef}>
        <button type="button" className="menu-trigger" ref={this.triggerRef} aria-haspopup="menu" aria-expanded={this.state.menuOpen}
          aria-label={'Account menu for ' + displayName(user) + (unread ? ', ' + unreadLabel(unread) : '')} onClick={() => this.toggleMenu()}>
          <span className="avatar-wrap" aria-hidden="true">
            <span className="avatar">{initials(user)}</span>
            {unread ? <span className="nav-badge avatar-badge">{badgeText(unread)}</span> : null}
          </span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        {this.state.menuOpen ? (
          <div className="menu-panel" role="menu" aria-label="Account" onKeyDown={(e) => this.onMenuKey(e)}>
            <div className="menu-header">
              <strong>{displayName(user)}</strong>
              <span>{user.email}</span>
            </div>
            <Link role="menuitem" className="menu-item" to="/messages" onClick={close}><MessageCircle size={18} aria-hidden="true" />Messages
              {unread ? <span className="nav-badge menu-badge" aria-label={unreadLabel(unread)}>{badgeText(unread)}</span> : null}</Link>
            <Link role="menuitem" className="menu-item" to="/saved" onClick={close}><Star size={18} aria-hidden="true" />Saved sales</Link>
            <Link role="menuitem" className="menu-item" to="/profile" onClick={close}><User size={18} aria-hidden="true" />Profile &amp; listings</Link>
            <Link role="menuitem" className="menu-item" to="/settings" onClick={close}><SettingsIcon size={18} aria-hidden="true" />Settings</Link>
            {isAdmin ? <Link role="menuitem" className="menu-item" to="/admin" onClick={close}><ShieldCheck size={18} aria-hidden="true" />Admin</Link> : null}
            <div className="menu-sep" role="separator" />
            <Link role="menuitem" className="menu-item" to="/logout" onClick={close}><LogOut size={18} aria-hidden="true" />Log out</Link>
          </div>
        ) : null}
      </div>
    );
  }

  render() {
    const { user, ready } = this.props;
    const isAdmin = !!(user && user.role === 'admin');
    const mobileOpen = this.state.mobileOpen;
    return (
      <header className="nav">
        <a className="skip-link" href="#main">Skip to content</a>
        <div className="nav-inner">
          <Link to="/" className="brand" aria-label="RapidGarage home">
            <span className="brand-mark" aria-hidden="true"><Store size={18} /></span>
            RapidGarage
          </Link>
          <nav className="nav-links" aria-label="Main">
            <NavLink exact to="/" className="nav-link" activeClassName="active"><Search size={16} aria-hidden="true" />Browse</NavLink>
            {user ? (
              <NavLink to="/messages" className="nav-link nav-messages" activeClassName="active">
                <MessageCircle size={16} aria-hidden="true" />Messages
                {this.props.unread ? <span className="nav-badge" aria-label={unreadLabel(this.props.unread)}>{badgeText(this.props.unread)}</span> : null}
              </NavLink>
            ) : null}
            {user ? <NavLink to="/saved" className="nav-link nav-saved" activeClassName="active"><Star size={16} aria-hidden="true" />Saved</NavLink> : null}
            <NavLink to="/about" className="nav-link" activeClassName="active">About</NavLink>
          </nav>
          <div className="nav-spacer" />
          <div className="nav-actions">
            <Link to="/newpost" className="btn btn-primary hide-mobile"><Plus size={16} aria-hidden="true" />Post a sale</Link>
            <Link to="/newpost" className="btn btn-primary btn-icon show-mobile" aria-label="Post a sale"><Plus size={20} aria-hidden="true" /></Link>
            {!ready ? null : user ? this.renderUserMenu(user, isAdmin) : (
              <React.Fragment>
                <Link to="/login" className="btn btn-ghost hide-mobile">Log in</Link>
                <Link to="/signup" className="btn btn-secondary hide-mobile">Sign up</Link>
              </React.Fragment>
            )}
            <button type="button" className="btn btn-ghost btn-icon nav-toggle" aria-expanded={mobileOpen} aria-controls="mobile-nav"
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'} onClick={() => this.setState({ mobileOpen: !mobileOpen })}>
              {mobileOpen ? <X size={22} aria-hidden="true" /> : <MenuIcon size={22} aria-hidden="true" />}
            </button>
          </div>
        </div>
        {mobileOpen ? (
          <nav id="mobile-nav" className="mobile-nav" aria-label="Mobile">
            <Link className="menu-item" to="/"><Search size={18} aria-hidden="true" />Browse sales</Link>
            <Link className="menu-item" to="/newpost"><Plus size={18} aria-hidden="true" />Post a sale</Link>
            <Link className="menu-item" to="/about"><Info size={18} aria-hidden="true" />About</Link>
            <div className="menu-sep" role="separator" />
            {user ? (
              <React.Fragment>
                <Link className="menu-item" to="/messages"><MessageCircle size={18} aria-hidden="true" />Messages
                  {this.props.unread ? <span className="nav-badge menu-badge" aria-label={unreadLabel(this.props.unread)}>{badgeText(this.props.unread)}</span> : null}</Link>
                <Link className="menu-item" to="/saved"><Star size={18} aria-hidden="true" />Saved sales</Link>
                <Link className="menu-item" to="/profile"><User size={18} aria-hidden="true" />Profile &amp; listings</Link>
                <Link className="menu-item" to="/settings"><SettingsIcon size={18} aria-hidden="true" />Settings</Link>
                {isAdmin ? <Link className="menu-item" to="/admin"><ShieldCheck size={18} aria-hidden="true" />Admin</Link> : null}
                <Link className="menu-item" to="/logout"><LogOut size={18} aria-hidden="true" />Log out</Link>
              </React.Fragment>
            ) : ready ? (
              <React.Fragment>
                <Link className="menu-item" to="/login"><LogIn size={18} aria-hidden="true" />Log in</Link>
                <Link className="menu-item" to="/signup"><UserPlus size={18} aria-hidden="true" />Sign up</Link>
              </React.Fragment>
            ) : null}
          </nav>
        ) : null}
      </header>
    );
  }
}
