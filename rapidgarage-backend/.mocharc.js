// Loaded by every mocha run here: `npm test` and direct `npx mocha test/x.test.js`.
// test/setup.js refuses to start unless the database is a throwaway one.
module.exports = {
  require: [require('path').join(__dirname, 'test', 'setup.js')],
  exit: true,
};
