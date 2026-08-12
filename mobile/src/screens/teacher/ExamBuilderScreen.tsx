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
import { configApi, examsApi, questionsApi } from '../../api/endpoints';
import { useAuth } from '../../context/AuthContext';
import { useDialog } from '../../components/Dialog';
import { difficultyColor, radius, spacing } from '../../theme';
import { useColors, useThemedStyles } from '../../context/ThemeContext';
import type { Colors } from '../../theme';
import type { Question } from '../../api/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'ExamBuilder'>;
type BankSource = 'active' | 'myPast' | 'allPast';

export default function ExamBuilderScreen({ route, navigation }: Props) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const examId = route.params?.examId;
  const isEdit = !!examId;
  const { isAdmin } = useAuth();
  const dialog = useDialog();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [subject, setSubject] = useState('');
  const [duration, setDuration] = useState('60');
  const [passingMarks, setPassingMarks] = useState('40');
  const [maxAttempts, setMaxAttempts] = useState('1');
  const [shuffle, setShuffle] = useState(false);
  const [showResults, setShowResults] = useState(true);
  // Answer review is enabled by default; the toggle turns it off (or on).
  const [allowReview, setAllowReview] = useState(true);
  const [publish, setPublish] = useState(false);
  const [safeMode, setSafeMode] = useState(false);

  // Monetisation. Teacher exams: free to take, teacher-set review fee.
  // Past papers (admin only): platform entry fee + review fee.
  const [pastMode, setPastMode] = useState(route.params?.source === 'past');
  const [year, setYear] = useState('');
  const [entryFee, setEntryFee] = useState('');
  const [reviewFee, setReviewFee] = useState('');
  const [currencySymbol, setCurrencySymbol] = useState('₦');

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

        const cfg = await configApi.get();
        if (!cancelled) setCurrencySymbol(cfg.currencySymbol || '₦');

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
          setAllowReview(exam.settings?.allowReview !== false);
          setPublish(!!exam.settings?.isPublished);
          setSafeMode(!!exam.settings?.safeMode);

          if (exam.source === 'past') setPastMode(true);
          if (exam.year) setYear(String(exam.year));
          if (exam.pricing?.entryFee) setEntryFee(String(exam.pricing.entryFee));
          setReviewFee(String(exam.pricing?.reviewFee ?? ''));

          const picked: Record<string, number> = {};
          (exam.questions || []).forEach((q) => {
            const id = typeof q.question === 'object' ? q.question?._id : (q.question as string);
            if (id) picked[id] = q.points || 1;
          });
          setSelected(picked);
        } else {
          // Prefill the platform's default fees
          const cfg2 = await configApi.get().catch(() => null as any);
          if (cfg2) {
            setReviewFee(String(cfg2.defaultReviewFee ?? 500));
            if (route.params?.source === 'past') {
              setEntryFee(String(cfg2.defaultEntryFee ?? 300));
            }
          }
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

  useEffect(() => {
    void loadBank(bankSource);
  }, [bankSource, loadBank]);

  /**
   * Bank indexed by subject, built once per bank load.
   *
   * Everything subject-related (the chips, their counts, "select all X") reads
   * from here. Previously each of those did its own `bank.filter(...)`, so with
   * S subjects the screen ran S full scans of the bank on EVERY render — and a
   * render happens on every keystroke in the title field.
   */
  const subjectIndex = useMemo(() => {
    const map = new Map<string, Question[]>();
    for (const q of bank) {
      const s = (q.subject || '').trim();
      if (!s) continue;
      const list = map.get(s);
      if (list) list.push(q);
      else map.set(s, [q]);
    }
    return map;
  }, [bank]);

  const subjects = useMemo(
    () =>
      [...subjectIndex.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, questions]) => ({ name, count: questions.length })),
    [subjectIndex]
  );

  /**
   * Per-subject selection tallies for the whole bank, in ONE pass.
   *
   * Recomputes only when the bank or the selection changes — not when the
   * title, description, fees or any other unrelated field does.
   */
  const subjectSelection = useMemo(() => {
    const tally = new Map<string, { total: number; selected: number }>();
    for (const [name, questions] of subjectIndex) {
      let selectedCount = 0;
      for (const q of questions) {
        if (selected[q._id] !== undefined) selectedCount++;
      }
      tally.set(name, { total: questions.length, selected: selectedCount });
    }
    return tally;
  }, [subjectIndex, selected]);

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
      const matchesDifficulty =
        difficultyFilter === 'all' || q.difficulty === difficultyFilter;
      return matchesTerm && matchesSubject && matchesDifficulty;
    });
  }, [bank, search, effectiveSubject, difficultyFilter]);

  // O(1) lookups against the precomputed tally instead of rescanning the bank.
  const isSubjectFullySelected = useCallback(
    (subjName: string) => {
      const t = subjectSelection.get(subjName);
      return !!t && t.total > 0 && t.selected === t.total;
    },
    [subjectSelection]
  );

  const getSubjectSelectedCount = useCallback(
    (subjName: string) => subjectSelection.get(subjName)?.selected ?? 0,
    [subjectSelection]
  );

  const selectBySubject = useCallback(
    (subjName: string) => {
      const questions = subjectIndex.get(subjName);
      if (!questions?.length) return;
      setSelected((prev) => {
        const next = { ...prev };
        for (const q of questions) next[q._id] = q.points || 1;
        return next;
      });
    },
    [subjectIndex]
  );

  const deselectBySubject = useCallback(
    (subjName: string) => {
      const questions = subjectIndex.get(subjName);
      if (!questions?.length) return;
      setSelected((prev) => {
        const next = { ...prev };
        for (const q of questions) delete next[q._id];
        return next;
      });
    },
    [subjectIndex]
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

  // Tied to the selection only, so typing a title no longer re-walks it.
  const { selectedIds, totalMarks } = useMemo(() => {
    const ids = Object.keys(selected);
    return {
      selectedIds: ids,
      totalMarks: ids.reduce((sum, id) => sum + (selected[id] || 1), 0),
    };
  }, [selected]);

  // Stable identities: these are handed to every question row, and a new
  // function each render would defeat the rows' memoisation.
  const toggle = useCallback((q: Question) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[q._id] !== undefined) delete next[q._id];
      else next[q._id] = q.points || 1;
      return next;
    });
  }, []);

  const updatePoints = useCallback((id: string, pts: string) => {
    const n = Math.max(1, parseInt(pts, 10) || 1);
    setSelected((prev) => ({ ...prev, [id]: n }));
  }, []);

  /**
   * The rendered picker rows.
   *
   * Memoised so that typing in the title/description/fee fields — which is
   * most of what happens on this screen — does not even rebuild the element
   * array for a bank that can run to thousands of questions. It recomputes
   * only when the filtered list or the selection actually changes.
   */
  const questionRows = useMemo(
    () =>
      filtered.map((q) => (
        <QuestionRow
          key={q._id}
          question={q}
          points={selected[q._id]}
          onToggle={toggle}
          onChangePoints={updatePoints}
        />
      )),
    [filtered, selected, toggle, updatePoints]
  );

  const save = async () => {
    if (!title.trim()) {
      setError('Give the exam a title.');
      return;
    }
    if (selectedIds.length === 0) {
      setError('Select at least one question.');
      return;
    }

    const payload: Record<string, unknown> = {
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
        safeMode,
      },
    };

    if (pastMode) {
      if (!isAdmin) {
        setError('Only admins can create past-question papers.');
        return;
      }
      payload.source = 'past';
      if (year.trim()) payload.year = parseInt(year, 10) || undefined;
      payload.pricing = {
        entryFee: parseInt(entryFee, 10) || 0,
        reviewFee: parseInt(reviewFee, 10) || 0,
      };
    } else {
      payload.pricing = {
        // Teacher exams are always free to take; only the review is charged.
        reviewFee: parseInt(reviewFee, 10) || 0,
      };
    }

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
            label="Safe exam mode (block/flag copy, screenshots and leaving app)"
            value={safeMode}
            onChange={setSafeMode}
          />
          <Text style={styles.settingHelp}>Three recorded violations automatically submit the attempt.</Text>
          <Toggle
            label="Allow students to review answers"
            value={allowReview}
            onChange={setAllowReview}
          />
          <Text style={styles.settingHint}>
            Reviews show students the correct answer and any explanation you entered after they
            finish. A paid review fee can be set below.
          </Text>
          <Toggle label="Publish immediately" value={publish} onChange={setPublish} />
        </Card>

        {isAdmin && !isEdit && (
          <Card>
            <Text style={styles.section}>Exam type</Text>
            <View style={styles.typeRow}>
              <Pressable
                onPress={() => setPastMode(false)}
                style={[styles.typeOption, !pastMode && styles.typeOptionActive]}
              >
                <Text style={[styles.typeText, !pastMode && styles.typeTextActive]}>
                  📝 Teacher exam
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setPastMode(true)}
                style={[styles.typeOption, pastMode && styles.typeOptionActive]}
              >
                <Text style={[styles.typeText, pastMode && styles.typeTextActive]}>
                  📚 Past questions
                </Text>
              </Pressable>
            </View>
            <Text style={styles.settingHint}>
              {pastMode
                ? 'Platform-owned paper sold to students (entry + review fees).'
                : 'Teacher-set exam shared by access code — always free to take.'}
            </Text>
          </Card>
        )}

        <Card>
          <Text style={styles.section}>
            {pastMode ? 'Pricing (past paper)' : 'Review fee'}
          </Text>

          {pastMode && (
            <View style={styles.settingsRow}>
              <Field
                label="Year"
                value={year}
                onChangeText={setYear}
                keyboardType="number-pad"
                placeholder="2022"
                style={{ textAlign: 'center' }}
              />
              <Field
                label={`Entry fee (${currencySymbol})`}
                value={entryFee}
                onChangeText={setEntryFee}
                keyboardType="number-pad"
                placeholder="300"
                style={{ textAlign: 'center' }}
              />
            </View>
          )}

          <Field
            label={`Answer review fee (${currencySymbol})`}
            value={reviewFee}
            onChangeText={setReviewFee}
            keyboardType="number-pad"
            placeholder="500"
            hint={
              pastMode
                ? 'Students pay this once, after submitting, to open the answer review.'
                : 'Students take this exam for free, but pay this fee to open the answer review after submitting. Set 0 for free review.'
            }
          />
        </Card>

        <Card>
          <View style={styles.pickHeader}>
            <Text style={styles.section}>Questions</Text>
            <Text style={styles.pickCount}>
              {selectedIds.length} selected · {totalMarks} marks
            </Text>
          </View>

          <Text style={{ fontSize: 12, color: colors.textMuted, marginBottom: spacing.md }}>Tap to add/remove · Use Past Qs to reuse archived questions (question-level) + Past Papers are monetised exam-level</Text>

          <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
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
            <View style={{ backgroundColor: colors.warningLight, borderRadius: 8, padding: 8, marginBottom: spacing.md, borderLeftWidth: 3, borderLeftColor: colors.warning }}>
              <Text style={{ fontSize: 12, color: colors.text, lineHeight: 16 }}>
                {bankSource === 'myPast'
                  ? 'Showing your archived past questions (question-level). You can reuse them in new exams.'
                  : 'Showing all teachers’ past questions pool (question-level). Great for assembling revision exams.'}
              </Text>
            </View>
          )}

          <Field
            value={search}
            onChangeText={setSearch}
            placeholder={bankSource === 'active' ? 'Search your bank…' : 'Search past questions…'}
            style={{ marginBottom: spacing.sm }}
          />

          <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
            {['all', 'easy', 'medium', 'hard'].map((d) => (
              <Pressable key={d} onPress={() => setDifficultyFilter(d)} style={[styles.chip, difficultyFilter === d && styles.chipActive]}>
                <Text style={[styles.chipText, difficultyFilter === d && styles.chipTextActive]}>{d}</Text>
              </Pressable>
            ))}
          </View>

          {bankLoading && <Text style={styles.emptyBank}>Loading {bankSource === 'active' ? 'bank' : 'past questions'}…</Text>}

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

          {bank.length === 0 && !bankLoading ? (
            <Text style={styles.emptyBank}>
              Your question bank is empty. Add questions from the Questions tab first.
            </Text>
          ) : filtered.length === 0 && !bankLoading ? (
            <Text style={styles.emptyBank}>
              No questions match your filter.
            </Text>
          ) : !bankLoading ? (
            questionRows
          ) : null}
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

/**
 * One row in the question picker.
 *
 * Memoised on purpose. The picker renders every question in the bank, and the
 * builder re-renders on every keystroke in the title/description/fee fields.
 * Inline rows meant all of them were rebuilt each time, which is what made
 * typing lag on a large bank. With React.memo a keystroke that touches nothing
 * in `selected` re-renders zero rows.
 *
 * `points` is passed as a plain value (undefined = not selected) rather than
 * the whole `selected` map, so a row only re-renders when ITS OWN selection
 * changes — selecting question #1 does not re-render questions #2…#1200.
 */
const QuestionRow = React.memo(function QuestionRow({
  question,
  points,
  onToggle,
  onChangePoints,
}: {
  question: Question;
  points: number | undefined;
  onToggle: (q: Question) => void;
  onChangePoints: (id: string, pts: string) => void;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  const isOn = points !== undefined;
  const isPast = !!(question as any).isPastQuestion;
  const pastYear = (question as any).pastQuestionYear;
  const pastSession = (question as any).pastQuestionSession;

  return (
    <Pressable
      onPress={() => onToggle(question)}
      style={[
        styles.qRow,
        isOn && styles.qRowOn,
        isPast && { borderLeftWidth: 3, borderLeftColor: colors.warning },
      ]}
    >
      <View style={[styles.check, isOn && styles.checkOn]}>
        {isOn && <Text style={styles.checkMark}>✓</Text>}
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {isPast && (
            <View style={styles.pastBadge}>
              <Text style={styles.pastBadgeText}>PAST {pastYear || ''}</Text>
            </View>
          )}
          <Text style={styles.qText} numberOfLines={2}>
            {question.questionText}
          </Text>
        </View>
        <View style={styles.qMetaRow}>
          <Text
            style={[
              styles.qDifficulty,
              { color: difficultyColor[question.difficulty] || colors.textMuted },
            ]}
          >
            {question.difficulty}
          </Text>
          <Text style={styles.qMeta}>· {question.points} pt</Text>
          {!!question.subject && <Text style={styles.qMeta}>· {question.subject}</Text>}
          {!!pastSession && <Text style={styles.qMeta}>· {pastSession}</Text>}
        </View>
        {isOn && (
          <View style={styles.pointsRow}>
            <Text style={styles.pointsLabel}>Points:</Text>
            <Pressable
              onPress={() => onChangePoints(question._id, String((points || 1) - 1))}
              style={styles.pointsBtn}
              accessibilityRole="button"
              accessibilityLabel={`Decrease points for ${question.questionText}`}
            >
              <Text style={styles.pointsBtnText}>−</Text>
            </Pressable>
            <Text style={styles.pointsValue}>{points}</Text>
            <Pressable
              onPress={() => onChangePoints(question._id, String((points || 1) + 1))}
              style={styles.pointsBtn}
              accessibilityRole="button"
              accessibilityLabel={`Increase points for ${question.questionText}`}
            >
              <Text style={styles.pointsBtnText}>+</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Pressable>
  );
});

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
  const styles = useThemedStyles(makeStyles);
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
  settingHelp: { fontSize: 12, color: colors.textMuted, lineHeight: 17, marginTop: -spacing.xs, marginBottom: spacing.sm },
  settingHint: { fontSize: 12, color: colors.textMuted, lineHeight: 18, marginBottom: spacing.sm },
  typeRow: { flexDirection: 'row', gap: spacing.md },
  typeOption: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    backgroundColor: colors.bg,
  },
  typeOptionActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  typeText: { fontSize: 14, fontWeight: '700', color: colors.textMuted },
  typeTextActive: { color: colors.primary },
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
  pastBadge: {
    backgroundColor: colors.warningLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  pastBadgeText: { fontSize: 9, fontWeight: '800', color: colors.warning },
  pointsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  pointsLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  pointsBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointsBtnText: { fontSize: 14, fontWeight: '800', color: colors.text },
  pointsValue: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    minWidth: 16,
    textAlign: 'center',
  },
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
  sourceBtn: { flex: 1, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, alignItems: 'center' },
  sourceBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  sourceText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  sourceTextActive: { color: colors.white },
});
