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
import { Button, Card, EmptyState, Field, Loading } from '../components/ui';
import { questionsApi } from '../api/endpoints';
import { useDialog } from '../components/Dialog';
import { useColors } from '../context/ThemeContext';
import { difficultyColor, radius, spacing } from '../theme';
import type { Colors } from '../theme';
import type { Question } from '../api/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useAuth } from '../context/AuthContext';

type Props = NativeStackScreenProps<RootStackParamList, 'PastQuestions'>;

const FILTERS = ['all', 'easy', 'medium', 'hard'] as const;

export default function PastQuestionsScreen({ navigation }: Props) {
  const dialog = useDialog();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();

  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [subject, setSubject] = useState<string>('all');
  const [year, setYear] = useState<string>('all');
  const [showAnswerFor, setShowAnswerFor] = useState<Record<string, boolean>>({});

  const isTeacher = user?.role === 'teacher' || user?.role === 'admin';

  const load = useCallback(async () => {
    try {
      const params: any = {};
      if (search.trim()) params.search = search.trim();
      const res = await questionsApi.listPastQuestionsPool(params);
      setQuestions(res.questions);
    } catch (e) {
      void dialog.notify('Error', e instanceof Error ? e.message : 'Could not load past questions.');
    } finally {
      setLoading(false);
    }
  }, [dialog, search]);

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

  const years = useMemo(() => {
    const set = new Set<number>();
    for (const q of questions) {
      if (q.pastQuestionYear) set.add(q.pastQuestionYear);
    }
    return Array.from(set).sort((a, b) => b - a);
  }, [questions]);

  const effectiveSubject =
    subject === 'all' || subjects.some((s) => s.name === subject) ? subject : 'all';
  const effectiveYear = year === 'all' || years.some((y) => String(y) === year) ? year : 'all';

  const visible = useMemo(() => {
    return questions.filter((q) => {
      const matchesFilter = filter === 'all' || q.difficulty === filter;
      const matchesSubject = effectiveSubject === 'all' || (q.subject || '').trim() === effectiveSubject;
      const matchesYear = effectiveYear === 'all' || String(q.pastQuestionYear || '') === effectiveYear;
      return matchesFilter && matchesSubject && matchesYear;
    });
  }, [questions, filter, effectiveSubject, effectiveYear]);

  const toggleAnswer = (id: string) => {
    setShowAnswerFor((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  if (loading) return <Loading text="Loading past questions…" />;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Past Questions</Text>
          <Text style={styles.subtitle}>Archived questions from previous exams</Text>
        </View>
        <View style={{ gap: spacing.sm }}>
          <Button title="🎯 Practice Test" size="sm" onPress={() => navigation.navigate('PracticeSetup')} />
          <Button title="Close" variant="ghost" size="sm" onPress={() => navigation.goBack()} />
        </View>
      </View>

      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
        <Card style={{ backgroundColor: colors.primaryLight, borderColor: colors.primary, borderWidth: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>🎯 Practice Mode</Text>
          <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 4, marginBottom: spacing.md, lineHeight: 16 }}>
            Generate a random mock exam from past questions and test yourself. Instant grading & explanations.
          </Text>
          <Button title="Start Practice →" size="sm" onPress={() => navigation.navigate('PracticeSetup')} />
        </Card>
      </View>

      <View style={styles.controls}>
        <Field
          value={search}
          onChangeText={setSearch}
          placeholder="Search past questions, subjects…"
          style={styles.search}
        />
        {subjects.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            <Pressable
              onPress={() => setSubject('all')}
              style={[styles.chip, effectiveSubject === 'all' && styles.chipActive]}
            >
              <Text style={[styles.chipText, effectiveSubject === 'all' && styles.chipTextActive]}>
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

        {years.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            <Pressable
              onPress={() => setYear('all')}
              style={[styles.chip, effectiveYear === 'all' && styles.chipActive]}
            >
              <Text style={[styles.chipText, effectiveYear === 'all' && styles.chipTextActive]}>all years</Text>
            </Pressable>
            {years.map((y) => {
              const active = effectiveYear === String(y);
              return (
                <Pressable
                  key={y}
                  onPress={() => setYear(String(y))}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{y}</Text>
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

        <View style={styles.actionRow}>
          <Text style={styles.showing}>Showing {visible.length} of {questions.length}</Text>
          <Pressable onPress={load}>
            <Text style={styles.link}>Refresh</Text>
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
            icon="📚"
            title={questions.length === 0 ? 'No past questions yet' : 'No matches'}
            subtitle={
              questions.length === 0
                ? 'Teachers can move questions to Past Questions from their Question Bank. They will appear here for everyone to practice.'
                : 'Try a different search or filter.'
            }
          />
        }
        renderItem={({ item }) => {
          const showAns = !!showAnswerFor[item._id];
          const creatorName = typeof item.creator === 'object' ? (item.creator as any)?.name : null;
          const originalName = typeof item.originalCreator === 'object' ? (item.originalCreator as any)?.name : null;
          return (
            <Card>
              <View style={styles.qTop}>
                <View style={styles.pastBadge}>
                  <Text style={styles.pastBadgeText}>📚 PAST</Text>
                </View>
                {(item.pastQuestionYear || item.pastQuestionSession || item.pastQuestionExamType) && (
                  <Text style={styles.pastMeta}>
                    {[item.pastQuestionYear, item.pastQuestionSession, item.pastQuestionExamType]
                      .filter(Boolean)
                      .join(' • ')}
                  </Text>
                )}
              </View>

              <Text style={styles.qText}>{item.questionText}</Text>

              <View style={styles.optionList}>
                {(item.options || []).map((o, i) => (
                  <View
                    key={o._id || i}
                    style={[
                      styles.optionRow,
                      showAns && o.isCorrect && styles.optionRowCorrect,
                    ]}
                  >
                    <Text
                      style={[
                        styles.optionText,
                        showAns && o.isCorrect && styles.optionTextCorrect,
                      ]}
                    >
                      {String.fromCharCode(65 + i)}. {o.text}
                    </Text>
                    {showAns && o.isCorrect && <Text style={styles.correctTick}>✓ correct</Text>}
                  </View>
                ))}
                {item.questionType !== 'multiple-choice' && item.questionType !== 'true-false' && showAns && !!item.correctAnswer && (
                  <Text style={styles.answerLine}>Answer: {item.correctAnswer}</Text>
                )}
              </View>

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
              </View>

              {(creatorName || originalName) && (
                <Text style={styles.creatorMeta}>
                  {originalName ? `Originally by ${originalName}` : creatorName ? `By ${creatorName}` : ''}
                  {item.movedToPastAt ? ` • archived ${new Date(item.movedToPastAt).toLocaleDateString()}` : ''}
                </Text>
              )}

              <View style={styles.cardActions}>
                <Button
                  title={showAns ? 'Hide answer' : 'Show answer'}
                  variant="ghost"
                  size="sm"
                  style={{ flex: 1 }}
                  onPress={() => toggleAnswer(item._id)}
                />
                {isTeacher && (
                  <Button
                    title="Edit"
                    variant="secondary"
                    size="sm"
                    style={{ flex: 1 }}
                    onPress={() =>
                      navigation.navigate('QuestionEditor' as any, { questionId: item._id })
                    }
                  />
                )}
              </View>
            </Card>
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
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      gap: spacing.md,
    },
    title: { fontSize: 26, fontWeight: '800', color: colors.text },
    subtitle: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
    controls: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
    search: { marginBottom: 0 },
    chipRow: { gap: spacing.sm, marginTop: spacing.md },
    filterRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.sm },
    actionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
    showing: { fontSize: 12, color: colors.textMuted },
    link: { fontSize: 12, color: colors.primary, fontWeight: '700' },
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
    qTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', marginBottom: spacing.sm },
    pastBadge: {
      backgroundColor: colors.warningLight || '#FFF3CD',
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radius.pill,
    },
    pastBadgeText: { fontSize: 10, fontWeight: '800', color: colors.warning || '#856404' },
    pastMeta: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
    qText: { fontSize: 15, fontWeight: '600', color: colors.text, lineHeight: 21 },
    optionList: { marginTop: spacing.md, gap: spacing.sm },
    optionRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: spacing.sm,
      borderRadius: radius.sm,
      backgroundColor: colors.bg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    optionRowCorrect: { borderColor: colors.success, backgroundColor: colors.successLight },
    optionText: { fontSize: 14, color: colors.text, flex: 1 },
    optionTextCorrect: { color: colors.success, fontWeight: '700' },
    correctTick: { fontSize: 11, fontWeight: '800', color: colors.success, marginLeft: spacing.sm },
    answerLine: { fontSize: 13, color: colors.success, fontWeight: '600', marginTop: spacing.sm },
    metaRow: { flexDirection: 'row', gap: 6, marginTop: spacing.md, flexWrap: 'wrap' },
    difficulty: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
    meta: { fontSize: 12, color: colors.textMuted, textTransform: 'capitalize' },
    creatorMeta: { fontSize: 11, color: colors.textLight, marginTop: spacing.sm, fontStyle: 'italic' },
    cardActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  });
