import React from 'react';
import Post from '../post/Post'

export default class PostList extends React.Component{
  constructor(props){
    super(props);
    this.state = {
      searchResult: [{title:'sale1', postDate:'8/21/2017', usr:'Isale', startDate:'8/21/2017', endDate:'8/21/2017'},
                    {title:'sale2', postDate:'8/22/2017', usr:'Isale2', startDate:'8/23/2017', endDate:'8/23/2017'}],
      search:'',
    };
    this.searchUpdate = this.searchUpdate.bind(this);
    this.handleChange = this.handleChange.bind(this);
    this.resultList = this.resultList.bind(this);
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
  }

  resultList(){

  }
  render(){
    return (
          <div className="col-sm-9 well">
          <form onSubmit= {this.searchUpdate}>
            <input type="text" style={{width:300}} value={this.state.search} onChange={this.handleChange} placeholder="ZipCode or city" />
            <input type="submit" value="Search" />
          </ form>
            <h5><small>RECENT POSTS</small></h5>
            <ul>
            {this.resultList}
            </ul>
            <h4>Sales</h4>
            <h5><span className="glyphicon glyphicon-time"></span> Post by Guest, Oct 31, 2017.</h5>
            <h5><span className="label label-danger">Devices</span> <span className="label label-primary">Furniture</span></h5>
            <p>Yard Sale at 124 X Street, New york</p>
    </div>
    );
  }
}
