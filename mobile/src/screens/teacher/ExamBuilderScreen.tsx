import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, ErrorNote, Field, Loading } from '../../components/ui';
import { examsApi, questionsApi } from '../../api/endpoints';
import { useDialog } from '../../components/Dialog';
import { difficultyColor, radius, spacing } from '../../theme';
import { useColors } from '../../context/ThemeContext';
import type { Colors } from '../../theme';
import type { Question } from '../../api/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'ExamBuilder'>;
type BankSource = 'active' | 'myPast' | 'allPast';

export default function ExamBuilderScreen({ route, navigation }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const examId = route.params?.examId;
  const isEdit = !!examId;
  const dialog = useDialog();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [subject, setSubject] = useState('');
  const [duration, setDuration] = useState('60');
  const [passingMarks, setPassingMarks] = useState('40');
  const [maxAttempts, setMaxAttempts] = useState('1');
  const [shuffle, setShuffle] = useState(false);
  const [showResults, setShowResults] = useState(true);
  const [publish, setPublish] = useState(false);

  const [bank, setBank] = useState<Question[]>([]);
  const [bankSource, setBankSource] = useState<BankSource>('active');
  const [bankLoading, setBankLoading] = useState(false);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [subjectFilter, setSubjectFilter] = useState<string>('all');
  const [difficultyFilter, setDifficultyFilter] = useState<string>('all');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    navigation.setOptions({ title: isEdit ? 'Edit exam' : 'New exam' });
  }, [isEdit, navigation]);

  const loadBank = useCallback(async (source: BankSource) => {
    setBankLoading(true);
    try {
      let res: { questions: Question[] };
      if (source === 'active') {
        res = await questionsApi.list();
      } else if (source === 'myPast') {
        res = await questionsApi.listPast();
      } else {
        res = await questionsApi.listPastQuestionsPool({});
      }
      setBank(res.questions);
    } catch (e) {
      void dialog.notify('Error', e instanceof Error ? e.message : 'Could not load question bank.');
    } finally {
      setBankLoading(false);
    }
  }, [dialog]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await loadBank(bankSource);

        if (examId) {
          const exam = await examsApi.forEdit(examId);
          if (cancelled) return;
          setTitle(exam.title || '');
          setDescription(exam.description || '');
          setSubject(exam.subject || '');
          setDuration(String(exam.settings?.duration ?? 60));
          setPassingMarks(String(exam.settings?.passingMarks ?? 40));
          setMaxAttempts(String(exam.settings?.maxAttempts ?? 1));
          setShuffle(!!exam.settings?.shuffleQuestions);
          setShowResults(exam.settings?.showResults !== false);
          setPublish(!!exam.settings?.isPublished);

          const picked: Record<string, number> = {};
          (exam.questions || []).forEach((q) => {
            const id = typeof q.question === 'object' ? q.question?._id : (q.question as string);
            if (id) picked[id] = q.points || 1;
          });
          setSelected(picked);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [examId]);

  // Reload bank when source changes
  useEffect(() => {
    void loadBank(bankSource);
  }, [bankSource, loadBank]);

  // Ensure selected questions that are not in current bank still appear (by fetching them individually if needed)
  useEffect(() => {
    const selectedIds = Object.keys(selected);
    const missing = selectedIds.filter((id) => !bank.some((q) => q._id === id));
    if (missing.length === 0 || examId === undefined) return; // Only for edit mode initial load we already merged, but keep logic
    // Try to fetch missing from all pools
    (async () => {
      try {
        const fetched: Question[] = [];
        for (const id of missing.slice(0, 20)) {
          try {
            const q = await questionsApi.getOne(id);
            fetched.push(q);
          } catch {}
        }
        if (fetched.length > 0) {
          setBank((prev) => [...fetched, ...prev]);
        }
      } catch {}
    })();
  }, [selected, bank, examId]);

  const subjects = useMemo(() => {
    const set = new Set<string>();
    for (const q of bank) {
      if (q.subject) set.add(q.subject);
    }
    return Array.from(set).sort();
  }, [bank]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return bank.filter((q) => {
      const matchesSearch =
        !term ||
        q.questionText.toLowerCase().includes(term) ||
        (q.subject || '').toLowerCase().includes(term);
      const matchesSubject = subjectFilter === 'all' || (q.subject || '') === subjectFilter;
      const matchesDiff = difficultyFilter === 'all' || q.difficulty === difficultyFilter;
      return matchesSearch && matchesSubject && matchesDiff;
    });
  }, [bank, search, subjectFilter, difficultyFilter]);

  const selectedIds = Object.keys(selected);
  const totalMarks = selectedIds.reduce((sum, id) => sum + (selected[id] || 1), 0);

  const toggle = (q: Question) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[q._id] !== undefined) delete next[q._id];
      else next[q._id] = q.points || 1;
      return next;
    });
  };

  const updatePoints = (id: string, pts: string) => {
    const n = parseInt(pts) || 1;
    setSelected((prev) => ({ ...prev, [id]: n }));
  };

  const save = async () => {
    if (!title.trim()) {
      setError('Give the exam a title.');
      return;
    }
    if (selectedIds.length === 0) {
      setError('Select at least one question.');
      return;
    }

    const payload = {
      title: title.trim(),
      description: description.trim(),
      subject: subject.trim(),
      questions: selectedIds.map((id, i) => ({
        question: id,
        points: selected[id] || 1,
        order: i,
      })),
      settings: {
        duration: parseInt(duration, 10) || 60,
        passingMarks: parseInt(passingMarks, 10) || 40,
        maxAttempts: parseInt(maxAttempts, 10) || 1,
        shuffleQuestions: shuffle,
        showResults,
        isPublished: publish,
      },
    };

    setSaving(true);
    setError(null);
    try {
      if (isEdit) {
        await examsApi.update(examId!, payload as never);
        await dialog.notify('Saved', 'Your exam has been updated.');
      } else {
        const res = await examsApi.create(payload as never);
        await dialog.notify(
          'Exam created',
          `Share this access code with your students:\n\n${res.accessCode}`
        );
      }
      navigation.goBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save exam.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading text="Loading exam builder…" />;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <ErrorNote message={error} />

        <Card>
          <Text style={styles.section}>Exam details</Text>
          <Field label="Title" value={title} onChangeText={setTitle} placeholder="Mid-term test" />
          <Field
            label="Subject"
            value={subject}
            onChangeText={setSubject}
            placeholder="Mathematics"
          />
          <Field
            label="Description (optional)"
            value={description}
            onChangeText={setDescription}
            placeholder="Short note for students"
            multiline
            style={{ minHeight: 78, textAlignVertical: 'top' }}
          />
        </Card>

        <Card>
          <Text style={styles.section}>Settings</Text>
          <View style={styles.settingsRow}>
            <Field
              label="Duration (min)"
              value={duration}
              onChangeText={setDuration}
              keyboardType="number-pad"
              style={{ textAlign: 'center' }}
            />
            <Field
              label="Pass mark"
              value={passingMarks}
              onChangeText={setPassingMarks}
              keyboardType="number-pad"
              style={{ textAlign: 'center' }}
            />
            <Field
              label="Max attempts"
              value={maxAttempts}
              onChangeText={setMaxAttempts}
              keyboardType="number-pad"
              style={{ textAlign: 'center' }}
            />
          </View>

          <Toggle label="Shuffle questions" value={shuffle} onChange={setShuffle} />
          <Toggle
            label="Show results to students"
            value={showResults}
            onChange={setShowResults}
          />
          <Toggle label="Publish immediately" value={publish} onChange={setPublish} />
        </Card>

        <Card>
          <View style={styles.pickHeader}>
            <Text style={styles.section}>Questions</Text>
            <Text style={styles.pickCount}>
              {selectedIds.length} selected · {totalMarks} marks
            </Text>
          </View>

          <Text style={styles.hint}>Tap to add/remove · Use Past Qs to reuse archived questions</Text>

          <View style={styles.sourceToggle}>
            <Pressable onPress={() => setBankSource('active')} style={[styles.sourceBtn, bankSource === 'active' && styles.sourceBtnActive]}>
              <Text style={[styles.sourceText, bankSource === 'active' && styles.sourceTextActive]}>📝 My Bank</Text>
            </Pressable>
            <Pressable onPress={() => setBankSource('myPast')} style={[styles.sourceBtn, bankSource === 'myPast' && styles.sourceBtnActive]}>
              <Text style={[styles.sourceText, bankSource === 'myPast' && styles.sourceTextActive]}>📚 My Past</Text>
            </Pressable>
            <Pressable onPress={() => setBankSource('allPast')} style={[styles.sourceBtn, bankSource === 'allPast' && styles.sourceBtnActive]}>
              <Text style={[styles.sourceText, bankSource === 'allPast' && styles.sourceTextActive]}>🌐 All Past</Text>
            </Pressable>
          </View>

          {bankSource !== 'active' && (
            <View style={styles.pastInfoBox}>
              <Text style={styles.pastInfoText}>
                {bankSource === 'myPast'
                  ? 'Showing your archived past questions. You can reuse them in new exams.'
                  : 'Showing all teachers’ past questions pool. Great for assembling revision exams.'}
              </Text>
            </View>
          )}

          <Field
            value={search}
            onChangeText={setSearch}
            placeholder={bankSource === 'active' ? 'Search your bank…' : 'Search past questions…'}
          />

          <View style={styles.filterRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, flexDirection: 'row' }}>
              <Pressable onPress={() => setSubjectFilter('all')} style={[styles.chip, subjectFilter === 'all' && styles.chipActive]}>
                <Text style={[styles.chipText, subjectFilter === 'all' && styles.chipTextActive]}>All subjects</Text>
              </Pressable>
              {subjects.map((s) => (
                <Pressable key={s} onPress={() => setSubjectFilter(s)} style={[styles.chip, subjectFilter === s && styles.chipActive]}>
                  <Text style={[styles.chipText, subjectFilter === s && styles.chipTextActive]}>{s}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          <View style={styles.filterRow}>
            {['all', 'easy', 'medium', 'hard'].map((d) => (
              <Pressable key={d} onPress={() => setDifficultyFilter(d)} style={[styles.chip, difficultyFilter === d && styles.chipActive]}>
                <Text style={[styles.chipText, difficultyFilter === d && styles.chipTextActive]}>{d}</Text>
              </Pressable>
            ))}
          </View>

          {bankLoading ? (
            <Text style={styles.emptyBank}>Loading {bankSource === 'active' ? 'bank' : 'past questions'}…</Text>
          ) : bank.length === 0 ? (
            <Text style={styles.emptyBank}>
              {bankSource === 'active'
                ? 'Your question bank is empty. Add questions from the Questions tab first.'
                : 'No past questions found in this pool. Move questions to past from Question Bank.'}
            </Text>
          ) : filtered.length === 0 ? (
            <Text style={styles.emptyBank}>No matches. Try different filters.</Text>
          ) : (
            filtered.map((q) => {
              const isOn = selected[q._id] !== undefined;
              const isPast = !!q.isPastQuestion;
              return (
                <Pressable
                  key={q._id}
                  onPress={() => toggle(q)}
                  style={[styles.qRow, isOn && styles.qRowOn, isPast && styles.qRowPast]}
                >
                  <View style={[styles.check, isOn && styles.checkOn]}>
                    {isOn && <Text style={styles.checkMark}>✓</Text>}
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      {isPast && (
                        <View style={styles.pastBadge}>
                          <Text style={styles.pastBadgeText}>PAST {q.pastQuestionYear || ''}</Text>
                        </View>
                      )}
                      <Text style={styles.qText} numberOfLines={2}>
                        {q.questionText}
                      </Text>
                    </View>
                    <View style={styles.qMetaRow}>
                      <Text
                        style={[
                          styles.qDifficulty,
                          { color: difficultyColor[q.difficulty] || colors.textMuted },
                        ]}
                      >
                        {q.difficulty}
                      </Text>
                      <Text style={styles.qMeta}>· {q.points} pt</Text>
                      {!!q.subject && <Text style={styles.qMeta}>· {q.subject}</Text>}
                      {q.pastQuestionSession && <Text style={styles.qMeta}>· {q.pastQuestionSession}</Text>}
                    </View>
                    {isOn && (
                      <View style={styles.pointsEdit}>
                        <Text style={styles.pointsLabel}>Points:</Text>
                        <Pressable onPress={() => updatePoints(q._id, String((selected[q._id] || 1) - 1))} style={styles.ptsBtn}>
                          <Text style={styles.ptsBtnText}>−</Text>
                        </Pressable>
                        <Text style={styles.ptsValue}>{selected[q._id]}</Text>
                        <Pressable onPress={() => updatePoints(q._id, String((selected[q._id] || 1) + 1))} style={styles.ptsBtn}>
                          <Text style={styles.ptsBtnText}>+</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                </Pressable>
              );
            })
          )}

          {selectedIds.length > 0 && (
            <View style={styles.selectedPreview}>
              <Text style={styles.selectedTitle}>Selected ({selectedIds.length})</Text>
              {selectedIds.slice(0, 5).map((id) => {
                const q = bank.find((x) => x._id === id) || ({ questionText: id, _id: id } as any);
                return (
                  <Text key={id} style={styles.selectedItem} numberOfLines={1}>
                    • {(q as any).questionText?.slice(0, 60) || id} ({selected[id]} pt)
                  </Text>
                );
              })}
              {selectedIds.length > 5 && <Text style={styles.subMuted}>+ {selectedIds.length - 5} more…</Text>}
            </View>
          )}
        </Card>

        <Button
          title={isEdit ? 'Save changes' : 'Create exam'}
          onPress={save}
          loading={saving}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.primary, false: colors.border }}
        thumbColor={colors.white}
      />
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  section: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: spacing.lg },
  hint: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.md },
  settingsRow: { flexDirection: 'row', gap: spacing.md },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  toggleLabel: { fontSize: 15, color: colors.text, flex: 1 },
  pickHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  pickCount: { fontSize: 13, fontWeight: '700', color: colors.primary, marginBottom: spacing.lg },
  sourceToggle: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  sourceBtn: { flex: 1, paddingVertical: 8, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, alignItems: 'center' },
  sourceBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  sourceText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  sourceTextActive: { color: colors.white },
  pastInfoBox: { backgroundColor: colors.warningLight, borderRadius: radius.sm, padding: spacing.sm, marginBottom: spacing.md, borderLeftWidth: 3, borderLeftColor: colors.warning },
  pastInfoText: { fontSize: 12, color: colors.text, lineHeight: 16 },
  filterRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12, color: colors.textMuted, fontWeight: '600', textTransform: 'capitalize' },
  chipTextActive: { color: colors.white },
  emptyBank: { fontSize: 14, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.lg },
  qRow: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
    backgroundColor: colors.card,
  },
  qRowOn: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  qRowPast: { borderLeftWidth: 3, borderLeftColor: colors.warning },
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
  qText: { fontSize: 14, color: colors.text, lineHeight: 20, flex: 1 },
  qMetaRow: { flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  qDifficulty: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  qMeta: { fontSize: 11, color: colors.textMuted },
  pastBadge: { backgroundColor: colors.warningLight, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill },
  pastBadgeText: { fontSize: 9, fontWeight: '800', color: colors.warning },
  pointsEdit: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  pointsLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  ptsBtn: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  ptsBtnText: { fontSize: 14, fontWeight: '800', color: colors.text },
  ptsValue: { fontSize: 13, fontWeight: '700', color: colors.text, minWidth: 16, textAlign: 'center' },
  selectedPreview: { marginTop: spacing.lg, padding: spacing.md, backgroundColor: colors.bg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  selectedTitle: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 6 },
  selectedItem: { fontSize: 12, color: colors.textMuted, marginBottom: 2 },
  subMuted: { fontSize: 11, color: colors.textLight, marginTop: 4 },
});
