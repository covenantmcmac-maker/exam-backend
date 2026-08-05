const router = require('express').Router();
const User = require('../models/User');
const Exam = require('../models/Exam');
const ExamAttempt = require('../models/ExamAttempt');
const Question = require('../models/Question');
const Payment = require('../models/Payment');
const { auth, authorize } = require('../middleware/auth');

// ========================
// GET DASHBOARD STATS
// ========================
router.get('/stats', auth, authorize('admin'), async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalTeachers = await User.countDocuments({ role: 'teacher' });
    const totalStudents = await User.countDocuments({ role: 'student' });
    const totalAdmins = await User.countDocuments({ role: 'admin' });
    const totalExams = await Exam.countDocuments();
    const totalQuestions = await Question.countDocuments();
    // Questions created before the archive feature have no isPastQuestion
    // field; they are active unless they have been explicitly archived.
    const totalActiveQuestions = await Question.countDocuments({
      isPastQuestion: { $ne: true }
    });
    const totalPastQuestions = await Question.countDocuments({ isPastQuestion: true });
    const totalAttempts = await ExamAttempt.countDocuments();
    const completedAttempts = await ExamAttempt.countDocuments({ status: { $ne: 'in-progress' } });

    // Past questions breakdown for quick stats
    const pastByYear = await Question.aggregate([
      { $match: { isPastQuestion: true, pastQuestionYear: { $ne: null } } },
      { $group: { _id: '$pastQuestionYear', count: { $sum: 1 } } },
      { $sort: { _id: -1 } },
      { $limit: 10 }
    ]);

    const pastBySubject = await Question.aggregate([
      { $match: { isPastQuestion: true } },
      { $group: { _id: '$subject', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    // Revenue: every paid entry + review fee. Amounts are whole currency units.
    const paidPayments = await Payment.find({ status: 'paid' });
    const totalRevenue = paidPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
    const entryRevenue = paidPayments
      .filter(p => p.purpose === 'entry')
      .reduce((sum, p) => sum + (p.amount || 0), 0);
    const reviewRevenue = paidPayments
      .filter(p => p.purpose === 'review')
      .reduce((sum, p) => sum + (p.amount || 0), 0);

    res.json({
      totalUsers,
      totalTeachers,
      totalStudents,
      totalAdmins,
      totalExams,
      totalQuestions,
      totalActiveQuestions,
      totalPastQuestions,
      totalAttempts,
      completedAttempts,
      pastByYear,
      pastBySubject,
      payments: {
        total: paidPayments.length,
        entryCount: paidPayments.filter(p => p.purpose === 'entry').length,
        reviewCount: paidPayments.filter(p => p.purpose === 'review').length,
        totalRevenue,
        entryRevenue,
        reviewRevenue,
        currency: paidPayments[0]?.currency || 'NGN'
      }
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ message: 'Error fetching stats' });
  }
});

// ========================
// GET ALL USERS
// ========================
router.get('/users', auth, authorize('admin'), async (req, res) => {
  try {
    const { role, search, page = 1, limit = 50 } = req.query;

    const filter = {};
    if (role && role !== 'all') filter.role = role;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const total = await User.countDocuments(filter);
    const users = await User.find(filter)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip((page - 1) * parseInt(limit))
      .limit(parseInt(limit));

    res.json({ users, total, pages: Math.ceil(total / parseInt(limit)) });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching users' });
  }
});

// ========================
// UPDATE USER ROLE
// ========================
router.patch('/users/:id/role', auth, authorize('admin'), async (req, res) => {
  try {
    const { role } = req.body;

    if (!['student', 'teacher', 'admin'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ message: 'Cannot change your own role' });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ message: `User role changed to ${role}`, user });
  } catch (error) {
    res.status(500).json({ message: 'Error updating user' });
  }
});

// ========================
// DELETE USER
// ========================
router.delete('/users/:id', auth, authorize('admin'), async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ message: 'Cannot delete yourself' });
    }

    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Delete user's attempts
    await ExamAttempt.deleteMany({ student: req.params.id });

    // Delete user's questions and exams if teacher
    if (user.role === 'teacher') {
      await Question.deleteMany({ creator: req.params.id });
      const exams = await Exam.find({ creator: req.params.id });
      for (const exam of exams) {
        await ExamAttempt.deleteMany({ exam: exam._id });
      }
      await Exam.deleteMany({ creator: req.params.id });
    }

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting user' });
  }
});

// ========================
// GET ALL EXAMS (Admin view)
// ========================
router.get('/exams', auth, authorize('admin'), async (req, res) => {
  try {
    const filter = {};
    if (req.query.source && ['teacher', 'past'].includes(req.query.source)) {
      filter.source = req.query.source;
    }
    const exams = await Exam.find(filter)
      .populate('creator', 'name email')
      .sort({ createdAt: -1 });
    res.json(exams);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching exams' });
  }
});

// ========================
// GET ALL PAYMENTS (Admin view)
// ========================
router.get('/payments', auth, authorize('admin'), async (req, res) => {
  try {
    const filter = {};
    if (req.query.status && ['pending', 'paid', 'failed', 'expired'].includes(req.query.status)) {
      filter.status = req.query.status;
    }
    if (req.query.purpose && ['entry', 'review'].includes(req.query.purpose)) {
      filter.purpose = req.query.purpose;
    }

    const payments = await Payment.find(filter)
      .populate('student', 'name email')
      .populate('exam', 'title subject year source')
      .sort({ createdAt: -1 })
      .limit(200);

    const totals = await Payment.aggregate([
      { $match: { status: 'paid' } },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$amount' },
          entryCount: { $sum: { $cond: [{ $eq: ['$purpose', 'entry'] }, 1, 0] } },
          reviewCount: { $sum: { $cond: [{ $eq: ['$purpose', 'review'] }, 1, 0] } }
        }
      }
    ]);

    res.json({ payments, totals: totals[0] || { totalRevenue: 0, entryCount: 0, reviewCount: 0 } });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching payments' });
  }
});

// ========================
// DELETE ANY EXAM (Admin)
// ========================
router.delete('/exams/:id', auth, authorize('admin'), async (req, res) => {
  try {
    const exam = await Exam.findByIdAndDelete(req.params.id);
    if (!exam) {
      return res.status(404).json({ message: 'Exam not found' });
    }
    await ExamAttempt.deleteMany({ exam: req.params.id });
    res.json({ message: 'Exam deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting exam' });
  }
});

// ========================
// GET ALL ATTEMPTS (Admin view)
// ========================
router.get('/attempts', auth, authorize('admin'), async (req, res) => {
  try {
    const attempts = await ExamAttempt.find()
      .populate('student', 'name email')
      .populate('exam', 'title subject')
      .sort({ completedAt: -1 })
      .limit(100);
    res.json(attempts);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching attempts' });
  }
});

// ========================
// DELETE ATTEMPT
// ========================
router.delete('/attempts/:id', auth, authorize('admin'), async (req, res) => {
  try {
    const attempt = await ExamAttempt.findByIdAndDelete(req.params.id);
    if (!attempt) {
      return res.status(404).json({ message: 'Attempt not found' });
    }
    res.json({ message: 'Attempt deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting attempt' });
  }
});

// ========================
// PAST QUESTIONS ADMIN
// ========================

// LIST ALL PAST QUESTIONS (admin)
router.get('/past-questions', auth, authorize('admin'), async (req, res) => {
  try {
    const { subject, year, session, examType, teacher, search, page = 1, limit = 100 } = req.query;
    const filter = { isPastQuestion: true };

    if (subject) filter.subject = subject;
    if (year) filter.pastQuestionYear = parseInt(year);
    if (session) filter.pastQuestionSession = session;
    if (examType) filter.pastQuestionExamType = examType;
    if (teacher) filter.creator = teacher;

    if (search) {
      const regex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { questionText: regex },
        { subject: regex },
        { category: regex },
        { tags: regex }
      ];
    }

    const total = await Question.countDocuments(filter);
    const questions = await Question.find(filter)
      .populate('creator', 'name email')
      .populate('originalCreator', 'name email')
      .sort({ movedToPastAt: -1, createdAt: -1 })
      .skip((page - 1) * parseInt(limit))
      .limit(parseInt(limit));

    res.json({ questions, total, pages: Math.ceil(total / parseInt(limit)) });
  } catch (error) {
    console.error('Admin past list error:', error);
    res.status(500).json({ message: 'Error fetching past questions' });
  }
});

// PAST QUESTIONS STATS (admin detailed)
router.get('/past-questions/stats', auth, authorize('admin'), async (req, res) => {
  try {
    const totalPast = await Question.countDocuments({ isPastQuestion: true });

    const byYear = await Question.aggregate([
      { $match: { isPastQuestion: true, pastQuestionYear: { $ne: null } } },
      { $group: { _id: '$pastQuestionYear', count: { $sum: 1 } } },
      { $sort: { _id: -1 } }
    ]);

    const bySubject = await Question.aggregate([
      { $match: { isPastQuestion: true } },
      { $group: { _id: '$subject', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    const byTeacher = await Question.aggregate([
      { $match: { isPastQuestion: true } },
      { $group: { _id: '$creator', count: { $sum: 1 } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'teacher' } },
      { $unwind: { path: '$teacher', preserveNullAndEmptyArrays: true } },
      { $project: { count: 1, name: '$teacher.name', email: '$teacher.email' } },
      { $sort: { count: -1 } },
      { $limit: 20 }
    ]);

    const bySession = await Question.aggregate([
      { $match: { isPastQuestion: true, pastQuestionSession: { $ne: null, $ne: '' } } },
      { $group: { _id: '$pastQuestionSession', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    const byExamType = await Question.aggregate([
      { $match: { isPastQuestion: true, pastQuestionExamType: { $ne: null, $ne: '' } } },
      { $group: { _id: '$pastQuestionExamType', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    const recent = await Question.find({ isPastQuestion: true })
      .populate('creator', 'name')
      .sort({ movedToPastAt: -1 })
      .limit(10)
      .select('questionText subject pastQuestionYear movedToPastAt creator');

    const byDifficulty = await Question.aggregate([
      { $match: { isPastQuestion: true } },
      { $group: { _id: '$difficulty', count: { $sum: 1 } } }
    ]);

    res.json({
      totalPast,
      byYear,
      bySubject,
      byTeacher,
      bySession,
      byExamType,
      byDifficulty,
      recent
    });
  } catch (error) {
    console.error('Admin past stats error:', error);
    res.status(500).json({ message: 'Error fetching past stats' });
  }
});

// UPDATE PAST QUESTION METADATA (admin)
router.patch('/past-questions/:id', auth, authorize('admin'), async (req, res) => {
  try {
    const { pastQuestionYear, pastQuestionSession, pastQuestionExamType, subject, category } = req.body;
    const update = {};

    if (pastQuestionYear !== undefined) update.pastQuestionYear = pastQuestionYear ? parseInt(pastQuestionYear) : null;
    if (pastQuestionSession !== undefined) update.pastQuestionSession = pastQuestionSession;
    if (pastQuestionExamType !== undefined) update.pastQuestionExamType = pastQuestionExamType;
    if (subject !== undefined) update.subject = subject;
    if (category !== undefined) update.category = category;

    const question = await Question.findOneAndUpdate(
      { _id: req.params.id, isPastQuestion: true },
      update,
      { new: true }
    ).populate('creator', 'name');

    if (!question) return res.status(404).json({ message: 'Past question not found' });

    res.json({ message: 'Past question updated', question });
  } catch (error) {
    res.status(500).json({ message: 'Error updating past question' });
  }
});

// RESTORE PAST QUESTION TO ACTIVE (admin)
router.patch('/past-questions/:id/restore', auth, authorize('admin'), async (req, res) => {
  try {
    const question = await Question.findOneAndUpdate(
      { _id: req.params.id, isPastQuestion: true },
      {
        $set: { isPastQuestion: false, movedToPastAt: null },
        $unset: { pastQuestionYear: '', pastQuestionSession: '', pastQuestionExamType: '' }
      },
      { new: true }
    );
    if (!question) return res.status(404).json({ message: 'Past question not found' });
    res.json({ message: 'Restored to active bank', question });
  } catch (error) {
    res.status(500).json({ message: 'Error restoring' });
  }
});

// BULK RESTORE (admin)
router.post('/past-questions/bulk-restore', auth, authorize('admin'), async (req, res) => {
  try {
    const { questionIds } = req.body;
    if (!questionIds || questionIds.length === 0) return res.status(400).json({ message: 'No IDs' });

    const result = await Question.updateMany(
      { _id: { $in: questionIds }, isPastQuestion: true },
      {
        $set: { isPastQuestion: false, movedToPastAt: null },
        $unset: { pastQuestionYear: '', pastQuestionSession: '', pastQuestionExamType: '' }
      }
    );
    res.json({ message: `Restored ${result.modifiedCount}`, modifiedCount: result.modifiedCount });
  } catch (error) {
    res.status(500).json({ message: 'Error bulk restoring' });
  }
});

// DELETE PAST QUESTION (admin)
router.delete('/past-questions/:id', auth, authorize('admin'), async (req, res) => {
  try {
    const q = await Question.findOneAndDelete({ _id: req.params.id, isPastQuestion: true });
    if (!q) return res.status(404).json({ message: 'Past question not found' });
    res.json({ message: 'Past question deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting' });
  }
});

// BULK DELETE PAST QUESTIONS (admin)
router.post('/past-questions/bulk-delete', auth, authorize('admin'), async (req, res) => {
  try {
    const { questionIds } = req.body;
    if (!questionIds || questionIds.length === 0) return res.status(400).json({ message: 'No IDs' });

    const result = await Question.deleteMany({ _id: { $in: questionIds }, isPastQuestion: true });
    res.json({ message: `Deleted ${result.deletedCount}`, deletedCount: result.deletedCount });
  } catch (error) {
    res.status(500).json({ message: 'Error bulk deleting' });
  }
});

// ========================
// CREATE ADMIN ACCOUNT
// ========================
router.post('/create-admin', auth, authorize('admin'), async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: 'Email already exists' });
    }

    const user = new User({ name, email, password, role: 'admin' });
    await user.save();

    res.status(201).json({
      message: 'Admin account created',
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error creating admin' });
  }
});

module.exports = router;
