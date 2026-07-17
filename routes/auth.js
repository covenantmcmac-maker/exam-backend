const router = require('express').Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { auth } = require('../middleware/auth');

// REGISTER
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Please fill all fields' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    const user = new User({ name, email, password, role: role || 'student' });
    await user.save();

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'Account created successfully',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// LOGIN
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Please enter email and password' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET CURRENT USER
router.get('/me', auth, async (req, res) => {
  try {
    res.json({ user: req.user });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// GUEST REGISTER
router.post('/guest-register', async (req, res) => {
  try {
    const { name, email, examCode } = req.body;

    if (!name || !email) {
      return res.status(400).json({
        message: 'Please enter your name and email'
      });
    }

    const Exam = require('../models/Exam');
    const ExamAttempt = require('../models/ExamAttempt');

    const exam = await Exam.findOne({
      accessCode: examCode.toUpperCase(),
      'settings.isPublished': true
    });

    if (!exam) {
      return res.status(404).json({
        message: 'Exam not found or not published'
      });
    }

    let user = await User.findOne({ email });

    if (!user) {
      user = new User({
        name,
        email,
        password: 'guest_' + Date.now() + '_' + Math.random().toString(36),
        role: 'student'
      });
      await user.save();
    }

    const existingAttempt = await ExamAttempt.findOne({
      exam: exam._id,
      student: user._id,
      status: { $ne: 'in-progress' }
    });

    if (existingAttempt) {
      return res.status(400).json({
        message: 'This email has already been used to take this exam. Each student can only take the exam once.'
      });
    }

    const inProgressAttempt = await ExamAttempt.findOne({
      exam: exam._id,
      student: user._id,
      status: 'in-progress'
    });

    if (inProgressAttempt) {
      return res.status(400).json({
        message: 'You already have an exam in progress.'
      });
    }

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Joined successfully',
      token,
      examId: exam._id,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Guest register error:', error);
    res.status(500).json({ message: 'Error joining exam' });
  }
});

module.exports = router;