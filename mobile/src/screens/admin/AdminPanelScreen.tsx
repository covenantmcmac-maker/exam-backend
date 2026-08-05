import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { adminApi } from '../../api/endpoints';
import { useAuth } from '../../context/AuthContext';
import { useDialog } from '../../components/Dialog';
import type { NavigationProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../navigation/types';
import { radius, spacing } from '../../theme';
import { useColors } from '../../context/ThemeContext';
import type { Colors } from '../../theme';
import type {
  AdminPaymentsResult,
  AdminStats,
  Exam,
  ExamAttempt,
  Payment,
  Role,
  User,
} from '../../api/types';

type Tab = 'overview' | 'users' | 'exams' | 'attempts' | 'payments';

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'users', label: 'Users' },
  { key: 'exams', label: 'Exams' },
  { key: 'attempts', label: 'Attempts' },
  { key: 'payments', label: 'Payments' },
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
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paymentTotals, setPaymentTotals] = useState({
    totalRevenue: 0,
    entryCount: 0,
    reviewCount: 0,
  });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, u, e, a, p] = await Promise.all([
        adminApi.stats(),
        adminApi.users(),
        adminApi.exams(),
        adminApi.attempts(),
        adminApi.payments(),
      ]);
      setStats(s);
      setUsers(u.users);
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

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
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
      setUsers((prev) => prev.filter((x) => (x._id || x.id) !== id));
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

  if (loading) return <Loading text="Loading admin data…" />;

  const term = search.trim().toLowerCase();
  const visibleUsers = term
    ? users.filter(
        (u) =>
          u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term)
      )
    : users;

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
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              style={[styles.tab, active && styles.tabActive]}
            >
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
              <StatTile label="Attempts" value={stats?.totalAttempts ?? 0} />
              <StatTile
                label="Completed"
                value={stats?.completedAttempts ?? 0}
                tint={colors.success}
              />
            </View>

            <Text style={styles.sectionLabel}>Revenue</Text>
            <View style={styles.statRow}>
              <StatTile
                label={`Total (${stats?.payments?.currency || 'NGN'})`}
                value={(stats?.payments?.totalRevenue ?? 0).toLocaleString()}
                tint={colors.success}
              />
              <StatTile
                label="Entry fees"
                value={stats?.payments?.entryCount ?? 0}
                tint={colors.primary}
              />
              <StatTile
                label="Review fees"
                value={stats?.payments?.reviewCount ?? 0}
                tint={colors.warning}
              />
            </View>
            <Text style={styles.sectionNote}>
              Every paid paper earns twice: entry (take) + review (answers). Totals shown in
              whole currency units.
            </Text>
          </>
        )}

        {tab === 'users' && (
          <>
            <Field value={search} onChangeText={setSearch} placeholder="Search users…" />
            {visibleUsers.map((u) => {
              const id = u._id || u.id;
              const tint = roleTint[u.role] || roleTint.student;
              const isMe = id === myId;
              return (
                <Card key={id}>
                  <View style={styles.rowTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>
                        {u.name} {isMe ? '(you)' : ''}
                      </Text>
                      <Text style={styles.sub}>{u.email}</Text>
                    </View>
                    <Badge text={u.role.toUpperCase()} color={tint.fg} bg={tint.bg} />
                  </View>
                  {!isMe && (
                    <View style={styles.actions}>
                      <Button
                        title="Change role"
                        variant="ghost"
                        size="sm"
                        style={{ flex: 1 }}
                        onPress={() => changeRole(u)}
                      />
                      <Button
                        title="Delete"
                        variant="danger"
                        size="sm"
                        style={{ flex: 1 }}
                        onPress={() => deleteUser(u)}
                      />
                    </View>
                  )}
                </Card>
              );
            })}
          </>
        )}

        {tab === 'exams' && (
          <>
            <View style={styles.rowTop}>
              <Text style={styles.sectionLabel}>All exams</Text>
              <Button
                title="+ New past paper"
                variant="secondary"
                size="sm"
                onPress={() =>
                  navigation.navigate('ExamBuilder', { source: 'past' })
                }
              />
            </View>
            {exams.map((e) => {
              const creator = typeof e.creator === 'object' ? e.creator : null;
              const isPast = e.source === 'past';
              const entry = e.pricing?.entryFee || 0;
              const review = e.pricing?.reviewFee || 0;
              return (
                <Card key={e._id}>
                  <View style={styles.rowTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>
                        {e.title}
                        {!!e.year && ` (${e.year})`}
                      </Text>
                      <Text style={styles.sub}>
                        by {creator?.name || 'Unknown'} · {e.questions?.length ?? 0} questions
                        {isPast
                          ? ` · entry ${entry}, review ${review}`
                          : review > 0
                            ? ` · review ${review}`
                            : ''}
                      </Text>
                    </View>
                    <View style={{ gap: spacing.xs, alignItems: 'flex-end' }}>
                      <Badge
                        text={isPast ? 'PAST' : 'TEACHER'}
                        color={isPast ? colors.warning : colors.primary}
                        bg={isPast ? colors.warningLight : colors.primaryLight}
                      />
                      <Badge
                        text={e.settings?.isPublished ? 'LIVE' : 'DRAFT'}
                        color={e.settings?.isPublished ? colors.success : colors.warning}
                        bg={e.settings?.isPublished ? colors.successLight : colors.warningLight}
                      />
                    </View>
                  </View>
                  <Button
                    title="Delete exam"
                    variant="danger"
                    size="sm"
                    style={{ marginTop: spacing.md, alignSelf: 'flex-start' }}
                    onPress={() => deleteExam(e)}
                  />
                </Card>
              );
            })}
          </>
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
                <Button
                  title="Delete attempt"
                  variant="danger"
                  size="sm"
                  style={{ marginTop: spacing.md, alignSelf: 'flex-start' }}
                  onPress={() => deleteAttempt(a)}
                />
              </Card>
            );
          })}

        {tab === 'payments' && (
          <>
            <View style={styles.statRow}>
              <StatTile
                label="Revenue"
                value={paymentTotals.totalRevenue.toLocaleString()}
                tint={colors.success}
              />
              <StatTile
                label="Entry pays"
                value={paymentTotals.entryCount}
                tint={colors.primary}
              />
              <StatTile
                label="Review pays"
                value={paymentTotals.reviewCount}
                tint={colors.warning}
              />
            </View>

            {payments.length === 0 && (
              <Text style={styles.emptyNote}>
                No payments yet. They appear here the moment a student pays an entry or review
                fee.
              </Text>
            )}

            {payments.map((p) => {
              const student = typeof p.student === 'object' ? p.student : null;
              const exam = typeof p.exam === 'object' ? p.exam : null;
              const isEntry = p.purpose === 'entry';
              const paid = p.status === 'paid';
              return (
                <Card key={p._id}>
                  <View style={styles.rowTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>
                        {student?.name || 'Student'} · {p.amount} {p.currency}
                      </Text>
                      <Text style={styles.sub}>
                        {exam?.title || 'Exam'} · {isEntry ? 'Entry fee' : 'Review fee'} ·{' '}
                        {new Date(p.createdAt || '').toLocaleDateString()}
                      </Text>
                      <Text style={styles.sub}>Ref {p.reference}</Text>
                    </View>
                    <Badge
                      text={paid ? 'PAID' : p.status.toUpperCase()}
                      color={paid ? colors.success : p.status === 'pending' ? colors.warning : colors.danger}
                      bg={paid ? colors.successLight : p.status === 'pending' ? colors.warningLight : colors.dangerLight}
                    />
                  </View>
                </Card>
              );
            })}
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
  tabStripInner: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    alignItems: 'center',
  },
  tab: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
  },
  tabActive: { backgroundColor: colors.primary },
  tabText: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
  tabTextActive: { color: colors.white },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  statRow: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  name: { fontSize: 15, fontWeight: '700', color: colors.text },
  sub: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  score: { fontSize: 16, fontWeight: '800', color: colors.primary },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  sectionLabel: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },
  sectionNote: { fontSize: 12, color: colors.textLight, marginTop: spacing.sm },
  emptyNote: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xl,
    lineHeight: 21,
  },
});
