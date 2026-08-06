/**
 * Regression test for legacy questions created before `isPastQuestion` existed.
 *
 * It invokes the real Question Bank route with the in-memory mongoose test
 * double and verifies that only explicitly archived questions are excluded.
 */
const assert = require('assert/strict');

const mongoosePath = require.resolve('mongoose');
const { stub } = require('./stub-mongoose');
require.cache[mongoosePath] = {
  id: mongoosePath,
  filename: mongoosePath,
  loaded: true,
  exports: stub,
};

const Question = require('../models/Question');
const backfillSubject = require('./backfill-subject');
const questionsRouter = require('../routes/questions');

const questionBankLayer = questionsRouter.stack.find(
  (layer) => layer.route?.path === '/' && layer.route.methods.get
);
const questionBankHandler = questionBankLayer.route.stack.at(-1).handle;

function fetchQuestionBank(query = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ status: this.statusCode, body });
      },
    };

    questionBankHandler(
      { query, user: { _id: 'teacher-1', role: 'teacher' } },
      res
    );
  });
}

async function saveQuestion(questionText, isPastQuestion, { missingSubject = false } = {}) {
  const question = new Question({
    creator: 'teacher-1',
    questionText,
    questionType: 'multiple-choice',
    subject: 'General',
    ...(isPastQuestion === undefined ? {} : { isPastQuestion }),
  });

  // Mongoose applies schema defaults to new documents, so remove these fields
  // to reproduce the raw shape of documents created before either field.
  if (isPastQuestion === undefined) delete question.isPastQuestion;
  if (missingSubject) delete question.subject;
  await question.save();
  return question;
}

function questionTexts(response) {
  assert.equal(response.status, 200);
  return new Set(response.body.questions.map((question) => question.questionText));
}

async function main() {
  await saveQuestion('Legacy question');
  const fullyLegacy = await saveQuestion(
    'Legacy question without a subject',
    undefined,
    { missingSubject: true }
  );
  await saveQuestion('Explicitly active question', false);
  await saveQuestion('Archived question', true);

  // Keep the existing subject migration in the regression path: it should
  // repair the subject without changing the missing archive flag.
  await backfillSubject({ Question, log: () => {} });
  assert.equal(fullyLegacy.subject, 'General');
  assert.equal(Object.hasOwn(fullyLegacy, 'isPastQuestion'), false);

  const expectedActive = new Set([
    'Legacy question',
    'Legacy question without a subject',
    'Explicitly active question',
  ]);

  for (const query of [
    {},
    { past: 'false' },
    { isPastQuestion: 'false' },
  ]) {
    const response = await fetchQuestionBank(query);
    assert.equal(response.body.total, 3);
    assert.deepEqual(questionTexts(response), expectedActive);
  }

  const archived = await fetchQuestionBank({ past: 'true' });
  assert.equal(archived.body.total, 1);
  assert.deepEqual(questionTexts(archived), new Set(['Archived question']));

  console.log('✓ Legacy questions remain visible in the active Question Bank');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
