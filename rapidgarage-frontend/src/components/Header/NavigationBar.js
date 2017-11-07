import React from 'react';

export default class NavigationBar extends React.Component{
    render (){
      return (
        <nav className = "navbar navbar-inverse">
        <div className="container-fluid">
          <div className="collapse navbar-collapse" id="myNavbar">
            <ul className="nav navbar-nav">
              <li><a href ="#home">Home</a></li>
              <li><a href ="#about">About</a></li>
            </ul>
            <ul className="nav navbar-nav navbar-right">
              <li><a href="#login"><span className="glyphicon glyphicon-log-in"></span>Login</a></li>
              <li><a href="#signup"><span className="glyphicon glyphicon-user"></span>Signup</a></li>
            </ul>
            </div>
        </div>
        </nav>
      );
    }
}
