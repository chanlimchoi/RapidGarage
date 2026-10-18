const express = require('express');
const router = express.Router();

router.use('/login', require('./login'));
router.use('/signup', require('./signup'));
router.use('/me', require('./me'));
router.use('/auth', require('./auth'));
router.use('/maps', require('./maps'));
router.use('/config', require('./config'));
router.use('/admin', require('./admin'));
router.use('/post', require('./post'));
router.use('/search', require('./search'));
router.use('/conversations', require('./conversations'));
router.use('/holds', require('./holds'));
router.use('/meetups', require('./meetups'));
router.use('/events', require('./events'));
router.use('/alerts', require('./alerts'));
router.use('/wanted', require('./wanted'));
router.use('/saved', require('./saved'));
router.use('/reminders', require('./reminders'));
router.use('/share', require('./share'));
router.use('/ratings', require('./ratings'));
router.use('/dashboard', require('./dashboard'));
router.use('/s', require('./shortlinks'));
router.use('/', require('./home'));

module.exports = router;
