const router = require('express').Router();
const ExamAttempt = require('../models/ExamAttempt');
const Exam = require('../models/Exam');
const Question = require('../models/Question');
const { auth, authorize } = require('../middleware/auth');

// START ATTEMPT
router.post('/start', auth, async (req, res) => {
  try {
    const { examId } = req.body;

    const exam = await Exam.findById(examId);
    if (!exam) {
      return res.status(404).json({ message: 'Exam not found' });
    }

    const existingAttempt = await ExamAttempt.findOne({
      exam: examId,
      student: req.user._id,
      status: 'in-progress'
    });

    if (existingAttempt) {
      return res.json({ message: 'Resuming attempt', attempt: existingAttempt });
    }

    const attempt = new ExamAttempt({
      exam: examId,
      student: req.user._id,
      totalPoints: exam.settings.totalMarks,
      answers: exam.questions.map(q => ({
        question: q.question,
        pointsEarned: 0
      }))
    });

    await attempt.save();
    res.status(201).json({ message: 'Exam started', attempt });
  } catch (error) {
    console.error('Start attempt error:', error);
    res.status(500).json({ message: 'Error starting exam' });
  }
});

// SAVE ANSWER
router.patch('/:attemptId/answer', auth, async (req, res) => {
  try {
    const { questionId, selectedOption, textAnswer } = req.body;

    const attempt = await ExamAttempt.findOne({
      _id: req.params.attemptId,
      student: req.user._id,
      status: 'in-progress'
    });

    if (!attempt) {
      return res.status(404).json({ message: 'Active attempt not found' });
    }

    const answerIndex = attempt.answers.findIndex(
      a => a.question && a.question.toString() === questionId
    );

    if (answerIndex !== -1) {
      attempt.answers[answerIndex].selectedOption = selectedOption;
      attempt.answers[answerIndex].textAnswer = textAnswer;
    } else {
      attempt.answers.push({ question: questionId, selectedOption, textAnswer });
    }

    await attempt.save();
    res.json({ message: 'Answer saved' });
  } catch (error) {
    res.status(500).json({ message: 'Error saving answer' });
  }
});

// SUBMIT EXAM
router.post('/:attemptId/submit', auth, async (req, res) => {
  try {
    const attempt = await ExamAttempt.findOne({
      _id: req.params.attemptId,
      student: req.user._id,
      status: 'in-progress'
    });

    if (!attempt) {
      return res.status(404).json({ message: 'Active attempt not found' });
    }

    const exam = await Exam.findById(attempt.exam)
      .populate('questions.question');

    let totalScore = 0;

    for (let i = 0; i < attempt.answers.length; i++) {
      const answer = attempt.answers[i];
      const question = await Question.findById(answer.question);
      if (!question) continue;

      const examQ = exam.questions.find(
        q => q.question._id.toString() === answer.question.toString()
      );
      const maxPoints = examQ?.points || question.points || 1;

      if (question.questionType === 'multiple-choice' ||
          question.questionType === 'true-false') {
        const correctIndex = question.options.findIndex(o => o.isCorrect);
        const isCorrect = answer.selectedOption === correctIndex;
        attempt.answers[i].isCorrect = isCorrect;
        attempt.answers[i].pointsEarned = isCorrect ? maxPoints : 0;
        if (isCorrect) totalScore += maxPoints;

      } else if (question.questionType === 'short-answer' ||
                 question.questionType === 'fill-blank') {
        const isCorrect = answer.textAnswer?.toLowerCase().trim() ===
                         question.correctAnswer?.toLowerCase().trim();
        attempt.answers[i].isCorrect = isCorrect;
        attempt.answers[i].pointsEarned = isCorrect ? maxPoints : 0;
        if (isCorrect) totalScore += maxPoints;
      }
    }

    attempt.score = totalScore;
    attempt.percentage = attempt.totalPoints > 0
      ? (totalScore / attempt.totalPoints) * 100
      : 0;
    attempt.status = 'completed';
    attempt.completedAt = new Date();
    attempt.timeSpent = Math.floor(
      (attempt.completedAt - attempt.startedAt) / 1000
    );

    await attempt.save();

    res.json({
      message: 'Exam submitted successfully',
      score: attempt.score,
      totalPoints: attempt.totalPoints,
      percentage: attempt.percentage.toFixed(2),
      timeSpent: attempt.timeSpent,
      passed: attempt.score >= exam.settings.passingMarks
    });
  } catch (error) {
    console.error('Submit error:', error);
    res.status(500).json({ message: 'Error submitting exam' });
  }
});

// GET MY ATTEMPTS
router.get('/my-attempts', auth, async (req, res) => {
  try {
    const attempts = await ExamAttempt.find({
      student: req.user._id,
      status: { $ne: 'in-progress' }
    })
    .populate('exam', 'title subject settings')
    .sort({ completedAt: -1 });

    res.json(attempts);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching attempts' });
  }
});

module.exports = router;