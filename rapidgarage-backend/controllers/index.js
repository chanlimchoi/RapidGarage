const express = require('express');
const router = express.Router();

router.use('/login', require('./login'));
router.use('/signup', require('./signup'));
router.use('/me', require('./me'));
router.use('/auth', require('./auth'));
router.use('/maps', require('./maps'));
router.use('/post', require('./post'));
router.use('/', require('./home'));

module.exports = router;
