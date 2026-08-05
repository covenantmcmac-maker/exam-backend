import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, Field, Loading } from '../../components/ui';
import { questionsApi } from '../../api/endpoints';
import { useDialog } from '../../components/Dialog';
import { useColors } from '../../context/ThemeContext';
import { radius, spacing } from '../../theme';
import type { Colors } from '../../theme';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'PracticeSetup'>;

export default function PracticeSetupScreen({ navigation }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const dialog = useDialog();

  const [count, setCount] = useState('10');
  const [subject, setSubject] = useState('all');
  const [year, setYear] = useState('all');
  const [difficulty, setDifficulty] = useState('all');
  const [session, setSession] = useState('all');
  const [examType, setExamType] = useState('all');
  const [subjects, setSubjects] = useState<{ name: string; count: number }[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [sessions, setSessions] = useState<string[]>([]);
  const [examTypes, setExamTypes] = useState<string[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [generating, setGenerating] = useState(false);

  const loadMeta = useCallback(async () => {
    try {
      const stats = await questionsApi.pastStats();
      const subj = (stats.bySubject || []).map((s) => ({ name: s._id || 'Unspecified', count: s.count }));
      setSubjects(subj);
      setYears((stats.byYear || []).map((y) => y._id).filter(Boolean) as number[]);
      // For sessions/examTypes we need admin stats or derive from past pool? Use pool sampling via first page
      // Try to get a larger pool to extract sessions
      const pool = await questionsApi.listPastQuestionsPool({} as any);
      const sessSet = new Set<string>();
      const typeSet = new Set<string>();
      pool.questions.forEach((q) => {
        if (q.pastQuestionSession) sessSet.add(q.pastQuestionSession);
        if (q.pastQuestionExamType) typeSet.add(q.pastQuestionExamType);
      });
      setSessions(Array.from(sessSet));
      setExamTypes(Array.from(typeSet));
    } catch {
      // non-blocking
    } finally {
      setLoadingMeta(false);
    }
  }, []);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  const generate = async () => {
    const n = parseInt(count) || 10;
    if (n < 1 || n > 50) {
      void dialog.notify('Invalid count', 'Choose 1-50 questions.');
      return;
    }

    setGenerating(true);
    try {
      const res = await questionsApi.generatePractice({
        count: n,
        subject: subject !== 'all' ? subject : undefined,
        difficulty: difficulty !== 'all' ? difficulty : undefined,
        year: year !== 'all' ? year : undefined,
        session: session !== 'all' ? session : undefined,
        examType: examType !== 'all' ? examType : undefined,
      });

      if (!res.questions || res.questions.length === 0) {
        void dialog.notify('No matches', res.message || 'No past questions match your filters. Try broader filters.');
        return;
      }

      navigation.navigate('PracticeExam', {
        questions: res.questions,
        filters: res.filters,
        count: res.count,
      });
    } catch (e) {
      void dialog.notify('Error', e instanceof Error ? e.message : 'Could not generate practice set.');
    } finally {
      setGenerating(false);
    }
  };

  if (loadingMeta) return <Loading text="Loading filters…" />;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Generate Practice Test</Text>
        <Text style={styles.subtitle}>Create a random mock exam from past questions. Perfect for revision.</Text>

        <Card>
          <Text style={styles.section}>How many questions?</Text>
          <Field value={count} onChangeText={setCount} keyboardType="number-pad" label="Number of questions (1-50)" placeholder="10" />

          <Text style={styles.section}>Filters (optional)</Text>

          <Text style={styles.label}>Subject</Text>
          <View style={styles.chipWrap}>
            <Pressable onPress={() => setSubject('all')} style={[styles.chip, subject === 'all' && styles.chipActive]}>
              <Text style={[styles.chipText, subject === 'all' && styles.chipTextActive]}>All</Text>
            </Pressable>
            {subjects.slice(0, 12).map((s) => (
              <Pressable key={s.name} onPress={() => setSubject(s.name)} style={[styles.chip, subject === s.name && styles.chipActive]}>
                <Text style={[styles.chipText, subject === s.name && styles.chipTextActive]}>{s.name} ({s.count})</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Difficulty</Text>
          <View style={styles.chipWrap}>
            {['all', 'easy', 'medium', 'hard'].map((d) => (
              <Pressable key={d} onPress={() => setDifficulty(d)} style={[styles.chip, difficulty === d && styles.chipActive]}>
                <Text style={[styles.chipText, difficulty === d && styles.chipTextActive]}>{d}</Text>
              </Pressable>
            ))}
          </View>

          {years.length > 0 && (
            <>
              <Text style={styles.label}>Year</Text>
              <View style={styles.chipWrap}>
                <Pressable onPress={() => setYear('all')} style={[styles.chip, year === 'all' && styles.chipActive]}>
                  <Text style={[styles.chipText, year === 'all' && styles.chipTextActive]}>All years</Text>
                </Pressable>
                {years.map((y) => (
                  <Pressable key={y} onPress={() => setYear(String(y))} style={[styles.chip, year === String(y) && styles.chipActive]}>
                    <Text style={[styles.chipText, year === String(y) && styles.chipTextActive]}>{y}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          {sessions.length > 0 && (
            <>
              <Text style={styles.label}>Session</Text>
              <View style={styles.chipWrap}>
                <Pressable onPress={() => setSession('all')} style={[styles.chip, session === 'all' && styles.chipActive]}>
                  <Text style={[styles.chipText, session === 'all' && styles.chipTextActive]}>All</Text>
                </Pressable>
                {sessions.map((s) => (
                  <Pressable key={s} onPress={() => setSession(s)} style={[styles.chip, session === s && styles.chipActive]}>
                    <Text style={[styles.chipText, session === s && styles.chipTextActive]}>{s}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          {examTypes.length > 0 && (
            <>
              <Text style={styles.label}>Exam Type</Text>
              <View style={styles.chipWrap}>
                <Pressable onPress={() => setExamType('all')} style={[styles.chip, examType === 'all' && styles.chipActive]}>
                  <Text style={[styles.chipText, examType === 'all' && styles.chipTextActive]}>All</Text>
                </Pressable>
                {examTypes.map((et) => (
                  <Pressable key={et} onPress={() => setExamType(et)} style={[styles.chip, examType === et && styles.chipActive]}>
                    <Text style={[styles.chipText, examType === et && styles.chipTextActive]}>{et}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
        </Card>

        <Card style={styles.infoCard}>
          <Text style={styles.infoTitle}>📚 How practice works</Text>
          <Text style={styles.infoText}>• Random past questions matching your filters</Text>
          <Text style={styles.infoText}>• Instant grading with explanations</Text>
          <Text style={styles.infoText}>• No attempt limits — practice as much as you want</Text>
          <Text style={styles.infoText}>• Your score won't affect real exam results</Text>
        </Card>

        <Button title={`Generate ${count || 10} Questions`} onPress={generate} loading={generating} />
        <Button title="Browse Past Questions" variant="ghost" style={{ marginTop: spacing.md }} onPress={() => navigation.navigate('PastQuestions')} />
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
    title: { fontSize: 26, fontWeight: '800', color: colors.text },
    subtitle: { fontSize: 14, color: colors.textMuted, marginTop: 4, marginBottom: spacing.lg, lineHeight: 20 },
    section: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
    label: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginTop: spacing.md, marginBottom: spacing.sm },
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
    chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { fontSize: 13, color: colors.textMuted, fontWeight: '600', textTransform: 'capitalize' },
    chipTextActive: { color: colors.white },
    infoCard: { backgroundColor: colors.primaryLight, borderColor: colors.primary, borderWidth: 1 },
    infoTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
    infoText: { fontSize: 13, color: colors.textMuted, marginBottom: 4 },
  });
