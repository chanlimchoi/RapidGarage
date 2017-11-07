import React from 'react';
import { CountryDropdown, RegionDropdown } from 'react-country-region-selector';

const spanstyle = {
    width: '100px',
};

export default class SignUp extends React.Component{
  constructor(props){
    super(props);
    this.state = {
      country:'United States',
      region:''
    };
  }
  selectCountry (val){
    this.setState({country: val});
  }
  selectRegion (val){
    this.setState({region: val});
  }
  render (){
    const { country, region } = this.state;
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
              <span className="input-group-addon" style={spanstyle}>Address:</span>
              <input id="address" type="text" className="form-control" name="address" placeholder="address" required />
            </div>
            <div className="input-group">
              <span className="input-group-addon" style={spanstyle}>City:</span>
              <input id="city" type="text" className="form-control" name="city" placeholder="city" required />
            </div>
            <div className="input-group">
              <span className="input-group-addon" style={spanstyle}>ZipCode:</span>
              <input id="zipcode" type="text" className="form-control" name="ZipCode" placeholder="ZipCode" required />
            </div>
            <CountryDropdown
                    region={this.state.region}
                    value={this.state.country}
                    onChange={(val) => this.selectCountry(val)} />
              <br />
            <RegionDropdown
                    country={this.state.country}
                    value={this.state.region}
                    onChange={(val) => this.selectRegion(val)}   />
            </form>
            <br />
              <button type="submit" className="btn btn-info">Sign Up</button>
          </div>
      );
  }
}
