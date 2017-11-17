import React, {Component } from 'react';
import {BrowserRouter, Route, Switch, Redirect, Link} from 'react-router-dom'
import Profile from './components/Profile';
import Footer from './components/Footer';
import PostList from './components/PostList';
import Post from './post/Post';
import Login from './user/Login';
import SignUp from './user/SignUp';
import NewPost from './post/NewPost';

class App extends Component {
  render() {
    return (
      <div>
        <div>
            <h1>RapidGarage</h1>
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
                      <Link to="/NewPost">New Post</Link>
                    </li>
                  </ul>
                  <ul className="nav navbar-nav navbar-right">
                    <li>
                      <Link to="/login"><span className="glyphicon glyphicon-log-in"></span>Login</Link>
                    </li>
                    <li>
                      <Link to="/signup"><span className="glyphicon glyphicon-user"></span>Signup</Link>
                    </li>
                    </ul>
                </div>
            </div>
            </nav>
            <div className="container-fluid">
            <div className="row content">
            <Switch>
              <Route exact path='/' component={PostList} />
              <Route path='/signup' component={SignUp} />
              <Route path='/login' component={Login} />
              <Route path='/newpost' component={NewPost} />
            </Switch>
            <Profile />
            <Link to="/newpost"><button type="submit" className="btn btn-info">Create Post</button></Link>
            </div>
            </div>
            </div>
          <br />
        <Footer />
    </div>
    );
  }
}

export default App;
