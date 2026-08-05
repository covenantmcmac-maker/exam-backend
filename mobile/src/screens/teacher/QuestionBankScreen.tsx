import React, { useCallback, useMemo, useState } from 'react';
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

type Props = CompositeScreenProps<
  BottomTabScreenProps<TeacherTabParamList, 'Questions'>,
  NativeStackScreenProps<RootStackParamList>
>;

const FILTERS = ['all', 'easy', 'medium', 'hard'] as const;
type BankView = 'active' | 'past';

export default function QuestionBankScreen({ navigation }: Props) {
  const dialog = useDialog();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [view, setView] = useState<BankView>('active');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [subject, setSubject] = useState<string>('all');
  const [selectMode, setSelectMode] = useState(false);
  const [picked, setPicked] = useState<Record<string, true>>({});
  const [actionBusy, setActionBusy] = useState(false);

  // Optional metadata when moving to past
  const [pastYear, setPastYear] = useState<string>(String(new Date().getFullYear()));
  const [pastSession, setPastSession] = useState<string>('');
  const [pastExamType, setPastExamType] = useState<string>('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      if (view === 'active') {
        const res = await questionsApi.list();
        setQuestions(res.questions);
      } else {
        const res = await questionsApi.listPast();
        setQuestions(res.questions);
      }
    } catch (e) {
      void dialog.notify('Error', e instanceof Error ? e.message : 'Could not load questions.');
    } finally {
      setLoading(false);
    }
  }, [view, dialog]);

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
  const subjects = useMemo(() => {
    const counts = new Map<string, number>();
    for (const q of questions) {
      const s = (q.subject || '').trim();
      if (!s) continue;
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }));
  }, [questions]);

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

  const switchView = (next: BankView) => {
    if (next === view) return;
    setView(next);
    exitSelect();
    setSearch('');
    setSubject('all');
    setFilter('all');
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
      setActionBusy(true);
      await questionsApi.bulkDelete(pickedIds);
      setQuestions((prev) => prev.filter((q) => !picked[q._id]));
      exitSelect();
    } catch (e) {
      void dialog.notify('Error', e instanceof Error ? e.message : 'Delete failed.');
    } finally {
      setActionBusy(false);
    }
  };

  const bulkMoveToPast = async () => {
    if (pickedIds.length === 0) return;
    const ok = await dialog.confirm(
      'Move to past questions?',
      `${pickedIds.length} question${pickedIds.length === 1 ? '' : 's'} will be moved to your Past Questions pool. Students will be able to find them in Past Questions. You can restore them any time.`,
      { confirmLabel: `Move to past (${pickedIds.length})` }
    );
    if (!ok) return;
    try {
      setActionBusy(true);
      const meta: any = {};
      if (pastYear.trim()) meta.pastQuestionYear = parseInt(pastYear.trim());
      if (pastSession.trim()) meta.pastQuestionSession = pastSession.trim();
      if (pastExamType.trim()) meta.pastQuestionExamType = pastExamType.trim();

      await questionsApi.bulkMoveToPast(pickedIds, meta);
      // Remove from active view
      setQuestions((prev) => prev.filter((q) => !picked[q._id]));
      exitSelect();
      void dialog.notify('Moved', `${pickedIds.length} question(s) moved to past questions.`);
    } catch (e) {
      void dialog.notify('Error', e instanceof Error ? e.message : 'Move failed.');
    } finally {
      setActionBusy(false);
    }
  };

  const bulkRestore = async () => {
    if (pickedIds.length === 0) return;
    const ok = await dialog.confirm(
      'Restore from past?',
      `${pickedIds.length} question${pickedIds.length === 1 ? '' : 's'} will be restored to your active question bank.`,
      { confirmLabel: `Restore (${pickedIds.length})` }
    );
    if (!ok) return;
    try {
      setActionBusy(true);
      await questionsApi.bulkRestore(pickedIds);
      setQuestions((prev) => prev.filter((q) => !picked[q._id]));
      exitSelect();
      void dialog.notify('Restored', `${pickedIds.length} question(s) restored.`);
    } catch (e) {
      void dialog.notify('Error', e instanceof Error ? e.message : 'Restore failed.');
    } finally {
      setActionBusy(false);
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

  const moveOneToPast = async (q: Question) => {
    const ok = await dialog.confirm(
      'Move to past questions?',
      `"${q.questionText.slice(0, 80)}...\" will be moved to your Past Questions pool.\n\nOptionally set year/session before moving in the bulk bar — or move now with defaults.`,
      { confirmLabel: 'Move to past' }
    );
    if (!ok) return;
    try {
      setActionBusy(true);
      const meta: any = {};
      if (pastYear.trim()) meta.pastQuestionYear = parseInt(pastYear.trim());
      if (pastSession.trim()) meta.pastQuestionSession = pastSession.trim();
      if (pastExamType.trim()) meta.pastQuestionExamType = pastExamType.trim();
      await questionsApi.moveToPast(q._id, meta);
      setQuestions((prev) => prev.filter((x) => x._id !== q._id));
      void dialog.notify('Moved', 'Question moved to past questions.');
    } catch (e) {
      void dialog.notify('Error', e instanceof Error ? e.message : 'Move failed.');
    } finally {
      setActionBusy(false);
    }
  };

  const restoreOne = async (q: Question) => {
    try {
      setActionBusy(true);
      await questionsApi.restore(q._id);
      setQuestions((prev) => prev.filter((x) => x._id !== q._id));
      void dialog.notify('Restored', 'Question restored to active bank.');
    } catch (e) {
      void dialog.notify('Error', e instanceof Error ? e.message : 'Restore failed.');
    } finally {
      setActionBusy(false);
    }
  };

  if (loading) return <Loading text={view === 'past' ? 'Loading past questions…' : 'Loading question bank…'} />;

  const isPastView = view === 'past';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>{isPastView ? 'Past Questions' : 'Questions'}</Text>
        {selectMode ? (
          <View style={styles.headerActions}>
            <Button title="Cancel" variant="ghost" size="sm" onPress={exitSelect} />
            {isPastView ? (
              <>
                <Button
                  title={`Restore (${pickedIds.length})`}
                  size="sm"
                  disabled={pickedIds.length === 0 || actionBusy}
                  onPress={bulkRestore}
                />
                <Button
                  title={`Del (${pickedIds.length})`}
                  variant="danger"
                  size="sm"
                  disabled={pickedIds.length === 0 || actionBusy}
                  onPress={bulkDelete}
                />
              </>
            ) : (
              <>
                <Button
                  title={`To Past (${pickedIds.length})`}
                  size="sm"
                  disabled={pickedIds.length === 0 || actionBusy}
                  onPress={bulkMoveToPast}
                />
                <Button
                  title={`Del (${pickedIds.length})`}
                  variant="danger"
                  size="sm"
                  disabled={pickedIds.length === 0 || actionBusy}
                  onPress={bulkDelete}
                />
              </>
            )}
          </View>
        ) : (
          <View style={styles.headerActions}>
            <Button
              title="Select"
              variant="ghost"
              size="sm"
              onPress={() => setSelectMode(true)}
            />
            {!isPastView && (
              <>
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
              </>
            )}
          </View>
        )}
      </View>

      {/* View Toggle */}
      <View style={styles.viewToggle}>
        <Pressable
          onPress={() => switchView('active')}
          style={[styles.toggleBtn, view === 'active' && styles.toggleBtnActive]}
        >
          <Text style={[styles.toggleText, view === 'active' && styles.toggleTextActive]}>Active Bank</Text>
        </Pressable>
        <Pressable
          onPress={() => switchView('past')}
          style={[styles.toggleBtn, view === 'past' && styles.toggleBtnActive]}
        >
          <Text style={[styles.toggleText, view === 'past' && styles.toggleTextActive]}>My Past Qs</Text>
        </Pressable>
        <Pressable
          onPress={() => navigation.navigate('PastQuestions' as any)}
          style={[styles.toggleBtn, styles.toggleBtnGhost]}
        >
          <Text style={styles.toggleTextGhost}>🌐 Browse All</Text>
        </Pressable>
      </View>

      {/* Move-to-past metadata bar (visible when in active select mode or past view?) */}
      {view === 'active' && (
        <View style={styles.metaBar}>
          <Text style={styles.metaBarTitle}>When moving to past, optionally tag:</Text>
          <View style={styles.metaInputs}>
            <View style={{ flex: 1 }}>
              <Field
                label="Year"
                value={pastYear}
                onChangeText={setPastYear}
                placeholder={`${new Date().getFullYear()}`}
                keyboardType="number-pad"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Session"
                value={pastSession}
                onChangeText={setPastSession}
                placeholder="June"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Exam Type"
                value={pastExamType}
                onChangeText={setPastExamType}
                placeholder="Final"
              />
            </View>
          </View>
        </View>
      )}

      <View style={styles.controls}>
        <Field
          value={search}
          onChangeText={setSearch}
          placeholder={isPastView ? 'Search past questions…' : 'Search questions…'}
          style={styles.search}
        />
        {subjects.length > 0 && (
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
        <Text style={styles.showing}>
          Showing {visible.length} of {questions.length} {isPastView ? 'past' : ''} questions
        </Text>
      </View>

      <FlatList
        data={visible}
        keyExtractor={(q) => q._id}
        contentContainerStyle={visible.length === 0 ? styles.emptyWrap : styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <EmptyState
            icon={isPastView ? '📚' : '❓'}
            title={
              questions.length === 0
                ? isPastView
                  ? 'No past questions yet'
                  : 'No questions yet'
                : 'No matches'
            }
            subtitle={
              questions.length === 0
                ? isPastView
                  ? 'Move questions from your active bank to Past Questions to archive them for future reuse.'
                  : 'Add questions here, then group them into exams.'
                : 'Try a different search or filter.'
            }
            action={
              questions.length === 0 && !isPastView ? (
                <Button
                  title="Add question"
                  onPress={() => navigation.navigate('QuestionEditor')}
                />
              ) : questions.length === 0 && isPastView ? (
                <Button title="Go to Active Bank" onPress={() => switchView('active')} />
              ) : undefined
            }
          />
        }
        renderItem={({ item }) => {
          const isPicked = !!picked[item._id];
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
              <Card style={[isPicked && styles.cardPicked, item.isPastQuestion && styles.cardPast].filter(Boolean) as any}>
                <View style={styles.rowTop}>
                  {selectMode && (
                    <View style={[styles.check, isPicked && styles.checkOn]}>
                      {isPicked && <Text style={styles.checkMark}>✓</Text>}
                    </View>
                  )}
                  <Text style={styles.qText}>{item.questionText}</Text>
                </View>

                {item.isPastQuestion && (
                  <View style={styles.pastBadgeRow}>
                    <View style={styles.pastBadge}>
                      <Text style={styles.pastBadgeText}>📚 PAST QUESTION</Text>
                    </View>
                    {(item.pastQuestionYear || item.pastQuestionSession || item.pastQuestionExamType) && (
                      <Text style={styles.pastMetaText}>
                        {[item.pastQuestionYear, item.pastQuestionSession, item.pastQuestionExamType].filter(Boolean).join(' • ')}
                      </Text>
                    )}
                  </View>
                )}

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
                  {!!item.movedToPastAt && (
                    <Text style={styles.meta}>
                      · moved {new Date(item.movedToPastAt).toLocaleDateString()}
                    </Text>
                  )}
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
                    {isPastView ? (
                      <>
                        <Button
                          title="Restore"
                          variant="secondary"
                          size="sm"
                          style={{ flex: 1 }}
                          disabled={actionBusy}
                          onPress={() => restoreOne(item)}
                        />
                        <Button
                          title="Delete"
                          variant="danger"
                          size="sm"
                          style={{ flex: 1 }}
                          onPress={() => deleteOne(item)}
                        />
                      </>
                    ) : (
                      <>
                        <Button
                          title="To Past"
                          variant="secondary"
                          size="sm"
                          style={{ flex: 1 }}
                          disabled={actionBusy}
                          onPress={() => moveOneToPast(item)}
                        />
                        <Button
                          title="Delete"
                          variant="danger"
                          size="sm"
                          style={{ flex: 1 }}
                          onPress={() => deleteOne(item)}
                        />
                      </>
                    )}
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
      gap: spacing.md,
    },
    headerActions: { flexDirection: 'row', gap: spacing.sm, flexShrink: 0, flexWrap: 'wrap' },
    title: { fontSize: 24, fontWeight: '800', color: colors.text, flexShrink: 1 },
    viewToggle: {
      flexDirection: 'row',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      marginTop: spacing.md,
    },
    toggleBtn: {
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    toggleBtnActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    toggleBtnGhost: {
      backgroundColor: colors.bg,
      borderStyle: 'dashed',
    },
    toggleText: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
    toggleTextActive: { color: colors.white },
    toggleTextGhost: { fontSize: 13, fontWeight: '700', color: colors.primary },
    metaBar: {
      marginHorizontal: spacing.lg,
      marginTop: spacing.md,
      padding: spacing.md,
      backgroundColor: colors.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    metaBarTitle: { fontSize: 12, fontWeight: '600', color: colors.textMuted, marginBottom: spacing.sm },
    metaInputs: { flexDirection: 'row', gap: spacing.md },
    controls: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
    search: { marginBottom: 0 },
    subjectRow: { gap: spacing.sm, marginTop: spacing.md },
    filterRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.md },
    showing: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm },
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
    cardPast: { borderLeftWidth: 4, borderLeftColor: colors.warning },
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
    pastBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' },
    pastBadge: { backgroundColor: colors.warningLight || '#FFF3CD', paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
    pastBadgeText: { fontSize: 10, fontWeight: '800', color: colors.warning || '#856404', letterSpacing: 0.5 },
    pastMetaText: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
    optionList: { marginTop: spacing.sm, gap: 2 },
    optionText: { fontSize: 13, color: colors.textMuted },
    optionCorrect: { color: colors.success, fontWeight: '700' },
    answerLine: { fontSize: 13, color: colors.success, fontWeight: '600', marginTop: spacing.sm },
    metaRow: { flexDirection: 'row', gap: 6, marginTop: spacing.md, flexWrap: 'wrap' },
    difficulty: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
    meta: { fontSize: 12, color: colors.textMuted, textTransform: 'capitalize' },
    cardActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  });
