const router = require('express').Router();
const models = require('../models');
const Post = models.Post;

// Mounted at /post, so this handler serves POST /post.
// (It used to be router.post('/post'), which made the real endpoint /post/post.)
router.post('/', (req, res) => {
  Post.create({
    userId: req.body.userId,
    title: req.body.title,
    street: req.body.street,
    city: req.body.city,
    zipCode: req.body.zipCode,
    description: req.body.description
  }).then((post) => {
    res.status(201).json(post);
  }).catch((err) => {
    console.log('Failure creating post:', err.message);
    res.status(400).json({ msg: 'failed to create post' });
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
