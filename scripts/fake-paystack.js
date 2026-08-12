/**
 * A stand-in for api.paystack.co, used by scripts/payment-recovery-test.js.
 *
 * The real dev-mode path (`PAYSTACK_SECRET_KEY` unset) short-circuits the
 * gateway entirely, so it can never exercise the code that asks Paystack
 * whether a charge settled. This fake lets the tests run the server in fully
 * "Paystack configured" mode and control, from the outside, exactly which
 * references the gateway considers successful.
 *
 * Implements only what services/paystack.js calls:
 *   POST /transaction/initialize
 *   GET  /transaction/verify/:reference
 *
 * Plus test-only controls:
 *   POST /__settle   { reference, amount? }  mark a charge successful (amount in naira)
 *   GET  /__calls                            every gateway call made so far
 */
const http = require('http');

function createFakePaystack() {
  /** reference -> { status, amount (kobo), paid_at, id } */
  const transactions = new Map();
  const calls = [];

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      const url = new URL(req.url, 'http://127.0.0.1');
      const key = `${req.method} ${url.pathname}`;
      const send = (status, payload) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      // ---- test controls (not part of the Paystack API) ----
      if (key === 'POST /__settle') {
        const existing = transactions.get(body.reference) || {};
        transactions.set(body.reference, {
          ...existing,
          status: 'success',
          amount: Math.round(Number(body.amount ?? existing.amountNaira ?? 0) * 100),
          paid_at: new Date().toISOString(),
          id: existing.id || Math.floor(Math.random() * 1e9),
          gateway_response: 'Successful',
        });
        return send(200, { ok: true });
      }
      if (key === 'GET /__calls') return send(200, calls);

      calls.push({ key, reference: body.reference || url.pathname.split('/').pop() });

      // ---- the Paystack surface services/paystack.js uses ----
      if (key === 'POST /transaction/initialize') {
        const reference = body.reference;
        // Record the amount so a later /__settle can default to "paid in full".
        transactions.set(reference, {
          status: 'pending',
          amount: body.amount,
          amountNaira: body.amount / 100,
          id: Math.floor(Math.random() * 1e9),
        });
        return send(200, {
          status: true,
          data: {
            authorization_url: `https://checkout.test/pay/${reference}`,
            access_code: `ac_${reference}`,
            reference,
          },
        });
      }

      const verifyMatch = url.pathname.match(/^\/transaction\/verify\/(.+)$/);
      if (verifyMatch && req.method === 'GET') {
        const reference = decodeURIComponent(verifyMatch[1]);
        const txn = transactions.get(reference);
        if (!txn) {
          return send(404, { status: false, message: 'Transaction reference not found' });
        }
        return send(200, {
          status: true,
          data: {
            status: txn.status,
            amount: txn.amount,
            currency: 'NGN',
            id: txn.id,
            paid_at: txn.paid_at,
            gateway_response: txn.gateway_response || 'Pending',
            reference,
          },
        });
      }

      send(404, { status: false, message: 'Not found' });
    });
  });

  return {
    server,
    listen: (port) => new Promise((r) => server.listen(port, '127.0.0.1', r)),
    close: () => new Promise((r) => server.close(r)),
    transactions,
    calls,
  };
}

module.exports = { createFakePaystack };
