import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, radius, shadow, spacing } from '../theme';
import { useInstallPrompt, useOnlineStatus, useServiceWorkerUpdate } from './usePwa';

const DISMISS_KEY = '@pwa_install_dismissed';

/**
 * Web-only banners: offline warning, update-available, and install prompt.
 * Renders nothing on native.
 */
export default function PwaBanners() {
  if (Platform.OS !== 'web') return null;
  return <Banners />;
}

function Banners() {
  const online = useOnlineStatus();
  const { updateReady, applyUpdate } = useServiceWorkerUpdate();
  const { canInstall, needsManualInstall, promptInstall } = useInstallPrompt();

  const [dismissed, setDismissed] = useState(true);
  const [showIosHelp, setShowIosHelp] = useState(false);

  // Respect a previous dismissal so the prompt isn't nagging.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(DISMISS_KEY)
      .then((v) => {
        if (!cancelled) setDismissed(v === '1');
      })
      .catch(() => {
        if (!cancelled) setDismissed(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = () => {
    setDismissed(true);
    setShowIosHelp(false);
    void AsyncStorage.setItem(DISMISS_KEY, '1');
  };

  const onInstall = async () => {
    if (canInstall) {
      const outcome = await promptInstall();
      if (outcome === 'accepted') dismiss();
      return;
    }
    setShowIosHelp((v) => !v);
  };

  // Offline is the most urgent message — an exam needs the network.
  if (!online) {
    return (
      <View style={[styles.bar, styles.offline]}>
        <Text style={styles.offlineText}>
          ⚠︎ You&apos;re offline. Answers can&apos;t be saved until the connection returns.
        </Text>
      </View>
    );
  }

  if (updateReady) {
    return (
      <View style={[styles.bar, styles.update]}>
        <Text style={styles.updateText}>A new version is available.</Text>
        <Pressable onPress={applyUpdate} style={styles.action}>
          <Text style={styles.actionText}>Refresh</Text>
        </Pressable>
      </View>
    );
  }

  const showInstall = (canInstall || needsManualInstall) && !dismissed;
  if (!showInstall) return null;

  return (
    <View style={styles.installWrap}>
      <View style={styles.install}>
        <Text style={styles.installIcon}>📲</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.installTitle}>Install this app</Text>
          <Text style={styles.installBody}>
            Add it to your home screen for faster access and a full-screen view.
          </Text>

          {showIosHelp && (
            <Text style={styles.iosHelp}>
              In Safari, tap the Share button, then choose “Add to Home Screen”.
            </Text>
          )}
        </View>

        <View style={styles.installActions}>
          <Pressable onPress={onInstall} style={styles.action}>
            <Text style={styles.actionText}>{canInstall ? 'Install' : 'How?'}</Text>
          </Pressable>
          <Pressable onPress={dismiss} style={styles.dismiss} accessibilityLabel="Dismiss">
            <Text style={styles.dismissText}>✕</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  offline: { backgroundColor: colors.warningLight },
  offlineText: { color: '#92400e', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  update: { backgroundColor: colors.primaryLight },
  updateText: { color: colors.primaryDark, fontSize: 13, fontWeight: '600' },

  installWrap: { padding: spacing.md, paddingBottom: 0 },
  install: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadow.card,
  },
  installIcon: { fontSize: 22 },
  installTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  installBody: { fontSize: 13, color: colors.textMuted, marginTop: 2, lineHeight: 18 },
  iosHelp: {
    fontSize: 13,
    color: colors.primaryDark,
    marginTop: spacing.sm,
    lineHeight: 18,
  },
  installActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  action: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.sm,
  },
  actionText: { color: colors.white, fontSize: 13, fontWeight: '700' },
  dismiss: { padding: spacing.sm },
  dismissText: { color: colors.textLight, fontSize: 15, fontWeight: '700' },
});
