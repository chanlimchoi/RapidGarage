import React from 'react';
import { Redirect } from 'react-router';
import { Link, withRouter } from "react-router-dom";
import { errorMessage } from '../api';



export default class Login extends React.Component{
  constructor(props) {
    super(props);
    this.state = {
      redirectToNewPage: false,
      currentUser: '',
      error: '',
      google: false,
    };

    this.handleSubmit = this.handleSubmit.bind(this);
  }

  componentDidMount() {
    // Show "Sign in with Google" only if the server has it configured.
    fetch('/api/auth/providers', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((p) => this.setState({ google: !!(p && p.google) }))
      .catch(() => {});
    const m = /[?&]googleError=([^&]+)/.exec(window.location.search);
    if (m) {
      const reason = decodeURIComponent(m[1]);
      const text = {
        email_not_verified: 'Google sign-in failed: your Google email is not verified.',
        linked_to_other_google_account: 'That email is already linked to a different Google account.',
      }[reason] || 'Google sign-in failed. Please try again.';
      this.setState({ error: text });
    }
  }

  handleSubmit(e) {
    e.preventDefault();
    var self = this;
    fetch('/api/login', {
      method: 'POST',
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        email: self.refs.email.value,
        password: self.refs.password.value
      })
    })
    .then((response) => {
      // Always try to read the JSON body, even on 401, so we can show the
      // server's error message instead of throwing on a non-JSON response.
      return response.json().then((data) => ({ ok: response.ok, data }));
    })
    .then(({ ok, data }) => {
      console.log('login response:', ok, data);
      if (!ok || !data.success) {
        this.setState({ error: errorMessage(data, 'Incorrect email or password.') });
        return;
      }
      if (this.props.onAuthChange) this.props.onAuthChange();
      this.setState({ currentUser: data, redirectToNewPage: true, error: '' });
    })
    .catch(() => {
      this.setState({ error: 'Unable to reach the server. Please try again.' });
    });
  }


  render() {
    if(this.state.redirectToNewPage) {
      return <Redirect to="/" />;
    }
    return (
      <div className="col-lg-4 col-lg-offset-4">
        <form onSubmit={this.handleSubmit}>
        <div className="input-group">
          <span className="input-group-addon"><i className="glyphicon glyphicon-user"></i></span>
          <input id="email" type="text" className="form-control" ref="email" placeholder="Email address"/>
        </div>
        <div className="input-group">
          <span className="input-group-addon"><i className="glyphicon glyphicon-lock"></i></span>
          <input id="password" type="password" className="form-control" ref="password" placeholder="Password"/>
        </div>
        { this.state.error ? <p className="text-danger">{this.state.error}</p> : null }
        <br />
        <button type="submit" className="btn btn-success">Login</button>
      </form>
      { this.state.google ? (
        <div style={{ marginTop: '1em' }}>
          <p>or</p>
          {/* Full-page navigation: the OAuth redirect flow can't run over fetch. */}
          <a className="btn btn-default" href="/api/auth/google">Sign in with Google</a>
        </div>
      ) : null }
    </div>
    );
  }

}
