import React, { useEffect, useMemo, useState } from 'react';
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
import SubjectChips from '../../components/SubjectChips';
import { summarizeSubjects } from './questionSort';
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
  const [publish, setPublish] = useState(false);

  const [bank, setBank] = useState<Question[]>([]);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  /** Course filter for the question picker. Independent of `subject` above. */
  const [bankSubject, setBankSubject] = useState('all');

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

  /**
   * The installed courses: the distinct subjects across the teacher's question
   * bank. Alphabetical here — the question bank lets you reorder the chips, but
   * that's a browsing aid; when building an exam a stable A→Z list is easier to
   * scan for a known course name.
   */
  const subjects = useMemo(() => summarizeSubjects(bank, 'alpha'), [bank]);

  /**
   * Guard against a filter pinned to a course that no longer exists (its last
   * question was deleted), which would otherwise show a permanently empty
   * picker with no visible cause.
   */
  const activeSubject =
    bankSubject === 'all' ||
    subjects.some((s) => s.name.toLowerCase() === bankSubject.trim().toLowerCase())
      ? bankSubject
      : 'all';

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const course = activeSubject.trim().toLowerCase();
    return bank.filter((q) => {
      const matchesTerm =
        !term ||
        q.questionText.toLowerCase().includes(term) ||
        (q.subject || '').toLowerCase().includes(term);
      const matchesCourse =
        activeSubject === 'all' || (q.subject || '').trim().toLowerCase() === course;
      return matchesTerm && matchesCourse;
    });
  }, [bank, search, activeSubject]);

  const selectedIds = Object.keys(selected);
  const totalMarks = selectedIds.reduce((sum, id) => sum + (selected[id] || 1), 0);

  /**
   * Quick-select a course: name the exam and narrow the picker in one tap.
   * Tapping the active course again clears both, so a mis-tap doesn't force the
   * teacher to empty the text field by hand.
   *
   * This deliberately does NOT unpick questions already chosen from another
   * course — an exam may span courses, and silently dropping a selection the
   * teacher can no longer see would lose work.
   */
  const pickCourse = (name: string) => {
    const isActive = subject.trim().toLowerCase() === name.trim().toLowerCase();
    setSubject(isActive ? '' : name);
    setBankSubject(isActive ? 'all' : name);
  };

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
            hint={
              subjects.length > 0
                ? 'Tap a course from your question bank, or type your own.'
                : undefined
            }
          />

          {/*
            Quick select. One tap names the exam and points the picker below at
            the same course — the common case of an exam covering one course.
            Tapping the active course again clears both.
          */}
          <SubjectChips
            subjects={subjects}
            selected={subject.trim() || 'all'}
            onSelect={pickCourse}
            showAll={false}
            showCounts={false}
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

          <Field
            value={search}
            onChangeText={setSearch}
            placeholder="Search your question bank…"
          />

          {/* Sorting row: narrows the picker without renaming the exam. */}
          {subjects.length > 0 && (
            <Text style={styles.subjectLabel}>Courses / subjects</Text>
          )}
          <SubjectChips
            subjects={subjects}
            selected={activeSubject}
            onSelect={setBankSubject}
            allLabel="all courses"
            total={bank.length}
          />

          {bank.length > 0 && (
            <Text style={styles.showing}>
              Showing {filtered.length} of {bank.length}
            </Text>
          )}

          {bank.length === 0 ? (
            <Text style={styles.emptyBank}>
              Your question bank is empty. Add questions from the Questions tab first.
            </Text>
          ) : filtered.length === 0 ? (
            <Text style={styles.emptyBank}>No questions match this course or search.</Text>
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
  pickHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  pickCount: { fontSize: 13, fontWeight: '700', color: colors.primary, marginBottom: spacing.lg },
  emptyBank: { fontSize: 14, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.lg },
  // Matches the question bank's course-row heading so the two screens read alike.
  subjectLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  showing: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm },
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
});
