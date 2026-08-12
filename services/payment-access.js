const Payment = require('../models/Payment');
const paystack = require('./paystack');

/**
 * Shared helpers that enforce the monetisation rules:
 *
 *   • entry fee  — required before a student can START a paid exam
 *   • review fee — required before a student can OPEN the answer review
 *
 * Regular teacher exams (source === 'teacher') are always free to take
 * (entryFee is forced to 0 on create). A teacher can convert a finished exam
 * into a paid past-question paper (source === 'past') with an entry fee that
 * students pay via Paystack. Review fees are optional on any past paper.
 *
 * SETTLEMENT IS NEVER ASSUMED FROM THE CLIENT
 * -------------------------------------------
 * A payment only becomes `paid` when Paystack says so, via one of three
 * independent paths, any one of which is enough:
 *
 *   1. the charge.success webhook            (POST /api/payments/webhook/paystack)
 *   2. an explicit verify from the client    (GET  /api/payments/:reference/verify)
 *   3. lazy reconciliation                   (reconcilePendingPayment below)
 *
 * (3) exists because (1) and (2) both fail in the real world: the webhook is
 * often not configured on the Paystack dashboard, and (2) is lost whenever the
 * browser drops the ?reference on the way back from the checkout page. Without
 * it a student who genuinely paid stays `pending` forever and is asked to pay
 * again on every refresh. Every read path that decides "must this user pay?"
 * therefore reconciles the pending record against Paystack first.
 */

/** Read pricing safely (old exams may predate the pricing field). */
function getPricing(exam) {
  const p = exam?.pricing || {};
  return {
    entryFee: Math.max(0, Number(p.entryFee) || 0),
    reviewFee: Math.max(0, Number(p.reviewFee) || 0),
    currency: p.currency || 'NGN'
  };
}

/** Mongo filter matching one payable item (entry/review/registration). */
function buildPaymentFilter({ studentId, purpose, examId, attemptId, status }) {
  const filter = { student: studentId, purpose };
  if (status) filter.status = status;

  if (purpose === 'registration') return filter;

  filter.exam = examId;
  filter.attempt = purpose === 'review' && attemptId
    ? attemptId
    : { $in: [null, undefined] };
  return filter;
}

/**
 * Ask Paystack whether a still-`pending` record has in fact settled, and
 * persist the answer. Safe to call on any payment: already-paid, failed and
 * dev-mode records short-circuit, and gateway errors are swallowed so a
 * Paystack outage degrades to "not paid yet" instead of a 500.
 *
 * Returns the (possibly updated) payment document.
 */
async function reconcilePendingPayment(payment) {
  if (!payment) return payment;
  if (payment.status === 'paid') return payment;
  // Only pending charges can still settle. `failed`/`expired` are terminal:
  // re-checking them would let an amount-mismatch rejection be undone.
  if (payment.status !== 'pending') return payment;
  // Dev/sandbox mode has no gateway to ask — dev-complete is the only path.
  if (paystack.isDevMode()) return payment;

  let result;
  try {
    result = await paystack.verify(payment.reference);
  } catch (error) {
    // Gateway unreachable / unknown reference — leave it pending and let the
    // caller treat it as unpaid. The next request retries.
    return payment;
  }

  if (!result?.paid) return payment;

  // Guard against a settled-but-underpaid transaction unlocking paid content.
  if (result.amount !== undefined && Number(result.amount) < Number(payment.amount)) {
    payment.status = 'failed';
    payment.providerDetails = {
      ...(payment.providerDetails || {}),
      amountMismatch: { expected: payment.amount, received: result.amount }
    };
    await payment.save();
    console.error(
      `Payment amount mismatch for ${payment.reference}: got ${result.amount}, expected ${payment.amount}`
    );
    return payment;
  }

  payment.status = 'paid';
  payment.paidAt = result.paidAt ? new Date(result.paidAt) : new Date();
  payment.providerDetails = {
    ...(payment.providerDetails || {}),
    transactionId: result.transactionId,
    gatewayResponse: result.gatewayResponse,
    gatewayStatus: result.status,
    reconciledAt: new Date()
  };
  await payment.save();
  return payment;
}

/**
 * The settled payment for one item, or null.
 *
 * Looks for an already-`paid` record first, then falls back to reconciling any
 * `pending` record against Paystack. This is what makes a refresh (or a return
 * from checkout that lost its ?reference) restore paid state.
 */
async function findSettledPayment({ studentId, purpose, examId, attemptId }) {
  const paid = await Payment.findOne(
    buildPaymentFilter({ studentId, purpose, examId, attemptId, status: 'paid' })
  );
  if (paid) return paid;

  const pending = await Payment.findOne(
    buildPaymentFilter({ studentId, purpose, examId, attemptId, status: 'pending' })
  ).sort({ createdAt: -1 });
  if (!pending) return null;

  const reconciled = await reconcilePendingPayment(pending);
  return reconciled?.status === 'paid' ? reconciled : null;
}

async function hasPaid(studentId, examId, purpose, attemptId = null) {
  const settled = await findSettledPayment({ studentId, purpose, examId, attemptId });
  return Boolean(settled);
}

async function hasPaidEntry(studentId, examId) {
  return hasPaid(studentId, examId, 'entry');
}

async function hasPaidReview(studentId, examId, attemptId) {
  return hasPaid(studentId, examId, 'review', attemptId);
}

/**
 * Extra fields attached to a 402 so the client can resume an interrupted
 * checkout (reopen the same Paystack page / re-verify the same reference)
 * rather than starting a second, duplicate payment.
 *
 * Returns `{}` when there is nothing pending, so it can be spread safely.
 */
async function pendingPaymentHint({ studentId, purpose, examId, attemptId }) {
  const pending = await Payment.findOne(
    buildPaymentFilter({ studentId, purpose, examId, attemptId, status: 'pending' })
  ).sort({ createdAt: -1 });

  if (!pending) return {};

  return {
    pendingReference: pending.reference,
    pendingAuthorizationUrl: pending.providerDetails?.authorizationUrl || null
  };
}

/**
 * Express guard: 402 with payment details when a paid exam's entry fee has
 * not been paid. Resolves `true` when access is granted.
 */
async function requireEntryPayment(req, res, exam) {
  const pricing = getPricing(exam);
  if (pricing.entryFee <= 0) return true;

  if (await hasPaidEntry(req.user._id, exam._id)) return true;

  res.status(402).json({
    message: 'Payment required to take this exam.',
    paymentRequired: true,
    purpose: 'entry',
    examId: exam._id,
    amount: pricing.entryFee,
    currency: pricing.currency,
    // Lets the client resume an interrupted checkout instead of starting a
    // second one (which would be a second charge).
    ...(await pendingPaymentHint({
      studentId: req.user._id,
      purpose: 'entry',
      examId: exam._id
    }))
  });
  return false;
}

/**
 * Express guard for the answer review. Teachers/admins who own the exam
 * always get in for free; students must have paid the review fee.
 */
async function requireReviewAccess(req, res, exam, attempt) {
  // Exam owners (teacher/admin) manage the paper — no fee for them.
  const ownsExam =
    req.user.role === 'admin' ||
    (req.user.role === 'teacher' &&
      String(exam.creator?._id || exam.creator) === String(req.user._id));
  if (ownsExam) return true;

  if (req.user.role !== 'student') return true;

  const pricing = getPricing(exam);
  if (pricing.reviewFee > 0) {
    const paid = await hasPaidReview(req.user._id, exam._id, attempt._id);
    if (!paid) {
      res.status(402).json({
        message: 'Payment required to view the answer review.',
        paymentRequired: true,
        purpose: 'review',
        examId: exam._id,
        attemptId: attempt._id,
        amount: pricing.reviewFee,
        currency: pricing.currency,
        ...(await pendingPaymentHint({
          studentId: req.user._id,
          purpose: 'review',
          examId: exam._id,
          attemptId: attempt._id
        }))
      });
      return false;
    }
  }
  return true;
}

module.exports = {
  getPricing,
  buildPaymentFilter,
  reconcilePendingPayment,
  findSettledPayment,
  pendingPaymentHint,
  hasPaid,
  hasPaidEntry,
  hasPaidReview,
  requireEntryPayment,
  requireReviewAccess
};
