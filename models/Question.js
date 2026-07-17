const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  creator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  questionText: {
    type: String,
    required: [true, 'Question text is required']
  },
  questionType: {
    type: String,
    enum: [
      'multiple-choice',
      'true-false',
      'short-answer',
      'essay',
      'fill-blank'
    ],
    required: true,
    default: 'multiple-choice'
  },
  options: [
    {
      text: String,
      isCorrect: Boolean
    }
  ],
  correctAnswer: String,
  points: {
    type: Number,
    default: 1,
    min: 1
  },
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard'],
    default: 'medium'
  },
  subject: String,
  category: String,
  tags: [String],
  explanation: String,
  image: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Question', questionSchema);