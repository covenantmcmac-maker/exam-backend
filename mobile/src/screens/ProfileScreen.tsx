import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Badge, Button, Card, ErrorNote, Field } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useDialog } from '../components/Dialog';
import { authApi } from '../api/endpoints';
import { spacing } from '../theme';
import { useColors } from '../context/ThemeContext';
import type { Colors } from '../theme';
import { API_BASE_URL, APP_NAME } from '../config';
import type { RootStackParamList } from '../navigation/types';
import type { NavigationProp } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';

const makeRoleTint = (colors: Colors): Record<string, { fg: string; bg: string }> => ({
  admin: { fg: colors.danger, bg: colors.dangerLight },
  teacher: { fg: colors.primary, bg: colors.primaryLight },
  student: { fg: colors.success, bg: colors.successLight },
});

export default function ProfileScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const roleTint = useMemo(() => makeRoleTint(colors), [colors]);
  const { user, logout, isAdmin } = useAuth();
  const dialog = useDialog();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);

  const tint = roleTint[user?.role || 'student'];
  const initials =
    user?.name
      ?.split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((n) => n[0]?.toUpperCase())
      .join('') || '?';

  const confirmLogout = async () => {
    const ok = await dialog.confirm('Log out', 'Are you sure you want to log out?', {
      confirmLabel: 'Log out',
      destructive: true,
    });
    if (ok) await logout();
  };

  const changePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('Fill in all password fields.');
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New password and confirmation do not match.');
      return;
    }

    setChangingPassword(true);
    setPasswordError(null);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await dialog.notify('Password changed', 'You can use your new password next time you log in.');
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : 'Could not change password.');
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Profile</Text>

        <Card style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <Text style={styles.name}>{user?.name}</Text>
          <Text style={styles.email}>{user?.email}</Text>
          <View style={{ marginTop: spacing.md }}>
            <Badge text={(user?.role || 'student').toUpperCase()} color={tint.fg} bg={tint.bg} />
          </View>
        </Card>

        {isAdmin && (
          <Pressable onPress={() => navigation.navigate('AdminPanel')}>
            <Card style={styles.linkRow}>
              <Text style={styles.linkIcon}>🛡️</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.linkTitle}>Admin panel</Text>
                <Text style={styles.linkSub}>Manage users, exams and attempts</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Card>
          </Pressable>
        )}

        <Card>
          <Text style={styles.sectionLabel}>Security</Text>
          <Text style={styles.securityHint}>
            Change your password regularly to keep your account safe.
          </Text>
          <ErrorNote message={passwordError} />
          <Field
            label="Current password"
            value={currentPassword}
            onChangeText={setCurrentPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
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
          />
          <Button title="Change password" onPress={changePassword} loading={changingPassword} />
        </Card>

        <Card>
          <Text style={styles.sectionLabel}>About</Text>
          <View style={styles.aboutRow}>
            <Text style={styles.aboutKey}>App</Text>
            <Text style={styles.aboutVal}>{APP_NAME}</Text>
          </View>
          <View style={styles.aboutRow}>
            <Text style={styles.aboutKey}>Server</Text>
            <Text style={styles.aboutVal} numberOfLines={1}>
              {API_BASE_URL}
            </Text>
          </View>
        </Card>

        <Button title="Log out" variant="danger" onPress={confirmLogout} />
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  title: { fontSize: 26, fontWeight: '800', color: colors.text, marginBottom: spacing.lg },
  profileCard: { alignItems: 'center', paddingVertical: spacing.xl },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 28, fontWeight: '800', color: colors.white },
  name: { fontSize: 20, fontWeight: '700', color: colors.text, marginTop: spacing.md },
  email: { fontSize: 14, color: colors.textMuted, marginTop: 2 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  linkIcon: { fontSize: 24 },
  linkTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  linkSub: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  chevron: { fontSize: 28, color: colors.textLight },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textLight,
    letterSpacing: 0.5,
    marginBottom: spacing.md,
  },
  securityHint: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 19,
    marginTop: -spacing.xs,
    marginBottom: spacing.md,
  },
  aboutRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, gap: spacing.lg },
  aboutKey: { fontSize: 14, color: colors.textMuted },
  aboutVal: { fontSize: 14, color: colors.text, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
});
