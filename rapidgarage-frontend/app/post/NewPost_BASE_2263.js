import React, {Component} from 'react'

class NewPost extends Component{
    constructor(props){
      super(props);
    this.state = {
      text: "",
      address: "",
      city: "",
      zipCode: ""
    };
  }
    render(){
      return (
        <div>
          New post
        </div>
      )
    }

}

export default NewPost
