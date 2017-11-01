import React from 'react';
//import './css/Header.css';
import NavigationBar from './Header/NavigationBar'

export default class Header extends React.Component{
  render(){
    return (
      <div>
      <h1> RapidGarage</h1>
      <NavigationBar />
      </div>
    );
  }
}
