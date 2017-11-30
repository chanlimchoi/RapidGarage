import React, {Component} from 'react'
import styled from "styled-components";

function resultList(props){
      return (
        <div>
    <div className="panel-info">
      <div className="panel-heading">
      <span><h4>{props[0].title} </h4><span className="glyphicon glyphicon-time"></span> Post by {props[0].usr}, post on {props[0].postDate} </span>
      </div>
      <div className="panel-body">
        <h5><span className="label label-danger">Devices</span> <span className="label label-primary">Furniture</span></h5>
        Location: {props[0].address}, {props[0].city}, {props[0].states} <br/>
        <h5>start on {props[0].startDate} end on {props[0].endDate}</h5>
      </div>
    </div>
    </div>
  );
}

const Title = styled.h1`
  font-size: 1.5em;
  text-align: center;
  color: black;
`;

const Wrapper = styled.section`
  padding: 4em;
  background:#ADD8E6;
`;

class Profile extends Component{
    constructor(props){
      super(props);
      this.state = {
        name: "John Doe",
        description: "Your typical New York hoarder.",
        searchResult: [{title:'sale1', address: '123 main Street', city: 'New York', states: 'New York',
                    postDate:'8/21/2017', usr:'Isale', startDate:'8/21/2017', endDate:'8/21/2017'},
                      {title:'sale2', address: '321 5th Ave', city: 'New York', state: 'New York',
                      postDate:'8/22/2017', usr:'Isale2', startDate:'8/23/2017', endDate:'8/23/2017'}],
        search:'',
      };
      this.handleChange = this.handleChange.bind(this);
  }
  handleChange(event){
    this.setState({
      search: event.target.value
    });
  }

	render(){
		return(
      <div>
      <Wrapper>
        <Title>
          {this.state.name}
          <p> </p>
          {this.state.description}
        </Title>
        
      </Wrapper>
      <h3> Recent Listings </h3>
      <div>
          <div className="panel-group">
              {resultList(this.state.searchResult)}
          </div>
      </div>
      </div>

         )
	}
}
export default Profile;