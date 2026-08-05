import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, ErrorNote, Loading } from '../../components/ui';
import { useDialog } from '../../components/Dialog';
import { attemptsApi, configApi } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import { formatFee, initiatePayment, openCheckout, verifyPayment } from '../../utils/payments';
import { radius, spacing } from '../../theme';
import { useColors } from '../../context/ThemeContext';
import type { Colors } from '../../theme';
import type { AnswerReview, AppConfig, ReviewItem } from '../../api/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'AnswerReview'>;

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * The answer review: every question again, what the student picked, the
 * correct answer and the explanation. Students pay the exam's review fee to
 * open it (teacher exams: the teacher-set fee; past papers: the platform fee).
 */
export default function AnswerReviewScreen({ route }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const dialog = useDialog();
  const { attemptId } = route.params;

  const [data, setData] = useState<AnswerReview | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [paywall, setPaywall] = useState<{ amount: number; currency: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingRef, setPendingRef] = useState<string | null>(null);

  const symbol = config?.currencySymbol || '₦';

  const load = useCallback(async () => {
    setError(null);
    try {
      const [review, cfg] = await Promise.all([
        attemptsApi.review(attemptId),
        configApi.get(),
      ]);
      setConfig(cfg);
      setData(review);
      setPaywall(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) {
        // Not paid yet — show the fee gate.
        const amount = Number((e.data as { amount?: unknown })?.amount);
        setPaywall({
          amount: Number.isFinite(amount) ? amount : 0,
          currency: String((e.data as { currency?: unknown })?.currency || 'NGN'),
        });
        setData(null);
      } else {
        setError(e instanceof Error ? e.message : 'Could not load the answer review.');
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
        setLoading(true);
        void load();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRef]);

  /* ---------------------------------------------------------------- pay */

  const payForReview = async () => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await initiatePayment(data!.exam._id, 'review', attemptId);
      if (outcome.paid) {
        await dialog.notify('Payment successful 🎉', 'The answer review is now unlocked.');
        setLoading(true);
        void load();
        return;
      }
      setPendingRef(outcome.reference);
      await openCheckout(outcome.authorizationUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment could not be started.');
    } finally {
      setBusy(false);
    }
  };

  /* -------------------------------------------------------------- render */

  if (loading) return <Loading text="Loading answer review…" />;

  // Paid gate.
  if (paywall) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.gateWrap}>
          <Card style={styles.gateCard}>
            <Text style={styles.gateIcon}>🔓</Text>
            <Text style={styles.gateTitle}>Unlock the answer review</Text>
            <Text style={styles.gateText}>
              See every question again, what you selected, the correct answers and the
              explanations. This is a one-time payment for this attempt.
            </Text>

            {!!error && <ErrorNote message={error} />}

            {pendingRef ? (
              <>
                <Text style={styles.gatePending}>
                  Payment pending… complete it in the Paystack window, then confirm.
                </Text>
                <Button
                  title="I've paid — confirm"
                  loading={busy}
                  onPress={async () => {
                    const paid = await verifyPayment(pendingRef);
                    if (paid) {
                      setPendingRef(null);
                      await dialog.notify('Payment successful 🎉', 'Review unlocked.');
                      setLoading(true);
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
          </Card>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (error || !data) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.center}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorText}>{error || 'Could not load the answer review.'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const pct = Math.round(data.attempt.percentage || 0);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.summaryRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.examTitle}>{data.exam.title}</Text>
            <Text style={styles.examMeta}>
              Score {data.attempt.score}/{data.attempt.totalPoints} · {pct}%
            </Text>
          </View>
          <View style={[styles.pctPill, { backgroundColor: colors.primaryLight }]}>
            <Text style={styles.pctText}>{pct}%</Text>
          </View>
        </View>

        {data.items.map((item, i) => (
          <ReviewCard key={item.questionId} index={i + 1} item={item} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------- question */

function ReviewCard({ index, item }: { index: number; item: ReviewItem }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const isChoice = item.questionType === 'multiple-choice' || item.questionType === 'true-false';
  const answered = isChoice
    ? item.selectedOption !== null && item.selectedOption !== undefined
    : item.textAnswer.trim() !== '';

  const correct =
    item.isCorrect !== undefined
      ? item.isCorrect
      : isChoice && item.selectedOption === item.correctOptionIndex;

  return (
    <Card style={styles.qCard}>
      <View style={styles.qHeader}>
        <Text style={styles.qNumber}>Q{index}</Text>
        <Text style={styles.qMarks}>
          {item.pointsEarned}/{item.maxPoints} pts
        </Text>
      </View>
      <Text style={styles.qText}>{item.questionText}</Text>

      {isChoice ? (
        item.options.map((opt, oi) => {
          const isCorrectOpt = opt.isCorrect;
          const isPicked = opt.isSelected;
          return (
            <View
              key={oi}
              style={[
                styles.optRow,
                isCorrectOpt && styles.optCorrect,
                isPicked && !isCorrectOpt && styles.optWrong,
              ]}
            >
              <Text
                style={[
                  styles.optLetter,
                  isCorrectOpt && styles.optLetterCorrect,
                  isPicked && !isCorrectOpt && styles.optLetterWrong,
                ]}
              >
                {LETTERS[oi]}
              </Text>
              <Text style={[styles.optText, isCorrectOpt && styles.optTextCorrect]}>{opt.text}</Text>
              <Text style={styles.optMark}>
                {isCorrectOpt ? '✓' : isPicked ? '✗' : ''}
              </Text>
            </View>
          );
        })
      ) : (
        <View style={styles.textBlock}>
          <Text style={styles.answerLabel}>Your answer</Text>
          <Text style={[styles.answerText, correct === false && styles.answerWrong]}>
            {answered ? item.textAnswer : '— No answer —'}
          </Text>
          {!!item.correctAnswer && (
            <>
              <Text style={[styles.answerLabel, { marginTop: spacing.md }]}>Correct answer</Text>
              <Text style={styles.answerText}>{item.correctAnswer}</Text>
            </>
          )}
        </View>
      )}

      {!!item.explanation && (
        <View style={styles.explanation}>
          <Text style={styles.explanationLabel}>💡 Explanation</Text>
          <Text style={styles.explanationText}>{item.explanation}</Text>
        </View>
      )}
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
    errorIcon: { fontSize: 44 },
    errorText: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
      marginTop: spacing.md,
    },

    gateWrap: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg },
    gateCard: { alignItems: 'center', padding: spacing.xxl },
    gateIcon: { fontSize: 48 },
    gateTitle: { fontSize: 19, fontWeight: '800', color: colors.text, marginTop: spacing.md },
    gateText: {
      fontSize: 14,
      color: colors.textMuted,
      lineHeight: 21,
      textAlign: 'center',
      marginTop: spacing.sm,
      marginBottom: spacing.lg,
    },
    gatePending: {
      fontSize: 13,
      color: colors.warning,
      textAlign: 'center',
      marginBottom: spacing.md,
      fontWeight: '600',
    },

    scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
    summaryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      marginBottom: spacing.md,
    },
    examTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
    examMeta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
    pctPill: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill },
    pctText: { fontSize: 16, fontWeight: '800', color: colors.primary },

    qCard: { padding: spacing.lg },
    qHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
    qNumber: { fontSize: 13, fontWeight: '800', color: colors.primary },
    qMarks: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
    qText: { fontSize: 16, fontWeight: '600', color: colors.text, lineHeight: 23 },

    optRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: spacing.md,
      marginTop: spacing.sm,
    },
    optCorrect: { borderColor: colors.success, backgroundColor: colors.successLight },
    optWrong: { borderColor: colors.danger, backgroundColor: colors.dangerLight },
    optLetter: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.bg,
      textAlign: 'center',
      lineHeight: 26,
      fontWeight: '800',
      fontSize: 13,
      color: colors.textMuted,
    },
    optLetterCorrect: { backgroundColor: colors.success, color: colors.white },
    optLetterWrong: { backgroundColor: colors.danger, color: colors.white },
    optText: { flex: 1, fontSize: 14, color: colors.text },
    optTextCorrect: { fontWeight: '700' },
    optMark: { fontSize: 16, fontWeight: '900', color: colors.success },

    textBlock: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: spacing.md,
      marginTop: spacing.sm,
    },
    answerLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
    answerText: { fontSize: 15, color: colors.text, marginTop: 2 },
    answerWrong: { color: colors.danger, fontWeight: '600' },

    explanation: {
      backgroundColor: colors.primaryLight,
      borderRadius: radius.md,
      padding: spacing.md,
      marginTop: spacing.md,
    },
    explanationLabel: { fontSize: 12, fontWeight: '800', color: colors.primary },
    explanationText: { fontSize: 13, color: colors.text, marginTop: 2, lineHeight: 19 },
  });
