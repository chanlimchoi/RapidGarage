import React from 'react';
import { Redirect } from 'react-router';
import { Link, withRouter } from "react-router-dom";



export default class Login extends React.Component{
  constructor(props) {
    super(props);
    this.state = {
      redirectToNewPage: false,
      currentUser: '',
      error: '',
    };

    this.handleSubmit = this.handleSubmit.bind(this);
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
        this.setState({ error: data.message || 'Incorrect email or password.' });
        return;
      }
      sessionStorage.setItem('loggedIn', 'true');
      sessionStorage.setItem('userID', data.user.id);
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
    </div>
    );
  }

}
