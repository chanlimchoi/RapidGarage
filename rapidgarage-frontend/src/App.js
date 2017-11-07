import React, {Component } from 'react';
import Header from './components/Header';
import Footer from './components/Footer';
import Profile from './components/Profile';
import PostList from './components/PostList';
import Post from './post/Post';
import Login from './user/Login';
import SignUp from './user/SignUp';


class App extends Component {

  render() {
    return (
      <div>
        <Header />
        <div className="container-fluid">
          <div className="row">
            <SignUp />
        </div>
        </div>
        <Footer />
      </div>
    );
  }
}

export default App;
