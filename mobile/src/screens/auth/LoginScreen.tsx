import React, { useState } from 'react';
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
import { Button, ErrorNote, Field } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { colors, spacing } from '../../theme';
import { APP_NAME } from '../../config';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      // Navigation happens automatically once the user is in context.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed.');
    } finally {
      setBusy(false);
    }
  };

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

          <Button title="Log in" onPress={onSubmit} loading={busy} />

          <View style={styles.dividerRow}>
            <View style={styles.divider} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.divider} />
          </View>

          <Button
            title="Join an exam with a code"
            variant="secondary"
            onPress={() => navigation.navigate('GuestJoin')}
          />

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

const styles = StyleSheet.create({
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
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: spacing.xl },
  divider: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { marginHorizontal: spacing.md, color: colors.textLight, fontSize: 13 },
  footerLink: { marginTop: spacing.xl, alignItems: 'center' },
  footerText: { color: colors.textMuted, fontSize: 14 },
  link: { color: colors.primary, fontWeight: '700' },
});
