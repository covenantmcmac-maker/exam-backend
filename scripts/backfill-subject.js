/**
 * Backfill the `subject` field on legacy Question documents.
 *
 * The subject-filtering feature added a `subject` field to the Question
 * schema, but questions that were created before that change exist in MongoDB
 * without it. Because those legacy questions have no subject, they never show
 * up under any subject chip in the question bank — a teacher filtering by
 * subject can no longer find their old questions.
 *
 * This migration assigns a default subject to every Question that is missing
 * one, so legacy questions become discoverable and filterable again.
 *
 * It is idempotent — safe to run more than once.
 *
 * Usage:
 *   node scripts/backfill-subject.js                # uses default 'General'
 *   node scripts/backfill-subject.js "Mathematics"  # custom default subject
 *
 * Requires MONGODB_URI in the environment (e.g. backend/.env).
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Question = require('../models/Question');

const DEFAULT_SUBJECT = (process.argv[2] || '').trim() || 'General';

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error(
      '❌ MONGODB_URI is not set. Copy backend/.env.example to backend/.env and fill it in, then retry.'
    );
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');

  // Questions where subject is missing entirely, null, or blank/whitespace.
  const query = {
    $or: [
      { subject: { $exists: false } },
      { subject: null },
      { subject: '' },
      { subject: { $regex: /^\s*$/ } },
    ],
  };

  const total = await Question.countDocuments(query);

  if (total === 0) {
    console.log('✅ No legacy questions missing a subject — nothing to do.');
  } else {
    const result = await Question.updateMany(query, {
      $set: { subject: DEFAULT_SUBJECT },
    });
    console.log(
      `✅ Backfilled subject="${DEFAULT_SUBJECT}" on ${result.modifiedCount} of ${total} legacy question(s).`
    );
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
