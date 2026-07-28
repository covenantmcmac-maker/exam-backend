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
      explanation: row.explanation || ''
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
        explanation: ''
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

      const result = await Question.deleteMany({
        _id: { $in: questionIds },
        creator: req.user._id
      });

      res.json({
        message: `Successfully deleted ${result.deletedCount} questions`,
        deletedCount: result.deletedCount
      });
    } catch (error) {
      res.status(500).json({ message: 'Error deleting questions' });
    }
  }
);

// CREATE SINGLE QUESTION
router.post('/', auth, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const question = new Question({
      ...req.body,
      creator: req.user._id
    });
    await question.save();
    res.status(201).json(question);
  } catch (error) {
    res.status(500).json({ message: 'Error creating question' });
  }
});

// GET ALL QUESTIONS
router.get('/', auth, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const { subject, difficulty, type, page = 1, limit = 10000 } = req.query;

    const filter = { creator: req.user._id };
    if (subject) filter.subject = subject;
    if (difficulty) filter.difficulty = difficulty;
    if (type) filter.questionType = type;

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
    res.status(500).json({ message: 'Error fetching questions' });
  }
});

// UPDATE QUESTION
router.put('/:id', auth, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const question = await Question.findOneAndUpdate(
      { _id: req.params.id, creator: req.user._id },
      req.body,
      { new: true }
    );
    if (!question) {
      return res.status(404).json({ message: 'Question not found' });
    }
    res.json(question);
  } catch (error) {
    res.status(500).json({ message: 'Error updating question' });
  }
});

// DELETE QUESTION
router.delete('/:id', auth, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const question = await Question.findOneAndDelete({
      _id: req.params.id,
      creator: req.user._id
    });
    if (!question) {
      return res.status(404).json({ message: 'Question not found' });
    }
    res.json({ message: 'Question deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting question' });
  }
});

module.exports = router;