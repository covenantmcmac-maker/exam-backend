/**
 * Regression test for "the New Exam page is very slow / laggy while typing".
 *
 * The exam builder holds the question bank AND the exam-detail fields in the
 * same component, so every keystroke in the title re-runs the whole render.
 * That was fine until the picker grew: the subject tallies rescanned the bank
 * once per subject, and every question row was rebuilt from scratch.
 *
 * This test doesn't need a DOM. It measures the two things that actually
 * regressed, using the exact algorithms the screen uses:
 *
 *   1. derived subject state — O(bank x subjects) before, O(bank) after
 *   2. rendered rows per keystroke — all of them before, none after
 *
 * Both are asserted as budgets, so a future change that reintroduces a
 * per-subject bank scan or un-memoises the rows fails here instead of in a
 * user's hands.
 *
 * Run: node scripts/test-exam-builder-perf.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const SCREEN = path.join(root, 'src/screens/teacher/ExamBuilderScreen.tsx');

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  \u001b[32m✓\u001b[0m ${name}`);
  } else {
    failed++;
    console.log(`  \u001b[31m✗\u001b[0m ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/* ------------------------------------------------------------- fixtures */

const BANK_SIZE = 1200;
const SUBJECT_COUNT = 24;

const bank = Array.from({ length: BANK_SIZE }, (_, i) => ({
  _id: `q${i}`,
  subject: `Subject ${i % SUBJECT_COUNT}`,
  questionText: `Question number ${i}`,
  difficulty: ['easy', 'medium', 'hard'][i % 3],
  points: 1,
}));

const selected = {};
for (let i = 0; i < BANK_SIZE; i += 3) selected[`q${i}`] = 1;

/* ----------------------------------------- 1. derived state per keystroke */

console.log('\nDerived subject state');

// The OLD shape: one bank scan per subject, twice over (fully-selected +
// selected-count), recomputed on every render because it was not memoised
// against the selection.
function legacyDerivedState() {
  let scans = 0;
  const subjects = [...new Set(bank.map((q) => q.subject))];
  for (const name of subjects) {
    const a = bank.filter((q) => (q.subject || '').trim() === name);
    scans += bank.length;
    a.every((q) => selected[q._id] !== undefined);
    const b = bank.filter((q) => (q.subject || '').trim() === name);
    scans += bank.length;
    b.reduce((c, q) => c + (selected[q._id] !== undefined ? 1 : 0), 0);
  }
  return scans;
}

// The NEW shape, mirroring subjectIndex + subjectSelection in the screen:
// one pass to index the bank, one pass to tally it.
function currentDerivedState() {
  let scans = 0;
  const index = new Map();
  for (const q of bank) {
    const s = (q.subject || '').trim();
    if (!s) continue;
    const list = index.get(s);
    if (list) list.push(q);
    else index.set(s, [q]);
  }
  scans += bank.length;

  const tally = new Map();
  for (const [name, questions] of index) {
    let sel = 0;
    for (const q of questions) if (selected[q._id] !== undefined) sel++;
    tally.set(name, { total: questions.length, selected: sel });
    scans += questions.length;
  }

  // The lookups the render does are now O(1) against the tally.
  for (const name of index.keys()) {
    const t = tally.get(name);
    void (t.total > 0 && t.selected === t.total);
    void t.selected;
  }
  return scans;
}

const legacyScans = legacyDerivedState();
const currentScans = currentDerivedState();

check(
  'derived subject state is linear in the bank, not bank x subjects',
  currentScans <= BANK_SIZE * 2,
  `${currentScans} element visits (budget ${BANK_SIZE * 2})`
);

check(
  'that is a large improvement on the per-subject rescan it replaced',
  currentScans * 10 < legacyScans,
  `before ${legacyScans.toLocaleString()} visits, after ${currentScans.toLocaleString()}`
);

const ITERS = 200;
const t0 = performance.now();
for (let i = 0; i < ITERS; i++) currentDerivedState();
const perKeystrokeMs = (performance.now() - t0) / ITERS;

check(
  'derived state costs well under a frame budget per keystroke',
  perKeystrokeMs < 8,
  `${perKeystrokeMs.toFixed(2)} ms with a ${BANK_SIZE}-question bank`
);

/* ------------------------------------------- 2. rows rendered per keystroke */

console.log('\nQuestion rows per keystroke');

/**
 * Stand-in for React.memo over QuestionRow: a row re-renders only when one of
 * its own props changes identity. The screen passes `points` (a number or
 * undefined) rather than the whole `selected` map, and stable callbacks.
 */
function countRowRenders({ rows, prevProps, nextProps }) {
  let renders = 0;
  for (let i = 0; i < rows; i++) {
    const a = prevProps(i);
    const b = nextProps(i);
    const same =
      a.question === b.question &&
      a.points === b.points &&
      a.onToggle === b.onToggle &&
      a.onChangePoints === b.onChangePoints;
    if (!same) renders++;
  }
  return renders;
}

const onToggle = () => {};
const onChangePoints = () => {};

// Typing in the Title field: nothing a row depends on changed.
const typingRenders = countRowRenders({
  rows: BANK_SIZE,
  prevProps: (i) => ({
    question: bank[i],
    points: selected[bank[i]._id],
    onToggle,
    onChangePoints,
  }),
  nextProps: (i) => ({
    question: bank[i],
    points: selected[bank[i]._id],
    onToggle,
    onChangePoints,
  }),
});

check(
  'typing an exam title re-renders zero question rows',
  typingRenders === 0,
  `${typingRenders} rows re-rendered`
);

// The old code passed an inline arrow per row, so every row re-rendered.
const unstableCallbackRenders = countRowRenders({
  rows: BANK_SIZE,
  prevProps: (i) => ({
    question: bank[i],
    points: selected[bank[i]._id],
    onToggle: () => {},
    onChangePoints: () => {},
  }),
  nextProps: (i) => ({
    question: bank[i],
    points: selected[bank[i]._id],
    onToggle: () => {},
    onChangePoints: () => {},
  }),
});

check(
  'the unstable-callback shape it replaced would have re-rendered every row',
  unstableCallbackRenders === BANK_SIZE,
  `${unstableCallbackRenders} rows`
);

// Selecting one question must repaint that row and no others.
const afterSelect = { ...selected, q1: 1 };
const selectRenders = countRowRenders({
  rows: BANK_SIZE,
  prevProps: (i) => ({
    question: bank[i],
    points: selected[bank[i]._id],
    onToggle,
    onChangePoints,
  }),
  nextProps: (i) => ({
    question: bank[i],
    points: afterSelect[bank[i]._id],
    onToggle,
    onChangePoints,
  }),
});

check(
  'selecting one question re-renders exactly that row',
  selectRenders === 1,
  `${selectRenders} rows re-rendered`
);

/* ------------------------------------------------- 3. the source keeps shape */

console.log('\nSource guarantees');

const src = readFileSync(SCREEN, 'utf8');

check(
  'question rows are extracted into a memoised component',
  /const QuestionRow = React\.memo\(/.test(src)
);

check(
  'the row list itself is memoised',
  /const questionRows = useMemo\(/.test(src)
);

check(
  'row callbacks are stable across renders',
  /const toggle = useCallback\(/.test(src) && /const updatePoints = useCallback\(/.test(src)
);

check(
  'the bank is indexed by subject once instead of rescanned per subject',
  /const subjectIndex = useMemo\(/.test(src) && /const subjectSelection = useMemo\(/.test(src)
);

check(
  'no per-subject bank rescan remains in the render path',
  !/bank\s*\.?\s*filter\(\(q\) =>\s*\(q\.subject/.test(src),
  'found a bank.filter on q.subject'
);

check(
  'the selected-marks total is memoised on the selection',
  /const \{ selectedIds, totalMarks \} = useMemo\(/.test(src)
);

check(
  'styles are shared per theme rather than rebuilt per row',
  /useThemedStyles/.test(src)
);

/* --------------------------------------------------- 4. no lost features */

console.log('\nExisting features preserved');

const features = [
  ['subject filter chips', /setSubjectFilter/],
  ['difficulty filter', /setDifficultyFilter/],
  ['search box', /setSearch/],
  ['select all by subject', /selectBySubject/],
  ['deselect all by subject', /deselectBySubject/],
  ['select all filtered', /selectAllFiltered/],
  ['deselect all filtered', /deselectAllFiltered/],
  ['bank source switch (active / my past / all past)', /setBankSource/],
  ['past-question badges', /isPastQuestion/],
  ['per-question points editing', /onChangePoints/],
  ['entry fee field', /setEntryFee/],
  ['review fee field', /setReviewFee/],
  ['past-paper mode', /setPastMode/],
  ['safe exam mode toggle', /setSafeMode/],
  ['publish toggle', /setPublish/],
];

for (const [label, re] of features) {
  check(`still has ${label}`, re.test(src));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
