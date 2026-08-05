const router = require('express').Router();
const Question = require('../models/Question');
const { auth, authorize } = require('../middleware/auth');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const xlsx = require('xlsx');
const mammoth = require('mammoth');

const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }
});

const processQuestions = (rawQuestions, userId) => {
  return rawQuestions.map(row => {
    const type = (
      row.type || row.questionType || 'multiple-choice'
    ).toLowerCase().trim();

    let options = [];
    if (type === 'multiple-choice' || type === 'true-false') {
      const optA = row.option_a || row.optionA || row.a || '';
      const optB = row.option_b || row.optionB || row.b || '';
      const optC = row.option_c || row.optionC || row.c || '';
      const optD = row.option_d || row.optionD || row.d || '';
      const correct = (
        row.correct_answer || row.correctAnswer || 'A'
      ).toString().toUpperCase().trim();

      options = [
        { text: optA, isCorrect: correct === 'A' },
        { text: optB, isCorrect: correct === 'B' },
        { text: optC, isCorrect: correct === 'C' },
        { text: optD, isCorrect: correct === 'D' }
      ].filter(o => o.text !== '');
    }

    return {
      creator: userId,
      questionText: row.question || row.questionText || '',
      questionType: type,
      options,
      correctAnswer: row.correct_answer || row.correctAnswer || '',
      difficulty: (row.difficulty || 'medium').toLowerCase().trim(),
      subject: row.subject || '',
      category: row.category || '',
      points: parseInt(row.points) || 1,
      explanation: row.explanation || '',
      isPastQuestion: false
    };
  }).filter(q => q.questionText !== '');
};

const parseWordDocument = async (filePath, userId) => {
  const result = await mammoth.extractRawText({ path: filePath });
  const text = result.value;
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);

  const questions = [];
  let currentQuestion = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const questionMatch = line.match(/^(?:Q?\d+[\.\)]\s*)(.+)/i);
    const optionMatch = line.match(/^([A-D])[\.\)]\s*(.+)/i);
    const answerMatch = line.match(
      /^(?:Answer|Correct|ANS|KEY)[\:\s]+([A-D]|True|False)/i
    );
    const difficultyMatch = line.match(
      /^(?:Difficulty|Level)[\:\s]+(easy|medium|hard)/i
    );
    const subjectMatch = line.match(
      /^(?:Subject|Topic)[\:\s]+(.+)/i
    );
    const pointsMatch = line.match(
      /^(?:Points|Marks|Score)[\:\s]+(\d+)/i
    );
    const explanationMatch = line.match(
      /^(?:Explanation|Reason|Note)[\:\s]+(.+)/i
    );

    if (questionMatch) {
      if (currentQuestion && currentQuestion.questionText) {
        questions.push(currentQuestion);
      }
      currentQuestion = {
        creator: userId,
        questionText: questionMatch[1].trim(),
        questionType: 'multiple-choice',
        options: [],
        correctAnswer: '',
        difficulty: 'medium',
        subject: '',
        points: 1,
        explanation: '',
        isPastQuestion: false
      };
    } else if (optionMatch && currentQuestion) {
      currentQuestion.options.push({
        text: optionMatch[2].trim(),
        isCorrect: false
      });
    } else if (answerMatch && currentQuestion) {
      const ans = answerMatch[1].toUpperCase();
      if (ans === 'A' && currentQuestion.options[0]) {
        currentQuestion.options[0].isCorrect = true;
      } else if (ans === 'B' && currentQuestion.options[1]) {
        currentQuestion.options[1].isCorrect = true;
      } else if (ans === 'C' && currentQuestion.options[2]) {
        currentQuestion.options[2].isCorrect = true;
      } else if (ans === 'D' && currentQuestion.options[3]) {
        currentQuestion.options[3].isCorrect = true;
      }
      currentQuestion.correctAnswer = ans;
    } else if (difficultyMatch && currentQuestion) {
      currentQuestion.difficulty = difficultyMatch[1].toLowerCase();
    } else if (subjectMatch && currentQuestion) {
      currentQuestion.subject = subjectMatch[1].trim();
    } else if (pointsMatch && currentQuestion) {
      currentQuestion.points = parseInt(pointsMatch[1]);
    } else if (explanationMatch && currentQuestion) {
      currentQuestion.explanation = explanationMatch[1].trim();
    }
  }

  if (currentQuestion && currentQuestion.questionText) {
    questions.push(currentQuestion);
  }

  return questions.filter(q => q.questionText !== '');
};

// Active questions include legacy documents created before isPastQuestion was
// added. MongoDB's `$ne: true` matches both an explicit false and a missing
// field, while archived questions continue to require an explicit true.
const pastQuestionFilter = (value) =>
  value === 'true' || value === true ? true : { $ne: true };

// Helper to build filter for past questions
const buildBaseFilter = (req, opts = {}) => {
  const { subject, difficulty, type, isPastQuestion, past } = req.query;
  const filter = {};

  // creator scoped by default unless explicitly told to show all
  if (opts.creatorScoped) {
    filter.creator = req.user._id;
  }

  if (subject) filter.subject = subject;
  if (difficulty) filter.difficulty = difficulty;
  if (type) filter.questionType = type;

  // Support both ?past=true/false and ?isPastQuestion=true/false. Treat a
  // missing isPastQuestion field as active whenever the requested state is
  // false, including a defaultPast of false.
  if (past !== undefined) {
    filter.isPastQuestion = pastQuestionFilter(past);
  } else if (isPastQuestion !== undefined) {
    filter.isPastQuestion = pastQuestionFilter(isPastQuestion);
  } else if (opts.defaultPast !== undefined) {
    filter.isPastQuestion = pastQuestionFilter(opts.defaultPast);
  }

  // Optional year / session filters for past questions
  if (req.query.year) {
    filter.pastQuestionYear = parseInt(req.query.year);
  }
  if (req.query.session) {
    filter.pastQuestionSession = req.query.session;
  }
  if (req.query.examType) {
    filter.pastQuestionExamType = req.query.examType;
  }

  return filter;
};

// ------------------------------------------------- PAST QUESTIONS ROUTES
// Must be before /:id routes

// GET /api/questions/past - teacher's own past questions
router.get('/past', auth, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const { page = 1, limit = 10000 } = req.query;
    const filter = buildBaseFilter(req, { creatorScoped: true, defaultPast: true });
    // ensure past true even if query override missing
    filter.isPastQuestion = true;

    const total = await Question.countDocuments(filter);
    const questions = await Question.find(filter)
      .sort({ movedToPastAt: -1, createdAt: -1 })
      .skip((page - 1) * parseInt(limit))
      .limit(parseInt(limit));

    res.json({ questions, total, pages: Math.ceil(total / parseInt(limit)) });
  } catch (error) {
    console.error('Past questions fetch error:', error);
    res.status(500).json({ message: 'Error fetching past questions' });
  }
});

// GET /api/questions/past-questions - public pool of past questions (all creators)
// Accessible to any authenticated user (students can practice, teachers can browse)
router.get('/past-questions', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10000, search } = req.query;
    const filter = buildBaseFilter(req, { creatorScoped: false, defaultPast: true });
    filter.isPastQuestion = true;

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
      .populate('creator', 'name')
      .populate('originalCreator', 'name')
      .sort({ movedToPastAt: -1, pastQuestionYear: -1, createdAt: -1 })
      .skip((page - 1) * parseInt(limit))
      .limit(parseInt(limit));

    res.json({ questions, total, pages: Math.ceil(total / parseInt(limit)) });
  } catch (error) {
    console.error('Public past questions error:', error);
    res.status(500).json({ message: 'Error fetching past questions' });
  }
});

// GET /api/questions/past-questions/stats - aggregated stats for UI
router.get('/past-questions/stats', auth, async (req, res) => {
  try {
    const match = { isPastQuestion: true };
    const stats = await Question.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          subjects: { $addToSet: '$subject' },
          years: { $addToSet: '$pastQuestionYear' }
        }
      },
      {
        $project: {
          _id: 0,
          total: 1,
          subjects: 1,
          years: 1,
          subjectCount: { $size: '$subjects' }
        }
      }
    ]);

    const bySubject = await Question.aggregate([
      { $match: { isPastQuestion: true } },
      { $group: { _id: '$subject', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    const byYear = await Question.aggregate([
      { $match: { isPastQuestion: true, pastQuestionYear: { $ne: null } } },
      { $group: { _id: '$pastQuestionYear', count: { $sum: 1 } } },
      { $sort: { _id: -1 } }
    ]);

    res.json({
      overview: stats[0] || { total: 0, subjects: [], years: [] },
      bySubject,
      byYear
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching past question stats' });
  }
});

// GET /api/questions/past-questions/practice/generate - generate random practice set from past questions
router.get('/past-questions/practice/generate', auth, async (req, res) => {
  try {
    const { count = 10, subject, difficulty, type, year, session, examType, category } = req.query;

    const match = { isPastQuestion: true };
    if (subject) match.subject = subject;
    if (difficulty) match.difficulty = difficulty;
    if (type) match.questionType = type;
    if (category) match.category = category;
    if (year) match.pastQuestionYear = parseInt(year);
    if (session) match.pastQuestionSession = session;
    if (examType) match.pastQuestionExamType = examType;

    const limit = Math.min(Math.max(parseInt(count) || 10, 1), 50);

    const totalMatching = await Question.countDocuments(match);
    if (totalMatching === 0) {
      return res.json({ questions: [], totalMatching: 0, count: 0, message: 'No past questions match your filters' });
    }

    // Random sample
    const sampled = await Question.aggregate([
      { $match: match },
      { $sample: { size: Math.min(limit, totalMatching) } }
    ]);

    const ids = sampled.map((q) => q._id);
    const populated = await Question.find({ _id: { $in: ids } })
      .populate('creator', 'name')
      .populate('originalCreator', 'name');

    // Preserve random order from sampled
    const ordered = ids.map((id) => populated.find((p) => p._id.toString() === id.toString())).filter(Boolean);

    res.json({
      questions: ordered,
      totalMatching,
      count: ordered.length,
      filters: { subject, difficulty, type, year, session, examType, category }
    });
  } catch (error) {
    console.error('Generate practice error:', error);
    res.status(500).json({ message: 'Error generating practice set' });
  }
});

// POST /api/questions/past-questions/practice/submit - grade a practice attempt
router.post('/past-questions/practice/submit', auth, async (req, res) => {
  try {
    const { answers } = req.body; // [{questionId, selectedOption?, textAnswer?}]

    if (!answers || !Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({ message: 'No answers submitted' });
    }

    let score = 0;
    let totalPoints = 0;
    const results = [];

    for (const ans of answers) {
      const q = await Question.findById(ans.questionId);
      if (!q) continue;

      const maxPoints = q.points || 1;
      totalPoints += maxPoints;

      let isCorrect = false;
      let pointsEarned = 0;

      if (q.questionType === 'multiple-choice' || q.questionType === 'true-false') {
        const correctIdx = q.options.findIndex((o) => o.isCorrect);
        if (ans.selectedOption !== undefined && ans.selectedOption === correctIdx) {
          isCorrect = true;
          pointsEarned = maxPoints;
        }
      } else if (q.questionType === 'short-answer' || q.questionType === 'fill-blank') {
        const expected = (q.correctAnswer || '').toLowerCase().trim();
        const given = (ans.textAnswer || '').toLowerCase().trim();
        if (expected && given && expected === given) {
          isCorrect = true;
          pointsEarned = maxPoints;
        }
      } else {
        // essay - not auto-graded
        pointsEarned = 0;
      }

      score += pointsEarned;

      results.push({
        questionId: q._id,
        questionText: q.questionText,
        isCorrect,
        pointsEarned,
        maxPoints,
        correctAnswer: q.correctAnswer,
        options: q.options,
        explanation: q.explanation,
        yourAnswer: ans
      });
    }

    const percentage = totalPoints > 0 ? (score / totalPoints) * 100 : 0;
    const passed = percentage >= 50;

    res.json({
      message: 'Practice submitted',
      score,
      totalPoints,
      percentage: percentage.toFixed(2),
      passed,
      results,
      totalQuestions: answers.length
    });
  } catch (error) {
    console.error('Practice submit error:', error);
    res.status(500).json({ message: 'Error grading practice' });
  }
});

// BULK UPLOAD
router.post(
  '/bulk-upload',
  auth,
  authorize('teacher', 'admin'),
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'Please upload a file' });
      }

      const fileName = req.file.originalname.toLowerCase();
      let questions = [];

      if (fileName.endsWith('.csv')) {
        await new Promise((resolve, reject) => {
          const rows = [];
          fs.createReadStream(req.file.path)
            .pipe(csv())
            .on('data', row => rows.push(row))
            .on('end', () => {
              questions = processQuestions(rows, req.user._id);
              resolve();
            })
            .on('error', reject);
        });
      } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = xlsx.utils.sheet_to_json(sheet);
        questions = processQuestions(rows, req.user._id);
      } else if (fileName.endsWith('.json')) {
        const fileContent = fs.readFileSync(req.file.path, 'utf8');
        const parsed = JSON.parse(fileContent);
        const rows = Array.isArray(parsed) ? parsed : parsed.questions || [];
        questions = processQuestions(rows, req.user._id);
      } else if (fileName.endsWith('.docx') || fileName.endsWith('.doc')) {
        questions = await parseWordDocument(req.file.path, req.user._id);
      } else {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({
          message: 'Unsupported format. Use CSV, Excel, JSON or Word'
        });
      }

      if (questions.length === 0) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({
          message: 'No valid questions found. Check your file format.'
        });
      }

      const saved = await Question.insertMany(questions);
      fs.unlinkSync(req.file.path);

      res.status(201).json({
        message: `Successfully uploaded ${saved.length} questions!`,
        count: saved.length
      });
    } catch (error) {
      console.error('Bulk upload error:', error);
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({
        message: 'Error processing file: ' + error.message
      });
    }
  }
);

// BULK DELETE
router.post(
  '/bulk-delete',
  auth,
  authorize('teacher', 'admin'),
  async (req, res) => {
    try {
      const { questionIds } = req.body;

      if (!questionIds || questionIds.length === 0) {
        return res.status(400).json({ message: 'No questions selected' });
      }

      // Allow teacher to delete own, admin to delete any? Keep teacher scoped but admin can delete any past too
      const filter = { _id: { $in: questionIds } };
      if (req.user.role !== 'admin') {
        filter.creator = req.user._id;
      }

      const result = await Question.deleteMany(filter);

      res.json({
        message: `Successfully deleted ${result.deletedCount} questions`,
        deletedCount: result.deletedCount
      });
    } catch (error) {
      res.status(500).json({ message: 'Error deleting questions' });
    }
  }
);

// BULK MOVE TO PAST QUESTIONS
router.post(
  '/bulk-move-to-past',
  auth,
  authorize('teacher', 'admin'),
  async (req, res) => {
    try {
      const { questionIds, pastQuestionYear, pastQuestionSession, pastQuestionExamType } = req.body;

      if (!questionIds || questionIds.length === 0) {
        return res.status(400).json({ message: 'No questions selected' });
      }

      const filter = { _id: { $in: questionIds } };
      if (req.user.role !== 'admin') {
        filter.creator = req.user._id;
      }

      const update = {
        isPastQuestion: true,
        movedToPastAt: new Date()
      };
      if (pastQuestionYear) update.pastQuestionYear = parseInt(pastQuestionYear) || null;
      if (pastQuestionSession) update.pastQuestionSession = pastQuestionSession;
      if (pastQuestionExamType) update.pastQuestionExamType = pastQuestionExamType;

      // Preserve original creator if moving for first time
      const questionsToMove = await Question.find(filter);
      for (const q of questionsToMove) {
        if (!q.originalCreator) {
          q.originalCreator = q.creator;
        }
      }

      // Bulk update
      const result = await Question.updateMany(filter, {
        $set: {
          ...update,
          // only set originalCreator where it doesn't exist
        }
      });

      // Second pass to ensure originalCreator set
      await Question.updateMany(
        { ...filter, originalCreator: null },
        { $set: { originalCreator: req.user._id } }
      );

      // If year etc provided, already set. Ensure movedToPastAt for each
      const moved = await Question.find(filter);

      res.json({
        message: `Successfully moved ${result.modifiedCount} questions to past questions`,
        modifiedCount: result.modifiedCount,
        questions: moved
      });
    } catch (error) {
      console.error('Bulk move to past error:', error);
      res.status(500).json({ message: 'Error moving questions to past questions' });
    }
  }
);

// BULK RESTORE FROM PAST QUESTIONS
router.post(
  '/bulk-restore',
  auth,
  authorize('teacher', 'admin'),
  async (req, res) => {
    try {
      const { questionIds } = req.body;

      if (!questionIds || questionIds.length === 0) {
        return res.status(400).json({ message: 'No questions selected' });
      }

      const filter = { _id: { $in: questionIds }, isPastQuestion: true };
      if (req.user.role !== 'admin') {
        filter.creator = req.user._id;
      }

      const result = await Question.updateMany(filter, {
        $set: {
          isPastQuestion: false,
          movedToPastAt: null
        },
        $unset: {
          pastQuestionYear: '',
          pastQuestionSession: '',
          pastQuestionExamType: ''
        }
      });

      res.json({
        message: `Successfully restored ${result.modifiedCount} questions from past questions`,
        modifiedCount: result.modifiedCount
      });
    } catch (error) {
      console.error('Bulk restore error:', error);
      res.status(500).json({ message: 'Error restoring questions' });
    }
  }
);

// CREATE SINGLE QUESTION
router.post('/', auth, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const {
      questionText,
      questionType,
      options,
      correctAnswer,
      points,
      difficulty,
      subject,
      category,
      tags,
      explanation,
      image,
      isPastQuestion,
      pastQuestionYear,
      pastQuestionSession,
      pastQuestionExamType
    } = req.body;

    const questionData = {
      questionText,
      questionType,
      options,
      correctAnswer,
      points,
      difficulty,
      subject,
      category,
      tags,
      explanation,
      image,
      creator: req.user._id,
      isPastQuestion: !!isPastQuestion,
      movedToPastAt: isPastQuestion ? new Date() : null
    };

    if (pastQuestionYear) questionData.pastQuestionYear = parseInt(pastQuestionYear);
    if (pastQuestionSession) questionData.pastQuestionSession = pastQuestionSession;
    if (pastQuestionExamType) questionData.pastQuestionExamType = pastQuestionExamType;
    if (isPastQuestion) questionData.originalCreator = req.user._id;

    const question = new Question(questionData);
    await question.save();
    res.status(201).json(question);
  } catch (error) {
    console.error('Create question error:', error);
    res.status(500).json({ message: 'Error creating question: ' + error.message });
  }
});

// GET ALL QUESTIONS (teacher bank - defaults to non-past unless ?past=true or ?isPastQuestion=true)
router.get('/', auth, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const { subject, difficulty, type, page = 1, limit = 10000, search } = req.query;
    const filter = { creator: req.user._id };

    if (subject) filter.subject = subject;
    if (difficulty) filter.difficulty = difficulty;
    if (type) filter.questionType = type;

    if (search) {
      const regex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { questionText: regex },
        { subject: regex },
        { category: regex }
      ];
    }

    // Past filter logic. Legacy questions without isPastQuestion belong in
    // the active bank, so every non-past query means "not explicitly past".
    const pastParam = req.query.past ?? req.query.isPastQuestion;
    filter.isPastQuestion = pastQuestionFilter(pastParam ?? false);

    if (req.query.year) filter.pastQuestionYear = parseInt(req.query.year);
    if (req.query.session) filter.pastQuestionSession = req.query.session;

    const total = await Question.countDocuments(filter);
    const questions = await Question.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * parseInt(limit))
      .limit(parseInt(limit));

    res.json({
      questions,
      total,
      pages: Math.ceil(total / parseInt(limit))
    });
  } catch (error) {
    console.error('Fetch questions error:', error);
    res.status(500).json({ message: 'Error fetching questions' });
  }
});

// GET SINGLE QUESTION
router.get('/:id', auth, async (req, res) => {
  try {
    const filter = { _id: req.params.id };
    if (req.user.role !== 'admin') {
      // teacher can only fetch own, student can fetch if it's a past question
      if (req.user.role === 'teacher') {
        filter.creator = req.user._id;
      } else {
        filter.isPastQuestion = true;
      }
    }

    const question = await Question.findOne(filter)
      .populate('creator', 'name')
      .populate('originalCreator', 'name');

    if (!question) {
      return res.status(404).json({ message: 'Question not found' });
    }

    // If student, hide correct answer? For practice past questions we may want to show,
    // but keep explanation visible only if allowed. For now return full.
    res.json(question);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching question' });
  }
});

// MOVE SINGLE QUESTION TO PAST
router.patch('/:id/move-to-past', auth, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const { pastQuestionYear, pastQuestionSession, pastQuestionExamType } = req.body;

    const filter = { _id: req.params.id };
    if (req.user.role !== 'admin') {
      filter.creator = req.user._id;
    }

    const question = await Question.findOne(filter);
    if (!question) {
      return res.status(404).json({ message: 'Question not found' });
    }

    if (question.isPastQuestion) {
      return res.status(400).json({ message: 'Question is already in past questions' });
    }

    question.isPastQuestion = true;
    question.movedToPastAt = new Date();
    if (!question.originalCreator) question.originalCreator = question.creator;

    if (pastQuestionYear !== undefined) {
      question.pastQuestionYear = parseInt(pastQuestionYear) || null;
    }
    if (pastQuestionSession !== undefined) question.pastQuestionSession = pastQuestionSession;
    if (pastQuestionExamType !== undefined) question.pastQuestionExamType = pastQuestionExamType;

    await question.save();

    res.json({
      message: 'Question moved to past questions successfully',
      question
    });
  } catch (error) {
    console.error('Move to past error:', error);
    res.status(500).json({ message: 'Error moving question to past questions' });
  }
});

// RESTORE SINGLE QUESTION FROM PAST
router.patch('/:id/restore', auth, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const filter = { _id: req.params.id, isPastQuestion: true };
    if (req.user.role !== 'admin') {
      filter.creator = req.user._id;
    }

    const question = await Question.findOne(filter);
    if (!question) {
      return res.status(404).json({ message: 'Past question not found' });
    }

    question.isPastQuestion = false;
    question.movedToPastAt = null;
    question.pastQuestionYear = null;
    question.pastQuestionSession = null;
    question.pastQuestionExamType = null;

    await question.save();

    res.json({
      message: 'Question restored from past questions successfully',
      question
    });
  } catch (error) {
    console.error('Restore error:', error);
    res.status(500).json({ message: 'Error restoring question' });
  }
});

// UPDATE QUESTION
router.put('/:id', auth, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const filter = { _id: req.params.id };
    if (req.user.role !== 'admin') {
      filter.creator = req.user._id;
    }

    // Prevent overriding creator/isPastQuestion via body without explicit handling
    const allowedFields = { ...req.body };
    delete allowedFields.creator;
    delete allowedFields.originalCreator;
    delete allowedFields.createdAt;

    // If isPastQuestion being set via update, handle movedToPastAt
    if (allowedFields.isPastQuestion === true) {
      allowedFields.movedToPastAt = new Date();
      if (allowedFields.pastQuestionYear) {
        allowedFields.pastQuestionYear = parseInt(allowedFields.pastQuestionYear) || null;
      }
    } else if (allowedFields.isPastQuestion === false) {
      allowedFields.movedToPastAt = null;
      allowedFields.pastQuestionYear = null;
      allowedFields.pastQuestionSession = null;
      allowedFields.pastQuestionExamType = null;
    }

    const question = await Question.findOneAndUpdate(
      filter,
      allowedFields,
      { new: true }
    );
    if (!question) {
      return res.status(404).json({ message: 'Question not found' });
    }
    res.json(question);
  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({ message: 'Error updating question' });
  }
});

// DELETE QUESTION
router.delete('/:id', auth, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const filter = { _id: req.params.id };
    if (req.user.role !== 'admin') {
      filter.creator = req.user._id;
    }

    const question = await Question.findOneAndDelete(filter);
    if (!question) {
      return res.status(404).json({ message: 'Question not found' });
    }
    res.json({ message: 'Question deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting question' });
  }
});

module.exports = router;
