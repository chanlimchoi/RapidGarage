import React from 'react';
import { Navigate } from 'react-router-dom';
import { apiFetch } from '../api';
import { Spinner } from '../components/ui';
import toast from '../components/toast';
import { t } from '../i18n';

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
        toast.info(t('logout.done'));
        this.setState({ done: true });
      });
  }

  render() {
    return this.state.done ? <Navigate replace to="/" /> : <div className="container container-narrow"><p className="row muted"><Spinner />{t('logout.working')}</p></div>;
  }
}
