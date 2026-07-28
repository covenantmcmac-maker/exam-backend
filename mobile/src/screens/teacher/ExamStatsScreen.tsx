import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, EmptyState, Loading, StatTile } from '../../components/ui';
import { attemptsApi, examsApi } from '../../api/endpoints';
import { buildCsv, downloadCsv, safeFilename } from '../../utils/csv';
import { useDialog } from '../../components/Dialog';
import { radius, spacing } from '../../theme';
import { useColors } from '../../context/ThemeContext';
import type { Colors } from '../../theme';
import type { ExamAttempt, ExamStats } from '../../api/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'ExamStats'>;

export default function ExamStatsScreen({ route, navigation }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { examId, title } = route.params;
  const dialog = useDialog();
  const [stats, setStats] = useState<ExamStats | null>(null);
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [examTitle, setExamTitle] = useState(title || 'Exam');
  const [passMark, setPassMark] = useState(50);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    navigation.setOptions({ title: title || 'Results' });
  }, [navigation, title]);

  const load = useCallback(async () => {
    try {
      const res = await examsApi.stats(examId);
      setStats(res.stats);
      setAttempts(res.attempts);
      setExamTitle(res.exam?.title || title || 'Exam');
      setPassMark(res.exam?.settings?.passingMarks ?? 50);
    } catch (e) {
      void dialog.notify('Error', e instanceof Error ? e.message : 'Could not load statistics.');
    } finally {
      setLoading(false);
    }
  }, [dialog, examId, title]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const confirmDeleteAttempt = async (attempt: ExamAttempt) => {
    const student = typeof attempt.student === 'object' ? attempt.student : null;
    const ok = await dialog.confirm(
      'Delete attempt?',
      `${student?.name || 'This student'}'s attempt will be removed so they can retake the exam.`,
      { confirmLabel: 'Delete', destructive: true }
    );
    if (!ok) return;
    try {
      await attemptsApi.remove(attempt._id);
      setAttempts((prev) => prev.filter((a) => a._id !== attempt._id));
    } catch (e) {
      void dialog.notify('Error', e instanceof Error ? e.message : 'Delete failed.');
    }
  };

  const downloadSubmissions = () => {
    const csv = buildCsv(
      [
        'Student name',
        'Student email',
        'Exam',
        'Score',
        'Total points',
        'Percentage',
        'Passed',
        'Status',
        'Started',
        'Completed',
        'Time spent (seconds)',
      ],
      attempts.map((attempt) => {
        const student = typeof attempt.student === 'object' ? attempt.student : null;
        const pct = Math.round(attempt.percentage || 0);
        return [
          student?.name || 'Student',
          student?.email || '',
          examTitle,
          attempt.score,
          attempt.totalPoints,
          `${pct}%`,
          pct >= passMark ? 'Yes' : 'No',
          attempt.status,
          attempt.startedAt ? new Date(attempt.startedAt).toLocaleString() : '',
          attempt.completedAt ? new Date(attempt.completedAt).toLocaleString() : '',
          attempt.timeSpent ?? '',
        ];
      })
    );

    const ok = downloadCsv(`${safeFilename(examTitle)}-student-results.csv`, csv);
    if (!ok) {
      void dialog.notify(
        'Download unavailable',
        'CSV downloads are available in the web/PWA version. Open the app in a browser to download student results.'
      );
    }
  };

  if (loading) return <Loading text="Loading results…" />;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.statRow}>
          <StatTile label="Attempts" value={stats?.totalAttempts ?? 0} />
          <StatTile label="Completed" value={stats?.completed ?? 0} tint={colors.success} />
          <StatTile label="In progress" value={stats?.inProgress ?? 0} tint={colors.warning} />
        </View>
        <View style={[styles.statRow, { marginTop: spacing.md }]}>
          <StatTile
            label="Average"
            value={`${Math.round(stats?.averageScore ?? 0)}%`}
            tint={colors.accent}
          />
          <StatTile
            label="Highest"
            value={`${Math.round(stats?.highestScore ?? 0)}%`}
            tint={colors.success}
          />
          <StatTile
            label="Pass rate"
            value={`${Math.round(stats?.passRate ?? 0)}%`}
            tint={colors.primary}
          />
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Submissions ({attempts.length})</Text>
          <Button
            title="Download CSV"
            variant="ghost"
            size="sm"
            disabled={attempts.length === 0}
            onPress={downloadSubmissions}
          />
        </View>

        {attempts.length === 0 ? (
          <EmptyState
            icon="👥"
            title="No submissions yet"
            subtitle="Results appear here as students complete the exam."
          />
        ) : (
          attempts.map((a) => {
            const student = typeof a.student === 'object' ? a.student : null;
            const pct = Math.round(a.percentage || 0);
            const passed = pct >= passMark;
            return (
              <Card key={a._id}>
                <View style={styles.rowTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.studentName}>{student?.name || 'Student'}</Text>
                    <Text style={styles.studentEmail}>{student?.email}</Text>
                  </View>
                  <View
                    style={[
                      styles.pctPill,
                      { backgroundColor: passed ? colors.successLight : colors.dangerLight },
                    ]}
                  >
                    <Text
                      style={[
                        styles.pctText,
                        { color: passed ? colors.success : colors.danger },
                      ]}
                    >
                      {pct}%
                    </Text>
                  </View>
                </View>

                <Text style={styles.meta}>
                  {a.score}/{a.totalPoints} points · {a.status}
                  {a.completedAt
                    ? ` · ${new Date(a.completedAt).toLocaleDateString(undefined, {
                        day: 'numeric',
                        month: 'short',
                      })}`
                    : ''}
                </Text>

                <Button
                  title="Delete attempt (allow retake)"
                  variant="ghost"
                  size="sm"
                  style={{ marginTop: spacing.md, alignSelf: 'flex-start' }}
                  onPress={() => confirmDeleteAttempt(a)}
                />
              </Card>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  statRow: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  studentName: { fontSize: 16, fontWeight: '700', color: colors.text },
  studentEmail: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  pctPill: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill },
  pctText: { fontSize: 15, fontWeight: '800' },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: spacing.sm, textTransform: 'capitalize' },
});
