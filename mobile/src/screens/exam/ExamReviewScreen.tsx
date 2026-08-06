import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, EmptyState, ErrorNote, Loading } from '../../components/ui';
import { attemptsApi, configApi } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import { useDialog } from '../../components/Dialog';
import { formatFee, initiatePayment, openCheckout, verifyPayment } from '../../utils/payments';
import { radius, spacing } from '../../theme';
import { useColors } from '../../context/ThemeContext';
import type { Colors } from '../../theme';
import type { AppConfig, ExamReview, ReviewQuestion } from '../../api/types';
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
  const dialog = useDialog();
  const { attemptId } = route.params;

  const [review, setReview] = useState<ExamReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Set when the review fee hasn't been paid yet (server returned 402).
  const [paywall, setPaywall] = useState<{ amount: number; examId: string } | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingRef, setPendingRef] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);

  const symbol = config?.currencySymbol || '₦';

  useEffect(() => {
    navigation.setOptions({ title: 'Exam review' });
  }, [navigation]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPaywall(null);
    setPendingRef(null);
    setCheckoutUrl(null);
    try {
      const [data, cfg] = await Promise.all([attemptsApi.review(attemptId), configApi.get()]);
      setConfig(cfg);
      setReview(data);
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) {
        // Review fee not paid yet — show the paywall. The 402 body carries
        // the examId we need to start the payment: the review payload itself
        // is still locked at this point, so it can never come from `review`.
        const data = e.data as { amount?: unknown; examId?: unknown } | undefined;
        const amount = Number(data?.amount);
        const examId =
          typeof data?.examId === 'string' ? data.examId : String(data?.examId ?? '');
        setPaywall({ amount: Number.isFinite(amount) ? amount : 0, examId });
        setReview(null);
      } else {
        setError(e instanceof Error ? e.message : 'Could not load review.');
      }
    } finally {
      setLoading(false);
    }
  }, [attemptId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Confirm an opened Paystack checkout when the screen regains focus.
  useEffect(() => {
    if (!pendingRef) return;
    let cancelled = false;
    (async () => {
      const paid = await verifyPayment(pendingRef);
      if (cancelled) return;
      if (paid) {
        setPendingRef(null);
        await dialog.notify('Payment successful 🎉', 'The answer review is now unlocked.');
        void load();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRef]);

  /* ------------------------------------------------------------- paywall */

  const payForReview = async () => {
    if (!paywall) return;
    setBusy(true);
    setError(null);
    try {
      // The examId comes from the 402 paywall response — `review` is null
      // here by definition, so `review?.exam?._id` can only be a fallback.
      const examId = paywall.examId || review?.exam?._id || '';
      if (!examId) {
        setError('Could not identify the exam for this payment. Please go back and reopen the review.');
        return;
      }
      // The review fee is per attempt, so the payment is tied to this
      // specific attempt record.
      const outcome = await initiatePayment(examId, 'review', attemptId);
      if (outcome.paid) {
        await dialog.notify('Payment successful 🎉', 'The answer review is now unlocked.');
        void load();
        return;
      }
      // Only show the pending state after a real checkout URL has been
      // returned and the browser has been sent to Paystack. openCheckout()
      // throws when Paystack did not provide a URL.
      setCheckoutUrl(outcome.authorizationUrl);
      await openCheckout(outcome.authorizationUrl);
      setPendingRef(outcome.reference);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment could not be started.');
      setPendingRef(null);
      setCheckoutUrl(null);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading text="Loading review…" />;

  // Paid gate: pay the review fee to see the answers.
  if (paywall) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.paywallWrap}>
          <Card style={styles.paywallCard}>
            <Text style={styles.paywallIcon}>🔓</Text>
            <Text style={styles.paywallTitle}>Unlock the answer review</Text>
            <Text style={styles.paywallText}>
              See every question again, what you selected, the correct answers and the
              explanations. This is a one-time payment for this attempt.
            </Text>

            {!!error && <ErrorNote message={error} />}

            {pendingRef ? (
              <>
                <Text style={styles.paywallPending}>
                  Payment pending… if the Paystack page did not open automatically, use the button
                  below to reopen it. After paying, return here and confirm.
                </Text>
                <Button
                  title="Reopen Paystack"
                  variant="ghost"
                  onPress={() => {
                    if (checkoutUrl) void openCheckout(checkoutUrl).catch(() => {});
                  }}
                />
                <Button
                  title="I've paid — confirm"
                  loading={busy}
                  style={{ marginTop: spacing.sm }}
                  onPress={async () => {
                    const paid = await verifyPayment(pendingRef);
                    if (paid) {
                      setPendingRef(null);
                      setCheckoutUrl(null);
                      await dialog.notify('Payment successful 🎉', 'Review unlocked.');
                      void load();
                    } else {
                      await dialog.notify(
                        'Not confirmed yet',
                        "We couldn't find the payment yet. Check the Paystack page, then try again."
                      );
                    }
                  }}
                />
              </>
            ) : (
              <Button
                title={`Pay ${formatFee(paywall.amount, symbol)} & unlock`}
                loading={busy}
                onPress={() => void payForReview()}
              />
            )}

            <Button
              title="Go back"
              variant="ghost"
              style={{ marginTop: spacing.md }}
              onPress={() => navigation.goBack()}
            />
          </Card>
        </View>
      </SafeAreaView>
    );
  }

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
  paywallWrap: { flex: 1, justifyContent: 'center', padding: spacing.lg },
  paywallCard: { alignItems: 'center', padding: spacing.xxl },
  paywallIcon: { fontSize: 48 },
  paywallTitle: { fontSize: 19, fontWeight: '800', color: colors.text, marginTop: spacing.md },
  paywallText: {
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  paywallPending: {
    fontSize: 13,
    color: colors.warning,
    textAlign: 'center',
    marginBottom: spacing.md,
    fontWeight: '600',
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
