import { Linking } from 'react-native';
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
 * Open the Paystack checkout page.
 *
 * On web, Linking.openURL() can fail silently after the async API request
 * because browsers treat it as a popup. Try a new tab first, then fall back
 * to navigating the current tab so the student is never left on a fake
 * "pending" screen with no checkout page.
 */
export async function openCheckout(url: string | null): Promise<void> {
  if (!url) {
    throw new Error('Paystack did not return a checkout link. Please try again.');
  }

  if (typeof window !== 'undefined' && typeof window.open === 'function') {
    const popup = window.open(url, '_blank', 'noopener,noreferrer');
    if (popup) return;

    // Popup blockers commonly reject window.open after an async request.
    // Same-tab navigation is reliable and still takes the student to Paystack.
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
