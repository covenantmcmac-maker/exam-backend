import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, EmptyState, Loading } from '../../components/ui';
import { attemptsApi } from '../../api/endpoints';
import { radius, spacing } from '../../theme';
import { useColors } from '../../context/ThemeContext';
import type { Colors } from '../../theme';
import type { ExamReview, ReviewQuestion } from '../../api/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'ExamReview'>;

const TEXT_TYPES = ['short-answer', 'essay', 'fill-blank'];

function formatDuration(seconds?: number) {
  if (seconds === undefined) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function optionLetter(index: number) {
  return String.fromCharCode(65 + index);
}

function statusText(question: ReviewQuestion) {
  if (question.isCorrect === true) return 'Correct';
  if (question.isCorrect === false) return 'Wrong';
  return 'Needs grading';
}

export default function ExamReviewScreen({ route, navigation }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { attemptId } = route.params;

  const [review, setReview] = useState<ExamReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    navigation.setOptions({ title: 'Exam review' });
  }, [navigation]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await attemptsApi.review(attemptId);
        if (!cancelled) setReview(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load review.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attemptId]);

  if (loading) return <Loading text="Loading review…" />;

  if (error || !review) {
    return (
      <SafeAreaView style={styles.safe}>
        <EmptyState
          icon="🔒"
          title="Review unavailable"
          subtitle={error || 'Your teacher has not enabled review for this exam.'}
          action={<Button title="Go back" onPress={() => navigation.goBack()} />}
        />
      </SafeAreaView>
    );
  }

  const pct = review.percentage !== undefined ? Math.round(review.percentage) : null;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card style={styles.summary}>
          <Text style={styles.examTitle}>{review.exam.title}</Text>
          {!!review.exam.subject && <Text style={styles.subject}>{review.exam.subject}</Text>}

          {review.exam.settings.showResults && pct !== null ? (
            <View style={styles.summaryGrid}>
              <SummaryItem label="Score" value={`${review.score ?? 0}/${review.totalPoints ?? 0}`} />
              <SummaryItem label="Percent" value={`${pct}%`} />
              <SummaryItem label="Time" value={formatDuration(review.timeSpent)} />
            </View>
          ) : (
            <Text style={styles.hiddenNote}>
              Scores are hidden by your teacher, but answer review is enabled for this exam.
            </Text>
          )}
        </Card>

        <Text style={styles.sectionTitle}>Answers</Text>

        {review.questions.map((question, index) => (
          <QuestionReviewCard key={question.questionId} question={question} index={index} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.summaryItem}>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function QuestionReviewCard({ question, index }: { question: ReviewQuestion; index: number }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isText = TEXT_TYPES.includes(question.questionType);
  const correct = question.isCorrect === true;
  const wrong = question.isCorrect === false;
  const statusColor = correct ? colors.success : wrong ? colors.danger : colors.warning;
  const statusBg = correct ? colors.successLight : wrong ? colors.dangerLight : colors.warningLight;

  return (
    <Card>
      <View style={styles.questionHeader}>
        <Text style={styles.questionNumber}>Question {index + 1}</Text>
        <View style={[styles.statusPill, { backgroundColor: statusBg }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>{statusText(question)}</Text>
        </View>
      </View>

      <Text style={styles.questionText}>{question.questionText}</Text>

      {isText ? (
        <View style={styles.answerBox}>
          <Text style={styles.answerLabel}>Your answer</Text>
          <Text style={styles.answerText}>{question.textAnswer || 'No answer provided'}</Text>
        </View>
      ) : (
        (question.options || []).map((option, optionIndex) => {
          const selected = question.selectedOption === optionIndex;
          const isCorrectOption = question.correctOptionIndex === optionIndex;
          return (
            <View
              key={option._id || `${question.questionId}-${optionIndex}`}
              style={[
                styles.option,
                selected && styles.optionSelected,
                isCorrectOption && styles.optionCorrect,
              ]}
            >
              <Text style={styles.optionLetter}>{optionLetter(optionIndex)}</Text>
              <Text style={styles.optionText}>{option.text}</Text>
              {isCorrectOption && <Text style={styles.correctTag}>Correct</Text>}
              {selected && !isCorrectOption && <Text style={styles.selectedTag}>Your answer</Text>}
            </View>
          );
        })
      )}

      <View style={styles.correctBox}>
        <Text style={styles.answerLabel}>Correct answer</Text>
        <Text style={styles.correctAnswerText}>
          {question.correctAnswer || 'No model answer provided'}
        </Text>
      </View>

      {!!question.explanation && (
        <View style={styles.explanationBox}>
          <Text style={styles.answerLabel}>Explanation</Text>
          <Text style={styles.explanationText}>{question.explanation}</Text>
        </View>
      )}
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  summary: { gap: spacing.sm },
  examTitle: { fontSize: 20, fontWeight: '800', color: colors.text },
  subject: { fontSize: 14, color: colors.textMuted },
  hiddenNote: { fontSize: 14, color: colors.textMuted, lineHeight: 21, marginTop: spacing.sm },
  summaryGrid: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md, flexWrap: 'wrap' },
  summaryItem: {
    flex: 1,
    minWidth: 90,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  summaryValue: { fontSize: 18, fontWeight: '800', color: colors.primary },
  summaryLabel: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: colors.text, marginVertical: spacing.md },
  questionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  questionNumber: { fontSize: 13, fontWeight: '700', color: colors.primary },
  statusPill: { paddingHorizontal: spacing.md, paddingVertical: 5, borderRadius: radius.pill },
  statusText: { fontSize: 12, fontWeight: '800' },
  questionText: { fontSize: 16, fontWeight: '600', color: colors.text, lineHeight: 23, marginTop: spacing.md },
  answerBox: { backgroundColor: colors.bg, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  answerLabel: { fontSize: 12, fontWeight: '800', color: colors.textLight, textTransform: 'uppercase', marginBottom: spacing.xs },
  answerText: { fontSize: 15, color: colors.text, lineHeight: 22 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
    backgroundColor: colors.card,
  },
  optionSelected: { borderColor: colors.danger, backgroundColor: colors.dangerLight },
  optionCorrect: { borderColor: colors.success, backgroundColor: colors.successLight },
  optionLetter: { width: 24, fontSize: 13, fontWeight: '900', color: colors.textMuted },
  optionText: { flex: 1, fontSize: 15, color: colors.text },
  correctTag: { fontSize: 12, fontWeight: '800', color: colors.success },
  selectedTag: { fontSize: 12, fontWeight: '800', color: colors.danger },
  correctBox: { backgroundColor: colors.successLight, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  correctAnswerText: { fontSize: 15, color: colors.success, fontWeight: '700', lineHeight: 22 },
  explanationBox: { backgroundColor: colors.primaryLight, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  explanationText: { fontSize: 14, color: colors.text, lineHeight: 21 },
});
