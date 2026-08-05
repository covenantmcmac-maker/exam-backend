import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { radius, spacing } from '../../theme';
import { useColors } from '../../context/ThemeContext';
import type { Colors } from '../../theme';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'ExamResult'>;

function fmtTime(seconds?: number) {
  if (seconds === undefined) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function ExamResultScreen({ route, navigation }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const {
    showResults,
    score,
    totalPoints,
    percentage,
    passed,
    timeSpent,
    examTitle,
    allowReview,
    attemptId,
  } = route.params;
  const { isTeacher } = useAuth();

  const pct = percentage ? Math.round(parseFloat(percentage)) : 0;

  const goHome = () => {
    navigation.reset({
      index: 0,
      routes: [{ name: isTeacher ? 'TeacherTabs' : 'StudentTabs' }],
    });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {showResults ? (
          <>
            <View
              style={[
                styles.hero,
                { backgroundColor: passed ? colors.successLight : colors.dangerLight },
              ]}
            >
              <Text style={styles.heroIcon}>{passed ? '🎉' : '📘'}</Text>
              <Text
                style={[styles.heroPct, { color: passed ? colors.success : colors.danger }]}
              >
                {pct}%
              </Text>
              <Text
                style={[styles.heroVerdict, { color: passed ? colors.success : colors.danger }]}
              >
                {passed ? 'You passed!' : 'Keep practising'}
              </Text>
            </View>

            {!!examTitle && <Text style={styles.examTitle}>{examTitle}</Text>}

            <Card style={styles.detailCard}>
              <Row label="Score" value={`${score ?? 0} / ${totalPoints ?? 0} points`} />
              <Divider />
              <Row label="Percentage" value={`${percentage ?? 0}%`} />
              <Divider />
              <Row label="Time taken" value={fmtTime(timeSpent)} />
            </Card>
          </>
        ) : (
          <>
            <View style={[styles.hero, { backgroundColor: colors.primaryLight }]}>
              <Text style={styles.heroIcon}>✅</Text>
              <Text style={[styles.heroVerdict, { color: colors.primary, marginTop: spacing.sm }]}>
                Submitted successfully
              </Text>
            </View>

            {!!examTitle && <Text style={styles.examTitle}>{examTitle}</Text>}

            <Card style={styles.detailCard}>
              <Text style={styles.hiddenNote}>
                Your teacher has chosen not to release scores immediately. You&apos;ll be able to
                see your result once it is published.
              </Text>
              <Divider />
              <Row label="Time taken" value={fmtTime(timeSpent)} />
            </Card>
          </>
        )}

        {allowReview && attemptId && (
          <Button
            title="Review answers"
            variant="secondary"
            onPress={() => navigation.navigate('ExamReview', { attemptId })}
            style={{ marginTop: spacing.lg }}
          />
        )}

        <Button title="Back to home" onPress={goHome} style={{ marginTop: spacing.md }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function Divider() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <View style={styles.divider} />;
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, flexGrow: 1, justifyContent: 'center' },
  hero: {
    borderRadius: radius.lg,
    padding: spacing.xxl,
    alignItems: 'center',
  },
  heroIcon: { fontSize: 56 },
  heroPct: { fontSize: 52, fontWeight: '900', marginTop: spacing.sm },
  heroVerdict: { fontSize: 18, fontWeight: '700' },
  examTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  detailCard: { marginTop: spacing.lg },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.md },
  rowLabel: { fontSize: 15, color: colors.textMuted },
  rowValue: { fontSize: 15, fontWeight: '700', color: colors.text },
  divider: { height: 1, backgroundColor: colors.border },
  hiddenNote: {
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 21,
    paddingBottom: spacing.md,
  },
});
