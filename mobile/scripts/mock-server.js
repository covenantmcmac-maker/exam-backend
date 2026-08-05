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
  isPastQuestion: false,
  movedToPastAt: null,
};

const pastQuestion = {
  _id: 'pq1',
  questionText: 'What is the capital of France? (Past 2022)',
  questionType: 'multiple-choice',
  options: [
    { _id: 'o1', text: 'London', isCorrect: false },
    { _id: 'o2', text: 'Paris', isCorrect: true },
    { _id: 'o3', text: 'Berlin', isCorrect: false },
  ],
  points: 2,
  difficulty: 'medium',
  subject: 'Geography',
  isPastQuestion: true,
  movedToPastAt: new Date().toISOString(),
  pastQuestionYear: 2022,
  pastQuestionSession: 'June',
  pastQuestionExamType: 'Final',
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
      'GET /api/attempts/my-attempts',
      'POST /api/attempts/start',
      'GET /api/questions',
      'GET /api/questions/past',
      'GET /api/questions/past-questions',
      'GET /api/questions/past-questions/stats',
      'GET /api/admin/stats',
    ];
    if (needsAuth.includes(key) && !authed) {
      return send(res, 401, { message: 'No token, access denied' });
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

      case 'GET /api/questions/q1':
      case 'GET /api/questions/pq1':
        return send(res, 200, body && body._id === 'pq1' ? pastQuestion : question);

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
          totalUsers: 3,
          totalTeachers: 1,
          totalStudents: 1,
          totalAdmins: 1,
          totalExams: 1,
          totalQuestions: 1,
          totalAttempts: 1,
          completedAttempts: 1,
        });

      case 'GET /api/admin/users':
        return send(res, 200, { users: [teacher, student], total: 2, pages: 1 });

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
