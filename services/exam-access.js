const ExamAccessGrant = require('../models/ExamAccessGrant');
const ExamAttempt = require('../models/ExamAttempt');

async function grantTeacherExamAccess(studentId, examId) {
  const existing = await ExamAccessGrant.findOne({ exam: examId, student: studentId });
  if (existing) return existing;
  const grant = new ExamAccessGrant({ exam: examId, student: studentId });
  await grant.save();
  return grant;
}

async function hasTeacherExamAccess(studentId, examId) {
  const grant = await ExamAccessGrant.findOne({ exam: examId, student: studentId });
  return Boolean(grant);
}

function canBypassTeacherExamAccess(user, exam) {
  return (
    user?.role === 'admin' ||
    (user?.role === 'teacher' && String(exam?.creator?._id || exam?.creator) === String(user?._id))
  );
}

async function requireTeacherExamAccess(req, res, exam) {
  if (!exam || exam.source === 'past') return true;
  if (canBypassTeacherExamAccess(req.user, exam)) return true;
  if (req.user?.role !== 'student') return true;

  const granted = await hasTeacherExamAccess(req.user._id, exam._id);
  if (granted) return true;

  res.status(403).json({
    message: 'Please enter the teacher access code before opening this exam.',
    accessCodeRequired: true,
  });
  return false;
}

async function requireExamAvailability(req, res, exam) {
  if (!exam) {
    res.status(404).json({ message: 'Exam not found' });
    return false;
  }

  if (exam.settings?.isPublished !== true) {
    res.status(404).json({ message: 'Exam not found or not published' });
    return false;
  }

  const now = new Date();
  if (exam.settings?.startDate) {
    const startDate = new Date(exam.settings.startDate);
    if (!Number.isNaN(startDate.getTime()) && now < startDate) {
      res.status(400).json({
        message: 'Exam has not started yet. Starts: ' + startDate.toLocaleString(),
      });
      return false;
    }
  }

  if (exam.settings?.endDate) {
    const endDate = new Date(exam.settings.endDate);
    if (!Number.isNaN(endDate.getTime()) && now > endDate) {
      res.status(400).json({
        message: 'Exam has ended on: ' + endDate.toLocaleString(),
      });
      return false;
    }
  }

  if (req.user?.role === 'student') {
    const maxAttempts = Number(exam.settings?.maxAttempts) || 0;
    if (maxAttempts > 0) {
      const attemptCount = await ExamAttempt.countDocuments({
        exam: exam._id,
        student: req.user._id,
        status: { $ne: 'in-progress' },
      });
      if (attemptCount >= maxAttempts) {
        res.status(400).json({ message: 'Maximum attempts reached' });
        return false;
      }
    }
  }

  return true;
}

module.exports = {
  grantTeacherExamAccess,
  hasTeacherExamAccess,
  requireTeacherExamAccess,
  requireExamAvailability,
};
