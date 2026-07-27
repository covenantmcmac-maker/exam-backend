import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

/**
 * Web-only PWA helpers: install prompt, update detection, and offline state.
 *
 * All of this is inert on native builds — the hooks return safe defaults so
 * screens can call them unconditionally.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const isWeb = Platform.OS === 'web';

function getWindow(): (Window & typeof globalThis) | null {
  if (!isWeb || typeof window === 'undefined') return null;
  return window;
}

/** True when the app is running as an installed PWA rather than a browser tab. */
export function isStandalone(): boolean {
  const w = getWindow();
  if (!w) return false;
  const displayMode = w.matchMedia?.('(display-mode: standalone)')?.matches;
  // iOS Safari exposes a non-standard flag instead of matching display-mode.
  const iosStandalone = (w.navigator as unknown as { standalone?: boolean })?.standalone;
  return !!displayMode || !!iosStandalone;
}

/** True on iOS Safari, where install must be done manually via the Share menu. */
export function isIosSafari(): boolean {
  const w = getWindow();
  if (!w) return false;
  const ua = w.navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports as a Mac but has touch points.
    (/Macintosh/.test(ua) && (w.navigator as Navigator).maxTouchPoints > 1);
  const webkit = /WebKit/.test(ua);
  const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return iOS && webkit && !otherBrowser;
}

/**
 * Captures the browser's install prompt so it can be triggered from a button
 * at a moment that makes sense, rather than whenever the browser decides.
 */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => isStandalone());

  useEffect(() => {
    const w = getWindow();
    if (!w) return;

    const onBeforeInstall = (e: Event) => {
      // Stop Chrome's default mini-infobar so the in-app banner is the only prompt.
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };

    w.addEventListener('beforeinstallprompt', onBeforeInstall);
    w.addEventListener('appinstalled', onInstalled);
    return () => {
      w.removeEventListener('beforeinstallprompt', onBeforeInstall);
      w.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!deferred) return 'unavailable';
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    // The event can only be used once.
    setDeferred(null);
    return outcome;
  }, [deferred]);

  return {
    /** Chrome/Edge/Android: a one-tap install is available. */
    canInstall: !!deferred && !installed,
    /** iOS Safari: show manual Add-to-Home-Screen instructions instead. */
    needsManualInstall: isIosSafari() && !installed,
    installed,
    promptInstall,
  };
}

/** Detects a newer service worker waiting to take over. */
export function useServiceWorkerUpdate() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    const w = getWindow();
    if (!w || !('serviceWorker' in w.navigator)) return;

    let cancelled = false;

    w.navigator.serviceWorker.ready
      .then((reg) => {
        if (cancelled) return;
        if (reg.waiting) setWaiting(reg.waiting);

        reg.addEventListener('updatefound', () => {
          const next = reg.installing;
          if (!next) return;
          next.addEventListener('statechange', () => {
            // An update is only meaningful if a worker is already controlling
            // the page; otherwise this is the very first install.
            if (next.state === 'installed' && w.navigator.serviceWorker.controller) {
              setWaiting(next);
            }
          });
        });
      })
      .catch(() => {
        /* service workers unavailable (e.g. private mode) */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const applyUpdate = useCallback(() => {
    const w = getWindow();
    if (!w || !waiting) return;
    waiting.postMessage('SKIP_WAITING');
    // Reload once the new worker takes control.
    w.navigator.serviceWorker.addEventListener('controllerchange', () => w.location.reload(), {
      once: true,
    });
  }, [waiting]);

  return { updateReady: !!waiting, applyUpdate };
}

/** Tracks connectivity so the UI can warn before someone starts an exam. */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => {
    const w = getWindow();
    return w ? w.navigator.onLine !== false : true;
  });

  useEffect(() => {
    const w = getWindow();
    if (!w) return;
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    w.addEventListener('online', up);
    w.addEventListener('offline', down);
    return () => {
      w.removeEventListener('online', up);
      w.removeEventListener('offline', down);
    };
  }, []);

  return online;
}
