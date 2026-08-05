import { request, uploadFile } from './client';
import type { UploadableFile } from './client';
import type {
  AdminPaymentsResult,
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

  remove: (id: string) =>
    request<{ message: string }>(`/api/exams/${id}`, { method: 'DELETE' }),
};

/* ------------------------------------------------------------- questions */

export const questionsApi = {
  list: (params: { subject?: string; difficulty?: string; type?: string } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) qs.append(k, v);
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ questions: Question[]; total: number; pages: number }>(
      `/api/questions${suffix}`
    );
  },

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
  initiate: (examId: string, purpose: PaymentPurpose, attemptId?: string) =>
    request<InitiatePaymentResult>('/api/payments/initiate', {
      method: 'POST',
      body: { examId, purpose, attemptId },
    }),

  /** Confirm payment after returning from the Paystack checkout. */
  verify: (reference: string) =>
    request<VerifyPaymentResult>(`/api/payments/${reference}/verify`),

  /** Sandbox-only: marks a pending payment paid when no gateway is configured. */
  devComplete: (reference: string) =>
    request<{ message: string; payment: Payment }>(
      `/api/payments/${reference}/dev-complete`,
      { method: 'POST' }
    ),

  myPayments: () => request<Payment[]>('/api/payments/my-payments'),
};

/* ----------------------------------------------------------------- admin */

export const adminApi = {
  stats: () => request<AdminStats>('/api/admin/stats'),

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

  changeRole: (id: string, role: Role) =>
    request<{ message: string; user: User }>(`/api/admin/users/${id}/role`, {
      method: 'PATCH',
      body: { role },
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
};
