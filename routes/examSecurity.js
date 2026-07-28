const ExamAttempt = require('../models/ExamAttempt');

function userId(value) {
  if (!value) return '';
  if (value._id) return value._id.toString();
  return value.toString();
}

function isExamManager(req, exam) {
  return req.user.role === 'admin' || userId(exam.creator) === userId(req.user);
}

function examAvailabilityError(exam, now = new Date()) {
  if (!exam.settings?.isPublished) {
    return 'Exam is not published';
  }

  if (exam.settings.startDate) {
    const startDate = new Date(exam.settings.startDate);
    if (!isNaN(startDate.getTime()) && now < startDate) {
      return 'Exam has not started yet. Starts: ' + startDate.toLocaleString();
    }
  }

  if (exam.settings.endDate) {
    const endDate = new Date(exam.settings.endDate);
    if (!isNaN(endDate.getTime()) && now > endDate) {
      return 'Exam has ended on: ' + endDate.toLocaleString();
    }
  }

  return null;
}

async function studentAccessError(req, exam, { checkAttemptLimit = true } = {}) {
  if (isExamManager(req, exam)) return null;

  const availability = examAvailabilityError(exam);
  if (availability) return availability;

  if (!checkAttemptLimit) return null;

  const [completedAttempts, activeAttempt] = await Promise.all([
    ExamAttempt.countDocuments({
      exam: exam._id,
      student: req.user._id,
      status: { $ne: 'in-progress' }
    }),
    ExamAttempt.exists({
      exam: exam._id,
      student: req.user._id,
      status: 'in-progress'
    })
  ]);

  if (!activeAttempt && completedAttempts >= (exam.settings.maxAttempts || 1)) {
    return 'Maximum attempts reached';
  }

  return null;
}

function stripStudentQuestionFields(question) {
  const q = typeof question.toObject === 'function' ? question.toObject() : { ...question };
  delete q.correctAnswer;
  delete q.explanation;

  if (Array.isArray(q.options)) {
    q.options = q.options.map((option) => {
      const o = typeof option.toObject === 'function' ? option.toObject() : { ...option };
      delete o.isCorrect;
      return o;
    });
  }

  return q;
}

function sanitizeExamForStudent(exam, questions) {
  const obj = typeof exam.toObject === 'function' ? exam.toObject() : { ...exam };
  obj.questions = questions.map((entry) => {
    const qRef = typeof entry.toObject === 'function' ? entry.toObject() : { ...entry };
    if (qRef.question && typeof qRef.question === 'object') {
      qRef.question = stripStudentQuestionFields(qRef.question);
    }
    return qRef;
  });
  return obj;
}

module.exports = {
  examAvailabilityError,
  isExamManager,
  sanitizeExamForStudent,
  studentAccessError
};
