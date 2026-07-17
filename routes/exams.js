const router = require('express').Router();
const Exam = require('../models/Exam');
const ExamAttempt = require('../models/ExamAttempt');
const { auth, authorize } = require('../middleware/auth');
const crypto = require('crypto');

// CREATE EXAM
router.post('/', auth, authorize('teacher', 'admin'), async (req, res) => {
  try {
    let totalMarks = 0;
    if (req.body.questions) {
      req.body.questions.forEach(q => {
        totalMarks += q.points || 1;
      });
    }

    const exam = new Exam({
      ...req.body,
      creator: req.user._id,
      accessCode: crypto.randomBytes(4).toString('hex').toUpperCase()
    });

    exam.settings.totalMarks = totalMarks;
    await exam.save();

    res.status(201).json({
      message: 'Exam created successfully',
      exam,
      accessCode: exam.accessCode
    });
  } catch (error) {
    console.error('Create exam error:', error);
    res.status(500).json({ message: 'Error creating exam' });
  }
});

// GET TEACHER EXAMS
router.get('/my-exams', auth, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const exams = await Exam.find({ creator: req.user._id })
      .sort({ createdAt: -1 });
    res.json(exams);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching exams' });
  }
});

// JOIN EXAM
router.post('/join', auth, async (req, res) => {
  try {
    const { accessCode } = req.body;

    if (!accessCode) {
      return res.status(400).json({ message: 'Please enter access code' });
    }

    const exam = await Exam.findOne({
      accessCode: accessCode.toUpperCase(),
      'settings.isPublished': true
    }).populate('creator', 'name');

    if (!exam) {
      return res.status(404).json({ message: 'Invalid access code or exam not published' });
    }

    const now = new Date();
    if (exam.settings.startDate) {
      const startDate = new Date(exam.settings.startDate);
      if (!isNaN(startDate.getTime()) && now < startDate) {
        return res.status(400).json({
          message: 'Exam has not started yet. Starts: ' + startDate.toLocaleString()
        });
      }
    }
    if (exam.settings.endDate) {
      const endDate = new Date(exam.settings.endDate);
      if (!isNaN(endDate.getTime()) && now > endDate) {
        return res.status(400).json({
          message: 'Exam has ended on: ' + endDate.toLocaleString()
        });
      }
    }

    const attemptCount = await ExamAttempt.countDocuments({
      exam: exam._id,
      student: req.user._id,
      status: { $ne: 'in-progress' }
    });

    if (attemptCount >= exam.settings.maxAttempts) {
      return res.status(400).json({ message: 'Maximum attempts reached' });
    }

    res.json({ message: 'Access granted', exam });
  } catch (error) {
    res.status(500).json({ message: 'Error joining exam' });
  }
});

// PUBLIC JOIN - No auth
router.post('/join-public', async (req, res) => {
  try {
    const { accessCode } = req.body;

    if (!accessCode) {
      return res.status(400).json({ message: 'Access code required' });
    }

    const exam = await Exam.findOne({
      accessCode: accessCode.toUpperCase(),
      'settings.isPublished': true
    }).populate('creator', 'name');

    if (!exam) {
      return res.status(404).json({
        message: 'Exam not found or not published'
      });
    }

    const now = new Date();
    if (exam.settings.startDate) {
      const startDate = new Date(exam.settings.startDate);
      if (!isNaN(startDate.getTime()) && now < startDate) {
        return res.status(400).json({
          message: 'Exam has not started yet. Starts: ' + startDate.toLocaleString()
        });
      }
    }
    if (exam.settings.endDate) {
      const endDate = new Date(exam.settings.endDate);
      if (!isNaN(endDate.getTime()) && now > endDate) {
        return res.status(400).json({
          message: 'Exam has ended on: ' + endDate.toLocaleString()
        });
      }
    }

    res.json({
      message: 'Exam found',
      exam: {
        _id: exam._id,
        title: exam.title,
        description: exam.description,
        subject: exam.subject,
        creator: exam.creator,
        settings: {
          duration: exam.settings.duration,
          passingMarks: exam.settings.passingMarks,
          totalMarks: exam.settings.totalMarks
        },
        questions: exam.questions
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error loading exam' });
  }
});

// GET EXAM STATS
router.get('/:id/stats', auth, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const exam = await Exam.findOne({
      _id: req.params.id,
      creator: req.user._id
    }).populate('questions.question');

    if (!exam) {
      return res.status(404).json({ message: 'Exam not found' });
    }

    const attempts = await ExamAttempt.find({
      exam: req.params.id,
      status: { $ne: 'in-progress' }
    })
    .populate('student', 'name email')
    .sort({ completedAt: -1 });

    const inProgressCount = await ExamAttempt.countDocuments({
      exam: req.params.id,
      status: 'in-progress'
    });

    let stats = {
      totalAttempts: attempts.length + inProgressCount,
      completed: attempts.length,
      inProgress: inProgressCount,
      averageScore: 0,
      highestScore: 0,
      lowestScore: 0,
      passRate: 0
    };

    if (attempts.length > 0) {
      const scores = attempts.map(a => a.percentage || 0);
      stats.averageScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      stats.highestScore = Math.max(...scores);
      stats.lowestScore = Math.min(...scores);
      const passedCount = attempts.filter(
        a => (a.percentage || 0) >= (exam.settings.passingMarks || 50)
      ).length;
      stats.passRate = (passedCount / attempts.length) * 100;
    }

    res.json({ exam, attempts, stats });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ message: 'Error fetching statistics' });
  }
});

// GET EXAM TO TAKE
router.get('/:id/take', auth, async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id)
      .populate({
        path: 'questions.question',
        select: '-correctAnswer -explanation'
      });

    if (!exam) {
      return res.status(404).json({ message: 'Exam not found' });
    }

    let questions = [...exam.questions];
    if (exam.settings.shuffleQuestions) {
      questions = questions.sort(() => Math.random() - 0.5);
    }

    res.json({ ...exam.toObject(), questions });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching exam' });
  }
});

// PUBLISH OR UNPUBLISH
router.patch('/:id/publish', auth, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const exam = await Exam.findOneAndUpdate(
      { _id: req.params.id, creator: req.user._id },
      { 'settings.isPublished': req.body.isPublished },
      { new: true }
    );
    if (!exam) {
      return res.status(404).json({ message: 'Exam not found' });
    }
    res.json({ message: 'Exam updated successfully', exam });
  } catch (error) {
    res.status(500).json({ message: 'Error updating exam' });
  }
});

// DELETE EXAM
router.delete('/:id', auth, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const exam = await Exam.findOneAndDelete({
      _id: req.params.id,
      creator: req.user._id
    });
    if (!exam) {
      return res.status(404).json({ message: 'Exam not found' });
    }
    await ExamAttempt.deleteMany({ exam: req.params.id });
    res.json({ message: 'Exam deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting exam' });
  }
});

module.exports = router;