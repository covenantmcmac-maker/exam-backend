import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
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
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'TeacherPastQuestions'>;

type TeacherPastExam = Exam & { salesCount: number; totalRevenue: number };

interface PriceState {
  examId: string;
  entryFee: string;
  reviewFee: string;
}

export default function TeacherPastQuestionsScreen({ navigation }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const dialog = useDialog();

  const [items, setItems] = useState<TeacherPastExam[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [priceModal, setPriceModal] = useState<PriceState | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await examsApi.myPast();
      setItems(data as TeacherPastExam[]);
    } catch (e) {
      void dialog.notify('Error', e instanceof Error ? e.message : 'Could not load.');
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

  const confirmUnlist = async (exam: TeacherPastExam) => {
    const ok = await dialog.confirm(
      'Remove from store?',
      `“${exam.title}” will be taken off the Past Questions store. Students who already bought it keep their access.`,
      { confirmLabel: 'Remove', destructive: true }
    );
    if (!ok) return;
    try {
      await examsApi.unlistPast(exam._id);
      await load();
      void dialog.notify('Removed', 'Exam removed from the store.');
    } catch (e) {
      void dialog.notify('Error', e instanceof Error ? e.message : 'Could not remove.');
    }
  };

  const openPrice = (exam: TeacherPastExam) => {
    setPriceModal({
      examId: exam._id,
      entryFee: String(exam.pricing?.entryFee ?? 0),
      reviewFee: String(exam.pricing?.reviewFee ?? 0),
    });
  };

  const savePrice = async () => {
    if (!priceModal) return;
    const entry = Number(priceModal.entryFee);
    const review = Number(priceModal.reviewFee);
    if (isNaN(entry) || entry < 0 || isNaN(review) || review < 0) {
      Alert.alert('Invalid price', 'Prices must be non-negative numbers.');
      return;
    }
    setSaving(true);
    try {
      await examsApi.updatePricing(priceModal.examId, { entryFee: entry, reviewFee: review });
      setPriceModal(null);
      await load();
    } catch (e) {
      void dialog.notify('Error', e instanceof Error ? e.message : 'Could not update price.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading text="Loading your past questions…" />;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <FlatList
        data={items}
        keyExtractor={(i) => i._id}
        contentContainerStyle={items.length === 0 ? styles.emptyWrap : styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={
          <Text style={styles.intro}>
            Exams you've listed for sale. Students buy these via Paystack and get unlimited
            practice.
          </Text>
        }
        ListEmptyComponent={
          <EmptyState
            icon="🛒"
            title="No past questions yet"
            subtitle="Go to “My exams”, open an exam and tap “Sell as Past Q” to list it here."
          />
        }
        renderItem={({ item }) => (
          <Card>
            <View style={styles.rowTop}>
              <Text style={styles.examTitle} numberOfLines={2}>
                {item.title}
              </Text>
              <View style={[styles.pill, { backgroundColor: colors.successLight }]}>
                <Text style={[styles.pillText, { color: colors.success }]}>FOR SALE</Text>
              </View>
            </View>
            {!!item.subject && (
              <Text style={styles.meta}>
                {item.subject}
                {item.year ? ` · ${item.year}` : ''}
              </Text>
            )}
            <Text style={styles.meta}>
              {item.questions?.length ?? 0} questions · {item.settings?.duration ?? 0} min
            </Text>
            <View style={styles.statsRow}>
              <Stat label="Price" value={`₦${Number(item.pricing?.entryFee || 0).toLocaleString()}`} />
              <Stat label="Sales" value={item.salesCount} />
              <Stat label="Revenue" value={`₦${Number(item.totalRevenue || 0).toLocaleString()}`} />
            </View>
            <View style={styles.actions}>
              <Button
                title="View results"
                variant="ghost"
                size="sm"
                style={{ flex: 1 }}
                onPress={() => navigation.navigate('ExamStats', { examId: item._id, title: item.title })}
              />
              <Button
                title="Edit price"
                variant="secondary"
                size="sm"
                style={{ flex: 1 }}
                onPress={() => openPrice(item)}
              />
            </View>
            <View style={styles.actions}>
              <Button
                title="Remove from store"
                variant="danger"
                size="sm"
                style={{ flex: 1 }}
                onPress={() => confirmUnlist(item)}
              />
            </View>
          </Card>
        )}
      />

      <Modal
        visible={!!priceModal}
        animationType="slide"
        transparent
        onRequestClose={() => setPriceModal(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setPriceModal(null)} />
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <Text style={styles.sheetTitle}>Edit price</Text>
          <Text style={styles.fieldLabel}>Entry fee (₦)</Text>
          <TextInput
            style={[
              styles.input,
              { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg },
            ]}
            keyboardType="numeric"
            value={priceModal?.entryFee || ''}
            onChangeText={(t) =>
              setPriceModal((p) => (p ? { ...p, entryFee: t.replace(/[^0-9.]/g, '') } : p))
            }
          />
          <Text style={styles.fieldLabel}>Review fee (₦)</Text>
          <TextInput
            style={[
              styles.input,
              { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg },
            ]}
            keyboardType="numeric"
            value={priceModal?.reviewFee || ''}
            onChangeText={(t) =>
              setPriceModal((p) => (p ? { ...p, reviewFee: t.replace(/[^0-9.]/g, '') } : p))
            }
          />
          <View style={styles.modalActions}>
            <Button
              title="Cancel"
              variant="ghost"
              style={{ flex: 1 }}
              onPress={() => setPriceModal(null)}
            />
            <Button
              title={saving ? 'Saving…' : 'Save'}
              style={{ flex: 1 }}
              onPress={savePrice}
              loading={saving}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  const colors = useColors();
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ fontSize: 11, fontWeight: '800', color: colors.textMuted }}>{label}</Text>
      <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    list: { padding: spacing.lg, paddingBottom: spacing.xxl },
    emptyWrap: { flexGrow: 1 },
    intro: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
    rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
    examTitle: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.text },
    meta: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
    pill: { paddingHorizontal: spacing.md, paddingVertical: 3, borderRadius: radius.pill },
    pillText: { fontSize: 11, fontWeight: '800' },
    statsRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
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
    fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginTop: spacing.sm },
    input: {
      borderWidth: 1,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      fontSize: 16,
    },
    modalActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  });
