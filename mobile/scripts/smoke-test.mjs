/**
 * End-to-end smoke test for the mobile app's API layer.
 *
 * Compiles src/api + src/config with the project's TypeScript config, stubs
 * AsyncStorage with an in-memory map, then drives the real endpoint wrappers
 * against scripts/mock-server.js. This verifies URLs, verbs, auth headers,
 * payload shapes and error handling without needing MongoDB or a device.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const PORT = 5099;
const BASE = `http://127.0.0.1:${PORT}`;

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

async function waitForServer(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/`);
      if (r.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

/* ------------------------------------------------ compile the api modules */

const outDir = mkdtempSync(path.join(tmpdir(), 'examapi-'));

// Stubs must sit inside the project so tsc's rootDir stays satisfied.
const stubDir = path.join(root, '.smoke-stubs');
rmSync(stubDir, { recursive: true, force: true });
mkdirSync(stubDir, { recursive: true });
writeFileSync(
  path.join(stubDir, 'async-storage.ts'),
  `const mem = new Map<string, string>();
export default {
  async getItem(k: string) { return mem.has(k) ? mem.get(k)! : null; },
  async setItem(k: string, v: string) { mem.set(k, v); },
  async removeItem(k: string) { mem.delete(k); },
  async removeMany(keys: string[]) { keys.forEach(k => mem.delete(k)); },
  async clear() { mem.clear(); },
};\n`
);
writeFileSync(
  path.join(stubDir, 'expo-constants.ts'),
  `export default { expoConfig: { extra: { apiUrl: '${BASE}' } } };\n`
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
    types: ['node'],
    typeRoots: [path.join(root, 'node_modules/@types')],
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    paths: {
      '@react-native-async-storage/async-storage': [path.join(stubDir, 'async-storage.ts')],
      'expo-constants': [path.join(stubDir, 'expo-constants.ts')],
    },
  },
  include: [
    path.join(root, 'src/api/**/*.ts'),
    path.join(root, 'src/config.ts'),
    path.join(stubDir, '*.ts'),
  ],
};

const tsconfigPath = path.join(outDir, 'tsconfig.smoke.json');
writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));

console.log('Compiling API layer…');
await new Promise((resolve, reject) => {
  const tsc = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['tsc', '-p', tsconfigPath],
    { cwd: root, stdio: 'inherit' }
  );
  tsc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tsc exited ${code}`))));
});

// Emitted ESM needs explicit extensions; add a package.json marker and patch
// the relative import specifiers.
const jsRoot = path.join(outDir, 'js');
writeFileSync(path.join(jsRoot, 'package.json'), JSON.stringify({ type: 'module' }));

const { readFileSync, readdirSync, statSync } = await import('node:fs');
function patch(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) patch(full);
    else if (full.endsWith('.js')) {
      let src = readFileSync(full, 'utf8');
      src = src.replace(/from ['"](\.[^'"]+)['"]/g, (m, spec) =>
        spec.endsWith('.js') ? m : `from '${spec}.js'`
      );
      // Map the bare stub specifiers onto the emitted stub files.
      const rel = path.relative(path.dirname(full), path.join(jsRoot, '.smoke-stubs'));
      const prefix = rel.startsWith('.') ? rel : `./${rel}`;
      src = src.replace(
        /from ['"]@react-native-async-storage\/async-storage['"]/g,
        `from '${prefix}/async-storage.js'`
      );
      src = src.replace(/from ['"]expo-constants['"]/g, `from '${prefix}/expo-constants.js'`);
      writeFileSync(full, src);
    }
  }
}
patch(jsRoot);

/* ---------------------------------------------------------- start the API */

console.log('Starting mock API…');
const server = spawn('node', [path.join(root, 'scripts', 'mock-server.js'), String(PORT)], {
  stdio: 'ignore',
});

const ready = await waitForServer();
if (!ready) {
  server.kill();
  console.error('Mock server did not start.');
  process.exit(1);
}

/* --------------------------------------------------------------- the test */

try {
  const clientMod = path.join(jsRoot, 'src/api/client.js');
  const endpointsMod = path.join(jsRoot, 'src/api/endpoints.js');
  const { getToken, clearSession, ApiError } = await import(clientMod);
  const { authApi, examsApi, attemptsApi, questionsApi, adminApi, paymentsApi, configApi } =
    await import(endpointsMod);

  console.log('\nAuth');
  const login = await authApi.login('teacher@example.com', 'secret');
  check('login returns token + user', !!login.token && login.user.role === 'teacher');

  // Simulate what AuthContext does after a successful login.
  const { setToken } = await import(clientMod);
  await setToken(login.token);
  check('token persisted to storage', (await getToken()) === login.token);

  const me = await authApi.me();
  check('GET /me sends bearer token', !!me.user);

  let rejected = false;
  try {
    await authApi.login('teacher@example.com', 'wrong');
  } catch (e) {
    rejected = e instanceof ApiError && e.status === 401;
  }
  check('bad password surfaces ApiError(401)', rejected);

  const reg = await authApi.register('New Person', 'new@example.com', 'pw1234', 'student');
  check('register returns created user', reg.user.email === 'new@example.com');

  console.log('\nStudent flow');
  const pub = await examsApi.joinPublic('ABCD1234');
  check('join-public resolves exam', pub.exam.title === 'Sample Quiz');

  let notFound = false;
  try {
    await examsApi.joinPublic('NOPE');
  } catch (e) {
    notFound = e.status === 404;
  }
  check('bad access code returns 404', notFound);

  const guest = await authApi.guestRegister('Guest One', 'guest@example.com', 'ABCD1234');
  check('guest-register returns examId', guest.examId === 'e1');

  await setToken(login.token);
  const joined = await examsApi.join('ABCD1234');
  check('authenticated join works', joined.exam._id === 'e1');

  const takeExam = await examsApi.take('e1');
  check('take endpoint returns questions', takeExam.questions.length === 1);

  const started = await attemptsApi.start('e1');
  check('start attempt returns attempt id', started.attempt._id === 'a1');

  const saved = await attemptsApi.saveAnswer('a1', { questionId: 'q1', selectedOption: 1 });
  check('save answer acknowledged', saved.message === 'Answer saved');

  const submitted = await attemptsApi.submit('a1');
  check(
    'submit returns score + percentage',
    submitted.passed === true && submitted.percentage === '100.00'
  );

  const mine = await attemptsApi.myAttempts();
  check('my-attempts returns history', Array.isArray(mine) && mine.length === 1);

  console.log('\\nPayments (past questions)');
  const cfg = await configApi.get();
  check(
    'config exposes naira + dev mode',
    cfg.currency === 'NGN' && cfg.paymentsDevMode === true
  );
  check(
    'config exposes default fees (300 entry / 500 review)',
    cfg.defaultEntryFee === 300 && cfg.defaultReviewFee === 500
  );

  const past = await examsApi.past();
  check(
    'past library lists paid paper',
    past.exams.length === 1 && past.exams[0].pricing.entryFee === 300 && past.exams[0].pricing.reviewFee === 500
  );
  check('past paper locked until paid', past.exams[0].purchasedEntry === false);

  let locked = false;
  try {
    await attemptsApi.start('e2');
  } catch (e) {
    locked = e instanceof ApiError && e.status === 402;
  }
  check('start of unpaid past paper returns 402', locked);

  const init = await paymentsApi.initiate('e2', 'entry');
  check(
    'initiate payment returns sandbox payment',
    init.devMode === true && init.payment.reference === 'PST-MOCK-1'
  );

  const done = await paymentsApi.devComplete('PST-MOCK-1');
  check('dev-complete marks payment paid', done.payment.status === 'paid');

  const verified = await paymentsApi.verify('PST-MOCK-1');
  check('verify confirms the payment', verified.paid === true);

  const startedPaid = await attemptsApi.start('e2');
  check('paid paper can now be started', !!startedPaid.attempt);

  const review = await attemptsApi.review('a1');
  check(
    'answer review returns questions with correct answers',
    review.questions.length === 1 &&
      review.questions[0].correctOptionIndex === 1 &&
      review.questions[0].correctAnswer === '4' &&
      review.questions[0].isCorrect === true
  );

  const myPayments = await paymentsApi.myPayments();
  check('my-payments returns history list', Array.isArray(myPayments));

  console.log('\nTeacher flow');
  const myExams = await examsApi.myExams();
  check('my-exams returns list', myExams.length === 1);

  const created = await examsApi.create({ title: 'X', questions: [] });
  check('create exam returns access code', created.accessCode === 'ABCD1234');

  const stats = await examsApi.stats('e1');
  check('exam stats returns aggregates', stats.stats.passRate === 100);

  const unpub = await examsApi.publish('e1', false);
  check('publish toggle sends body', unpub.exam.settings.isPublished === false);

  const qs = await questionsApi.list();
  check('question bank lists questions', qs.total === 1);

  const newQ = await questionsApi.create({ questionText: 'Q?', questionType: 'essay' });
  check('create question returns id', newQ._id === 'q2');

  const bulk = await questionsApi.bulkUpload({
    uri: 'file:///tmp/questions.csv',
    name: 'questions.csv',
    type: 'text/csv',
  });
  check('bulk upload returns imported count', bulk.count === 3);

  console.log('\nAdmin');
  const adminStats = await adminApi.stats();
  check('admin stats shape matches backend', adminStats.totalUsers === 3);
  check('admin stats include revenue', typeof adminStats.payments?.totalRevenue === 'number');

  const adminPayments = await adminApi.payments();
  check(
    'admin payments returns list + totals',
    Array.isArray(adminPayments.payments) && typeof adminPayments.totals?.totalRevenue === 'number'
  );

  const adminUsers = await adminApi.users();
  check('admin users returns list', adminUsers.users.length === 2);

  console.log('\nSession handling');
  await clearSession();
  check('clearSession wipes token', (await getToken()) === null);

  let unauth = false;
  try {
    await examsApi.myExams();
  } catch (e) {
    unauth = e.status === 401;
  }
  check('requests without token are rejected', unauth);

  // Confirm the auth header actually reached the server on protected calls.
  const callLog = await (await fetch(`${BASE}/__calls`)).json();
  const protectedCalls = callLog.filter(
    (c) => c.key === 'GET /api/exams/my-exams' || c.key === 'POST /api/attempts/start'
  );
  check(
    'protected calls carried Authorization header',
    protectedCalls.some((c) => c.authed)
  );

  const answerCall = callLog.find((c) => c.key === 'PATCH /api/attempts/a1/answer');
  check(
    'answer payload uses questionId + selectedOption',
    answerCall?.body?.questionId === 'q1' && answerCall?.body?.selectedOption === 1
  );
} catch (err) {
  failed++;
  console.error('\nUnexpected failure:', err);
} finally {
  server.kill();
  rmSync(outDir, { recursive: true, force: true });
  rmSync(stubDir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
