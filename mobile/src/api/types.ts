export type Role = 'student' | 'teacher' | 'admin';

export interface User {
  id?: string;
  _id?: string;
  name: string;
  email: string;
  role: Role;
  createdAt?: string;
}

export interface QuestionOption {
  _id?: string;
  text: string;
  isCorrect?: boolean;
}

export type QuestionType =
  | 'multiple-choice'
  | 'true-false'
  | 'short-answer'
  | 'essay'
  | 'fill-blank';

export interface Question {
  _id: string;
  questionText: string;
  questionType: QuestionType;
  options: QuestionOption[];
  correctAnswer?: string;
  points: number;
  difficulty: 'easy' | 'medium' | 'hard';
  subject?: string;
  category?: string;
  tags?: string[];
  explanation?: string;
  image?: string;
  createdAt?: string;
}

export interface ExamSettings {
  duration: number;
  totalMarks: number;
  passingMarks: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  showResults: boolean;
  allowReview: boolean;
  maxAttempts: number;
  startDate?: string | null;
  endDate?: string | null;
  isPublished: boolean;
}

export interface ExamQuestionRef {
  _id?: string;
  question: Question | string;
  points: number;
  order?: number;
}

export interface Exam {
  _id: string;
  title: string;
  description?: string;
  subject?: string;
  creator?: { _id?: string; name?: string } | string;
  questions: ExamQuestionRef[];
  settings: ExamSettings;
  accessCode?: string;
  createdAt?: string;
}

export interface AttemptAnswer {
  question: string;
  selectedOption?: number;
  textAnswer?: string;
  isCorrect?: boolean;
  pointsEarned?: number;
}

export interface ExamAttempt {
  _id: string;
  exam: Exam | string;
  student: User | string;
  answers: AttemptAnswer[];
  score: number;
  totalPoints: number;
  percentage: number;
  status: 'in-progress' | 'completed' | 'timed-out' | 'graded';
  startedAt: string;
  completedAt?: string;
  timeSpent?: number;
}

export interface SubmitResult {
  message: string;
  showResults: boolean;
  score?: number;
  totalPoints?: number;
  percentage?: string;
  timeSpent?: number;
  passed?: boolean;
}

export interface ExamStats {
  totalAttempts: number;
  completed: number;
  inProgress: number;
  averageScore: number;
  highestScore: number;
  lowestScore: number;
  passRate: number;
}

export interface AdminStats {
  totalUsers: number;
  totalTeachers: number;
  totalStudents: number;
  totalAdmins: number;
  totalExams: number;
  totalQuestions: number;
  totalAttempts: number;
  completedAttempts: number;
}
