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
  PastQuestions: undefined;
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
    allowReview?: boolean;
    attemptId?: string;
    examTitle?: string;
  };
  ExamReview: { attemptId: string };
  ExamBuilder: { examId?: string; source?: 'teacher' | 'past' } | undefined;
  ExamStats: { examId: string; title?: string };
  QuestionEditor: { questionId?: string } | undefined;
  BulkImport: undefined;
  AdminPanel: undefined;
  PastQuestions: undefined;
  PastQuestionDetail: { questionId: string } | undefined;
  PracticeSetup: undefined;
  PracticeExam: { questions?: import('../api/types').Question[]; filters?: any; count?: number } | undefined;
  PracticeResult: { score: number; totalPoints: number; percentage: string; passed: boolean; results: any[]; totalQuestions: number };
};
