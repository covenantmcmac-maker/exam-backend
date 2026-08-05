export type Role = 'student' | 'teacher' | 'admin';

export type ExamSource = 'teacher' | 'past';

export interface ExamPricing {
  entryFee: number;
  reviewFee: number;
  currency: string;
}

export interface AppConfig {
  currency: string;
  currencySymbol: string;
  defaultEntryFee: number;
  defaultReviewFee: number;
  paymentsConfigured: boolean;
  paymentsDevMode: boolean;
  paystackPublicKey: string;
}

export type PaymentPurpose = 'entry' | 'review';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'expired';

export interface Payment {
  _id: string;
  student: User | string;
  exam: Exam | string;
  attempt?: ExamAttempt | string | null;
  purpose: PaymentPurpose;
  amount: number;
  currency: string;
  provider: 'paystack' | 'sandbox';
  reference: string;
  status: PaymentStatus;
  paidAt?: string;
  createdAt?: string;
}

export interface InitiatePaymentResult {
  message: string;
  payment: Payment;
  authorizationUrl: string | null;
  devMode: boolean;
}

export interface VerifyPaymentResult {
  payment: Payment;
  paid: boolean;
}

/** One entry in the paid past-questions library. */
export interface PastExam {
  _id: string;
  title: string;
  description?: string;
  subject?: string;
  year?: number;
  source: ExamSource;
  questionCount: number;
  settings: {
    duration: number;
    totalMarks: number;
    passingMarks: number;
    maxAttempts: number;
    allowReview: boolean;
  };
  pricing: ExamPricing;
  purchasedEntry: boolean;
  completedCount: number;
  maxAttempts: number;
  attemptsLeft: number;
  inProgressAttempt: { _id: string } | null;
  startable: boolean;
  endsAt?: string | null;
}

/** One question in the answer review (with correct answers + explanations). */
export interface ReviewItem {
  questionId: string;
  questionText: string;
  questionType: QuestionType;
  options: {
    text: string;
    isCorrect: boolean;
    isSelected: boolean;
  }[];
  correctAnswer: string | null;
  correctOptionIndex: number;
  selectedOption: number | null;
  textAnswer: string;
  isCorrect?: boolean;
  pointsEarned: number;
  maxPoints: number;
  explanation: string | null;
}

export interface AnswerReview {
  exam: {
    _id: string;
    title: string;
    subject?: string;
    source: ExamSource;
    year?: number;
  };
  attempt: {
    _id: string;
    score: number;
    totalPoints: number;
    percentage: number;
    status: string;
    completedAt?: string;
    timeSpent?: number;
  };
  items: ReviewItem[];
}

export interface AdminPaymentsResult {
  payments: Payment[];
  totals: {
    totalRevenue: number;
    entryCount: number;
    reviewCount: number;
  };
}

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
  source?: ExamSource;
  year?: number;
  pricing?: ExamPricing;
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
  attemptId?: string;
  reviewEnabled?: boolean;
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
  payments: {
    total: number;
    entryCount: number;
    reviewCount: number;
    totalRevenue: number;
    entryRevenue: number;
    reviewRevenue: number;
    currency: string;
  };
}
