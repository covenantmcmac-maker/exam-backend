import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { radius, shadow, spacing } from '../theme';
import type { Colors } from '../theme';

/**
 * Floating theme switcher rendered once at the app root so it shows on
 * every screen.
 *
 * Two traps this deliberately avoids:
 *
 * 1. The picker is a plain absolutely-positioned overlay, NOT React Native
 *    Web's <Modal>. The web Modal renders through a portal that gets
 *    orphaned when the theme swap re-renders the app — the sheet would
 *    apply the theme but never close. An in-tree overlay re-renders
 *    normally and dismisses correctly.
 *
 * 2. The swatch contents have NO `pointerEvents="none"`. That flag would
 *    swallow the tap on the inner dots/labels and nothing would happen
 *    when the user presses most of the row.
 */
export default function ThemePicker() {
  const { themes, themeName, setTheme, colors } = useTheme();
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors, insets.bottom), [colors, insets.bottom]);

  const choose = (name: (typeof themes)[number]['name']) => {
    setTheme(name);
    setOpen(false);
  };

  return (
    // `box-none`: the wrapper never intercepts touches, but its children
    // (the floating button and the sheet) do.
    <View pointerEvents="box-none" style={styles.root}>
      {open && (
        <View style={styles.overlay}>
          <Pressable
            style={styles.backdrop}
            onPress={() => setOpen(false)}
            accessibilityLabel="Close theme picker"
          />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Choose theme</Text>
            <ScrollView contentContainerStyle={styles.swatchList}>
              {themes.map((t) => {
                const active = t.name === themeName;
                return (
                  <Pressable
                    key={t.name}
                    onPress={() => choose(t.name)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={({ pressed }) => [
                      styles.swatch,
                      active && styles.swatchActive,
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <View style={styles.dots}>
                      {[t.primary, t.bg, t.card, t.text].map((c, i) => (
                        <View key={i} style={[styles.dot, { backgroundColor: c }]} />
                      ))}
                    </View>
                    <Text style={styles.swatchName}>{t.name}</Text>
                    {active && <Text style={styles.check}>✓</Text>}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      )}

      <Pressable
        style={({ pressed }) => [styles.fab, pressed && { opacity: 0.85 }]}
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel="Change theme"
      >
        <Text style={styles.fabGlyph}>🎨</Text>
      </Pressable>
    </View>
  );
}

const ABSOLUTE_FILL = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
} as const;

const makeStyles = (colors: Colors, bottomInset: number) =>
  StyleSheet.create({
    root: {
      ...ABSOLUTE_FILL,
      zIndex: 1000,
      elevation: 10,
    },
    overlay: {
      ...ABSOLUTE_FILL,
    },
    backdrop: {
      ...ABSOLUTE_FILL,
      backgroundColor: 'rgba(0,0,0,0.45)',
    },
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.card,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: bottomInset + spacing.lg,
      ...shadow.card,
    },
    sheetTitle: {
      fontSize: 17,
      fontWeight: '800',
      color: colors.text,
      marginBottom: spacing.md,
    },
    swatchList: { gap: spacing.sm, paddingBottom: spacing.xs },
    swatch: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bg,
    },
    swatchActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primaryLight,
    },
    dots: { flexDirection: 'row', gap: 6 },
    dot: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: 'rgba(0,0,0,0.15)',
    },
    swatchName: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text },
    check: { fontSize: 16, fontWeight: '900', color: colors.primary },
    fab: {
      position: 'absolute',
      // Sit above bottom tab bars (≈64pt) plus the safe-area inset.
      bottom: bottomInset + 84,
      right: spacing.lg,
      width: 54,
      height: 54,
      borderRadius: 27,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      ...shadow.card,
      elevation: 6,
    },
    fabGlyph: { fontSize: 24 },
  });
