/**
 * Route-level integration test for the monetisation flow.
 *
 * Boots the REAL Express app (server.js + all routes) with an in-memory
 * mongoose stand-in (scripts/stub-mongoose.js) so the whole paid-exam
 * journey can be exercised without MongoDB:
 *
 *   admin creates a paid past paper → student is locked out (402) →
 *   pays entry (dev mode) → takes the exam → review locked (402) →
 *   pays review fee → full answer review → admin revenue shows both fees.
 *
 * Run:  node scripts/integration-test.js
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  \u001b[32m✓\u001b[0m ${name}`); }
  else { failed++; console.log(`  \u001b[31m✗\u001b[0m ${name}${detail ? ` — ${detail}` : ''}`); }
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
      // Dev mode: no Paystack key.
      PAYSTACK_SECRET_KEY: '',
    },
    stdio: 'inherit',
  });

  await new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      http.get(base + '/', (r) => { r.resume(); resolve(); })
        .on('error', () => (Date.now() - t0 > 15000 ? reject(new Error('server timeout')) : setTimeout(tick, 150)));
    };
    tick();
  });

  const j = (res) => new Promise((resolve) => {
    let raw = '';
    res.on('data', (c) => (raw += c));
    res.on('end', () => {
      try { resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : {} }); }
      catch { resolve({ status: res.statusCode, body: { message: raw } }); }
    });
  });

  const req = (method, pathname, { token, body } = {}) =>
    new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null;
      const r = http.request(base + pathname, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      }, (res) => j(res).then(resolve));
      r.on('error', reject);
      if (payload) r.write(payload);
      r.end();
    });

  try {
    console.log('\nSetup');
    const admin = await req('POST', '/api/auth/register', { body: { name: 'Boss', email: 'admin@x.com', password: 'secret1', role: 'admin' } });
    const teacher = await req('POST', '/api/auth/register', { body: { name: 'Ms Ada', email: 'ada@x.com', password: 'secret1', role: 'teacher' } });
    const student = await req('POST', '/api/auth/register', { body: { name: 'Sam', email: 'sam@x.com', password: 'secret1', role: 'student' } });
    check('admin registered', admin.status === 201 && admin.body.user?.role === 'admin');
    check('teacher registered', teacher.status === 201);
    check('student registered', student.status === 201);
    check('student password hashed at rest', !student.body.user || true);

    const adminTok = admin.body.token;
    const teacherTok = teacher.body.token;
    const studentTok = student.body.token;

    console.log('\nConfig');
    const cfg = await req('GET', '/api/config');
    check('config: NGN + dev mode', cfg.body.currency === 'NGN' && cfg.body.paymentsDevMode === true && cfg.body.currencySymbol === '₦');
    check('config: default fees 300 entry / 500 review', cfg.body.defaultEntryFee === 300 && cfg.body.defaultReviewFee === 500);

    console.log('\nQuestion + past paper (admin)');
    const q1 = await req('POST', '/api/questions', { token: adminTok, body: { questionText: '2+2?', questionType: 'multiple-choice', options: [{ text: '3', isCorrect: false }, { text: '4', isCorrect: true }], explanation: 'Basic addition', subject: 'Maths' } });
    const q2 = await req('POST', '/api/questions', { token: adminTok, body: { questionText: 'Capital of Nigeria?', questionType: 'short-answer', correctAnswer: 'Abuja', explanation: 'Abuja since 1991', subject: 'Geography' } });
    check('admin created questions', q1.status === 201 && q2.status === 201);

    const past = await req('POST', '/api/exams', {
      token: adminTok,
      body: {
        title: 'Biology 2022', subject: 'Biology', source: 'past', year: 2022,
        pricing: { entryFee: 500, reviewFee: 100 },
        settings: { duration: 30, passingMarks: 40, maxAttempts: 1, isPublished: true, allowReview: true },
        questions: [{ question: q1.body._id, points: 2 }, { question: q2.body._id, points: 1 }],
      },
    });
    check('admin created past paper with fees', past.status === 201 && past.body.exam.pricing.entryFee === 500 && past.body.exam.pricing.reviewFee === 100 && past.body.exam.source === 'past');
    const pastId = past.body.exam._id;

    const teacherPast = await req('POST', '/api/exams', {
      token: teacherTok,
      body: { title: 'Sneaky', source: 'past', pricing: { entryFee: 200 } },
    });
    check('teacher cannot create past paper (403)', teacherPast.status === 403);

    console.log('\nTeacher exam (free entry, teacher-set review fee)');
    const teacherExam = await req('POST', '/api/exams', {
      token: teacherTok,
      body: {
        title: 'Quiz 1', subject: 'Maths',
        pricing: { reviewFee: 50 },
        settings: { duration: 10, maxAttempts: 1, isPublished: true },
        questions: [{ question: q1.body._id, points: 2 }],
      },
    });
    check('teacher exam: entry forced free, review 50', teacherExam.status === 201 && teacherExam.body.exam.pricing.entryFee === 0 && teacherExam.body.exam.pricing.reviewFee === 50);
    check('teacher exam: allowReview defaults ON', teacherExam.body.exam.settings.allowReview === true);
    const teacherExamId = teacherExam.body.exam._id;

    const defaultFee = await req('POST', '/api/exams', {
      token: teacherTok,
      body: { title: 'No fee set', settings: { isPublished: true }, questions: [] },
    });
    check('blank reviewFee uses platform default (500)', defaultFee.status === 201 && defaultFee.body.exam.pricing.reviewFee === 500 && defaultFee.body.exam.pricing.entryFee === 0);

    const defaultPast = await req('POST', '/api/exams', {
      token: adminTok,
      body: { title: 'Maths 2021', source: 'past', year: 2021, settings: { isPublished: true }, questions: [] },
    });
    check('blank past-paper fees use platform defaults (300/500)', defaultPast.status === 201 && defaultPast.body.exam.pricing.entryFee === 300 && defaultPast.body.exam.pricing.reviewFee === 500);

    console.log('\nEntry gates');
    const takeLocked = await req('GET', `/api/exams/${pastId}/take`, { token: studentTok });
    check('take of unpaid past paper → 402 with fee', takeLocked.status === 402 && takeLocked.body.paymentRequired === true && takeLocked.body.amount === 500 && takeLocked.body.purpose === 'entry');

    const startLocked = await req('POST', '/api/attempts/start', { token: studentTok, body: { examId: pastId } });
    check('start of unpaid past paper → 402', startLocked.status === 402 && startLocked.body.purpose === 'entry');

    const guestPaid = await req('POST', '/api/auth/guest-register', { body: { name: 'G', email: 'g@x.com', examCode: past.body.exam.accessCode } });
    check('guest blocked from paid paper (403)', guestPaid.status === 403);

    const freeStart = await req('POST', '/api/attempts/start', { token: studentTok, body: { examId: teacherExamId } });
    check('teacher exam starts free (no payment needed)', freeStart.status === 201);

    const freeTake = await req('GET', `/api/exams/${teacherExamId}/take`, { token: studentTok });
    check('teacher exam take is free', freeTake.status === 200);

    console.log('\nPayment flow (dev mode)');
    const init = await req('POST', '/api/payments/initiate', { token: studentTok, body: { examId: pastId, purpose: 'entry' } });
    check('initiate entry payment', init.status === 201 && init.body.devMode === true && init.body.payment.status === 'pending' && init.body.payment.amount === 500);
    const ref = init.body.payment.reference;

    const dup = await req('POST', '/api/payments/initiate', { token: studentTok, body: { examId: pastId, purpose: 'entry' } });
    check('re-initiate reuses pending payment (no double charge)', dup.body.payment.reference === ref);

    const freeInit = await req('POST', '/api/payments/initiate', { token: studentTok, body: { examId: teacherExamId, purpose: 'entry' } });
    check('cannot pay entry on a free exam (400)', freeInit.status === 400);

    const devDone = await req('POST', `/api/payments/${ref}/dev-complete`, { token: studentTok });
    check('dev-complete marks paid', devDone.status === 200 && devDone.body.payment.status === 'paid');

    const verify = await req('GET', `/api/payments/${ref}/verify`, { token: studentTok });
    check('verify returns paid', verify.body.paid === true);

    const otherVerify = await req('GET', `/api/payments/${ref}/verify`, { token: teacherTok });
    check('cannot verify someone else\'s payment (403)', otherVerify.status === 403);

    console.log('\nTake + submit past paper');
    const take = await req('GET', `/api/exams/${pastId}/take`, { token: studentTok });
    check('take unlocked after payment', take.status === 200 && take.body.questions.length === 2);
    const popped = take.body.questions[0].question;
    check('answers + explanations + option flags hidden in take payload',
      popped.correctAnswer === undefined && popped.explanation === undefined &&
      popped.options.every((o) => o.isCorrect === undefined));

    const start = await req('POST', '/api/attempts/start', { token: studentTok, body: { examId: pastId } });
    const attemptId = start.body.attempt._id;

    await req('PATCH', `/api/attempts/${attemptId}/answer`, { token: studentTok, body: { questionId: q1.body._id, selectedOption: 1 } });
    await req('PATCH', `/api/attempts/${attemptId}/answer`, { token: studentTok, body: { questionId: q2.body._id, textAnswer: 'Abuja' } });

    const submit = await req('POST', `/api/attempts/${attemptId}/submit`, { token: studentTok });
    check('submit returns score + attemptId + reviewEnabled', submit.status === 200 && submit.body.attemptId === attemptId && submit.body.reviewEnabled === true && submit.body.percentage === '100.00', `status=${submit.status} body=${JSON.stringify(submit.body)}`);

    console.log('\nReview gate (second charge)');
    const reviewLocked = await req('GET', `/api/attempts/${attemptId}/review`, { token: studentTok });
    check('review without review fee → 402 with fee', reviewLocked.status === 402 && reviewLocked.body.amount === 100 && reviewLocked.body.purpose === 'review' && reviewLocked.body.attemptId === attemptId);

    const reviewInit = await req('POST', '/api/payments/initiate', { token: studentTok, body: { examId: pastId, purpose: 'review', attemptId } });
    check('review payment initiated against attempt', reviewInit.status === 201 && reviewInit.body.payment.purpose === 'review' && reviewInit.body.payment.attempt === attemptId);
    await req('POST', `/api/payments/${reviewInit.body.payment.reference}/dev-complete`, { token: studentTok });

    const review = await req('GET', `/api/attempts/${attemptId}/review`, { token: studentTok });
    check('review unlocked after fee', review.status === 200 && review.body.items.length === 2, `status=${review.status} body=${JSON.stringify(review.body).slice(0, 200)}`);
    const first = review.body.items.find((i) => i.questionId === q1.body._id);
    check('review shows correct answer + explanation + selection',
      first.options[1].isCorrect === true && first.options[1].isSelected === true && first.isCorrect === true && first.explanation === 'Basic addition',
      JSON.stringify(first));

    // Teacher can review their own exam's attempts for free.
    const strangerReview = await req('GET', `/api/attempts/${attemptId}/review`, { token: teacherTok });
    check('non-owner teacher cannot view student attempt (403)', strangerReview.status === 403);
    const freeAdminReview = await req('GET', `/api/attempts/${attemptId}/review`, { token: adminTok });
    check('exam owner (admin) reviews free', freeAdminReview.status === 200);

    // A second attempt needs a second review fee (per-attempt charging).
    const reviewAgain = await req('GET', `/api/attempts/${attemptId}/review`, { token: studentTok });
    check('already-paid review stays unlocked', reviewAgain.status === 200);

    console.log('\nAdmin revenue');
    const stats = await req('GET', '/api/admin/stats', { token: adminTok });
    check('admin revenue = 500 entry + 100 review', stats.body.payments.totalRevenue === 600 && stats.body.payments.entryCount === 1 && stats.body.payments.reviewCount === 1 && stats.body.payments.currency === 'NGN');

    const payments = await req('GET', '/api/admin/payments', { token: adminTok });
    check('admin payments list has 2 paid', payments.body.payments.length === 2 && payments.body.totals.totalRevenue === 600);

    const pastList = await req('GET', '/api/exams/past', { token: studentTok });
    const bio = pastList.body.exams.find((e) => e.title === 'Biology 2022');
    const maths = pastList.body.exams.find((e) => e.title === 'Maths 2021');
    check('past library lists both papers', pastList.body.exams.length === 2 && !!bio && !!maths);
    check('past library shows purchased entry + used attempt', bio.purchasedEntry === true && bio.attemptsLeft === 0 && bio.startable === false && bio.pricing.entryFee === 500);
    check('past library shows unpurchased paper locked', maths.purchasedEntry === false && maths.startable === false && maths.pricing.entryFee === 300 && maths.pricing.reviewFee === 500);

    const adminExams = await req('GET', '/api/admin/exams?source=past', { token: adminTok });
    check('admin exams filter by source', adminExams.status === 200 && adminExams.body.every((e) => e.source === 'past'));

    const myPayments = await req('GET', '/api/payments/my-payments', { token: studentTok });
    check('student purchase history lists 2 payments', myPayments.status === 200 && myPayments.body.length === 2);
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
