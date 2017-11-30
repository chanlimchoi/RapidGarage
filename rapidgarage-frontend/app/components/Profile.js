import React, {Component} from 'react'
import Taggle from 'taggle'
import ProfileBox from "./css/profile.style"

class Profile extends Component{
    constructor(props){
      super(props);
      this.state = {
        name: "John Doe",
        description: "Hoarder that needs to ge rid of some nice stuff"
    };
  }


	render(){
		return(
			<div className="col-md-5">
                  <h1> My Profile </h1>
                  <h2> {this.state.name} </h2>
                  <h3> {this.state.description} </h3>
                  <h1> Garage Sale Listings change </h1>
    </div>     


         )
	}
}
export default Profile;