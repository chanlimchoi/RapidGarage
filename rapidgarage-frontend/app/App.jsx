import React, { Component } from 'react';
import { Route, Switch, withRouter } from 'react-router-dom';
import { fetchMe, apiFetch } from './api';
import NavBar from './components/NavBar';
import Footer from './components/Footer';
import Toaster from './components/Toaster';
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

class App extends Component {
  constructor(props) {
    super(props);
    this.state = {
      // The server (GET /me) is the source of truth for who is logged in.
      user: null,
      // false until the first /me answer, so the nav doesn't flash "Log in".
      ready: false,
      // Public server config: { googleLogin, userMapsKeys }.
      config: { googleLogin: false, userMapsKeys: true },
    };
    this.refreshUser = this.refreshUser.bind(this);
    this.refreshConfig = this.refreshConfig.bind(this);
  }

  componentDidMount() {
    this.refreshUser();
    this.refreshConfig();
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
    return fetchMe().then((user) => this.setState({ user, ready: true }));
  }

  render() {
    const { user, ready, config } = this.state;
    const common = { user, ready };
    return (
      <div className="app">
        <NavBar user={user} ready={ready} location={this.props.location} />
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
            <Route path='/post/:id/edit' render={(props) => <EditPost {...props} {...common} />} />
            <Route path='/post/:id' render={(props) => <Post {...props} {...common} />} />
            <Route path='/profile' render={(props) => <Profile {...props} {...common} />} />
            <Route component={NotFound} />
          </Switch>
        </main>
        <Footer />
        <Toaster />
      </div>
    );
  }
}

export default withRouter(App);
