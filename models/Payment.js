const mongoose = require('mongoose');

/**
 * A payment for exam access or answer review.
 *
 * Every exam can earn money twice:
 *   1. entry   — pay to sit a past-question paper (teacher exams are free)
 *   2. review  — pay to unlock the answer review after submitting
 *
 * Payments are recorded here and enforced by the exam/attempt routes. The
 * actual money movement is delegated to a provider (Paystack by default),
 * see services/paystack.js.
 */
const paymentSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  exam: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Exam',
    required: true
  },
  // Set for review payments: the review belongs to one specific attempt.
  attempt: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ExamAttempt',
    default: null
  },
  purpose: {
    type: String,
    enum: ['entry', 'review'],
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'NGN'
  },
  provider: {
    type: String,
    enum: ['paystack', 'sandbox'],
    default: 'paystack'
  },
  reference: {
    type: String,
    required: true,
    unique: true
  },
  // Provider-specific details (Paystack transaction id, gateway status, …)
  providerDetails: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  status: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'expired'],
    default: 'pending'
  },
  paidAt: Date,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// A student cannot be charged twice for the same thing.
paymentSchema.index(
  { student: 1, exam: 1, purpose: 1, attempt: 1 },
  { partialFilterExpression: { status: { $in: ['pending', 'paid'] } } }
);

module.exports = mongoose.model('Payment', paymentSchema);
