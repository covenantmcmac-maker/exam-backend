import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Button, Card, EmptyState, Loading } from '../../components/ui';
import { examsApi } from '../../api/endpoints';
import { useDialog } from '../../components/Dialog';
import { radius, spacing } from '../../theme';
import { useColors } from '../../context/ThemeContext';
import type { Colors } from '../../theme';
import type { Exam } from '../../api/types';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList, TeacherTabParamList } from '../../navigation/types';

type Props = CompositeScreenProps<
  BottomTabScreenProps<TeacherTabParamList, 'Exams'>,
  NativeStackScreenProps<RootStackParamList>
>;

interface SellState {
  examId: string;
  title: string;
  entryFee: string;
  reviewFee: string;
  year: string;
}

export default function TeacherExamsScreen({ navigation }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const dialog = useDialog();
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [sell, setSell] = useState<SellState | null>(null);
  const [selling, setSelling] = useState(false);

  const load = useCallback(async () => {
    try {
      setExams(await examsApi.myExams());
    } catch (e) {
      void dialog.notify('Error', e instanceof Error ? e.message : 'Could not load exams.');
    } finally {
      setLoading(false);
    }
  }, [dialog]);

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

  const togglePublish = async (exam: Exam) => {
    const next = !exam.settings?.isPublished;
    try {
      await examsApi.publish(exam._id, next);
      setExams((prev) =>
        prev.map((e) =>
          e._id === exam._id ? { ...e, settings: { ...e.settings, isPublished: next } } : e
        )
      );
    } catch (e) {
      void dialog.notify('Error', e instanceof Error ? e.message : 'Could not update exam.');
    }
  };

  const confirmDelete = async (exam: Exam) => {
    const ok = await dialog.confirm(
      'Delete exam?',
      `“${exam.title}” and all of its attempts will be permanently removed.`,
      { confirmLabel: 'Delete', destructive: true }
    );
    if (!ok) return;
    try {
      await examsApi.remove(exam._id);
      setExams((prev) => prev.filter((e) => e._id !== exam._id));
    } catch (e) {
      void dialog.notify('Error', e instanceof Error ? e.message : 'Delete failed.');
    }
  };

  const shareCode = async (exam: Exam) => {
    if (!exam.accessCode) return;
    try {
      await Share.share({
        message: `Join my exam “${exam.title}” with access code: ${exam.accessCode}`,
      });
    } catch {
      /* user dismissed */
    }
  };

  const openSell = (exam: Exam) => {
    if ((exam.questions?.length ?? 0) === 0) {
      void dialog.notify(
        'Add questions first',
        'Add at least one question to the exam before listing it for sale.'
      );
      return;
    }
    setSell({
      examId: exam._id,
      title: exam.title,
      entryFee: '300',
      reviewFee: '0',
      year: exam.year ? String(exam.year) : new Date().getFullYear().toString(),
    });
  };

  const submitSell = async () => {
    if (!sell) return;
    const entry = Number(sell.entryFee);
    if (!sell.entryFee || isNaN(entry) || entry < 0) {
      Alert.alert('Invalid price', 'Enter a valid price in Naira (≥ 0).');
      return;
    }
    const review = sell.reviewFee === '' ? 0 : Number(sell.reviewFee);
    if (isNaN(review) || review < 0) {
      Alert.alert('Invalid review fee', 'Enter a valid review fee in Naira.');
      return;
    }
    setSelling(true);
    try {
      await examsApi.sellAsPast(sell.examId, {
        entryFee: entry,
        reviewFee: review,
        year: sell.year ? Number(sell.year) : undefined,
      });
      setSell(null);
      await load();
      void dialog.notify(
        'Listed for sale 🎉',
        'Your exam is now in the Past Questions store. Students can buy it with Paystack and re-practice unlimited times.'
      );
    } catch (e) {
      void dialog.notify('Error', e instanceof Error ? e.message : 'Could not list exam.');
    } finally {
      setSelling(false);
    }
  };

  if (loading) return <Loading text="Loading exams…" />;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>My exams</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button
            title="🛒 My Past Qs"
            size="sm"
            variant="secondary"
            onPress={() => navigation.navigate('TeacherPastQuestions')}
          />
          <Button title="+ New" size="sm" onPress={() => navigation.navigate('ExamBuilder')} />
        </View>
      </View>

      <FlatList
        data={exams}
        keyExtractor={(e) => e._id}
        contentContainerStyle={exams.length === 0 ? styles.emptyWrap : styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <EmptyState
            icon="📝"
            title="No exams yet"
            subtitle="Create an exam, add questions, share the access code with students, and when you're done, tap “Sell as Past Q” to list it for sale."
            action={
              <Button title="Create exam" onPress={() => navigation.navigate('ExamBuilder')} />
            }
          />
        }
        renderItem={({ item }) => {
          const live = !!item.settings?.isPublished;
          return (
            <Card>
              <View style={styles.rowTop}>
                <Text style={styles.examTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                <View
                  style={[
                    styles.pill,
                    { backgroundColor: live ? colors.successLight : colors.warningLight },
                  ]}
                >
                  <Text
                    style={[styles.pillText, { color: live ? colors.success : colors.warning }]}
                  >
                    {live ? 'Live' : 'Draft'}
                  </Text>
                </View>
              </View>

              {!!item.subject && <Text style={styles.subject}>{item.subject}</Text>}

              <Text style={styles.meta}>
                {item.questions?.length ?? 0} questions · {item.settings?.duration ?? 0} min ·{' '}
                {item.settings?.totalMarks ?? 0} marks
              </Text>

              {!!item.accessCode && (
                <Pressable onPress={() => shareCode(item)} style={styles.codeBox}>
                  <Text style={styles.codeLabel}>ACCESS CODE</Text>
                  <Text style={styles.code}>{item.accessCode}</Text>
                  <Text style={styles.codeHint}>Tap to share</Text>
                </Pressable>
              )}

              <View style={styles.actions}>
                <Button
                  title={live ? 'Unpublish' : 'Publish'}
                  variant={live ? 'ghost' : 'primary'}
                  size="sm"
                  style={{ flex: 1 }}
                  onPress={() => togglePublish(item)}
                />
                <Button
                  title="Results"
                  variant="secondary"
                  size="sm"
                  style={{ flex: 1 }}
                  onPress={() =>
                    navigation.navigate('ExamStats', { examId: item._id, title: item.title })
                  }
                />
              </View>
              <View style={styles.actions}>
                <Button
                  title="Edit"
                  variant="ghost"
                  size="sm"
                  style={{ flex: 1 }}
                  onPress={() => navigation.navigate('ExamBuilder', { examId: item._id })}
                />
                <Button
                  title="💰 Sell as Past Q"
                  variant="secondary"
                  size="sm"
                  style={{ flex: 1 }}
                  onPress={() => openSell(item)}
                />
              </View>
              <View style={styles.actions}>
                <Button
                  title="Delete"
                  variant="danger"
                  size="sm"
                  style={{ flex: 1 }}
                  onPress={() => confirmDelete(item)}
                />
              </View>
            </Card>
          );
        }}
      />

      {/* Price modal */}
      <Modal
        visible={!!sell}
        animationType="slide"
        transparent
        onRequestClose={() => setSell(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setSell(null)} />
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <Text style={styles.sheetTitle}>Sell as Past Question</Text>
          <Text style={[styles.sheetSub, { color: colors.textMuted }]}>{sell?.title}</Text>

          <Text style={styles.fieldLabel}>Entry price (₦) — what students pay to practice</Text>
          <TextInput
            style={[
              styles.input,
              { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg },
            ]}
            placeholder="e.g. 300"
            placeholderTextColor={colors.textMuted}
            keyboardType="numeric"
            value={sell?.entryFee || ''}
            onChangeText={(t) =>
              setSell((s) => (s ? { ...s, entryFee: t.replace(/[^0-9.]/g, '') } : s))
            }
          />

          <Text style={styles.fieldLabel}>
            Review fee (₦) — 0 = answers included after taking
          </Text>
          <TextInput
            style={[
              styles.input,
              { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg },
            ]}
            placeholder="0"
            placeholderTextColor={colors.textMuted}
            keyboardType="numeric"
            value={sell?.reviewFee || ''}
            onChangeText={(t) =>
              setSell((s) => (s ? { ...s, reviewFee: t.replace(/[^0-9.]/g, '') } : s))
            }
          />

          <Text style={styles.fieldLabel}>Year (optional)</Text>
          <TextInput
            style={[
              styles.input,
              { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg },
            ]}
            placeholder="e.g. 2024"
            placeholderTextColor={colors.textMuted}
            keyboardType="numeric"
            value={sell?.year || ''}
            onChangeText={(t) =>
              setSell((s) => (s ? { ...s, year: t.replace(/[^0-9]/g, '') } : s))
            }
          />

          <Text style={[styles.disclaimer, { color: colors.textMuted }]}>
            ⚠️ This unpublishes the live exam and rotates the access code so students can't
            enter for free. Buyers get unlimited practice attempts.
          </Text>

          <View style={styles.modalActions}>
            <Button title="Cancel" variant="ghost" style={{ flex: 1 }} onPress={() => setSell(null)} />
            <Button
              title={selling ? 'Listing…' : 'List for sale'}
              style={{ flex: 1 }}
              onPress={submitSell}
              loading={selling}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
    },
    title: { fontSize: 26, fontWeight: '800', color: colors.text },
    list: { padding: spacing.lg, paddingTop: 0, paddingBottom: spacing.xxl },
    emptyWrap: { flexGrow: 1 },
    rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
    examTitle: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.text },
    subject: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
    meta: { fontSize: 13, color: colors.textMuted, marginTop: spacing.sm },
    pill: { paddingHorizontal: spacing.md, paddingVertical: 3, borderRadius: radius.pill },
    pillText: { fontSize: 11, fontWeight: '800' },
    codeBox: {
      backgroundColor: colors.primaryLight,
      borderRadius: radius.md,
      padding: spacing.md,
      marginTop: spacing.md,
      alignItems: 'center',
    },
    codeLabel: { fontSize: 10, fontWeight: '800', color: colors.primary, letterSpacing: 1 },
    code: {
      fontSize: 22,
      fontWeight: '900',
      color: colors.primaryDark,
      letterSpacing: 3,
      marginTop: 2,
    },
    codeHint: { fontSize: 11, color: colors.primary, marginTop: 2 },
    actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
    // Modal
    backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: spacing.xl,
      paddingBottom: spacing.xxl,
      gap: spacing.sm,
    },
    sheetTitle: { fontSize: 20, fontWeight: '800', color: colors.text },
    sheetSub: { fontSize: 14, marginBottom: spacing.md },
    fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginTop: spacing.sm },
    input: {
      borderWidth: 1,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      fontSize: 16,
    },
    disclaimer: { fontSize: 12, marginTop: spacing.sm, lineHeight: 18 },
    modalActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  });
