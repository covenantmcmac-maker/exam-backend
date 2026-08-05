/**
 * Backfill the `subject` field on legacy Question documents.
 *
 * Questions created before subject filtering was introduced do not have a
 * subject (or have a null/blank subject), so they are not returned when a
 * subject filter is used. This migration assigns those questions a default
 * subject. It is safe to run repeatedly because once a question has a
 * non-blank subject it no longer matches the update query.
 *
 * Usage:
 *   node scripts/backfill-subject.js
 *   node scripts/backfill-subject.js "Mathematics"
 */
const mongoose = require('mongoose');
const Question = require('../models/Question');

const DEFAULT_SUBJECT = 'General';

/**
 * Update legacy questions using the already-connected Question model.
 *
 * The function deliberately does not open or close a MongoDB connection. The
 * server calls it after its connection succeeds, while the CLI manages its
 * own connection below. Keeping the database operation here makes the
 * startup backfill and the manual command use exactly the same logic.
 *
 * @param {object} [opts]
 * @param {string} [opts.defaultSubject='General'] subject to assign
 * @param {string} [opts.subject] alias for defaultSubject (useful for callers)
 * @param {Function} [opts.log=console.log] log sink
 * @param {object} [opts.Question] model override for tests/callers
 * @returns {Promise<object>} the MongoDB update result
 */
async function backfillSubject(opts = {}) {
  const requestedSubject = opts.defaultSubject ?? opts.subject;
  const defaultSubject = String(requestedSubject ?? DEFAULT_SUBJECT).trim() || DEFAULT_SUBJECT;
  const log = typeof opts.log === 'function' ? opts.log : console.log;
  const QuestionModel = opts.Question || opts.questionModel || Question;

  // Match questions where subject is missing entirely, null, empty, or blank.
  const query = {
    $or: [
      { subject: { $exists: false } },
      { subject: null },
      { subject: '' },
      { subject: { $regex: /^\s*$/ } }
    ]
  };

  const result = await QuestionModel.updateMany(query, {
    $set: { subject: defaultSubject }
  });

  const updatedCount = result.modifiedCount ?? result.nModified ?? 0;
  log(
    `✅ Subject backfill complete: ${updatedCount} question(s) tagged "${defaultSubject}".`
  );

  return result;
}

module.exports = backfillSubject;

async function runCli() {
  require('dotenv').config();

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error(
      '❌ MONGODB_URI is not set. Copy .env.example to .env and fill it in, then retry.'
    );
    process.exitCode = 1;
    return;
  }

  let connected = false;
  try {
    await mongoose.connect(uri);
    connected = true;
    console.log('✅ Connected to MongoDB');

    await backfillSubject({
      defaultSubject: process.argv[2],
      log: console.log
    });
  } finally {
    if (connected) {
      await mongoose.disconnect();
    }
  }
}

// Requiring this module must only expose the function; the CLI should not
// connect to MongoDB or exit the host process during server startup.
if (require.main === module) {
  runCli().catch((err) => {
    console.error('❌ Subject backfill failed:', err);
    process.exitCode = 1;
  });
}
