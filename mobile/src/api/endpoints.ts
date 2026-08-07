import { request, uploadFile } from './client';
import type { UploadableFile } from './client';
import type {
  AdminPaymentsResult,
  AdminPlatformConfig,
  AdminStats,
  AppConfig,
  Exam,
  ExamAttempt,
  ExamReview,
  ExamStats,
  InitiatePaymentResult,
  PastExam,
  Payment,
  PaymentPurpose,
  Question,
  Role,
  SecurityFlagResult,
  SubmitResult,
  User,
  VerifyPaymentResult,
} from './types';

/* ----------------------------------------------------------------- config */

export const configApi = {
  get: () => request<AppConfig>('/api/config', { auth: false }),
};

/* ------------------------------------------------------------------ auth */

interface AuthResponse {
  message: string;
  token: string;
  user: User;
}

export const authApi = {
  login: (email: string, password: string) =>
    request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    }),

  register: (name: string, email: string, password: string, role: Role = 'student') =>
    request<AuthResponse>('/api/auth/register', {
      method: 'POST',
      body: { name, email, password, role },
      auth: false,
    }),

  me: () => request<{ user: User }>('/api/auth/me'),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ message: string }>('/api/auth/change-password', {
      method: 'PATCH',
      body: { currentPassword, newPassword },
    }),

  guestRegister: (name: string, email: string, examCode: string) =>
    request<AuthResponse & { examId: string }>('/api/auth/guest-register', {
      method: 'POST',
      body: { name, email, examCode },
      auth: false,
    }),
};

/* ----------------------------------------------------------------- exams */

export const examsApi = {
  create: (payload: Partial<Exam>) =>
    request<{ message: string; exam: Exam; accessCode: string }>('/api/exams', {
      method: 'POST',
      body: payload,
    }),

  myExams: () => request<Exam[]>('/api/exams/my-exams'),

  join: (accessCode: string) =>
    request<{ message: string; exam: Exam }>('/api/exams/join', {
      method: 'POST',
      body: { accessCode },
    }),

  joinPublic: (accessCode: string) =>
    request<{ message: string; exam: Exam }>('/api/exams/join-public', {
      method: 'POST',
      body: { accessCode },
      auth: false,
    }),

  stats: (id: string) =>
    request<{ exam: Exam; attempts: ExamAttempt[]; stats: ExamStats }>(
      `/api/exams/${id}/stats`
    ),

  take: (id: string) => request<Exam>(`/api/exams/${id}/take`),

  /** Paid past-question library, organised by subject and year. */
  past: (params: { subject?: string; year?: number; search?: string } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) qs.append(k, String(v));
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ exams: PastExam[] }>(`/api/exams/past${suffix}`);
  },

  forEdit: (id: string) => request<Exam>(`/api/exams/${id}/edit`),

  publish: (id: string, isPublished: boolean) =>
    request<{ message: string; exam: Exam }>(`/api/exams/${id}/publish`, {
      method: 'PATCH',
      body: { isPublished },
    }),

  update: (id: string, payload: Partial<Exam>) =>
    request<{ message: string; exam: Exam }>(`/api/exams/${id}`, {
      method: 'PUT',
      body: payload,
    }),

  /** Teacher: list their past-question papers (with sales counts). */
  myPast: () =>
    request<(Exam & { salesCount: number; totalRevenue: number })[]>('/api/exams/my-past'),

  /** Teacher: convert a finished exam into a paid past-question paper. */
  sellAsPast: (
    id: string,
    payload: { entryFee: number; reviewFee?: number; year?: number; description?: string }
  ) =>
    request<{ message: string; exam: Exam }>(`/api/exams/${id}/sell-as-past`, {
      method: 'POST',
      body: payload,
    }),

  /** Teacher: unlist a past paper back to a private draft. */
  unlistPast: (id: string) =>
    request<{ message: string; exam: Exam }>(`/api/exams/${id}/unlist-past`, {
      method: 'POST',
    }),

  /** Teacher: update past-paper pricing. */
  updatePricing: (id: string, payload: { entryFee?: number; reviewFee?: number }) =>
    request<{ message: string; exam: Exam }>(`/api/exams/${id}/pricing`, {
      method: 'PATCH',
      body: payload,
    }),

  remove: (id: string) =>
    request<{ message: string }>(`/api/exams/${id}`, { method: 'DELETE' }),
};

/* ------------------------------------------------------------- questions */

export const questionsApi = {
  list: (params: { subject?: string; difficulty?: string; type?: string; past?: boolean; isPastQuestion?: boolean; search?: string; year?: string; session?: string } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.append(k, String(v));
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ questions: Question[]; total: number; pages: number }>(
      `/api/questions${suffix}`
    );
  },

  listPast: (params: { subject?: string; difficulty?: string; type?: string; search?: string } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) qs.append(k, v);
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ questions: Question[]; total: number; pages: number }>(
      `/api/questions/past${suffix}`
    );
  },

  listPastQuestionsPool: (params: { subject?: string; difficulty?: string; type?: string; search?: string; year?: string; session?: string; examType?: string } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) qs.append(k, v);
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ questions: Question[]; total: number; pages: number }>(
      `/api/questions/past-questions${suffix}`
    );
  },

  pastStats: () =>
    request<import('./types').PastQuestionsStats>('/api/questions/past-questions/stats'),

  getOne: (id: string) =>
    request<Question>(`/api/questions/${id}`),

  create: (payload: Partial<Question>) =>
    request<Question>('/api/questions', { method: 'POST', body: payload }),

  update: (id: string, payload: Partial<Question>) =>
    request<Question>(`/api/questions/${id}`, { method: 'PUT', body: payload }),

  remove: (id: string) =>
    request<{ message: string }>(`/api/questions/${id}`, { method: 'DELETE' }),

  bulkDelete: (questionIds: string[]) =>
    request<{ message: string; deletedCount: number }>('/api/questions/bulk-delete', {
      method: 'POST',
      body: { questionIds },
    }),

  bulkUpload: (file: UploadableFile) =>
    uploadFile<{ message: string; count: number }>('/api/questions/bulk-upload', file),

  // Past Questions actions
  moveToPast: (id: string, meta?: { pastQuestionYear?: number; pastQuestionSession?: string; pastQuestionExamType?: string }) =>
    request<{ message: string; question: Question }>(`/api/questions/${id}/move-to-past`, {
      method: 'PATCH',
      body: meta || {},
    }),

  restore: (id: string) =>
    request<{ message: string; question: Question }>(`/api/questions/${id}/restore`, {
      method: 'PATCH',
    }),

  bulkMoveToPast: (questionIds: string[], meta?: { pastQuestionYear?: number; pastQuestionSession?: string; pastQuestionExamType?: string }) =>
    request<{ message: string; modifiedCount: number; questions: Question[] }>('/api/questions/bulk-move-to-past', {
      method: 'POST',
      body: { questionIds, ...meta },
    }),

  bulkRestore: (questionIds: string[]) =>
    request<{ message: string; modifiedCount: number }>('/api/questions/bulk-restore', {
      method: 'POST',
      body: { questionIds },
    }),

  // Practice test from past questions
  generatePractice: (params: { count?: number; subject?: string; difficulty?: string; type?: string; year?: string; session?: string; examType?: string; category?: string } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.append(k, String(v));
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ questions: Question[]; totalMatching: number; count: number; filters?: any; message?: string }>(
      `/api/questions/past-questions/practice/generate${suffix}`
    );
  },

  submitPractice: (answers: { questionId: string; selectedOption?: number; textAnswer?: string }[]) =>
    request<{ message: string; score: number; totalPoints: number; percentage: string; passed: boolean; results: any[]; totalQuestions: number }>(
      '/api/questions/past-questions/practice/submit',
      { method: 'POST', body: { answers } }
    ),
};

/* -------------------------------------------------------------- attempts */

export const attemptsApi = {
  start: (examId: string) =>
    request<{ message: string; attempt: ExamAttempt }>('/api/attempts/start', {
      method: 'POST',
      body: { examId },
    }),

  saveAnswer: (
    attemptId: string,
    payload: { questionId: string; selectedOption?: number; textAnswer?: string }
  ) =>
    request<{ message: string }>(`/api/attempts/${attemptId}/answer`, {
      method: 'PATCH',
      body: payload,
    }),

  submit: (attemptId: string) =>
    request<SubmitResult>(`/api/attempts/${attemptId}/submit`, { method: 'POST' }),

  reportViolation: (attemptId: string, type: 'copy' | 'paste' | 'screenshot' | 'app-background' | 'print-screen') =>
    request<{ message: string; violationCount: number; submitted: boolean; result?: SubmitResult }>(
      `/api/attempts/${attemptId}/violation`,
      { method: 'POST', body: { type } }
    ),
  flagSecurity: (attemptId: string, reason: string) =>
    request<SecurityFlagResult>(`/api/attempts/${attemptId}/security-flag`, {
      method: 'POST',
      body: { reason },
    }),

  myAttempts: () => request<ExamAttempt[]>('/api/attempts/my-attempts'),

  review: (attemptId: string) =>
    request<ExamReview>(`/api/attempts/${attemptId}/review`),

  grade: (attemptId: string, grades: { questionId: string; pointsEarned: number }[]) =>
    request<{ message: string; attempt: ExamAttempt }>(`/api/attempts/${attemptId}/grade`, {
      method: 'PATCH',
      body: { grades },
    }),

  remove: (attemptId: string) =>
    request<{ message: string }>(`/api/attempts/${attemptId}`, { method: 'DELETE' }),
};

/* --------------------------------------------------------------- payments */

export const paymentsApi = {
  initiate: (payload: {
    examId?: string;
    purpose: PaymentPurpose;
    attemptId?: string;
    paymentToken?: string;
  }) =>
    request<InitiatePaymentResult>('/api/payments/initiate', {
      method: 'POST',
      body: payload,
      auth: payload.purpose !== 'registration' || !payload.paymentToken,
    }),

  /** Confirm payment after returning from the Paystack checkout. */
  verify: (reference: string, paymentToken?: string) => {
    const suffix = paymentToken
      ? `?${new URLSearchParams({ paymentToken }).toString()}`
      : '';
    return request<VerifyPaymentResult>(`/api/payments/${reference}/verify${suffix}`, {
      auth: !paymentToken,
    });
  },

  /** Sandbox-only: marks a pending payment paid when no gateway is configured. */
  devComplete: (reference: string, paymentToken?: string) =>
    request<{ message: string; payment: Payment }>(
      `/api/payments/${reference}/dev-complete`,
      {
        method: 'POST',
        body: paymentToken ? { paymentToken } : undefined,
        auth: !paymentToken,
      }
    ),

  myPayments: () => request<Payment[]>('/api/payments/my-payments'),
};

/* ----------------------------------------------------------------- admin */

export interface AdminPastStats {
  totalPast: number;
  byYear: { _id: number; count: number }[];
  bySubject: { _id: string; count: number }[];
  byTeacher: { _id: string; count: number; name?: string; email?: string }[];
  bySession: { _id: string; count: number }[];
  byExamType: { _id: string; count: number }[];
  byDifficulty: { _id: string; count: number }[];
  recent: { _id: string; questionText: string; subject?: string; pastQuestionYear?: number; movedToPastAt?: string; creator?: { name?: string } }[];
}

export const adminApi = {
  stats: () => request<AdminStats & { totalActiveQuestions?: number; totalPastQuestions?: number; pastByYear?: { _id: number; count: number }[]; pastBySubject?: { _id: string; count: number }[] }>('/api/admin/stats'),

  config: () => request<AdminPlatformConfig>('/api/admin/config'),

  updateConfig: (payload: Partial<AdminPlatformConfig>) =>
    request<{ message: string; config: AdminPlatformConfig }>('/api/admin/config', {
      method: 'PATCH',
      body: payload,
    }),

  users: (params: { role?: string; search?: string } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) qs.append(k, v);
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ users: User[]; total: number; pages: number }>(
      `/api/admin/users${suffix}`
    );
  },

  createUser: (payload: { name: string; email: string; role?: Role }) =>
    request<{ message: string; user: User }>('/api/admin/users', {
      method: 'POST',
      body: payload,
    }),

  changeRole: (id: string, role: Role) =>
    request<{ message: string; user: User }>(`/api/admin/users/${id}/role`, {
      method: 'PATCH',
      body: { role },
    }),

  resetUserPassword: (id: string) =>
    request<{ message: string; user: User }>(`/api/admin/users/${id}/reset-password`, {
      method: 'POST',
    }),

  resetAllStudentPasswords: () =>
    request<{ message: string; resetCount: number }>('/api/admin/users/reset-passwords', {
      method: 'POST',
      body: { confirm: true },
    }),

  removeUser: (id: string) =>
    request<{ message: string }>(`/api/admin/users/${id}`, { method: 'DELETE' }),

  payments: () => request<AdminPaymentsResult>('/api/admin/payments'),

  exams: () => request<Exam[]>('/api/admin/exams'),

  removeExam: (id: string) =>
    request<{ message: string }>(`/api/admin/exams/${id}`, { method: 'DELETE' }),

  attempts: () => request<ExamAttempt[]>('/api/admin/attempts'),

  removeAttempt: (id: string) =>
    request<{ message: string }>(`/api/admin/attempts/${id}`, { method: 'DELETE' }),

  // Past Questions admin
  pastQuestions: (params: { subject?: string; year?: string; session?: string; examType?: string; teacher?: string; search?: string; page?: string; limit?: string } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) qs.append(k, String(v));
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ questions: Question[]; total: number; pages: number }>(`/api/admin/past-questions${suffix}`);
  },

  pastStats: () => request<AdminPastStats>('/api/admin/past-questions/stats'),

  updatePastQuestion: (id: string, payload: { pastQuestionYear?: number | null; pastQuestionSession?: string; pastQuestionExamType?: string; subject?: string; category?: string }) =>
    request<{ message: string; question: Question }>(`/api/admin/past-questions/${id}`, { method: 'PATCH', body: payload }),

  restorePastQuestion: (id: string) =>
    request<{ message: string; question: Question }>(`/api/admin/past-questions/${id}/restore`, { method: 'PATCH' }),

  bulkRestorePast: (questionIds: string[]) =>
    request<{ message: string; modifiedCount: number }>(`/api/admin/past-questions/bulk-restore`, { method: 'POST', body: { questionIds } }),

  removePastQuestion: (id: string) =>
    request<{ message: string }>(`/api/admin/past-questions/${id}`, { method: 'DELETE' }),

  bulkDeletePast: (questionIds: string[]) =>
    request<{ message: string; deletedCount: number }>(`/api/admin/past-questions/bulk-delete`, { method: 'POST', body: { questionIds } }),
};
