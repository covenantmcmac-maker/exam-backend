/**
 * Theming.
 *
 * Six selectable themes. Each theme defines four anchor colors — primary,
 * background, card and text — and `buildColors()` derives the rest of the
 * app palette (borders, muted text, tinted lights…) from those anchors so a
 * theme stays consistent everywhere.
 *
 * Live components must read colors through `useColors()` from
 * `context/ThemeContext` rather than the static `colors` export below, so
 * the whole UI updates when the user switches theme.
 */

export interface Colors {
  primary: string;
  primaryDark: string;
  primaryLight: string;
  accent: string;

  success: string;
  successLight: string;
  danger: string;
  dangerLight: string;
  warning: string;
  warningLight: string;

  bg: string;
  card: string;
  border: string;

  text: string;
  textMuted: string;
  textLight: string;
  white: string;
}

export type ThemeName =
  | 'Royal Purple'
  | 'Ocean Blue'
  | 'Forest Green'
  | 'Dark Mode'
  | 'Ruby Red'
  | 'Sunset Orange';

export interface ThemePalette {
  name: ThemeName;
  primary: string;
  bg: string;
  card: string;
  text: string;
}

export const THEMES: ThemePalette[] = [
  { name: 'Royal Purple', primary: '#667eea', bg: '#f5f6fa', card: '#ffffff', text: '#333333' },
  { name: 'Ocean Blue', primary: '#2196f3', bg: '#e3f2fd', card: '#ffffff', text: '#1a237e' },
  { name: 'Forest Green', primary: '#4caf50', bg: '#e8f5e9', card: '#ffffff', text: '#1b5e20' },
  { name: 'Dark Mode', primary: '#ff9800', bg: '#1a1a1a', card: '#2c2c2c', text: '#ffffff' },
  { name: 'Ruby Red', primary: '#e53935', bg: '#ffebee', card: '#ffffff', text: '#b71c1c' },
  { name: 'Sunset Orange', primary: '#ff6f00', bg: '#fff3e0', card: '#ffffff', text: '#e65100' },
];

export const DEFAULT_THEME: ThemeName = 'Royal Purple';

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && THEMES.some((t) => t.name === value);
}

/* ------------------------------------------------------- color utilities */

function clamp(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function parseHex(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const int = parseInt(h, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((n) => clamp(n).toString(16).padStart(2, '0')).join('');
}

/** Blend two hex colors. t = 0 → all `a`, t = 1 → all `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

/** Relative luminance (0 = black, 1 = white). */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function isDarkPalette(p: { bg: string }): boolean {
  return luminance(p.bg) < 0.4;
}

/* ------------------------------------------------------- palette builder */

export function buildColors(p: Omit<ThemePalette, 'name'>): Colors {
  const dark = isDarkPalette(p);
  return {
    primary: p.primary,
    primaryDark: mixHex(p.primary, '#000000', 0.18),
    primaryLight: mixHex(p.primary, p.card, 0.88),
    accent: mixHex(p.primary, '#0ea5e9', 0.45),

    success: '#16a34a',
    successLight: mixHex('#16a34a', p.card, dark ? 0.78 : 0.88),
    danger: '#dc2626',
    dangerLight: mixHex('#dc2626', p.card, dark ? 0.78 : 0.88),
    warning: '#d97706',
    warningLight: mixHex('#d97706', p.card, dark ? 0.78 : 0.88),

    bg: p.bg,
    card: p.card,
    border: dark ? mixHex(p.bg, '#ffffff', 0.14) : mixHex(p.bg, '#000000', 0.1),

    text: p.text,
    textMuted: mixHex(p.text, p.bg, 0.38),
    textLight: mixHex(p.text, p.bg, 0.58),
    white: '#ffffff',
  };
}

/**
 * Static fallback palette (the default theme). Anything rendered live should
 * use `useColors()` instead so it follows the user's chosen theme.
 */
export const colors: Colors = buildColors(THEMES[0]);

/* ------------------------------------------------------------ constants */

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
};

export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
};

export const difficultyColor: Record<string, string> = {
  easy: '#16a34a',
  medium: '#d97706',
  hard: '#dc2626',
};
