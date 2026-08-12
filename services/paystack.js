/**
 * Payment gateway layer (Paystack).
 *
 * All exam fees are in naira (NGN); Paystack works in kobo, so amounts are
 * multiplied by 100 when talking to the gateway.
 *
 * DEV MODE
 * --------
 * When PAYSTACK_SECRET_KEY is not set (and NODE_ENV is not 'production'),
 * the API runs in dev mode: `initiate` returns a payment without a real
 * Paystack checkout, and POST /api/payments/:reference/dev-complete marks
 * it paid. This lets the whole flow be exercised locally without keys.
 * Dev mode is never active when a secret key is configured, and the
 * dev-complete endpoint is dead in production.
 */

// Overridable only so the integration tests can point the gateway at a local
// fake Paystack. Production never sets PAYSTACK_BASE_URL.
const PAYSTACK_BASE = process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co';
const CURRENCY = process.env.PAYMENT_CURRENCY || 'NGN';

/** Whole-unit fees → kobo (Paystack's subunit). */
const toSubunit = (amount) => Math.round(Number(amount) * 100);

/** True when the sandbox self-complete flow is allowed. */
function isDevMode() {
  return (
    !process.env.PAYSTACK_SECRET_KEY &&
    process.env.NODE_ENV !== 'production'
  );
}

function paystackConfigured() {
  return Boolean(process.env.PAYSTACK_SECRET_KEY);
}

async function paystackFetch(path, options = {}) {
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      ...(options.headers || {})
    }
  });

  let data = {};
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }

  if (!res.ok) {
    const msg = data?.message || `Paystack error (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.paystack = data;
    throw err;
  }

  return data;
}

/**
 * Create a Paystack checkout session. Returns the payment page URL plus the
 * gateway's reference and access code. In dev mode returns no URL — the
 * client calls dev-complete instead.
 */
async function initialize({ email, amount, reference, metadata }) {
  if (isDevMode()) {
    return {
      devMode: true,
      authorizationUrl: null,
      accessCode: null,
      reference
    };
  }

  const payload = {
    email,
    amount: toSubunit(amount),
    currency: CURRENCY,
    reference,
    metadata,
    callback_url:
      process.env.PAYMENT_CALLBACK_URL ||
      'https://macmultimediaexams.netlify.app'
  };

  const data = await paystackFetch('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  return {
    devMode: false,
    authorizationUrl: data?.data?.authorization_url || null,
    accessCode: data?.data?.access_code || null,
    reference: data?.data?.reference || reference
  };
}

/** Ask Paystack for the status of a transaction. */
async function verify(reference) {
  if (isDevMode()) return { status: 'unknown', paid: false };

  const data = await paystackFetch(`/transaction/verify/${encodeURIComponent(reference)}`);
  const txn = data?.data || {};
  return {
    status: txn.status || 'unknown',
    paid: txn.status === 'success',
    amount: txn.amount ? txn.amount / 100 : undefined, // kobo → naira
    currency: txn.currency,
    transactionId: txn.id,
    paidAt: txn.paid_at,
    gatewayResponse: txn.gateway_response
  };
}

/**
 * Verify the signature on a Paystack webhook. Returns the parsed event body,
 * or null when the signature does not match.
 */
function verifyWebhook(rawBody, signature) {
  if (!signature || !process.env.PAYSTACK_SECRET_KEY) return null;
  const crypto = require('crypto');
  const expected = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest('hex');
  if (expected !== signature) return null;
  try {
    return JSON.parse(rawBody);
  } catch {
    return null;
  }
}

/** Default entry fee applied when a past paper is created without one. */
function defaultEntryFee() {
  const raw = Number(process.env.DEFAULT_ENTRY_FEE);
  return Number.isFinite(raw) && raw >= 0 ? raw : 300;
}

/** Default review fee applied when an exam is created without one. */
function defaultReviewFee() {
  const raw = Number(process.env.DEFAULT_REVIEW_FEE);
  return Number.isFinite(raw) && raw >= 0 ? raw : 500;
}

function currencySymbol() {
  const symbols = { NGN: '₦', USD: '$', GBP: '£', EUR: '€', GHS: '₵', KES: 'KSh' };
  return symbols[CURRENCY] || `${CURRENCY} `;
}

function currency() {
  return CURRENCY;
}

/** Public client-facing payment config (no secrets). */
function publicConfig() {
  return {
    currency: CURRENCY,
    currencySymbol: currencySymbol(),
    defaultEntryFee: defaultEntryFee(),
    defaultReviewFee: defaultReviewFee(),
    paymentsConfigured: paystackConfigured(),
    paymentsDevMode: isDevMode(),
    paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY || ''
  };
}

module.exports = {
  initialize,
  verify,
  verifyWebhook,
  defaultEntryFee,
  defaultReviewFee,
  currencySymbol,
  currency,
  publicConfig,
  isDevMode,
  paystackConfigured
};
