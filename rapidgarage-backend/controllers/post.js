const router = require('express').Router();
const models = require('../models');
const Post = models.Post;

router.post('/post', (req, res) => {
  Post.create({
    userId: req.body.userId,
    title: req.body.title,
    street: req.body.street,
    city: req.body.city,
    zipCode: req.body.zipCode,
    description: req.body.description
  }).then((post) => {
    res.send(post);
  }).catch(() => {
    res.send('error');
  });
});





// router.get('/post/all/:zipCode', (req, res) => {
//   const id = req.params.zipCode ? req.params.zipCode : 10021;
//   models.Post.findAll({
//     where: {
//       zipCode: req.params.zipCode,
//     }
//   }).then((allPosts) => {
//       // allPosts.sort((a, b) => {
//       //   return Math.abs(parseInt(a.zipCode) - id) - Math.abs(parseInt(b.zipCode) - id);
//       // });
//       res.json(allPosts);
//     })
//     .catch((err) => {
//       console.log('Failure Get');
//       res.json({
//         msg: "failed GET to '/' route"
//       });
//     })
// });

// router.get('/:id', (req, res) => {
//   Post.findById(req.params.id)
//     .then((post) => {
//       res.json(post)
//     })
//     .catch((err) => {
//       console.log('Failure Get');
//       res.json({
//         msg: "failed GET to '/' route"
//       });
//     })
// });

module.exports = router;
