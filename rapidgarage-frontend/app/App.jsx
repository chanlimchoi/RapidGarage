import React, {Component } from 'react';
import {Route, Switch, Link, withRouter} from 'react-router-dom'
import { fetchMe } from './api';
import Profile from './components/Profile';
import Footer from './components/Footer';
import PostList from './components/PostList';
import Post from './post/Post';
import Login from './user/Login';
import Logout from './user/Logout';
import SignUp from './user/SignUp';
import NewPost from './post/NewPost';
import Settings from './user/Settings';
import Admin from './admin/Admin';
import { apiFetch } from './api';

class App extends Component {
  constructor(props) {
      super(props);
      this.state = {
        message: '',
        // The server (GET /me) is the source of truth for who is logged in.
        user: null,
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

  refreshConfig() {
    return apiFetch('/config')
      .then(({ ok, data }) => { if (ok && data) this.setState({ config: data }); })
      .catch(() => {});
  }

  componentDidUpdate(prevProps) {
    // Re-check on navigation so the nav never goes stale.
    if (prevProps.location.pathname !== this.props.location.pathname) {
      this.refreshUser();
      this.refreshConfig();
    }
  }

  refreshUser() {
    return fetchMe().then((user) => this.setState({ user }));
  }


 
  render() {
    const user = this.state.user;
    let button = null;
    if (user) {
     button = <li><Link to="/logout"><span className="glyphicon glyphicon-log-in"></span>Logout</Link></li>;
    } else {
       button = <li><Link to="/login"><span className="glyphicon glyphicon-log-in"></span>Login</Link></li>;
    }
    return (
      <div>
        <div>
            <h1> RapidGarage</h1>
              <nav className = "navbar navbar-inverse">
              <div className="container-fluid">
                <div className="collapse navbar-collapse" id="myNavbar">
                  <ul className="nav navbar-nav">
                    <li>
                      <Link to="/">Home</Link>
                    </li>
                    <li>
                      <Link to="/about">About</Link>                 
                    </li>
                    <li>
                      <Link to="/newpost">New Post</Link>
                    </li>
                    <li>
                      <Link to="/profile">Profile</Link>
                    </li>
                    { user ? <li><Link to="/settings">Settings</Link></li> : null }
                    { user && user.role === 'admin' ? <li><Link to="/admin">Admin</Link></li> : null }
                  </ul>
                 
                   

            <ul className="nav navbar-nav navbar-right">
            <li><Link to="/signup"><span className="glyphicon glyphicon-user"></span>Signup</Link></li>
             </ul>
                
                    <ul className="nav navbar-nav navbar-right">
            {button}
             </ul>
                    
                </div>
            </div>
            </nav>

            <Switch>
              <Route exact path='/' render={(props) => <PostList {...props} user={user} config={this.state.config} />} />
              <Route path='/admin' render={(props) => <Admin {...props} user={user} onAuthChange={this.refreshUser} onConfigChange={this.refreshConfig} />} />
              <Route path='/settings' render={(props) => <Settings {...props} user={user} config={this.state.config} onAuthChange={this.refreshUser} />} />
              <Route path='/signup' render={(props) => <SignUp {...props} onAuthChange={this.refreshUser} />} />
              <Route path='/login' render={(props) => <Login {...props} onAuthChange={this.refreshUser} />} />
              <Route path='/logout' render={(props) => <Logout {...props} onAuthChange={this.refreshUser} />} />
              <Route path='/newpost' render={(props) => <NewPost {...props} user={user} />} />
              <Route path='/profile' render={(props) => <Profile {...props} user={user} />} />
            </Switch>
            </div>
            <Footer />
          <br />
    </div>
    );
  }
}

export default withRouter(App);
