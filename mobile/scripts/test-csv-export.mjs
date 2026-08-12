/**
 * Regression test for "CSV download/export of results is missing".
 *
 * The export helpers in src/utils/csv.ts survived, but every call site was
 * dropped, so there was no longer any way to reach them from the UI. This
 * suite covers both halves of that:
 *
 *   1. the helpers produce VALID CSV (quoting, embedded commas/quotes/
 *      newlines, unicode, empty cells) — verified by parsing the output back
 *   2. the export buttons are actually wired up on the screens that had them
 *
 * Run: node scripts/test-csv-export.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

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

/* ------------------------------------------- compile src/utils/csv.ts */

const outDir = mkdtempSync(path.join(tmpdir(), 'examcsv-'));
const stubDir = path.join(root, '.csv-stubs');
rmSync(stubDir, { recursive: true, force: true });
mkdirSync(stubDir, { recursive: true });

// csv.ts imports Platform from react-native purely to decide whether a
// browser download is possible. Stub it as web so downloadCsv takes the real
// path, and provide the DOM bits it touches.
writeFileSync(
  path.join(stubDir, 'react-native.ts'),
  `export const Platform = { OS: 'web' };\n`
);

const tsconfig = {
  compilerOptions: {
    target: 'ES2022',
    module: 'ES2022',
    moduleResolution: 'bundler',
    outDir: path.join(outDir, 'js'),
    rootDir: root,
    strict: false,
    skipLibCheck: true,
    types: [],
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    paths: { 'react-native': [path.join(stubDir, 'react-native.ts')] },
  },
  include: [path.join(root, 'src/utils/csv.ts'), path.join(stubDir, '*.ts')],
};

const tsconfigPath = path.join(outDir, 'tsconfig.csv.json');
writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));

console.log('Compiling CSV helpers…');
await new Promise((resolve, reject) => {
  const tsc = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['tsc', '-p', tsconfigPath],
    { cwd: root, stdio: 'inherit' }
  );
  tsc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tsc exited ${code}`))));
});

const jsRoot = path.join(outDir, 'js');
writeFileSync(path.join(jsRoot, 'package.json'), JSON.stringify({ type: 'module' }));

// Emitted ESM needs explicit extensions and the stub specifier remapped.
const csvJs = path.join(jsRoot, 'src/utils/csv.js');
{
  let src = readFileSync(csvJs, 'utf8');
  const rel = path
    .relative(path.dirname(csvJs), path.join(jsRoot, '.csv-stubs'))
    .replace(/\\/g, '/');
  src = src.replace(
    /from ['"]react-native['"]/g,
    `from '${rel.startsWith('.') ? rel : `./${rel}`}/react-native.js'`
  );
  writeFileSync(csvJs, src);
}

/* --------------------------------------------------------- a CSV parser */

/** Minimal RFC-4180 reader, so we assert on parsed cells not on string shape. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (c !== '\r') cell += c;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

try {
  const { buildCsv, csvEscape, safeFilename, downloadCsv } = await import(csvJs);

  /* ------------------------------------------------------- the helpers */

  console.log('\nCSV generation');

  const simple = buildCsv(['Exam', 'Score'], [['Maths', 10]]);
  check(
    'header and rows round-trip',
    JSON.stringify(parseCsv(simple)) === JSON.stringify([['Exam', 'Score'], ['Maths', '10']]),
    simple
  );

  const nasty = buildCsv(
    ['Name', 'Note', 'Score'],
    [
      ['Doe, Jane', 'She said "hi"', 5],
      ['Line\nbreak', 'plain', 0],
      [null, undefined, ''],
      ['Ada Ọlá', 'unicode ₦500', 7],
    ]
  );
  const parsedNasty = parseCsv(nasty);

  check('a comma inside a value does not create a column', parsedNasty[1].length === 3);
  check('a value containing a comma survives', parsedNasty[1][0] === 'Doe, Jane');
  check('embedded double quotes are unescaped correctly', parsedNasty[1][1] === 'She said "hi"');
  check('an embedded newline stays inside one cell', parsedNasty[2][0] === 'Line\nbreak');
  check('null and undefined become empty cells', parsedNasty[3][0] === '' && parsedNasty[3][1] === '');
  check('unicode is preserved', parsedNasty[4][0] === 'Ada Ọlá' && parsedNasty[4][1] === 'unicode ₦500');
  check(
    'every row has the same column count as the header',
    parsedNasty.every((r) => r.length === parsedNasty[0].length),
    JSON.stringify(parsedNasty.map((r) => r.length))
  );

  check('csvEscape leaves a plain value alone', csvEscape('plain') === 'plain');
  check('csvEscape quotes a value with a comma', csvEscape('a,b') === '"a,b"');
  check('csvEscape doubles inner quotes', csvEscape('a"b') === '"a""b"');

  check('safeFilename slugifies a title', safeFilename('Mid-Term Test 2024!') === 'mid-term-test-2024');
  check('safeFilename falls back for an empty title', safeFilename('   ') === 'results');

  const emptyExport = buildCsv(['Exam', 'Score'], []);
  check('a header-only export is still valid CSV', parseCsv(emptyExport).length === 1);

  /* -------------------------------------------------- the download path */

  console.log('\nBrowser download');

  const clicks = [];
  const created = [];
  globalThis.Blob = class {
    constructor(parts, opts) {
      this.parts = parts;
      this.type = opts?.type;
    }
  };
  globalThis.URL = {
    createObjectURL: (blob) => {
      created.push(blob);
      return 'blob:fake';
    },
    revokeObjectURL: () => {},
  };
  globalThis.document = {
    createElement: () => ({ style: {}, click() { clicks.push(this); } }),
    body: { appendChild() {}, removeChild() {} },
  };

  const ok = downloadCsv('my-results', 'Exam,Score\nMaths,10');
  check('downloadCsv reports success on web', ok === true);
  check('it clicked a download link', clicks.length === 1);
  check('the .csv extension is added when missing', clicks[0]?.download === 'my-results.csv');
  check('the blob is typed as CSV', created[0]?.type === 'text/csv;charset=utf-8');

  const ok2 = downloadCsv('already.csv', 'a,b');
  check('an existing .csv extension is not doubled', ok2 && clicks[1]?.download === 'already.csv');

  /* ------------------------------------------------- the call sites exist */

  console.log('\nExport buttons are wired up');

  const read = (p) => readFileSync(path.join(root, p), 'utf8');

  const stats = read('src/screens/teacher/ExamStatsScreen.tsx');
  check('teacher exam results import the CSV helpers', /from '\.\.\/\.\.\/utils\/csv'/.test(stats));
  check('teacher exam results have a Download CSV button', /title="Download CSV"/.test(stats));
  check('teacher export builds a CSV', /buildCsv\(/.test(stats) && /downloadCsv\(/.test(stats));
  check(
    'teacher export names the file after the exam',
    /safeFilename\(examTitle\)/.test(stats)
  );
  check(
    'teacher export includes student identity columns',
    /'Student name'/.test(stats) && /'Student email'/.test(stats)
  );
  check(
    'teacher export includes the marking outcome',
    /'Percentage'/.test(stats) && /'Passed'/.test(stats)
  );
  check(
    'teacher export is disabled when there is nothing to export',
    /disabled=\{attempts\.length === 0\}/.test(stats)
  );
  check(
    'native builds are told why the download did not happen',
    /Download unavailable/.test(stats)
  );

  const results = read('src/screens/student/ResultsScreen.tsx');
  check('student results import the CSV helpers', /from '\.\.\/\.\.\/utils\/csv'/.test(results));
  check('student results have a Download CSV button', /title="Download CSV"/.test(results));
  check('student export builds a CSV', /buildCsv\(/.test(results) && /downloadCsv\(/.test(results));
  check(
    'student export does not leak scores the teacher hid',
    /canSeeScore\(item\)/.test(results) && /'Hidden'/.test(results)
  );
  check(
    'student export is disabled when there are no results',
    /disabled=\{attempts\.length === 0\}/.test(results)
  );

  const admin = read('src/screens/admin/AdminPanelScreen.tsx');
  check('admin panel imports the CSV helpers', /from '\.\.\/\.\.\/utils\/csv'/.test(admin));
  check('admin can export all attempts', /downloadAttempts/.test(admin));
  check('admin can export payments', /downloadPayments/.test(admin));
  check(
    'admin exports are disabled when empty',
    /disabled=\{attempts\.length === 0\}/.test(admin) &&
      /disabled=\{payments\.length === 0\}/.test(admin)
  );
} catch (err) {
  failed++;
  console.error('\nUnexpected failure:', err);
} finally {
  rmSync(outDir, { recursive: true, force: true });
  rmSync(stubDir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
