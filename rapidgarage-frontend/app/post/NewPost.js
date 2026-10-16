import React, {Component} from 'react'
import Taggle from 'taggle'
import { Redirect } from 'react-router';
import { errorMessage } from '../api';

class NewPost extends Component{
    constructor(props){
      super(props);
      this.state = {
      title: '',
      text: '',
      address: '',
      city: '',
      zipCode: '',
      created: false,
      error: '',
    };
    this.handleSubmit = this.handleSubmit.bind(this);
  }

    handleSubmit(e) {
      e.preventDefault();

      // The server enforces login; this is just a friendlier early message.
      if (!this.props.user) {
        this.setState({ error: 'Please log in before creating a post.' });
        return;
      }

      fetch('/api/post', {
        method: 'POST',
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          title: this.refs.title.value,
          street: this.refs.address.value,
          city: this.refs.city.value,
          zipCode: this.refs.zipcode.value,
          description: this.refs.description.value,
        })
      })
      .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) {
          this.setState({ error: errorMessage(data, 'Could not create the post.') });
          return;
        }
        this.setState({ created: true, error: '' });
      })
      .catch(() => {
        this.setState({ error: 'Unable to reach the server. Please try again.' });
      });
    }

    render(){
      console.log(Taggle)
      if (this.state.created) {
        return <Redirect to="/" />;
      }
      return (
          <div className="col-sm-9" >
            <form onSubmit={this.handleSubmit}>
              <div className="input-group">
                <span className="input-group-addon">Title:</span>
                <input className="form-control" id="title" type="text" name="title" ref="title" defaultValue={this.state.title} required autoFocus/>
              </div>
              <br />
              <div className="input-group">
                <span className="input-group-addon">Address:</span>
                <input className="form-control" id="address" type="text" name="address" ref="address" defaultValue={this.state.address} required />
              </div>
              <div className="input-group">
                <span className="input-group-addon">City:</span>
                <input className="form-control" id="city" type="text" name="city" ref="city" defaultValue={this.state.city} required />
              </div>
              <div className="input-group">
                <span className="input-group-addon">ZipCode:</span>
                <input className="form-control" id="zipcode" type="text" name="zipcode" ref="zipcode" defaultValue={this.state.zipCode} required />
              </div>
              <br />
              <div className="input-group">
                <span className="input-group-addon">Description:</span>
                <textarea className="form-control" rows="8" id="description" ref="description" defaultValue={this.state.text}></textarea>
              </div>
              <div id="example1"></div>
              <p id="log"></p>
              { this.state.error ? <p className="text-danger">{this.state.error}</p> : null }
              <button type="submit" className="btn btn-info">Post</button>
            </form>
          </div>
      )
    }

}

export default NewPost;
