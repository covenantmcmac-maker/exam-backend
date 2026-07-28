const SORT_KEYS = Object.freeze([
  'newest',
  'oldest',
  'alpha',
  'alphaDesc',
  'difficultyAsc',
  'difficultyDesc',
  'pointsDesc',
  'pointsAsc',
  'subject'
]);

const SORT_KEY_SET = new Set(SORT_KEYS);
const TEXT_COLLATION = Object.freeze({ locale: 'en', strength: 1 });
const TIE_BREAK_SORT = Object.freeze({ createdAt: -1, _id: -1 });

const FIELD_SORTS = Object.freeze({
  newest: Object.freeze({ createdAt: -1 }),
  oldest: Object.freeze({ createdAt: 1 }),
  alpha: Object.freeze({ questionText: 1 }),
  alphaDesc: Object.freeze({ questionText: -1 }),
  pointsDesc: Object.freeze({ points: -1 }),
  pointsAsc: Object.freeze({ points: 1 }),
  subject: Object.freeze({ subject: 1 })
});

const TEXT_SORT_KEYS = new Set(['alpha', 'alphaDesc', 'subject']);

function normalizeQuestionSort(value) {
  return typeof value === 'string' && SORT_KEY_SET.has(value) ? value : 'newest';
}

function appendTieBreaks(primarySort) {
  const sort = { ...primarySort };

  for (const [field, direction] of Object.entries(TIE_BREAK_SORT)) {
    // Do not overwrite a primary sort on the same field. This is especially
    // important for `oldest`, where replacing createdAt: 1 with createdAt: -1
    // would silently flip the requested order back to newest-first.
    if (!(field in sort)) {
      sort[field] = direction;
    }
  }

  return sort;
}

function difficultyRankExpression(sortKey) {
  return {
    $switch: {
      branches: [
        { case: { $eq: ['$difficulty', 'easy'] }, then: 0 },
        { case: { $eq: ['$difficulty', 'medium'] }, then: 1 },
        { case: { $eq: ['$difficulty', 'hard'] }, then: 2 }
      ],
      // Unknown difficulty values sort last in both directions.
      default: sortKey === 'difficultyDesc' ? -1 : 99
    }
  };
}

function getQuestionSort(requestedSort) {
  const key = normalizeQuestionSort(requestedSort);

  if (key === 'difficultyAsc' || key === 'difficultyDesc') {
    return {
      key,
      mode: 'aggregate',
      rankField: '__difficultyRank',
      addFields: { __difficultyRank: difficultyRankExpression(key) },
      sort: appendTieBreaks({ __difficultyRank: key === 'difficultyAsc' ? 1 : -1 })
    };
  }

  const sort = appendTieBreaks(FIELD_SORTS[key] || FIELD_SORTS.newest);

  return {
    key,
    mode: 'find',
    sort,
    collation: TEXT_SORT_KEYS.has(key) ? { ...TEXT_COLLATION } : undefined
  };
}

module.exports = {
  SORT_KEYS,
  TEXT_COLLATION,
  normalizeQuestionSort,
  appendTieBreaks,
  getQuestionSort
};
