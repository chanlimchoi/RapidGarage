import React from 'react';


class Profile extends React.Component{
	constructor(props){
		super(props);
		this.state = {
			name: "John Doe",
			description: "Hoarder that needs to get rid of some nice stuff",
		}
	}
  render(){
    return (
      <div className="col-sm-3 well">
           <h1>"My Profile"</h1>
           
       </div>
    );
  }
}



export default Profile
