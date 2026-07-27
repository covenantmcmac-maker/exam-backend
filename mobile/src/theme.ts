export const colors = {
  primary: '#4f46e5',
  primaryDark: '#4338ca',
  primaryLight: '#eef2ff',
  accent: '#0ea5e9',

  success: '#16a34a',
  successLight: '#dcfce7',
  danger: '#dc2626',
  dangerLight: '#fee2e2',
  warning: '#d97706',
  warningLight: '#fef3c7',

  bg: '#f6f7fb',
  card: '#ffffff',
  border: '#e5e7eb',

  text: '#111827',
  textMuted: '#6b7280',
  textLight: '#9ca3af',
  white: '#ffffff',
};

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
  easy: colors.success,
  medium: colors.warning,
  hard: colors.danger,
};
