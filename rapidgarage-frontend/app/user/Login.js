import React from 'react';
import { Redirect } from 'react-router';

export default class Login extends React.Component{
  constructor(props) {
    super(props);
    this.state = {redirectToNewPage: false};
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
    .then(response => {
      if(response.ok)
        this.setState({redirectToNewPage: true})
    });
  }

  render() {
    if(this.state.redirectToNewPage) {
      return <Redirect to="../"/>;
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
        <br />
        <button type="submit" className="btn btn-success">Login</button>
      </form>
    </div>
    );
  }
}
