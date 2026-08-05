import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Button, Card, EmptyState, ErrorNote, Field, Loading } from '../../components/ui';
import { useDialog } from '../../components/Dialog';
import { configApi, examsApi } from '../../api/endpoints';
import { formatFee, initiatePayment, openCheckout, verifyPayment } from '../../utils/payments';
import { radius, spacing } from '../../theme';
import { useColors } from '../../context/ThemeContext';
import type { Colors } from '../../theme';
import type { AppConfig, PastExam } from '../../api/types';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList, StudentTabParamList } from '../../navigation/types';

type Props = CompositeScreenProps<
  BottomTabScreenProps<StudentTabParamList, 'PastQuestions'>,
  NativeStackScreenProps<RootStackParamList>
>;

/**
 * The paid past-questions library.
 *
 * Platform-owned papers organised by subject and year ("Biology 2022").
 * Two fees per paper: entry (pay to take) and review (pay to see the
 * answers afterwards). The Start button stays locked until entry is paid.
 */
export default function PastQuestionsScreen({ navigation }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const dialog = useDialog();

  const [config, setConfig] = useState<AppConfig | null>(null);
  const [exams, setExams] = useState<PastExam[]>([]);
  const [subject, setSubject] = useState('All');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingRef, setPendingRef] = useState<string | null>(null);

  const symbol = config?.currencySymbol || '₦';

  const load = useCallback(async () => {
    try {
      setError(null);
      const [cfg, data] = await Promise.all([configApi.get(), examsApi.past()]);
      setConfig(cfg);
      setExams(data.exams);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load past question papers.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load])
  );

  // If a Paystack checkout was opened for this screen, confirm the payment
  // whenever the screen regains focus (tab switch / app foreground).
  useEffect(() => {
    if (!pendingRef) return;
    let cancelled = false;
    (async () => {
      const paid = await verifyPayment(pendingRef);
      if (cancelled) return;
      if (paid) {
        setPendingRef(null);
        await dialog.notify(
          'Payment successful 🎉',
          'Your payment was confirmed. You can now start the exam.'
        );
        void load();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRef]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  /* ------------------------------------------------------------- payment */

  const payForEntry = async (exam: PastExam) => {
    setBusyId(exam._id);
    setError(null);
    try {
      const outcome = await initiatePayment(exam._id, 'entry');
      if (outcome.paid) {
        await dialog.notify(
          'Payment successful 🎉',
          'Entry unlocked. Good luck with the paper!'
        );
        void load();
        return;
      }
      // Real Paystack checkout: open it and wait for confirmation.
      setPendingRef(outcome.reference);
      await openCheckout(outcome.authorizationUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment could not be started.');
    } finally {
      setBusyId(null);
    }
  };

  /* --------------------------------------------------------------- action */

  const startOrResume = (exam: PastExam) => {
    if (!exam.startable) return;
    navigation.navigate('ExamTaking', { examId: exam._id });
  };

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return exams.filter((e) => {
      if (subject !== 'All' && e.subject !== subject) return false;
      if (!term) return true;
      return (
        e.title.toLowerCase().includes(term) ||
        (e.subject || '').toLowerCase().includes(term) ||
        String(e.year || '').includes(term)
      );
    });
  }, [exams, subject, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, PastExam[]>();
    filtered.forEach((e) => {
      const key = e.subject || 'General';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const subjects = useMemo(() => {
    const set = new Set(exams.map((e) => e.subject || 'General'));
    return ['All', ...Array.from(set).sort()];
  }, [exams]);

  if (loading) return <Loading text="Loading past questions…" />;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Past questions</Text>
        <Text style={styles.subtitle}>
          Previous-years exam papers. Pay once to take, pay once more to review your answers.
        </Text>
      </View>

      <View style={styles.controls}>
        <Field
          value={search}
          onChangeText={setSearch}
          placeholder="Search subject or year…"
          style={styles.search}
        />
        <FlatList
          horizontal
          data={subjects}
          keyExtractor={(s) => s}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          renderItem={({ item }) => {
            const active = subject === item;
            return (
              <Pressable
                onPress={() => setSubject(item)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{item}</Text>
              </Pressable>
            );
          }}
        />
      </View>

      {!!error && <ErrorNote message={error} />}

      {pendingRef && (
        <Card style={styles.pendingCard}>
          <Text style={styles.pendingTitle}>⏳ Payment pending</Text>
          <Text style={styles.pendingText}>
            Complete the payment in the Paystack window, then confirm here.
          </Text>
          <View style={styles.pendingActions}>
            <Button
              title="I've paid — confirm"
              size="sm"
              style={{ flex: 1 }}
              onPress={async () => {
                const paid = await verifyPayment(pendingRef);
                if (paid) {
                  setPendingRef(null);
                  await dialog.notify('Payment successful 🎉', 'Entry unlocked.');
                  void load();
                } else {
                  await dialog.notify(
                    'Not confirmed yet',
                    "We couldn't find the payment yet. Check the Paystack page, then try again."
                  );
                }
              }}
            />
            <Button
              title="Cancel"
              variant="ghost"
              size="sm"
              onPress={() => setPendingRef(null)}
            />
          </View>
        </Card>
      )}

      <FlatList
        data={grouped}
        keyExtractor={([s]) => s}
        contentContainerStyle={exams.length === 0 ? styles.emptyWrap : styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <EmptyState
            icon="📚"
            title={error ? 'Something went wrong' : 'No papers yet'}
            subtitle={
              error ||
              'Past question papers will appear here once the platform publishes them.'
            }
            action={
              !error ? (
                <Button title="Refresh" variant="secondary" onPress={() => void load()} />
              ) : undefined
            }
          />
        }
        renderItem={({ item: [groupName, groupExams] }) => (
          <View style={styles.group}>
            <Text style={styles.groupTitle}>{groupName}</Text>
            {groupExams.map((exam) => (
              <ExamCard
                key={exam._id}
                exam={exam}
                symbol={symbol}
                busy={busyId === exam._id}
                onPay={() => void payForEntry(exam)}
                onStart={() => startOrResume(exam)}
              />
            ))}
          </View>
        )}
      />
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------ card */

function ExamCard({
  exam,
  symbol,
  busy,
  onPay,
  onStart,
}: {
  exam: PastExam;
  symbol: string;
  busy: boolean;
  onPay: () => void;
  onStart: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const fee = exam.pricing?.entryFee || 0;
  const reviewFee = exam.pricing?.reviewFee || 0;
  const locked = !exam.purchasedEntry;
  const unlimited = !!exam.unlimited;
  const usedUp = !unlimited && exam.attemptsLeft <= 0;

  return (
    <Card style={styles.examCard}>
      <View style={styles.examTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.examTitle} numberOfLines={1}>
            {exam.title}
          </Text>
          <Text style={styles.examMeta}>
            {exam.questionCount} questions · {exam.settings.duration} min ·{' '}
            {exam.settings.totalMarks} marks
          </Text>
        </View>
        {!!exam.year && (
          <View style={styles.yearBadge}>
            <Text style={styles.yearText}>{exam.year}</Text>
          </View>
        )}
      </View>

      <View style={styles.feeRow}>
        <Text style={styles.fee}>
          Entry {formatFee(fee, symbol)}
          {reviewFee > 0 && (
            <Text style={styles.feeReview}> · Review {formatFee(reviewFee, symbol)}</Text>
          )}
        </Text>
        {exam.inProgressAttempt && (
          <Text style={styles.resumeNote}>● In progress — tap to resume</Text>
        )}
      </View>

      {locked ? (
        <Button
          title={busy ? 'Processing…' : `🔒 Pay ${formatFee(fee, symbol)} & take`}
          onPress={onPay}
          loading={busy}
          disabled={fee <= 0}
        />
      ) : usedUp ? (
        <Button title="Attempts used up" disabled />
      ) : (
        <Button
          title={exam.inProgressAttempt ? 'Resume exam' : 'Start exam'}
          onPress={onStart}
        />
      )}

      {locked && (
        <Text style={styles.lockedHint}>
          The Start button unlocks once your entry fee is paid.
        </Text>
      )}
      {!locked && usedUp && (
        <Text style={styles.lockedHint}>
          You've used all {exam.maxAttempts} attempt{exam.maxAttempts === 1 ? '' : 's'} for this
          paper.
        </Text>
      )}
      {!locked && unlimited && (
        <Text style={styles.lockedHint}>Unlimited practice attempts after purchase.</Text>
      )}
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
    title: { fontSize: 26, fontWeight: '800', color: colors.text },
    subtitle: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
    controls: { paddingTop: spacing.md },
    search: { marginHorizontal: spacing.lg, marginBottom: 0 },
    chips: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm },
    chip: {
      paddingHorizontal: spacing.lg,
      paddingVertical: 7,
      borderRadius: radius.pill,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
    chipTextActive: { color: colors.white },

    pendingCard: {
      marginHorizontal: spacing.lg,
      borderColor: colors.warning,
      backgroundColor: colors.warningLight,
    },
    pendingTitle: { fontSize: 15, fontWeight: '800', color: colors.warning },
    pendingText: { fontSize: 13, color: colors.textMuted, marginTop: 2, lineHeight: 19 },
    pendingActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },

    list: { padding: spacing.lg, paddingBottom: spacing.xxl },
    emptyWrap: { flexGrow: 1 },
    group: { marginBottom: spacing.lg },
    groupTitle: {
      fontSize: 16,
      fontWeight: '800',
      color: colors.primary,
      marginBottom: spacing.sm,
      textTransform: 'capitalize',
    },

    examCard: { padding: spacing.lg },
    examTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
    examTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
    examMeta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
    yearBadge: {
      backgroundColor: colors.primaryLight,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: 5,
    },
    yearText: { fontSize: 13, fontWeight: '800', color: colors.primary },
    feeRow: { marginVertical: spacing.md },
    fee: { fontSize: 14, fontWeight: '700', color: colors.text },
    feeReview: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
    resumeNote: { fontSize: 12, color: colors.warning, marginTop: 4, fontWeight: '600' },
    lockedHint: {
      fontSize: 12,
      color: colors.textLight,
      textAlign: 'center',
      marginTop: spacing.sm,
    },
  });
