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
import { colors, radius, spacing } from '../../theme';
import type { Role } from '../../api/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'Register'>;

const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: 'student', label: 'Student', hint: 'Take exams' },
  { value: 'teacher', label: 'Teacher', hint: 'Create exams' },
];

export default function RegisterScreen({ navigation }: Props) {
  const { register } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [role, setRole] = useState<Role>('student');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      await register(name, email, password, role);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Registration failed.');
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
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Create your account</Text>
          <Text style={styles.subtitle}>Join the exam platform in a few seconds.</Text>

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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.xl, paddingBottom: spacing.xxl },
  title: { fontSize: 26, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 15, color: colors.textMuted, marginTop: 4, marginBottom: spacing.xl },
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
  footerLink: { marginTop: spacing.xl, alignItems: 'center' },
  footerText: { color: colors.textMuted, fontSize: 14 },
  link: { color: colors.primary, fontWeight: '700' },
});
