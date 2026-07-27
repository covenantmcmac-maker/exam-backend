import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Loading } from '../../components/ui';
import { useDialog } from '../../components/Dialog';
import { attemptsApi, examsApi } from '../../api/endpoints';
import { colors, radius, spacing } from '../../theme';
import type { Exam, Question } from '../../api/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'ExamTaking'>;

interface Slot {
  question: Question;
  points: number;
}

const TEXT_TYPES = ['short-answer', 'essay', 'fill-blank'];

function fmt(totalSeconds: number) {
  const s = Math.max(0, totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export default function ExamTakingScreen({ route, navigation }: Props) {
  const { examId } = route.params;
  const dialog = useDialog();

  const [exam, setExam] = useState<Exam | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, { option?: number; text?: string }>>({});
  const [remaining, setRemaining] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const submittedRef = useRef(false);
  const attemptIdRef = useRef<string | null>(null);
  const deadlineRef = useRef<number | null>(null);

  /* ------------------------------------------------------------- bootstrap */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const examData = await examsApi.take(examId);
        const startRes = await attemptsApi.start(examId);
        if (cancelled) return;

        const attempt = startRes.attempt;
        attemptIdRef.current = attempt._id;
        setAttemptId(attempt._id);
        setExam(examData);

        const nextSlots: Slot[] = (examData.questions || [])
          .filter((q) => q.question && typeof q.question === 'object')
          .map((q) => ({ question: q.question as Question, points: q.points || 1 }));
        setSlots(nextSlots);

        // Restore any answers already saved on a resumed attempt.
        const restored: Record<string, { option?: number; text?: string }> = {};
        (attempt.answers || []).forEach((a) => {
          const qid = typeof a.question === 'string' ? a.question : String(a.question);
          if (a.selectedOption !== undefined && a.selectedOption !== null) {
            restored[qid] = { ...restored[qid], option: a.selectedOption };
          }
          if (a.textAnswer) {
            restored[qid] = { ...restored[qid], text: a.textAnswer };
          }
        });
        setAnswers(restored);

        // Timer continues from when the attempt actually started.
        const durationSec = (examData.settings?.duration || 60) * 60;
        const startedAt = new Date(attempt.startedAt).getTime();
        const elapsed = Number.isNaN(startedAt)
          ? 0
          : Math.floor((Date.now() - startedAt) / 1000);
        const left = Math.max(0, durationSec - Math.max(0, elapsed));
        deadlineRef.current = Date.now() + left * 1000;
        setRemaining(left);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not load exam.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [examId]);

  /* ----------------------------------------------------------------- submit */
  const doSubmit = useCallback(
    async (auto: boolean) => {
      const id = attemptIdRef.current;
      if (!id || submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);

      try {
        const res = await attemptsApi.submit(id);
        navigation.replace('ExamResult', {
          showResults: res.showResults,
          score: res.score,
          totalPoints: res.totalPoints,
          percentage: res.percentage,
          passed: res.passed,
          timeSpent: res.timeSpent,
          examTitle: exam?.title,
        });
      } catch (e) {
        submittedRef.current = false;
        setSubmitting(false);
        void dialog.notify(
          auto ? 'Auto-submit failed' : 'Submit failed',
          e instanceof Error ? e.message : 'Please try again.'
        );
      }
    },
    [dialog, exam?.title, navigation]
  );

  /* ------------------------------------------------------------------ timer */
  useEffect(() => {
    if (remaining === null || submittedRef.current) return;

    const tick = setInterval(() => {
      const deadline = deadlineRef.current;
      if (!deadline) return;
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) {
        clearInterval(tick);
        if (!submittedRef.current) {
          void dialog.notify("Time's up", 'Your exam is being submitted automatically.');
          void doSubmit(true);
        }
      }
    }, 1000);

    return () => clearInterval(tick);
    // Only needs to start once the initial remaining value is known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining === null, doSubmit]);

  /* --------------------------------------------- block accidental back-out */
  useEffect(() => {
    const confirmExit = () => {
      if (submittedRef.current) return false;
      void (async () => {
        const leave = await dialog.confirm(
          'Leave the exam?',
          'Your answers are saved, but the timer keeps running.',
          { confirmLabel: 'Leave', cancelLabel: 'Stay', destructive: true }
        );
        if (leave) navigation.goBack();
      })();
      return true;
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', confirmExit);
    const unsub = navigation.addListener('beforeRemove', (e) => {
      if (submittedRef.current || e.data.action.type === 'REPLACE') return;
      e.preventDefault();
      confirmExit();
    });

    return () => {
      sub.remove();
      unsub();
    };
  }, [dialog, navigation]);

  /* ---------------------------------------------------------- answer saving */
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const persistAnswer = useCallback(
    (questionId: string, payload: { selectedOption?: number; textAnswer?: string }) => {
      const id = attemptIdRef.current;
      if (!id) return;
      attemptsApi.saveAnswer(id, { questionId, ...payload }).catch(() => {
        /* Answer stays in local state; retried on the next change/submit. */
      });
    },
    []
  );

  const chooseOption = (questionId: string, optionIndex: number) => {
    setAnswers((prev) => ({ ...prev, [questionId]: { ...prev[questionId], option: optionIndex } }));
    persistAnswer(questionId, { selectedOption: optionIndex });
  };

  const writeText = (questionId: string, text: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: { ...prev[questionId], text } }));
    clearTimeout(saveTimers.current[questionId]);
    saveTimers.current[questionId] = setTimeout(() => {
      persistAnswer(questionId, { textAnswer: text });
    }, 700);
  };

  useEffect(
    () => () => {
      Object.values(saveTimers.current).forEach(clearTimeout);
    },
    []
  );

  /* ------------------------------------------------------------------- view */
  const answeredCount = useMemo(
    () =>
      slots.filter((s) => {
        const a = answers[s.question._id];
        return a && (a.option !== undefined || (a.text && a.text.trim() !== ''));
      }).length,
    [slots, answers]
  );

  if (loading) return <Loading text="Preparing your exam…" />;

  if (loadError || slots.length === 0) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorTitle}>
            {loadError || 'This exam has no questions yet.'}
          </Text>
          <Button
            title="Go back"
            variant="secondary"
            style={{ marginTop: spacing.lg }}
            onPress={() => navigation.goBack()}
          />
        </View>
      </SafeAreaView>
    );
  }

  const slot = slots[index];
  const q = slot.question;
  const current = answers[q._id] || {};
  const isText = TEXT_TYPES.includes(q.questionType);
  const isLast = index === slots.length - 1;
  const lowTime = remaining !== null && remaining <= 60;

  const confirmSubmit = async () => {
    const unanswered = slots.length - answeredCount;
    const ok = await dialog.confirm(
      'Submit exam?',
      unanswered > 0
        ? `You have ${unanswered} unanswered question${unanswered === 1 ? '' : 's'}. Submit anyway?`
        : 'All questions answered. Submit your exam?',
      { confirmLabel: 'Submit', cancelLabel: 'Keep working', destructive: true }
    );
    if (ok) await doSubmit(false);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Header: timer + progress */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.examTitle} numberOfLines={1}>
            {exam?.title}
          </Text>
          <Text style={styles.progressText}>
            Question {index + 1} of {slots.length} · {answeredCount} answered
          </Text>
        </View>
        <View style={[styles.timer, lowTime && styles.timerLow]}>
          <Text style={[styles.timerText, lowTime && styles.timerTextLow]}>
            {remaining === null ? '--:--' : fmt(remaining)}
          </Text>
        </View>
      </View>

      <View style={styles.progressBar}>
        <View
          style={[styles.progressFill, { width: `${((index + 1) / slots.length) * 100}%` }]}
        />
      </View>

      {/* Question navigator */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.navStrip}
        contentContainerStyle={styles.navStripInner}
      >
        {slots.map((s, i) => {
          const a = answers[s.question._id];
          const done = a && (a.option !== undefined || (a.text && a.text.trim() !== ''));
          const active = i === index;
          return (
            <Pressable
              key={s.question._id}
              onPress={() => setIndex(i)}
              style={[styles.navDot, done && styles.navDotDone, active && styles.navDotActive]}
            >
              <Text
                style={[
                  styles.navDotText,
                  done && styles.navDotTextDone,
                  active && styles.navDotTextActive,
                ]}
              >
                {i + 1}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Question body */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.pointsRow}>
          <Text style={styles.points}>
            {slot.points} {slot.points === 1 ? 'mark' : 'marks'}
          </Text>
          <Text style={styles.qType}>{q.questionType.replace('-', ' ')}</Text>
        </View>

        <Text style={styles.questionText}>{q.questionText}</Text>

        {isText ? (
          <TextInput
            value={current.text || ''}
            onChangeText={(t) => writeText(q._id, t)}
            placeholder="Type your answer…"
            placeholderTextColor={colors.textLight}
            multiline={q.questionType === 'essay'}
            style={[styles.textAnswer, q.questionType === 'essay' && styles.essayAnswer]}
            textAlignVertical={q.questionType === 'essay' ? 'top' : 'center'}
          />
        ) : (
          (q.options || []).map((opt, i) => {
            const selected = current.option === i;
            return (
              <Pressable
                key={opt._id || `${q._id}-${i}`}
                onPress={() => chooseOption(q._id, i)}
                style={[styles.option, selected && styles.optionSelected]}
              >
                <View style={[styles.optionLetter, selected && styles.optionLetterSelected]}>
                  <Text
                    style={[
                      styles.optionLetterText,
                      selected && styles.optionLetterTextSelected,
                    ]}
                  >
                    {String.fromCharCode(65 + i)}
                  </Text>
                </View>
                <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                  {opt.text}
                </Text>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      {/* Footer controls */}
      <View style={styles.footer}>
        <Button
          title="Previous"
          variant="ghost"
          style={{ flex: 1 }}
          disabled={index === 0}
          onPress={() => setIndex((i) => Math.max(0, i - 1))}
        />
        {isLast ? (
          <Button
            title="Submit"
            variant="danger"
            style={{ flex: 1 }}
            loading={submitting}
            onPress={confirmSubmit}
          />
        ) : (
          <Button
            title="Next"
            style={{ flex: 1 }}
            onPress={() => setIndex((i) => Math.min(slots.length - 1, i + 1))}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  errorIcon: { fontSize: 44 },
  errorTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginTop: spacing.md,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.card,
  },
  examTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  progressText: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  timer: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryLight,
    minWidth: 74,
    alignItems: 'center',
  },
  timerLow: { backgroundColor: colors.dangerLight },
  timerText: { fontSize: 16, fontWeight: '800', color: colors.primary, fontVariant: ['tabular-nums'] },
  timerTextLow: { color: colors.danger },

  progressBar: { height: 3, backgroundColor: colors.border },
  progressFill: { height: 3, backgroundColor: colors.primary },

  navStrip: { maxHeight: 56, backgroundColor: colors.card },
  navStripInner: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    alignItems: 'center',
  },
  navDot: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
  },
  navDotDone: { backgroundColor: colors.successLight, borderColor: colors.success },
  navDotActive: { borderColor: colors.primary, borderWidth: 2 },
  navDotText: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  navDotTextDone: { color: colors.success },
  navDotTextActive: { color: colors.primary },

  body: { padding: spacing.lg, paddingBottom: spacing.xxl },
  pointsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  points: { fontSize: 12, fontWeight: '700', color: colors.primary },
  qType: { fontSize: 12, color: colors.textLight, textTransform: 'capitalize' },
  questionText: {
    fontSize: 19,
    fontWeight: '600',
    color: colors.text,
    lineHeight: 27,
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },

  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  optionSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  optionLetter: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionLetterSelected: { backgroundColor: colors.primary },
  optionLetterText: { fontSize: 14, fontWeight: '800', color: colors.textMuted },
  optionLetterTextSelected: { color: colors.white },
  optionText: { flex: 1, fontSize: 16, color: colors.text, lineHeight: 22 },
  optionTextSelected: { color: colors.primaryDark, fontWeight: '600' },

  textAnswer: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    fontSize: 16,
    color: colors.text,
  },
  essayAnswer: { minHeight: 180 },

  footer: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
