import React from 'react';


class Profile extends React.Component{
  render(){
    return (
      <div className="col-sm-3 well">
           <div className="well">
             <p><a href="/userprofile">My Profile</a></p>
           </div>
           <button> Create Post</button>
         </div>
    );
  }
}


export default Profile
