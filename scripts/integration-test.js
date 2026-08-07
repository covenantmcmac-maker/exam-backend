/**
 * Route-level integration test for registration fees, access-code auth, paid
 * past papers, and admin password resets.
 *
 * Boots the REAL Express app (server.js + all routes) with an in-memory
 * mongoose stand-in (scripts/stub-mongoose.js) so the whole flow can be
 * exercised without MongoDB.
 *
 * Run: node scripts/integration-test.js
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

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

async function main() {
  const PORT = 5999;
  const base = `http://127.0.0.1:${PORT}`;

  const child = spawn(process.execPath, [path.join(__dirname, 'run-with-stub.js')], {
    env: {
      ...process.env,
      JWT_SECRET: 'route-test-secret',
      PORT: String(PORT),
      NODE_ENV: 'test',
      PAYSTACK_SECRET_KEY: '',
    },
    stdio: 'inherit',
  });

  await new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      http.get(base + '/', (r) => {
        r.resume();
        resolve();
      }).on('error', () =>
        Date.now() - t0 > 15000
          ? reject(new Error('server timeout'))
          : setTimeout(tick, 150)
      );
    };
    tick();
  });

  const j = (res) =>
    new Promise((resolve) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : {} });
        } catch {
          resolve({ status: res.statusCode, body: { message: raw } });
        }
      });
    });

  const req = (method, pathname, { token, body } = {}) =>
    new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null;
      const r = http.request(
        base + pathname,
        {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          },
        },
        (res) => j(res).then(resolve)
      );
      r.on('error', reject);
      if (payload) r.write(payload);
      r.end();
    });

  try {
    console.log('\nSetup');
    const admin = await req('POST', '/api/auth/register', {
      body: { name: 'Boss', email: 'admin@x.com', password: 'secret1', role: 'admin' },
    });
    const teacher = await req('POST', '/api/auth/register', {
      body: { name: 'Ms Ada', email: 'ada@x.com', password: 'secret1', role: 'teacher' },
    });
    const studentExisting = await req('POST', '/api/auth/register', {
      body: { name: 'Legacy Student', email: 'legacy@x.com', password: 'secret1', role: 'student' },
    });
    const studentPaid = await req('POST', '/api/auth/register', {
      body: { name: 'Sam', email: 'sam@x.com', password: 'secret1', role: 'student' },
    });

    check('admin registered', admin.status === 201 && admin.body.user?.role === 'admin');
    check('teacher registered', teacher.status === 201 && teacher.body.user?.role === 'teacher');
    check('legacy student registered', studentExisting.status === 201 && studentExisting.body.user?.role === 'student');
    check('paying student registered before fee activation', studentPaid.status === 201);

    const adminTok = admin.body.token;
    const teacherTok = teacher.body.token;

    console.log('\nPublic config + admin pricing control');
    const cfgFree = await req('GET', '/api/config');
    check('config defaults to free registration', cfgFree.body.studentRegistrationFee === 0 && cfgFree.body.studentRegistrationFeeActive === false);

    const cfgOn = await req('PATCH', '/api/admin/config', {
      token: adminTok,
      body: { studentRegistrationFee: 1200, applyRegistrationFeeToExistingStudents: true },
    });
    check('admin can enable registration fee', cfgOn.status === 200 && cfgOn.body.config.studentRegistrationFee === 1200 && cfgOn.body.config.applyRegistrationFeeToExistingStudents === true, JSON.stringify(cfgOn.body));

    const cfgPaid = await req('GET', '/api/config');
    check('public config exposes active registration fee', cfgPaid.body.studentRegistrationFee === 1200 && cfgPaid.body.studentRegistrationFeeActive === true);

    console.log('\nLogin gating + one-time registration payment');
    const teacherLogin = await req('POST', '/api/auth/login', {
      body: { email: 'ada@x.com', password: 'secret1' },
    });
    const adminLogin = await req('POST', '/api/auth/login', {
      body: { email: 'admin@x.com', password: 'secret1' },
    });
    check('teachers are never charged', teacherLogin.status === 200 && teacherLogin.body.user.role === 'teacher');
    check('admins are never charged', adminLogin.status === 200 && adminLogin.body.user.role === 'admin');

    const studentBlocked = await req('POST', '/api/auth/login', {
      body: { email: 'sam@x.com', password: 'secret1' },
    });
    check('unpaid student login returns 402 registration paywall', studentBlocked.status === 402 && studentBlocked.body.purpose === 'registration' && studentBlocked.body.amount === 1200 && !!studentBlocked.body.paymentToken, JSON.stringify(studentBlocked.body));

    const regInit = await req('POST', '/api/payments/initiate', {
      body: { purpose: 'registration', paymentToken: studentBlocked.body.paymentToken },
    });
    check('registration payment can be initiated without auth token', regInit.status === 201 && regInit.body.payment.purpose === 'registration' && regInit.body.payment.exam === null, JSON.stringify(regInit.body));

    const regDup = await req('POST', '/api/payments/initiate', {
      body: { purpose: 'registration', paymentToken: studentBlocked.body.paymentToken },
    });
    check('registration re-initiate reuses pending payment', regDup.status === 200 && regDup.body.payment.reference === regInit.body.payment.reference, JSON.stringify(regDup.body));

    const regDone = await req('POST', `/api/payments/${regInit.body.payment.reference}/dev-complete`, {
      body: { paymentToken: studentBlocked.body.paymentToken },
    });
    check('registration dev-complete marks paid', regDone.status === 200 && regDone.body.payment.status === 'paid');

    const regVerify = await req('GET', `/api/payments/${regInit.body.payment.reference}/verify?paymentToken=${encodeURIComponent(studentBlocked.body.paymentToken)}`);
    check('registration verify confirms payment', regVerify.status === 200 && regVerify.body.paid === true);

    const studentUnlocked = await req('POST', '/api/auth/login', {
      body: { email: 'sam@x.com', password: 'secret1' },
    });
    check('paid student can log in after registration payment', studentUnlocked.status === 200 && studentUnlocked.body.user.role === 'student');
    const studentTok = studentUnlocked.body.token;

    const cfgExistingOff = await req('PATCH', '/api/admin/config', {
      token: adminTok,
      body: { applyRegistrationFeeToExistingStudents: false },
    });
    check('admin can exempt students created before fee activation', cfgExistingOff.status === 200 && cfgExistingOff.body.config.applyRegistrationFeeToExistingStudents === false);

    const legacyLogin = await req('POST', '/api/auth/login', {
      body: { email: 'legacy@x.com', password: 'secret1' },
    });
    check('existing student is exempt when toggle is off', legacyLogin.status === 200 && legacyLogin.body.user.role === 'student', JSON.stringify(legacyLogin.body));
    const legacyTok = legacyLogin.body.token;

    const newStudent = await req('POST', '/api/auth/register', {
      body: { name: 'Fresh', email: 'fresh@x.com', password: 'secret1', role: 'student' },
    });
    check('new student registration returns 402 when fee is active', newStudent.status === 402 && newStudent.body.purpose === 'registration' && !!newStudent.body.paymentToken, JSON.stringify(newStudent.body));

    const freshRegInit = await req('POST', '/api/payments/initiate', {
      body: { purpose: 'registration', paymentToken: newStudent.body.paymentToken },
    });
    await req('POST', `/api/payments/${freshRegInit.body.payment.reference}/dev-complete`, {
      body: { paymentToken: newStudent.body.paymentToken },
    });
    const freshLogin = await req('POST', '/api/auth/login', {
      body: { email: 'fresh@x.com', password: 'secret1' },
    });
    check('new student can log in after paying registration fee', freshLogin.status === 200 && freshLogin.body.user.role === 'student');

    console.log('\nQuestion + exams');
    const q1 = await req('POST', '/api/questions', {
      token: adminTok,
      body: {
        questionText: '2+2?',
        questionType: 'multiple-choice',
        options: [{ text: '3', isCorrect: false }, { text: '4', isCorrect: true }],
        explanation: 'Basic addition',
        subject: 'Maths',
      },
    });
    const q2 = await req('POST', '/api/questions', {
      token: adminTok,
      body: {
        questionText: 'Capital of Nigeria?',
        questionType: 'short-answer',
        correctAnswer: 'Abuja',
        explanation: 'Abuja since 1991',
        subject: 'Geography',
      },
    });
    check('admin created questions', q1.status === 201 && q2.status === 201);

    const teacherExam = await req('POST', '/api/exams', {
      token: teacherTok,
      body: {
        title: 'Quiz 1',
        subject: 'Maths',
        pricing: { reviewFee: 50 },
        settings: { duration: 10, maxAttempts: 1, isPublished: true },
        questions: [{ question: q1.body._id, points: 2 }],
      },
    });
    check('teacher exam still forces free entry', teacherExam.status === 201 && teacherExam.body.exam.pricing.entryFee === 0 && teacherExam.body.exam.pricing.reviewFee === 50);
    const teacherExamId = teacherExam.body.exam._id;
    const teacherExamCode = teacherExam.body.exam.accessCode;

    const past = await req('POST', '/api/exams', {
      token: adminTok,
      body: {
        title: 'Biology 2022',
        subject: 'Biology',
        source: 'past',
        year: 2022,
        pricing: { entryFee: 500, reviewFee: 100 },
        settings: { duration: 30, passingMarks: 40, maxAttempts: 1, isPublished: true, allowReview: true },
        questions: [{ question: q1.body._id, points: 2 }, { question: q2.body._id, points: 1 }],
      },
    });
    check('admin created paid past paper with fees', past.status === 201 && past.body.exam.pricing.entryFee === 500 && past.body.exam.pricing.reviewFee === 100 && past.body.exam.source === 'past');
    const pastId = past.body.exam._id;

    console.log('\nAccess codes now require auth');
    const noAuthJoinPublic = await req('POST', '/api/exams/join-public', { body: { accessCode: teacherExamCode } });
    check('join-public without auth is blocked', noAuthJoinPublic.status === 401);

    const guestGone = await req('POST', '/api/auth/guest-register', {
      body: { name: 'Guest', email: 'guest@x.com', examCode: teacherExamCode },
    });
    check('guest-register is disabled', guestGone.status === 410);

    const takeWithoutJoin = await req('GET', `/api/exams/${teacherExamId}/take`, { token: studentTok });
    check('teacher exam take is blocked until access code join succeeds', takeWithoutJoin.status === 403 && takeWithoutJoin.body.accessCodeRequired === true, JSON.stringify(takeWithoutJoin.body));

    const joined = await req('POST', '/api/exams/join', { token: studentTok, body: { accessCode: teacherExamCode } });
    check('authenticated join with teacher code still works', joined.status === 200 && joined.body.exam._id === teacherExamId);

    const joinedPublicAuthed = await req('POST', '/api/exams/join-public', { token: studentTok, body: { accessCode: teacherExamCode } });
    check('join-public becomes equivalent to auth join when signed in', joinedPublicAuthed.status === 200 && joinedPublicAuthed.body.exam._id === teacherExamId);

    const takeAfterJoin = await req('GET', `/api/exams/${teacherExamId}/take`, { token: studentTok });
    check('teacher exam opens after authenticated code join', takeAfterJoin.status === 200 && takeAfterJoin.body.questions.length === 1);

    const startTeacherExam = await req('POST', '/api/attempts/start', { token: studentTok, body: { examId: teacherExamId } });
    check('teacher exam can start after code join', startTeacherExam.status === 201);

    console.log('\nPast paper payment flow still works');
    const startLocked = await req('POST', '/api/attempts/start', { token: studentTok, body: { examId: pastId } });
    check('start of unpaid past paper returns 402', startLocked.status === 402 && startLocked.body.purpose === 'entry');

    const entryInit = await req('POST', '/api/payments/initiate', { token: studentTok, body: { examId: pastId, purpose: 'entry' } });
    check('entry payment initiated', entryInit.status === 201 && entryInit.body.payment.amount === 500 && entryInit.body.payment.purpose === 'entry');

    const entryDup = await req('POST', '/api/payments/initiate', { token: studentTok, body: { examId: pastId, purpose: 'entry' } });
    check('re-initiate entry payment reuses pending payment', entryDup.status === 200 && entryDup.body.payment.reference === entryInit.body.payment.reference);

    await req('POST', `/api/payments/${entryInit.body.payment.reference}/dev-complete`, { token: studentTok });
    const takePast = await req('GET', `/api/exams/${pastId}/take`, { token: studentTok });
    check('take unlocked after entry payment', takePast.status === 200 && takePast.body.questions.length === 2, JSON.stringify(takePast.body).slice(0, 200));

    const pastStart = await req('POST', '/api/attempts/start', { token: studentTok, body: { examId: pastId } });
    const attemptId = pastStart.body.attempt._id;
    await req('PATCH', `/api/attempts/${attemptId}/answer`, { token: studentTok, body: { questionId: q1.body._id, selectedOption: 1 } });
    await req('PATCH', `/api/attempts/${attemptId}/answer`, { token: studentTok, body: { questionId: q2.body._id, textAnswer: 'Abuja' } });
    const submit = await req('POST', `/api/attempts/${attemptId}/submit`, { token: studentTok });
    check('submit returns score + attemptId + allowReview', submit.status === 200 && submit.body.attemptId === attemptId && submit.body.allowReview === true && submit.body.percentage === '100.00', JSON.stringify(submit.body));

    const reviewLocked = await req('GET', `/api/attempts/${attemptId}/review`, { token: studentTok });
    check('review without review fee returns 402', reviewLocked.status === 402 && reviewLocked.body.purpose === 'review' && reviewLocked.body.amount === 100, JSON.stringify(reviewLocked.body));

    const reviewInit = await req('POST', '/api/payments/initiate', { token: studentTok, body: { examId: pastId, purpose: 'review', attemptId } });
    check('review payment initiated', reviewInit.status === 201 && reviewInit.body.payment.purpose === 'review' && reviewInit.body.payment.attempt === attemptId);
    await req('POST', `/api/payments/${reviewInit.body.payment.reference}/dev-complete`, { token: studentTok });

    const review = await req('GET', `/api/attempts/${attemptId}/review`, { token: studentTok });
    const first = review.body.questions.find((i) => i.questionId === q1.body._id);
    check('review unlocked after fee and returns answers', review.status === 200 && review.body.questions.length === 2 && first.correctOptionIndex === 1 && first.correctAnswer === '4' && first.selectedOption === 1 && first.isCorrect === true, JSON.stringify(first));

    const legacyReviewInit = await req('POST', '/api/payments/initiate', { token: studentTok, body: { purpose: 'review', attemptId } });
    check('review payment without examId still resolves exam', legacyReviewInit.status === 200 && legacyReviewInit.body.payment.exam === pastId, JSON.stringify(legacyReviewInit.body));

    console.log('\nAdmin password reset flows');
    const singleReset = await req('POST', `/api/admin/users/${studentUnlocked.body.user.id}/reset-password`, { token: adminTok });
    check('single admin reset sets default password and mustChangePassword', singleReset.status === 200 && singleReset.body.user.mustChangePassword === true, JSON.stringify(singleReset.body));

    const oldPasswordRejected = await req('POST', '/api/auth/login', { body: { email: 'sam@x.com', password: 'secret1' } });
    check('old password stops working after single reset', oldPasswordRejected.status === 401);

    const defaultPasswordLogin = await req('POST', '/api/auth/login', { body: { email: 'sam@x.com', password: '123456' } });
    check('single-reset student can sign in with 123456 and mustChangePassword', defaultPasswordLogin.status === 200 && defaultPasswordLogin.body.user.mustChangePassword === true, JSON.stringify(defaultPasswordLogin.body));
    const defaultPasswordTok = defaultPasswordLogin.body.token;

    const changed = await req('PATCH', '/api/auth/change-password', { token: defaultPasswordTok, body: { currentPassword: '123456', newPassword: 'renewed1' } });
    check('change-password succeeds for reset account', changed.status === 200);

    const meAfterChange = await req('GET', '/api/auth/me', { token: defaultPasswordTok });
    check('change-password clears mustChangePassword on /me', meAfterChange.status === 200 && meAfterChange.body.user.mustChangePassword === false, JSON.stringify(meAfterChange.body));

    const bulkReset = await req('POST', '/api/admin/users/reset-passwords', { token: adminTok, body: { confirm: true } });
    check('bulk reset returns student count only', bulkReset.status === 200 && bulkReset.body.resetCount === 3, JSON.stringify(bulkReset.body));

    const legacyAfterBulk = await req('POST', '/api/auth/login', { body: { email: 'legacy@x.com', password: '123456' } });
    check('bulk-reset legacy student logs in with 123456 and mustChangePassword', legacyAfterBulk.status === 200 && legacyAfterBulk.body.user.mustChangePassword === true, JSON.stringify(legacyAfterBulk.body));

    const teacherAfterBulk = await req('POST', '/api/auth/login', { body: { email: 'ada@x.com', password: 'secret1' } });
    const adminAfterBulk = await req('POST', '/api/auth/login', { body: { email: 'admin@x.com', password: 'secret1' } });
    check('bulk reset excludes teachers', teacherAfterBulk.status === 200 && teacherAfterBulk.body.user.role === 'teacher');
    check('bulk reset excludes admins', adminAfterBulk.status === 200 && adminAfterBulk.body.user.role === 'admin');

    console.log('\nAdmin revenue + history');
    const stats = await req('GET', '/api/admin/stats', { token: adminTok });
    check('admin stats include registration payment counts', stats.status === 200 && stats.body.payments.registrationCount === 2 && stats.body.payments.registrationRevenue === 2400, JSON.stringify(stats.body.payments));
    check('admin stats total revenue adds registration + entry + review', stats.body.payments.totalRevenue === 3000 && stats.body.payments.entryCount === 1 && stats.body.payments.reviewCount === 1, JSON.stringify(stats.body.payments));

    const payments = await req('GET', '/api/admin/payments', { token: adminTok });
    check('admin payments totals include registrationCount', payments.status === 200 && payments.body.totals.registrationCount === 2 && payments.body.payments.length === 4, JSON.stringify(payments.body));

    const myPayments = await req('GET', '/api/payments/my-payments', { token: studentTok });
    check('student payment history still lists all paid purchases', myPayments.status === 200 && myPayments.body.length === 3, JSON.stringify(myPayments.body));
  } catch (e) {
    failed++;
    console.error('\nUnexpected failure:', e);
  } finally {
    child.kill('SIGTERM');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
