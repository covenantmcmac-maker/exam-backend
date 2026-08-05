import type { NavigatorScreenParams } from '@react-navigation/native';

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  GuestJoin: undefined;
};

export type StudentTabParamList = {
  Home: undefined;
  PastQuestions: undefined;
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
    attemptId?: string;
    reviewEnabled?: boolean;
  };
  /** Paid answer review of a completed attempt. */
  AnswerReview: { attemptId: string };
  ExamBuilder: { examId?: string; source?: 'teacher' | 'past' } | undefined;
  ExamStats: { examId: string; title?: string };
  QuestionEditor: { questionId?: string } | undefined;
  BulkImport: undefined;
  AdminPanel: undefined;
};
