import React, { Component } from 'react';
import Post from '../post/Post';
import Map from './Map';

function resultList(props){
      return (
        
    <div className="panel-info">
      <div className="panel-heading">
      <span><h4>{props.title} </h4><span className="glyphicon glyphicon-time"></span> Post by {props.userId}, post on {props.updatedAt} </span>
      </div>
      <div className="panel-body">
        <h5><span className="label label-danger">Devices</span> <span className="label label-primary">Furniture</span></h5>
        Location: {props.street}, {props.city}, {props.state} <br/>
        <h5>start on {props.startDate} end on {props.endDate}</h5>
      </div>
    </div>
    
  );
}

class PostList extends React.Component{
  constructor(props){
    super(props);
    this.state = {
      searchResult: '',
      search:'',
    };
    this.searchUpdate = this.searchUpdate.bind(this);
    this.handleChange = this.handleChange.bind(this);
    
  }
componentDidMount() {
    fetch('http://localhost:8000/allPosts', {
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
      this.setState({searchResult: data})
    })

  }

  handleChange(event){
    this.setState({
      search: event.target.value
    });
  }
  searchUpdate(event){
    const val = event.target.value;

    this.setState({
      search: val
    })
  alert('Search ' + this.state.search);
  alert('Search ' + this.state.searchResult[0].title + ' ' + this.state.searchResult[0].postDate);
  }


  render(){
    console.log('searchResult: ',this.state.searchResult);
    return (
        <div>
          <div className="col-sm-4 well">
          <form onSubmit= {this.searchUpdate}>
            <input type="text" style={{width:300}} value={this.state.search} onChange={this.handleChange} placeholder="ZipCode or city" />
            <input type="submit" value="Search" />
          </ form>
          <div className="panel-group">
            <h5><small>RECENT POSTS</small></h5>
              {
          (this.state.searchResult) ?
          (this.state.searchResult.map((post,key)=>{
            return (
              <li key={key}>
                <p>{post.city} {post.street} {post.zipCode} {post.state} {post.startDate} {post.endDate}</p>
              </li>

            )
          })
          ): <h1>No data</h1>
        }

            {/* {resultList(this.state.searchResult)} */}
          </div>
          </div>
           <div className="col-sm-5 well">
            <Map />
           </div>
          </div>
    );
  }
}

export default PostList
