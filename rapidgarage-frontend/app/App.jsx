import React, { Component, Suspense, lazy } from 'react';
import { Route, Switch, withRouter } from 'react-router-dom';
import { fetchMe, apiFetch, fetchBadges } from './api';
import * as errorReporter from './lib/errorReporter';
import NavBar from './components/NavBar';
import Footer from './components/Footer';
import Toaster from './components/Toaster';
import PwaBanners from './pwa/PwaBanners';
import PostList from './components/PostList';
import NotFound from './components/NotFound';
import Post from './post/Post';
import VerifyBanner from './user/VerifyBanner';
import ReminderBanner from './components/ReminderBanner';
import { SkeletonBlock } from './components/ui';
import * as savedStore from './lib/saved';
import * as i18n from './i18n';
import * as liveClient from './lib/liveClient';

// The app shell (nav, footer, toaster, banners) and the two pages people land
// on first -- the home list and a sale page opened from a shared link or QR
// code -- load eagerly. Every other route is loaded on demand: each import()
// below becomes its own chunk (see vite.config.js), so the first page does not
// pay for the admin console, dashboards, editors and print views. <Suspense>
// shows a skeleton while a chunk loads; repeat visits get the chunks from the
// service worker's precache.
const About = lazy(() => import('./components/About'));
const SafetyPage = lazy(() => import('./safety/SafetyPage'));
const Profile = lazy(() => import('./components/Profile'));
const Login = lazy(() => import('./user/Login'));
const Logout = lazy(() => import('./user/Logout'));
const SignUp = lazy(() => import('./user/SignUp'));
const ForgotPassword = lazy(() => import('./user/ForgotPassword'));
const ResetPassword = lazy(() => import('./user/ResetPassword'));
const VerifyEmail = lazy(() => import('./user/VerifyEmail'));
const NewPost = lazy(() => import('./post/NewPost'));
const EditPost = lazy(() => import('./post/EditPost'));
const Settings = lazy(() => import('./user/Settings'));
const Admin = lazy(() => import('./admin/Admin'));
const Messages = lazy(() => import('./messages/Messages'));
const Unsubscribe = lazy(() => import('./user/Unsubscribe'));
const PrintFlyer = lazy(() => import('./print/PrintFlyer'));
const PersonRatings = lazy(() => import('./ratings/PersonRatings'));
const Saved = lazy(() => import('./saved/Saved'));
const Following = lazy(() => import('./follows/Following'));
const ItemsEditor = lazy(() => import('./post/ItemsEditor'));
const EventsIndex = lazy(() => import('./events/EventsIndex'));
const EventForm = lazy(() => import('./events/EventForm'));
const EventPage = lazy(() => import('./events/EventPage'));
const EventPrint = lazy(() => import('./events/EventPrint'));
const WantedBoard = lazy(() => import('./wanted/WantedBoard'));
const WantedForm = lazy(() => import('./wanted/WantedForm'));
const WantedPage = lazy(() => import('./wanted/WantedPage'));
const Dashboard = lazy(() => import('./dashboard/Dashboard'));
const DashboardSale = lazy(() => import('./dashboard/DashboardSale'));

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
      // New sales matching my wanted posts (same poll).
      wantedNew: 0,
      // Today's morning-of reminders not yet dismissed (ReminderBanner).
      reminders: 0,
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
    // With a live connection the badge refreshes on events; poll every 60 s as a fallback.
    this.ticks = 0;
    this.unreadTimer = setInterval(() => { if (!document.hidden && (!liveClient.isOpen() || ++this.ticks % 4 === 0)) this.refreshUnread(); }, UNREAD_POLL_MS);
    this.offLive = liveClient.on((type) => { if (type === 'badges' || type === 'message') this.refreshUnread(); });
    document.addEventListener('visibilitychange', this.onVisible);
    this.offLocale = i18n.onChange((locale) => this.setState({ locale }));
  }

  componentWillUnmount() {
    clearInterval(this.unreadTimer);
    if (this.offLive) this.offLive();
    liveClient.disconnect();
    document.removeEventListener('visibilitychange', this.onVisible);
    if (this.offLocale) this.offLocale();
  }

  onVisible() {
    if (!document.hidden) this.refreshUnread();
  }

  refreshUnread() {
    if (!this.state.user) {
      if (this.state.unread || this.state.wantedNew || this.state.reminders) this.setState({ unread: 0, wantedNew: 0, reminders: 0 });
      return Promise.resolve();
    }
    return fetchBadges().then((b) => {
      if (b && (b.count !== this.state.unread || b.wantedMatches !== this.state.wantedNew || b.reminders !== this.state.reminders)) this.setState({ unread: b.count, wantedNew: b.wantedMatches, reminders: b.reminders });
    });
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
      .then(({ ok, data }) => {
        if (!ok || !data) return;
        this.setState({ config: data });
        // Crash reports only when the server tracks errors (lib/errorReporter).
        if (data.errorReporting) errorReporter.enable();
      })
      .catch(() => {});
  }

  refreshUser() {
    return fetchMe().then((user) => {
      savedStore.setUser(user);
      if (user) liveClient.connect(); else liveClient.disconnect();
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
        <NavBar user={user} ready={ready} unread={this.state.unread} wantedNew={this.state.wantedNew} location={this.props.location} />
        <main id="main" className="app-main" tabIndex="-1">
          {user && config.emailVerification && !user.emailVerifiedAt && !/^\/verify-email/.test(this.props.location.pathname) ? <VerifyBanner user={user} onVerified={this.refreshUser} /> : null}
          {user && !/^\/(alerts|admin)/.test(this.props.location.pathname) ? <ReminderBanner userId={user.id} count={this.state.reminders} onChange={this.refreshUnread} /> : null}
          <Suspense fallback={<SkeletonBlock lines={5} />}>
            <Switch>
              <Route exact path='/' render={(props) => <PostList {...props} {...common} config={config} />} />
              <Route path='/about' component={About} />
              <Route path='/safety' component={SafetyPage} />
              <Route path='/admin' render={(props) => <Admin {...props} {...common} onAuthChange={this.refreshUser} onConfigChange={this.refreshConfig} />} />
              <Route path='/settings' render={(props) => <Settings {...props} {...common} config={config} onAuthChange={this.refreshUser} />} />
              <Route path='/signup' render={(props) => <SignUp {...props} onAuthChange={this.refreshUser} />} />
              <Route path='/login' render={(props) => <Login {...props} onAuthChange={this.refreshUser} />} />
              <Route path='/forgot-password' component={ForgotPassword} />
              <Route path='/verify-email' render={(props) => <VerifyEmail {...props} onAuthChange={this.refreshUser} />} />
              <Route path='/reset-password' render={(props) => <ResetPassword {...props} onAuthChange={this.refreshUser} />} />
              <Route path='/logout' render={(props) => <Logout {...props} onAuthChange={this.refreshUser} />} />
              <Route path='/newpost' render={(props) => <NewPost {...props} {...common} />} />
              <Route path='/post/:id/print' render={(props) => <PrintFlyer {...props} {...common} />} />
              <Route path='/post/:id/items' render={(props) => <ItemsEditor {...props} {...common} config={config} />} />
              <Route path='/post/:id/edit' render={(props) => <EditPost {...props} {...common} config={config} />} />
              <Route path='/post/:id' render={(props) => <Post {...props} {...common} />} />
              <Route exact path='/dashboard' render={(props) => <Dashboard {...props} {...common} />} />
              <Route path='/dashboard/sales/:id' render={(props) => <DashboardSale {...props} {...common} />} />
              <Route exact path='/events' render={(props) => <EventsIndex {...props} {...common} />} />
              <Route path='/events/new' render={(props) => <EventForm key={props.match.params.id || 'new'} {...props} {...common} />} />
              <Route path='/events/:id/edit' render={(props) => <EventForm key={props.match.params.id || 'new'} {...props} {...common} />} />
              <Route path='/events/:id/print' render={(props) => <EventPrint {...props} {...common} />} />
              <Route path='/events/:id' render={(props) => <EventPage {...props} {...common} />} />
              <Route exact path='/wanted' render={(props) => <WantedBoard {...props} {...common} />} />
              <Route path='/wanted/new' render={(props) => <WantedForm key='new' {...props} {...common} />} />
              <Route path='/wanted/:id/edit' render={(props) => <WantedForm key={props.match.params.id} {...props} {...common} />} />
              <Route path='/wanted/:id' render={(props) => <WantedPage {...props} {...common} onSeen={this.refreshUnread} />} />
              <Route path='/messages/:id?' render={(props) => <Messages {...props} {...common} onUnreadChange={this.refreshUnread} />} />
              <Route path='/alerts/unsubscribe' component={Unsubscribe} />
              <Route path='/following' render={(props) => <Following {...props} {...common} />} />
              <Route path='/saved' render={(props) => <Saved {...props} {...common} config={config} />} />
              <Route path='/people/:id' render={(props) => <PersonRatings {...props} {...common} />} />
              <Route path='/profile' render={(props) => <Profile {...props} {...common} />} />
              <Route component={NotFound} />
            </Switch>
          </Suspense>
        </main>
        <Footer />
        <PwaBanners offerInstall={!/^\/(login|signup|logout|forgot-password|reset-password|verify-email|alerts|admin|settings)/.test(this.props.location.pathname)} />
        <Toaster />
      </div>
    );
  }
}

export default withRouter(App);
