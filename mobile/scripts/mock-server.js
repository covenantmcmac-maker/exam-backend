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

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const now = Date.now();

/** Upload timestamps are staggered so sort-by-date has something to order. */
const ago = (ms) => new Date(now - ms).toISOString();

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
  createdAt: ago(HOUR),
};

const question2 = {
  _id: 'q2',
  questionText: 'Define photosynthesis.',
  questionType: 'short-answer',
  options: [],
  correctAnswer: 'Converting light into chemical energy',
  points: 5,
  difficulty: 'hard',
  subject: 'Biology',
  createdAt: ago(2 * DAY),
};

const question3 = {
  _id: 'q3',
  questionText: 'Alexander the Great was tutored by Aristotle.',
  questionType: 'true-false',
  options: [
    { _id: 'o4', text: 'True', isCorrect: true },
    { _id: 'o5', text: 'False', isCorrect: false },
  ],
  points: 3,
  difficulty: 'medium',
  subject: 'History',
  createdAt: ago(7 * DAY),
};

/** Served newest-first by default, mirroring the real API's default ordering. */
const questions = [question, question2, question3];

const SORT_KEYS = new Set([
  'newest',
  'oldest',
  'alpha',
  'alphaDesc',
  'difficultyAsc',
  'difficultyDesc',
  'pointsDesc',
  'pointsAsc',
  'subject',
  'subjectDesc',
]);

const DIFFICULTY_RANK = { easy: 0, medium: 1, hard: 2 };
const uploadedAt = (q) => Date.parse(q.createdAt || '') || 0;
const textCompare = (a, b) =>
  String(a || '').trim().localeCompare(String(b || '').trim(), 'en', { sensitivity: 'base' });
const byNewest = (a, b) => uploadedAt(b) - uploadedAt(a);

function appliedSort(searchParams) {
  const requested = searchParams.get('sort');
  return SORT_KEYS.has(requested) ? requested : 'newest';
}

function sortQuestionsForApi(sort) {
  const sorted = [...questions];
  sorted.sort((a, b) => {
    let primary = 0;
    switch (sort) {
      case 'oldest':
        primary = uploadedAt(a) - uploadedAt(b);
        break;
      case 'alpha':
        primary = textCompare(a.questionText, b.questionText);
        break;
      case 'alphaDesc':
        primary = textCompare(b.questionText, a.questionText);
        break;
      case 'difficultyAsc':
        primary = (DIFFICULTY_RANK[a.difficulty] ?? 99) - (DIFFICULTY_RANK[b.difficulty] ?? 99);
        break;
      case 'difficultyDesc':
        primary = (DIFFICULTY_RANK[b.difficulty] ?? -1) - (DIFFICULTY_RANK[a.difficulty] ?? -1);
        break;
      case 'pointsDesc':
        primary = (b.points ?? 0) - (a.points ?? 0);
        break;
      case 'pointsAsc':
        primary = (a.points ?? 0) - (b.points ?? 0);
        break;
      case 'subject':
        primary = textCompare(a.subject, b.subject);
        break;
      case 'subjectDesc':
        primary = textCompare(b.subject, a.subject);
        break;
      case 'newest':
      default:
        primary = byNewest(a, b);
    }
    return primary || byNewest(a, b);
  });
  return sorted;
}

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

function stripAnswersForStudent(examData) {
  return {
    ...examData,
    questions: examData.questions.map((slot) => ({
      ...slot,
      question: {
        ...slot.question,
        correctAnswer: undefined,
        explanation: undefined,
        options: (slot.question.options || []).map(({ isCorrect, ...option }) => option),
      },
    })),
  };
}

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
    const parsedUrl = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const url = parsedUrl.pathname;
    const query = Object.fromEntries(parsedUrl.searchParams.entries());
    const key = `${req.method} ${url}`;
    const authed = (req.headers.authorization || '').startsWith('Bearer ');
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      body = {};
    }
    calls.push({ key, authed, query, body });

    // Routes that require a token.
    const needsAuth = [
      'GET /api/auth/me',
      'GET /api/exams/my-exams',
      'POST /api/exams/join',
      'GET /api/exams/e1/take',
      'GET /api/attempts/my-attempts',
      'POST /api/attempts/start',
      'GET /api/questions',
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
        return send(res, 200, stripAnswersForStudent(exam));

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

      case 'GET /api/questions': {
        const sort = appliedSort(parsedUrl.searchParams);
        return send(res, 200, {
          questions: sortQuestionsForApi(sort),
          total: questions.length,
          pages: 1,
          sort,
        });
      }

      case 'POST /api/questions':
        return send(res, 201, { ...question, _id: 'q4' });

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
          totalQuestions: 3,
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
