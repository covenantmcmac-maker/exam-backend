const router = require('express').Router();
const crypto = require('crypto');
const Exam = require('../models/Exam');
const ExamAttempt = require('../models/ExamAttempt');
const Payment = require('../models/Payment');
const { auth, optionalAuth } = require('../middleware/auth');
const paystack = require('../services/paystack');
const {
  buildPaymentFilter,
  findSettledPayment,
  getPricing,
  reconcilePendingPayment,
} = require('../services/payment-access');
const {
  buildRegistrationPaymentRequiredPayload,
  getRegistrationRequirement,
  resolveRegistrationPaymentToken,
} = require('../services/registration-access');

/** Unique, Paystack-safe transaction reference. */
function makeReference() {
  return 'MME-' + crypto.randomBytes(12).toString('hex').toUpperCase();
}

function makeMetadata({ purpose, exam, attemptId, user }) {
  if (purpose === 'registration') {
    return {
      purpose,
      studentId: String(user._id),
      custom_fields: [
        {
          display_name: 'Student',
          variable_name: 'student',
          value: user.name || user.email,
        },
        {
          display_name: 'Item',
          variable_name: 'item',
          value: 'Student registration fee',
        },
      ],
    };
  }

  return {
    purpose,
    examId: exam?._id,
    attemptId: purpose === 'review' ? attemptId : null,
    studentId: String(user._id),
    custom_fields: [
      {
        display_name: 'Student',
        variable_name: 'student',
        value: user.name || user.email,
      },
      {
        display_name: 'Item',
        variable_name: 'item',
        value: `${purpose === 'entry' ? 'Entry' : 'Answer review'} — ${exam?.title || 'Exam'}`,
      },
    ],
  };
}

async function resolvePaymentUser(req, purpose, paymentToken) {
  if (purpose === 'registration') {
    if (req.user) return req.user;
    return resolveRegistrationPaymentToken(paymentToken);
  }
  return req.user || null;
}

async function refreshPendingGateway(payment, { user, amount, metadata }) {
  if (paystack.isDevMode()) {
    return {
      devMode: true,
      authorizationUrl: null,
      accessCode: null,
      reference: payment.reference,
    };
  }

  try {
    const gateway = await paystack.initialize({
      email: user.email,
      amount,
      reference: payment.reference,
      metadata,
    });

    payment.provider = gateway.devMode ? 'sandbox' : 'paystack';
    payment.providerDetails = {
      ...(payment.providerDetails || {}),
      accessCode: gateway.accessCode || payment.providerDetails?.accessCode || null,
      authorizationUrl:
        gateway.authorizationUrl || payment.providerDetails?.authorizationUrl || null,
      refreshedAt: new Date(),
    };
    await payment.save();
    return gateway;
  } catch (error) {
    if (payment.providerDetails?.authorizationUrl) {
      return {
        devMode: false,
        authorizationUrl: payment.providerDetails.authorizationUrl,
        accessCode: payment.providerDetails.accessCode || null,
        reference: payment.reference,
      };
    }
    throw error;
  }
}

async function findExamForPayment(examId, purpose, attemptId, user) {
  let resolvedExamId = examId;

  if (!resolvedExamId && purpose === 'review' && attemptId) {
    const attemptRef = await ExamAttempt.findById(attemptId).select('exam');
    if (attemptRef) resolvedExamId = attemptRef.exam;
  }

  if (!resolvedExamId || !['entry', 'review'].includes(purpose)) {
    return { error: { status: 400, message: 'examId and purpose are required' } };
  }

  const exam = await Exam.findById(resolvedExamId);
  if (!exam) {
    return { error: { status: 404, message: 'Exam not found' } };
  }

  if (purpose === 'review') {
    if (!attemptId) {
      return { error: { status: 400, message: 'attemptId is required for review payments' } };
    }

    const attempt = await ExamAttempt.findOne({
      _id: attemptId,
      student: user._id,
      status: { $ne: 'in-progress' },
    });
    if (!attempt) {
      return { error: { status: 404, message: 'Completed attempt not found' } };
    }
  }

  return { exam, examId: resolvedExamId };
}

// ========================
// INITIATE PAYMENT
// ========================
// Body: { examId?, purpose: 'entry' | 'review' | 'registration', attemptId?, paymentToken? }
router.post('/initiate', optionalAuth, async (req, res) => {
  try {
    let { examId } = req.body;
    const { purpose, attemptId, paymentToken } = req.body;
    const user = await resolvePaymentUser(req, purpose, paymentToken);

    if (!user) {
      return res.status(401).json({ message: 'Please sign in to start this payment.' });
    }

    let exam = null;
    let amount = 0;
    let currency = paystack.currency();

    if (purpose === 'registration') {
      const requirement = await getRegistrationRequirement(user);
      if (!requirement.required) {
        return res.status(200).json({
          message: 'Registration already unlocked',
          payment: {
            _id: null,
            student: user._id,
            exam: null,
            attempt: null,
            purpose: 'registration',
            amount: requirement.amount,
            currency: requirement.currency,
            provider: paystack.isDevMode() ? 'sandbox' : 'paystack',
            reference: null,
            status: 'paid',
          },
          authorizationUrl: null,
          paid: true,
          devMode: paystack.isDevMode(),
        });
      }
      amount = requirement.amount;
      currency = requirement.currency;
    } else {
      const examResult = await findExamForPayment(examId, purpose, attemptId, user);
      if (examResult.error) {
        return res.status(examResult.error.status).json({ message: examResult.error.message });
      }
      exam = examResult.exam;
      examId = examResult.examId;
      const pricing = getPricing(exam);
      amount = purpose === 'entry' ? pricing.entryFee : pricing.reviewFee;
      currency = pricing.currency;

      if (amount <= 0) {
        return res.status(400).json({
          message:
            purpose === 'entry'
              ? 'This exam is free to take.'
              : 'The answer review for this exam is free.'
        });
      }
    }

    const itemKey = {
      studentId: user._id,
      purpose,
      examId: purpose === 'registration' ? null : examId,
      attemptId: purpose === 'review' ? attemptId : null,
    };

    // SETTLED FIRST. findSettledPayment also reconciles a stale `pending`
    // record against Paystack, so a student who already paid but whose
    // confirmation never reached us is recognised here instead of being sent
    // back to checkout for a second charge.
    const alreadyPaid = await findSettledPayment(itemKey);
    if (alreadyPaid) {
      return res.json({
        message: 'Already paid',
        payment: alreadyPaid,
        authorizationUrl: null,
        paid: true,
        devMode: paystack.isDevMode(),
      });
    }

    const metadata = makeMetadata({ purpose, exam, attemptId, user });

    // Genuinely unpaid: reuse the existing pending record (same reference =
    // same Paystack transaction = no double charge).
    const existing = await Payment.findOne(
      buildPaymentFilter({ ...itemKey, status: 'pending' })
    ).sort({ createdAt: -1 });

    if (existing) {
      const gateway = await refreshPendingGateway(existing, {
        user,
        amount: existing.amount,
        metadata,
      });

      return res.json({
        message: 'Payment already initiated',
        payment: existing,
        authorizationUrl:
          gateway.authorizationUrl || existing.providerDetails?.authorizationUrl || null,
        paid: false,
        devMode: gateway.devMode,
      });
    }

    const reference = makeReference();
    const gateway = await paystack.initialize({
      email: user.email,
      amount,
      reference,
      metadata,
    });

    const payment = new Payment({
      student: user._id,
      exam: purpose === 'registration' ? null : examId,
      attempt: purpose === 'review' ? attemptId : null,
      purpose,
      amount,
      currency,
      provider: gateway.devMode ? 'sandbox' : 'paystack',
      reference,
      providerDetails: {
        accessCode: gateway.accessCode || null,
        authorizationUrl: gateway.authorizationUrl || null,
      },
    });
    await payment.save();

    res.status(201).json({
      message: gateway.devMode
        ? 'Payment initiated (dev mode)'
        : 'Payment initiated — complete it on Paystack',
      payment,
      authorizationUrl: gateway.authorizationUrl,
      paid: false,
      devMode: gateway.devMode,
    });
  } catch (error) {
    console.error('Initiate payment error:', error);
    res.status(500).json({ message: 'Error initiating payment: ' + error.message });
  }
});

// ========================
// DEV MODE: mark a pending payment as paid
// Never active in production or when Paystack is configured.
// ========================
router.post('/:reference/dev-complete', optionalAuth, async (req, res) => {
  try {
    if (!paystack.isDevMode()) {
      return res.status(404).json({ message: 'Not found' });
    }

    const payment = await Payment.findOne({ reference: req.params.reference });
    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    const user = await resolvePaymentUser(req, payment.purpose, req.body.paymentToken);
    if (!user) {
      return res.status(401).json({ message: 'Please sign in to complete this payment.' });
    }
    if (payment.student.toString() !== user._id.toString()) {
      return res.status(403).json({ message: 'Not your payment' });
    }

    payment.status = 'paid';
    payment.paidAt = new Date();
    payment.providerDetails = {
      ...(payment.providerDetails || {}),
      devComplete: true,
    };
    await payment.save();

    res.json({ message: 'Payment marked as paid (dev mode)', payment });
  } catch (error) {
    console.error('Dev-complete error:', error);
    res.status(500).json({ message: 'Error completing payment' });
  }
});

// ========================
// VERIFY PAYMENT
// Client calls this after returning from the Paystack checkout page.
// ========================
router.get('/:reference/verify', optionalAuth, async (req, res) => {
  try {
    const payment = await Payment.findOne({ reference: req.params.reference });
    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    const user = await resolvePaymentUser(req, payment.purpose, req.query.paymentToken || req.header('x-payment-token'));
    if (!user) {
      return res.status(401).json({ message: 'Please sign in to verify this payment.' });
    }
    if (payment.student.toString() !== user._id.toString()) {
      return res.status(403).json({ message: 'Not your payment' });
    }

    if (payment.status === 'paid') {
      return res.json({ payment, paid: true });
    }

    // reconcilePendingPayment is the single place that asks Paystack and
    // persists the answer (dev mode, terminal states and gateway errors all
    // short-circuit inside it).
    const settled = await reconcilePendingPayment(payment);
    res.json({ payment: settled, paid: settled.status === 'paid' });
  } catch (error) {
    console.error('Verify payment error:', error);
    res.status(500).json({ message: 'Error verifying payment: ' + error.message });
  }
});

// ========================
// PAYMENT STATUS FOR ONE ITEM
// ========================
// The reference-free recovery path. After a refresh (or a return from
// Paystack that lost its ?reference) the client knows *what* it was buying
// but not the reference, so it asks about the item instead. Reconciles any
// pending charge against Paystack, so a confirmed payment unlocks access
// immediately on reload.
//
// GET /api/payments/status?purpose=entry&examId=…
// GET /api/payments/status?purpose=review&examId=…&attemptId=…
// GET /api/payments/status?purpose=registration&paymentToken=…
router.get('/status', optionalAuth, async (req, res) => {
  try {
    const { purpose, examId, attemptId } = req.query;

    if (!['entry', 'review', 'registration'].includes(purpose)) {
      return res.status(400).json({ message: 'A valid purpose is required.' });
    }

    const user = await resolvePaymentUser(
      req,
      purpose,
      req.query.paymentToken || req.header('x-payment-token')
    );
    if (!user) {
      return res.status(401).json({ message: 'Please sign in to check this payment.' });
    }

    if (purpose !== 'registration' && !examId) {
      return res.status(400).json({ message: 'examId is required for this purpose.' });
    }

    const itemKey = {
      studentId: user._id,
      purpose,
      examId: purpose === 'registration' ? null : examId,
      attemptId: purpose === 'review' ? attemptId || null : null,
    };

    const settled = await findSettledPayment(itemKey);
    if (settled) {
      return res.json({ paid: true, payment: settled, pending: null });
    }

    const pending = await Payment.findOne(
      buildPaymentFilter({ ...itemKey, status: 'pending' })
    ).sort({ createdAt: -1 });

    res.json({
      paid: false,
      payment: null,
      pending: pending
        ? {
            reference: pending.reference,
            amount: pending.amount,
            currency: pending.currency,
            authorizationUrl: pending.providerDetails?.authorizationUrl || null,
          }
        : null,
    });
  } catch (error) {
    console.error('Payment status error:', error);
    res.status(500).json({ message: 'Error checking payment status' });
  }
});

// ========================
// PAYSTACK WEBHOOK
// Called by Paystack when a transaction settles. No auth — the HMAC
// signature on the raw body is the credential.
// ========================
router.post('/webhook/paystack', (req, res) => {
  const signature = req.header('x-paystack-signature');
  const event = paystack.verifyWebhook(
    req.rawBody || JSON.stringify(req.body || {}),
    signature
  );

  if (!event) {
    return res.status(401).json({ message: 'Invalid signature' });
  }

  res.json({ message: 'Received' });

  if (event.event !== 'charge.success') return;

  const data = event.data || {};
  const reference = data.reference;

  (async () => {
    const payment = await Payment.findOne({ reference });
    if (!payment) return;
    if (payment.status === 'paid') return;

    // Underpayment is a rejection; an exact match or an overpayment settles.
    // (Strict equality here would lock out a student who was charged a
    // rounded-up amount, and there is no recovery path from `failed`.)
    const expectedAmount = Math.round(payment.amount * 100);
    if (data.amount !== undefined && Number(data.amount) < expectedAmount) {
      payment.status = 'failed';
      await payment.save();
      console.error(
        `Payment amount mismatch for ${reference}: got ${data.amount}, expected ${expectedAmount}`
      );
      return;
    }

    payment.status = 'paid';
    payment.paidAt = data.paid_at ? new Date(data.paid_at) : new Date();
    payment.providerDetails = {
      ...(payment.providerDetails || {}),
      transactionId: data.id,
      gatewayResponse: data.gateway_response,
      gatewayStatus: data.status,
      channel: data.channel,
    };
    await payment.save();
    console.log(`✅ Payment ${reference} confirmed (${payment.purpose}, ${payment.amount} ${payment.currency})`);
  })().catch((err) => {
    console.error('Webhook processing error:', err);
  });
});

// ========================
// MY PAYMENTS (student purchase history)
// ========================
router.get('/my-payments', auth, async (req, res) => {
  try {
    const payments = await Payment.find({ student: req.user._id })
      .populate('exam', 'title subject year source')
      .sort({ createdAt: -1 })
      .limit(100);
    res.json(payments);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching payments' });
  }
});

module.exports = router;
