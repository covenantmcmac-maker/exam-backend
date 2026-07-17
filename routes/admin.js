const router = require('express').Router();
const User = require('../models/User');
const Exam = require('../models/Exam');
const ExamAttempt = require('../models/ExamAttempt');
const Question = require('../models/Question');
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
    const totalAttempts = await ExamAttempt.countDocuments();
    const completedAttempts = await ExamAttempt.countDocuments({ status: { $ne: 'in-progress' } });

    res.json({
      totalUsers,
      totalTeachers,
      totalStudents,
      totalAdmins,
      totalExams,
      totalQuestions,
      totalAttempts,
      completedAttempts
    });
  } catch (error) {
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
    const exams = await Exam.find()
      .populate('creator', 'name email')
      .sort({ createdAt: -1 });
    res.json(exams);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching exams' });
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