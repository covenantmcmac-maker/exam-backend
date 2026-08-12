import { Linking, Platform } from 'react-native';
import { paymentsApi } from '../api/endpoints';
import type { PaymentPurpose } from '../api/types';

export interface PaymentOutcome {
  /** True when the money is already confirmed (dev mode or pre-paid). */
  paid: boolean;
  reference: string | null;
  authorizationUrl: string | null;
}

/**
 * Start a payment for an exam (entry fee or review fee).
 *
 * In dev mode (no Paystack key configured) the payment is completed
 * immediately server-side. Otherwise a Paystack checkout URL is returned and
 * the caller should open it, then call `verifyPayment(reference)` once the
 * student is back.
 */
export async function initiatePayment(
  examId: string,
  purpose: Extract<PaymentPurpose, 'entry' | 'review'>,
  attemptId?: string
): Promise<PaymentOutcome> {
  const res = await paymentsApi.initiate({ examId, purpose, attemptId });

  // `paid` is the server's explicit "this item is already settled" flag; the
  // status check is the older signal and stays as a fallback.
  if (res.paid || res.payment?.status === 'paid') {
    return { paid: true, reference: res.payment?.reference ?? null, authorizationUrl: null };
  }

  if (res.devMode) {
    if (!res.payment.reference) {
      throw new Error('Payment reference missing. Please try again.');
    }
    await paymentsApi.devComplete(res.payment.reference);
    return { paid: true, reference: res.payment.reference, authorizationUrl: null };
  }

  return {
    paid: false,
    reference: res.payment.reference,
    authorizationUrl: res.authorizationUrl,
  };
}

/** Start or resume the one-time student registration payment. */
export async function initiateRegistrationPayment(
  paymentToken: string
): Promise<PaymentOutcome> {
  const res = await paymentsApi.initiate({
    purpose: 'registration',
    paymentToken,
  });

  if (res.paid || res.payment?.status === 'paid') {
    return { paid: true, reference: res.payment?.reference ?? null, authorizationUrl: null };
  }

  if (res.devMode && res.payment.reference) {
    await paymentsApi.devComplete(res.payment.reference, paymentToken);
    return { paid: true, reference: res.payment.reference, authorizationUrl: null };
  }

  if (res.devMode && !res.payment.reference) {
    throw new Error('Payment reference missing. Please try again.');
  }

  return {
    paid: false,
    reference: res.payment.reference,
    authorizationUrl: res.authorizationUrl,
  };
}

/**
 * True when running in an installed PWA / WebAPK / TWA. In these modes
 * `window.open()` to a cross-origin checkout is unreliable: it can open a
 * Custom Chrome Tab that is not part of the installed app, or return a
 * WindowProxy whose navigation is blocked by the standalone shell.
 */
function isStandaloneWeb(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  const displayMode = window.matchMedia?.('(display-mode: standalone)')?.matches;
  return Boolean(displayMode || nav.standalone);
}

/**
 * Open the Paystack checkout page.
 *
 * The checkout call only resolves AFTER the server responds, so browsers no
 * longer treat the navigation as user-initiated. A `window.open()` popup made
 * here is therefore either blocked outright or opened to about:blank and then
 * refused the cross-origin navigation — leaving the student on the
 * "Payment pending…" screen with no Paystack window.
 *
 * To avoid that dead end we navigate the SAME tab to Paystack on web. Paystack
 * redirects back to the app with ?reference=… when payment finishes, and
 * PaymentRedirectHandler verifies it. The pending payment is idempotent on the
 * server, so returning and tapping Pay again never creates a second charge.
 *
 * In an installed PWA we also fall through to `Linking.openURL`, which hands
 * the checkout to the system browser / Custom Tab so the standalone shell
 * doesn't trap the cross-origin redirect.
 */
export async function openCheckout(url: string | null): Promise<void> {
  if (!url) {
    throw new Error('Paystack did not return a checkout link. Please try again.');
  }

  // Installed PWA / WebAPK: let the OS open the checkout in a real browser
  // tab. window.open() from a standalone shell frequently produces a blank
  // window that never navigates to Paystack.
  if (isStandaloneWeb()) {
    try {
      await Linking.openURL(url);
      return;
    } catch {
      // Fall through to same-tab navigation if the OS refused the URL.
    }
  }

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    // Same-tab navigation is a genuine, user-initiated-style navigation that
    // browsers and WebViews allow, and it always reaches Paystack.
    window.location.assign(url);
    return;
  }

  await Linking.openURL(url);
}

/** Ask the server whether a payment reference has settled. */
export async function verifyPayment(reference: string, paymentToken?: string): Promise<boolean> {
  try {
    const res = await paymentsApi.verify(reference, paymentToken);
    return res.paid;
  } catch {
    return false;
  }
}

/** What is being bought. Enough to look a payment up without a reference. */
export interface PaymentItem {
  purpose: PaymentPurpose;
  examId?: string;
  attemptId?: string;
  paymentToken?: string;
}

export interface PaymentRecovery {
  /** True when this item is already settled — unlock immediately. */
  paid: boolean;
  /** A checkout that was opened but has not settled: offer resume, not re-pay. */
  pendingReference: string | null;
  pendingCheckoutUrl: string | null;
}

const NOTHING_RECOVERED: PaymentRecovery = {
  paid: false,
  pendingReference: null,
  pendingCheckoutUrl: null,
};

/**
 * Restore payment state for one item after a refresh / redirect return.
 *
 * Two things can be lost when the browser navigates away to Paystack and back:
 * the in-memory pending reference, and the ?reference query param (dropped by
 * a redirect, a PWA cold start, or the user just hitting reload). Keying the
 * lookup on the ITEM instead of the reference survives both, and the server
 * reconciles any pending charge against Paystack before answering — so a
 * confirmed payment unlocks access on the very next load.
 *
 * Never throws: a network failure degrades to "nothing recovered" and the
 * normal paywall is shown.
 */
export async function recoverPaymentState(item: PaymentItem): Promise<PaymentRecovery> {
  try {
    const res = await paymentsApi.status(item);
    if (res.paid) {
      return { paid: true, pendingReference: null, pendingCheckoutUrl: null };
    }
    return {
      paid: false,
      pendingReference: res.pending?.reference ?? null,
      pendingCheckoutUrl: res.pending?.authorizationUrl ?? null,
    };
  } catch {
    return NOTHING_RECOVERED;
  }
}

/**
 * Confirm a payment when coming back from Paystack.
 *
 * Tries the returned reference first (fastest, and the only signal available
 * before the gateway has told the server anything), then falls back to the
 * item lookup. Either path succeeding means the student has paid.
 */
export async function confirmPayment(
  item: PaymentItem,
  reference?: string | null
): Promise<boolean> {
  if (reference && (await verifyPayment(reference, item.paymentToken))) return true;
  const recovered = await recoverPaymentState(item);
  return recovered.paid;
}

/** "₦500" style label. */
export function formatFee(amount: number | undefined, symbol = '₦'): string {
  const n = Math.round(Number(amount) || 0);
  return `${symbol}${n.toLocaleString()}`;
}
