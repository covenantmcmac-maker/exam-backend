import { Platform } from 'react-native';

export type CsvCell = string | number | boolean | null | undefined;

export function csvEscape(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsv(headers: string[], rows: CsvCell[][]): string {
  return [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');
}

export function safeFilename(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'results';
}

/**
 * Browser/PWA download helper. Native builds need a sharing/filesystem module,
 * so this returns false there and the caller can show a clear message.
 */
export function downloadCsv(filename: string, csv: string): boolean {
  if (Platform.OS !== 'web' || typeof document === 'undefined' || typeof URL === 'undefined') {
    return false;
  }

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  return true;
}
