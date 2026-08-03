import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  const [allowReview, setAllowReview] = useState(false);
  const [publish, setPublish] = useState(false);

  const [bank, setBank] = useState<Question[]>([]);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [subjectFilter, setSubjectFilter] = useState<string>('all');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    navigation.setOptions({ title: isEdit ? 'Edit exam' : 'New exam' });
  }, [isEdit, navigation]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const qs = await questionsApi.list();
        if (!cancelled) setBank(qs.questions);

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
          setAllowReview(!!exam.settings?.allowReview);
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

  const subjects = useMemo(() => {
    const counts = new Map<string, number>();
    for (const q of bank) {
      const s = (q.subject || '').trim();
      if (!s) continue;
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }));
  }, [bank]);

  const effectiveSubject =
    subjectFilter === 'all' || subjects.some((s) => s.name === subjectFilter)
      ? subjectFilter
      : 'all';

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return bank.filter((q) => {
      const matchesTerm =
        !term ||
        q.questionText.toLowerCase().includes(term) ||
        (q.subject || '').toLowerCase().includes(term);
      const matchesSubject =
        effectiveSubject === 'all' || (q.subject || '').trim() === effectiveSubject;
      return matchesTerm && matchesSubject;
    });
  }, [bank, search, effectiveSubject]);

  const isSubjectFullySelected = useCallback(
    (subjName: string) => {
      const subjQuestions = bank.filter((q) => (q.subject || '').trim() === subjName);
      if (subjQuestions.length === 0) return false;
      return subjQuestions.every((q) => selected[q._id] !== undefined);
    },
    [bank, selected]
  );

  const getSubjectSelectedCount = useCallback(
    (subjName: string) => {
      return bank
        .filter((q) => (q.subject || '').trim() === subjName)
        .reduce((count, q) => count + (selected[q._id] !== undefined ? 1 : 0), 0);
    },
    [bank, selected]
  );

  const selectBySubject = useCallback(
    (subjName: string) => {
      setSelected((prev) => {
        const next = { ...prev };
        bank.forEach((q) => {
          if ((q.subject || '').trim() === subjName) {
            next[q._id] = q.points || 1;
          }
        });
        return next;
      });
    },
    [bank]
  );

  const deselectBySubject = useCallback(
    (subjName: string) => {
      setSelected((prev) => {
        const next = { ...prev };
        bank.forEach((q) => {
          if ((q.subject || '').trim() === subjName) {
            delete next[q._id];
          }
        });
        return next;
      });
    },
    [bank]
  );

  const selectAllFiltered = useCallback(() => {
    setSelected((prev) => {
      const next = { ...prev };
      filtered.forEach((q) => {
        next[q._id] = q.points || 1;
      });
      return next;
    });
  }, [filtered]);

  const deselectAllFiltered = useCallback(() => {
    setSelected((prev) => {
      const next = { ...prev };
      filtered.forEach((q) => {
        delete next[q._id];
      });
      return next;
    });
  }, [filtered]);

  const getSubjectButtonLabel = (name: string, total: number, selectedCount: number) => {
    if (selectedCount === 0) return `+ Select all ${name} (${total})`;
    if (selectedCount === total) return `✓ ${name} (${total}/${total})`;
    return `+ Select all ${name} (${selectedCount}/${total})`;
  };

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
        allowReview,
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

  if (loading) return <Loading text="Loading…" />;

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
          <Toggle
            label="Allow students to review answers"
            value={allowReview}
            onChange={setAllowReview}
          />
          <Text style={styles.settingHint}>
            Reviews show students the correct answer and any explanation you entered after they finish.
          </Text>
          <Toggle label="Publish immediately" value={publish} onChange={setPublish} />
        </Card>

        <Card>
          <View style={styles.pickHeader}>
            <Text style={styles.section}>Questions</Text>
            <Text style={styles.pickCount}>
              {selectedIds.length} selected · {totalMarks} marks
            </Text>
          </View>

          <Field
            value={search}
            onChangeText={setSearch}
            placeholder="Search your question bank…"
            style={{ marginBottom: spacing.sm }}
          />

          {subjects.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.subjectRow}
            >
              <Pressable
                onPress={() => setSubjectFilter('all')}
                style={[styles.chip, effectiveSubject === 'all' && styles.chipActive]}
              >
                <Text
                  style={[styles.chipText, effectiveSubject === 'all' && styles.chipTextActive]}
                >
                  All subjects ({bank.length})
                </Text>
              </Pressable>
              {subjects.map((s) => {
                const active = effectiveSubject === s.name;
                return (
                  <Pressable
                    key={s.name}
                    onPress={() => setSubjectFilter(s.name)}
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

          {bank.length > 0 && (
            <View style={styles.selectionToolbar}>
              {subjects.length > 0 && (
                <View style={styles.subjectSelectWrap}>
                  <Text style={styles.subjectSelectLabel}>Select all by subject:</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.subjectActionScroll}
                  >
                    {subjects.map((s) => {
                      const allSelected = isSubjectFullySelected(s.name);
                      const selectedCount = getSubjectSelectedCount(s.name);
                      return (
                        <Pressable
                          key={s.name}
                          onPress={() =>
                            allSelected
                              ? deselectBySubject(s.name)
                              : selectBySubject(s.name)
                          }
                          style={[
                            styles.subjectActionChip,
                            allSelected && styles.subjectActionChipActive,
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={
                            allSelected
                              ? `Deselect all ${s.name} questions`
                              : `Select all ${s.name} questions`
                          }
                        >
                          <Text
                            style={[
                              styles.subjectActionText,
                              allSelected && styles.subjectActionTextActive,
                            ]}
                          >
                            {getSubjectButtonLabel(s.name, s.count, selectedCount)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              )}

              <View style={styles.bulkActionsRow}>
                <Pressable
                  onPress={selectAllFiltered}
                  style={styles.bulkBtn}
                  accessibilityRole="button"
                >
                  <Text style={styles.bulkBtnText}>
                    {effectiveSubject === 'all'
                      ? `Select all (${filtered.length})`
                      : `Select all ${effectiveSubject} (${filtered.length})`}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={deselectAllFiltered}
                  style={styles.bulkBtn}
                  accessibilityRole="button"
                >
                  <Text style={styles.bulkBtnText}>
                    {effectiveSubject === 'all'
                      ? 'Deselect all'
                      : `Deselect all ${effectiveSubject}`}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

          {bank.length === 0 ? (
            <Text style={styles.emptyBank}>
              Your question bank is empty. Add questions from the Questions tab first.
            </Text>
          ) : filtered.length === 0 ? (
            <Text style={styles.emptyBank}>
              No questions match your filter.
            </Text>
          ) : (
            filtered.map((q) => {
              const isOn = selected[q._id] !== undefined;
              return (
                <Pressable
                  key={q._id}
                  onPress={() => toggle(q)}
                  style={[styles.qRow, isOn && styles.qRowOn]}
                >
                  <View style={[styles.check, isOn && styles.checkOn]}>
                    {isOn && <Text style={styles.checkMark}>✓</Text>}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.qText} numberOfLines={2}>
                      {q.questionText}
                    </Text>
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
                    </View>
                  </View>
                </Pressable>
              );
            })
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
  settingsRow: { flexDirection: 'row', gap: spacing.md },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  toggleLabel: { fontSize: 15, color: colors.text, flex: 1 },
  settingHint: { fontSize: 12, color: colors.textMuted, lineHeight: 18, marginBottom: spacing.sm },
  pickHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  pickCount: { fontSize: 13, fontWeight: '700', color: colors.primary, marginBottom: spacing.lg },
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
  qText: { fontSize: 14, color: colors.text, lineHeight: 20 },
  qMetaRow: { flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  qDifficulty: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  qMeta: { fontSize: 12, color: colors.textMuted },
  subjectRow: { gap: spacing.sm, marginTop: spacing.xs, marginBottom: spacing.md },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: {
    fontSize: 13,
    color: colors.textMuted,
    textTransform: 'capitalize',
    fontWeight: '600',
  },
  chipTextActive: { color: colors.white },
  selectionToolbar: {
    marginBottom: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  subjectSelectWrap: {
    marginBottom: spacing.md,
  },
  subjectSelectLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  subjectActionScroll: {
    gap: spacing.sm,
  },
  subjectActionChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  subjectActionChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  subjectActionText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '700',
  },
  subjectActionTextActive: {
    color: colors.white,
  },
  bulkActionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  bulkBtn: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulkBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
});
