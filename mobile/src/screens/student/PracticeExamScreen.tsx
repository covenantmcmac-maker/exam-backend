import React, { useMemo, useState, useCallback } from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card } from '../../components/ui';
import { useDialog } from '../../components/Dialog';
import { useColors } from '../../context/ThemeContext';
import { spacing, radius } from '../../theme';
import type { Colors } from '../../theme';
import type { Question } from '../../api/types';
import { questionsApi } from '../../api/endpoints';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'PracticeExam'>;

export default function PracticeExamScreen({ route, navigation }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const dialog = useDialog();

  const initialQuestions: Question[] = route.params?.questions || [];

  const [questions] = useState<Question[]>(initialQuestions);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<string, { selectedOption?: number; textAnswer?: string }>>({});
  const [submitting, setSubmitting] = useState(false);

  const q = questions[current];

  const answeredCount = Object.keys(answers).length;

  const selectOption = (questionId: string, idx: number) => {
    setAnswers((prev) => ({ ...prev, [questionId]: { ...prev[questionId], selectedOption: idx } }));
  };

  const setTextAnswer = (questionId: string, text: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: { ...prev[questionId], textAnswer: text } }));
  };

  const next = () => {
    if (current < questions.length - 1) setCurrent((c) => c + 1);
  };
  const prev = () => {
    if (current > 0) setCurrent((c) => c - 1);
  };

  const submit = async () => {
    if (answeredCount < questions.length) {
      const ok = await dialog.confirm(
        'Submit practice?',
        `You have answered ${answeredCount} of ${questions.length}. Submit anyway?`,
        { confirmLabel: 'Submit' }
      );
      if (!ok) return;
    }

    setSubmitting(true);
    try {
      const payload = questions.map((qq) => ({
        questionId: qq._id,
        selectedOption: answers[qq._id]?.selectedOption,
        textAnswer: answers[qq._id]?.textAnswer,
      }));

      const res = await questionsApi.submitPractice(payload);

      navigation.replace('PracticeResult', {
        score: res.score,
        totalPoints: res.totalPoints,
        percentage: res.percentage,
        passed: res.passed,
        results: res.results,
        totalQuestions: res.totalQuestions,
      });
    } catch (e) {
      void dialog.notify('Error', e instanceof Error ? e.message : 'Could not submit practice.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!q) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No questions loaded.</Text>
          <Button title="Go back" onPress={() => navigation.goBack()} />
        </View>
      </SafeAreaView>
    );
  }

  const isChoice = q.questionType === 'multiple-choice' || q.questionType === 'true-false';
  const userAns = answers[q._id];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Practice Exam</Text>
        <Text style={styles.headerMeta}>
          Q {current + 1}/{questions.length} · {answeredCount} answered
        </Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.navRow}>
        {questions.map((qq, idx) => {
          const answered = !!answers[qq._id];
          const active = idx === current;
          return (
            <Pressable key={qq._id} onPress={() => setCurrent(idx)} style={[styles.navDot, answered && styles.navDotAnswered, active && styles.navDotActive]}>
              <Text style={[styles.navDotText, answered && styles.navDotTextAnswered, active && styles.navDotTextActive]}>{idx + 1}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Card>
          <View style={styles.qTop}>
            <View style={styles.pastBadge}>
              <Text style={styles.pastBadgeText}>PAST {q.pastQuestionYear || ''}</Text>
            </View>
            {q.subject && <Text style={styles.subjectText}>{q.subject} · {q.difficulty}</Text>}
          </View>
          <Text style={styles.qText}>{q.questionText}</Text>

          {isChoice ? (
            <View style={styles.options}>
              {(q.options || []).map((opt, i) => {
                const selected = userAns?.selectedOption === i;
                return (
                  <Pressable key={opt._id || i} onPress={() => selectOption(q._id, i)} style={[styles.optRow, selected && styles.optRowSelected]}>
                    <View style={[styles.radio, selected && styles.radioOn]}>
                      {selected && <View style={styles.radioDot} />}
                    </View>
                    <Text style={[styles.optText, selected && styles.optTextSelected]}>{String.fromCharCode(65 + i)}. {opt.text}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <View style={{ marginTop: spacing.lg }}>
              <Text style={styles.label}>Your answer</Text>
              <TextInput
                value={userAns?.textAnswer || ''}
                onChangeText={(t) => setTextAnswer(q._id, t)}
                placeholder="Type your answer…"
                placeholderTextColor={colors.textLight}
                style={styles.textInput}
                multiline
              />
            </View>
          )}

          {q.explanation ? null : null}
        </Card>
      </ScrollView>

      <View style={styles.footer}>
        <Button title="Previous" variant="ghost" size="sm" disabled={current === 0} onPress={prev} style={{ flex: 1 }} />
        {current < questions.length - 1 ? (
          <Button title="Next" size="sm" onPress={next} style={{ flex: 1 }} />
        ) : (
          <Button title="Submit Practice" size="sm" loading={submitting} onPress={submit} style={{ flex: 1 }} />
        )}
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.card },
    headerTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
    headerMeta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
    navRow: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.card },
    navDot: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
    navDotAnswered: { backgroundColor: colors.successLight, borderColor: colors.success },
    navDotActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    navDotText: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
    navDotTextAnswered: { color: colors.success },
    navDotTextActive: { color: colors.white },
    scroll: { padding: spacing.lg, paddingBottom: 120 },
    qTop: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', marginBottom: spacing.md, flexWrap: 'wrap' },
    pastBadge: { backgroundColor: colors.warningLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
    pastBadgeText: { fontSize: 10, fontWeight: '800', color: colors.warning },
    subjectText: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
    qText: { fontSize: 16, fontWeight: '600', color: colors.text, lineHeight: 22 },
    options: { marginTop: spacing.lg, gap: spacing.md },
    optRow: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, alignItems: 'center' },
    optRowSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
    radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    radioOn: { borderColor: colors.primary },
    radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
    optText: { flex: 1, fontSize: 14, color: colors.text },
    optTextSelected: { fontWeight: '700' },
    label: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginBottom: spacing.sm },
    textInput: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, fontSize: 15, color: colors.text, minHeight: 90, textAlignVertical: 'top' },
    footer: { flexDirection: 'row', gap: spacing.md, padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
    emptyText: { fontSize: 16, color: colors.textMuted, marginBottom: spacing.lg },
  });
