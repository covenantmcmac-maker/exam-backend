import React, { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, ErrorNote, Field } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { radius, spacing } from '../../theme';
import { useColors } from '../../context/ThemeContext';
import type { Colors } from '../../theme';
import type { AppConfig, Role } from '../../api/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../../navigation/types';
import { ApiError } from '../../api/client';
import { configApi } from '../../api/endpoints';
import { useDialog } from '../../components/Dialog';
import {
  clearPendingRegistrationPayment,
  clearReturnedPaymentReference,
  getReturnedPaymentReference,
  loadPendingRegistrationPayment,
  savePendingRegistrationPayment,
} from '../../utils/registration-payments';
import {
  formatFee,
  initiateRegistrationPayment,
  openCheckout,
  verifyPayment,
} from '../../utils/payments';

type Props = NativeStackScreenProps<AuthStackParamList, 'Register'>;

const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: 'student', label: 'Student', hint: 'Take exams' },
  { value: 'teacher', label: 'Teacher', hint: 'Create exams' },
];

export default function RegisterScreen({ navigation }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { register, login } = useAuth();
  const dialog = useDialog();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [role, setRole] = useState<Role>('student');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paymentToken, setPaymentToken] = useState<string | null>(null);
  const [registrationAmount, setRegistrationAmount] = useState(0);
  const [pendingRef, setPendingRef] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [payBusy, setPayBusy] = useState(false);

  useEffect(() => {
    void configApi.get().then(setConfig).catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const pending = await loadPendingRegistrationPayment();
      if (!pending || pending.mode !== 'register' || cancelled) return;

      setEmail((prev) => prev || pending.email);
      setPassword((prev) => prev || pending.password);
      setConfirm((prev) => prev || pending.password);
      setPaymentToken(pending.paymentToken);
      setRegistrationAmount(pending.amount);
      setPendingRef(pending.reference || null);
      setCheckoutUrl(pending.checkoutUrl || null);

      const returnedReference = getReturnedPaymentReference();
      if (!returnedReference) return;
      clearReturnedPaymentReference();

      setPayBusy(true);
      const paid = await verifyPayment(returnedReference, pending.paymentToken);
      if (cancelled) return;
      if (paid) {
        await clearPendingRegistrationPayment();
        try {
          await login(pending.email, pending.password);
          return;
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Payment verified, but login failed.');
          setPayBusy(false);
          return;
        }
      }
      setPendingRef(returnedReference);
      setError('Payment was not confirmed yet. You can reopen Paystack or confirm again.');
      setPayBusy(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [login]);

  const onSubmit = async () => {
    if (!name.trim() || !email.trim() || !password) {
      setError('Please fill in all fields.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await clearPendingRegistrationPayment();
      await register(name, email, password, role);
    } catch (e) {
      if (e instanceof ApiError && e.status === 402 && e.data?.purpose === 'registration') {
        setPaymentToken(String(e.data.paymentToken || ''));
        setRegistrationAmount(Number(e.data.amount) || 0);
        setPendingRef(null);
        setCheckoutUrl(null);
        await dialog.notify(
          'Account created',
          'Complete the one-time registration payment, then we will sign you in.'
        );
      } else {
        setError(e instanceof Error ? e.message : 'Registration failed.');
      }
    } finally {
      setBusy(false);
    }
  };

  const startRegistrationPayment = async () => {
    if (!paymentToken) return;
    setPayBusy(true);
    setError(null);
    try {
      const outcome = await initiateRegistrationPayment(paymentToken);
      if (outcome.paid) {
        await clearPendingRegistrationPayment();
        await login(email, password);
        return;
      }

      await savePendingRegistrationPayment({
        mode: 'register',
        email,
        password,
        paymentToken,
        amount: registrationAmount,
        reference: outcome.reference,
        checkoutUrl: outcome.authorizationUrl,
      });
      setPendingRef(outcome.reference);
      setCheckoutUrl(outcome.authorizationUrl);
      await openCheckout(outcome.authorizationUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment could not be started.');
      setPendingRef(null);
      setCheckoutUrl(null);
    } finally {
      setPayBusy(false);
    }
  };

  const confirmRegistrationPayment = async () => {
    if (!paymentToken || !pendingRef) return;
    setPayBusy(true);
    setError(null);
    try {
      const paid = await verifyPayment(pendingRef, paymentToken);
      if (!paid) {
        await dialog.notify(
          'Not confirmed yet',
          "We couldn't confirm the payment yet. Check Paystack, then try again."
        );
        return;
      }
      await clearPendingRegistrationPayment();
      setPendingRef(null);
      setCheckoutUrl(null);
      await login(email, password);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not confirm payment.');
    } finally {
      setPayBusy(false);
    }
  };

  const feeNotice =
    config?.studentRegistrationFeeActive && role === 'student'
      ? `Students pay a one-time registration fee of ${formatFee(
          config.studentRegistrationFee,
          config.currencySymbol
        )} before their first sign-in.`
      : role === 'teacher'
        ? 'Teachers are not charged the student registration fee.'
        : null;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Create your account</Text>
          <Text style={styles.subtitle}>Join the exam platform in a few seconds.</Text>

          {!!feeNotice && (
            <Card style={styles.noticeCard}>
              <Text style={styles.noticeTitle}>Registration</Text>
              <Text style={styles.noticeText}>{feeNotice}</Text>
            </Card>
          )}

          <ErrorNote message={error} />

          <Field
            label="Full name"
            value={name}
            onChangeText={setName}
            placeholder="Jane Doe"
            autoCapitalize="words"
            textContentType="name"
          />

          <Field
            label="Email address"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            textContentType="emailAddress"
          />

          <Text style={styles.label}>I am a</Text>
          <View style={styles.roleRow}>
            {ROLES.map((r) => {
              const active = role === r.value;
              return (
                <Pressable
                  key={r.value}
                  onPress={() => setRole(r.value)}
                  style={[styles.roleCard, active && styles.roleCardActive]}
                >
                  <Text style={[styles.roleLabel, active && styles.roleLabelActive]}>
                    {r.label}
                  </Text>
                  <Text style={styles.roleHint}>{r.hint}</Text>
                </Pressable>
              );
            })}
          </View>

          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="At least 6 characters"
            secureTextEntry
            autoCapitalize="none"
          />

          <Field
            label="Confirm password"
            value={confirm}
            onChangeText={setConfirm}
            placeholder="Re-enter your password"
            secureTextEntry
            autoCapitalize="none"
            onSubmitEditing={onSubmit}
          />

          <Button title="Create account" onPress={onSubmit} loading={busy} />

          {!!paymentToken && (
            <Card style={styles.noticeCard}>
              <Text style={styles.noticeTitle}>Unlock your student account</Text>
              <Text style={styles.noticeText}>
                Pay {formatFee(registrationAmount, config?.currencySymbol || '₦')} once to finish
                activating this student account.
              </Text>
              {pendingRef ? (
                <View style={styles.payActions}>
                  <Button
                    title="Reopen Paystack"
                    variant="ghost"
                    onPress={() => {
                      if (checkoutUrl) void openCheckout(checkoutUrl).catch(() => undefined);
                    }}
                  />
                  <Button title="I've paid — confirm" onPress={confirmRegistrationPayment} loading={payBusy} />
                </View>
              ) : (
                <Button
                  title={`Pay ${formatFee(registrationAmount, config?.currencySymbol || '₦')} & unlock`}
                  onPress={startRegistrationPayment}
                  loading={payBusy}
                />
              )}
            </Card>
          )}

          <Pressable style={styles.footerLink} onPress={() => navigation.goBack()}>
            <Text style={styles.footerText}>
              Already registered? <Text style={styles.link}>Log in</Text>
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    scroll: { padding: spacing.xl, paddingBottom: spacing.xxl },
    title: { fontSize: 26, fontWeight: '800', color: colors.text },
    subtitle: { fontSize: 15, color: colors.textMuted, marginTop: 4, marginBottom: spacing.xl },
    noticeCard: { borderColor: colors.primaryLight },
    noticeTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
    noticeText: { fontSize: 13, color: colors.textMuted, marginTop: 4, lineHeight: 20 },
    label: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textMuted,
      marginBottom: spacing.sm,
    },
    roleRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
    roleCard: {
      flex: 1,
      borderWidth: 1.5,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: spacing.lg,
      backgroundColor: colors.card,
    },
    roleCardActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
    roleLabel: { fontSize: 16, fontWeight: '700', color: colors.text },
    roleLabelActive: { color: colors.primary },
    roleHint: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
    payActions: { gap: spacing.sm, marginTop: spacing.md },
    footerLink: { marginTop: spacing.xl, alignItems: 'center' },
    footerText: { color: colors.textMuted, fontSize: 14 },
    link: { color: colors.primary, fontWeight: '700' },
  });
