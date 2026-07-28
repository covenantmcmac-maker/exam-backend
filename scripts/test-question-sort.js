const assert = require('assert/strict');
const {
  SORT_KEYS,
  TEXT_COLLATION,
  normalizeQuestionSort,
  appendTieBreaks,
  getQuestionSort
} = require('../routes/questionSort');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (error) {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name} — ${error.message}`);
  }
}

console.log('Question sort specs');

check('exposes the ten client sort keys', () => {
  assert.deepEqual(SORT_KEYS, [
    'newest',
    'oldest',
    'alpha',
    'alphaDesc',
    'difficultyAsc',
    'difficultyDesc',
    'pointsDesc',
    'pointsAsc',
    'subject',
    'subjectDesc'
  ]);
});

check('accepts a known sort key', () => {
  assert.equal(normalizeQuestionSort('pointsAsc'), 'pointsAsc');
});

check('falls back to newest for unknown sort keys', () => {
  assert.equal(normalizeQuestionSort('DROP TABLE questions'), 'newest');
});

check('does not let arbitrary sort keys reach the Mongo spec', () => {
  const spec = getQuestionSort('$where');
  assert.equal(spec.key, 'newest');
  assert.deepEqual(Object.keys(spec.sort), ['createdAt', '_id']);
});

check('newest sorts by upload time descending', () => {
  assert.deepEqual(getQuestionSort('newest').sort, { createdAt: -1, _id: -1 });
});

check('oldest keeps createdAt ascending despite newest tie-breaks', () => {
  assert.deepEqual(getQuestionSort('oldest').sort, { createdAt: 1, _id: -1 });
});

check('text collation matches client localeCompare behavior', () => {
  assert.deepEqual(TEXT_COLLATION, { locale: 'en', strength: 1 });
});

check('alphabetical A→Z sorts by question text with ICU collation', () => {
  const spec = getQuestionSort('alpha');
  assert.equal(spec.mode, 'find');
  assert.deepEqual(spec.sort, { questionText: 1, createdAt: -1, _id: -1 });
  assert.deepEqual(spec.collation, { locale: 'en', strength: 1 });
});

check('alphabetical Z→A sorts by question text descending', () => {
  assert.deepEqual(getQuestionSort('alphaDesc').sort, {
    questionText: -1,
    createdAt: -1,
    _id: -1
  });
});

check('subject sort uses ICU collation', () => {
  const spec = getQuestionSort('subject');
  assert.deepEqual(spec.sort, { subject: 1, createdAt: -1, _id: -1 });
  assert.deepEqual(spec.collation, { locale: 'en', strength: 1 });
});

check('subject Z→A sorts descending with ICU collation', () => {
  const spec = getQuestionSort('subjectDesc');
  assert.deepEqual(spec.sort, { subject: -1, createdAt: -1, _id: -1 });
  assert.deepEqual(spec.collation, { locale: 'en', strength: 1 });
});

check('points high→low sorts by points descending', () => {
  assert.deepEqual(getQuestionSort('pointsDesc').sort, { points: -1, createdAt: -1, _id: -1 });
});

check('points low→high sorts by points ascending', () => {
  assert.deepEqual(getQuestionSort('pointsAsc').sort, { points: 1, createdAt: -1, _id: -1 });
});

check('difficulty easy→hard uses aggregation', () => {
  assert.equal(getQuestionSort('difficultyAsc').mode, 'aggregate');
});

check('difficulty easy→hard projects a numeric rank', () => {
  const spec = getQuestionSort('difficultyAsc');
  assert.deepEqual(spec.addFields.__difficultyRank.$switch.branches, [
    { case: { $eq: ['$difficulty', 'easy'] }, then: 0 },
    { case: { $eq: ['$difficulty', 'medium'] }, then: 1 },
    { case: { $eq: ['$difficulty', 'hard'] }, then: 2 }
  ]);
  assert.equal(spec.addFields.__difficultyRank.$switch.default, 99);
});

check('difficulty easy→hard sorts by projected rank ascending', () => {
  assert.deepEqual(getQuestionSort('difficultyAsc').sort, {
    __difficultyRank: 1,
    createdAt: -1,
    _id: -1
  });
});

check('difficulty hard→easy sorts unknown values last', () => {
  const spec = getQuestionSort('difficultyDesc');
  assert.equal(spec.addFields.__difficultyRank.$switch.default, -1);
  assert.deepEqual(spec.sort, { __difficultyRank: -1, createdAt: -1, _id: -1 });
});

check('tie-break helper never overwrites a primary field', () => {
  const primary = { createdAt: 1, questionText: 1 };
  assert.deepEqual(appendTieBreaks(primary), { createdAt: 1, questionText: 1, _id: -1 });
  assert.deepEqual(primary, { createdAt: 1, questionText: 1 });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
