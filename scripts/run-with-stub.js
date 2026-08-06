/**
 * Boots the real Express app with the in-memory mongoose stand-in injected.
 * Used by scripts/integration-test.js (spawns this as a child process).
 */
const mongoosePath = require.resolve('mongoose');
const { stub } = require('./stub-mongoose');
require.cache[mongoosePath] = {
  id: mongoosePath,
  filename: mongoosePath,
  loaded: true,
  exports: stub,
};

require('../server');
