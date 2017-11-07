import React from 'react';

export default class Posts extends React.Component{
  render(){
    return (
          <div class="col-sm-9">
            <h4><small>RECENT POSTS</small></h4>

            <h2>Sales</h2>
            <h5><span className="glyphicon glyphicon-time"></span> Post by Guest, Oct 31, 2017.</h5>
            <h5><span className="label label-danger">Devices</span> <span className="label label-primary">Furniture</span></h5>
            <p>Yard Sale at 124 X Street, New york</p>

            <h4>Leave a Comment:</h4>
            <form>
              <div className="form-group">
                <textarea className="form-control" rows="3" required></textarea>
              </div>
              <button type="submit" className="btn btn-success">Submit</button>
              <button type="submit" className="btn btn-danger">Cancel</button>
            </form>


            <p><span className="badge">1</span> Comments:</p>

            <div className="row">
              <div className="col-sm-2 text-center">

              </div>
              <div className="col-sm-10">
                <h4>Guest <small>Oct 31, 2017, 9:12 PM</small></h4>
                <p>I am in</p>

              </div>
            </div>
    </div>
    );
  }
}
