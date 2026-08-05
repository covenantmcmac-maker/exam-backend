const router = require('express').Router();
const ExamAttempt = require('../models/ExamAttempt');
const Exam = require('../models/Exam');
const Question = require('../models/Question');
const { auth, authorize } = require('../middleware/auth');
const { requireEntryPayment, requireReviewAccess } = require('../services/payment-access');

// START ATTEMPT
router.post('/start', auth, async (req, res) => {
  try {
    const { examId } = req.body;

    const exam = await Exam.findById(examId);
    if (!exam) {
      return res.status(404).json({ message: 'Exam not found' });
    }

    // Paid past-question papers: no payment → no start.
    if (!(await requireEntryPayment(req, res, exam))) return;

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

    // Check if teacher wants to show results
    if (exam.settings.showResults) {
      res.json({
        message: 'Exam submitted successfully',
        attemptId: attempt._id,
        reviewEnabled: Boolean(exam.settings.allowReview),
        showResults: true,
        score: attempt.score,
        totalPoints: attempt.totalPoints,
        percentage: attempt.percentage.toFixed(2),
        timeSpent: attempt.timeSpent,
        passed: attempt.score >= exam.settings.passingMarks
      });
    } else {
      res.json({
        message: 'Exam submitted successfully',
        attemptId: attempt._id,
        reviewEnabled: Boolean(exam.settings.allowReview),
        showResults: false,
        timeSpent: attempt.timeSpent
      });
    }
  } catch (error) {
    console.error('Submit error:', error);
    res.status(500).json({ message: 'Error submitting exam' });
  }
});

// GET ANSWER REVIEW
// Students see their script plus the correct answers and explanations.
// Locked behind the exam's review fee (teacher exams: teacher-set fee;
// past papers: platform fee). Exam owners get in for free.
router.get('/:attemptId/review', auth, async (req, res) => {
  try {
    const attempt = await ExamAttempt.findOne({
      _id: req.params.attemptId,
      status: { $ne: 'in-progress' }
    }).populate('exam');

    if (!attempt) {
      return res.status(404).json({ message: 'Attempt not found' });
    }

    const exam = attempt.exam;

    // Ownership check
    const isOwner =
      req.user.role === 'admin' ||
      (req.user.role === 'teacher' &&
        String(exam.creator?._id || exam.creator) === String(req.user._id));
    const isStudent = attempt.student.toString() === req.user._id.toString();

    if (!isOwner && !isStudent) {
      return res.status(403).json({ message: 'Not allowed to view this attempt' });
    }

    // Exam owners may always review; students need the teacher's permission.
    if (isStudent && !isOwner && !exam.settings.allowReview) {
      return res.status(403).json({ message: 'Answer review is not enabled for this exam' });
    }

    // Students pay the review fee; owners don't.
    if (isStudent && !(await requireReviewAccess(req, res, exam, attempt))) return;

    const questions = await Question.find({
      _id: { $in: attempt.answers.map((a) => a.question).filter(Boolean) }
    });

    const qMap = new Map(questions.map((q) => [q._id.toString(), q]));

    const items = attempt.answers
      .filter((a) => a.question && qMap.has(a.question.toString()))
      .map((answer) => {
        const q = qMap.get(answer.question.toString());
        const examQ = (exam.questions || []).find(
          (eq) => eq.question?.toString?.() === q._id.toString()
        );
        const maxPoints = examQ?.points || q.points || 1;
        const correctIndex =
          q.questionType === 'multiple-choice' || q.questionType === 'true-false'
            ? q.options.findIndex((o) => o.isCorrect)
            : -1;

        return {
          questionId: q._id,
          questionText: q.questionText,
          questionType: q.questionType,
          options: q.options.map((o, i) => ({
            text: o.text,
            isCorrect: o.isCorrect,
            isSelected: answer.selectedOption === i
          })),
          correctAnswer: q.correctAnswer || null,
          correctOptionIndex: correctIndex,
          selectedOption: answer.selectedOption ?? null,
          textAnswer: answer.textAnswer || '',
          isCorrect: answer.isCorrect,
          pointsEarned: answer.pointsEarned || 0,
          maxPoints,
          explanation: q.explanation || null
        };
      });

    res.json({
      exam: {
        _id: exam._id,
        title: exam.title,
        subject: exam.subject,
        source: exam.source,
        year: exam.year
      },
      attempt: {
        _id: attempt._id,
        score: attempt.score,
        totalPoints: attempt.totalPoints,
        percentage: attempt.percentage,
        status: attempt.status,
        completedAt: attempt.completedAt,
        timeSpent: attempt.timeSpent
      },
      items
    });
  } catch (error) {
    console.error('Review error:', error);
    res.status(500).json({ message: 'Error fetching review' });
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

// MANUAL GRADE
router.patch('/:attemptId/grade', auth, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const { grades } = req.body;

    const attempt = await ExamAttempt.findById(req.params.attemptId);
    if (!attempt) {
      return res.status(404).json({ message: 'Attempt not found' });
    }

    let additionalScore = 0;

    for (const grade of grades) {
      const answerIndex = attempt.answers.findIndex(
        a => a.question.toString() === grade.questionId
      );
      if (answerIndex !== -1) {
        attempt.answers[answerIndex].pointsEarned = grade.pointsEarned;
        attempt.answers[answerIndex].isCorrect = grade.pointsEarned > 0;
        additionalScore += grade.pointsEarned;
      }
    }

    attempt.score += additionalScore;
    attempt.percentage = (attempt.score / attempt.totalPoints) * 100;
    attempt.status = 'graded';

    await attempt.save();
    res.json({ message: 'Graded successfully', attempt });
  } catch (error) {
    res.status(500).json({ message: 'Error grading attempt' });
  }
});
// DELETE ATTEMPT (Teacher)
router.delete('/:attemptId', auth, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const attempt = await ExamAttempt.findById(req.params.attemptId)
      .populate('exam');

    if (!attempt) {
      return res.status(404).json({ message: 'Attempt not found' });
    }

    // Check if teacher owns the exam
    if (req.user.role === 'teacher') {
      const exam = await Exam.findOne({
        _id: attempt.exam._id || attempt.exam,
        creator: req.user._id
      });
      if (!exam) {
        return res.status(403).json({ message: 'Not authorized to delete this attempt' });
      }
    }

    await ExamAttempt.findByIdAndDelete(req.params.attemptId);
    res.json({ message: 'Attempt deleted. Student can retake the exam.' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting attempt' });
  }
});

module.exports = router;