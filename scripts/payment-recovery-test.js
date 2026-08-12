/**
 * Regression tests for "payment success is not persisting".
 *
 * The complaint: a student pays on Paystack, comes back / refreshes, and is
 * asked to pay again even though the charge went through.
 *
 * Reproducing it needs a REAL gateway conversation, so unlike
 * scripts/integration-test.js (which runs in dev mode, where dev-complete
 * settles payments locally and the gateway is never asked anything) this suite
 * boots the server with PAYSTACK_SECRET_KEY set and points it at
 * scripts/fake-paystack.js. That lets us settle a charge *at the gateway only*
 * — exactly what happens when the webhook is not configured and the browser
 * loses the ?reference on the way back from checkout — and then assert the app
 * recovers the paid state anyway.
 *
 * Covered for all three flows (registration / entry / review):
 *   • paid-at-gateway-only is recognised on the next request (no re-charge)
 *   • the pending reference is reused, never duplicated
 *   • a 402 carries the pending reference so the client can resume
 *   • /api/payments/status recovers paid state with no reference at all
 *   • underpayment does NOT unlock access
 *
 * Run: node scripts/payment-recovery-test.js
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const { createFakePaystack } = require('./fake-paystack');

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
  const PORT = 5998;
  const GATEWAY_PORT = 5997;
  const base = `http://127.0.0.1:${PORT}`;
  const gatewayBase = `http://127.0.0.1:${GATEWAY_PORT}`;

  const gateway = createFakePaystack();
  await gateway.listen(GATEWAY_PORT);

  const child = spawn(process.execPath, [path.join(__dirname, 'run-with-stub.js')], {
    env: {
      ...process.env,
      JWT_SECRET: 'payment-recovery-secret',
      PORT: String(PORT),
      NODE_ENV: 'test',
      // Configured => NOT dev mode => the server really talks to the gateway.
      PAYSTACK_SECRET_KEY: 'sk_test_fake',
      PAYSTACK_BASE_URL: gatewayBase,
    },
    stdio: 'inherit',
  });

  await new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      http
        .get(base + '/', (r) => {
          r.resume();
          resolve();
        })
        .on('error', () =>
          Date.now() - t0 > 15000 ? reject(new Error('server timeout')) : setTimeout(tick, 150)
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

  /** Settle a charge at the gateway ONLY — the app is told nothing. */
  const settleAtGateway = (reference, amount) =>
    new Promise((resolve, reject) => {
      const payload = JSON.stringify({ reference, amount });
      const r = http.request(
        `${gatewayBase}/__settle`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => j(res).then(resolve)
      );
      r.on('error', reject);
      r.write(payload);
      r.end();
    });

  try {
    console.log('\nSetup');
    const admin = await req('POST', '/api/auth/register', {
      body: { name: 'Boss', email: 'admin@x.com', password: 'secret1', role: 'admin' },
    });
    const adminTok = admin.body.token;
    check('admin registered', admin.status === 201 && !!adminTok);

    await req('PATCH', '/api/admin/config', {
      token: adminTok,
      body: { studentRegistrationFee: 1200, applyRegistrationFeeToExistingStudents: true },
    });

    /* ============================================================
     * 1. REGISTRATION FEE — paid at the gateway, never confirmed
     * ============================================================ */
    console.log('\nRegistration fee: paid on Paystack but confirmation lost');

    const signup = await req('POST', '/api/auth/register', {
      body: { name: 'Sam', email: 'sam@x.com', password: 'secret1', role: 'student' },
    });
    check(
      'new student is asked for the registration fee',
      signup.status === 402 && signup.body.purpose === 'registration' && !!signup.body.paymentToken,
      JSON.stringify(signup.body)
    );
    const payToken = signup.body.paymentToken;

    const regInit = await req('POST', '/api/payments/initiate', {
      body: { purpose: 'registration', paymentToken: payToken },
    });
    check(
      'registration checkout opens against the real gateway',
      regInit.status === 201 &&
        regInit.body.payment.status === 'pending' &&
        regInit.body.devMode === false &&
        String(regInit.body.authorizationUrl || '').includes('checkout.test'),
      JSON.stringify(regInit.body)
    );
    const regRef = regInit.body.payment.reference;

    // The student pays. No webhook is configured and the browser dropped the
    // ?reference, so the app is never told. This is the bug.
    await settleAtGateway(regRef, 1200);

    const loginAfterPaying = await req('POST', '/api/auth/login', {
      body: { email: 'sam@x.com', password: 'secret1' },
    });
    check(
      'login succeeds after paying, without any explicit verify call',
      loginAfterPaying.status === 200 && loginAfterPaying.body.user?.role === 'student',
      JSON.stringify(loginAfterPaying.body)
    );
    const studentTok = loginAfterPaying.body.token;

    const regStillPaid = await req('POST', '/api/auth/login', {
      body: { email: 'sam@x.com', password: 'secret1' },
    });
    check('registration stays unlocked on later logins', regStillPaid.status === 200);

    const regPayments = await req('GET', '/api/payments/my-payments', { token: studentTok });
    const regRecords = regPayments.body.filter((p) => p.purpose === 'registration');
    check(
      'registration was charged exactly once',
      regRecords.length === 1 && regRecords[0].status === 'paid',
      JSON.stringify(regRecords)
    );

    /* ============================================================
     * 2. ENTRY FEE
     * ============================================================ */
    console.log('\nEntry fee: refresh after paying must not ask again');

    const q1 = await req('POST', '/api/questions', {
      token: adminTok,
      body: {
        questionText: '2+2?',
        questionType: 'multiple-choice',
        options: [{ text: '3', isCorrect: false }, { text: '4', isCorrect: true }],
        subject: 'Maths',
      },
    });
    const past = await req('POST', '/api/exams', {
      token: adminTok,
      body: {
        title: 'Biology 2022',
        subject: 'Biology',
        source: 'past',
        year: 2022,
        pricing: { entryFee: 500, reviewFee: 100 },
        settings: {
          duration: 30,
          passingMarks: 40,
          maxAttempts: 1,
          isPublished: true,
          allowReview: true,
        },
        questions: [{ question: q1.body._id, points: 2 }],
      },
    });
    const pastId = past.body.exam._id;
    check('paid past paper created', past.status === 201 && !!pastId);

    const lockedBefore = await req('POST', '/api/attempts/start', {
      token: studentTok,
      body: { examId: pastId },
    });
    check(
      'unpaid entry is blocked with a 402',
      lockedBefore.status === 402 && lockedBefore.body.purpose === 'entry'
    );
    check(
      'a 402 with nothing pending carries no stale reference',
      lockedBefore.body.pendingReference === undefined,
      JSON.stringify(lockedBefore.body)
    );

    const entryInit = await req('POST', '/api/payments/initiate', {
      token: studentTok,
      body: { examId: pastId, purpose: 'entry' },
    });
    const entryRef = entryInit.body.payment.reference;
    check('entry checkout opened', entryInit.status === 201 && !!entryRef);

    // Student abandons the tab, comes back, hits the paywall again.
    const lockedPending = await req('POST', '/api/attempts/start', {
      token: studentTok,
      body: { examId: pastId },
    });
    check(
      '402 now carries the pending reference so the client can resume',
      lockedPending.status === 402 &&
        lockedPending.body.pendingReference === entryRef &&
        String(lockedPending.body.pendingAuthorizationUrl || '').includes('checkout.test'),
      JSON.stringify(lockedPending.body)
    );

    // Pays at the gateway; the app is never told.
    await settleAtGateway(entryRef, 500);

    const takeAfterPaying = await req('GET', `/api/exams/${pastId}/take`, { token: studentTok });
    check(
      'refreshing the exam page unlocks it after payment (no verify needed)',
      takeAfterPaying.status === 200 && takeAfterPaying.body.questions.length === 1,
      JSON.stringify(takeAfterPaying.body).slice(0, 160)
    );

    const startAfterPaying = await req('POST', '/api/attempts/start', {
      token: studentTok,
      body: { examId: pastId },
    });
    check('the exam can now be started', startAfterPaying.status === 201);
    const attemptId = startAfterPaying.body.attempt._id;

    // Tapping Pay again must recognise the settled charge, not open a 2nd one.
    const entryReinit = await req('POST', '/api/payments/initiate', {
      token: studentTok,
      body: { examId: pastId, purpose: 'entry' },
    });
    check(
      're-initiating a settled entry fee reports "already paid", not a new charge',
      entryReinit.status === 200 &&
        entryReinit.body.paid === true &&
        entryReinit.body.payment.reference === entryRef &&
        entryReinit.body.authorizationUrl === null,
      JSON.stringify(entryReinit.body)
    );

    const pastList = await req('GET', '/api/exams/past', { token: studentTok });
    const listed = pastList.body.exams.find((e) => e._id === pastId);
    check(
      'the past-questions library shows the paper as purchased',
      listed?.purchasedEntry === true && listed?.startable === true,
      JSON.stringify(listed)
    );

    /* ============================================================
     * 3. REVIEW FEE
     * ============================================================ */
    console.log('\nReview fee: unlocks on reload after paying');

    await req('PATCH', `/api/attempts/${attemptId}/answer`, {
      token: studentTok,
      body: { questionId: q1.body._id, selectedOption: 1 },
    });
    await req('POST', `/api/attempts/${attemptId}/submit`, { token: studentTok });

    const reviewLocked = await req('GET', `/api/attempts/${attemptId}/review`, {
      token: studentTok,
    });
    check(
      'review is locked behind its fee',
      reviewLocked.status === 402 && reviewLocked.body.purpose === 'review'
    );

    const reviewInit = await req('POST', '/api/payments/initiate', {
      token: studentTok,
      body: { examId: pastId, purpose: 'review', attemptId },
    });
    const reviewRef = reviewInit.body.payment.reference;
    check('review checkout opened', reviewInit.status === 201 && !!reviewRef);
    check(
      'the review charge is separate from the entry charge',
      reviewRef !== entryRef && reviewInit.body.payment.attempt === attemptId
    );

    await settleAtGateway(reviewRef, 100);

    const reviewAfterPaying = await req('GET', `/api/attempts/${attemptId}/review`, {
      token: studentTok,
    });
    check(
      'reloading the review unlocks it after payment (no verify needed)',
      reviewAfterPaying.status === 200 && reviewAfterPaying.body.questions?.length === 1,
      JSON.stringify(reviewAfterPaying.body).slice(0, 160)
    );

    /* ============================================================
     * 4. REFERENCE-FREE RECOVERY: /api/payments/status
     * ============================================================ */
    console.log('\nReference-free recovery after a refresh');

    const entryStatus = await req(
      'GET',
      `/api/payments/status?purpose=entry&examId=${pastId}`,
      { token: studentTok }
    );
    check(
      'status reports a settled entry fee without needing the reference',
      entryStatus.status === 200 && entryStatus.body.paid === true,
      JSON.stringify(entryStatus.body)
    );

    const reviewStatus = await req(
      'GET',
      `/api/payments/status?purpose=review&examId=${pastId}&attemptId=${attemptId}`,
      { token: studentTok }
    );
    check(
      'status reports a settled review fee for the right attempt',
      reviewStatus.status === 200 && reviewStatus.body.paid === true
    );

    const regStatus = await req(
      'GET',
      `/api/payments/status?purpose=registration&paymentToken=${encodeURIComponent(payToken)}`
    );
    check(
      'status reports the registration fee using only the payment token',
      regStatus.status === 200 && regStatus.body.paid === true,
      JSON.stringify(regStatus.body)
    );

    const strangerStatus = await req('GET', '/api/payments/status?purpose=entry&examId=' + pastId);
    check('status requires authentication', strangerStatus.status === 401);

    const badPurpose = await req('GET', '/api/payments/status?purpose=nonsense', {
      token: studentTok,
    });
    check('status rejects an unknown purpose', badPurpose.status === 400);

    /* ============================================================
     * 5. A PENDING CHARGE STAYS PENDING
     * ============================================================ */
    console.log('\nUnsettled and underpaid charges stay locked');

    const past2 = await req('POST', '/api/exams', {
      token: adminTok,
      body: {
        title: 'Chemistry 2021',
        subject: 'Chemistry',
        source: 'past',
        year: 2021,
        pricing: { entryFee: 700, reviewFee: 0 },
        settings: { duration: 30, maxAttempts: 1, isPublished: true },
        questions: [{ question: q1.body._id, points: 2 }],
      },
    });
    const past2Id = past2.body.exam._id;

    const init2 = await req('POST', '/api/payments/initiate', {
      token: studentTok,
      body: { examId: past2Id, purpose: 'entry' },
    });
    const ref2 = init2.body.payment.reference;

    const stillLocked = await req('POST', '/api/attempts/start', {
      token: studentTok,
      body: { examId: past2Id },
    });
    check(
      'a charge the gateway has not settled keeps the exam locked',
      stillLocked.status === 402 && stillLocked.body.pendingReference === ref2
    );

    const verifyUnsettled = await req('GET', `/api/payments/${ref2}/verify`, { token: studentTok });
    check(
      'verify on an unsettled charge reports paid:false',
      verifyUnsettled.status === 200 && verifyUnsettled.body.paid === false,
      JSON.stringify(verifyUnsettled.body)
    );

    // Underpay: the gateway says "success" but for less than the fee.
    await settleAtGateway(ref2, 100);
    const underpaid = await req('POST', '/api/attempts/start', {
      token: studentTok,
      body: { examId: past2Id },
    });
    check(
      'an underpaid charge does NOT unlock the exam',
      underpaid.status === 402,
      JSON.stringify(underpaid.body)
    );

    const underpaidStatus = await req(
      'GET',
      `/api/payments/status?purpose=entry&examId=${past2Id}`,
      { token: studentTok }
    );
    check('status reports the underpaid charge as unpaid', underpaidStatus.body.paid === false);

    /* ============================================================
     * 6. NO DOUBLE CHARGES OVERALL
     * ============================================================ */
    console.log('\nNo duplicate charges');

    const allPayments = await req('GET', '/api/payments/my-payments', { token: studentTok });
    const refs = allPayments.body.map((p) => p.reference);
    check(
      'every payment record has a unique reference',
      new Set(refs).size === refs.length,
      JSON.stringify(refs)
    );

    const entryRecords = allPayments.body.filter(
      (p) => p.purpose === 'entry' && String(p.exam?._id || p.exam) === String(pastId)
    );
    check(
      'the entry fee produced exactly one record',
      entryRecords.length === 1 && entryRecords[0].status === 'paid',
      JSON.stringify(entryRecords)
    );

    const initializeCalls = gateway.calls.filter((c) => c.key === 'POST /transaction/initialize');
    check(
      'the gateway was asked to open exactly one checkout per item',
      initializeCalls.length === 4,
      `initialize calls: ${initializeCalls.length}`
    );
  } catch (e) {
    failed++;
    console.error('\nUnexpected failure:', e);
  } finally {
    child.kill('SIGTERM');
    await gateway.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
