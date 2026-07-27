import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Text } from 'react-native';
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { useAuth } from '../context/AuthContext';
import { useColors } from '../context/ThemeContext';
import type { Colors } from '../theme';
import { Loading } from '../components/ui';

import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import GuestJoinScreen from '../screens/auth/GuestJoinScreen';

import StudentHomeScreen from '../screens/student/StudentHomeScreen';
import ResultsScreen from '../screens/student/ResultsScreen';
import ProfileScreen from '../screens/ProfileScreen';

import TeacherDashboardScreen from '../screens/teacher/TeacherDashboardScreen';
import TeacherExamsScreen from '../screens/teacher/TeacherExamsScreen';
import QuestionBankScreen from '../screens/teacher/QuestionBankScreen';
import ExamBuilderScreen from '../screens/teacher/ExamBuilderScreen';
import ExamStatsScreen from '../screens/teacher/ExamStatsScreen';
import QuestionEditorScreen from '../screens/teacher/QuestionEditorScreen';

import ExamTakingScreen from '../screens/exam/ExamTakingScreen';
import ExamResultScreen from '../screens/exam/ExamResultScreen';
import BulkImportScreen from '../screens/teacher/BulkImportScreen';
import AdminPanelScreen from '../screens/admin/AdminPanelScreen';

import type {
  AuthStackParamList,
  RootStackParamList,
  StudentTabParamList,
  TeacherTabParamList,
} from './types';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

const RootStack = createNativeStackNavigator<RootStackParamList>();
const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const StudentTabs = createBottomTabNavigator<StudentTabParamList>();
const TeacherTabs = createBottomTabNavigator<TeacherTabParamList>();

function icon(glyph: string) {
  return ({ color }: { color: string }) => (
    <Text style={{ fontSize: 20, color }}>{glyph}</Text>
  );
}

const makeTabOptions = (colors: Colors) => ({
  headerShown: false,
  tabBarActiveTintColor: colors.primary,
  tabBarInactiveTintColor: colors.textLight,
  tabBarStyle: { borderTopColor: colors.border, backgroundColor: colors.card },
  tabBarLabelStyle: { fontSize: 11, fontWeight: '600' as const },
});

function AuthFlow() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Register" component={RegisterScreen} />
      <AuthStack.Screen name="GuestJoin" component={GuestJoinScreen} />
    </AuthStack.Navigator>
  );
}

function StudentFlow() {
  const colors = useColors();
  const tabOptions = useMemo(() => makeTabOptions(colors), [colors]);
  return (
    <StudentTabs.Navigator screenOptions={tabOptions}>
      <StudentTabs.Screen
        name="Home"
        component={StudentHomeScreen}
        options={{ tabBarIcon: icon('🏠') }}
      />
      <StudentTabs.Screen
        name="Results"
        component={ResultsScreen}
        options={{ tabBarIcon: icon('📊') }}
      />
      <StudentTabs.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ tabBarIcon: icon('👤') }}
      />
    </StudentTabs.Navigator>
  );
}

function TeacherFlow() {
  const colors = useColors();
  const tabOptions = useMemo(() => makeTabOptions(colors), [colors]);
  return (
    <TeacherTabs.Navigator screenOptions={tabOptions}>
      <TeacherTabs.Screen
        name="Dashboard"
        component={TeacherDashboardScreen}
        options={{ tabBarIcon: icon('📈') }}
      />
      <TeacherTabs.Screen
        name="Exams"
        component={TeacherExamsScreen}
        options={{ tabBarIcon: icon('📝') }}
      />
      <TeacherTabs.Screen
        name="Questions"
        component={QuestionBankScreen}
        options={{ tabBarIcon: icon('❓') }}
      />
      <TeacherTabs.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ tabBarIcon: icon('👤') }}
      />
    </TeacherTabs.Navigator>
  );
}

export default function RootNavigator() {
  const { user, loading, isTeacher, pendingExamId, clearPendingExam } = useAuth();
  const colors = useColors();
  const navReady = useRef(false);

  // A guest who joined with an access code lands straight in the exam.
  // The auth screens unmount the moment `user` is set, so the jump has to
  // happen here, once the signed-in stack is actually mounted.
  const goToPendingExam = useCallback(() => {
    if (!pendingExamId || !navReady.current || !navigationRef.isReady()) return;
    const examId = pendingExamId;
    clearPendingExam();
    navigationRef.navigate('ExamTaking', { examId });
  }, [pendingExamId, clearPendingExam]);

  useEffect(() => {
    if (user && pendingExamId) goToPendingExam();
  }, [user, pendingExamId, goToPendingExam]);

  if (loading) return <Loading text="Starting up…" />;

  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={() => {
        navReady.current = true;
        goToPendingExam();
      }}
    >
      <RootStack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.card },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        {!user ? (
          <RootStack.Screen name="Auth" component={AuthFlow} options={{ headerShown: false }} />
        ) : (
          <>
            {isTeacher ? (
              <RootStack.Screen
                name="TeacherTabs"
                component={TeacherFlow}
                options={{ headerShown: false }}
              />
            ) : (
              <RootStack.Screen
                name="StudentTabs"
                component={StudentFlow}
                options={{ headerShown: false }}
              />
            )}

            <RootStack.Screen
              name="ExamTaking"
              component={ExamTakingScreen}
              options={{ headerShown: false, gestureEnabled: false }}
            />
            <RootStack.Screen
              name="ExamResult"
              component={ExamResultScreen}
              options={{ headerShown: false, gestureEnabled: false }}
            />
            <RootStack.Screen name="ExamBuilder" component={ExamBuilderScreen} />
            <RootStack.Screen name="ExamStats" component={ExamStatsScreen} />
            <RootStack.Screen name="QuestionEditor" component={QuestionEditorScreen} />
            <RootStack.Screen
              name="BulkImport"
              component={BulkImportScreen}
              options={{ title: 'Import questions' }}
            />
            <RootStack.Screen
              name="AdminPanel"
              component={AdminPanelScreen}
              options={{ title: 'Admin panel' }}
            />
          </>
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
}
