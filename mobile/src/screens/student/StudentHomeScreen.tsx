import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Button, Card, ErrorNote, Field, StatTile } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useDialog } from '../../components/Dialog';
import { attemptsApi, examsApi } from '../../api/endpoints';
import { radius, spacing } from '../../theme';
import { useColors } from '../../context/ThemeContext';
import type { Colors } from '../../theme';
import type { ExamAttempt } from '../../api/types';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList, StudentTabParamList } from '../../navigation/types';

type Props = CompositeScreenProps<
  BottomTabScreenProps<StudentTabParamList, 'Home'>,
  NativeStackScreenProps<RootStackParamList>
>;

function scoreIsVisible(attempt: ExamAttempt) {
  const exam = typeof attempt.exam === 'object' ? attempt.exam : null;
  return exam?.settings?.showResults !== false && attempt.percentage !== undefined && attempt.score !== undefined;
}

export default function StudentHomeScreen({ navigation }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const dialog = useDialog();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await attemptsApi.myAttempts();
      setAttempts(data);
    } catch {
      /* non-blocking */
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

  const joinExam = async () => {
    if (!code.trim()) {
      setError('Enter an access code.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { exam } = await examsApi.join(code.trim().toUpperCase());
      setCode('');
      const start = await dialog.confirm(
        exam.title,
        `${exam.questions?.length ?? 0} questions · ${exam.settings.duration} minutes\n\nReady to begin?`,
        { confirmLabel: 'Start exam', cancelLabel: 'Not now' }
      );
      if (start) navigation.navigate('ExamTaking', { examId: exam._id });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join exam.');
    } finally {
      setBusy(false);
    }
  };

  const completed = attempts.length;
  const visibleAttempts = attempts.filter(scoreIsVisible);
  const visibleCount = visibleAttempts.length;
  const avg =
    visibleCount > 0
      ? Math.round(visibleAttempts.reduce((sum, a) => sum + (a.percentage || 0), 0) / visibleCount)
      : 0;
  const best =
    visibleCount > 0 ? Math.round(Math.max(...visibleAttempts.map((a) => a.percentage || 0))) : 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={styles.greeting}>Hi, {user?.name?.split(' ')[0] || 'there'} 👋</Text>
        <Text style={styles.subtitle}>Ready for your next exam?</Text>

        <Card style={styles.joinCard}>
          <Text style={styles.joinTitle}>Enter exam code</Text>
          <Text style={styles.joinHint}>
            Your teacher will share an access code for the exam.
          </Text>

          <ErrorNote message={error} />

          <Field
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase())}
            placeholder="A1B2C3D4"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={12}
            style={styles.codeInput}
          />
          <Button title="Join exam" onPress={joinExam} loading={busy} />
        </Card>

        <Card style={{ marginTop: spacing.lg }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>📚 Past Questions</Text>
          <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 4, marginBottom: spacing.md, lineHeight: 18 }}>
            Practice with questions from previous exams. Teachers archive old questions here for revision.
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <Button title="Browse" variant="secondary" style={{ flex: 1 }} onPress={() => navigation.navigate('PastQuestions' as any)} />
            <Button title="🎯 Practice Test" style={{ flex: 1 }} onPress={() => navigation.navigate('PracticeSetup' as any)} />
          </View>
        </Card>

        <Text style={styles.sectionTitle}>Your progress</Text>
        <View style={styles.statRow}>
          <StatTile label="Exams taken" value={completed} />
          <StatTile
            label="Average"
            value={completed === 0 ? '—' : visibleCount > 0 ? `${avg}%` : 'Hidden'}
            tint={colors.accent}
          />
          <StatTile
            label="Best score"
            value={completed === 0 ? '—' : visibleCount > 0 ? `${best}%` : 'Hidden'}
            tint={colors.success}
          />
        </View>

        {completed > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recent results</Text>
              <Button
                title="See all"
                variant="ghost"
                size="sm"
                onPress={() => navigation.navigate('Results')}
              />
            </View>

            {attempts.slice(0, 3).map((a) => {
              const exam = typeof a.exam === 'object' ? a.exam : null;
              const visible = scoreIsVisible(a);
              const pct = Math.round(a.percentage || 0);
              const passed = pct >= (exam?.settings?.passingMarks ?? 50);
              return (
                <Card key={a._id} style={styles.resultRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.resultTitle} numberOfLines={1}>
                      {exam?.title || 'Exam'}
                    </Text>
                    <Text style={styles.resultMeta}>
                      {visible ? `${a.score ?? 0}/${a.totalPoints ?? 0} points` : 'Score hidden by teacher'}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.pctPill,
                      {
                        backgroundColor: visible
                          ? passed
                            ? colors.successLight
                            : colors.dangerLight
                          : colors.primaryLight,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.pctText,
                        {
                          color: visible
                            ? passed
                              ? colors.success
                              : colors.danger
                            : colors.primary,
                        },
                      ]}
                    >
                      {visible ? `${pct}%` : 'Hidden'}
                    </Text>
                  </View>
                </Card>
              );
            })}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  greeting: { fontSize: 26, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 15, color: colors.textMuted, marginTop: 2, marginBottom: spacing.xl },
  joinCard: { padding: spacing.xl },
  joinTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  joinHint: { fontSize: 13, color: colors.textMuted, marginTop: 4, marginBottom: spacing.lg },
  codeInput: { fontSize: 22, fontWeight: '700', letterSpacing: 4, textAlign: 'center' },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statRow: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  resultTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  resultMeta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  pctPill: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill },
  pctText: { fontSize: 15, fontWeight: '800' },
});
