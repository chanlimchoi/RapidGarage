import React from 'react';

export default class Login extends React.Component{
  render(){
    return (
      <div className="col-lg-4 col-lg-offset-4">
        <form>
        <div className="input-group">
          <span className="input-group-addon"><i className="glyphicon glyphicon-user"></i></span>
          <input id="email" type="text" className="form-control" name="email" placeholder="Email address"/>
        </div>
        <div className="input-group">
          <span className="input-group-addon"><i className="glyphicon glyphicon-lock"></i></span>
          <input id="password" type="password" className="form-control" name="password" placeholder="Password"/>
        </div>
        <br />
        <button type="submit" className="btn btn-success">Login</button>
      </form>
    </div>
    );
  }
}
