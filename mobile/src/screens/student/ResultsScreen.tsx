import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { Button, Card, EmptyState, Loading } from '../../components/ui';
import { useDialog } from '../../components/Dialog';
import { attemptsApi } from '../../api/endpoints';
import { buildCsv, downloadCsv } from '../../utils/csv';
import { radius, spacing } from '../../theme';
import { useColors } from '../../context/ThemeContext';
import type { Colors } from '../../theme';
import type { ExamAttempt } from '../../api/types';
import type { RootStackParamList } from '../../navigation/types';

function formatDuration(seconds?: number) {
  if (!seconds && seconds !== 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatDate(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function canSeeScore(item: ExamAttempt) {
  const exam = typeof item.exam === 'object' ? item.exam : null;
  return exam?.settings?.showResults !== false && item.percentage !== undefined && item.score !== undefined;
}

export default function ResultsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const dialog = useDialog();
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await attemptsApi.myAttempts();
      setAttempts(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load results.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  /**
   * Export the student's own exam history as CSV.
   *
   * Scores the teacher has chosen to hide are exported as "Hidden" rather
   * than as a number, so the download can never leak a result the app itself
   * refuses to show on screen.
   */
  const downloadResults = () => {
    const csv = buildCsv(
      ['Exam', 'Subject', 'Score', 'Total points', 'Percentage', 'Status', 'Completed', 'Time spent'],
      attempts.map((item) => {
        const exam = typeof item.exam === 'object' ? item.exam : null;
        const visible = canSeeScore(item);
        return [
          exam?.title || 'Exam',
          exam?.subject || '',
          visible ? item.score ?? 0 : 'Hidden',
          visible ? item.totalPoints ?? 0 : 'Hidden',
          visible ? `${Math.round(item.percentage || 0)}%` : 'Hidden',
          item.status,
          item.completedAt ? new Date(item.completedAt).toLocaleString() : '',
          formatDuration(item.timeSpent),
        ];
      })
    );

    const ok = downloadCsv('my-exam-results.csv', csv);
    if (!ok) {
      void dialog.notify(
        'Download unavailable',
        'CSV downloads are available in the web/PWA version. Open the app in a browser to download your results.'
      );
    }
  };

  if (loading) return <Loading text="Loading your results…" />;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>My results</Text>
        <Button
          title="Download CSV"
          variant="ghost"
          size="sm"
          disabled={attempts.length === 0}
          onPress={downloadResults}
        />
      </View>

      <FlatList
        data={attempts}
        keyExtractor={(item) => item._id}
        contentContainerStyle={
          attempts.length === 0 ? styles.emptyWrap : styles.list
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <EmptyState
            icon="📊"
            title={error ? 'Something went wrong' : 'No results yet'}
            subtitle={error || 'Once you complete an exam, your history appears here.'}
          />
        }
        renderItem={({ item }) => {
          const exam = typeof item.exam === 'object' ? item.exam : null;
          const scoreVisible = canSeeScore(item);
          const pct = Math.round(item.percentage || 0);
          const passMark = exam?.settings?.passingMarks ?? 50;
          const passed = pct >= passMark;
          const canReview = item.canReview || exam?.settings?.allowReview;

          return (
            <Card>
              <View style={styles.headerRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.examTitle}>{exam?.title || 'Exam'}</Text>
                  {!!exam?.subject && <Text style={styles.subject}>{exam.subject}</Text>}
                </View>
                {scoreVisible ? (
                  <View
                    style={[
                      styles.pctPill,
                      { backgroundColor: passed ? colors.successLight : colors.dangerLight },
                    ]}
                  >
                    <Text
                      style={[styles.pctText, { color: passed ? colors.success : colors.danger }]}
                    >
                      {pct}%
                    </Text>
                  </View>
                ) : (
                  <View style={[styles.pctPill, { backgroundColor: colors.primaryLight }]}>
                    <Text style={[styles.pctText, { color: colors.primary }]}>Hidden</Text>
                  </View>
                )}
              </View>

              {scoreVisible ? (
                <>
                  <View style={styles.bar}>
                    <View
                      style={[
                        styles.barFill,
                        {
                          width: `${Math.min(100, Math.max(0, pct))}%`,
                          backgroundColor: passed ? colors.success : colors.danger,
                        },
                      ]}
                    />
                  </View>

                  <View style={styles.metaRow}>
                    <Text style={styles.meta}>
                      {item.score ?? 0}/{item.totalPoints ?? 0} points
                    </Text>
                    <Text style={styles.meta}>⏱ {formatDuration(item.timeSpent)}</Text>
                    <Text style={styles.meta}>{formatDate(item.completedAt)}</Text>
                  </View>

                  <Text
                    style={[
                      styles.verdict,
                      { color: passed ? colors.success : colors.danger },
                    ]}
                  >
                    {passed ? '✓ Passed' : '✗ Did not pass'}
                    {item.status === 'graded' ? ' · Graded' : ''}
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.hiddenNote}>
                    Your teacher has chosen not to show scores for this exam.
                  </Text>
                  <View style={styles.metaRow}>
                    <Text style={styles.meta}>⏱ {formatDuration(item.timeSpent)}</Text>
                    <Text style={styles.meta}>{formatDate(item.completedAt)}</Text>
                  </View>
                </>
              )}

              {canReview && (
                <Button
                  title="Review answers"
                  variant="secondary"
                  size="sm"
                  style={{ marginTop: spacing.md }}
                  onPress={() => navigation.navigate('ExamReview', { attemptId: item._id })}
                />
              )}
            </Card>
          );
        }}
      />
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  title: {
    flex: 1,
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
  },
  list: { padding: spacing.lg, paddingTop: 0, paddingBottom: spacing.xxl },
  emptyWrap: { flexGrow: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  examTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  subject: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  pctPill: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill },
  pctText: { fontSize: 16, fontWeight: '800' },
  bar: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: radius.pill,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  barFill: { height: 6, borderRadius: radius.pill },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  meta: { fontSize: 13, color: colors.textMuted },
  verdict: { fontSize: 13, fontWeight: '700', marginTop: spacing.sm },
  hiddenNote: { fontSize: 14, color: colors.textMuted, lineHeight: 21, marginTop: spacing.md },
});
