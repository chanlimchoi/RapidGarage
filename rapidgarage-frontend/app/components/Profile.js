import React, {Component} from 'react'
import styled from "styled-components";

function resultList(props){
      return (
        <div>
    <div className="panel-info">
      <div className="panel-heading">
      <span><h4>{props.title} </h4><span className="glyphicon glyphicon-time"></span> Post by {props.usr}, post on {props.postDate} </span>
      </div>
      <div className="panel-body">
        <h5><span className="label label-danger">Devices</span> <span className="label label-primary">Furniture</span></h5>
        Location: {props.address}, {props.city}, {props.states} <br/>
        <h5>start on {props.startDate} end on {props.endDate}</h5>
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
        userResult: '',
        listResult:'',
      };
     
  }
 componentDidMount() {
   
    fetch('http://localhost:8000/profile/1', {
      method: 'get', 
      header: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    })
    .then((response) => {
     
      return response.json();
      
    })
    .then((data) => {
      let result = data;
      console.log('data:', data);
      this.setState({userResult: data});
      console.log('userstate:', this.state.userResult);
    })
 

        fetch('http://localhost:8000/allbyuserId/'+ sessionStorage.getItem('userID'), {
      method: 'get', 
      header: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    })
    .then((response) => {
      console.log('response:', response)
      return response.json()
    })
    .then((data) => {
      let result = data;
      console.log('data:', data)
      this.setState({listResult: data})
    })
  }

	render(){
		return(
      <div>
      <Wrapper>
        <Title>
          
          {this.state.userResult.firstName} {this.state.userResult.lastName}
         
        </Title>
        
      </Wrapper>
      <h3> Recent Listings </h3>
      <div>
          <div className="panel-group">
            
               {
          (this.state.listResult) ?
          (this.state.listResult.map((post,key)=>{
            return (
              <li key={key}>
                
  { (resultList(post))} 
              </li>

            )
          })
          ): <h1>No data</h1>
        }
          </div>
      </div>
      </div>

         )
	}
}
export default Profile;