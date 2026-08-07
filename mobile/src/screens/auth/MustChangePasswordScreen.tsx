import React, { useMemo, useState } from 'react';
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
import { authApi } from '../../api/endpoints';
import { useAuth } from '../../context/AuthContext';
import { useDialog } from '../../components/Dialog';
import { spacing } from '../../theme';
import { useColors } from '../../context/ThemeContext';
import type { Colors } from '../../theme';

export default function MustChangePasswordScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const dialog = useDialog();
  const { refresh, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('123456');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('Fill in all password fields.');
      return;
    }
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword === '123456') {
      setError('Please choose a new password, not 123456.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      await refresh();
      await dialog.notify('Password updated', 'Your new password has been saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change password.');
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
          <Text style={styles.title}>Set your own password</Text>
          <Text style={styles.subtitle}>
            Your account was created or reset with the default password 123456. Change it now
            before continuing.
          </Text>

          <Card>
            <ErrorNote message={error} />
            <Field
              label="Current password"
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              hint="Usually 123456"
            />
            <Field
              label="New password"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Field
              label="Confirm new password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={onSubmit}
            />
            <Button title="Save new password" onPress={onSubmit} loading={busy} />
          </Card>

          <View style={{ marginTop: spacing.lg }}>
            <Button title="Log out" variant="ghost" onPress={() => void logout()} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    scroll: { padding: spacing.xl, paddingBottom: spacing.xxl, justifyContent: 'center', flexGrow: 1 },
    title: { fontSize: 26, fontWeight: '800', color: colors.text },
    subtitle: { fontSize: 15, color: colors.textMuted, marginTop: 6, marginBottom: spacing.xl, lineHeight: 22 },
  });
