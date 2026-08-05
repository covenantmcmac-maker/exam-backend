const Payment = require('../models/Payment');

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

async function hasPaid(studentId, examId, purpose, attemptId = null) {
  const paid = await Payment.findOne({
    student: studentId,
    exam: examId,
    purpose,
    attempt: attemptId || { $in: [null, undefined] },
    status: 'paid'
  });
  return Boolean(paid);
}

async function hasPaidEntry(studentId, examId) {
  return hasPaid(studentId, examId, 'entry');
}

async function hasPaidReview(studentId, examId, attemptId) {
  return hasPaid(studentId, examId, 'review', attemptId);
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
    currency: pricing.currency
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
        currency: pricing.currency
      });
      return false;
    }
  }
  return true;
}

module.exports = {
  getPricing,
  hasPaid,
  hasPaidEntry,
  hasPaidReview,
  requireEntryPayment,
  requireReviewAccess
};
