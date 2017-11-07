import React, {Component } from 'react';
import Header from './components/Header';
import Footer from './components/Footer';
import Profile from './components/Profile';
import PostList from './components/PostList';
import Post from './post/Post';

class App extends Component {

  render() {
    return (
      <div>
        <Header />
        <div className="container-fluid">
          <div className="row">
          <PostList />
          <Profile />
        </div>
        </div>
        <Footer />
      </div>
    );
  }
}

export default App;
