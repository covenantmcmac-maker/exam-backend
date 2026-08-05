const router = require('express').Router();
const crypto = require('crypto');
const Exam = require('../models/Exam');
const ExamAttempt = require('../models/ExamAttempt');
const Payment = require('../models/Payment');
const { auth } = require('../middleware/auth');
const paystack = require('../services/paystack');
const { getPricing } = require('../services/payment-access');

/** Unique, Paystack-safe transaction reference. */
function makeReference() {
  return 'MME-' + crypto.randomBytes(12).toString('hex').toUpperCase();
}

// ========================
// INITIATE PAYMENT
// ========================
// Body: { examId, purpose: 'entry' | 'review', attemptId? }
router.post('/initiate', auth, async (req, res) => {
  try {
    let { examId } = req.body;
    const { purpose, attemptId } = req.body;

    // Older cached app builds only send attemptId for review payments —
    // resolve the exam from the attempt instead of rejecting them.
    // Ownership of the attempt is still enforced below.
    if (!examId && purpose === 'review' && attemptId) {
      const attemptRef = await ExamAttempt.findById(attemptId).select('exam');
      if (attemptRef) examId = attemptRef.exam;
    }

    if (!examId || !['entry', 'review'].includes(purpose)) {
      return res.status(400).json({ message: 'examId and purpose are required' });
    }

    const exam = await Exam.findById(examId);
    if (!exam) {
      return res.status(404).json({ message: 'Exam not found' });
    }

    const pricing = getPricing(exam);
    const amount = purpose === 'entry' ? pricing.entryFee : pricing.reviewFee;

    if (amount <= 0) {
      return res.status(400).json({
        message:
          purpose === 'entry'
            ? 'This exam is free to take.'
            : 'The answer review for this exam is free.'
      });
    }

    if (purpose === 'review') {
      if (!attemptId) {
        return res.status(400).json({ message: 'attemptId is required for review payments' });
      }
      const attempt = await ExamAttempt.findOne({
        _id: attemptId,
        student: req.user._id,
        status: { $ne: 'in-progress' }
      });
      if (!attempt) {
        return res.status(404).json({ message: 'Completed attempt not found' });
      }
    }

    // Idempotency: reuse an existing pending payment instead of charging twice.
    const existing = await Payment.findOne({
      student: req.user._id,
      exam: examId,
      purpose,
      attempt: purpose === 'review' ? attemptId : null,
      status: 'pending'
    }).sort({ createdAt: -1 });

    if (existing) {
      return res.json({
        message: 'Payment already initiated',
        payment: existing,
        devMode: paystack.isDevMode()
      });
    }

    const alreadyPaid = await Payment.findOne({
      student: req.user._id,
      exam: examId,
      purpose,
      attempt: purpose === 'review' ? attemptId : null,
      status: 'paid'
    });
    if (alreadyPaid) {
      return res.json({
        message: 'Already paid',
        payment: alreadyPaid,
        devMode: paystack.isDevMode()
      });
    }

    const reference = makeReference();
    const metadata = {
      purpose,
      examId,
      attemptId: purpose === 'review' ? attemptId : null,
      studentId: String(req.user._id),
      custom_fields: [
        {
          display_name: 'Student',
          variable_name: 'student',
          value: req.user.name || req.user.email
        },
        {
          display_name: 'Item',
          variable_name: 'item',
          value: `${purpose === 'entry' ? 'Entry' : 'Answer review'} — ${exam.title}`
        }
      ]
    };

    const gateway = await paystack.initialize({
      email: req.user.email,
      amount,
      reference,
      metadata
    });

    const payment = new Payment({
      student: req.user._id,
      exam: examId,
      attempt: purpose === 'review' ? attemptId : null,
      purpose,
      amount,
      currency: pricing.currency,
      provider: gateway.devMode ? 'sandbox' : 'paystack',
      reference,
      providerDetails: {
        accessCode: gateway.accessCode || null,
        authorizationUrl: gateway.authorizationUrl || null
      }
    });
    await payment.save();

    res.status(201).json({
      message: gateway.devMode
        ? 'Payment initiated (dev mode)'
        : 'Payment initiated — complete it on Paystack',
      payment,
      authorizationUrl: gateway.authorizationUrl,
      devMode: gateway.devMode
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
router.post('/:reference/dev-complete', auth, async (req, res) => {
  try {
    if (!paystack.isDevMode()) {
      return res.status(404).json({ message: 'Not found' });
    }

    const payment = await Payment.findOne({ reference: req.params.reference });
    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }
    if (payment.student.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not your payment' });
    }

    payment.status = 'paid';
    payment.paidAt = new Date();
    payment.providerDetails = {
      ...(payment.providerDetails || {}),
      devComplete: true
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
router.get('/:reference/verify', auth, async (req, res) => {
  try {
    const payment = await Payment.findOne({ reference: req.params.reference });
    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }
    if (payment.student.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not your payment' });
    }

    if (payment.status === 'paid') {
      return res.json({ payment, paid: true });
    }

    if (paystack.isDevMode()) {
      return res.json({ payment, paid: payment.status === 'paid' });
    }

    const result = await paystack.verify(payment.reference);
    if (result.paid) {
      payment.status = 'paid';
      payment.paidAt = result.paidAt ? new Date(result.paidAt) : new Date();
      payment.providerDetails = {
        ...(payment.providerDetails || {}),
        transactionId: result.transactionId,
        gatewayResponse: result.gatewayResponse,
        gatewayStatus: result.status
      };
      await payment.save();
      return res.json({ payment, paid: true });
    }

    res.json({ payment, paid: false });
  } catch (error) {
    console.error('Verify payment error:', error);
    res.status(500).json({ message: 'Error verifying payment: ' + error.message });
  }
});

// ========================
// PAYSTACK WEBHOOK
// Called by Paystack when a transaction settles. No auth — the HMAC
// signature on the raw body is the credential.
// ========================
router.post('/webhook/paystack', (req, res) => {
  const signature = req.header('x-paystack-signature');
  // The raw request body is captured by express.json({ verify }) in server.js
  // so the HMAC can be checked against exactly what Paystack sent.
  const event = paystack.verifyWebhook(
    req.rawBody || JSON.stringify(req.body || {}),
    signature
  );

  if (!event) {
    return res.status(401).json({ message: 'Invalid signature' });
  }

  // Acknowledge immediately so Paystack does not retry forever.
  res.json({ message: 'Received' });

  if (event.event !== 'charge.success') return;

  const data = event.data || {};
  const reference = data.reference;

  (async () => {
    const payment = await Payment.findOne({ reference });
    if (!payment) return;
    if (payment.status === 'paid') return;

    // Guard against amount tampering: kobo → naira.
    const expectedAmount = Math.round(payment.amount * 100);
    if (data.amount !== undefined && Number(data.amount) !== expectedAmount) {
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
      channel: data.channel
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
