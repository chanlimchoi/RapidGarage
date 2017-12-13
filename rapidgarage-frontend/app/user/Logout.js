import React from 'react';
import { Redirect } from 'react-router';




export default class Logout extends React.Component{
  constructor(props) {
    super(props);
    this.state = {
    };
sessionStorage.removeItem('loggedIn');
sessionStorage.removeItem('userID');
   
  }

  

  render() {
    
       return <Redirect to="../"/>;
  }

}
