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

export function getReturnedPaymentReference(): string | null {
  if (typeof window === 'undefined' || !window.location?.search) return null;
  const params = new URLSearchParams(window.location.search);
  const reference = params.get('reference') || params.get('trxref');
  return reference || null;
}

export function clearReturnedPaymentReference(): void {
  if (typeof window === 'undefined') return;
  const clean = window.location.pathname + window.location.hash;
  window.history.replaceState({}, '', clean);
}
