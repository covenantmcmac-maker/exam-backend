import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '../context/ThemeContext';
import { radius, spacing } from '../theme';
import type { Colors } from '../theme';

/**
 * Cross-platform dialogs.
 *
 * React Native Web ships `Alert.alert` as a no-op, so every confirmation
 * built on it silently does nothing in the browser. This provider renders a
 * real in-app modal instead, which behaves identically on Android, iOS and
 * web, and exposes an imperative promise-based API.
 */

type ActionStyle = 'default' | 'cancel' | 'destructive';

interface Action {
  label: string;
  style?: ActionStyle;
  value: unknown;
}

interface DialogState {
  title: string;
  message?: string;
  actions: Action[];
}

export interface DialogApi {
  /** Informational message with a single dismiss button. */
  notify(title: string, message?: string): Promise<void>;
  /** Yes/no prompt. Resolves true when confirmed. */
  confirm(
    title: string,
    message?: string,
    opts?: { confirmLabel?: string; cancelLabel?: string; destructive?: boolean }
  ): Promise<boolean>;
  /** Pick one of several options. Resolves null when dismissed. */
  choose<T>(
    title: string,
    message: string | undefined,
    options: { label: string; value: T; destructive?: boolean }[]
  ): Promise<T | null>;
}

const DialogContext = createContext<DialogApi | undefined>(undefined);

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DialogState | null>(null);
  const resolver = useRef<((value: unknown) => void) | null>(null);

  const open = useCallback((next: DialogState) => {
    return new Promise<unknown>((resolve) => {
      resolver.current = resolve;
      setState(next);
    });
  }, []);

  const close = useCallback((value: unknown) => {
    setState(null);
    const resolve = resolver.current;
    resolver.current = null;
    resolve?.(value);
  }, []);

  const api = useMemo<DialogApi>(
    () => ({
      notify: async (title, message) => {
        await open({ title, message, actions: [{ label: 'OK', value: undefined }] });
      },

      confirm: async (title, message, opts) =>
        (await open({
          title,
          message,
          actions: [
            { label: opts?.cancelLabel ?? 'Cancel', style: 'cancel', value: false },
            {
              label: opts?.confirmLabel ?? 'OK',
              style: opts?.destructive ? 'destructive' : 'default',
              value: true,
            },
          ],
        })) === true,

      choose: async (title, message, options) => {
        const value = await open({
          title,
          message,
          actions: [
            ...options.map((o) => ({
              label: o.label,
              style: (o.destructive ? 'destructive' : 'default') as ActionStyle,
              value: o.value,
            })),
            { label: 'Cancel', style: 'cancel' as ActionStyle, value: null },
          ],
        });
        return (value ?? null) as never;
      },
    }),
    [open]
  );

  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const stacked = (state?.actions.length ?? 0) > 2;

  return (
    <DialogContext.Provider value={api}>
      {children}
      <Modal
        visible={!!state}
        transparent
        animationType="fade"
        onRequestClose={() => close(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => close(false)}>
          <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.title}>{state?.title}</Text>
            {!!state?.message && <Text style={styles.message}>{state.message}</Text>}

            <View style={[styles.actions, stacked && styles.actionsStacked]}>
              {state?.actions.map((a, i) => (
                <Pressable
                  key={`${a.label}-${i}`}
                  onPress={() => close(a.value)}
                  style={({ pressed }) => [
                    styles.action,
                    stacked && styles.actionStacked,
                    a.style === 'cancel' && styles.actionCancel,
                    a.style === 'destructive' && styles.actionDestructive,
                    pressed && { opacity: 0.75 },
                  ]}
                  accessibilityRole="button"
                >
                  <Text
                    style={[
                      styles.actionText,
                      a.style === 'cancel' && styles.actionTextCancel,
                      a.style === 'destructive' && styles.actionTextDestructive,
                    ]}
                  >
                    {a.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </DialogContext.Provider>
  );
}

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used inside <DialogProvider>');
  return ctx;
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(17,24,39,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xl,
    },
    card: {
      width: '100%',
      maxWidth: 420,
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      padding: spacing.xl,
    },
    title: { fontSize: 18, fontWeight: '800', color: colors.text },
    message: { fontSize: 15, color: colors.textMuted, lineHeight: 21, marginTop: spacing.sm },
    actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
    actionsStacked: { flexDirection: 'column-reverse' },
    action: {
      flex: 1,
      height: 46,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
      paddingHorizontal: spacing.lg,
    },
    actionStacked: { flex: 0, width: '100%' },
    actionCancel: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
    actionDestructive: { backgroundColor: colors.danger },
    actionText: { fontSize: 15, fontWeight: '700', color: colors.white },
    actionTextCancel: { color: colors.textMuted },
    actionTextDestructive: { color: colors.white },
  });
