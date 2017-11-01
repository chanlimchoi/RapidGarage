import React from 'react';

export default class NavigationBar extends React.Component{
    render (){
      return (
        <nav class = "navbar navbar-inverse">
        <div class="container-fluid">
          <div class="collapse navbar-collapse" id="myNavbar">
            <ul class="nav navbar-nav">
              <li><a href ="#home">Home</a></li>
              <li><a href ="#about">About</a></li>
            </ul>
            <ul class="nav navbar-nav navbar-right">
              <li><a href="#login"><span class="glyphicon glyphicon-log-in"></span>Login</a></li>
            </ul>
            </div>
        </div>
        </nav>
      );
    }
}
