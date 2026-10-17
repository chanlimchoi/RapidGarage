import React from 'react';
import { Redirect } from 'react-router';
import { apiFetch } from '../api';
import { Spinner } from '../components/ui';
import toast from '../components/toast';

export default class Logout extends React.Component {
  constructor(props) {
    super(props);
    this.state = { done: false };
  }

  componentDidMount() {
    // Wait for the server to destroy the session before leaving, so the nav
    // (which asks /me) never shows a stale user menu.
    apiFetch('/logout', { method: 'POST' })
      .catch(() => {})
      .then(() => {
        if (this.props.onAuthChange) this.props.onAuthChange();
        toast.info('You have been logged out.');
        this.setState({ done: true });
      });
  }

  render() {
    return this.state.done ? <Redirect to="/" /> : <div className="container container-narrow"><p className="row muted"><Spinner />Logging out…</p></div>;
  }
}
