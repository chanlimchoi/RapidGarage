import React from 'react';
import { Redirect } from 'react-router';
import { Link, withRouter } from "react-router-dom";



export default class Login extends React.Component{
  constructor(props) {
    super(props);
    this.state = {
      redirectToNewPage: false,
      currentUser: '',
    };

    this.handleSubmit = this.handleSubmit.bind(this);
  }

  handleSubmit(e) {
    e.preventDefault();
    var self = this;
    // this.setState(currentUser : this.self.refs.email.value);
    fetch('/api/login', {
      method: 'POST',
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        email: self.refs.email.value,
        password: self.refs.password.value
      })
    })
    .then((response) => {
      // if(response.ok)
        // this.setState({redirectToNewPage: true})
        console.log('response: ', response)
        return response.json();
    })
    .then((data) => {
      console.log('what data: ', data)
      this.setState({
       // currentUser: data,
        redirectToNewPage: true,
      })

        sessionStorage.setItem('loggedIn', true);
        sessionStorage.setItem('userID', data.user.id);
        this.setState({currentUser: data})
      }).then(() =>
      {
        this.props.history.push("../");
      }

    )
   
    
   
  }


  render() {
    if(this.state.redirectToNewPage) {
     
      // return <Redirect to="../" push />;
    
    }
   // console.log('this.state', this.state)
    console.log('sessionItem', sessionStorage.getItem('loggedIn'))
    console.log('sessionItem', sessionStorage.getItem('userID'))
    console.log('currentUser ', this.state.currentUser)
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
