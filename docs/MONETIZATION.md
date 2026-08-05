# Monetisation: paid past questions + paid answer reviews

Every exam can now earn money **twice**:

| | Taking the exam | Answer review (after submit) |
| --- | --- | --- |
| **Past-question papers** (platform-owned, admin-created) | 💰 **Entry fee** — Start button stays locked until paid | 💰 **Review fee** — score only until paid |
| **Teacher-set exams** (shared via access code) | 🆓 **Free** | 💰 **Review fee** — teacher sets it per exam |

Fees are charged in **naira (₦)** through **Paystack**. A single paper can
therefore generate two payments per student: once at entry, once at review.

---

## How it works

### Exam sources
- `source: 'teacher'` (default) — created by a teacher, shared by access code.
  Entry is **always free** (the API forces `entryFee: 0`).
- `source: 'past'` — platform-owned past-question paper (e.g. "Biology 2022").
  **Only admins can create them.** Admins set both fees.

### Fees
Stored per exam in `pricing`:

```json
{
  "pricing": {
    "entryFee": 300,
    "reviewFee": 500,
    "currency": "NGN"
  }
}
```

**Platform pricing (current): ₦300 to take a past paper, ₦500 to review the
answers.** These are the defaults applied when a paper is created without
explicit fees (`DEFAULT_ENTRY_FEE=300`, `DEFAULT_REVIEW_FEE=500`).

- Teachers set their own **review fee** in the exam builder (₦0 = free review).
  If they leave it blank, the platform default (`DEFAULT_REVIEW_FEE`, ₦500)
  applies.
- Admins can override the price on any past paper per exam.
- The **review fee is per attempt**: retake the paper and want the review
  again → pay again.

### Enforcement (server side)
- `GET /api/exams/:id/take` and `POST /api/attempts/start` return **402
  Payment Required** (with `paymentRequired`, `amount`, `currency`) when the
  entry fee is unpaid. The mobile app renders a paywall.
- `GET /api/attempts/:attemptId/review` returns **402** until the review fee
  for that attempt is paid. It then returns every question, the student's
  selection, the correct answer and the explanation.
- The **take payload never contains answers**: correct answers, explanations
  *and* the option-correctness flags are stripped until the review is bought.
- Guests cannot take paid papers (payment requires a real account).

### Payments
- `Payment` model records every transaction: student, exam, attempt (for
  reviews), purpose (`entry` | `review`), amount, status.
- Paystack is the gateway: `POST /api/payments/initiate` creates a checkout
  session (`authorization_url`), the **webhook**
  `POST /api/payments/webhook/paystack` confirms it, and
  `GET /api/payments/:reference/verify` is the client-side fallback after the
  student returns from Paystack.
- Re-initiating the same payment reuses the pending record — no double charges.

### Admin
- Admin panel: **Revenue** tiles (total / entry / review) on the Overview tab
  and a **Payments** tab listing every transaction.
- Admin exams tab lists past vs teacher papers with their fees and a
  **"+ New past paper"** button that opens the builder in past-paper mode
  (year + entry fee + review fee).

### Student
- New **📚 Past questions** tab: the paid library grouped by subject and year,
  with subject chips and search. Cards show the price; the **Start button
  stays locked** (🔒) until the entry fee is paid.
- Results screen and post-submit screen get a **"Review answers"** button that
  opens the paywall when the review fee hasn't been paid.

---

## Configuration (backend `.env` / Render env vars)

```bash
# ── REQUIRED for live payments ──────────────────────────────────────────────
# Paystack SECRET key (sk_live_…). Only the backend sees this. Set it in the
# Render dashboard, never in the app or in chat. While unset the API runs in
# DEV MODE (payments complete instantly, no real charges).
PAYSTACK_SECRET_KEY=sk_live_xxxxxxxxxxxxxxxxxxxx

# ── Public key (safe to expose, served via GET /api/config) ─────────────────
PAYSTACK_PUBLIC_KEY=pk_live_xxxxxxxxxxxxxxxxxxxx

# ── Where the browser returns after paying on Paystack (defaults to the PWA)
PAYMENT_CALLBACK_URL=https://macmultimediaexams.netlify.app
# Currency for all fees (default NGN).
PAYMENT_CURRENCY=NGN

# ── Pricing defaults (naira) ────────────────────────────────────────────────
# Applied when an exam is created without explicit fees. Admins/teachers can
# still set any amount per exam in the exam builder.
DEFAULT_ENTRY_FEE=300
DEFAULT_REVIEW_FEE=500
```

Full template in `.env.example`. A local `.env` with your public key and the
₦300/₦500 defaults is already in the repo (gitignored).

### Paystack webhook

Register `https://<your-api>/api/payments/webhook/paystack` as the webhook URL
in the Paystack dashboard (event: `charge.success`). The API verifies the
`x-paystack-signature` HMAC on the raw body, so the endpoint is safe without
extra auth.

### Dev mode (no Paystack key)

Without `PAYSTACK_SECRET_KEY` (and outside `NODE_ENV=production`) the API runs
in **dev mode**: `initiate` skips Paystack, and
`POST /api/payments/:reference/dev-complete` marks the payment paid so the
whole flow works end-to-end locally. Dev mode is never active once a key is
set. The app surfaces this as an instant "Payment successful" in dev mode.

---

## New API endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/config` | Public app config (currency, symbol, default fee, dev mode) |
| GET | `/api/exams/past` | Paid past-question library (published, with purchase state) |
| POST | `/api/payments/initiate` | Start an `entry` or `review` payment → checkout URL |
| GET | `/api/payments/:reference/verify` | Confirm payment after returning from Paystack |
| POST | `/api/payments/:reference/dev-complete` | Dev mode only: mark a payment paid |
| POST | `/api/payments/webhook/paystack` | Paystack webhook (signature verified) |
| GET | `/api/payments/my-payments` | Student purchase history |
| GET | `/api/attempts/:attemptId/review` | Full answer review (402 until review fee paid) |
| GET | `/api/admin/payments` | Admin payment ledger + totals |
| GET | `/api/admin/stats` | Now includes `payments` revenue block |

---

## Tests

```bash
# Backend route-level integration test (in-memory DB stand-in, no MongoDB
# or network needed — exercises the real Express routes end to end):
cd exam-backend
npm test

# Mobile API layer against the mock server + TypeScript typecheck:
cd mobile
npm run test:api && npm run typecheck
```

---

## Going live: keys + webhook checklist

**Keys.** Paystack uses two keys:
- `pk_live_…` (**public**) — safe to expose; the app receives it via
  `GET /api/config`. Your key is already configured in the repo's local
  `.env` (gitignored).
- `sk_live_…` (**secret**) — required for the backend to create checkouts,
  verify transactions and validate webhooks. Add it in the **Render
  dashboard** environment variables. While it is missing, the API stays in
  dev mode (payments complete instantly without real charges).

**Webhook.** In the Paystack dashboard → Settings → API Keys & Webhooks, add:

```
https://exam-backend-1-gbh3.onrender.com/api/payments/webhook/paystack
```

(event: `charge.success`). Confirm deliveries return 200 in Paystack's
webhook log.

**Verification.** `GET https://exam-backend-1-gbh3.onrender.com/api/config`
should show `paymentsConfigured: true` and `paymentsDevMode: false` once the
secret key is live.

**Pricing.** Defaults are ₦300 entry / ₦500 review (`DEFAULT_ENTRY_FEE`,
`DEFAULT_REVIEW_FEE`). The exam builder prefills these; admins and teachers
can still override per exam.

**Test first.** Run a real payment on a paper you own before advertising it —
refunds are manual on Paystack.
