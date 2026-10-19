const express = require('express');
const router = express.Router();

router.use('/login', require('./login'));
router.use('/signup', require('./signup'));
router.use('/password-reset', require('./passwordReset'));
router.use('/verify-email', require('./verifyEmail'));
router.use('/me', require('./me'));
router.use('/auth', require('./auth'));
router.use('/maps', require('./maps'));
router.use('/config', require('./config'));
router.use('/client-errors', require('./clientErrors'));
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
router.use('/follows', require('./follows'));
router.use('/push', require('./push'));
router.use('/live', require('./live'));
router.use('/reminders', require('./reminders'));
router.use('/share', require('./share'));
router.use('/ratings', require('./ratings'));
router.use('/dashboard', require('./dashboard'));
router.use('/s', require('./shortlinks'));
// robots.txt and sitemap.xml (also mounted at the site root by app.js).
router.use('/', require('./seo'));
router.use('/', require('./home'));

module.exports = router;
