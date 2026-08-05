import React, { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, ErrorNote, Field, Loading } from '../../components/ui';
import { questionsApi } from '../../api/endpoints';
import { radius, spacing } from '../../theme';
import { useColors } from '../../context/ThemeContext';
import { useDialog } from '../../components/Dialog';
import type { Colors } from '../../theme';
import type { QuestionType } from '../../api/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'QuestionEditor'>;

const TYPES: { value: QuestionType; label: string }[] = [
  { value: 'multiple-choice', label: 'Multiple choice' },
  { value: 'true-false', label: 'True / False' },
  { value: 'short-answer', label: 'Short answer' },
  { value: 'fill-blank', label: 'Fill blank' },
  { value: 'essay', label: 'Essay' },
];

const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

export default function QuestionEditorScreen({ route, navigation }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const dialog = useDialog();
  const questionId = route.params?.questionId;
  const isEdit = !!questionId;

  const [text, setText] = useState('');
  const [type, setType] = useState<QuestionType>('multiple-choice');
  const [options, setOptions] = useState<string[]>(['', '', '', '']);
  const [correctIndex, setCorrectIndex] = useState(0);
  const [correctAnswer, setCorrectAnswer] = useState('');
  const [points, setPoints] = useState('1');
  const [difficulty, setDifficulty] = useState<(typeof DIFFICULTIES)[number]>('medium');
  const [subject, setSubject] = useState('');
  const [explanation, setExplanation] = useState('');

  // Past question fields
  const [isPast, setIsPast] = useState(false);
  const [pastYear, setPastYear] = useState<string>('');
  const [pastSession, setPastSession] = useState<string>('');
  const [pastExamType, setPastExamType] = useState<string>('');
  const [originalIsPast, setOriginalIsPast] = useState(false);

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    navigation.setOptions({ title: isEdit ? 'Edit question' : 'New question' });
  }, [isEdit, navigation]);

  useEffect(() => {
    if (!questionId) return;
    let cancelled = false;

    (async () => {
      try {
        // Try new single endpoint first, fallback to list
        let q: any = null;
        try {
          q = await questionsApi.getOne(questionId);
        } catch {
          const res = await questionsApi.list();
          q = res.questions.find((x) => x._id === questionId);
          if (!q) {
            const resPast = await questionsApi.listPast();
            q = resPast.questions.find((x) => x._id === questionId);
          }
          if (!q) {
            const resAll = await questionsApi.listPastQuestionsPool({});
            q = resAll.questions.find((x: any) => x._id === questionId);
          }
        }
        if (!q || cancelled) return;
        setText(q.questionText);
        setType(q.questionType);
        setPoints(String(q.points ?? 1));
        setDifficulty((q.difficulty as (typeof DIFFICULTIES)[number]) || 'medium');
        setSubject(q.subject || '');
        setExplanation(q.explanation || '');
        setCorrectAnswer(q.correctAnswer || '');
        setIsPast(!!q.isPastQuestion);
        setOriginalIsPast(!!q.isPastQuestion);
        setPastYear(q.pastQuestionYear ? String(q.pastQuestionYear) : '');
        setPastSession(q.pastQuestionSession || '');
        setPastExamType(q.pastQuestionExamType || '');
        if (q.options?.length) {
          setOptions(q.options.map((o: any) => o.text));
          const idx = q.options.findIndex((o: any) => o.isCorrect);
          setCorrectIndex(idx >= 0 ? idx : 0);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load question.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [questionId]);

  useEffect(() => {
    if (type === 'true-false') {
      setOptions(['True', 'False']);
      setCorrectIndex((i) => (i > 1 ? 0 : i));
    } else if (type === 'multiple-choice' && options.length < 3) {
      setOptions(['', '', '', '']);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const isChoice = type === 'multiple-choice' || type === 'true-false';

  const setOption = (i: number, value: string) =>
    setOptions((prev) => prev.map((o, idx) => (idx === i ? value : o)));

  const save = async () => {
    if (!text.trim()) {
      setError('Enter the question text.');
      return;
    }

    let payload: Record<string, unknown> = {
      questionText: text.trim(),
      questionType: type,
      points: parseInt(points, 10) || 1,
      difficulty,
      subject: subject.trim(),
      explanation: explanation.trim(),
      isPastQuestion: isPast,
    };

    if (isPast) {
      if (pastYear.trim()) (payload as any).pastQuestionYear = parseInt(pastYear.trim());
      if (pastSession.trim()) (payload as any).pastQuestionSession = pastSession.trim();
      if (pastExamType.trim()) (payload as any).pastQuestionExamType = pastExamType.trim();
    }

    if (isChoice) {
      const filled = options.map((o) => o.trim());
      const usable = filled.filter((o) => o !== '');
      if (usable.length < 2) {
        setError('Provide at least two options.');
        return;
      }
      if (!filled[correctIndex]) {
        setError('Mark which option is correct.');
        return;
      }
      payload.options = filled
        .map((o, i) => ({ text: o, isCorrect: i === correctIndex }))
        .filter((o) => (o as any).text !== '');
      payload.correctAnswer = String.fromCharCode(65 + correctIndex);
    } else {
      if (type !== 'essay' && !correctAnswer.trim()) {
        setError('Enter the expected answer.');
        return;
      }
      payload.options = [];
      payload.correctAnswer = correctAnswer.trim();
    }

    setSaving(true);
    setError(null);
    try {
      if (isEdit) await questionsApi.update(questionId!, payload as never);
      else await questionsApi.create(payload as never);
      navigation.goBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save question.');
    } finally {
      setSaving(false);
    }
  };

  const handleMoveToggle = async () => {
    if (!questionId) {
      // For new question, just toggle flag; save will handle it
      setIsPast(!isPast);
      return;
    }
    // Existing question: call dedicated endpoint
    if (originalIsPast) {
      const ok = await dialog.confirm(
        'Restore from past?',
        'This question will be moved back to your active bank and will no longer appear in Past Questions.',
        { confirmLabel: 'Restore' }
      );
      if (!ok) return;
      setMoving(true);
      try {
        await questionsApi.restore(questionId);
        void dialog.notify('Restored', 'Question restored to active bank.');
        navigation.goBack();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Restore failed.');
      } finally {
        setMoving(false);
      }
    } else {
      const ok = await dialog.confirm(
        'Move to past questions?',
        'This question will be moved to Past Questions. It will be removed from your active bank but can be restored anytime. Students will be able to find it when browsing Past Questions.',
        { confirmLabel: 'Move to past' }
      );
      if (!ok) return;
      setMoving(true);
      try {
        const meta: any = {};
        if (pastYear.trim()) meta.pastQuestionYear = parseInt(pastYear.trim());
        if (pastSession.trim()) meta.pastQuestionSession = pastSession.trim();
        if (pastExamType.trim()) meta.pastQuestionExamType = pastExamType.trim();
        await questionsApi.moveToPast(questionId, meta);
        void dialog.notify('Moved', 'Question moved to past questions.');
        navigation.goBack();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Move failed.');
      } finally {
        setMoving(false);
      }
    }
  };

  if (loading) return <Loading />;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <ErrorNote message={error} />

        {isEdit && (
          <Card style={isPast || originalIsPast ? styles.pastCard : undefined}>
            <Text style={styles.section}>{originalIsPast ? 'Past Question Status' : 'Past Questions Option'}</Text>
            <Text style={styles.hint}>
              {originalIsPast
                ? 'This question is currently in your Past Questions archive. You can restore it to active bank or edit its past metadata.'
                : 'Move this question to Past Questions to archive it. Past questions are kept for future reuse and are browsable by students.'}
            </Text>
            <View style={styles.pastToggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.pastLabel}>
                  {originalIsPast ? '📚 Currently archived as past question' : '📚 Move to Past Questions'}
                </Text>
                {(pastYear || pastSession || pastExamType) && (
                  <Text style={styles.pastMeta}>
                    {[pastYear && `${pastYear}`, pastSession, pastExamType].filter(Boolean).join(' • ')}
                  </Text>
                )}
              </View>
              <Button
                title={originalIsPast ? 'Restore' : isPast ? '✓ Will archive on save' : 'Move to Past'}
                variant={originalIsPast ? 'secondary' : 'primary'}
                size="sm"
                loading={moving}
                onPress={handleMoveToggle}
              />
            </View>
          </Card>
        )}

        <Card>
          <Text style={styles.section}>Question</Text>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Type your question…"
            placeholderTextColor={colors.textLight}
            multiline
            style={styles.questionInput}
            textAlignVertical="top"
          />

          <Text style={styles.label}>Type</Text>
          <View style={styles.chipWrap}>
            {TYPES.map((t) => {
              const active = type === t.value;
              return (
                <Pressable
                  key={t.value}
                  onPress={() => setType(t.value)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {t.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        <Card>
          <Text style={styles.section}>{isChoice ? 'Options' : 'Answer'}</Text>

          {isChoice ? (
            <>
              <Text style={styles.hint}>Tap the circle to mark the correct answer.</Text>
              {options.map((o, i) => {
                const correct = correctIndex === i;
                return (
                  <View key={i} style={styles.optionRow}>
                    <Pressable
                      onPress={() => setCorrectIndex(i)}
                      style={[styles.radio, correct && styles.radioOn]}
                    >
                      {correct && <View style={styles.radioDot} />}
                    </Pressable>
                    <TextInput
                      value={o}
                      onChangeText={(v) => setOption(i, v)}
                      placeholder={`Option ${String.fromCharCode(65 + i)}`}
                      placeholderTextColor={colors.textLight}
                      editable={type !== 'true-false'}
                      style={[styles.optionInput, correct && styles.optionInputOn]}
                    />
                  </View>
                );
              })}

              {type === 'multiple-choice' && options.length < 6 && (
                <Button
                  title="+ Add option"
                  variant="ghost"
                  size="sm"
                  style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }}
                  onPress={() => setOptions((prev) => [...prev, ''])}
                />
              )}
            </>
          ) : type === 'essay' ? (
            <Text style={styles.hint}>
              Essay answers are graded manually from the exam results screen.
            </Text>
          ) : (
            <Field
              label="Expected answer"
              value={correctAnswer}
              onChangeText={setCorrectAnswer}
              placeholder="Exact answer (case-insensitive)"
            />
          )}
        </Card>

        <Card>
          <Text style={styles.section}>Details</Text>
          <View style={styles.detailRow}>
            <Field
              label="Points"
              value={points}
              onChangeText={setPoints}
              keyboardType="number-pad"
              style={{ textAlign: 'center' }}
            />
            <Field
              label="Subject"
              value={subject}
              onChangeText={setSubject}
              placeholder="Mathematics"
            />
          </View>

          <Text style={styles.label}>Difficulty</Text>
          <View style={styles.chipWrap}>
            {DIFFICULTIES.map((d) => {
              const active = difficulty === d;
              return (
                <Pressable
                  key={d}
                  onPress={() => setDifficulty(d)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{d}</Text>
                </Pressable>
              );
            })}
          </View>

          <Field
            label="Explanation (optional)"
            value={explanation}
            onChangeText={setExplanation}
            placeholder="Shown after grading"
            multiline
            style={{ minHeight: 70, textAlignVertical: 'top' }}
          />
        </Card>

        <Card style={isPast ? styles.pastCard : undefined}>
          <Text style={styles.section}>📚 Past Question Metadata</Text>
          <Text style={styles.hint}>
            If this question is/will be a past question, add year / session info to help students filter.
          </Text>

          <View style={styles.pastToggleRow}>
            <Text style={styles.pastLabel}>Mark as Past Question?</Text>
            <Pressable
              onPress={() => setIsPast(!isPast)}
              style={[styles.toggle, isPast && styles.toggleOn]}
            >
              <View style={[styles.toggleKnob, isPast && styles.toggleKnobOn]} />
            </Pressable>
          </View>

          {isPast && (
            <View style={styles.detailRow}>
              <Field
                label="Year"
                value={pastYear}
                onChangeText={setPastYear}
                placeholder={`${new Date().getFullYear()}`}
                keyboardType="number-pad"
              />
              <Field
                label="Session"
                value={pastSession}
                onChangeText={setPastSession}
                placeholder="June / Dec"
              />
            </View>
          )}
          {isPast && (
            <Field
              label="Exam Type"
              value={pastExamType}
              onChangeText={setPastExamType}
              placeholder="Final, Midterm, WAEC, etc."
            />
          )}
        </Card>

        <View style={styles.actions}>
          <Button
            title={isEdit ? 'Save changes' : isPast ? 'Add to Past Questions' : 'Add question'}
            onPress={save}
            loading={saving}
            disabled={moving}
            style={{ flex: 1 }}
          />
          {isEdit && !originalIsPast && (
            <Button
              title="Move to Past & Save"
              variant="secondary"
              onPress={async () => {
                setIsPast(true);
                // small delay to let state update then save will include past flag if user hasn't used dedicated move
                setTimeout(() => void save(), 100);
              }}
              disabled={saving || moving}
              style={{ flex: 1 }}
            />
          )}
        </View>

        {isEdit && (
          <Button
            title={originalIsPast ? 'Restore from Past Questions' : 'Move to Past Questions'}
            variant={originalIsPast ? 'ghost' : 'secondary'}
            onPress={handleMoveToggle}
            loading={moving}
            disabled={saving}
            style={{ marginTop: spacing.md }}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
    section: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
    label: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textMuted,
      marginBottom: spacing.sm,
      marginTop: spacing.sm,
    },
    hint: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.md, lineHeight: 18 },
    pastCard: {
      borderColor: colors.warning || '#FFC107',
      borderWidth: 1.5,
      backgroundColor: colors.warningLight || '#FFF8E1',
    },
    pastToggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      marginTop: spacing.sm,
    },
    pastLabel: { fontSize: 14, fontWeight: '700', color: colors.text },
    pastMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
    toggle: {
      width: 48,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.border,
      padding: 2,
      justifyContent: 'center',
    },
    toggleOn: { backgroundColor: colors.primary },
    toggleKnob: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.white,
      alignSelf: 'flex-start',
    },
    toggleKnobOn: { alignSelf: 'flex-end' },
    questionInput: {
      backgroundColor: colors.bg,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: spacing.lg,
      fontSize: 16,
      color: colors.text,
      minHeight: 92,
    },
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: 7,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { fontSize: 13, color: colors.textMuted, fontWeight: '600', textTransform: 'capitalize' },
    chipTextActive: { color: colors.white },
    optionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
    radio: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioOn: { borderColor: colors.success },
    radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.success },
    optionInput: {
      flex: 1,
      backgroundColor: colors.bg,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: 11,
      fontSize: 15,
      color: colors.text,
    },
    optionInputOn: { borderColor: colors.success, backgroundColor: colors.successLight },
    detailRow: { flexDirection: 'row', gap: spacing.md },
    actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  });
