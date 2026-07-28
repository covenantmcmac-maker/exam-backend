/**
 * Sorting helpers for the teacher question bank.
 *
 * Kept out of the screen component so the ordering rules stay unit-testable
 * and free of React/AsyncStorage imports.
 */
import type { Question } from '../../api/types';

export const SORT_STORAGE_KEY = '@exam_qbank_sort';
export const SUBJECT_ORDER_STORAGE_KEY = '@exam_qbank_subject_order';

export type SortKey =
  | 'newest'
  | 'oldest'
  | 'alpha'
  | 'alphaDesc'
  | 'difficultyAsc'
  | 'difficultyDesc'
  | 'pointsDesc'
  | 'pointsAsc'
  | 'subject';

export type SubjectOrderKey = 'alpha' | 'count' | 'recent';

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'alpha', label: 'Alphabetical A→Z' },
  { key: 'alphaDesc', label: 'Alphabetical Z→A' },
  { key: 'difficultyAsc', label: 'Difficulty easy→hard' },
  { key: 'difficultyDesc', label: 'Difficulty hard→easy' },
  { key: 'pointsDesc', label: 'Points high→low' },
  { key: 'pointsAsc', label: 'Points low→high' },
  { key: 'subject', label: 'Subject A→Z' },
];

/** Short label shown on the sort pill itself. */
export const SORT_SHORT_LABELS: Record<SortKey, string> = {
  newest: 'Newest',
  oldest: 'Oldest',
  alpha: 'A→Z',
  alphaDesc: 'Z→A',
  difficultyAsc: 'Easy→Hard',
  difficultyDesc: 'Hard→Easy',
  pointsDesc: 'Points ↓',
  pointsAsc: 'Points ↑',
  subject: 'Subject',
};

export const SUBJECT_ORDER_OPTIONS: { key: SubjectOrderKey; label: string }[] = [
  { key: 'alpha', label: 'A–Z' },
  { key: 'count', label: 'By count (most questions first)' },
  { key: 'recent', label: 'Most recent upload first' },
];

export const SUBJECT_ORDER_SHORT_LABELS: Record<SubjectOrderKey, string> = {
  alpha: 'A–Z',
  count: 'By count',
  recent: 'Recent',
};

export function isSortKey(v: unknown): v is SortKey {
  return typeof v === 'string' && SORT_OPTIONS.some((o) => o.key === v);
}

export function isSubjectOrderKey(v: unknown): v is SubjectOrderKey {
  return typeof v === 'string' && SUBJECT_ORDER_OPTIONS.some((o) => o.key === v);
}

const DIFFICULTY_RANK: Record<string, number> = { easy: 0, medium: 1, hard: 2 };

/** Upload time as a comparable number; missing dates sort oldest. */
export function uploadedAt(q: Question): number {
  const t = q.createdAt ? Date.parse(q.createdAt) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/** Newest upload first — the universal tie-breaker for every sort mode. */
function byNewest(a: Question, b: Question): number {
  return uploadedAt(b) - uploadedAt(a);
}

const text = (q: Question) => (q.questionText || '').trim();
const subjectOf = (q: Question) => (q.subject || '').trim();

const COMPARATORS: Record<SortKey, (a: Question, b: Question) => number> = {
  newest: byNewest,
  oldest: (a, b) => uploadedAt(a) - uploadedAt(b),
  alpha: (a, b) => text(a).localeCompare(text(b)),
  alphaDesc: (a, b) => text(b).localeCompare(text(a)),
  difficultyAsc: (a, b) =>
    (DIFFICULTY_RANK[a.difficulty] ?? 99) - (DIFFICULTY_RANK[b.difficulty] ?? 99),
  difficultyDesc: (a, b) =>
    (DIFFICULTY_RANK[b.difficulty] ?? -1) - (DIFFICULTY_RANK[a.difficulty] ?? -1),
  pointsDesc: (a, b) => (b.points ?? 0) - (a.points ?? 0),
  pointsAsc: (a, b) => (a.points ?? 0) - (b.points ?? 0),
  subject: (a, b) => subjectOf(a).localeCompare(subjectOf(b)),
};

/**
 * Return a new array ordered by `key`. Every mode falls back to newest-first
 * so equal-ranking questions keep a stable, predictable order.
 */
export function sortQuestions(questions: Question[], key: SortKey): Question[] {
  const cmp = COMPARATORS[key] ?? COMPARATORS.newest;
  return [...questions].sort((a, b) => cmp(a, b) || byNewest(a, b));
}

export interface SubjectSummary {
  name: string;
  count: number;
  /** Newest upload time among that subject's questions. */
  latest: number;
}

/** Distinct subjects with counts, ordered per `order`. */
export function summarizeSubjects(
  questions: Question[],
  order: SubjectOrderKey
): SubjectSummary[] {
  const map = new Map<string, SubjectSummary>();
  for (const q of questions) {
    const name = subjectOf(q);
    if (!name) continue;
    const entry = map.get(name);
    if (entry) {
      entry.count += 1;
      entry.latest = Math.max(entry.latest, uploadedAt(q));
    } else {
      map.set(name, { name, count: 1, latest: uploadedAt(q) });
    }
  }

  const list = [...map.values()];
  switch (order) {
    case 'count':
      // Most questions first, alphabetical within a tie.
      return list.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    case 'recent':
      return list.sort((a, b) => b.latest - a.latest || a.name.localeCompare(b.name));
    case 'alpha':
    default:
      return list.sort((a, b) => a.name.localeCompare(b.name));
  }
}

/** Compact relative upload time, e.g. "3h ago", "2d ago", "1w ago". */
export function relativeTime(iso?: string, nowMs: number = Date.now()): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';

  const diff = nowMs - then;
  if (diff < 0) return 'just now';

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const year = 365 * day;

  if (diff < minute) return 'just now';
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < week) return `${Math.floor(diff / day)}d ago`;
  if (diff < year) return `${Math.floor(diff / week)}w ago`;
  return `${Math.floor(diff / year)}y ago`;
}
