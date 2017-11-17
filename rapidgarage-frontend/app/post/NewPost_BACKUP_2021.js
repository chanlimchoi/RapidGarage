import React, {Component} from 'react'
import {Taggle} from 'taggle'


class NewPost extends Component{
    constructor(props){
      super(props);
      this.state = {
      title: "Garage Sale in FiDi",
      text: "We're selling a lot of electronics, clothes, and house decor!",
      address: "1234 Fulton St. Apt 10",
      city: "New York",
      zipCode: "10001"
    };
    //new Taggle('example1');
  
  }
    render(){
      return (
<<<<<<< HEAD
          <div className="col-lg-8" >
            <form>
              <div className="input-group">
                <span className="input-group-addon">Title:</span>
                <input className="form-control" id="title" type="text" name="title" required autofocus/>
              </div>
              <br />
              <div className="input-group">
                <span className="input-group-addon">Address:</span>
                <input className="form-control" id="address" type="text" name="address" required />
              </div>
              <div className="input-group">
                <span className="input-group-addon">City:</span>
                <input className="form-control" id="city" type="text" name="city" required />
              </div>
              <div className="input-group">
                <span className="input-group-addon">ZipCode:</span>
                <input className="form-control" id="zipcode" type="text" name="zipcode" required />
              </div>
              <br />
              <div className="input-group">
                <span className="input-group-addon">Description:</span>
                <textarea class="form-control" rows="8" id="description"></textarea>
              </div>
              <div id="example1"></div>
              <p id="log"></p>
            </form>
            <br />
              <button type="post" className="btn btn-info">Post</button>
          </div>
      )  
=======
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
>>>>>>> ec32ea778af2485fc84902ec206f6a7316ba6c73
    }

}

export default NewPost;
