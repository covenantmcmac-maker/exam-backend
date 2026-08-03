const router = require('express').Router();
const ExamAttempt = require('../models/ExamAttempt');
const Exam = require('../models/Exam');
const Question = require('../models/Question');
const { auth, authorize } = require('../middleware/auth');


/** Grade and close an active attempt. Used for manual and policy submissions. */
async function finalizeAttempt(attempt, exam, { forced = false } = {}) {
  let totalScore = 0;
  for (let i = 0; i < attempt.answers.length; i++) {
    const answer = attempt.answers[i];
    const question = await Question.findById(answer.question);
    if (!question) continue;
    const examQ = exam.questions.find(q => q.question._id.toString() === answer.question.toString());
    const maxPoints = examQ?.points || question.points || 1;

    if (question.questionType === 'multiple-choice' || question.questionType === 'true-false') {
      const correctIndex = question.options.findIndex(o => o.isCorrect);
const MAX_SECURITY_WARNINGS = 3;

function getQuestionId(value) {
  if (!value) return '';
  if (value._id) return value._id.toString();
  return value.toString();
}

function buildSubmitResult(exam, attempt, message = 'Exam submitted successfully') {
  const base = {
    message,
    showResults: exam.settings.showResults !== false,
    allowReview: !!exam.settings.allowReview,
    attemptId: attempt._id,
    timeSpent: attempt.timeSpent
  };

  if (exam.settings.showResults === false) {
    return base;
  }

  return {
    ...base,
    score: attempt.score,
    totalPoints: attempt.totalPoints,
    percentage: (attempt.percentage || 0).toFixed(2),
    passed: attempt.score >= exam.settings.passingMarks
  };
}

async function finalizeAttempt(attempt, { message, securityAutoSubmit = false } = {}) {
  const exam = await Exam.findById(attempt.exam).populate('questions.question');
  if (!exam) {
    const err = new Error('Exam not found');
    err.status = 404;
    throw err;
  }

  let totalScore = 0;
  const examQuestions = exam.questions || [];

  for (let i = 0; i < attempt.answers.length; i++) {
    const answer = attempt.answers[i];
    const questionId = getQuestionId(answer.question);
    const examQ = examQuestions.find(
      q => q.question && getQuestionId(q.question) === questionId
    );
    const question = examQ?.question || await Question.findById(answer.question);
    if (!question) continue;

    const maxPoints = examQ?.points || question.points || 1;

    if (question.questionType === 'multiple-choice' ||
        question.questionType === 'true-false') {
      const correctIndex = (question.options || []).findIndex(o => o.isCorrect);
      const isCorrect = answer.selectedOption === correctIndex;
      attempt.answers[i].isCorrect = isCorrect;
      attempt.answers[i].pointsEarned = isCorrect ? maxPoints : 0;
      if (isCorrect) totalScore += maxPoints;
    } else if (question.questionType === 'short-answer' || question.questionType === 'fill-blank') {
      const isCorrect = answer.textAnswer?.toLowerCase().trim() === question.correctAnswer?.toLowerCase().trim();
    } else if (question.questionType === 'short-answer' ||
               question.questionType === 'fill-blank') {
      const expected = (question.correctAnswer || '').toLowerCase().trim();
      const given = (answer.textAnswer || '').toLowerCase().trim();
      const isCorrect = expected !== '' && given === expected;
      attempt.answers[i].isCorrect = isCorrect;
      attempt.answers[i].pointsEarned = isCorrect ? maxPoints : 0;
      if (isCorrect) totalScore += maxPoints;
    }
  }
  attempt.score = totalScore;
  attempt.percentage = attempt.totalPoints > 0 ? (totalScore / attempt.totalPoints) * 100 : 0;
  attempt.status = 'completed';
  attempt.forcedSubmission = forced;
  attempt.completedAt = new Date();
  attempt.timeSpent = Math.floor((attempt.completedAt - attempt.startedAt) / 1000);
  await attempt.save();
  return attempt;
}

function submissionResponse(attempt, exam) {
  if (exam.settings.showResults) return {
    message: 'Exam submitted successfully', showResults: true, score: attempt.score,
    totalPoints: attempt.totalPoints, percentage: attempt.percentage.toFixed(2),
    timeSpent: attempt.timeSpent, passed: attempt.score >= exam.settings.passingMarks
  };
  return { message: 'Exam submitted successfully', showResults: false, timeSpent: attempt.timeSpent };

  attempt.totalPoints = attempt.totalPoints || exam.settings.totalMarks || 0;
  attempt.score = totalScore;
  attempt.percentage = attempt.totalPoints > 0
    ? (totalScore / attempt.totalPoints) * 100
    : 0;
  attempt.status = 'completed';
  attempt.completedAt = new Date();
  attempt.timeSpent = Math.floor(
    (attempt.completedAt - attempt.startedAt) / 1000
  );

  if (securityAutoSubmit) {
    attempt.securityViolations = attempt.securityViolations || {};
    attempt.securityViolations.autoSubmitted = true;
  }

  await attempt.save();
  return { exam, result: buildSubmitResult(exam, attempt, message) };
}

function sanitizeStudentAttempt(attempt) {
  const obj = attempt.toObject ? attempt.toObject() : attempt;
  const exam = obj.exam && typeof obj.exam === 'object' ? obj.exam : null;
  const showResults = exam?.settings?.showResults !== false;
  const allowReview = !!exam?.settings?.allowReview;

  obj.canReview = allowReview;
  delete obj.answers;

  if (!showResults) {
    obj.resultsHidden = true;
    delete obj.score;
    delete obj.percentage;
  }

  return obj;
}

function buildCorrectAnswer(question) {
  if (question.questionType === 'multiple-choice' || question.questionType === 'true-false') {
    const correctIndex = (question.options || []).findIndex(o => o.isCorrect);
    return {
      correctOptionIndex: correctIndex >= 0 ? correctIndex : undefined,
      correctAnswer: correctIndex >= 0 ? question.options[correctIndex]?.text : question.correctAnswer
    };
  }

  return {
    correctOptionIndex: undefined,
    correctAnswer: question.correctAnswer || ''
  };
}

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

// RECORD SAFE EXAM MODE VIOLATION
router.post('/:attemptId/security-flag', auth, async (req, res) => {
  try {
    const reason = (req.body.reason || 'Student left the exam page').toString().slice(0, 200);

    const attempt = await ExamAttempt.findOne({
      _id: req.params.attemptId,
      student: req.user._id
    });

    if (!attempt) {
      return res.status(404).json({ message: 'Attempt not found' });
    }

    if (attempt.status !== 'in-progress') {
      const exam = await Exam.findById(attempt.exam);
      return res.json({
        message: 'Attempt has already been submitted',
        warningCount: attempt.securityViolations?.count || 0,
        warningsRemaining: 0,
        autoSubmitted: !!attempt.securityViolations?.autoSubmitted,
        result: exam ? buildSubmitResult(exam, attempt) : undefined
      });
    }

    await finalizeAttempt(attempt, exam);

    res.json(submissionResponse(attempt, exam));
    attempt.securityViolations = attempt.securityViolations || { count: 0, events: [] };
    attempt.securityViolations.count = (attempt.securityViolations.count || 0) + 1;
    attempt.securityViolations.events = attempt.securityViolations.events || [];
    attempt.securityViolations.events.push({ reason, occurredAt: new Date() });

    const warningCount = attempt.securityViolations.count;

    if (warningCount >= MAX_SECURITY_WARNINGS) {
      const { result } = await finalizeAttempt(attempt, {
        message: 'Exam auto-submitted after repeated safe exam mode warnings',
        securityAutoSubmit: true
      });
      return res.json({
        message: 'Exam auto-submitted after repeated safe exam mode warnings',
        warningCount,
        warningsRemaining: 0,
        autoSubmitted: true,
        result
      });
    }

    await attempt.save();
    res.json({
      message: 'Safe exam mode warning recorded',
      warningCount,
      warningsRemaining: MAX_SECURITY_WARNINGS - warningCount,
      autoSubmitted: false
    });
  } catch (error) {
    console.error('Security flag error:', error);
    res.status(500).json({ message: 'Error recording safe exam mode warning' });
  }
});

// SUBMIT EXAM
router.post('/:attemptId/submit', auth, async (req, res) => {
  try {
    const attempt = await ExamAttempt.findOne({
      _id: req.params.attemptId,
      student: req.user._id
    });

    if (!attempt) {
      return res.status(404).json({ message: 'Attempt not found' });
    }

    if (attempt.status !== 'in-progress') {
      const exam = await Exam.findById(attempt.exam);
      if (!exam) return res.status(404).json({ message: 'Exam not found' });
      return res.json(buildSubmitResult(exam, attempt, 'Exam already submitted'));
    }

    const { result } = await finalizeAttempt(attempt);
    res.json(result);
  } catch (error) {
    console.error('Submit error:', error);
    res.status(error.status || 500).json({ message: error.status ? error.message : 'Error submitting exam' });
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

    res.json(attempts.map(sanitizeStudentAttempt));
  } catch (error) {
    res.status(500).json({ message: 'Error fetching attempts' });
  }
});

// REPORT SAFE-MODE VIOLATION
// The server owns the three-strike decision, so reloading the client cannot reset it.
router.post('/:attemptId/violation', auth, async (req, res) => {
  try {
    const type = req.body.type;
    const allowed = ['copy', 'paste', 'screenshot', 'app-background', 'print-screen'];
    if (!allowed.includes(type)) return res.status(400).json({ message: 'Invalid violation type' });

    const attempt = await ExamAttempt.findOne({
      _id: req.params.attemptId, student: req.user._id, status: 'in-progress'
    });
    if (!attempt) return res.status(404).json({ message: 'Active attempt not found' });

    const exam = await Exam.findById(attempt.exam).populate('questions.question');
    if (!exam || !exam.settings.safeMode) return res.status(403).json({ message: 'Safe mode is not enabled for this exam' });

    attempt.violations.push({ type, occurredAt: new Date() });
    const violationCount = attempt.violations.length;
    if (violationCount >= 3) {
      await finalizeAttempt(attempt, exam, { forced: true });
      return res.json({
        message: 'Three safe-mode violations recorded. Exam submitted automatically.',
        violationCount, submitted: true, result: submissionResponse(attempt, exam)
      });
    }
    await attempt.save();
    res.json({ message: `Safe-mode violation ${violationCount} of 3 recorded.`, violationCount, submitted: false });
  } catch (error) {
    console.error('Safe-mode violation error:', error);
    res.status(500).json({ message: 'Could not record safe-mode violation' });
// REVIEW A COMPLETED ATTEMPT (Student)
router.get('/:attemptId/review', auth, async (req, res) => {
  try {
    const attempt = await ExamAttempt.findOne({
      _id: req.params.attemptId,
      student: req.user._id,
      status: { $ne: 'in-progress' }
    }).populate({
      path: 'exam',
      populate: { path: 'questions.question' }
    });

    if (!attempt) {
      return res.status(404).json({ message: 'Completed attempt not found' });
    }

    const exam = attempt.exam;
    if (!exam?.settings?.allowReview) {
      return res.status(403).json({ message: 'Review is not enabled for this exam' });
    }

    const answersByQuestion = new Map(
      (attempt.answers || []).map(answer => [getQuestionId(answer.question), answer])
    );

    const questions = (exam.questions || [])
      .filter(ref => ref.question)
      .map((ref, order) => {
        const question = ref.question;
        const questionId = getQuestionId(question);
        const answer = answersByQuestion.get(questionId);
        const { correctOptionIndex, correctAnswer } = buildCorrectAnswer(question);

        return {
          order,
          questionId,
          questionText: question.questionText,
          questionType: question.questionType,
          points: ref.points || question.points || 1,
          options: (question.options || []).map(option => ({
            _id: option._id,
            text: option.text
          })),
          selectedOption: answer?.selectedOption,
          textAnswer: answer?.textAnswer,
          isCorrect: answer?.isCorrect,
          pointsEarned: answer?.pointsEarned || 0,
          correctOptionIndex,
          correctAnswer,
          explanation: question.explanation || ''
        };
      });

    const payload = {
      attemptId: attempt._id,
      exam: {
        _id: exam._id,
        title: exam.title,
        subject: exam.subject,
        settings: {
          showResults: exam.settings.showResults !== false,
          allowReview: !!exam.settings.allowReview,
          passingMarks: exam.settings.passingMarks,
          totalMarks: exam.settings.totalMarks
        }
      },
      timeSpent: attempt.timeSpent,
      completedAt: attempt.completedAt,
      questions
    };

    if (exam.settings.showResults !== false) {
      payload.score = attempt.score;
      payload.totalPoints = attempt.totalPoints;
      payload.percentage = attempt.percentage;
      payload.passed = attempt.score >= exam.settings.passingMarks;
    }

    res.json(payload);
  } catch (error) {
    console.error('Review error:', error);
    res.status(500).json({ message: 'Error loading review' });
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
