const express = require('express');
const models = require('../models');
const router = express.Router();

// here


router.get('/allPosts', (req, res) => {
  models.Post.findAll()
    .then((allPosts) => {
      res.json(allPosts)
    })
    .catch((err) => {
      console.log('Failure Get');
    res.json({
    msg: "failed GET to '/' route"
     });
    })
});

router.get('/profile/:id', (req, res) => {
  models.User.findOne({
    where: {  
      id: req.params.id,
    }
  }).then((allPosts) => {
   
      res.json(allPosts);
    })
    .catch((err) => {
      console.log('Failure Get');
    res.json({
    msg: "failed GET to '/' route"
     });
    })
});

router.get('/:id', (req, res) => {
  models.Post.findAll(req.params.id)
    .then((post) => {
      res.json(post)
    })
    .catch((err) => {
      console.log('Failure Get');
      res.json({
        msg: "failed GET to '/' route"
      });
    })
});

router.get('/all/:zipCode', (req, res) => {
  const id = req.params.zipCode ? req.params.zipCode : 10021;
  models.Post.findAll({
    where: {
      zipCode: req.params.zipCode,
    }
  }).then((allPosts) => {
      // allPosts.sort((a, b) => {
      //   return Math.abs(parseInt(a.zipCode) - id) - Math.abs(parseInt(b.zipCode) - id);
      // });
      res.json(allPosts);
    })
    .catch((err) => {
      console.log('Failure Get');
      res.json({
        msg: "failed GET to '/' route"
      });
    })
});



router.get('/allbyuserId/:userId', (req, res) => {
  
  models.Post.findAll({
    where: {  
      userId: req.params.userId,
    }
  }).then((allPosts) => {
   
      res.json(allPosts);
    })
    .catch((err) => {
      console.log('Failure Get');
      res.json({
        msg: "failed GET to '/' route"
      });
    })
});
// here



// router.get('/', (req, res) => {
//   res.json({
//     msg: "Successful GET to '/' route"
//   });
// });

// router.post('/', (req, res) => {
//   res.json({
//     msg: "Successful POST to '/' route"
//   });
// });

// router.put('/:id', (req, res) => {
//   res.json({
//     msg: "Successful PUT to '/' route",
//     id: req.params.id
//   });
// });

// router.delete('/:id', (req, res) => {
//   res.json({
//     msg: "Successful DELETE to '/' route",
//     id: req.params.id
//   });
// });


module.exports = router;
