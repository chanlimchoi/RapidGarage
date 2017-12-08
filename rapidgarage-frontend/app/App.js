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
    console.log('this.props:', this.props)
    console.log('thisSession', sessionStorage.getItem('loggedIn'))
    console.log('sessionItem', sessionStorage.getItem('userID'))
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
                      <Link to="/NewPost">New Post</Link>
                    </li>
                    <li>
                      <Link to="/Profile">Profile</Link>
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

            <Switch>
              <Route exact path='/' component={PostList} />
              <Route path='/signup' component={SignUp} />
              <Route path='/login' component={Login} />
              <Route path='/newpost' component={NewPost} />
              <Route path='/profile' component={Profile} />
            </Switch>
            </div>
            <Footer />
          <br />
    </div>
    );
  }
}

export default App;
