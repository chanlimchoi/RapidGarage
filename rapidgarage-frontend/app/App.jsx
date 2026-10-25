import React, { Component, Suspense, lazy } from 'react';
import { Routes, Route, useParams } from 'react-router-dom';
import { withRouterProps } from './lib/router';
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
import * as activity from './lib/activity';

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
const Notifications = lazy(() => import('./notifications/Notifications'));
const RoutePlanner = lazy(() => import('./route/RoutePlanner'));
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

// Route elements need the router props RR4's render-prop used to pass
// (match/location/history) plus the App-level values (common/user/ready, config,
// and the refresh callbacks). The values come from this context so the route
// table stays declarative; the router props come from withRouterProps below.
const AppCtx = React.createContext(null);

// Renders one routed component with the App-level values RR4's render-prop used
// to spread in (common/user/ready + config) and the router props (match,
// location, history) via withRouterProps. `keyParam` names a param ('id') that
// remounts the component when it changes, replacing RR4's key={props.match...}
// (so switching /events/new <-> /events/:id/edit does not reuse form state).
const RoutedInner = ({ component: Inner, keyParam, ...rest }) => {
  const ctx = React.useContext(AppCtx) || {};
  const params = useParams();
  const WithRouter = withRouterProps(Inner);
  return (
    <WithRouter
      key={keyParam ? params[keyParam] || 'new' : undefined}
      {...rest}
      {...(ctx.common || {})}
      config={ctx.config}
    />
  );
};

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
      // New saved-search matches etc. (the bell).
      notifications: 0,
      // Changing it re-mounts the page so every component re-renders its text.
      locale: i18n.locale(),
    };
    this.refreshUnread = this.refreshUnread.bind(this);
    this.onVisible = this.onVisible.bind(this);
    this.refreshUser = this.refreshUser.bind(this);
    this.refreshConfig = this.refreshConfig.bind(this);
  }

  componentDidMount() {
    activity.trackPage(this.props.location.pathname, this.props.location.search);
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
      if (this.state.unread || this.state.wantedNew || this.state.reminders || this.state.notifications) this.setState({ unread: 0, wantedNew: 0, reminders: 0, notifications: 0 });
      return Promise.resolve();
    }
    return fetchBadges().then((b) => {
      if (b && (b.count !== this.state.unread || b.wantedMatches !== this.state.wantedNew || b.reminders !== this.state.reminders || b.notifications !== this.state.notifications)) {
        this.setState({ unread: b.count, wantedNew: b.wantedMatches, reminders: b.reminders, notifications: b.notifications });
      }
    });
  }

  componentDidUpdate(prevProps) {
    // Re-check on navigation so the nav never goes stale.
    if (prevProps.location.pathname !== this.props.location.pathname) {
      activity.trackPage(this.props.location.pathname, this.props.location.search);
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
        <NavBar user={user} ready={ready} unread={this.state.unread} wantedNew={this.state.wantedNew} notifications={this.state.notifications} location={this.props.location} />
        <main id="main" className="app-main" tabIndex="-1">
          {user && config.emailVerification && !user.emailVerifiedAt && !/^\/verify-email/.test(this.props.location.pathname) ? <VerifyBanner user={user} onVerified={this.refreshUser} /> : null}
          {user && !/^\/(alerts|admin)/.test(this.props.location.pathname) ? <ReminderBanner userId={user.id} count={this.state.reminders} onChange={this.refreshUnread} /> : null}
          <Suspense fallback={<SkeletonBlock lines={5} />}>
            <AppCtx.Provider value={{ common, config, refreshUser: this.refreshUser, refreshConfig: this.refreshConfig, refreshUnread: this.refreshUnread }}>
              <Routes>
                <Route path='/' element={<RoutedInner component={PostList} />} />
                <Route path='/about' element={<RoutedInner component={About} />} />
                <Route path='/safety' element={<RoutedInner component={SafetyPage} />} />
                <Route path='/admin' element={<RoutedInner component={Admin} onAuthChange={this.refreshUser} onConfigChange={this.refreshConfig} />} />
                <Route path='/settings' element={<RoutedInner component={Settings} onAuthChange={this.refreshUser} />} />
                <Route path='/signup' element={<RoutedInner component={SignUp} onAuthChange={this.refreshUser} />} />
                <Route path='/login' element={<RoutedInner component={Login} onAuthChange={this.refreshUser} />} />
                <Route path='/forgot-password' element={<RoutedInner component={ForgotPassword} />} />
                <Route path='/verify-email' element={<RoutedInner component={VerifyEmail} onAuthChange={this.refreshUser} />} />
                <Route path='/reset-password' element={<RoutedInner component={ResetPassword} onAuthChange={this.refreshUser} />} />
                <Route path='/logout' element={<RoutedInner component={Logout} onAuthChange={this.refreshUser} />} />
                <Route path='/newpost' element={<RoutedInner component={NewPost} />} />
                <Route path='/post/:id/print' element={<RoutedInner component={PrintFlyer} />} />
                <Route path='/post/:id/items' element={<RoutedInner component={ItemsEditor} />} />
                <Route path='/post/:id/edit' element={<RoutedInner component={EditPost} />} />
                <Route path='/post/:id' element={<RoutedInner component={Post} />} />
                <Route path='/dashboard' element={<RoutedInner component={Dashboard} />} />
                <Route path='/dashboard/sales/:id' element={<RoutedInner component={DashboardSale} />} />
                <Route path='/events' element={<RoutedInner component={EventsIndex} />} />
                <Route path='/events/new' element={<RoutedInner component={EventForm} keyParam='id' />} />
                <Route path='/events/:id/edit' element={<RoutedInner component={EventForm} keyParam='id' />} />
                <Route path='/events/:id/print' element={<RoutedInner component={EventPrint} />} />
                <Route path='/events/:id' element={<RoutedInner component={EventPage} />} />
                <Route path='/wanted' element={<RoutedInner component={WantedBoard} />} />
                <Route path='/wanted/new' element={<RoutedInner component={WantedForm} keyParam='id' />} />
                <Route path='/wanted/:id/edit' element={<RoutedInner component={WantedForm} keyParam='id' />} />
                <Route path='/wanted/:id' element={<RoutedInner component={WantedPage} onSeen={this.refreshUnread} />} />
                <Route path='/messages/:id?' element={<RoutedInner component={Messages} onUnreadChange={this.refreshUnread} />} />
                <Route path='/alerts/unsubscribe' element={<RoutedInner component={Unsubscribe} />} />
                <Route path='/following' element={<RoutedInner component={Following} />} />
                <Route path='/saved' element={<RoutedInner component={Saved} />} />
                <Route path='/favorites' element={<RoutedInner component={Saved} />} />
                <Route path='/favorites/sellers' element={<RoutedInner component={Following} />} />
                <Route path='/route' element={<RoutedInner component={RoutePlanner} />} />
                <Route path='/notifications' element={<RoutedInner component={Notifications} onSeen={this.refreshUnread} />} />
                <Route path='/people/:id' element={<RoutedInner component={PersonRatings} />} />
                <Route path='/profile' element={<RoutedInner component={Profile} />} />
                <Route path='*' element={<RoutedInner component={NotFound} />} />
              </Routes>
            </AppCtx.Provider>
          </Suspense>
        </main>
        <Footer />
        <PwaBanners offerInstall={!/^\/(login|signup|logout|forgot-password|reset-password|verify-email|alerts|admin|settings)/.test(this.props.location.pathname)} />
        <Toaster />
      </div>
    );
  }
}

export default withRouterProps(App);
