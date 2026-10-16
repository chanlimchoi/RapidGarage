import React, {Component} from 'react'
import styled from "styled-components";
import { apiFetch, errorMessage } from '../api';

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
        listResult: [],
        error: '',
      };
     
  }
 componentDidMount() {
    this.load();
  }

  componentDidUpdate(prevProps) {
    const prev = prevProps.user && prevProps.user.id;
    const cur = this.props.user && this.props.user.id;
    if (prev !== cur) this.load();
  }

  // Show the signed-in user's profile; the user comes from GET /me (via App).
  load() {
    const user = this.props.user;
    if (!user) {
      this.setState({ userResult: '', listResult: [] });
      return;
    }
    this.setState({ userResult: user });
    apiFetch('/allbyuserId/' + user.id)
      .then(({ ok, data }) => this.setState({ listResult: ok && Array.isArray(data) ? data : [] }))
      .catch(() => this.setState({ listResult: [] }));
  }

  deletePost(post) {
    if (!window.confirm('Delete "' + post.title + '"?')) return;
    apiFetch('/post/' + post.id, { method: 'DELETE' })
      .then(({ ok, data }) => {
        if (!ok) {
          this.setState({ error: errorMessage(data, 'Could not delete the post.') });
          return;
        }
        this.setState({ error: '', listResult: this.state.listResult.filter((p) => p.id !== post.id) });
      })
      .catch(() => this.setState({ error: 'Unable to reach the server. Please try again.' }));
  }

  editTitle(post) {
    const title = window.prompt('New title', post.title);
    if (title === null) return;
    apiFetch('/post/' + post.id, { method: 'PUT', body: JSON.stringify({ title }) })
      .then(({ ok, data }) => {
        if (!ok) {
          this.setState({ error: errorMessage(data, 'Could not update the post.') });
          return;
        }
        this.setState({ error: '', listResult: this.state.listResult.map((p) => (p.id === post.id ? data : p)) });
      })
      .catch(() => this.setState({ error: 'Unable to reach the server. Please try again.' }));
  }

	render(){
		return(
      <div>
      <Wrapper>
        <Title>
          
          {this.state.userResult.firstName} {this.state.userResult.lastName}
         
        </Title>
        
      </Wrapper>
      { !this.props.user ? <p>Please log in to see your profile.</p> : null }
      { this.state.error ? <p className="text-danger">{this.state.error}</p> : null }
      <h3> Recent Listings </h3>
      <div>
          <div className="panel-group">
            
               {
          (this.state.listResult && this.state.listResult.length) ?
          (this.state.listResult.map((post,key)=>{
            return (
              <li key={key}>
                
  { (resultList(post))} 
                <button type="button" className="btn btn-default btn-xs" onClick={() => this.editTitle(post)}>Edit title</button>{' '}
                <button type="button" className="btn btn-danger btn-xs" onClick={() => this.deletePost(post)}>Delete</button>
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
