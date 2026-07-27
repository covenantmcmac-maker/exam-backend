import React, { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Badge, Button, Card, Field, Loading, StatTile } from '../../components/ui';
import { adminApi } from '../../api/endpoints';
import { useAuth } from '../../context/AuthContext';
import { useDialog } from '../../components/Dialog';
import { colors, radius, spacing } from '../../theme';
import type { AdminStats, Exam, ExamAttempt, Role, User } from '../../api/types';

type Tab = 'overview' | 'users' | 'exams' | 'attempts';

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'users', label: 'Users' },
  { key: 'exams', label: 'Exams' },
  { key: 'attempts', label: 'Attempts' },
];

const roleTint: Record<string, { fg: string; bg: string }> = {
  admin: { fg: colors.danger, bg: colors.dangerLight },
  teacher: { fg: colors.primary, bg: colors.primaryLight },
  student: { fg: colors.success, bg: colors.successLight },
};

export default function AdminPanelScreen() {
  const { user: me } = useAuth();
  const dialog = useDialog();
  const [tab, setTab] = useState<Tab>('overview');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, u, e, a] = await Promise.all([
        adminApi.stats(),
        adminApi.users(),
        adminApi.exams(),
        adminApi.attempts(),
      ]);
      setStats(s);
      setUsers(u.users);
      setExams(e);
      setAttempts(a);
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

        {tab === 'exams' &&
          exams.map((e) => {
            const creator = typeof e.creator === 'object' ? e.creator : null;
            return (
              <Card key={e._id}>
                <View style={styles.rowTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{e.title}</Text>
                    <Text style={styles.sub}>
                      by {creator?.name || 'Unknown'} · {e.questions?.length ?? 0} questions
                    </Text>
                  </View>
                  <Badge
                    text={e.settings?.isPublished ? 'LIVE' : 'DRAFT'}
                    color={e.settings?.isPublished ? colors.success : colors.warning}
                    bg={e.settings?.isPublished ? colors.successLight : colors.warningLight}
                  />
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
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
});
