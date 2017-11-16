import React from 'react';
import Post from '../post/Post';
import Map from './Map';

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
    <div className="panel-info">
      <div className="panel-heading">
      <span><h4>{props[1].title} </h4><span className="glyphicon glyphicon-time"></span> Post by {props[1].usr}, post on {props[1].postDate} </span>
      </div>
      <div className="panel-body">
        <h5><span className="label label-danger">Devices</span> <span className="label label-primary">Furniture</span></h5>
        Location: {props[1].address}, {props[1].city}, {props[1].states} <br/>
        <h5>start on {props[1].startDate} end on {props[1].endDate}</h5>
      </div>
    </div>
    </div>
  );
}

class PostList extends React.Component{
  constructor(props){
    super(props);
    this.state = {
      searchResult: [{title:'sale1', address: '123 main Street', city: 'New York', states: 'New York',
                  postDate:'8/21/2017', usr:'Isale', startDate:'8/21/2017', endDate:'8/21/2017'},
                    {title:'sale2', address: '321 5th Ave', city: 'New York', state: 'New York',
                    postDate:'8/22/2017', usr:'Isale2', startDate:'8/23/2017', endDate:'8/23/2017'}],
      search:'',
    };
    this.searchUpdate = this.searchUpdate.bind(this);
    this.handleChange = this.handleChange.bind(this);
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
    return (
        <div>
          <div className="col-sm-4 well">
          <form onSubmit= {this.searchUpdate}>
            <input type="text" style={{width:300}} value={this.state.search} onChange={this.handleChange} placeholder="ZipCode or city" />
            <input type="submit" value="Search" />
          </ form>
          <div className="panel-group">
            <h5><small>RECENT POSTS</small></h5>
              {resultList(this.state.searchResult)}
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
