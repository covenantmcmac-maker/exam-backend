const router = require('express').Router();
const Question = require('../models/Question');
const { auth, authorize } = require('../middleware/auth');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const xlsx = require('xlsx');
const mammoth = require('mammoth');

// File upload setup
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB max
});

// ========================
// Helper: Process Questions
// ========================
const processQuestions = (rawQuestions, userId) => {
  return rawQuestions.map(row => {
    const type = (
      row.type ||
      row.questionType ||
      'multiple-choice'
    ).toLowerCase().trim();

    let options = [];
    if (type === 'multiple-choice' || type === 'true-false') {
      const optA = row.option_a || row.optionA || row.a || '';
      const optB = row.option_b || row.optionB || row.b || '';
      const optC = row.option_c || row.optionC || row.c || '';
      const optD = row.option_d || row.optionD || row.d || '';
      const correct = (
        row.correct_answer ||
        row.correctAnswer ||
        'A'
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

// ========================
// Helper: Parse Word Document
// ========================
const parseWordDocument = async (filePath, userId) => {
  const result = await mammoth.extractRawText({ path: filePath });
  const text = result.value;
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);

  const questions = [];
  let currentQuestion = null;
  let optionIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect question line
    // Supports: "1. Question" or "Q1. Question" or "Question:"
    const questionMatch = line.match(
      /^(?:Q?\d+[\.\)]\s*)(.+)/i
    );

    // Detect options A. B. C. D.
    const optionMatch = line.match(
      /^([A-D])[\.\)]\s*(.+)/i
    );

    // Detect answer line
    const answerMatch = line.match(
      /^(?:Answer|Correct|ANS|KEY)[\:\s]+([A-D]|True|False)/i
    );

    // Detect difficulty
    const difficultyMatch = line.match(
      /^(?:Difficulty|Level)[\:\s]+(easy|medium|hard)/i
    );

    // Detect subject
    const subjectMatch = line.match(
      /^(?:Subject|Topic)[\:\s]+(.+)/i
    );

    // Detect points
    const pointsMatch = line.match(
      /^(?:Points|Marks|Score)[\:\s]+(\d+)/i
    );

    // Detect explanation
    const explanationMatch = line.match(
      /^(?:Explanation|Reason|Note)[\:\s]+(.+)/i
    );

    if (questionMatch) {
      // Save previous question
      if (currentQuestion && currentQuestion.questionText) {
        questions.push(currentQuestion);
      }
      // Start new question
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
      optionIndex = 0;

    } else if (optionMatch && currentQuestion) {
      currentQuestion.options.push({
        text: optionMatch[2].trim(),
        isCorrect: false
      });
      optionIndex++;

    } else if (answerMatch && currentQuestion) {
      const ans = answerMatch[1].toUpperCase();
      if (ans === 'TRUE' || ans === 'A') {
        if (currentQuestion.options.length <= 2) {
          currentQuestion.questionType = 'true-false';
          currentQuestion.options = [
            { text: 'True', isCorrect: ans === 'TRUE' || ans === 'A' },
            { text: 'False', isCorrect: ans === 'FALSE' || ans === 'B' }
          ];
        } else {
          if (currentQuestion.options[0]) {
            currentQuestion.options[0].isCorrect = true;
          }
        }
      } else if (ans === 'FALSE' || ans === 'B') {
        if (currentQuestion.options.length <= 2) {
          currentQuestion.questionType = 'true-false';
          currentQuestion.options = [
            { text: 'True', isCorrect: false },
            { text: 'False', isCorrect: true }
          ];
        } else {
          if (currentQuestion.options[1]) {
            currentQuestion.options[1].isCorrect = true;
          }
        }
      } else if (ans === 'C' && currentQuestion.options[2]) {
        currentQuestion.options[2].isCorrect = true;
      } else if (ans === 'D' && currentQuestion.options[3]) {
        currentQuestion.options[3].isCorrect = true;
      }
      currentQuestion.correctAnswer = ans;

    } else if (difficultyMatch && currentQuestion) {
      currentQuestion.difficulty =
        difficultyMatch[1].toLowerCase();

    } else if (subjectMatch && currentQuestion) {
      currentQuestion.subject = subjectMatch[1].trim();

    } else if (pointsMatch && currentQuestion) {
      currentQuestion.points = parseInt(pointsMatch[1]);

    } else if (explanationMatch && currentQuestion) {
      currentQuestion.explanation = explanationMatch[1].trim();
    }
  }

  // Save last question
  if (currentQuestion && currentQuestion.questionText) {
    questions.push(currentQuestion);
  }

  return questions.filter(q => q.questionText !== '');
};

// ========================
// BULK UPLOAD
// ========================
router.post(
  '/bulk-upload',
  auth,
  authorize('teacher', 'admin'),
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          message: 'Please upload a file'
        });
      }

      const fileName = req.file.originalname.toLowerCase();
      let questions = [];

      // CSV
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
      }

      // Excel
      else if (
        fileName.endsWith('.xlsx') ||
        fileName.endsWith('.xls')
      ) {
        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = xlsx.utils.sheet_to_json(sheet);
        questions = processQuestions(rows, req.user._id);
      }

      // JSON
      else if (fileName.endsWith('.json')) {
        const fileContent = fs.readFileSync(
          req.file.path, 'utf8'
        );
        const parsed = JSON.parse(fileContent);
        const rows = Array.isArray(parsed)
          ? parsed
          : parsed.questions || [];
        questions = processQuestions(rows, req.user._id);
      }

      // Word Document
      else if (
        fileName.endsWith('.docx') ||
        fileName.endsWith('.doc')
      ) {
        questions = await parseWordDocument(
          req.file.path,
          req.user._id
        );
      }

      // Unsupported
      else {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({
          message: 'Unsupported format. Use CSV, Excel, JSON or Word'
        });
      }

      // Check questions found
      if (questions.length === 0) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({
          message: 'No valid questions found. Check your file format.'
        });
      }

      // Save to database
      const saved = await Question.insertMany(questions);

      // Delete temp file
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

// ========================
// CREATE SINGLE QUESTION
// ========================
router.post(
  '/',
  auth,
  authorize('teacher', 'admin'),
  async (req, res) => {
    try {
      const question = new Question({
        ...req.body,
        creator: req.user._id
      });
      await question.save();
      res.status(201).json(question);
    } catch (error) {
      console.error('Create question error:', error);
      res.status(500).json({ message: 'Error creating question' });
    }
  }
);

// ========================
// GET ALL QUESTIONS
// ========================
router.get(
  '/',
  auth,
  authorize('teacher', 'admin'),
  async (req, res) => {
    try {
      const {
        subject,
        difficulty,
        type,
        page = 1,
        limit = 50
      } = req.query;

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
  }
);

// ========================
// UPDATE QUESTION
// ========================
router.put(
  '/:id',
  auth,
  authorize('teacher', 'admin'),
  async (req, res) => {
    try {
      const question = await Question.findOneAndUpdate(
        { _id: req.params.id, creator: req.user._id },
        req.body,
        { new: true }
      );
      if (!question) {
        return res.status(404).json({
          message: 'Question not found'
        });
      }
      res.json(question);
    } catch (error) {
      res.status(500).json({ message: 'Error updating question' });
    }
  }
);

// ========================
// DELETE QUESTION
// ========================
router.delete(
  '/:id',
  auth,
  authorize('teacher', 'admin'),
  async (req, res) => {
    try {
      const question = await Question.findOneAndDelete({
        _id: req.params.id,
        creator: req.user._id
      });
      if (!question) {
        return res.status(404).json({
          message: 'Question not found'
        });
      }
      res.json({ message: 'Question deleted successfully' });
    } catch (error) {
      res.status(500).json({ message: 'Error deleting question' });
    }
  }
);

module.exports = router;