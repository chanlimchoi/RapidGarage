import React, { Component } from 'react';
import { Route, Switch, withRouter } from 'react-router-dom';
import { fetchMe, apiFetch, fetchUnreadCount } from './api';
import NavBar from './components/NavBar';
import Footer from './components/Footer';
import Toaster from './components/Toaster';
import PwaBanners from './pwa/PwaBanners';
import Profile from './components/Profile';
import PostList from './components/PostList';
import About from './components/About';
import NotFound from './components/NotFound';
import Post from './post/Post';
import Login from './user/Login';
import Logout from './user/Logout';
import SignUp from './user/SignUp';
import NewPost from './post/NewPost';
import EditPost from './post/EditPost';
import Settings from './user/Settings';
import Admin from './admin/Admin';
import Messages from './messages/Messages';
import Unsubscribe from './user/Unsubscribe';
import PrintFlyer from './print/PrintFlyer';
import PersonRatings from './ratings/PersonRatings';
import Saved from './saved/Saved';
import ItemsEditor from './post/ItemsEditor';
import EventsIndex from './events/EventsIndex';
import EventForm from './events/EventForm';
import EventPage from './events/EventPage';
import EventPrint from './events/EventPrint';
import * as savedStore from './lib/saved';
import * as i18n from './i18n';

const UNREAD_POLL_MS = 15000;

class App extends Component {
  constructor(props) {
    super(props);
    this.state = {
      // The server (GET /me) is the source of truth for who is logged in.
      user: null,
      // false until the first /me answer, so the nav doesn't flash "Log in".
      ready: false,
      // Public server config: { googleLogin, userMapsKeys, saleAlerts }.
      config: { googleLogin: false, userMapsKeys: true, saleAlerts: true },
      // Unread messages, for the nav badge (polled while logged in).
      unread: 0,
      // Changing it re-mounts the page so every component re-renders its text.
      locale: i18n.locale(),
    };
    this.refreshUnread = this.refreshUnread.bind(this);
    this.onVisible = this.onVisible.bind(this);
    this.refreshUser = this.refreshUser.bind(this);
    this.refreshConfig = this.refreshConfig.bind(this);
  }

  componentDidMount() {
    this.refreshUser();
    this.refreshConfig();
    this.unreadTimer = setInterval(() => { if (!document.hidden) this.refreshUnread(); }, UNREAD_POLL_MS);
    document.addEventListener('visibilitychange', this.onVisible);
    this.offLocale = i18n.onChange((locale) => this.setState({ locale }));
  }

  componentWillUnmount() {
    clearInterval(this.unreadTimer);
    document.removeEventListener('visibilitychange', this.onVisible);
    if (this.offLocale) this.offLocale();
  }

  onVisible() {
    if (!document.hidden) this.refreshUnread();
  }

  refreshUnread() {
    if (!this.state.user) {
      if (this.state.unread) this.setState({ unread: 0 });
      return Promise.resolve();
    }
    return fetchUnreadCount().then((n) => { if (n !== null && n !== this.state.unread) this.setState({ unread: n }); });
  }

  componentDidUpdate(prevProps) {
    // Re-check on navigation so the nav never goes stale.
    if (prevProps.location.pathname !== this.props.location.pathname) {
      this.refreshUser();
      this.refreshConfig();
      window.scrollTo(0, 0);
    }
  }

  refreshConfig() {
    return apiFetch('/config')
      .then(({ ok, data }) => { if (ok && data) this.setState({ config: data }); })
      .catch(() => {});
  }

  refreshUser() {
    return fetchMe().then((user) => {
      savedStore.setUser(user);
      this.syncLocale(user);
      this.setState({ user, ready: true }, this.refreshUnread);
    });
  }

  // Choosing a language always saves it to the account, so when logged in the
  // account's language wins (it follows you to new devices). Accounts from
  // before languages existed get this device's language.
  // Only once per login, so a language picked a moment ago is never undone by
  // a /me answer that raced the save.
  syncLocale(user) {
    if (!user) { this.localeSyncedFor = null; return; }
    if (this.localeSyncedFor === user.id) return;
    this.localeSyncedFor = user.id;
    if (user.locale && user.locale !== i18n.locale()) i18n.setLocale(user.locale).catch(() => null);
    else if (!user.locale) apiFetch('/me/locale', { method: 'PUT', body: JSON.stringify({ locale: i18n.locale() }) }).catch(() => null);
  }

  render() {
    const { user, ready, config } = this.state;
    const common = { user, ready };
    return (
      <div className="app" key={this.state.locale}>
        <NavBar user={user} ready={ready} unread={this.state.unread} location={this.props.location} />
        <main id="main" className="app-main" tabIndex="-1">
          <Switch>
            <Route exact path='/' render={(props) => <PostList {...props} {...common} config={config} />} />
            <Route path='/about' component={About} />
            <Route path='/admin' render={(props) => <Admin {...props} {...common} onAuthChange={this.refreshUser} onConfigChange={this.refreshConfig} />} />
            <Route path='/settings' render={(props) => <Settings {...props} {...common} config={config} onAuthChange={this.refreshUser} />} />
            <Route path='/signup' render={(props) => <SignUp {...props} onAuthChange={this.refreshUser} />} />
            <Route path='/login' render={(props) => <Login {...props} onAuthChange={this.refreshUser} />} />
            <Route path='/logout' render={(props) => <Logout {...props} onAuthChange={this.refreshUser} />} />
            <Route path='/newpost' render={(props) => <NewPost {...props} {...common} />} />
            <Route path='/post/:id/print' render={(props) => <PrintFlyer {...props} {...common} />} />
            <Route path='/post/:id/items' render={(props) => <ItemsEditor {...props} {...common} />} />
            <Route path='/post/:id/edit' render={(props) => <EditPost {...props} {...common} />} />
            <Route path='/post/:id' render={(props) => <Post {...props} {...common} />} />
            <Route exact path='/events' render={(props) => <EventsIndex {...props} {...common} />} />
            <Route path='/events/new' render={(props) => <EventForm key={props.match.params.id || 'new'} {...props} {...common} />} />
            <Route path='/events/:id/edit' render={(props) => <EventForm key={props.match.params.id || 'new'} {...props} {...common} />} />
            <Route path='/events/:id/print' render={(props) => <EventPrint {...props} {...common} />} />
            <Route path='/events/:id' render={(props) => <EventPage {...props} {...common} />} />
            <Route path='/messages/:id?' render={(props) => <Messages {...props} {...common} onUnreadChange={this.refreshUnread} />} />
            <Route path='/alerts/unsubscribe' component={Unsubscribe} />
            <Route path='/saved' render={(props) => <Saved {...props} {...common} config={config} />} />
            <Route path='/people/:id' render={(props) => <PersonRatings {...props} {...common} />} />
            <Route path='/profile' render={(props) => <Profile {...props} {...common} />} />
            <Route component={NotFound} />
          </Switch>
        </main>
        <Footer />
        <PwaBanners offerInstall={!/^\/(login|signup|logout|alerts|admin|settings)/.test(this.props.location.pathname)} />
        <Toaster />
      </div>
    );
  }
}

export default withRouter(App);
