import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { Button, Card, EmptyState, Field, Loading } from '../../components/ui';
import { questionsApi } from '../../api/endpoints';
import { useDialog } from '../../components/Dialog';
import { useColors } from '../../context/ThemeContext';
import { difficultyColor, radius, spacing } from '../../theme';
import type { Colors } from '../../theme';
import type { Question } from '../../api/types';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList, TeacherTabParamList } from '../../navigation/types';
import {
  SORT_OPTIONS,
  SORT_SHORT_LABELS,
  SORT_STORAGE_KEY,
  SUBJECT_ORDER_OPTIONS,
  SUBJECT_ORDER_SHORT_LABELS,
  SUBJECT_ORDER_STORAGE_KEY,
  isSortKey,
  isSubjectOrderKey,
  relativeTime,
  summarizeSubjects,
} from './questionSort';
import type { SortKey, SubjectOrderKey } from './questionSort';

type Props = CompositeScreenProps<
  BottomTabScreenProps<TeacherTabParamList, 'Questions'>,
  NativeStackScreenProps<RootStackParamList>
>;

const FILTERS = ['all', 'easy', 'medium', 'hard'] as const;

export default function QuestionBankScreen({ navigation }: Props) {
  const dialog = useDialog();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [subject, setSubject] = useState<string>('all');
  const [selectMode, setSelectMode] = useState(false);
  const [picked, setPicked] = useState<Record<string, true>>({});
  const [sort, setSort] = useState<SortKey>('newest');
  const [subjectOrder, setSubjectOrder] = useState<SubjectOrderKey>('alpha');

  // Restore the persisted sort preferences once, on mount.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      AsyncStorage.getItem(SORT_STORAGE_KEY),
      AsyncStorage.getItem(SUBJECT_ORDER_STORAGE_KEY),
    ])
      .then(([savedSort, savedOrder]) => {
        if (cancelled) return;
        if (isSortKey(savedSort)) setSort(savedSort);
        if (isSubjectOrderKey(savedOrder)) setSubjectOrder(savedOrder);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await questionsApi.list({ sort });
      setQuestions(res.questions);
    } catch (e) {
      void dialog.notify('Error', e instanceof Error ? e.message : 'Could not load questions.');
    } finally {
      setLoading(false);
    }
  }, [dialog, sort]);

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

  /** Distinct subjects among the loaded questions, with counts. */
  const subjects = useMemo(
    () => summarizeSubjects(questions, subjectOrder),
    [questions, subjectOrder]
  );

  // If questions are reloaded and the active subject disappears, fall back to all.
  const effectiveSubject =
    subject === 'all' || subjects.some((s) => s.name === subject) ? subject : 'all';

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return questions.filter((q) => {
      const matchesTerm =
        !term ||
        q.questionText.toLowerCase().includes(term) ||
        (q.subject || '').toLowerCase().includes(term);
      const matchesFilter = filter === 'all' || q.difficulty === filter;
      const matchesSubject =
        effectiveSubject === 'all' || (q.subject || '').trim() === effectiveSubject;
      return matchesTerm && matchesFilter && matchesSubject;
    });
  }, [questions, search, filter, effectiveSubject]);

  /** Open the sort chooser, marking the active option with a check. */
  const chooseSort = async () => {
    const next = await dialog.choose<SortKey>(
      'Sort questions',
      'All orders fall back to upload time.',
      SORT_OPTIONS.map((o) => ({
        label: `${o.key === sort ? '\u2713 ' : ''}${o.label}`,
        value: o.key,
      }))
    );
    if (!next || next === sort) return;
    setSort(next);
    AsyncStorage.setItem(SORT_STORAGE_KEY, next).catch(() => {});
  };

  /** Open the subject-chip ordering chooser. */
  const chooseSubjectOrder = async () => {
    const next = await dialog.choose<SubjectOrderKey>(
      'Order subjects',
      undefined,
      SUBJECT_ORDER_OPTIONS.map((o) => ({
        label: `${o.key === subjectOrder ? '\u2713 ' : ''}${o.label}`,
        value: o.key,
      }))
    );
    if (!next || next === subjectOrder) return;
    setSubjectOrder(next);
    AsyncStorage.setItem(SUBJECT_ORDER_STORAGE_KEY, next).catch(() => {});
  };

  const pickedIds = Object.keys(picked);

  const togglePick = (id: string) => {
    setPicked((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = true;
      return next;
    });
  };

  const exitSelect = () => {
    setSelectMode(false);
    setPicked({});
  };

  const bulkDelete = async () => {
    if (pickedIds.length === 0) return;
    const ok = await dialog.confirm(
      'Delete questions?',
      `${pickedIds.length} question${pickedIds.length === 1 ? '' : 's'} will be permanently removed.`,
      { confirmLabel: 'Delete', destructive: true }
    );
    if (!ok) return;
    try {
      await questionsApi.bulkDelete(pickedIds);
      setQuestions((prev) => prev.filter((q) => !picked[q._id]));
      exitSelect();
    } catch (e) {
      void dialog.notify('Error', e instanceof Error ? e.message : 'Delete failed.');
    }
  };

  const deleteOne = async (q: Question) => {
    const ok = await dialog.confirm('Delete question?', 'This cannot be undone.', {
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await questionsApi.remove(q._id);
      setQuestions((prev) => prev.filter((x) => x._id !== q._id));
    } catch (e) {
      void dialog.notify('Error', e instanceof Error ? e.message : 'Delete failed.');
    }
  };

  if (loading) return <Loading text="Loading question bank…" />;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Questions</Text>
        {selectMode ? (
          <View style={styles.headerActions}>
            <Button title="Cancel" variant="ghost" size="sm" onPress={exitSelect} />
            <Button
              title={`Delete (${pickedIds.length})`}
              variant="danger"
              size="sm"
              disabled={pickedIds.length === 0}
              onPress={bulkDelete}
            />
          </View>
        ) : (
          <View style={styles.headerActions}>
            <Button
              title="Select"
              variant="ghost"
              size="sm"
              onPress={() => setSelectMode(true)}
            />
            <Button
              title="Import"
              variant="ghost"
              size="sm"
              onPress={() => navigation.navigate('BulkImport')}
            />
            <Button
              title="+ New"
              size="sm"
              onPress={() => navigation.navigate('QuestionEditor')}
            />
          </View>
        )}
      </View>

      <View style={styles.controls}>
        <Field
          value={search}
          onChangeText={setSearch}
          placeholder="Search questions…"
          style={styles.search}
        />
        {subjects.length > 0 && (
          <>
            <View style={styles.subjectHeader}>
              <Text style={styles.subjectLabel}>Subjects</Text>
              <Pressable
                onPress={chooseSubjectOrder}
                style={styles.sortPill}
                accessibilityRole="button"
              >
                <Text style={styles.sortPillText}>
                  {SUBJECT_ORDER_SHORT_LABELS[subjectOrder]} ▾
                </Text>
              </Pressable>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.subjectRow}
            >
              <Pressable
                onPress={() => setSubject('all')}
                style={[styles.chip, effectiveSubject === 'all' && styles.chipActive]}
              >
                <Text
                  style={[styles.chipText, effectiveSubject === 'all' && styles.chipTextActive]}
                >
                  all subjects ({questions.length})
                </Text>
              </Pressable>
              {subjects.map((s) => {
                const active = effectiveSubject === s.name;
                return (
                  <Pressable
                    key={s.name}
                    onPress={() => setSubject(s.name)}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {s.name} ({s.count})
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        )}
        <View style={styles.filterRow}>
          {FILTERS.map((f) => {
            const active = filter === f;
            return (
              <Pressable
                key={f}
                onPress={() => setFilter(f)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{f}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.showingRow}>
          <Text style={styles.showing}>
            Showing {visible.length} of {questions.length}
          </Text>
          <Pressable onPress={chooseSort} style={styles.sortPill} accessibilityRole="button">
            <Text style={styles.sortPillText}>Sort: {SORT_SHORT_LABELS[sort]} ▾</Text>
          </Pressable>
        </View>
      </View>

      <FlatList
        data={visible}
        keyExtractor={(q) => q._id}
        contentContainerStyle={visible.length === 0 ? styles.emptyWrap : styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <EmptyState
            icon="❓"
            title={questions.length === 0 ? 'No questions yet' : 'No matches'}
            subtitle={
              questions.length === 0
                ? 'Add questions here, then group them into exams.'
                : 'Try a different search or filter.'
            }
            action={
              questions.length === 0 ? (
                <Button
                  title="Add question"
                  onPress={() => navigation.navigate('QuestionEditor')}
                />
              ) : undefined
            }
          />
        }
        renderItem={({ item }) => {
          const isPicked = !!picked[item._id];
          const uploaded = relativeTime(item.createdAt);
          return (
            <Pressable
              onPress={() =>
                selectMode
                  ? togglePick(item._id)
                  : navigation.navigate('QuestionEditor', { questionId: item._id })
              }
              onLongPress={() => {
                setSelectMode(true);
                togglePick(item._id);
              }}
            >
              <Card style={isPicked ? styles.cardPicked : undefined}>
                <View style={styles.rowTop}>
                  {selectMode && (
                    <View style={[styles.check, isPicked && styles.checkOn]}>
                      {isPicked && <Text style={styles.checkMark}>✓</Text>}
                    </View>
                  )}
                  <Text style={styles.qText}>{item.questionText}</Text>
                </View>

                {item.questionType === 'multiple-choice' ||
                item.questionType === 'true-false' ? (
                  <View style={styles.optionList}>
                    {(item.options || []).map((o, i) => (
                      <Text
                        key={o._id || i}
                        style={[styles.optionText, o.isCorrect && styles.optionCorrect]}
                        numberOfLines={1}
                      >
                        {String.fromCharCode(65 + i)}. {o.text} {o.isCorrect ? '✓' : ''}
                      </Text>
                    ))}
                  </View>
                ) : (
                  !!item.correctAnswer && (
                    <Text style={styles.answerLine}>Answer: {item.correctAnswer}</Text>
                  )
                )}

                <View style={styles.metaRow}>
                  <Text
                    style={[
                      styles.difficulty,
                      { color: difficultyColor[item.difficulty] || colors.textMuted },
                    ]}
                  >
                    {item.difficulty}
                  </Text>
                  <Text style={styles.meta}>· {item.points} pt</Text>
                  <Text style={styles.meta}>· {item.questionType.replace('-', ' ')}</Text>
                  {!!item.subject && <Text style={styles.meta}>· {item.subject}</Text>}
                  {!!uploaded && <Text style={styles.meta}>· {uploaded}</Text>}
                </View>

                {!selectMode && (
                  <View style={styles.cardActions}>
                    <Button
                      title="Edit"
                      variant="ghost"
                      size="sm"
                      style={{ flex: 1 }}
                      onPress={() =>
                        navigation.navigate('QuestionEditor', { questionId: item._id })
                      }
                    />
                    <Button
                      title="Delete"
                      variant="danger"
                      size="sm"
                      style={{ flex: 1 }}
                      onPress={() => deleteOne(item)}
                    />
                  </View>
                )}
              </Card>
            </Pressable>
          );
        }}
      />
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
    },
    headerActions: { flexDirection: 'row', gap: spacing.sm },
    title: { fontSize: 26, fontWeight: '800', color: colors.text },
    controls: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
    search: { marginBottom: 0 },
    subjectRow: { gap: spacing.sm, marginTop: spacing.md },
    filterRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.md },
    showing: { fontSize: 12, color: colors.textMuted },
    showingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.sm,
      gap: spacing.md,
    },
    subjectHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.md,
      gap: spacing.md,
    },
    subjectLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    sortPill: {
      paddingHorizontal: spacing.md,
      paddingVertical: 4,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    sortPillText: { fontSize: 12, color: colors.text, fontWeight: '600' },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { fontSize: 13, color: colors.textMuted, textTransform: 'capitalize', fontWeight: '600' },
    chipTextActive: { color: colors.white },
    list: { padding: spacing.lg, paddingTop: 0, paddingBottom: spacing.xxl },
    emptyWrap: { flexGrow: 1 },
    cardPicked: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
    rowTop: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
    check: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 1.5,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 2,
    },
    checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    checkMark: { color: colors.white, fontSize: 13, fontWeight: '900' },
    qText: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text, lineHeight: 21 },
    optionList: { marginTop: spacing.sm, gap: 2 },
    optionText: { fontSize: 13, color: colors.textMuted },
    optionCorrect: { color: colors.success, fontWeight: '700' },
    answerLine: { fontSize: 13, color: colors.success, fontWeight: '600', marginTop: spacing.sm },
    metaRow: { flexDirection: 'row', gap: 6, marginTop: spacing.md, flexWrap: 'wrap' },
    difficulty: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
    meta: { fontSize: 12, color: colors.textMuted, textTransform: 'capitalize' },
    cardActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  });
