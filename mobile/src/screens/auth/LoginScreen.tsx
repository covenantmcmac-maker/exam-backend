import React, { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
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
import { ApiError } from '../../api/client';
import { configApi } from '../../api/endpoints';
import { spacing } from '../../theme';
import { useColors } from '../../context/ThemeContext';
import type { Colors } from '../../theme';
import { APP_NAME } from '../../config';
import type { AppConfig } from '../../api/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../../navigation/types';
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

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { login } = useAuth();
  const dialog = useDialog();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paymentToken, setPaymentToken] = useState<string | null>(null);
  const [registrationAmount, setRegistrationAmount] = useState(0);
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null);
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
      if (!pending || pending.mode !== 'login' || cancelled) return;

      setEmail((prev) => prev || pending.email);
      setPassword((prev) => prev || pending.password);
      setPaymentToken(pending.paymentToken);
      setRegistrationAmount(pending.amount);
      setPendingRef(pending.reference || null);
      setCheckoutUrl(pending.checkoutUrl || null);
      setPaymentMessage('Complete the one-time registration payment before you sign in.');

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
    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await clearPendingRegistrationPayment();
      await login(email, password);
      // Navigation happens automatically once the user is in context.
    } catch (e) {
      if (e instanceof ApiError && e.status === 402 && e.data?.purpose === 'registration') {
        setPaymentToken(String(e.data.paymentToken || ''));
        setRegistrationAmount(Number(e.data.amount) || 0);
        setPaymentMessage(e.message);
        setPendingRef(null);
        setCheckoutUrl(null);
      } else {
        setError(e instanceof Error ? e.message : 'Login failed.');
      }
    } finally {
      setBusy(false);
    }
  };

  const onForgotPassword = async () => {
    const action = await dialog.choose<'whatsapp' | 'email'>(
      'Forgot password?',
      'Contact the admin to reset your password to 123456, then sign in and choose a new one.',
      [
        { label: 'WhatsApp admin', value: 'whatsapp' },
        { label: 'Email admin', value: 'email' },
      ]
    );

    if (action === 'whatsapp') {
      await Linking.openURL('https://wa.me/2348106318820');
    } else if (action === 'email') {
      await Linking.openURL('mailto:covenantmcmac@gmail.com');
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
        mode: 'login',
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
    config?.studentRegistrationFeeActive && config.studentRegistrationFee > 0
      ? `Students pay a one-time registration fee of ${formatFee(
          config.studentRegistrationFee,
          config.currencySymbol
        )}. Teachers and admins are not charged.`
      : null;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Text style={styles.logo}>📝</Text>
            <Text style={styles.appName}>{APP_NAME}</Text>
            <Text style={styles.tagline}>Sign in to continue</Text>
          </View>

          {!!feeNotice && (
            <Card style={styles.noticeCard}>
              <Text style={styles.noticeTitle}>Student registration fee</Text>
              <Text style={styles.noticeText}>{feeNotice}</Text>
            </Card>
          )}

          <ErrorNote message={error} />

          <Field
            label="Email address"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
          />

          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secureTextEntry
            autoCapitalize="none"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={onSubmit}
          />

          <Pressable style={styles.forgotLink} onPress={() => void onForgotPassword()}>
            <Text style={styles.forgotText}>Forgot password?</Text>
          </Pressable>

          <Button title="Log in" onPress={onSubmit} loading={busy} />

          {!!paymentToken && (
            <Card style={styles.noticeCard}>
              <Text style={styles.noticeTitle}>Complete registration payment</Text>
              <Text style={styles.noticeText}>
                {paymentMessage ||
                  `Pay ${formatFee(registrationAmount, config?.currencySymbol || '₦')} once to unlock this student account.`}
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

          <View style={styles.dividerRow}>
            <View style={styles.divider} />
            <Text style={styles.dividerText}>next</Text>
            <View style={styles.divider} />
          </View>

          <Card style={styles.noticeCard}>
            <Text style={styles.noticeTitle}>Have a teacher access code?</Text>
            <Text style={styles.noticeText}>
              Sign in or register first, then enter the code on your student home screen.
            </Text>
          </Card>

          <Pressable
            style={styles.footerLink}
            onPress={() => navigation.navigate('Register')}
          >
            <Text style={styles.footerText}>
              Don&apos;t have an account? <Text style={styles.link}>Register</Text>
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
    scroll: { padding: spacing.xl, paddingTop: spacing.xxl, flexGrow: 1, justifyContent: 'center' },
    header: { alignItems: 'center', marginBottom: spacing.xxl },
    logo: { fontSize: 52 },
    appName: {
      fontSize: 24,
      fontWeight: '800',
      color: colors.text,
      marginTop: spacing.sm,
      textAlign: 'center',
    },
    tagline: { fontSize: 15, color: colors.textMuted, marginTop: spacing.xs },
    noticeCard: { borderColor: colors.primaryLight },
    noticeTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
    noticeText: { fontSize: 13, color: colors.textMuted, marginTop: 4, lineHeight: 20 },
    forgotLink: { alignSelf: 'flex-end', marginBottom: spacing.lg, marginTop: -spacing.sm },
    forgotText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
    payActions: { gap: spacing.sm, marginTop: spacing.md },
    dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: spacing.xl },
    divider: { flex: 1, height: 1, backgroundColor: colors.border },
    dividerText: { marginHorizontal: spacing.md, color: colors.textLight, fontSize: 13 },
    footerLink: { marginTop: spacing.xl, alignItems: 'center' },
    footerText: { color: colors.textMuted, fontSize: 14 },
    link: { color: colors.primary, fontWeight: '700' },
  });
