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
  purpose: PaymentPurpose,
  attemptId?: string
): Promise<PaymentOutcome> {
  const res = await paymentsApi.initiate(examId, purpose, attemptId);

  if (res.devMode) {
    await paymentsApi.devComplete(res.payment.reference);
    return { paid: true, reference: res.payment.reference, authorizationUrl: null };
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
export async function verifyPayment(reference: string): Promise<boolean> {
  try {
    const res = await paymentsApi.verify(reference);
    return res.paid;
  } catch {
    return false;
  }
}

/** "₦500" style label. */
export function formatFee(amount: number | undefined, symbol = '₦'): string {
  const n = Math.round(Number(amount) || 0);
  return `${symbol}${n.toLocaleString()}`;
}
