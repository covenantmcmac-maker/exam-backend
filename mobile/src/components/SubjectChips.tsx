/**
 * Horizontal row of course/subject chips.
 *
 * The subject list itself is derived by `summarizeSubjects()` in
 * screens/teacher/questionSort.ts — this component only renders it, so the
 * exam builder and the question bank show the same courses in the same order.
 *
 * Renders nothing when there are no subjects: a lone "all courses (0)" chip is
 * noise, and a bank whose questions all have a blank subject has no courses to
 * offer.
 */
import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useColors } from '../context/ThemeContext';
import { radius, spacing } from '../theme';
import type { Colors } from '../theme';
import type { SubjectSummary } from '../screens/teacher/questionSort';

export default function SubjectChips({
  subjects,
  selected,
  onSelect,
  allLabel = 'all courses',
  total,
  showAll = true,
  showCounts = true,
}: {
  subjects: SubjectSummary[];
  /** Active subject name, or 'all'. */
  selected: string;
  onSelect: (subject: string) => void;
  /** Label for the leading reset chip. */
  allLabel?: string;
  /** Count for the reset chip — the whole bank, not the filtered view. */
  total?: number;
  /**
   * Whether to render the leading "all" chip. Off for the quick-select row on
   * the exam builder, where a tap writes into a text field: "all courses" is
   * not a subject anyone would want written there.
   */
  showAll?: boolean;
  /** Counts help when choosing questions, but are noise when naming an exam. */
  showCounts?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (subjects.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {showAll && (
        <Pressable
          onPress={() => onSelect('all')}
          style={[styles.chip, selected === 'all' && styles.chipActive]}
          accessibilityRole="button"
        >
          <Text style={[styles.chipText, selected === 'all' && styles.chipTextActive]}>
            {allLabel}
            {showCounts && total !== undefined ? ` (${total})` : ''}
          </Text>
        </Pressable>
      )}

      {subjects.map((s) => {
        const active = selected.trim().toLowerCase() === s.name.toLowerCase();
        return (
          <Pressable
            key={s.name}
            onPress={() => onSelect(s.name)}
            style={[styles.chip, active && styles.chipActive]}
            accessibilityRole="button"
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>
              {s.name}
              {showCounts ? ` (${s.count})` : ''}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    row: { gap: spacing.sm, paddingRight: spacing.lg, paddingBottom: spacing.sm },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
    chipTextActive: { color: colors.white },
  });
