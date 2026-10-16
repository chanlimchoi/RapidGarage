import React from 'react';
import { Redirect } from 'react-router';
import { errorMessage } from '../api';

const spanstyle = {
  width: '100px',
};

class SignUp extends React.Component{
  constructor(props){
    super(props);
    this.state = {redirectToNewPage: false, error: ''};
    this.handleSubmit = this.handleSubmit.bind(this);
  }

  handleSubmit(e) {
    e.preventDefault();
    var self = this;

    if (self.refs.password.value !== self.refs.passwordConfirm.value) {
      this.setState({ error: 'Passwords do not match.' });
      return;
    }

    fetch('/api/signup', {
      method: 'POST',
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        firstName: self.refs.firstName.value,
        lastName: self.refs.lastName.value,
        email: self.refs.email.value,
        password: self.refs.password.value
      })
    })
    .then(response => response.json().catch(() => null).then(data => ({ ok: response.ok, data })))
    .then(({ ok, data }) => {
      if (!ok) {
        this.setState({ error: errorMessage(data, 'Could not create your account.') });
        return;
      }
      // The signup endpoint logs the user in, so reflect that in the UI.
      if (this.props.onAuthChange) this.props.onAuthChange();
      this.setState({redirectToNewPage: true, error: ''});
    })
    .catch(() => {
      this.setState({ error: 'Unable to reach the server. Please try again.' });
    });
  }

  render() {
    if(this.state.redirectToNewPage) {
      return <Redirect to="../"/>;
    }
    return (
      <div className="col-lg-4 col-lg-offset-4" >
          <form onSubmit={this.handleSubmit}>
          <div className="input-group">
            <span className="input-group-addon" style={spanstyle}>Email:</span>
            <input id="email" type="text" className="form-control" ref="email" placeholder="Email address" required autoFocus/>
          </div>
          <div className="input-group">
          <span className="input-group-addon" style={spanstyle}>Password:</span>
          <input id="password" type="password" className="form-control" ref="password" placeholder="Password" required/>
          </div>
          <div className="input-group">
          <span className="input-group-addon" style={spanstyle}>Re-type:</span>
          <input id="passwordConfirm" type="password" className="form-control" ref="passwordConfirm" placeholder="Confirm Password" required/>
          </div>
          <div className="input-group">
            <span className="input-group-addon" style={spanstyle}>First Name</span>
            <input id="firstname" type="text" className="form-control" ref="firstName" placeholder="first name" required />
          </div>
          <div className="input-group">
          <span className="input-group-addon" style={spanstyle}>Last Name</span>
            <input id="lastname" type="text" className="form-control" ref="lastName" placeholder="last name" required />
          </div>
            { this.state.error ? <p className="text-danger">{this.state.error}</p> : null }
            <button type="submit" className="btn btn-info">Sign Up</button>
          </form>
      </div>
    );
  }
}

export default SignUp;
