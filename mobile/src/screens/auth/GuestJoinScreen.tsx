import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, ErrorNote, Field } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { examsApi } from '../../api/endpoints';
import { colors, spacing } from '../../theme';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../../navigation/types';
import type { Exam } from '../../api/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'GuestJoin'>;

export default function GuestJoinScreen({ navigation }: Props) {
  const { guestJoin } = useAuth();
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<Exam | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lookUp = async () => {
    if (!code.trim()) {
      setError('Enter the exam access code.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await examsApi.joinPublic(code.trim().toUpperCase());
      setPreview(res.exam);
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : 'Could not find that exam.');
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    if (!name.trim() || !email.trim()) {
      setError('Enter your name and email.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // On success the auth stack unmounts and RootNavigator forwards the
      // guest straight into the exam, so there is nothing to navigate here.
      await guestJoin(name, email, code);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join the exam.');
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
          <Text style={styles.title}>Join an exam</Text>
          <Text style={styles.subtitle}>
            Enter the access code your teacher gave you. No account needed.
          </Text>

          <ErrorNote message={error} />

          <Field
            label="Access code"
            value={code}
            onChangeText={(t) => {
              setCode(t.toUpperCase());
              setPreview(null);
            }}
            placeholder="e.g. A1B2C3D4"
            autoCapitalize="characters"
            autoCorrect={false}
            style={styles.codeInput}
            maxLength={12}
          />

          {!preview && <Button title="Find exam" onPress={lookUp} loading={busy} />}

          {!!preview && (
            <>
              <Card style={styles.previewCard}>
                <Text style={styles.previewTitle}>{preview.title}</Text>
                {!!preview.subject && (
                  <Text style={styles.previewMeta}>{preview.subject}</Text>
                )}
                <View style={styles.previewRow}>
                  <Text style={styles.previewStat}>
                    ⏱ {preview.settings?.duration ?? 0} min
                  </Text>
                  <Text style={styles.previewStat}>
                    📋 {preview.questions?.length ?? 0} questions
                  </Text>
                  <Text style={styles.previewStat}>
                    🎯 {preview.settings?.totalMarks ?? 0} marks
                  </Text>
                </View>
              </Card>

              <Field
                label="Your full name"
                value={name}
                onChangeText={setName}
                placeholder="Jane Doe"
                autoCapitalize="words"
              />
              <Field
                label="Your email"
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                hint="Used once per exam — you cannot retake with the same email."
              />
              <Button title="Start exam" onPress={join} loading={busy} />
            </>
          )}

          <Button
            title="Back to login"
            variant="ghost"
            style={{ marginTop: spacing.lg }}
            onPress={() => navigation.goBack()}
          />
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
  codeInput: { fontSize: 22, fontWeight: '700', letterSpacing: 4, textAlign: 'center' },
  previewCard: { marginTop: spacing.lg, borderColor: colors.primary },
  previewTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  previewMeta: { fontSize: 14, color: colors.textMuted, marginTop: 2 },
  previewRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, marginTop: spacing.md },
  previewStat: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
});
