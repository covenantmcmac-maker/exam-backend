import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@pending_registration_payment';

export interface PendingRegistrationPayment {
  email: string;
  password: string;
  paymentToken: string;
  amount: number;
  reference?: string | null;
  checkoutUrl?: string | null;
  mode: 'login' | 'register';
}

export async function savePendingRegistrationPayment(
  payment: PendingRegistrationPayment
): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(payment));
}

export async function loadPendingRegistrationPayment(): Promise<PendingRegistrationPayment | null> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingRegistrationPayment;
  } catch {
    return null;
  }
}

export async function clearPendingRegistrationPayment(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}

/**
 * The reference Paystack appends when it redirects back to the app.
 *
 * Consumed once and cached: several screens look for it (Login, Register and
 * the global PaymentRedirectHandler all mount on the same load), and whoever
 * strips it from the URL first would otherwise leave the others with nothing.
 * The cache keeps the value readable by all of them for this page load.
 */
let consumedReference: string | null = null;

export function getReturnedPaymentReference(): string | null {
  if (consumedReference) return consumedReference;
  if (typeof window === 'undefined' || !window.location?.search) return null;
  const params = new URLSearchParams(window.location.search);
  const reference = params.get('reference') || params.get('trxref');
  if (reference) consumedReference = reference;
  return reference || null;
}

/**
 * Strip ?reference from the address bar so a later refresh doesn't re-run the
 * confirmation. The value stays available via getReturnedPaymentReference()
 * for the rest of this page load.
 */
export function clearReturnedPaymentReference(): void {
  if (typeof window === 'undefined') return;
  const clean = window.location.pathname + window.location.hash;
  window.history.replaceState({}, '', clean);
}

/** Test seam: forget the cached reference (also used on a fresh sign-in). */
export function resetReturnedPaymentReference(): void {
  consumedReference = null;
}
