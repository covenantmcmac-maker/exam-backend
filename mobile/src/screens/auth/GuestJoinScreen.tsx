import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card } from '../../components/ui';
import { Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useColors } from '../../context/ThemeContext';
import { spacing } from '../../theme';

/**
 * Legacy placeholder only. Guest joining has been removed; students must sign
 * in or register before using a teacher access code.
 */
export default function GuestJoinScreen() {
  const navigation = useNavigation<any>();
  const colors = useColors();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: spacing.xl }}>
      <Card>
        <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text }}>Sign in first</Text>
        <Text style={{ fontSize: 14, color: colors.textMuted, marginTop: spacing.sm, marginBottom: spacing.lg, lineHeight: 21 }}>
          Guest joining has been removed. Please log in or register, then enter the teacher's access code from your student home screen.
        </Text>
        <Button title="Back to login" onPress={() => navigation.navigate('Login')} />
      </Card>
    </SafeAreaView>
  );
}
