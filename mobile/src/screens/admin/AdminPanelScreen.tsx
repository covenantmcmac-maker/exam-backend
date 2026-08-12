import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Badge, Button, Card, Field, Loading, StatTile } from '../../components/ui';
import { adminApi, AdminPastStats } from '../../api/endpoints';
import type { AdminUserSort } from '../../api/endpoints';
import { formatFee } from '../../utils/payments';
import { buildCsv, downloadCsv } from '../../utils/csv';
import { useAuth } from '../../context/AuthContext';
import { useDialog } from '../../components/Dialog';
import type { NavigationProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../navigation/types';
import { radius, spacing } from '../../theme';
import { useColors } from '../../context/ThemeContext';
import type { Colors } from '../../theme';
import type {
  AdminPlatformConfig,
  AdminStats,
  Exam,
  ExamAttempt,
  Payment,
  Role,
  User,
  Question,
} from '../../api/types';

type Tab = 'overview' | 'users' | 'exams' | 'attempts' | 'payments' | 'past';

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'users', label: 'Users' },
  { key: 'exams', label: 'Exams' },
  { key: 'attempts', label: 'Attempts' },
  { key: 'payments', label: 'Payments' },
  { key: 'past', label: 'Past Qs 📚' },
];

const USER_PAGE_SIZE = 50;
const USER_SEARCH_DEBOUNCE_MS = 400;
const USER_SORTS: { value: AdminUserSort; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'name_asc', label: 'A–Z' },
  { value: 'name_desc', label: 'Z–A' },
];

const makeRoleTint = (colors: Colors): Record<string, { fg: string; bg: string }> => ({
  admin: { fg: colors.danger, bg: colors.dangerLight },
  teacher: { fg: colors.primary, bg: colors.primaryLight },
  student: { fg: colors.success, bg: colors.successLight },
});

export default function AdminPanelScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const roleTint = useMemo(() => makeRoleTint(colors), [colors]);
  const { user: me } = useAuth();
  const dialog = useDialog();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const [tab, setTab] = useState<Tab>('overview');
  const [stats, setStats] = useState<(AdminStats & any) | null>(null);
  const [platformConfig, setPlatformConfig] = useState<AdminPlatformConfig | null>(null);
  const [registrationFeeInput, setRegistrationFeeInput] = useState('0');
  const [configBusy, setConfigBusy] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [userPages, setUserPages] = useState(0);
  const [userPage, setUserPage] = useState(0);
  const [userSort, setUserSort] = useState<AdminUserSort>('newest');
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersLoadingMore, setUsersLoadingMore] = useState(false);
  const userRequestId = useRef(0);
  const [exams, setExams] = useState<Exam[]>([]);
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paymentTotals, setPaymentTotals] = useState({
    totalRevenue: 0,
    entryCount: 0,
    reviewCount: 0,
    registrationCount: 0,
  });
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  // Past Qs admin state
  const [pastQuestions, setPastQuestions] = useState<Question[]>([]);
  const [pastStats, setPastStats] = useState<AdminPastStats | null>(null);
  const [pastSearch, setPastSearch] = useState('');
  const [pastSubject, setPastSubject] = useState<string>('all');
  const [pastYear, setPastYear] = useState<string>('all');
  const [pastSelected, setPastSelected] = useState<Record<string, true>>({});
  const [pastLoading, setPastLoading] = useState(false);

  const loadUsers = useCallback(async (page = 1, append = false) => {
    const requestId = ++userRequestId.current;
    if (append) {
      setUsersLoadingMore(true);
    } else {
      setUsersLoading(true);
      setUsers([]);
      setUserTotal(0);
      setUserPages(0);
      setUserPage(0);
    }

    try {
      const result = await adminApi.users({
        page,
        limit: USER_PAGE_SIZE,
        sort: userSort,
        search: debouncedSearch || undefined,
      });
      // Search/sort can change while a request is in flight. Only the newest
      // response is allowed to replace or append to the visible directory.
      if (requestId !== userRequestId.current) return;

      setUsers((previous) => {
        if (!append) return result.users;
        const seen = new Set(previous.map((u) => String(u._id || u.id)));
        return [
          ...previous,
          ...result.users.filter((u) => !seen.has(String(u._id || u.id))),
        ];
      });
      setUserTotal(result.total);
      setUserPages(result.pages);
      setUserPage(page);
    } catch (err) {
      if (requestId === userRequestId.current) {
        void dialog.notify('Error', err instanceof Error ? err.message : 'Could not load users.');
      }
    } finally {
      if (requestId === userRequestId.current) {
        setUsersLoading(false);
        setUsersLoadingMore(false);
      }
    }
  }, [debouncedSearch, dialog, userSort]);

  const load = useCallback(async () => {
    try {
      const [s, cfg, e, a, p] = await Promise.all([
        adminApi.stats(),
        adminApi.config(),
        adminApi.exams(),
        adminApi.attempts(),
        adminApi.payments(),
      ]);
      setStats(s);
      setPlatformConfig(cfg);
      setRegistrationFeeInput(String(cfg.studentRegistrationFee ?? 0));
      setExams(e);
      setAttempts(a);
      setPayments(p.payments);
      setPaymentTotals(p.totals);
    } catch (err) {
      void dialog.notify('Error', err instanceof Error ? err.message : 'Could not load admin data.');
    } finally {
      setLoading(false);
    }
  }, [dialog]);

  const loadPast = useCallback(async () => {
    try {
      setPastLoading(true);
      const [list, pst] = await Promise.all([
        adminApi.pastQuestions({
          search: pastSearch.trim() || undefined,
          subject: pastSubject !== 'all' ? pastSubject : undefined,
          year: pastYear !== 'all' ? pastYear : undefined,
          limit: '200',
        }),
        adminApi.pastStats(),
      ]);
      setPastQuestions(list.questions);
      setPastStats(pst);
    } catch (err) {
      void dialog.notify('Error', err instanceof Error ? err.message : 'Could not load past questions.');
    } finally {
      setPastLoading(false);
    }
  }, [dialog, pastSearch, pastSubject, pastYear]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedSearch(search.trim()),
      USER_SEARCH_DEBOUNCE_MS
    );
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    void loadUsers(1, false);
  }, [loadUsers]);

  useEffect(() => {
    if (tab === 'past') {
      void loadPast();
    }
  }, [tab, loadPast]);

  const onRefresh = async () => {
    setRefreshing(true);
    const requests: Promise<void>[] = [load(), loadUsers(1, false)];
    if (tab === 'past') requests.push(loadPast());
    await Promise.all(requests);
    setRefreshing(false);
  };

  const myId = me?.id || me?._id;

  const changeRole = async (u: User) => {
    const id = u._id || u.id;
    if (!id) return;
    const roles: Role[] = ['student', 'teacher', 'admin'];
    const next = await dialog.choose<Role>(
      'Change role',
      `Set a new role for ${u.name}.`,
      roles
        .filter((r) => r !== u.role)
        .map((r) => ({ label: r.charAt(0).toUpperCase() + r.slice(1), value: r }))
    );
    if (!next) return;
    try {
      await adminApi.changeRole(id, next);
      setUsers((prev) => prev.map((x) => ((x._id || x.id) === id ? { ...x, role: next } : x)));
      setStats((previous: (AdminStats & any) | null) => {
        if (!previous) return previous;
        const countKey = (role: Role) => role === 'student'
          ? 'totalStudents'
          : role === 'teacher'
            ? 'totalTeachers'
            : 'totalAdmins';
        const oldKey = countKey(u.role);
        const newKey = countKey(next);
        return {
          ...previous,
          [oldKey]: Math.max(0, (previous[oldKey] || 0) - 1),
          [newKey]: (previous[newKey] || 0) + 1,
        };
      });
    } catch (e) {
      void dialog.notify('Error', e instanceof Error ? e.message : 'Update failed.');
    }
  };

  const deleteUser = async (u: User) => {
    const id = u._id || u.id;
    if (!id) return;
    const ok = await dialog.confirm('Delete user?', `${u.name} will be permanently removed.`, {
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminApi.removeUser(id);
      // Offset pages shift after a deletion. Restarting at page one prevents a
      // user at the old page boundary from being skipped by the next load.
      await loadUsers(1, false);
      setStats((previous: (AdminStats & any) | null) => {
        if (!previous) return previous;
        const roleCountKey = u.role === 'student'
          ? 'totalStudents'
          : u.role === 'teacher'
            ? 'totalTeachers'
            : 'totalAdmins';
        return {
          ...previous,
          totalUsers: Math.max(0, (previous.totalUsers || 0) - 1),
          [roleCountKey]: Math.max(0, (previous[roleCountKey] || 0) - 1),
        };
      });
    } catch (e) {
      void dialog.notify('Error', e instanceof Error ? e.message : 'Delete failed.');
    }
  };

  const deleteExam = async (exam: Exam) => {
    const ok = await dialog.confirm(
      'Delete exam?',
      `“${exam.title}” and all attempts will be removed.`,
      { confirmLabel: 'Delete', destructive: true }
    );
    if (!ok) return;
    try {
      await adminApi.removeExam(exam._id);
      setExams((prev) => prev.filter((e) => e._id !== exam._id));
    } catch (e) {
      void dialog.notify('Error', e instanceof Error ? e.message : 'Delete failed.');
    }
  };

  const deleteAttempt = async (a: ExamAttempt) => {
    const ok = await dialog.confirm(
      'Delete attempt?',
      'The student will be able to retake this exam.',
      { confirmLabel: 'Delete', destructive: true }
    );
    if (!ok) return;
    try {
      await adminApi.removeAttempt(a._id);
      setAttempts((prev) => prev.filter((x) => x._id !== a._id));
    } catch (e) {
      void dialog.notify('Error', e instanceof Error ? e.message : 'Delete failed.');
    }
  };

  const notifyDownloadUnavailable = (what: string) =>
    void dialog.notify(
      'Download unavailable',
      `CSV downloads are available in the web/PWA version. Open the app in a browser to download ${what}.`
    );

  /** Platform-wide results export: every attempt across every exam. */
  const downloadAttempts = () => {
    const csv = buildCsv(
      [
        'Student name',
        'Student email',
        'Exam',
        'Subject',
        'Score',
        'Total points',
        'Percentage',
        'Status',
        'Started',
        'Completed',
        'Time spent (seconds)',
      ],
      attempts.map((a) => {
        const student = typeof a.student === 'object' ? a.student : null;
        const exam = typeof a.exam === 'object' ? a.exam : null;
        return [
          student?.name || 'Student',
          student?.email || '',
          exam?.title || 'Exam',
          exam?.subject || '',
          a.score ?? 0,
          a.totalPoints ?? 0,
          `${Math.round(a.percentage || 0)}%`,
          a.status,
          a.startedAt ? new Date(a.startedAt).toLocaleString() : '',
          a.completedAt ? new Date(a.completedAt).toLocaleString() : '',
          a.timeSpent ?? '',
        ];
      })
    );

    if (!downloadCsv('all-exam-results.csv', csv)) {
      notifyDownloadUnavailable('results');
    }
  };

  /** Revenue export: one row per payment, for reconciliation against Paystack. */
  const downloadPayments = () => {
    const csv = buildCsv(
      [
        'Student name',
        'Student email',
        'Item',
        'Purpose',
        'Amount',
        'Currency',
        'Status',
        'Reference',
        'Created',
        'Paid at',
      ],
      payments.map((p) => {
        const student = typeof p.student === 'object' ? p.student : null;
        const exam = typeof p.exam === 'object' ? p.exam : null;
        return [
          student?.name || 'Student',
          student?.email || '',
          exam?.title || 'Student registration',
          p.purpose,
          p.amount,
          p.currency,
          p.status,
          p.reference || '',
          p.createdAt ? new Date(p.createdAt).toLocaleString() : '',
          p.paidAt ? new Date(p.paidAt).toLocaleString() : '',
        ];
      })
    );

    if (!downloadCsv('payments.csv', csv)) {
      notifyDownloadUnavailable('payments');
    }
  };

  const saveRegistrationConfig = async (updates: Partial<AdminPlatformConfig>) => {
    setConfigBusy(true);
    try {
      const res = await adminApi.updateConfig(updates);
      setPlatformConfig(res.config);
      setRegistrationFeeInput(String(res.config.studentRegistrationFee ?? 0));
      setStats((prev: (AdminStats & any) | null) =>
        prev
          ? {
              ...prev,
              registration: res.config,
            }
          : prev
      );
      await dialog.notify('Saved', res.message);
    } catch (e) {
      void dialog.notify('Error', e instanceof Error ? e.message : 'Could not save configuration.');
    } finally {
      setConfigBusy(false);
    }
  };

  const resetUserPassword = async (u: User) => {
    const id = u._id || u.id;
    if (!id) return;
    const ok = await dialog.confirm(
      'Reset password?',
      `Reset ${u.name}'s password to 123456? They will be required to change it on next sign-in.`,
      { confirmLabel: 'Reset', destructive: true }
    );
    if (!ok) return;
    try {
      const res = await adminApi.resetUserPassword(id);
      setUsers((prev) =>
        prev.map((x) =>
          (x._id || x.id) === id ? { ...x, mustChangePassword: true } : x
        )
      );
      await dialog.notify('Password reset', res.message);
    } catch (e) {
      void dialog.notify('Error', e instanceof Error ? e.message : 'Reset failed.');
    }
  };

  const resetAllStudentPasswords = async () => {
    const totalStudents = stats?.totalStudents ?? users.filter((u) => u.role === 'student').length;
    const ok = await dialog.confirm(
      'Reset all student passwords?',
      `This will reset all ${totalStudents} student accounts to 123456 across every page and search result — not only the ${users.length} user(s) currently loaded. Are you sure?`,
      { confirmLabel: 'Reset all', destructive: true }
    );
    if (!ok) return;

    setResetBusy(true);
    try {
      const res = await adminApi.resetAllStudentPasswords();
      setUsers((prev) =>
        prev.map((u) => (u.role === 'student' ? { ...u, mustChangePassword: true } : u))
      );
      await dialog.notify('Student passwords reset', res.message);
    } catch (e) {
      void dialog.notify('Error', e instanceof Error ? e.message : 'Bulk reset failed.');
    } finally {
      setResetBusy(false);
    }
  };

  // Past admin actions
  const pastSelectedIds = Object.keys(pastSelected);

  const togglePastSelect = (id: string) => {
    setPastSelected((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = true;
      return next;
    });
  };

  const deletePastOne = async (q: Question) => {
    const ok = await dialog.confirm('Delete past question?', `"${q.questionText.slice(0, 60)}..." will be permanently removed.`, {
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminApi.removePastQuestion(q._id);
      setPastQuestions((prev) => prev.filter((x) => x._id !== q._id));
    } catch (e) {
      void dialog.notify('Error', e instanceof Error ? e.message : 'Delete failed.');
    }
  };

  const restorePastOne = async (q: Question) => {
    try {
      await adminApi.restorePastQuestion(q._id);
      setPastQuestions((prev) => prev.filter((x) => x._id !== q._id));
      void dialog.notify('Restored', 'Question restored to active bank.');
    } catch (e) {
      void dialog.notify('Error', e instanceof Error ? e.message : 'Restore failed.');
    }
  };

  const bulkDeletePast = async () => {
    if (pastSelectedIds.length === 0) return;
    const ok = await dialog.confirm('Delete past questions?', `${pastSelectedIds.length} past question(s) will be permanently removed.`, {
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminApi.bulkDeletePast(pastSelectedIds);
      setPastQuestions((prev) => prev.filter((q) => !pastSelected[q._id]));
      setPastSelected({});
    } catch (e) {
      void dialog.notify('Error', e instanceof Error ? e.message : 'Bulk delete failed.');
    }
  };

  const bulkRestorePast = async () => {
    if (pastSelectedIds.length === 0) return;
    const ok = await dialog.confirm('Restore past questions?', `${pastSelectedIds.length} question(s) will be restored to active bank.`, {
      confirmLabel: 'Restore',
    });
    if (!ok) return;
    try {
      await adminApi.bulkRestorePast(pastSelectedIds);
      setPastQuestions((prev) => prev.filter((q) => !pastSelected[q._id]));
      setPastSelected({});
      void dialog.notify('Restored', `${pastSelectedIds.length} questions restored.`);
    } catch (e) {
      void dialog.notify('Error', e instanceof Error ? e.message : 'Restore failed.');
    }
  };

  const hasMoreUsers = userPage < userPages && users.length < userTotal;
  const searchIsDebouncing = search.trim() !== debouncedSearch;

  const subjects = useMemo(() => {
    const map = new Map<string, number>();
    if (pastStats?.bySubject) {
      pastStats.bySubject.forEach((s) => map.set(s._id || 'Unspecified', s.count));
    } else {
      for (const q of pastQuestions) {
        const s = (q.subject || 'Unspecified').trim();
        map.set(s, (map.get(s) ?? 0) + 1);
      }
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [pastQuestions, pastStats]);

  const years = useMemo(() => {
    if (pastStats?.byYear) return pastStats.byYear.map((y) => ({ label: String(y._id), count: y.count }));
    const set = new Map<number, number>();
    for (const q of pastQuestions) {
      if (q.pastQuestionYear) set.set(q.pastQuestionYear, (set.get(q.pastQuestionYear) ?? 0) + 1);
    }
    return [...set.entries()].sort((a, b) => b[0] - a[0]).map(([y, c]) => ({ label: String(y), count: c }));
  }, [pastQuestions, pastStats]);

  const filteredPast = useMemo(() => {
    if (pastSubject === 'all' && pastYear === 'all') return pastQuestions;
    return pastQuestions.filter((q) => {
      const matchSubject = pastSubject === 'all' || (q.subject || 'Unspecified') === pastSubject;
      const matchYear = pastYear === 'all' || String(q.pastQuestionYear || '') === pastYear;
      return matchSubject && matchYear;
    });
  }, [pastQuestions, pastSubject, pastYear]);

  if (loading) return <Loading text="Loading admin data…" />;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabStrip}
        contentContainerStyle={styles.tabStripInner}
      >
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.tab, active && styles.tabActive]}>
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        keyboardShouldPersistTaps="handled"
      >
        {tab === 'overview' && (
          <>
            <View style={styles.statRow}>
              <StatTile label="Users" value={stats?.totalUsers ?? 0} />
              <StatTile label="Students" value={stats?.totalStudents ?? 0} tint={colors.success} />
              <StatTile label="Teachers" value={stats?.totalTeachers ?? 0} tint={colors.accent} />
            </View>
            <View style={[styles.statRow, { marginTop: spacing.md }]}>
              <StatTile label="Admins" value={stats?.totalAdmins ?? 0} tint={colors.danger} />
              <StatTile label="Exams" value={stats?.totalExams ?? 0} />
              <StatTile label="Questions" value={stats?.totalQuestions ?? 0} tint={colors.warning} />
            </View>
            <View style={[styles.statRow, { marginTop: spacing.md }]}>
              <StatTile label="Active Qs" value={(stats as any)?.totalActiveQuestions ?? 0} />
              <StatTile label="Past Qs" value={(stats as any)?.totalPastQuestions ?? pastStats?.totalPast ?? 0} tint={colors.warning} />
              <StatTile label="Attempts" value={stats?.totalAttempts ?? 0} />
            </View>

            {(stats as any)?.pastByYear?.length > 0 && (
              <Card style={{ marginTop: spacing.lg }}>
                <Text style={styles.cardTitle}>📚 Past Questions by Year</Text>
                {((stats as any).pastByYear as { _id: number; count: number }[]).map((y) => (
                  <View key={y._id} style={styles.statLine}>
                    <Text style={styles.statLineLabel}>{y._id}</Text>
                    <Text style={styles.statLineValue}>{y.count}</Text>
                  </View>
                ))}
              </Card>
            )}

            {(stats as any)?.pastBySubject?.length > 0 && (
              <Card>
                <Text style={styles.cardTitle}>📘 Past by Subject</Text>
                {((stats as any).pastBySubject as { _id: string; count: number }[]).map((s) => (
                  <View key={s._id || 'unspec'} style={styles.statLine}>
                    <Text style={styles.statLineLabel}>{s._id || 'Unspecified'}</Text>
                    <Text style={styles.statLineValue}>{s.count}</Text>
                  </View>
                ))}
              </Card>
            )}

            <View style={[styles.statRow, { marginTop: spacing.md }]}>
              <StatTile label="Completed" value={stats?.completedAttempts ?? 0} tint={colors.success} />
            </View>

            <Text style={styles.sectionLabel}>Revenue</Text>
            <View style={styles.statRow}>
              <StatTile
                label={`Total (${(stats as any)?.payments?.currency || 'NGN'})`}
                value={((stats as any)?.payments?.totalRevenue ?? 0).toLocaleString()}
                tint={colors.success}
              />
              <StatTile label="Entry fees" value={(stats as any)?.payments?.entryCount ?? 0} tint={colors.primary} />
              <StatTile label="Review fees" value={(stats as any)?.payments?.reviewCount ?? 0} tint={colors.warning} />
            </View>
            <View style={[styles.statRow, { marginTop: spacing.md }]}>
              <StatTile
                label="Registration pays"
                value={(stats as any)?.payments?.registrationCount ?? 0}
                tint={colors.accent}
              />
              <StatTile
                label="Registration revenue"
                value={((stats as any)?.payments?.registrationRevenue ?? 0).toLocaleString()}
                tint={colors.accent}
              />
            </View>
            <Text style={styles.sectionNote}>Revenue includes student registration, entry, and review payments.</Text>
          </>
        )}

        {tab === 'users' && (
          <>
            <Card>
              <Text style={styles.cardTitle}>Student registration fee</Text>
              <Text style={styles.sub}>
                Current fee: {formatFee(platformConfig?.studentRegistrationFee ?? 0)}
              </Text>
              <Field
                label="Fee amount (₦)"
                value={registrationFeeInput}
                onChangeText={setRegistrationFeeInput}
                keyboardType="numeric"
                placeholder="0"
              />
              <View style={styles.actions}>
                <Button
                  title="Save fee"
                  size="sm"
                  style={{ flex: 1 }}
                  loading={configBusy}
                  onPress={() =>
                    void saveRegistrationConfig({
                      studentRegistrationFee: Math.max(0, Number(registrationFeeInput) || 0),
                    })
                  }
                />
                <Button
                  title="Clear fee"
                  variant="ghost"
                  size="sm"
                  style={{ flex: 1 }}
                  loading={configBusy}
                  onPress={() => {
                    setRegistrationFeeInput('0');
                    void saveRegistrationConfig({ studentRegistrationFee: 0 });
                  }}
                />
              </View>
              <View style={styles.actions}>
                <Button
                  title={
                    platformConfig?.applyRegistrationFeeToExistingStudents === false
                      ? 'Existing students exempt'
                      : 'Apply to existing students'
                  }
                  variant={
                    platformConfig?.applyRegistrationFeeToExistingStudents === false
                      ? 'secondary'
                      : 'danger'
                  }
                  size="sm"
                  style={{ flex: 1 }}
                  loading={configBusy}
                  onPress={() =>
                    void saveRegistrationConfig({
                      applyRegistrationFeeToExistingStudents:
                        !(platformConfig?.applyRegistrationFeeToExistingStudents !== false),
                    })
                  }
                />
              </View>
              <Text style={styles.sectionNote}>
                When turned off, students created before the fee was enabled can keep signing in
                without paying it.
              </Text>
            </Card>

            <Card style={styles.dangerCard}>
              <Text style={styles.cardTitle}>Danger zone</Text>
              <Text style={styles.sub}>
                Reset all student passwords to 123456 so old guest-code users can sign in again.
              </Text>
              <Text style={styles.sectionNote}>
                This affects all {stats?.totalStudents ?? 0} student account(s) across every page and
                search result, not only the loaded list. Teachers and admins are excluded.
              </Text>
              <Button
                title="Reset all student passwords to 123456"
                variant="danger"
                loading={resetBusy}
                onPress={() => void resetAllStudentPasswords()}
              />
            </Card>

            <Text style={styles.sectionLabel}>User directory</Text>
            <Field value={search} onChangeText={setSearch} placeholder="Search all users…" />
            <View style={styles.userSortRow}>
              <Text style={styles.userSortLabel}>Sort</Text>
              {USER_SORTS.map((option) => {
                const active = userSort === option.value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => setUserSort(option.value)}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.showing}>
              {debouncedSearch
                ? `Loaded ${users.length} of ${userTotal} matching users (${stats?.totalUsers ?? userTotal} total accounts)`
                : `Loaded ${users.length} of ${userTotal} users`}
            </Text>
            {searchIsDebouncing && (
              <Text style={styles.userSearchStatus}>Waiting to search all users…</Text>
            )}

            {usersLoading && <Loading text="Loading users…" />}
            {!usersLoading && users.map((u) => {
              const id = u._id || u.id;
              const tint = roleTint[u.role] || roleTint.student;
              const isMe = id === myId;
              return (
                <Card key={id}>
                  <View style={styles.rowTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{u.name} {isMe ? '(you)' : ''}</Text>
                      <Text style={styles.sub}>{u.email}</Text>
                      {u.mustChangePassword && (
                        <Text style={styles.resetNote}>Must change password on next sign-in</Text>
                      )}
                    </View>
                    <Badge text={u.role.toUpperCase()} color={tint.fg} bg={tint.bg} />
                  </View>
                  {!isMe && (
                    <View style={styles.actions}>
                      <Button title="Change role" variant="ghost" size="sm" style={{ flex: 1 }} onPress={() => changeRole(u)} />
                      <Button title="Reset to 123456" variant="secondary" size="sm" style={{ flex: 1 }} onPress={() => resetUserPassword(u)} />
                      <Button title="Delete" variant="danger" size="sm" style={{ flex: 1 }} onPress={() => deleteUser(u)} />
                    </View>
                  )}
                </Card>
              );
            })}
            {!usersLoading && users.length === 0 && (
              <Card>
                <Text style={styles.emptyText}>
                  {debouncedSearch ? 'No users match this search.' : 'No users found.'}
                </Text>
              </Card>
            )}
            {!usersLoading && hasMoreUsers && (
              <Button
                title={`Load more (${userTotal - users.length} remaining)`}
                variant="secondary"
                loading={usersLoadingMore}
                onPress={() => void loadUsers(userPage + 1, true)}
              />
            )}
          </>
        )}

        {tab === 'exams' && (
          <>
            <View style={styles.rowTop}>
              <Text style={styles.sectionLabel}>All exams</Text>
              <Button title="+ New past paper" variant="secondary" size="sm" onPress={() => navigation.navigate('ExamBuilder', { source: 'past' })} />
            </View>
            {exams.map((e) => {
              const creator = typeof e.creator === 'object' ? e.creator : null;
              const isPast = (e as any).source === 'past';
              const entry = (e as any).pricing?.entryFee || 0;
              const review = (e as any).pricing?.reviewFee || 0;
              return (
                <Card key={e._id}>
                  <View style={styles.rowTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{e.title}{!!(e as any).year && ` (${(e as any).year})`}</Text>
                      <Text style={styles.sub}>by {creator?.name || 'Unknown'} · {e.questions?.length ?? 0} questions{isPast ? ` · entry ${entry}, review ${review}` : review > 0 ? ` · review ${review}` : ''}</Text>
                    </View>
                    <View style={{ gap: spacing.xs, alignItems: 'flex-end' }}>
                      <Badge text={isPast ? 'PAST' : 'TEACHER'} color={isPast ? colors.warning : colors.primary} bg={isPast ? colors.warningLight : colors.primaryLight} />
                      <Badge text={e.settings?.isPublished ? 'LIVE' : 'DRAFT'} color={e.settings?.isPublished ? colors.success : colors.warning} bg={e.settings?.isPublished ? colors.successLight : colors.warningLight} />
                    </View>
                  </View>
                  <Button title="Delete exam" variant="danger" size="sm" style={{ marginTop: spacing.md, alignSelf: 'flex-start' }} onPress={() => deleteExam(e)} />
                </Card>
              );
            })}
          </>
        )}

        {tab === 'attempts' && (
          <View style={styles.rowTop}>
            <Text style={styles.sectionLabel}>All attempts ({attempts.length})</Text>
            <Button
              title="Download CSV"
              variant="ghost"
              size="sm"
              disabled={attempts.length === 0}
              onPress={downloadAttempts}
            />
          </View>
        )}

        {tab === 'attempts' &&
          attempts.map((a) => {
            const student = typeof a.student === 'object' ? a.student : null;
            const exam = typeof a.exam === 'object' ? a.exam : null;
            return (
              <Card key={a._id}>
                <View style={styles.rowTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{student?.name || 'Student'}</Text>
                    <Text style={styles.sub}>{exam?.title || 'Exam'}</Text>
                  </View>
                  <Text style={styles.score}>{Math.round(a.percentage || 0)}%</Text>
                </View>
                <Button title="Delete attempt" variant="danger" size="sm" style={{ marginTop: spacing.md, alignSelf: 'flex-start' }} onPress={() => deleteAttempt(a)} />
              </Card>
            );
          })}

        {tab === 'payments' && (
          <>
            <View style={styles.rowTop}>
              <Text style={styles.sectionLabel}>Payments ({payments.length})</Text>
              <Button
                title="Download CSV"
                variant="ghost"
                size="sm"
                disabled={payments.length === 0}
                onPress={downloadPayments}
              />
            </View>
            <View style={styles.statRow}>
              <StatTile label="Revenue" value={paymentTotals.totalRevenue.toLocaleString()} tint={colors.success} />
              <StatTile label="Entry pays" value={paymentTotals.entryCount} tint={colors.primary} />
              <StatTile label="Review pays" value={paymentTotals.reviewCount} tint={colors.warning} />
            </View>
            <View style={[styles.statRow, { marginTop: spacing.md }]}>
              <StatTile label="Registration pays" value={paymentTotals.registrationCount} tint={colors.accent} />
            </View>
            {payments.length === 0 && <Text style={styles.emptyNote}>No payments yet.</Text>}
            {payments.map((p) => {
              const student = typeof p.student === 'object' ? p.student : null;
              const exam = typeof p.exam === 'object' ? p.exam : null;
              const isEntry = p.purpose === 'entry';
              const paid = p.status === 'paid';
              return (
                <Card key={p._id}>
                  <View style={styles.rowTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{student?.name || 'Student'} · {p.amount} {p.currency}</Text>
                      <Text style={styles.sub}>{exam?.title || 'Student registration'} · {p.purpose === 'registration' ? 'Registration fee' : isEntry ? 'Entry fee' : 'Review fee'} · {new Date(p.createdAt || '').toLocaleDateString()}</Text>
                      <Text style={styles.sub}>Ref {p.reference}</Text>
                    </View>
                    <Badge text={paid ? 'PAID' : p.status.toUpperCase()} color={paid ? colors.success : p.status === 'pending' ? colors.warning : colors.danger} bg={paid ? colors.successLight : p.status === 'pending' ? colors.warningLight : colors.dangerLight} />
                  </View>
                </Card>
              );
            })}
          </>
        )}

        {tab === 'past' && (
          <>
            {pastLoading && <Loading text="Loading past questions…" />}
            {pastStats && (
              <>
                <View style={styles.statRow}>
                  <StatTile label="Total Past" value={pastStats.totalPast} tint={colors.warning} />
                  <StatTile label="Subjects" value={pastStats.bySubject.length} />
                  <StatTile label="Years" value={pastStats.byYear.length} tint={colors.accent} />
                </View>
                <View style={[styles.statRow, { marginTop: spacing.md }]}>
                  <StatTile label="Sessions" value={pastStats.bySession.length} />
                  <StatTile label="Exam Types" value={pastStats.byExamType.length} tint={colors.primary} />
                  <StatTile label="Difficulties" value={pastStats.byDifficulty.length} />
                </View>

                <Card style={{ marginTop: spacing.lg }}>
                  <Text style={styles.cardTitle}>By Year</Text>
                  {pastStats.byYear.slice(0, 8).map((y) => (
                    <View key={y._id} style={styles.statLine}>
                      <Text style={styles.statLineLabel}>{y._id}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                        <View style={[styles.bar, { width: Math.min(80, y.count * 4), backgroundColor: colors.warning }]} />
                        <Text style={styles.statLineValue}>{y.count}</Text>
                      </View>
                    </View>
                  ))}
                </Card>

                <Card>
                  <Text style={styles.cardTitle}>By Subject</Text>
                  {pastStats.bySubject.slice(0, 8).map((s) => (
                    <View key={s._id || 'unspec'} style={styles.statLine}>
                      <Text style={styles.statLineLabel}>{s._id || 'Unspecified'}</Text>
                      <Text style={styles.statLineValue}>{s.count}</Text>
                    </View>
                  ))}
                </Card>

                <Card>
                  <Text style={styles.cardTitle}>Top Teachers</Text>
                  {pastStats.byTeacher.slice(0, 5).map((t) => (
                    <View key={t._id} style={styles.statLine}>
                      <View>
                        <Text style={styles.statLineLabel}>{t.name || 'Unknown'}</Text>
                        <Text style={styles.subSmall}>{t.email || ''}</Text>
                      </View>
                      <Text style={styles.statLineValue}>{t.count}</Text>
                    </View>
                  ))}
                </Card>

                {pastStats.bySession.length > 0 && (
                  <Card>
                    <Text style={styles.cardTitle}>By Session</Text>
                    {pastStats.bySession.map((s) => (
                      <View key={s._id} style={styles.statLine}>
                        <Text style={styles.statLineLabel}>{s._id}</Text>
                        <Text style={styles.statLineValue}>{s.count}</Text>
                      </View>
                    ))}
                  </Card>
                )}

                {pastStats.recent?.length > 0 && (
                  <Card>
                    <Text style={styles.cardTitle}>Recently Archived</Text>
                    {pastStats.recent.map((r) => (
                      <View key={r._id} style={styles.recentRow}>
                        <Text style={styles.recentText} numberOfLines={1}>{r.questionText}</Text>
                        <Text style={styles.subSmall}>{r.subject || ''} {r.pastQuestionYear ? `· ${r.pastQuestionYear}` : ''} · {r.creator?.name || ''} · {r.movedToPastAt ? new Date(r.movedToPastAt).toLocaleDateString() : ''}</Text>
                      </View>
                    ))}
                  </Card>
                )}
              </>
            )}

            <View style={styles.pastControls}>
              <Field value={pastSearch} onChangeText={setPastSearch} placeholder="Search past questions…" />
              <View style={styles.filterRow}>
                <Pressable onPress={() => setPastSubject('all')} style={[styles.chip, pastSubject === 'all' && styles.chipActive]}>
                  <Text style={[styles.chipText, pastSubject === 'all' && styles.chipTextActive]}>All Subjects</Text>
                </Pressable>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, flexDirection: 'row' }}>
                  {subjects.slice(0, 10).map(([name, count]) => (
                    <Pressable key={name} onPress={() => setPastSubject(name)} style={[styles.chip, pastSubject === name && styles.chipActive]}>
                      <Text style={[styles.chipText, pastSubject === name && styles.chipTextActive]}>{name} ({count})</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>

              <View style={styles.filterRow}>
                <Pressable onPress={() => setPastYear('all')} style={[styles.chip, pastYear === 'all' && styles.chipActive]}>
                  <Text style={[styles.chipText, pastYear === 'all' && styles.chipTextActive]}>All Years</Text>
                </Pressable>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, flexDirection: 'row' }}>
                  {years.map((y) => (
                    <Pressable key={y.label} onPress={() => setPastYear(y.label)} style={[styles.chip, pastYear === y.label && styles.chipActive]}>
                      <Text style={[styles.chipText, pastYear === y.label && styles.chipTextActive]}>{y.label} ({y.count})</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>

              {pastSelectedIds.length > 0 && (
                <View style={styles.bulkBar}>
                  <Text style={styles.bulkText}>{pastSelectedIds.length} selected</Text>
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <Button title={`Restore ${pastSelectedIds.length}`} size="sm" onPress={bulkRestorePast} />
                    <Button title={`Delete ${pastSelectedIds.length}`} variant="danger" size="sm" onPress={bulkDeletePast} />
                    <Button title="Clear" variant="ghost" size="sm" onPress={() => setPastSelected({})} />
                  </View>
                </View>
              )}

              <Text style={styles.showing}>Showing {filteredPast.length} of {pastQuestions.length} past questions</Text>
            </View>

            {filteredPast.map((q) => {
              const creator = typeof q.creator === 'object' ? (q.creator as any) : null;
              const selected = !!pastSelected[q._id];
              return (
                <Card key={q._id} style={selected ? { borderColor: colors.primary, backgroundColor: colors.primaryLight } : undefined}>
                  <Pressable onPress={() => togglePastSelect(q._id)} style={styles.rowTop}>
                    <View style={[styles.check, selected && styles.checkOn]}>
                      {selected && <Text style={styles.checkMark}>✓</Text>}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name} numberOfLines={2}>{q.questionText}</Text>
                      <Text style={styles.sub}>{q.subject || 'No subject'} · {q.difficulty} · {q.points}pt · Year: {q.pastQuestionYear || '—'} {q.pastQuestionSession ? `· ${q.pastQuestionSession}` : ''} {q.pastQuestionExamType ? `· ${q.pastQuestionExamType}` : ''}</Text>
                      <Text style={styles.subSmall}>by {creator?.name || 'Unknown'} · archived {q.movedToPastAt ? new Date(q.movedToPastAt).toLocaleDateString() : ''}</Text>
                    </View>
                  </Pressable>
                  <View style={styles.actions}>
                    <Button title="Restore" variant="secondary" size="sm" style={{ flex: 1 }} onPress={() => restorePastOne(q)} />
                    <Button title="Delete" variant="danger" size="sm" style={{ flex: 1 }} onPress={() => deletePastOne(q)} />
                  </View>
                </Card>
              );
            })}

            {filteredPast.length === 0 && !pastLoading && (
              <Card>
                <Text style={styles.emptyText}>No past questions match filters.</Text>
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  tabStrip: { maxHeight: 56, backgroundColor: colors.card },
  tabStripInner: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.sm, alignItems: 'center' },
  tab: { paddingHorizontal: spacing.lg, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.bg },
  tabActive: { backgroundColor: colors.primary },
  tabText: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
  tabTextActive: { color: colors.white },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  statRow: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  name: { fontSize: 15, fontWeight: '700', color: colors.text },
  sub: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  subSmall: { fontSize: 11, color: colors.textLight, marginTop: 2 },
  score: { fontSize: 16, fontWeight: '800', color: colors.primary },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  cardTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: spacing.md },
  statLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.md },
  statLineLabel: { fontSize: 14, color: colors.text, fontWeight: '600', flex: 1 },
  statLineValue: { fontSize: 14, fontWeight: '800', color: colors.primary },
  bar: { height: 6, borderRadius: 3 },
  recentRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  recentText: { fontSize: 13, color: colors.text, fontWeight: '600' },
  pastControls: { marginTop: spacing.lg },
  filterRow: { marginTop: spacing.md, gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, alignSelf: 'flex-start' },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  chipTextActive: { color: colors.white },
  userSortRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  userSortLabel: { fontSize: 13, color: colors.textMuted, fontWeight: '700', marginRight: spacing.xs },
  userSearchStatus: { fontSize: 12, color: colors.primary, marginBottom: spacing.sm },
  bulkBar: { marginTop: spacing.md, padding: spacing.md, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.md },
  bulkText: { fontSize: 13, fontWeight: '700', color: colors.text },
  showing: { fontSize: 12, color: colors.textMuted, marginTop: spacing.sm, marginBottom: spacing.sm },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkMark: { color: colors.white, fontSize: 13, fontWeight: '900' },
  emptyText: { fontSize: 14, color: colors.textMuted, textAlign: 'center' },
  sectionLabel: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: spacing.md, marginTop: spacing.sm },
  sectionNote: { fontSize: 12, color: colors.textLight, marginTop: spacing.sm },
  dangerCard: { borderColor: colors.danger, backgroundColor: colors.dangerLight },
  resetNote: { fontSize: 12, color: colors.warning, marginTop: 4, fontWeight: '700' },
  emptyNote: { fontSize: 14, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl, lineHeight: 21 },
});
