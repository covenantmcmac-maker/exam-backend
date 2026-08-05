import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, StatTile } from '../../components/ui';
import { useColors } from '../../context/ThemeContext';
import { spacing, radius } from '../../theme';
import type { Colors } from '../../theme';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'PracticeResult'>;

export default function PracticeResultScreen({ route, navigation }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { score, totalPoints, percentage, passed, results, totalQuestions } = route.params;

  const passedColor = passed ? colors.success : colors.danger;
  const pct = Math.round(parseFloat(percentage) || 0);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.title}>Practice Result</Text>
          <View style={[styles.pill, { backgroundColor: passed ? colors.successLight : colors.dangerLight }]}>
            <Text style={[styles.pillText, { color: passedColor }]}>{passed ? 'PASSED 🎉' : 'KEEP PRACTICING 💪'}</Text>
          </View>
        </View>

        <View style={styles.statRow}>
          <StatTile label="Score" value={`${score}/${totalPoints}`} />
          <StatTile label="Percent" value={`${pct}%`} tint={colors.accent} />
          <StatTile label="Questions" value={totalQuestions} tint={passed ? colors.success : colors.danger} />
        </View>

        <Card style={{ marginTop: spacing.lg }}>
          <Text style={styles.section}>Summary</Text>
          <Text style={styles.body}>You scored {score} out of {totalPoints} points ({percentage}%).</Text>
          <Text style={styles.body}>{passed ? 'Great job! You passed this practice set.' : 'You can try again with different filters or same set.'}</Text>
        </Card>

        {results.map((r: any, idx: number) => (
          <Card key={r.questionId || idx} style={r.isCorrect ? styles.cardCorrect : styles.cardWrong}>
            <View style={styles.resultTop}>
              <Text style={styles.qNum}>Q{idx + 1}</Text>
              <View style={[styles.badge, { backgroundColor: r.isCorrect ? colors.successLight : colors.dangerLight }]}>
                <Text style={[styles.badgeText, { color: r.isCorrect ? colors.success : colors.danger }]}>{r.isCorrect ? 'Correct' : 'Wrong'} · {r.pointsEarned}/{r.maxPoints}</Text>
              </View>
            </View>

            <Text style={styles.qText}>{r.questionText}</Text>

            <View style={styles.optionList}>
              {(r.options || []).map((o: any, i: number) => {
                const isCorrectOpt = o.isCorrect;
                const isYour = r.yourAnswer?.selectedOption === i;
                return (
                  <View key={i} style={[styles.optRow, isCorrectOpt && styles.optCorrect, isYour && !isCorrectOpt && styles.optYourWrong]}>
                    <Text style={[styles.optText, isCorrectOpt && styles.optCorrectText]}>{String.fromCharCode(65 + i)}. {o.text}</Text>
                    {isCorrectOpt && <Text style={styles.correctTag}>✓ correct</Text>}
                    {isYour && !isCorrectOpt && <Text style={styles.yourTag}>your choice</Text>}
                  </View>
                );
              })}

              {r.options?.length === 0 && (
                <View style={styles.monoBox}>
                  <Text style={styles.monoLabel}>Your answer:</Text>
                  <Text style={styles.monoValue}>{r.yourAnswer?.textAnswer || '(empty)'}</Text>
                  <Text style={styles.monoLabel}>Expected:</Text>
                  <Text style={styles.monoValue}>{r.correctAnswer || '—'}</Text>
                </View>
              )}
            </View>

            {r.explanation && (
              <View style={styles.explBox}>
                <Text style={styles.explTitle}>Explanation</Text>
                <Text style={styles.explText}>{r.explanation}</Text>
              </View>
            )}
          </Card>
        ))}

        <View style={styles.actions}>
          <Button title="New Practice Test" onPress={() => navigation.replace('PracticeSetup')} />
          <Button title="Browse Past Qs" variant="secondary" onPress={() => navigation.navigate('PastQuestions')} style={{ marginTop: spacing.md }} />
          <Button title="Go Home" variant="ghost" onPress={() => navigation.goBack()} style={{ marginTop: spacing.md }} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
    title: { fontSize: 24, fontWeight: '800', color: colors.text },
    pill: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill },
    pillText: { fontSize: 12, fontWeight: '800' },
    statRow: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' },
    section: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
    body: { fontSize: 14, color: colors.textMuted, lineHeight: 20, marginBottom: 6 },
    cardCorrect: { borderLeftWidth: 4, borderLeftColor: colors.success },
    cardWrong: { borderLeftWidth: 4, borderLeftColor: colors.danger },
    resultTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
    qNum: { fontSize: 13, fontWeight: '800', color: colors.primary },
    badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
    badgeText: { fontSize: 11, fontWeight: '800' },
    qText: { fontSize: 15, fontWeight: '600', color: colors.text, lineHeight: 21 },
    optionList: { marginTop: spacing.md, gap: spacing.sm },
    optRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
    optCorrect: { backgroundColor: colors.successLight, borderColor: colors.success },
    optYourWrong: { backgroundColor: colors.dangerLight, borderColor: colors.danger },
    optText: { fontSize: 13, color: colors.text, flex: 1 },
    optCorrectText: { color: colors.success, fontWeight: '700' },
    correctTag: { fontSize: 10, fontWeight: '800', color: colors.success, marginLeft: 8 },
    yourTag: { fontSize: 10, fontWeight: '700', color: colors.danger, marginLeft: 8 },
    monoBox: { backgroundColor: colors.bg, padding: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, gap: 6 },
    monoLabel: { fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
    monoValue: { fontSize: 14, color: colors.text },
    explBox: { marginTop: spacing.md, padding: spacing.md, backgroundColor: colors.bg, borderRadius: radius.sm, borderLeftWidth: 3, borderLeftColor: colors.primary },
    explTitle: { fontSize: 12, fontWeight: '800', color: colors.primary, marginBottom: 4 },
    explText: { fontSize: 13, color: colors.textMuted, lineHeight: 18 },
    actions: { marginTop: spacing.xl },
  });
