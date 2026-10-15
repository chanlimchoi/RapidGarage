import React from 'react';
import { Redirect } from 'react-router';




export default class Logout extends React.Component{
  constructor(props) {
    super(props);
    this.state = {
    };
  }

  componentDidMount() {
    // Ask the server to destroy the session, then clear the client state.
    fetch('/api/logout', { method: 'POST' })
      .catch(() => {})
      .then(() => {
        sessionStorage.removeItem('loggedIn');
        sessionStorage.removeItem('userID');
      });
  }

  render() {

       return <Redirect to="../"/>;
  }

}
