/**
 * Stub of the Exam Platform API used for offline smoke-testing the mobile
 * client. It mirrors the response shapes of the real Express routes so the
 * app's api layer can be exercised without MongoDB.
 *
 * Usage: node scripts/mock-server.js [port]
 */
const http = require('http');

const PORT = parseInt(process.argv[2], 10) || 5099;

const TOKEN = 'mock.jwt.token';

const teacher = {
  id: 'u_teacher',
  _id: 'u_teacher',
  name: 'Ada Teacher',
  email: 'teacher@example.com',
  role: 'teacher',
};
const student = {
  id: 'u_student',
  _id: 'u_student',
  name: 'Sam Student',
  email: 'student@example.com',
  role: 'student',
};

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
};

const exam = {
  _id: 'e1',
  title: 'Sample Quiz',
  description: 'A short quiz',
  subject: 'Maths',
  creator: { _id: 'u_teacher', name: 'Ada Teacher' },
  questions: [{ question, points: 2, order: 0 }],
  settings: {
    duration: 30,
    totalMarks: 2,
    passingMarks: 1,
    shuffleQuestions: false,
    shuffleOptions: false,
    showResults: true,
    allowReview: false,
    maxAttempts: 1,
    isPublished: true,
  },
  accessCode: 'ABCD1234',
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

// Paid past-question paper (Biology 2022) — the monetised flow.
const pastExam = {
  _id: 'e2',
  title: 'Biology 2022',
  description: 'Previous-years exam paper',
  subject: 'Biology',
  source: 'past',
  year: 2022,
  pricing: { entryFee: 500, reviewFee: 100, currency: 'NGN' },
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

const reviewPayload = {
  exam: { _id: 'e1', title: 'Sample Quiz', subject: 'Maths', source: 'teacher', year: null },
  attempt: { _id: 'a1', score: 2, totalPoints: 2, percentage: 100, status: 'completed' },
  items: [
    {
      questionId: 'q1',
      questionText: 'What is 2 + 2?',
      questionType: 'multiple-choice',
      options: [
        { text: '3', isCorrect: false, isSelected: false },
        { text: '4', isCorrect: true, isSelected: true },
        { text: '5', isCorrect: false, isSelected: false },
      ],
      correctAnswer: null,
      correctOptionIndex: 1,
      selectedOption: 1,
      textAnswer: '',
      isCorrect: true,
      pointsEarned: 2,
      maxPoints: 2,
      explanation: 'Two plus two equals four.',
    },
  ],
};

// References marked paid via the dev-mode payment flow.
const paidReferences = new Set();

const calls = [];

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const url = req.url.split('?')[0];
    const key = `${req.method} ${url}`;
    const authed = (req.headers.authorization || '').startsWith('Bearer ');
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      body = {};
    }
    calls.push({ key, authed, body });

    // Routes that require a token.
    const needsAuth = [
      'GET /api/auth/me',
      'GET /api/exams/my-exams',
      'POST /api/exams/join',
      'GET /api/exams/past',
      'GET /api/attempts/my-attempts',
      'POST /api/attempts/start',
      'GET /api/questions',
      'GET /api/admin/stats',
      'POST /api/payments/initiate',
      'GET /api/payments/my-payments',
      'GET /api/admin/payments',
    ];
    if (needsAuth.includes(key) && !authed) {
      return send(res, 401, { message: 'No token, access denied' });
    }

    // Dynamic routes (path params).
    const reviewMatch = key.match(/^GET \/api\/attempts\/([^/]+)\/review$/);
    if (reviewMatch) {
      if (!authed) return send(res, 401, { message: 'No token, access denied' });
      return send(res, 200, reviewPayload);
    }

    const devCompleteMatch = key.match(/^POST \/api\/payments\/([^/]+)\/dev-complete$/);
    if (devCompleteMatch) {
      if (!authed) return send(res, 401, { message: 'No token, access denied' });
      paidReferences.add(devCompleteMatch[1]);
      return send(res, 200, {
        message: 'Payment marked as paid (dev mode)',
        payment: {
          _id: 'p1',
          reference: devCompleteMatch[1],
          purpose: 'entry',
          amount: 500,
          currency: 'NGN',
          status: 'paid',
        },
      });
    }

    const verifyMatch = key.match(/^GET \/api\/payments\/([^/]+)\/verify$/);
    if (verifyMatch) {
      if (!authed) return send(res, 401, { message: 'No token, access denied' });
      const paid = paidReferences.has(verifyMatch[1]);
      return send(res, 200, {
        payment: {
          _id: 'p1',
          reference: verifyMatch[1],
          purpose: 'entry',
          amount: 500,
          currency: 'NGN',
          status: paid ? 'paid' : 'pending',
        },
        paid,
      });
    }

    switch (key) {
      case 'GET /':
        return send(res, 200, { message: 'Exam Platform API is running!' });

      case 'POST /api/auth/login':
        if (body.password === 'wrong') {
          return send(res, 401, { message: 'Invalid email or password' });
        }
        return send(res, 200, {
          message: 'Login successful',
          token: TOKEN,
          user: body.email === teacher.email ? teacher : student,
        });

      case 'POST /api/auth/register':
        return send(res, 201, {
          message: 'Account created successfully',
          token: TOKEN,
          user: { ...student, name: body.name, email: body.email, role: body.role },
        });

      case 'GET /api/auth/me':
        return send(res, 200, { user: student });

      case 'POST /api/auth/guest-register':
        return send(res, 200, {
          message: 'Joined successfully',
          token: TOKEN,
          examId: exam._id,
          user: { ...student, name: body.name, email: body.email },
        });

      case 'POST /api/exams/join-public':
        if (body.accessCode !== exam.accessCode) {
          return send(res, 404, { message: 'Exam not found or not published' });
        }
        return send(res, 200, { message: 'Exam found', exam });

      case 'POST /api/exams/join':
        return send(res, 200, { message: 'Access granted', exam });

      case 'GET /api/exams/my-exams':
        return send(res, 200, [exam]);

      case 'GET /api/exams/past':
        return send(res, 200, {
          exams: [
            {
              ...pastExam,
              purchasedEntry: paidReferences.has('PST-MOCK-1'),
              startable: paidReferences.has('PST-MOCK-1'),
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
        });

      case 'POST /api/payments/initiate':
        return send(res, 201, {
          message: 'Payment initiated (dev mode)',
          payment: {
            _id: 'p1',
            reference: 'PST-MOCK-1',
            purpose: body.purpose || 'entry',
            amount: body.purpose === 'review' ? 100 : 500,
            currency: 'NGN',
            provider: 'sandbox',
            status: 'pending',
          },
          authorizationUrl: null,
          devMode: true,
        });

      case 'GET /api/payments/my-payments':
        return send(res, 200, []);

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
        if (body.examId === 'e2' && !paidReferences.has('PST-MOCK-1')) {
          return send(res, 402, {
            message: 'Payment required to take this exam.',
            paymentRequired: true,
            purpose: 'entry',
            examId: 'e2',
            amount: 500,
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
          score: 2,
          totalPoints: 2,
          percentage: '100.00',
          timeSpent: 42,
          passed: true,
        });

      case 'GET /api/attempts/my-attempts':
        return send(res, 200, [
          { ...attempt, status: 'completed', score: 2, percentage: 100, timeSpent: 42 },
        ]);

      case 'GET /api/questions':
        return send(res, 200, { questions: [question], total: 1, pages: 1 });

      case 'POST /api/questions':
        return send(res, 201, { ...question, _id: 'q2' });

      case 'POST /api/questions/bulk-upload':
        // Multipart body — the mock just pretends three questions landed.
        return send(res, 201, {
          message: 'Successfully uploaded 3 questions!',
          count: 3,
        });

      case 'POST /api/questions/bulk-delete':
        return send(res, 200, {
          message: 'Successfully deleted questions',
          deletedCount: Array.isArray(body.questionIds) ? body.questionIds.length : 0,
        });

      case 'GET /api/admin/stats':
        return send(res, 200, {
          totalUsers: 3,
          totalTeachers: 1,
          totalStudents: 1,
          totalAdmins: 1,
          totalExams: 1,
          totalQuestions: 1,
          totalAttempts: 1,
          completedAttempts: 1,
          payments: {
            total: 0,
            entryCount: 0,
            reviewCount: 0,
            totalRevenue: 0,
            entryRevenue: 0,
            reviewRevenue: 0,
            currency: 'NGN',
          },
        });

      case 'GET /api/admin/users':
        return send(res, 200, { users: [teacher, student], total: 2, pages: 1 });

      case 'GET /api/admin/payments':
        return send(res, 200, {
          payments: [],
          totals: { totalRevenue: 0, entryCount: 0, reviewCount: 0 },
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
