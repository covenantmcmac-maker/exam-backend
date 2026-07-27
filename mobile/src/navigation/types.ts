import type { NavigatorScreenParams } from '@react-navigation/native';

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  GuestJoin: undefined;
};

export type StudentTabParamList = {
  Home: undefined;
  Results: undefined;
  Profile: undefined;
};

export type TeacherTabParamList = {
  Dashboard: undefined;
  Exams: undefined;
  Questions: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  StudentTabs: NavigatorScreenParams<StudentTabParamList>;
  TeacherTabs: NavigatorScreenParams<TeacherTabParamList>;
  ExamTaking: { examId: string };
  ExamResult: {
    score?: number;
    totalPoints?: number;
    percentage?: string;
    passed?: boolean;
    timeSpent?: number;
    showResults: boolean;
    examTitle?: string;
  };
  ExamBuilder: { examId?: string } | undefined;
  ExamStats: { examId: string; title?: string };
  QuestionEditor: { questionId?: string } | undefined;
  AdminPanel: undefined;
};
