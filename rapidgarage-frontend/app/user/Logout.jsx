import React from 'react';
import { Redirect } from 'react-router';
import { apiFetch } from '../api';

export default class Logout extends React.Component{
  constructor(props) {
    super(props);
    this.state = { done: false };
  }

  componentDidMount() {
    // Wait for the server to destroy the session before leaving, so the nav
    // (which asks /me) never shows a stale "Logout" link.
    apiFetch('/logout', { method: 'POST' })
      .catch(() => {})
      .then(() => {
        if (this.props.onAuthChange) this.props.onAuthChange();
        this.setState({ done: true });
      });
  }

  render() {
    return this.state.done ? <Redirect to="/"/> : <p>Logging out…</p>;
  }
}
