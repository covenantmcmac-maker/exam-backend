import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Button, Card, StatTile } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { examsApi, questionsApi } from '../../api/endpoints';
import { radius, spacing } from '../../theme';
import { useColors } from '../../context/ThemeContext';
import type { Colors } from '../../theme';
import type { Exam } from '../../api/types';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList, TeacherTabParamList } from '../../navigation/types';

type Props = CompositeScreenProps<
  BottomTabScreenProps<TeacherTabParamList, 'Dashboard'>,
  NativeStackScreenProps<RootStackParamList>
>;

export default function TeacherDashboardScreen({ navigation }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user, isAdmin } = useAuth();
  const [exams, setExams] = useState<Exam[]>([]);
  const [questionCount, setQuestionCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [examList, qs] = await Promise.all([
        examsApi.myExams(),
        questionsApi.list().catch(() => ({ questions: [], total: 0, pages: 0 })),
      ]);
      setExams(examList);
      setQuestionCount(qs.total);
    } catch {
      /* non-blocking */
    }
  }, []);

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

  const published = exams.filter((e) => e.settings?.isPublished).length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={styles.greeting}>Hi, {user?.name?.split(' ')[0] || 'Teacher'} 👋</Text>
        <Text style={styles.subtitle}>Here&apos;s your teaching overview.</Text>

        <View style={styles.statRow}>
          <StatTile label="Total exams" value={exams.length} />
          <StatTile label="Published" value={published} tint={colors.success} />
          <StatTile label="Questions" value={questionCount} tint={colors.accent} />
        </View>

        <Text style={styles.sectionTitle}>Quick actions</Text>
        <View style={styles.actionRow}>
          <Button
            title="+ New exam"
            style={{ flex: 1 }}
            onPress={() => navigation.navigate('ExamBuilder')}
          />
          <Button
            title="+ Question"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() => navigation.navigate('QuestionEditor')}
          />
        </View>

        {isAdmin && (
          <Button
            title="🛡️  Open admin panel"
            variant="ghost"
            style={{ marginTop: spacing.md }}
            onPress={() => navigation.navigate('AdminPanel')}
          />
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent exams</Text>
          <Button
            title="See all"
            variant="ghost"
            size="sm"
            onPress={() => navigation.navigate('Exams')}
          />
        </View>

        {exams.length === 0 ? (
          <Card>
            <Text style={styles.emptyText}>
              No exams yet. Tap “New exam” to create your first one.
            </Text>
          </Card>
        ) : (
          exams.slice(0, 4).map((exam) => (
            <Card key={exam._id}>
              <View style={styles.examHeader}>
                <Text style={styles.examTitle} numberOfLines={1}>
                  {exam.title}
                </Text>
                <View
                  style={[
                    styles.pill,
                    {
                      backgroundColor: exam.settings?.isPublished
                        ? colors.successLight
                        : colors.warningLight,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.pillText,
                      {
                        color: exam.settings?.isPublished ? colors.success : colors.warning,
                      },
                    ]}
                  >
                    {exam.settings?.isPublished ? 'Live' : 'Draft'}
                  </Text>
                </View>
              </View>
              <Text style={styles.examMeta}>
                {exam.questions?.length ?? 0} questions · {exam.settings?.duration ?? 0} min
                {exam.accessCode ? ` · Code ${exam.accessCode}` : ''}
              </Text>
              <Button
                title="View results"
                variant="ghost"
                size="sm"
                style={{ marginTop: spacing.md, alignSelf: 'flex-start' }}
                onPress={() =>
                  navigation.navigate('ExamStats', { examId: exam._id, title: exam.title })
                }
              />
            </Card>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  greeting: { fontSize: 26, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 15, color: colors.textMuted, marginTop: 2, marginBottom: spacing.xl },
  statRow: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actionRow: { flexDirection: 'row', gap: spacing.md },
  examHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  examTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.text },
  examMeta: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  pill: { paddingHorizontal: spacing.md, paddingVertical: 3, borderRadius: radius.pill },
  pillText: { fontSize: 11, fontWeight: '800' },
  emptyText: { fontSize: 14, color: colors.textMuted, textAlign: 'center' },
});
