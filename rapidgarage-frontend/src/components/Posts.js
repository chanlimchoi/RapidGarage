import React from 'react';

export default class Posts extends React.Component{
  render(){
    return (
          <div class="col-sm-9">
            <h4><small>RECENT POSTS</small></h4>

            <h2>Sales</h2>
            <h5><span class="glyphicon glyphicon-time"></span> Post by Guest, Oct 31, 2017.</h5>
            <h5><span class="label label-danger">Devices</span> <span class="label label-primary">Furniture</span></h5>
            <p>Yard Sale at 124 X Street, New york</p>

            <h4>Leave a Comment:</h4>
            <form role="form">
              <div class="form-group">
                <textarea class="form-control" rows="3" required></textarea>
              </div>
              <button type="submit" class="btn btn-success">Submit</button>
            </form>


            <p><span class="badge">1</span> Comments:</p>

            <div class="row">
              <div class="col-sm-2 text-center">

              </div>
              <div class="col-sm-10">
                <h4>Guest <small>Oct 31, 2017, 9:12 PM</small></h4>
                <p>I am in</p>

              </div>
            </div>
    </div>
    );
  }
}
