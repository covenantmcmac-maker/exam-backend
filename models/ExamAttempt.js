const mongoose = require('mongoose');

const examAttemptSchema = new mongoose.Schema({
  exam: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Exam',
    required: true
  },
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  answers: [
    {
      question: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Question'
      },
      selectedOption: Number,
      textAnswer: String,
      isCorrect: Boolean,
      pointsEarned: {
        type: Number,
        default: 0
      },
      timeTaken: Number
    }
  ],
  score: {
    type: Number,
    default: 0
  },
  totalPoints: Number,
  percentage: Number,
  status: {
    type: String,
    enum: [
      'in-progress',
      'completed',
      'timed-out',
      'graded'
    ],
    default: 'in-progress'
  },
  startedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: Date,
  timeSpent: Number
});

module.exports = mongoose.model('ExamAttempt', examAttemptSchema);