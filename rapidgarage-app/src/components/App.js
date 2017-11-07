import React, {Component } from 'react';
import Header from './Header';
import Footer from './Footer';
import Profile from './Profile';
import Posts from './Posts';

class App extends Component {

  render() {
    return (
      <div>
        <Header />
        <div className="container-fluid">
          <div className="row">
          <Posts />
          <Profile />
        </div>
        </div>
        <Footer />
      </div>
    );
  }
}

export default App;
