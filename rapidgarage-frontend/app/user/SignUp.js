import React from 'react';
import { CountryDropdown, RegionDropdown } from 'react-country-region-selector';

const spanstyle = {
    width: '100px',
};

class SignUp extends React.Component{
  constructor(props){
    super(props);
    this.state = {
    };
  }
  
  render (){
      return (
          <div className="col-lg-4 col-lg-offset-4" >
            <form>
            <div className="input-group">
              <span className="input-group-addon" style={spanstyle}>Email:</span>
              <input id="email" type="text" className="form-control" name="email" placeholder="Email address" required autofocus/>
            </div>
            <div className="input-group">
            <span className="input-group-addon" style={spanstyle}>Password:</span>
            <input id="password" type="password" className="form-control" name="password" placeholder="Password" required/>
            </div>
            <div className="input-group">
            <span className="input-group-addon" style={spanstyle}>Re-type:</span>
            <input id="password" type="password" className="form-control" name="password" placeholder="Confirm Password" required/>
            </div>
            <div className="input-group">
              <span className="input-group-addon" style={spanstyle}>First Name</span>
              <input id="firstname" type="text" className="form-control" name="firstname" placeholder="first name" required />
            </div>
            <div className="input-group">
              <span className="input-group-addon" style={spanstyle}>Last Name</span>
              <input id="lastname" type="text" className="form-control" name="lastname" placeholder="last name" required />
            </div>
              <button type="submit" className="btn btn-info">Sign Up</button>
            </form>
          </div>
      );
  }
}

export default SignUp;
