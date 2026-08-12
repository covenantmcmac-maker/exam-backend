/**
 * Stub of the Exam Platform API used for offline smoke-testing the mobile
 * client. It mirrors the response shapes of the real Express routes so the
 * app's api layer can be exercised without MongoDB.
 *
 * Usage: node scripts/mock-server.js [port]
 */
const http = require('http');
const { URL } = require('url');

const PORT = parseInt(process.argv[2], 10) || 5099;
const TOKEN = 'mock.jwt.token';
const REGISTRATION_PAYMENT_TOKEN = 'registration-payment-token';

const teacher = {
  id: 'u_teacher',
  _id: 'u_teacher',
  name: 'Ada Teacher',
  email: 'teacher@example.com',
  role: 'teacher',
  mustChangePassword: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};
const admin = {
  id: 'u_admin',
  _id: 'u_admin',
  name: 'Admin User',
  email: 'admin@example.com',
  role: 'admin',
  mustChangePassword: false,
  createdAt: '2026-02-01T00:00:00.000Z',
};
const student = {
  id: 'u_student',
  _id: 'u_student',
  name: 'Sam Student',
  email: 'student@example.com',
  role: 'student',
  mustChangePassword: false,
  createdAt: '2026-03-01T00:00:00.000Z',
};
const existingStudent = {
  id: 'u_existing',
  _id: 'u_existing',
  name: 'Existing Student',
  email: 'existing@example.com',
  role: 'student',
  mustChangePassword: false,
  createdAt: '2026-04-01T00:00:00.000Z',
};

const users = [teacher, admin, student, existingStudent];
const credentials = new Map([
  [teacher.email, 'secret'],
  [admin.email, 'secret'],
  [student.email, 'secret'],
  [existingStudent.email, 'secret'],
]);

let registrationConfig = {
  studentRegistrationFee: 1200,
  applyRegistrationFeeToExistingStudents: true,
  studentRegistrationFeeActivatedAt: new Date('2026-08-01T00:00:00Z').toISOString(),
};
const registrationPaidUsers = new Set();
const payments = new Map();
const calls = [];

const question = {
  _id: 'q1',
  questionText: 'What is 2 + 2?',
  questionType: 'multiple-choice',
  options: [
    { _id: 'o1', text: '3', isCorrect: false },
    { _id: 'o2', text: '4', isCorrect: true },
    { _id: 'o3', text: '5', isCorrect: false },
  ],
  points: 2,
  difficulty: 'easy',
  subject: 'Maths',
  explanation: 'Two plus two equals four.',
};

const pastQuestion = {
  _id: 'pq1',
  questionText: 'Capital of France?',
  questionType: 'multiple-choice',
  options: [
    { _id: 'p1', text: 'London', isCorrect: false },
    { _id: 'p2', text: 'Paris', isCorrect: true },
    { _id: 'p3', text: 'Rome', isCorrect: false },
  ],
  points: 2,
  difficulty: 'medium',
  subject: 'Geography',
  explanation: 'Paris is capital',
  isPastQuestion: true,
  pastQuestionYear: 2022,
  pastQuestionSession: 'June',
  pastQuestionExamType: 'Final',
  movedToPastAt: new Date().toISOString(),
  creator: { _id: teacher._id, name: teacher.name },
};

const exam = {
  _id: 'e1',
  title: 'Sample Quiz',
  description: 'A short quiz',
  subject: 'Maths',
  creator: { _id: teacher._id, name: teacher.name },
  questions: [{ question, points: 2, order: 0 }],
  settings: {
    duration: 30,
    totalMarks: 2,
    passingMarks: 1,
    shuffleQuestions: false,
    shuffleOptions: false,
    showResults: true,
    allowReview: true,
    maxAttempts: 1,
    isPublished: true,
  },
  accessCode: 'ABCD1234',
};

const pastExam = {
  _id: 'e2',
  title: 'Biology 2022',
  description: 'Previous-years exam paper',
  subject: 'Biology',
  source: 'past',
  year: 2022,
  pricing: { entryFee: 300, reviewFee: 500, currency: 'NGN' },
  questionCount: 10,
  settings: {
    duration: 60,
    totalMarks: 40,
    passingMarks: 20,
    maxAttempts: 1,
    allowReview: true,
  },
  purchasedEntry: false,
  completedCount: 0,
  maxAttempts: 1,
  attemptsLeft: 1,
  inProgressAttempt: null,
  startable: false,
};

const attempt = {
  _id: 'a1',
  exam,
  student,
  answers: [{ question: 'q1', pointsEarned: 0 }],
  score: 0,
  totalPoints: 2,
  percentage: 0,
  status: 'in-progress',
  startedAt: new Date().toISOString(),
};

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function userByEmail(email) {
  return users.find((u) => u.email === String(email || '').toLowerCase()) || null;
}

function currentAuthUser(req) {
  if (!(req.headers.authorization || '').startsWith('Bearer ')) return null;
  return student;
}

function canLoginWithoutRegistration(user) {
  if (!user || user.role !== 'student') return true;
  if (registrationConfig.studentRegistrationFee <= 0) return true;
  if (registrationPaidUsers.has(user._id)) return true;
  if (
    registrationConfig.applyRegistrationFeeToExistingStudents === false &&
    user._id === existingStudent._id
  ) {
    return true;
  }
  return false;
}

function registrationRequiredPayload(message = 'Registration payment required') {
  return {
    message,
    paymentRequired: true,
    purpose: 'registration',
    amount: registrationConfig.studentRegistrationFee,
    currency: 'NGN',
    paymentToken: REGISTRATION_PAYMENT_TOKEN,
  };
}

function paymentFor(reference) {
  return payments.get(reference) || null;
}

function savePayment(payment) {
  payments.set(payment.reference, payment);
  return payment;
}

function paymentHistory() {
  return Array.from(payments.values());
}

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const parsedUrl = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const url = parsedUrl.pathname;
    const key = `${req.method} ${url}`;
    const authed = (req.headers.authorization || '').startsWith('Bearer ');
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      body = {};
    }
    calls.push({
      key,
      authed,
      body,
      query: Object.fromEntries(parsedUrl.searchParams.entries()),
    });

    // Reference-free payment lookup: "is THIS item already paid for?".
    // Mirrors the real route, which also reconciles a pending charge against
    // Paystack before answering.
    if (key === 'GET /api/payments/status') {
      const purpose = parsedUrl.searchParams.get('purpose');
      const examId = parsedUrl.searchParams.get('examId');
      const attemptId = parsedUrl.searchParams.get('attemptId');
      const paymentToken = parsedUrl.searchParams.get('paymentToken');

      if (!['entry', 'review', 'registration'].includes(purpose)) {
        return send(res, 400, { message: 'A valid purpose is required.' });
      }
      if (purpose === 'registration') {
        if (paymentToken !== REGISTRATION_PAYMENT_TOKEN) {
          return send(res, 401, { message: 'Please sign in to check this payment.' });
        }
      } else if (!authed) {
        return send(res, 401, { message: 'Please sign in to check this payment.' });
      }
      if (purpose !== 'registration' && !examId) {
        return send(res, 400, { message: 'examId is required for this purpose.' });
      }

      const matching = paymentHistory().filter((p) => {
        if (p.purpose !== purpose) return false;
        if (purpose === 'registration') return true;
        if (String(p.exam) !== String(examId)) return false;
        return purpose === 'review'
          ? String(p.attempt || '') === String(attemptId || '')
          : true;
      });

      const paid = matching.find((p) => p.status === 'paid');
      if (paid) return send(res, 200, { paid: true, payment: paid, pending: null });

      const pending = matching.find((p) => p.status === 'pending');
      return send(res, 200, {
        paid: false,
        payment: null,
        pending: pending
          ? {
              reference: pending.reference,
              amount: pending.amount,
              currency: pending.currency,
              authorizationUrl: 'https://paystack.test/resume/' + pending.reference,
            }
          : null,
      });
    }

    const verifyMatch = key.match(/^GET \/api\/payments\/([^/]+)\/verify$/);
    if (verifyMatch) {
      const payment = paymentFor(verifyMatch[1]);
      if (!payment) return send(res, 404, { message: 'Payment not found' });
      const paymentToken = parsedUrl.searchParams.get('paymentToken');
      if (payment.purpose === 'registration') {
        if (paymentToken !== REGISTRATION_PAYMENT_TOKEN) {
          return send(res, 401, { message: 'Please sign in to verify this payment.' });
        }
      } else if (!authed) {
        return send(res, 401, { message: 'No token, access denied' });
      }
      return send(res, 200, { payment, paid: payment.status === 'paid' });
    }

    const devCompleteMatch = key.match(/^POST \/api\/payments\/([^/]+)\/dev-complete$/);
    if (devCompleteMatch) {
      const payment = paymentFor(devCompleteMatch[1]);
      if (!payment) return send(res, 404, { message: 'Payment not found' });
      if (payment.purpose === 'registration') {
        if (body.paymentToken !== REGISTRATION_PAYMENT_TOKEN) {
          return send(res, 401, { message: 'Please sign in to complete this payment.' });
        }
        registrationPaidUsers.add(student._id);
      } else if (!authed) {
        return send(res, 401, { message: 'No token, access denied' });
      }
      payment.status = 'paid';
      return send(res, 200, { message: 'Payment marked as paid (dev mode)', payment });
    }

    const resetOneMatch = key.match(/^POST \/api\/admin\/users\/([^/]+)\/reset-password$/);
    if (resetOneMatch) {
      if (!authed) return send(res, 401, { message: 'No token, access denied' });
      const user = users.find((u) => u._id === resetOneMatch[1]);
      if (!user) return send(res, 404, { message: 'User not found' });
      credentials.set(user.email, '123456');
      user.mustChangePassword = true;
      return send(res, 200, { message: 'Password reset to 123456', user });
    }

    const needsAuth = new Set([
      'GET /api/auth/me',
      'PATCH /api/auth/change-password',
      'GET /api/exams/my-exams',
      'POST /api/exams/join',
      'POST /api/exams/join-public',
      'GET /api/attempts/my-attempts',
      'POST /api/attempts/start',
      'POST /api/attempts/a1/security-flag',
      'GET /api/attempts/a1/review',
      'GET /api/questions',
      'GET /api/questions/past',
      'GET /api/questions/past-questions',
      'GET /api/questions/past-questions/stats',
      'GET /api/questions/past-questions/practice/generate',
      'GET /api/admin/stats',
      'GET /api/admin/config',
      'PATCH /api/admin/config',
      'GET /api/admin/past-questions',
      'GET /api/admin/past-questions/stats',
      'GET /api/admin/users',
      'GET /api/admin/exams',
      'GET /api/admin/attempts',
      'GET /api/admin/payments',
      'POST /api/admin/users/reset-passwords',
      'POST /api/admin/users',
      'POST /api/payments/initiate',
      'GET /api/payments/my-payments',
    ]);

    if (needsAuth.has(key) && !authed && !(key === 'POST /api/payments/initiate' && body.purpose === 'registration')) {
      return send(res, 401, { message: 'No token, access denied' });
    }

    switch (key) {
      case 'GET /':
        return send(res, 200, { message: 'Exam Platform API is running!' });

      case 'POST /api/auth/login': {
        const user = userByEmail(body.email);
        if (!user || credentials.get(user.email) !== body.password) {
          return send(res, 401, { message: 'Invalid email or password' });
        }
        if (!canLoginWithoutRegistration(user)) {
          return send(res, 402, registrationRequiredPayload('Complete the one-time registration payment before you sign in.'));
        }
        return send(res, 200, {
          message: 'Login successful',
          token: TOKEN,
          user,
        });
      }

      case 'POST /api/auth/register': {
        const role = body.role || 'student';
        const created = {
          id: 'u_new',
          _id: 'u_new',
          name: body.name,
          email: String(body.email || '').toLowerCase(),
          role,
          mustChangePassword: false,
        };
        credentials.set(created.email, body.password);
        if (role === 'student' && registrationConfig.studentRegistrationFee > 0) {
          return send(res, 402, {
            ...registrationRequiredPayload('Account created. Complete the one-time registration payment before you sign in.'),
          });
        }
        return send(res, 201, {
          message: 'Account created successfully',
          token: TOKEN,
          user: created,
        });
      }

      case 'GET /api/auth/me':
        return send(res, 200, { user: currentAuthUser(req) || student });

      case 'PATCH /api/auth/change-password': {
        if (body.currentPassword === 'wrong') {
          return send(res, 401, { message: 'Current password is incorrect' });
        }
        student.mustChangePassword = false;
        credentials.set(student.email, body.newPassword);
        return send(res, 200, { message: 'Password changed successfully' });
      }

      case 'POST /api/auth/guest-register':
        return send(res, 410, {
          message: 'Guest exam joining has been removed. Please sign in or create an account first.',
        });

      case 'POST /api/exams/join-public':
        if (!authed) return send(res, 401, { message: 'No token, access denied' });
        if (body.accessCode !== exam.accessCode) {
          return send(res, 404, { message: 'Invalid access code or exam not published' });
        }
        return send(res, 200, { message: 'Access granted', exam });

      case 'POST /api/exams/join':
        if (body.accessCode !== exam.accessCode) {
          return send(res, 404, { message: 'Invalid access code or exam not published' });
        }
        return send(res, 200, { message: 'Access granted', exam });

      case 'GET /api/exams/my-exams':
        return send(res, 200, [exam]);

      case 'GET /api/exams/past':
        return send(res, 200, {
          exams: [
            {
              ...pastExam,
              purchasedEntry: Boolean(paymentFor('PST-MOCK-1')?.status === 'paid'),
              startable: Boolean(paymentFor('PST-MOCK-1')?.status === 'paid'),
            },
          ],
        });

      case 'GET /api/config':
        return send(res, 200, {
          currency: 'NGN',
          currencySymbol: '₦',
          defaultEntryFee: 300,
          defaultReviewFee: 500,
          paymentsConfigured: false,
          paymentsDevMode: true,
          paystackPublicKey: '',
          studentRegistrationFee: registrationConfig.studentRegistrationFee,
          studentRegistrationFeeActive: registrationConfig.studentRegistrationFee > 0,
          applyRegistrationFeeToExistingStudents:
            registrationConfig.applyRegistrationFeeToExistingStudents,
        });

      case 'POST /api/payments/initiate': {
        if (body.purpose === 'registration') {
          if (body.paymentToken !== REGISTRATION_PAYMENT_TOKEN) {
            return send(res, 401, { message: 'Please sign in to start this payment.' });
          }
          const existing = paymentFor('REG-MOCK-1');
          if (existing) {
            return send(res, 200, {
              message: 'Payment already initiated',
              payment: existing,
              authorizationUrl: 'https://paystack.test/registration/REG-MOCK-1',
              devMode: true,
            });
          }
          const payment = savePayment({
            _id: 'p_reg',
            student: student,
            exam: null,
            attempt: null,
            purpose: 'registration',
            amount: registrationConfig.studentRegistrationFee,
            currency: 'NGN',
            provider: 'sandbox',
            reference: 'REG-MOCK-1',
            status: 'pending',
          });
          return send(res, 201, {
            message: 'Payment initiated (dev mode)',
            payment,
            authorizationUrl: null,
            devMode: true,
          });
        }

        const reference = body.purpose === 'review' ? 'REV-MOCK-1' : 'PST-MOCK-1';
        const existing = paymentFor(reference);
        if (existing) {
          return send(res, 200, {
            message: 'Payment already initiated',
            payment: existing,
            authorizationUrl: 'https://paystack.test/reused',
            devMode: true,
          });
        }
        const payment = savePayment({
          _id: body.purpose === 'review' ? 'p_review' : 'p_entry',
          student,
          exam: body.examId || 'e2',
          attempt: body.attemptId || null,
          purpose: body.purpose || 'entry',
          amount: body.purpose === 'review' ? 500 : 300,
          currency: 'NGN',
          provider: 'sandbox',
          reference,
          status: 'pending',
        });
        return send(res, 201, {
          message: 'Payment initiated (dev mode)',
          payment,
          authorizationUrl: null,
          devMode: true,
        });
      }

      case 'GET /api/payments/my-payments':
        return send(res, 200, paymentHistory());

      case 'POST /api/exams':
        return send(res, 201, {
          message: 'Exam created successfully',
          exam,
          accessCode: exam.accessCode,
        });

      case 'GET /api/exams/e1/take':
        return send(res, 200, exam);

      case 'GET /api/exams/e1/edit':
        return send(res, 200, exam);

      case 'GET /api/exams/e1/stats':
        return send(res, 200, {
          exam,
          attempts: [{ ...attempt, status: 'completed', score: 2, percentage: 100 }],
          stats: {
            totalAttempts: 1,
            completed: 1,
            inProgress: 0,
            averageScore: 100,
            highestScore: 100,
            lowestScore: 100,
            passRate: 100,
          },
        });

      case 'PATCH /api/exams/e1/publish':
        return send(res, 200, {
          message: 'Exam updated successfully',
          exam: {
            ...exam,
            settings: { ...exam.settings, isPublished: body.isPublished },
          },
        });

      case 'POST /api/attempts/start':
        if (body.examId === 'e2' && paymentFor('PST-MOCK-1')?.status !== 'paid') {
          return send(res, 402, {
            message: 'Payment required to take this exam.',
            paymentRequired: true,
            purpose: 'entry',
            examId: 'e2',
            amount: 300,
            currency: 'NGN',
          });
        }
        return send(res, 201, { message: 'Exam started', attempt });

      case 'PATCH /api/attempts/a1/answer':
        return send(res, 200, { message: 'Answer saved' });

      case 'POST /api/attempts/a1/submit':
        return send(res, 200, {
          message: 'Exam submitted successfully',
          showResults: true,
          allowReview: exam.settings.allowReview,
          attemptId: 'a1',
          score: 2,
          totalPoints: 2,
          percentage: '100.00',
          timeSpent: 42,
          passed: true,
        });

      case 'POST /api/attempts/a1/security-flag':
        return send(res, 200, {
          message: 'Safe exam mode warning recorded',
          warningCount: 1,
          warningsRemaining: 2,
          autoSubmitted: false,
        });

      case 'GET /api/attempts/a1/review':
        return send(res, 200, {
          attemptId: 'a1',
          exam: {
            _id: exam._id,
            title: exam.title,
            subject: exam.subject,
            settings: {
              showResults: exam.settings.showResults,
              allowReview: exam.settings.allowReview,
              passingMarks: exam.settings.passingMarks,
              totalMarks: exam.settings.totalMarks,
            },
          },
          score: 2,
          totalPoints: 2,
          percentage: 100,
          passed: true,
          timeSpent: 42,
          questions: [{
            order: 0,
            questionId: 'q1',
            questionText: question.questionText,
            questionType: question.questionType,
            points: 2,
            options: question.options.map(({ _id, text }) => ({ _id, text })),
            selectedOption: 1,
            isCorrect: true,
            pointsEarned: 2,
            correctOptionIndex: 1,
            correctAnswer: '4',
            explanation: question.explanation,
          }],
        });

      case 'GET /api/attempts/my-attempts':
        return send(res, 200, [
          {
            ...attempt,
            answers: undefined,
            status: 'completed',
            score: 2,
            percentage: 100,
            timeSpent: 42,
            canReview: exam.settings.allowReview,
          },
        ]);

      case 'GET /api/questions':
        return send(res, 200, { questions: [question], total: 1, pages: 1 });

      case 'GET /api/questions/past':
        return send(res, 200, { questions: [pastQuestion], total: 1, pages: 1 });

      case 'GET /api/questions/past-questions':
        return send(res, 200, { questions: [pastQuestion], total: 1, pages: 1 });

      case 'GET /api/questions/past-questions/stats':
        return send(res, 200, {
          overview: { total: 1, subjects: ['Geography'], years: [2022], subjectCount: 1 },
          bySubject: [{ _id: 'Geography', count: 1 }],
          byYear: [{ _id: 2022, count: 1 }],
        });

      case 'GET /api/questions/past-questions/practice/generate':
        return send(res, 200, {
          questions: [pastQuestion, question],
          totalMatching: 2,
          count: 2,
          filters: {},
        });

      case 'POST /api/questions/past-questions/practice/submit':
        return send(res, 200, {
          message: 'Practice submitted',
          score: 2,
          totalPoints: 4,
          percentage: '50.00',
          passed: true,
          totalQuestions: 2,
          results: [
            {
              questionId: 'pq1',
              questionText: pastQuestion.questionText,
              isCorrect: true,
              pointsEarned: 2,
              maxPoints: 2,
              correctAnswer: 'B',
              options: pastQuestion.options,
              explanation: 'Paris is capital',
              yourAnswer: { selectedOption: 1 },
            },
            {
              questionId: 'q1',
              questionText: question.questionText,
              isCorrect: false,
              pointsEarned: 0,
              maxPoints: 2,
              correctAnswer: 'B',
              options: question.options,
              explanation: '',
              yourAnswer: { selectedOption: 0 },
            },
          ],
        });

      case 'GET /api/questions/q1':
      case 'GET /api/questions/pq1':
        return send(res, 200, url.endsWith('pq1') ? pastQuestion : question);

      case 'POST /api/questions':
        return send(res, 201, { ...question, _id: 'q2' });

      case 'POST /api/questions/bulk-upload':
        return send(res, 201, { message: 'Successfully uploaded 3 questions!', count: 3 });

      case 'POST /api/questions/bulk-delete':
        return send(res, 200, {
          message: 'Successfully deleted questions',
          deletedCount: Array.isArray(body.questionIds) ? body.questionIds.length : 0,
        });

      case 'POST /api/questions/bulk-move-to-past':
        return send(res, 200, {
          message: `Successfully moved ${Array.isArray(body.questionIds) ? body.questionIds.length : 0} questions to past questions`,
          modifiedCount: Array.isArray(body.questionIds) ? body.questionIds.length : 0,
          questions: [pastQuestion],
        });

      case 'POST /api/questions/bulk-restore':
        return send(res, 200, {
          message: `Successfully restored ${Array.isArray(body.questionIds) ? body.questionIds.length : 0} questions from past questions`,
          modifiedCount: Array.isArray(body.questionIds) ? body.questionIds.length : 0,
        });

      case 'PATCH /api/questions/q1/move-to-past':
        return send(res, 200, {
          message: 'Question moved to past questions successfully',
          question: { ...question, isPastQuestion: true, movedToPastAt: new Date().toISOString() },
        });

      case 'PATCH /api/questions/pq1/restore':
        return send(res, 200, {
          message: 'Question restored from past questions successfully',
          question: { ...pastQuestion, isPastQuestion: false, movedToPastAt: null },
        });

      case 'GET /api/admin/stats':
        return send(res, 200, {
          totalUsers: users.length,
          totalTeachers: 1,
          totalStudents: 2,
          totalAdmins: 1,
          totalExams: 1,
          totalQuestions: 1,
          totalActiveQuestions: 1,
          totalPastQuestions: 1,
          totalAttempts: 1,
          completedAttempts: 1,
          registration: registrationConfig,
          payments: {
            total: paymentHistory().filter((p) => p.status === 'paid').length,
            entryCount: paymentHistory().filter((p) => p.status === 'paid' && p.purpose === 'entry').length,
            reviewCount: paymentHistory().filter((p) => p.status === 'paid' && p.purpose === 'review').length,
            registrationCount: paymentHistory().filter((p) => p.status === 'paid' && p.purpose === 'registration').length,
            totalRevenue: paymentHistory().filter((p) => p.status === 'paid').reduce((sum, p) => sum + p.amount, 0),
            entryRevenue: paymentHistory().filter((p) => p.status === 'paid' && p.purpose === 'entry').reduce((sum, p) => sum + p.amount, 0),
            reviewRevenue: paymentHistory().filter((p) => p.status === 'paid' && p.purpose === 'review').reduce((sum, p) => sum + p.amount, 0),
            registrationRevenue: paymentHistory().filter((p) => p.status === 'paid' && p.purpose === 'registration').reduce((sum, p) => sum + p.amount, 0),
            currency: 'NGN',
          },
        });

      case 'GET /api/admin/config':
        return send(res, 200, registrationConfig);

      case 'PATCH /api/admin/config':
        registrationConfig = {
          ...registrationConfig,
          ...body,
        };
        return send(res, 200, { message: 'Configuration updated successfully', config: registrationConfig });

      case 'POST /api/admin/users': {
        const created = {
          id: 'u_created',
          _id: 'u_created',
          name: body.name,
          email: String(body.email || '').toLowerCase(),
          role: body.role || 'student',
          mustChangePassword: true,
        };
        return send(res, 201, { message: 'Account created. The default password is 123456.', user: created });
      }

      case 'POST /api/admin/users/reset-passwords':
        if (body.confirm !== true) {
          return send(res, 400, { message: 'Confirmation is required' });
        }
        student.mustChangePassword = true;
        existingStudent.mustChangePassword = true;
        credentials.set(student.email, '123456');
        credentials.set(existingStudent.email, '123456');
        return send(res, 200, { message: 'Reset 2 student passwords to 123456', resetCount: 2 });

      case 'GET /api/admin/past-questions':
        return send(res, 200, { questions: [pastQuestion], total: 1, pages: 1 });

      case 'GET /api/admin/past-questions/stats':
        return send(res, 200, {
          totalPast: 1,
          byYear: [{ _id: 2022, count: 1 }],
          bySubject: [{ _id: 'Geography', count: 1 }],
          byTeacher: [{ _id: teacher._id, count: 1, name: teacher.name, email: teacher.email }],
          bySession: [{ _id: 'June', count: 1 }],
          byExamType: [{ _id: 'Final', count: 1 }],
          byDifficulty: [{ _id: 'medium', count: 1 }],
          recent: [{ _id: 'pq1', questionText: pastQuestion.questionText, subject: 'Geography', pastQuestionYear: 2022, movedToPastAt: new Date().toISOString(), creator: { name: teacher.name } }],
        });

      case 'DELETE /api/admin/past-questions/pq1':
        return send(res, 200, { message: 'Past question deleted' });

      case 'POST /api/admin/past-questions/bulk-delete':
        return send(res, 200, {
          message: `Deleted ${Array.isArray(body.questionIds) ? body.questionIds.length : 0}`,
          deletedCount: Array.isArray(body.questionIds) ? body.questionIds.length : 0,
        });

      case 'PATCH /api/admin/past-questions/pq1/restore':
        return send(res, 200, { message: 'Restored to active bank', question: { ...pastQuestion, isPastQuestion: false } });

      case 'POST /api/admin/past-questions/bulk-restore':
        return send(res, 200, { message: `Restored ${Array.isArray(body.questionIds) ? body.questionIds.length : 0}`, modifiedCount: Array.isArray(body.questionIds) ? body.questionIds.length : 0 });

      case 'PATCH /api/admin/past-questions/pq1':
        return send(res, 200, { message: 'Past question updated', question: pastQuestion });

      case 'GET /api/admin/users': {
        const role = parsedUrl.searchParams.get('role');
        const search = String(parsedUrl.searchParams.get('search') || '').trim().toLowerCase();
        const sort = parsedUrl.searchParams.get('sort') || 'newest';
        const parsedPage = Number.parseInt(parsedUrl.searchParams.get('page'), 10);
        const parsedLimit = Number.parseInt(parsedUrl.searchParams.get('limit'), 10);
        const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
        const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
          ? Math.min(parsedLimit, 100)
          : 50;

        let matchingUsers = users.filter((user) => {
          if (role && role !== 'all' && user.role !== role) return false;
          if (!search) return true;
          return user.name.toLowerCase().includes(search) || user.email.toLowerCase().includes(search);
        });

        matchingUsers = [...matchingUsers].sort((a, b) => {
          if (sort === 'name_asc') {
            return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a._id.localeCompare(b._id);
          }
          if (sort === 'name_desc') {
            return b.name.localeCompare(a.name, 'en', { sensitivity: 'base' }) || b._id.localeCompare(a._id);
          }
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b._id.localeCompare(a._id);
        });

        const total = matchingUsers.length;
        const start = (page - 1) * limit;
        return send(res, 200, {
          users: matchingUsers.slice(start, start + limit),
          total,
          pages: Math.ceil(total / limit),
        });
      }

      case 'GET /api/admin/exams':
        return send(res, 200, [exam, { ...pastExam, creator: { _id: teacher._id, name: teacher.name } }]);

      case 'GET /api/admin/attempts':
        return send(res, 200, [{ ...attempt, status: 'completed', score: 2, percentage: 100 }]);

      case 'GET /api/admin/payments':
        return send(res, 200, {
          payments: paymentHistory(),
          totals: {
            totalRevenue: paymentHistory().filter((p) => p.status === 'paid').reduce((sum, p) => sum + p.amount, 0),
            entryCount: paymentHistory().filter((p) => p.status === 'paid' && p.purpose === 'entry').length,
            reviewCount: paymentHistory().filter((p) => p.status === 'paid' && p.purpose === 'review').length,
            registrationCount: paymentHistory().filter((p) => p.status === 'paid' && p.purpose === 'registration').length,
          },
        });

      case 'GET /__calls':
        return send(res, 200, calls);

      default:
        return send(res, 404, { message: `No mock for ${key}` });
    }
  });
});

server.listen(PORT, () => {
  console.log(`mock API listening on http://127.0.0.1:${PORT}`);
});
