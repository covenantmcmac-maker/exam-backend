import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildColors, DEFAULT_THEME, isThemeName, THEMES } from '../theme';
import type { Colors, ThemeName, ThemePalette } from '../theme';

const STORAGE_KEY = '@exam_theme';
/**
 * Key the old web app persisted the chosen theme under. We still honor it on
 * first load so returning users keep their theme after the upgrade.
 */
const LEGACY_STORAGE_KEY = 'examTheme';

function matchThemeName(raw: string | null | undefined): ThemeName | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (isThemeName(trimmed)) return trimmed;
  const byCaseInsensitive = THEMES.find(
    (t) => t.name.toLowerCase() === trimmed.toLowerCase()
  );
  return byCaseInsensitive?.name ?? null;
}

function readLegacyThemeName(): ThemeName | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    return matchThemeName(window.localStorage.getItem(LEGACY_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * Synchronous best-effort initial theme. On web localStorage is available
 * immediately, which avoids a flash of the default theme before the async
 * AsyncStorage read resolves. Native falls back to the default and is
 * reconciled after mount.
 */
function initialThemeName(): ThemeName {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try {
      const direct = matchThemeName(window.localStorage.getItem(STORAGE_KEY));
      if (direct) return direct;
      const legacy = readLegacyThemeName();
      if (legacy) return legacy;
    } catch {
      /* private browsing / storage disabled — use default */
    }
  }
  return DEFAULT_THEME;
}

interface ThemeContextValue {
  themeName: ThemeName;
  themes: ThemePalette[];
  palette: ThemePalette;
  colors: Colors;
  setTheme: (name: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeName, setThemeName] = useState<ThemeName>(initialThemeName);

  // On native (and as a web double-check) the persisted choice lives in
  // AsyncStorage — reconcile once it has loaded.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (cancelled) return;
        const matched = matchThemeName(stored);
        if (matched) setThemeName(matched);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const setTheme = useCallback((name: ThemeName) => {
    setThemeName(name);
    AsyncStorage.setItem(STORAGE_KEY, name).catch(() => {});
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const palette = THEMES.find((t) => t.name === themeName) ?? THEMES[0];
    return {
      themeName: palette.name,
      themes: THEMES,
      palette,
      colors: buildColors(palette),
      setTheme,
    };
  }, [themeName, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

/** Colors for the active theme — use this instead of the static `colors` export. */
export function useColors(): Colors {
  return useTheme().colors;
}

/**
 * Per-palette StyleSheet cache.
 *
 * `useMemo(() => makeStyles(colors), [colors])` is memoised per COMPONENT
 * INSTANCE, so a list that renders N rows builds N identical StyleSheets. On
 * the exam builder (one row per question in the bank) that was a real cost on
 * every render.
 *
 * Keying on the makeStyles function and then on the colors object means every
 * instance of a component shares one StyleSheet per theme, built once. The
 * outer map is weak so unmounted screens' styles can be collected; the inner
 * one is weak on the colors object, which is itself memoised per theme.
 */
const styleCache = new WeakMap<object, WeakMap<Colors, unknown>>();

export function useThemedStyles<T>(makeStyles: (colors: Colors) => T): T {
  const colors = useColors();

  let perPalette = styleCache.get(makeStyles);
  if (!perPalette) {
    perPalette = new WeakMap();
    styleCache.set(makeStyles, perPalette);
  }

  let styles = perPalette.get(colors) as T | undefined;
  if (!styles) {
    styles = makeStyles(colors);
    perPalette.set(colors, styles as object);
  }
  return styles;
}
