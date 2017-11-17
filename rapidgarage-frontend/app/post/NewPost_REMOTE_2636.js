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
        	    <div className="col-sm-9">

            		<h1>Create post</h1>
            		<form action="" method="POST">

            		    <div className="form-group">
            		        <label forHtml="title">Title <span className="require">*</span></label>
            		        <input type="text" className="form-control" name="title" />
            		    </div>

            		    <div className="form-group">
            		        <label forHtml="description">Description</label>
            		        <textarea rows="5" className="form-control" name="description" ></textarea>
            		    </div>

            		    <div className="form-group">
            		        <p><span className="require">*</span> - required fields</p>
            		    </div>

            		    <div className="form-group">
            		        <button type="submit" className="btn btn-success">
            		            Create
            		        </button>
            		        <button className="btn btn-default">
            		            Cancel
            		        </button>
            		    </div>

            		</form>
        		</div>
      )
    }

}

export default NewPost
