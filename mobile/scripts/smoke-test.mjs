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

  console.log('\nConfig');
  const cfg = await configApi.get();
  check(
    'config exposes naira + dev mode',
    cfg.currency === 'NGN' && cfg.paymentsDevMode === true
  );
  check(
    'config exposes default fees (300 entry / 500 review)',
    cfg.defaultEntryFee === 300 && cfg.defaultReviewFee === 500
  );
  check(
    'config exposes registration fee + existing-students toggle',
    cfg.studentRegistrationFee === 1200 &&
      cfg.studentRegistrationFeeActive === true &&
      cfg.applyRegistrationFeeToExistingStudents === true
  );

  console.log('\nAuth');
  const teacherLogin = await authApi.login('teacher@example.com', 'secret');
  check('teacher login returns token + user', !!teacherLogin.token && teacherLogin.user.role === 'teacher');

  const adminLogin = await authApi.login('admin@example.com', 'secret');
  check('admin login is never charged', !!adminLogin.token && adminLogin.user.role === 'admin');

  const { setToken } = await import(clientMod);
  await setToken(teacherLogin.token);
  check('token persisted to storage', (await getToken()) === teacherLogin.token);

  const me = await authApi.me();
  check('GET /me sends bearer token', !!me.user);

  let rejected = false;
  try {
    await authApi.login('teacher@example.com', 'wrong');
  } catch (e) {
    rejected = e instanceof ApiError && e.status === 401;
  }
  check('bad password surfaces ApiError(401)', rejected);

  let studentBlocked = null;
  try {
    await authApi.login('student@example.com', 'secret');
  } catch (e) {
    studentBlocked = e;
  }
  check(
    'unpaid student login returns 402 registration paywall',
    studentBlocked instanceof ApiError &&
      studentBlocked.status === 402 &&
      studentBlocked.data?.purpose === 'registration' &&
      studentBlocked.data?.amount === 1200
  );

  const regPaymentToken = studentBlocked?.data?.paymentToken;
  const regInit = await paymentsApi.initiate({ purpose: 'registration', paymentToken: regPaymentToken });
  check(
    'registration initiate returns sandbox payment',
    regInit.devMode === true && regInit.payment.reference === 'REG-MOCK-1'
  );

  // Reference-free recovery: the app must be able to ask "did this get paid?"
  // without still holding the reference, because Paystack's callback URL comes
  // back to the app root and drops the query string.
  const regPendingStatus = await paymentsApi.status({
    purpose: 'registration',
    paymentToken: regPaymentToken,
  });
  check(
    'registration status reports the reusable pending charge',
    regPendingStatus.paid === false && regPendingStatus.pending?.reference === 'REG-MOCK-1'
  );
  check(
    'pending status carries a resume link so no second charge is created',
    typeof regPendingStatus.pending?.authorizationUrl === 'string' &&
      regPendingStatus.pending.authorizationUrl.length > 0
  );

  const regDone = await paymentsApi.devComplete('REG-MOCK-1', regPaymentToken);
  check('registration dev-complete marks paid', regDone.payment.status === 'paid');

  const regVerified = await paymentsApi.verify('REG-MOCK-1', regPaymentToken);
  check('registration verify confirms the payment', regVerified.paid === true);

  const regPaidStatus = await paymentsApi.status({
    purpose: 'registration',
    paymentToken: regPaymentToken,
  });
  check(
    'registration status stays paid without a reference (survives refresh)',
    regPaidStatus.paid === true && regPaidStatus.pending === null
  );

  let regStatusUnauth = null;
  try {
    await paymentsApi.status({ purpose: 'registration', paymentToken: 'wrong-token' });
  } catch (e) {
    regStatusUnauth = e;
  }
  check(
    'registration status rejects a bad payment token',
    regStatusUnauth instanceof ApiError && regStatusUnauth.status === 401
  );

  const studentLogin = await authApi.login('student@example.com', 'secret');
  check('student can log in after registration payment', !!studentLogin.token && studentLogin.user.role === 'student');

  const teacherRegister = await authApi.register('Teacher Two', 'teach2@example.com', 'pw1234', 'teacher');
  check('teacher self-register is never charged', teacherRegister.user.role === 'teacher' && !!teacherRegister.token);

  let studentRegisterBlocked = false;
  try {
    await authApi.register('New Student', 'newstudent@example.com', 'pw1234', 'student');
  } catch (e) {
    studentRegisterBlocked = e instanceof ApiError && e.status === 402 && e.data?.purpose === 'registration';
  }
  check('student register returns 402 when fee is active', studentRegisterBlocked);

  console.log('\nStudent flow');
  await setToken(studentLogin.token);

  let joinPublicBlocked = false;
  try {
    await clearSession();
    await examsApi.joinPublic('ABCD1234');
  } catch (e) {
    joinPublicBlocked = e instanceof ApiError && e.status === 401;
  }
  check('join-public no longer works without auth', joinPublicBlocked);

  let guestRegisterBlocked = false;
  try {
    await authApi.guestRegister('Guest One', 'guest@example.com', 'ABCD1234');
  } catch (e) {
    guestRegisterBlocked = e instanceof ApiError && e.status === 410;
  }
  check('guest-register no longer auto-creates accounts', guestRegisterBlocked);

  await setToken(studentLogin.token);
  const joined = await examsApi.join('ABCD1234');
  check('authenticated join still works with a valid access code', joined.exam._id === 'e1');

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

  const init = await paymentsApi.initiate({ examId: 'e2', purpose: 'entry' });
  check(
    'initiate payment returns sandbox payment',
    init.devMode === true && init.payment.reference === 'PST-MOCK-1'
  );

  const entryPending = await paymentsApi.status({ purpose: 'entry', examId: 'e2' });
  check(
    'entry status finds the pending charge to reuse',
    entryPending.paid === false && entryPending.pending?.reference === 'PST-MOCK-1'
  );

  const done = await paymentsApi.devComplete('PST-MOCK-1');
  check('dev-complete marks payment paid', done.payment.status === 'paid');

  const verified = await paymentsApi.verify('PST-MOCK-1');
  check('verify confirms the payment', verified.paid === true);

  const entryPaid = await paymentsApi.status({ purpose: 'entry', examId: 'e2' });
  check(
    'entry status stays paid without a reference (survives refresh)',
    entryPaid.paid === true && entryPaid.payment?.reference === 'PST-MOCK-1'
  );

  let entryStatusBadPurpose = null;
  try {
    await paymentsApi.status({ purpose: 'nonsense', examId: 'e2' });
  } catch (e) {
    entryStatusBadPurpose = e;
  }
  check(
    'status rejects an unknown purpose',
    entryStatusBadPurpose instanceof ApiError && entryStatusBadPurpose.status === 400
  );

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
  await setToken(teacherLogin.token);
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
  await setToken(adminLogin.token);
  const adminStats = await adminApi.stats();
  check('admin stats shape matches backend', adminStats.totalUsers === 4);
  check(
    'admin stats include registration revenue/count fields',
    typeof adminStats.payments?.registrationCount === 'number' &&
      typeof adminStats.payments?.registrationRevenue === 'number'
  );

  const adminConfig = await adminApi.config();
  check(
    'admin config returns registration fee settings',
    adminConfig.studentRegistrationFee === 1200 && adminConfig.applyRegistrationFeeToExistingStudents === true
  );

  const adminConfigSaved = await adminApi.updateConfig({
    studentRegistrationFee: 0,
    applyRegistrationFeeToExistingStudents: false,
  });
  check(
    'admin can update registration fee and existing-students toggle',
    adminConfigSaved.config.studentRegistrationFee === 0 &&
      adminConfigSaved.config.applyRegistrationFeeToExistingStudents === false
  );

  const adminPayments = await adminApi.payments();
  check(
    'admin payments returns list + totals with registrationCount',
    Array.isArray(adminPayments.payments) && typeof adminPayments.totals?.registrationCount === 'number'
  );

  const adminUsers = await adminApi.users({ page: 1, limit: 2, sort: 'name_asc' });
  check(
    'admin users returns a deliberate first page + total metadata',
    adminUsers.users.length === 2 && adminUsers.total === 4 && adminUsers.pages === 2
  );
  check(
    'admin users A-Z sort is applied before pagination',
    adminUsers.users.map((u) => u.name).join('|') === 'Ada Teacher|Admin User'
  );

  const adminUsersPage2 = await adminApi.users({ page: 2, limit: 2, sort: 'name_asc' });
  check(
    'admin users can load the next page without duplicates',
    adminUsersPage2.users.map((u) => u.name).join('|') === 'Existing Student|Sam Student' &&
      [...adminUsers.users, ...adminUsersPage2.users].map((u) => u._id).length ===
        new Set([...adminUsers.users, ...adminUsersPage2.users].map((u) => u._id)).size
  );

  const adminUsersDesc = await adminApi.users({ page: 1, limit: 2, sort: 'name_desc' });
  check(
    'admin users supports global Z-A sorting',
    adminUsersDesc.users.map((u) => u.name).join('|') === 'Sam Student|Existing Student'
  );

  const searchedUsers = await adminApi.users({
    search: 'existing@example.com',
    page: 1,
    limit: 2,
    sort: 'newest',
  });
  check(
    'admin user search runs against all mock users before pagination',
    searchedUsers.total === 1 && searchedUsers.users[0]?.email === 'existing@example.com'
  );

  const adminScreen = readFileSync(
    path.join(root, 'src/screens/admin/AdminPanelScreen.tsx'),
    'utf8'
  );
  check(
    'admin user UI debounces server search',
    /USER_SEARCH_DEBOUNCE_MS\s*=\s*400/.test(adminScreen) &&
      /setTimeout\([\s\S]*setDebouncedSearch/.test(adminScreen) &&
      /search:\s*debouncedSearch/.test(adminScreen)
  );
  check(
    'admin user UI exposes Load more and loaded/total counts',
    /title=\{`Load more/.test(adminScreen) &&
      /Loaded \$\{users\.length\} of \$\{userTotal\}/.test(adminScreen)
  );
  check(
    'admin bulk reset explicitly applies beyond the visible page',
    /across every page and search result/.test(adminScreen) &&
      /not only the loaded list/.test(adminScreen)
  );

  const selectedPageUser = adminUsersPage2.users.find((u) => u._id === 'u_student');
  const singleReset = await adminApi.resetUserPassword(selectedPageUser?._id || 'missing');
  check(
    'admin can reset the exact user selected from a later page',
    singleReset.user._id === 'u_student' && singleReset.user.mustChangePassword === true
  );

  const bulkReset = await adminApi.resetAllStudentPasswords();
  check('admin can bulk reset all student passwords', bulkReset.resetCount === 2);

  const teacherStillWorks = await authApi.login('teacher@example.com', 'secret');
  check('bulk reset excludes teachers/admins', teacherStillWorks.user.role === 'teacher');

  const studentWithDefault = await authApi.login('student@example.com', '123456');
  check('reset student logs in with 123456 and mustChangePassword', studentWithDefault.user.mustChangePassword === true);

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

  const callLog = await (await fetch(`${BASE}/__calls`)).json();
  const pagedUserCall = callLog.find(
    (c) => c.key === 'GET /api/admin/users' && c.query?.page === '2'
  );
  check(
    'admin API forwards page, limit and sort query parameters',
    pagedUserCall?.query?.limit === '2' && pagedUserCall?.query?.sort === 'name_asc'
  );
  const searchedUserCall = callLog.find(
    (c) => c.key === 'GET /api/admin/users' && c.query?.search === 'existing@example.com'
  );
  check(
    'admin API forwards backend search with pagination',
    searchedUserCall?.query?.page === '1' && searchedUserCall?.query?.limit === '2'
  );

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
