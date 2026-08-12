const jwt = require('jsonwebtoken');
const Payment = require('../models/Payment');
const User = require('../models/User');
const paystack = require('./paystack');
const { findSettledPayment, pendingPaymentHint } = require('./payment-access');
const { getPlatformConfig, sanitizePlatformConfig } = require('./platform-config');

/**
 * True once the one-time registration fee has settled.
 *
 * Goes through findSettledPayment so a pending record that Paystack has
 * actually charged is reconciled here too — otherwise a student who paid but
 * whose ?reference was lost on the way back from checkout would be asked to
 * pay again at every login attempt.
 */
async function hasPaidRegistration(studentId) {
  if (!studentId) return false;
  const settled = await findSettledPayment({
    studentId,
    purpose: 'registration',
  });
  return Boolean(settled);
}

function createdBeforeActivation(user, activatedAt) {
  if (!activatedAt || !user?.createdAt) return false;
  const userCreatedAt = new Date(user.createdAt);
  const feeActivatedAt = new Date(activatedAt);
  if (Number.isNaN(userCreatedAt.getTime()) || Number.isNaN(feeActivatedAt.getTime())) {
    return false;
  }
  return userCreatedAt < feeActivatedAt;
}

async function getRegistrationRequirement(user) {
  const config = sanitizePlatformConfig(await getPlatformConfig());
  const amount = config.studentRegistrationFee;
  const currency = paystack.currency();

  if (!user || user.role !== 'student' || amount <= 0) {
    return { required: false, amount, currency, config };
  }

  if (await hasPaidRegistration(user._id)) {
    return { required: false, amount, currency, config };
  }

  if (
    config.applyRegistrationFeeToExistingStudents === false &&
    createdBeforeActivation(user, config.studentRegistrationFeeActivatedAt)
  ) {
    return { required: false, amount, currency, config };
  }

  return { required: true, amount, currency, config };
}

function createRegistrationPaymentToken(user) {
  return jwt.sign(
    {
      sub: String(user._id),
      scope: 'registration-payment',
    },
    process.env.JWT_SECRET,
    { expiresIn: '2h' }
  );
}

async function resolveRegistrationPaymentToken(token) {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.scope !== 'registration-payment' || !decoded.sub) return null;
    const user = await User.findById(decoded.sub).select('-password');
    return user || null;
  } catch {
    return null;
  }
}

async function buildRegistrationPaymentRequiredPayload(user, requirement, message) {
  return {
    message: message || 'Registration fee payment is required before you can sign in.',
    paymentRequired: true,
    purpose: 'registration',
    amount: requirement.amount,
    currency: requirement.currency,
    paymentToken: createRegistrationPaymentToken(user),
    // Resume an interrupted checkout instead of charging a second time.
    ...(await pendingPaymentHint({ studentId: user._id, purpose: 'registration' })),
  };
}

module.exports = {
  hasPaidRegistration,
  getRegistrationRequirement,
  createRegistrationPaymentToken,
  resolveRegistrationPaymentToken,
  buildRegistrationPaymentRequiredPayload,
};
