import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { colors, radius, shadow, spacing } from '../theme';

/* ---------------------------------------------------------------- Button */

interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  size?: 'md' | 'sm';
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  style,
  size = 'md',
}: ButtonProps) {
  const isDisabled = disabled || loading;

  const bg = {
    primary: colors.primary,
    secondary: colors.primaryLight,
    danger: colors.danger,
    ghost: 'transparent',
  }[variant];

  const fg = {
    primary: colors.white,
    secondary: colors.primary,
    danger: colors.white,
    ghost: colors.primary,
  }[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.btn,
        size === 'sm' && styles.btnSm,
        { backgroundColor: bg },
        variant === 'ghost' && styles.btnGhost,
        (pressed || isDisabled) && { opacity: isDisabled ? 0.5 : 0.85 },
        style,
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.btnText, size === 'sm' && styles.btnTextSm, { color: fg }]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

/* ----------------------------------------------------------------- Input */

interface FieldProps extends TextInputProps {
  label?: string;
  hint?: string;
}

export function Field({ label, hint, style, ...rest }: FieldProps) {
  return (
    <View style={styles.fieldWrap}>
      {!!label && <Text style={styles.label}>{label}</Text>}
      <TextInput
        placeholderTextColor={colors.textLight}
        style={[styles.input, style]}
        {...rest}
      />
      {!!hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

/* ------------------------------------------------------------------ Card */

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/* ----------------------------------------------------------------- Badge */

export function Badge({
  text,
  color = colors.primary,
  bg = colors.primaryLight,
}: {
  text: string;
  color?: string;
  bg?: string;
}) {
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color }]}>{text}</Text>
    </View>
  );
}

/* ------------------------------------------------------------ Empty/Load */

export function Loading({ text = 'Loading…' }: { text?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.centerText}>{text}</Text>
    </View>
  );
}

export function EmptyState({
  icon = '📭',
  title,
  subtitle,
  action,
}: {
  icon?: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={styles.center}>
      <Text style={styles.emptyIcon}>{icon}</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      {!!subtitle && <Text style={styles.centerText}>{subtitle}</Text>}
      {!!action && <View style={{ marginTop: spacing.lg }}>{action}</View>}
    </View>
  );
}

export function ErrorNote({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

/* ------------------------------------------------------------- StatTile */

export function StatTile({
  label,
  value,
  tint = colors.primary,
}: {
  label: string;
  value: string | number;
  tint?: string;
}) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: tint }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    height: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  btnSm: { height: 38, borderRadius: radius.sm, paddingHorizontal: spacing.md },
  btnGhost: { borderWidth: 1, borderColor: colors.border },
  btnText: { fontSize: 16, fontWeight: '700' },
  btnTextSm: { fontSize: 14 },

  fieldWrap: { marginBottom: spacing.lg },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: spacing.xs + 2,
  },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 13,
    fontSize: 16,
    color: colors.text,
  },
  hint: { fontSize: 12, color: colors.textLight, marginTop: spacing.xs },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },

  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 12, fontWeight: '700' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  centerText: {
    marginTop: spacing.md,
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
  },
  emptyIcon: { fontSize: 48, marginBottom: spacing.sm },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.text, textAlign: 'center' },

  errorBox: {
    backgroundColor: colors.dangerLight,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  errorText: { color: colors.danger, fontSize: 14, fontWeight: '500' },

  stat: {
    flex: 1,
    minWidth: 140,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  statValue: { fontSize: 26, fontWeight: '800' },
  statLabel: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
});
