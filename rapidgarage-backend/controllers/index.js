const express = require('express');
const router = express.Router();

// router.use('/api/login', require('./login'));
router.use('/signup', require('./signup'));
// router.use('/', require('./home'));

module.exports = router;
